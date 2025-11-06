const std = @import("std");
const Allocator = std.mem.Allocator;
const ansi = @import("ansi.zig");
const buf = @import("buffer.zig");
const gp = @import("grapheme.zig");
const Terminal = @import("terminal.zig");
const logger = @import("logger.zig");

pub const RGBA = ansi.RGBA;
pub const OptimizedBuffer = buf.OptimizedBuffer;
pub const TextAttributes = ansi.TextAttributes;
pub const CursorStyle = Terminal.CursorStyle;

const CLEAR_CHAR = '\u{0a00}';
const MAX_STAT_SAMPLES = 30;
const STAT_SAMPLE_CAPACITY = 30;

const COLOR_EPSILON_DEFAULT: f32 = 0.00001;
const OUTPUT_BUFFER_SIZE = 1024 * 1024 * 2; // 2MB

pub const RendererError = error{
    OutOfMemory,
    InvalidDimensions,
    ThreadingFailed,
    WriteFailed,
};

fn rgbaComponentToU8(component: f32) u8 {
    if (!std.math.isFinite(component)) return 0;

    const clamped = std.math.clamp(component, 0.0, 1.0);
    return @intFromFloat(@round(clamped * 255.0));
}

pub const DebugOverlayCorner = enum {
    topLeft,
    topRight,
    bottomLeft,
    bottomRight,
};

pub const CliRenderer = struct {
    width: u32,
    height: u32,
    currentRenderBuffer: *OptimizedBuffer,
    nextRenderBuffer: *OptimizedBuffer,
    pool: *gp.GraphemePool,
    backgroundColor: RGBA,
    renderOffset: u32,
    terminal: Terminal,
    testing: bool = false,
    useAlternateScreen: bool = true,
    useKittyKeyboard: bool = true,
    terminalSetup: bool = false,

    renderStats: struct {
        lastFrameTime: f64,
        averageFrameTime: f64,
        frameCount: u64,
        fps: u32,
        cellsUpdated: u32,
        renderTime: ?f64,
        overallFrameTime: ?f64,
        bufferResetTime: ?f64,
        stdoutWriteTime: ?f64,
        heapUsed: u32,
        heapTotal: u32,
        arrayBuffers: u32,
        frameCallbackTime: ?f64,
    },
    statSamples: struct {
        lastFrameTime: std.ArrayList(f64),
        renderTime: std.ArrayList(f64),
        overallFrameTime: std.ArrayList(f64),
        bufferResetTime: std.ArrayList(f64),
        stdoutWriteTime: std.ArrayList(f64),
        cellsUpdated: std.ArrayList(u32),
        frameCallbackTime: std.ArrayList(f64),
    },
    lastRenderTime: i64,
    allocator: Allocator,
    renderThread: ?std.Thread = null,
    stdoutWriter: std.io.BufferedWriter(4096, std.fs.File.Writer),
    debugOverlay: struct {
        enabled: bool,
        corner: DebugOverlayCorner,
    } = .{
        .enabled = false,
        .corner = .bottomRight,
    },
    // Threading
    useThread: bool = false,
    renderMutex: std.Thread.Mutex = .{},
    renderCondition: std.Thread.Condition = .{},
    renderRequested: bool = false,
    shouldTerminate: bool = false,
    renderInProgress: bool = false,
    currentOutputBuffer: []u8 = &[_]u8{},
    currentOutputLen: usize = 0,

    currentHitGrid: []u32,
    nextHitGrid: []u32,
    hitGridWidth: u32,
    hitGridHeight: u32,

    // Preallocated output buffer
    var outputBuffer: [OUTPUT_BUFFER_SIZE]u8 = undefined;
    var outputBufferLen: usize = 0;
    var outputBufferB: [OUTPUT_BUFFER_SIZE]u8 = undefined;
    var outputBufferBLen: usize = 0;
    var activeBuffer: enum { A, B } = .A;

    const OutputBufferWriter = struct {
        pub fn write(_: void, data: []const u8) !usize {
            const bufferLen = if (activeBuffer == .A) &outputBufferLen else &outputBufferBLen;
            const buffer = if (activeBuffer == .A) &outputBuffer else &outputBufferB;

            if (bufferLen.* + data.len > buffer.len) {
                // TODO: Resize buffer when necessary
                return error.BufferFull;
            }

            @memcpy(buffer.*[bufferLen.*..][0..data.len], data);
            bufferLen.* += data.len;

            return data.len;
        }

        pub fn writer() std.io.Writer(void, error{BufferFull}, write) {
            return .{ .context = {} };
        }
    };

    pub fn create(allocator: Allocator, width: u32, height: u32, pool: *gp.GraphemePool, graphemes_data: *gp.Graphemes, display_width: *gp.DisplayWidth, testing: bool) !*CliRenderer {
        const self = try allocator.create(CliRenderer);

        const currentBuffer = try OptimizedBuffer.init(allocator, width, height, .{ .pool = pool, .width_method = .unicode, .id = "current buffer" }, graphemes_data, display_width);
        const nextBuffer = try OptimizedBuffer.init(allocator, width, height, .{ .pool = pool, .width_method = .unicode, .id = "next buffer" }, graphemes_data, display_width);

        const stdoutWriter = if (testing) blk: {
            // In testing mode, use /dev/null to discard output
            const devnull = std.fs.openFileAbsolute("/dev/null", .{ .mode = .write_only }) catch {
                // Fallback to stdout if /dev/null can't be opened
                logger.warn("Failed to open /dev/null, falling back to stdout\n", .{});
                break :blk std.io.BufferedWriter(4096, std.fs.File.Writer){ .unbuffered_writer = std.io.getStdOut().writer() };
            };
            break :blk std.io.BufferedWriter(4096, std.fs.File.Writer){ .unbuffered_writer = devnull.writer() };
        } else blk: {
            const stdout = std.io.getStdOut();
            break :blk std.io.BufferedWriter(4096, std.fs.File.Writer){ .unbuffered_writer = stdout.writer() };
        };

        // stat sample arrays
        var lastFrameTime = std.ArrayList(f64).init(allocator);
        var renderTime = std.ArrayList(f64).init(allocator);
        var overallFrameTime = std.ArrayList(f64).init(allocator);
        var bufferResetTime = std.ArrayList(f64).init(allocator);
        var stdoutWriteTime = std.ArrayList(f64).init(allocator);
        var cellsUpdated = std.ArrayList(u32).init(allocator);
        var frameCallbackTimes = std.ArrayList(f64).init(allocator);

        try lastFrameTime.ensureTotalCapacity(STAT_SAMPLE_CAPACITY);
        try renderTime.ensureTotalCapacity(STAT_SAMPLE_CAPACITY);
        try overallFrameTime.ensureTotalCapacity(STAT_SAMPLE_CAPACITY);
        try bufferResetTime.ensureTotalCapacity(STAT_SAMPLE_CAPACITY);
        try stdoutWriteTime.ensureTotalCapacity(STAT_SAMPLE_CAPACITY);
        try cellsUpdated.ensureTotalCapacity(STAT_SAMPLE_CAPACITY);
        try frameCallbackTimes.ensureTotalCapacity(STAT_SAMPLE_CAPACITY);

        const hitGridSize = width * height;
        const currentHitGrid = try allocator.alloc(u32, hitGridSize);
        const nextHitGrid = try allocator.alloc(u32, hitGridSize);
        @memset(currentHitGrid, 0); // Initialize with 0 (no renderable)
        @memset(nextHitGrid, 0);

        self.* = .{
            .width = width,
            .height = height,
            .currentRenderBuffer = currentBuffer,
            .nextRenderBuffer = nextBuffer,
            .pool = pool,
            .backgroundColor = .{ 0.0, 0.0, 0.0, 0.0 },
            .renderOffset = 0,
            .terminal = Terminal.init(.{}),
            .testing = testing,

            .renderStats = .{
                .lastFrameTime = 0,
                .averageFrameTime = 0,
                .frameCount = 0,
                .fps = 0,
                .cellsUpdated = 0,
                .renderTime = null,
                .overallFrameTime = null,
                .bufferResetTime = null,
                .stdoutWriteTime = null,
                .heapUsed = 0,
                .heapTotal = 0,
                .arrayBuffers = 0,
                .frameCallbackTime = null,
            },
            .statSamples = .{
                .lastFrameTime = lastFrameTime,
                .renderTime = renderTime,
                .overallFrameTime = overallFrameTime,
                .bufferResetTime = bufferResetTime,
                .stdoutWriteTime = stdoutWriteTime,
                .cellsUpdated = cellsUpdated,
                .frameCallbackTime = frameCallbackTimes,
            },
            .lastRenderTime = std.time.microTimestamp(),
            .allocator = allocator,
            .stdoutWriter = stdoutWriter,
            .currentHitGrid = currentHitGrid,
            .nextHitGrid = nextHitGrid,
            .hitGridWidth = width,
            .hitGridHeight = height,
        };

        try currentBuffer.clear(.{ self.backgroundColor[0], self.backgroundColor[1], self.backgroundColor[2], self.backgroundColor[3] }, CLEAR_CHAR);
        try nextBuffer.clear(.{ self.backgroundColor[0], self.backgroundColor[1], self.backgroundColor[2], self.backgroundColor[3] }, null);

        return self;
    }

    pub fn destroy(self: *CliRenderer) void {
        self.renderMutex.lock();
        while (self.renderInProgress) {
            self.renderCondition.wait(&self.renderMutex);
        }

        self.shouldTerminate = true;
        self.renderRequested = true;
        self.renderCondition.signal();
        self.renderMutex.unlock();

        if (self.renderThread) |thread| {
            thread.join();
        }

        self.performShutdownSequence();

        self.currentRenderBuffer.deinit();
        self.nextRenderBuffer.deinit();

        // Free stat sample arrays
        self.statSamples.lastFrameTime.deinit();
        self.statSamples.renderTime.deinit();
        self.statSamples.overallFrameTime.deinit();
        self.statSamples.bufferResetTime.deinit();
        self.statSamples.stdoutWriteTime.deinit();
        self.statSamples.cellsUpdated.deinit();
        self.statSamples.frameCallbackTime.deinit();

        self.allocator.free(self.currentHitGrid);
        self.allocator.free(self.nextHitGrid);

        self.allocator.destroy(self);
    }

    pub fn setupTerminal(self: *CliRenderer, useAlternateScreen: bool) void {
        self.useAlternateScreen = useAlternateScreen;
        self.terminalSetup = true;

        var bufferedWriter = &self.stdoutWriter;
        const writer = bufferedWriter.writer();

        self.terminal.queryTerminalSend(writer) catch {
            logger.warn("Failed to query terminal capabilities", .{});
        };

        writer.writeAll(ansi.ANSI.saveCursorState) catch {};

        if (useAlternateScreen) {
            self.terminal.enterAltScreen(writer) catch {};
        } else {
            ansi.ANSI.makeRoomForRendererOutput(writer, @max(self.height, 1)) catch {};
        }

        self.terminal.setCursorPosition(1, 1, false);

        bufferedWriter.flush() catch {};
    }

    pub fn performShutdownSequence(self: *CliRenderer) void {
        if (!self.terminalSetup) return;

        const direct = self.stdoutWriter.writer();
        self.terminal.resetState(direct) catch {
            logger.warn("Failed to reset terminal state", .{});
        };

        if (self.useAlternateScreen) {
            self.stdoutWriter.flush() catch {};
        } else if (self.renderOffset == 0) {
            direct.writeAll("\x1b[H\x1b[J") catch {};
            self.stdoutWriter.flush() catch {};
        } else if (self.renderOffset > 0) {
            // Currently still handled in typescript
            // const consoleEndLine = self.height - self.renderOffset;
            // ansi.ANSI.moveToOutput(direct, 1, consoleEndLine) catch {};
        }

        // NOTE: This messes up state after shutdown, but might be necessary for windows?
        // direct.writeAll(ansi.ANSI.restoreCursorState) catch {};

        direct.writeAll(ansi.ANSI.resetCursorColorFallback) catch {};
        direct.writeAll(ansi.ANSI.resetCursorColor) catch {};
        direct.writeAll(ansi.ANSI.defaultCursorStyle) catch {};
        // Workaround for Ghostty not showing the cursor after shutdown for some reason
        direct.writeAll(ansi.ANSI.showCursor) catch {};
        self.stdoutWriter.flush() catch {};
        std.time.sleep(10 * std.time.ns_per_ms);
        direct.writeAll(ansi.ANSI.showCursor) catch {};
        self.stdoutWriter.flush() catch {};
        std.time.sleep(10 * std.time.ns_per_ms);
    }

    fn addStatSample(comptime T: type, samples: *std.ArrayList(T), value: T) void {
        samples.append(value) catch return;

        if (samples.items.len > MAX_STAT_SAMPLES) {
            _ = samples.orderedRemove(0);
        }
    }

    fn getStatAverage(comptime T: type, samples: *const std.ArrayList(T)) T {
        if (samples.items.len == 0) {
            return 0;
        }

        var sum: T = 0;
        for (samples.items) |value| {
            sum += value;
        }

        if (@typeInfo(T) == .float) {
            return sum / @as(T, @floatFromInt(samples.items.len));
        } else {
            return sum / @as(T, @intCast(samples.items.len));
        }
    }

    pub fn setUseThread(self: *CliRenderer, useThread: bool) void {
        if (self.useThread == useThread) return;

        if (useThread) {
            if (self.renderThread == null) {
                self.renderThread = std.Thread.spawn(.{}, renderThreadFn, .{self}) catch |err| {
                    std.log.warn("Failed to spawn render thread: {}, falling back to non-threaded mode", .{err});
                    self.useThread = false;
                    return;
                };
            }
        } else {
            if (self.renderThread) |thread| {
                thread.join();
                self.renderThread = null;
            }
        }

        self.useThread = useThread;
    }

    pub fn updateStats(self: *CliRenderer, time: f64, fps: u32, frameCallbackTime: f64) void {
        self.renderStats.overallFrameTime = time;
        self.renderStats.fps = fps;
        self.renderStats.frameCallbackTime = frameCallbackTime;

        addStatSample(f64, &self.statSamples.overallFrameTime, time);
        addStatSample(f64, &self.statSamples.frameCallbackTime, frameCallbackTime);
    }

    pub fn updateMemoryStats(self: *CliRenderer, heapUsed: u32, heapTotal: u32, arrayBuffers: u32) void {
        self.renderStats.heapUsed = heapUsed;
        self.renderStats.heapTotal = heapTotal;
        self.renderStats.arrayBuffers = arrayBuffers;
    }

    pub fn resize(self: *CliRenderer, width: u32, height: u32) !void {
        if (self.width == width and self.height == height) return;

        self.width = width;
        self.height = height;

        try self.currentRenderBuffer.resize(width, height);
        try self.nextRenderBuffer.resize(width, height);

        try self.currentRenderBuffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, CLEAR_CHAR);
        try self.nextRenderBuffer.clear(.{ self.backgroundColor[0], self.backgroundColor[1], self.backgroundColor[2], self.backgroundColor[3] }, null);

        const newHitGridSize = width * height;
        const currentHitGridSize = self.hitGridWidth * self.hitGridHeight;
        if (newHitGridSize > currentHitGridSize) {
            const newCurrentHitGrid = try self.allocator.alloc(u32, newHitGridSize);
            const newNextHitGrid = try self.allocator.alloc(u32, newHitGridSize);
            @memset(newCurrentHitGrid, 0);
            @memset(newNextHitGrid, 0);

            self.allocator.free(self.currentHitGrid);
            self.allocator.free(self.nextHitGrid);
            self.currentHitGrid = newCurrentHitGrid;
            self.nextHitGrid = newNextHitGrid;
            self.hitGridWidth = width;
            self.hitGridHeight = height;
        }

        const cursor = self.terminal.getCursorPosition();
        self.terminal.setCursorPosition(@min(cursor.x, width), @min(cursor.y, height), cursor.visible);
    }

    pub fn setBackgroundColor(self: *CliRenderer, rgba: RGBA) void {
        self.backgroundColor = rgba;
    }

    pub fn setRenderOffset(self: *CliRenderer, offset: u32) void {
        self.renderOffset = offset;
    }

    fn renderThreadFn(self: *CliRenderer) void {
        while (true) {
            self.renderMutex.lock();
            while (!self.renderRequested and !self.shouldTerminate) {
                self.renderCondition.wait(&self.renderMutex);
            }

            if (self.shouldTerminate and !self.renderRequested) {
                self.renderMutex.unlock();
                break;
            }

            self.renderRequested = false;

            const outputData = self.currentOutputBuffer;
            const outputLen = self.currentOutputLen;

            const writeStart = std.time.microTimestamp();
            if (outputLen > 0) {
                var bufferedWriter = &self.stdoutWriter;
                bufferedWriter.writer().writeAll(outputData[0..outputLen]) catch {};
                bufferedWriter.flush() catch {};
            }

            // Signal that rendering is complete
            self.renderStats.stdoutWriteTime = @as(f64, @floatFromInt(std.time.microTimestamp() - writeStart));
            self.renderInProgress = false;
            self.renderCondition.signal();
            self.renderMutex.unlock();
        }
    }

    // Render once with current state
    pub fn render(self: *CliRenderer, force: bool) void {
        const now = std.time.microTimestamp();
        const deltaTimeMs = @as(f64, @floatFromInt(now - self.lastRenderTime));
        const deltaTime = deltaTimeMs / 1000.0; // Convert to seconds

        self.lastRenderTime = now;
        self.renderDebugOverlay();

        self.prepareRenderFrame(force);

        if (self.useThread) {
            self.renderMutex.lock();
            while (self.renderInProgress) {
                self.renderCondition.wait(&self.renderMutex);
            }

            if (activeBuffer == .A) {
                activeBuffer = .B;
                self.currentOutputBuffer = &outputBuffer;
                self.currentOutputLen = outputBufferLen;
            } else {
                activeBuffer = .A;
                self.currentOutputBuffer = &outputBufferB;
                self.currentOutputLen = outputBufferBLen;
            }

            self.renderRequested = true;
            self.renderInProgress = true;
            self.renderCondition.signal();
            self.renderMutex.unlock();
        } else {
            const writeStart = std.time.microTimestamp();
            var bufferedWriter = &self.stdoutWriter;
            bufferedWriter.writer().writeAll(outputBuffer[0..outputBufferLen]) catch {};
            bufferedWriter.flush() catch {};
            self.renderStats.stdoutWriteTime = @as(f64, @floatFromInt(std.time.microTimestamp() - writeStart));
        }

        self.renderStats.lastFrameTime = deltaTime * 1000.0;
        self.renderStats.frameCount += 1;

        addStatSample(f64, &self.statSamples.lastFrameTime, deltaTime * 1000.0);
        if (self.renderStats.renderTime) |rt| {
            addStatSample(f64, &self.statSamples.renderTime, rt);
        }
        if (self.renderStats.bufferResetTime) |brt| {
            addStatSample(f64, &self.statSamples.bufferResetTime, brt);
        }
        if (self.renderStats.stdoutWriteTime) |swt| {
            addStatSample(f64, &self.statSamples.stdoutWriteTime, swt);
        }
        addStatSample(u32, &self.statSamples.cellsUpdated, self.renderStats.cellsUpdated);
    }

    pub fn getNextBuffer(self: *CliRenderer) *OptimizedBuffer {
        return self.nextRenderBuffer;
    }

    pub fn getCurrentBuffer(self: *CliRenderer) *OptimizedBuffer {
        return self.currentRenderBuffer;
    }

    fn prepareRenderFrame(self: *CliRenderer, force: bool) void {
        const renderStartTime = std.time.microTimestamp();
        var cellsUpdated: u32 = 0;

        if (activeBuffer == .A) {
            outputBufferLen = 0;
        } else {
            outputBufferBLen = 0;
        }

        var writer = OutputBufferWriter.writer();

        writer.writeAll(ansi.ANSI.hideCursor) catch {};

        var currentFg: ?RGBA = null;
        var currentBg: ?RGBA = null;
        var currentAttributes: i16 = -1;
        var utf8Buf: [4]u8 = undefined;

        const colorEpsilon: f32 = COLOR_EPSILON_DEFAULT;

        for (0..self.height) |uy| {
            const y = @as(u32, @intCast(uy));

            var runStart: i64 = -1;
            var runLength: u32 = 0;

            for (0..self.width) |ux| {
                const x = @as(u32, @intCast(ux));
                const currentCell = self.currentRenderBuffer.get(x, y);
                const nextCell = self.nextRenderBuffer.get(x, y);

                if (currentCell == null or nextCell == null) continue;

                if (!force) {
                    const charEqual = currentCell.?.char == nextCell.?.char;
                    const attrEqual = currentCell.?.attributes == nextCell.?.attributes;

                    if (charEqual and attrEqual and
                        buf.rgbaEqual(currentCell.?.fg, nextCell.?.fg, colorEpsilon) and
                        buf.rgbaEqual(currentCell.?.bg, nextCell.?.bg, colorEpsilon))
                    {
                        if (runLength > 0) {
                            writer.writeAll(ansi.ANSI.reset) catch {};
                            runStart = -1;
                            runLength = 0;
                        }
                        continue;
                    }
                }

                const cell = nextCell.?;

                const fgMatch = currentFg != null and buf.rgbaEqual(currentFg.?, cell.fg, colorEpsilon);
                const bgMatch = currentBg != null and buf.rgbaEqual(currentBg.?, cell.bg, colorEpsilon);
                const sameAttributes = fgMatch and bgMatch and @as(i16, cell.attributes) == currentAttributes;

                if (!sameAttributes or runStart == -1) {
                    if (runLength > 0) {
                        writer.writeAll(ansi.ANSI.reset) catch {};
                    }

                    runStart = @intCast(x);
                    runLength = 0;

                    currentFg = cell.fg;
                    currentBg = cell.bg;
                    currentAttributes = @intCast(cell.attributes);

                    ansi.ANSI.moveToOutput(writer, x + 1, y + 1 + self.renderOffset) catch {};

                    const fgR = rgbaComponentToU8(cell.fg[0]);
                    const fgG = rgbaComponentToU8(cell.fg[1]);
                    const fgB = rgbaComponentToU8(cell.fg[2]);

                    const bgR = rgbaComponentToU8(cell.bg[0]);
                    const bgG = rgbaComponentToU8(cell.bg[1]);
                    const bgB = rgbaComponentToU8(cell.bg[2]);
                    const bgA = cell.bg[3];

                    ansi.ANSI.fgColorOutput(writer, fgR, fgG, fgB) catch {};

                    // If alpha is 0 (transparent), use terminal default background instead of black
                    if (bgA < 0.001) {
                        writer.writeAll("\x1b[49m") catch {};
                    } else {
                        ansi.ANSI.bgColorOutput(writer, bgR, bgG, bgB) catch {};
                    }

                    ansi.TextAttributes.applyAttributesOutputWriter(writer, cell.attributes) catch {};
                }

                // Handle grapheme characters
                if (gp.isGraphemeChar(cell.char)) {
                    const gid: u32 = gp.graphemeIdFromChar(cell.char);
                    const bytes = self.pool.get(gid) catch |err| {
                        self.performShutdownSequence();
                        std.debug.panic("Fatal: no grapheme bytes in pool for gid {d}: {}", .{ gid, err });
                    };
                    if (bytes.len > 0) {
                        const capabilities = self.terminal.getCapabilities();
                        if (capabilities.explicit_width) {
                            const graphemeWidth = gp.charRightExtent(cell.char) + 1;
                            ansi.ANSI.explicitWidthOutput(writer, graphemeWidth, bytes) catch {};
                        } else {
                            writer.writeAll(bytes) catch {};
                        }
                    }
                } else if (gp.isContinuationChar(cell.char)) {
                    // Write a space for continuation cells to clear any previous content
                    writer.writeByte(' ') catch {};
                } else {
                    const len = std.unicode.utf8Encode(@intCast(cell.char), &utf8Buf) catch 1;
                    writer.writeAll(utf8Buf[0..len]) catch {};
                }
                runLength += 1;

                // Update the current buffer with the new cell
                self.currentRenderBuffer.setRaw(x, y, nextCell.?);

                // If this is a grapheme start, also update all continuation cells
                if (gp.isGraphemeChar(nextCell.?.char)) {
                    const rightExtent = gp.charRightExtent(nextCell.?.char);
                    var k: u32 = 1;
                    while (k <= rightExtent and x + k < self.width) : (k += 1) {
                        if (self.nextRenderBuffer.get(x + k, y)) |contCell| {
                            self.currentRenderBuffer.setRaw(x + k, y, contCell);
                        }
                    }
                }

                cellsUpdated += 1;
            }
        }

        writer.writeAll(ansi.ANSI.reset) catch {};

        const cursorPos = self.terminal.getCursorPosition();
        const cursorStyle = self.terminal.getCursorStyle();
        const cursorColor = self.terminal.getCursorColor();

        if (cursorPos.visible) {
            var cursorStyleCode: []const u8 = undefined;

            switch (cursorStyle.style) {
                .block => {
                    cursorStyleCode = if (cursorStyle.blinking)
                        ansi.ANSI.cursorBlockBlink
                    else
                        ansi.ANSI.cursorBlock;
                },
                .line => {
                    cursorStyleCode = if (cursorStyle.blinking)
                        ansi.ANSI.cursorLineBlink
                    else
                        ansi.ANSI.cursorLine;
                },
                .underline => {
                    cursorStyleCode = if (cursorStyle.blinking)
                        ansi.ANSI.cursorUnderlineBlink
                    else
                        ansi.ANSI.cursorUnderline;
                },
            }

            const cursorR = rgbaComponentToU8(cursorColor[0]);
            const cursorG = rgbaComponentToU8(cursorColor[1]);
            const cursorB = rgbaComponentToU8(cursorColor[2]);

            ansi.ANSI.cursorColorOutputWriter(writer, cursorR, cursorG, cursorB) catch {};
            writer.writeAll(cursorStyleCode) catch {};
            ansi.ANSI.moveToOutput(writer, cursorPos.x, cursorPos.y + self.renderOffset) catch {};
            writer.writeAll(ansi.ANSI.showCursor) catch {};
        } else {
            writer.writeAll(ansi.ANSI.hideCursor) catch {};
        }

        const renderEndTime = std.time.microTimestamp();
        const renderTime = @as(f64, @floatFromInt(renderEndTime - renderStartTime));

        self.renderStats.cellsUpdated = cellsUpdated;
        self.renderStats.renderTime = renderTime;

        self.nextRenderBuffer.clear(.{ self.backgroundColor[0], self.backgroundColor[1], self.backgroundColor[2], self.backgroundColor[3] }, null) catch {};

        const temp = self.currentHitGrid;
        self.currentHitGrid = self.nextHitGrid;
        self.nextHitGrid = temp;
        @memset(self.nextHitGrid, 0);
    }

    pub fn setDebugOverlay(self: *CliRenderer, enabled: bool, corner: DebugOverlayCorner) void {
        self.debugOverlay.enabled = enabled;
        self.debugOverlay.corner = corner;
    }

    pub fn clearTerminal(self: *CliRenderer) void {
        var bufferedWriter = &self.stdoutWriter;
        bufferedWriter.writer().writeAll(ansi.ANSI.clearAndHome) catch {};
        bufferedWriter.flush() catch {};
    }

    pub fn addToHitGrid(self: *CliRenderer, x: i32, y: i32, width: u32, height: u32, id: u32) void {
        const startX = @max(0, x);
        const startY = @max(0, y);
        const endX = @min(@as(i32, @intCast(self.hitGridWidth)), x + @as(i32, @intCast(width)));
        const endY = @min(@as(i32, @intCast(self.hitGridHeight)), y + @as(i32, @intCast(height)));

        if (startX >= endX or startY >= endY) return;

        const uStartX: u32 = @intCast(startX);
        const uStartY: u32 = @intCast(startY);
        const uEndX: u32 = @intCast(endX);
        const uEndY: u32 = @intCast(endY);

        for (uStartY..uEndY) |row| {
            const rowStart = row * self.hitGridWidth;
            const startIdx = rowStart + uStartX;
            const endIdx = rowStart + uEndX;

            @memset(self.nextHitGrid[startIdx..endIdx], id);
        }
    }

    pub fn checkHit(self: *CliRenderer, x: u32, y: u32) u32 {
        if (x >= self.hitGridWidth or y >= self.hitGridHeight) {
            return 0;
        }

        const index = y * self.hitGridWidth + x;
        return self.currentHitGrid[index];
    }

    pub fn dumpHitGrid(self: *CliRenderer) void {
        const timestamp = std.time.timestamp();
        var filename_buf: [64]u8 = undefined;
        const filename = std.fmt.bufPrint(&filename_buf, "hitgrid_{d}.txt", .{timestamp}) catch return;

        const file = std.fs.cwd().createFile(filename, .{}) catch return;
        defer file.close();

        const writer = file.writer();

        for (0..self.hitGridHeight) |y| {
            for (0..self.hitGridWidth) |x| {
                const index = y * self.hitGridWidth + x;
                const id = self.currentHitGrid[index];

                const char = if (id == 0) '.' else ('0' + @as(u8, @intCast(id % 10)));
                writer.writeByte(char) catch return;
            }
            writer.writeByte('\n') catch return;
        }
    }

    fn dumpSingleBuffer(self: *CliRenderer, buffer: *OptimizedBuffer, buffer_name: []const u8, timestamp: i64) void {
        std.fs.cwd().makeDir("buffer_dump") catch |err| switch (err) {
            error.PathAlreadyExists => {},
            else => return,
        };

        var filename_buf: [128]u8 = undefined;
        const filename = std.fmt.bufPrint(&filename_buf, "buffer_dump/{s}_buffer_{d}.txt", .{ buffer_name, timestamp }) catch return;

        const file = std.fs.cwd().createFile(filename, .{}) catch return;
        defer file.close();

        const writer = file.writer();

        writer.print("{s} Buffer ({d}x{d}):\n", .{ buffer_name, self.width, self.height }) catch return;
        writer.writeAll("Characters:\n") catch return;

        for (0..self.height) |y| {
            for (0..self.width) |x| {
                const cell = buffer.get(@intCast(x), @intCast(y));
                if (cell) |c| {
                    if (gp.isContinuationChar(c.char)) {
                        // skip
                    } else if (gp.isGraphemeChar(c.char)) {
                        const gid: u32 = gp.graphemeIdFromChar(c.char);
                        const bytes = self.pool.get(gid) catch &[_]u8{};
                        if (bytes.len > 0) writer.writeAll(bytes) catch return;
                    } else {
                        var utf8Buf: [4]u8 = undefined;
                        const len = std.unicode.utf8Encode(@intCast(c.char), &utf8Buf) catch 1;
                        writer.writeAll(utf8Buf[0..len]) catch return;
                    }
                } else {
                    writer.writeByte(' ') catch return;
                }
            }
            writer.writeByte('\n') catch return;
        }
    }

    pub fn dumpStdoutBuffer(self: *CliRenderer, timestamp: i64) void {
        _ = self;
        std.fs.cwd().makeDir("buffer_dump") catch |err| switch (err) {
            error.PathAlreadyExists => {},
            else => return,
        };

        var filename_buf: [128]u8 = undefined;
        const filename = std.fmt.bufPrint(&filename_buf, "buffer_dump/stdout_buffer_{d}.txt", .{timestamp}) catch return;

        const file = std.fs.cwd().createFile(filename, .{}) catch return;
        defer file.close();

        const writer = file.writer();

        writer.print("Stdout Buffer Output (timestamp: {d}):\n", .{timestamp}) catch return;
        writer.writeAll("Last Rendered ANSI Output:\n") catch return;
        writer.writeAll("================\n") catch return;

        const lastBuffer = if (activeBuffer == .A) &outputBufferB else &outputBuffer;
        const lastLen = if (activeBuffer == .A) outputBufferBLen else outputBufferLen;

        if (lastLen > 0) {
            writer.writeAll(lastBuffer.*[0..lastLen]) catch return;
        } else {
            writer.writeAll("(no output rendered yet)\n") catch return;
        }

        writer.writeAll("\n================\n") catch return;
        writer.print("Buffer size: {d} bytes\n", .{lastLen}) catch return;
        writer.print("Active buffer: {s}\n", .{if (activeBuffer == .A) "A" else "B"}) catch return;
    }

    pub fn dumpBuffers(self: *CliRenderer, timestamp: i64) void {
        self.dumpSingleBuffer(self.currentRenderBuffer, "current", timestamp);
        self.dumpSingleBuffer(self.nextRenderBuffer, "next", timestamp);
        self.dumpStdoutBuffer(timestamp);
    }

    pub fn enableMouse(self: *CliRenderer, enableMovement: bool) void {
        _ = enableMovement; // TODO: Use this to control motion tracking levels
        var bufferedWriter = &self.stdoutWriter;
        const writer = bufferedWriter.writer();

        self.terminal.setMouseMode(writer, true) catch {};

        bufferedWriter.flush() catch {};
    }

    pub fn queryPixelResolution(self: *CliRenderer) void {
        var bufferedWriter = &self.stdoutWriter;
        const writer = bufferedWriter.writer();

        writer.writeAll(ansi.ANSI.queryPixelSize) catch {};

        bufferedWriter.flush() catch {};
    }

    pub fn disableMouse(self: *CliRenderer) void {
        var bufferedWriter = &self.stdoutWriter;
        const writer = bufferedWriter.writer();

        self.terminal.setMouseMode(writer, false) catch {};

        bufferedWriter.flush() catch {};
    }

    pub fn enableKittyKeyboard(self: *CliRenderer, flags: u8) void {
        var bufferedWriter = &self.stdoutWriter;
        const writer = bufferedWriter.writer();

        self.terminal.setKittyKeyboard(writer, true, flags) catch {};
        bufferedWriter.flush() catch {};
    }

    pub fn disableKittyKeyboard(self: *CliRenderer) void {
        var bufferedWriter = &self.stdoutWriter;
        const writer = bufferedWriter.writer();

        self.terminal.setKittyKeyboard(writer, false, 0) catch {};
        bufferedWriter.flush() catch {};
    }

    pub fn getTerminalCapabilities(self: *CliRenderer) Terminal.Capabilities {
        return self.terminal.getCapabilities();
    }

    pub fn processCapabilityResponse(self: *CliRenderer, response: []const u8) void {
        self.terminal.processCapabilityResponse(response);
        const writer = self.stdoutWriter.writer();
        self.terminal.enableDetectedFeatures(writer, self.useKittyKeyboard) catch {};
    }

    pub fn setCursorPosition(self: *CliRenderer, x: u32, y: u32, visible: bool) void {
        self.terminal.setCursorPosition(x, y, visible);
    }

    pub fn setCursorStyle(self: *CliRenderer, style: Terminal.CursorStyle, blinking: bool) void {
        self.terminal.setCursorStyle(style, blinking);
    }

    pub fn setCursorColor(self: *CliRenderer, color: [4]f32) void {
        self.terminal.setCursorColor(color);
    }

    pub fn setUseKittyKeyboard(self: *CliRenderer, use: bool) void {
        self.useKittyKeyboard = use;
    }

    pub fn getUseKittyKeyboard(self: *CliRenderer) bool {
        return self.useKittyKeyboard;
    }

    fn renderDebugOverlay(self: *CliRenderer) void {
        if (!self.debugOverlay.enabled) return;

        const width: u32 = 40;
        const height: u32 = 11;
        var x: u32 = 0;
        var y: u32 = 0;

        if (self.width < width + 2 or self.height < height + 2) return;

        switch (self.debugOverlay.corner) {
            .topLeft => {
                x = 1;
                y = 1;
            },
            .topRight => {
                x = self.width - width - 1;
                y = 1;
            },
            .bottomLeft => {
                x = 1;
                y = self.height - height - 1;
            },
            .bottomRight => {
                x = self.width - width - 1;
                y = self.height - height - 1;
            },
        }

        self.nextRenderBuffer.fillRect(x, y, width, height, .{ 20.0 / 255.0, 20.0 / 255.0, 40.0 / 255.0, 1.0 }) catch {};
        self.nextRenderBuffer.drawText("Debug Information", x + 1, y + 1, .{ 1.0, 1.0, 100.0 / 255.0, 1.0 }, .{ 0.0, 0.0, 0.0, 0.0 }, ansi.TextAttributes.BOLD) catch {};

        var row: u32 = 2;
        const bg: RGBA = .{ 0.0, 0.0, 0.0, 0.0 };
        const fg: RGBA = .{ 200.0 / 255.0, 200.0 / 255.0, 200.0 / 255.0, 1.0 };

        // Calculate averages
        const lastFrameTimeAvg = getStatAverage(f64, &self.statSamples.lastFrameTime);
        const renderTimeAvg = getStatAverage(f64, &self.statSamples.renderTime);
        const overallFrameTimeAvg = getStatAverage(f64, &self.statSamples.overallFrameTime);
        const bufferResetTimeAvg = getStatAverage(f64, &self.statSamples.bufferResetTime);
        const stdoutWriteTimeAvg = getStatAverage(f64, &self.statSamples.stdoutWriteTime);
        const cellsUpdatedAvg = getStatAverage(u32, &self.statSamples.cellsUpdated);
        const frameCallbackTimeAvg = getStatAverage(f64, &self.statSamples.frameCallbackTime);

        // FPS
        var fpsText: [32]u8 = undefined;
        const fpsLen = std.fmt.bufPrint(&fpsText, "FPS: {d}", .{self.renderStats.fps}) catch return;
        self.nextRenderBuffer.drawText(fpsLen, x + 1, y + row, fg, bg, 0) catch {};
        row += 1;

        // Frame Time
        var frameTimeText: [64]u8 = undefined;
        const frameTimeLen = std.fmt.bufPrint(&frameTimeText, "Frame: {d:.3}ms (avg: {d:.3}ms)", .{ self.renderStats.lastFrameTime / 1000.0, lastFrameTimeAvg / 1000.0 }) catch return;
        self.nextRenderBuffer.drawText(frameTimeLen, x + 1, y + row, fg, bg, 0) catch {};
        row += 1;

        // Frame Callback Time
        if (self.renderStats.frameCallbackTime) |frameCallbackTime| {
            var frameCallbackTimeText: [64]u8 = undefined;
            const frameCallbackTimeLen = std.fmt.bufPrint(&frameCallbackTimeText, "Frame Callback: {d:.3}ms (avg: {d:.3}ms)", .{ frameCallbackTime, frameCallbackTimeAvg }) catch return;
            self.nextRenderBuffer.drawText(frameCallbackTimeLen, x + 1, y + row, fg, bg, 0) catch {};
            row += 1;
        }

        // Overall Time
        if (self.renderStats.overallFrameTime) |overallTime| {
            var overallTimeText: [64]u8 = undefined;
            const overallTimeLen = std.fmt.bufPrint(&overallTimeText, "Overall: {d:.3}ms (avg: {d:.3}ms)", .{ overallTime, overallFrameTimeAvg }) catch return;
            self.nextRenderBuffer.drawText(overallTimeLen, x + 1, y + row, fg, bg, 0) catch {};
            row += 1;
        }

        // Render Time
        if (self.renderStats.renderTime) |renderTime| {
            var renderTimeText: [64]u8 = undefined;
            const renderTimeLen = std.fmt.bufPrint(&renderTimeText, "Render: {d:.3}ms (avg: {d:.3}ms)", .{ renderTime / 1000.0, renderTimeAvg / 1000.0 }) catch return;
            self.nextRenderBuffer.drawText(renderTimeLen, x + 1, y + row, fg, bg, 0) catch {};
            row += 1;
        }

        // Buffer Reset Time
        if (self.renderStats.bufferResetTime) |resetTime| {
            var resetTimeText: [64]u8 = undefined;
            const resetTimeLen = std.fmt.bufPrint(&resetTimeText, "Reset: {d:.3}ms (avg: {d:.3}ms)", .{ resetTime / 1000.0, bufferResetTimeAvg / 1000.0 }) catch return;
            self.nextRenderBuffer.drawText(resetTimeLen, x + 1, y + row, fg, bg, 0) catch {};
            row += 1;
        }

        // Stdout Write Time
        if (self.renderStats.stdoutWriteTime) |writeTime| {
            var writeTimeText: [64]u8 = undefined;
            const writeTimeLen = std.fmt.bufPrint(&writeTimeText, "Stdout: {d:.3}ms (avg: {d:.3}ms)", .{ writeTime / 1000.0, stdoutWriteTimeAvg / 1000.0 }) catch return;
            self.nextRenderBuffer.drawText(writeTimeLen, x + 1, y + row, fg, bg, 0) catch {};
            row += 1;
        }

        // Cells Updated
        var cellsText: [64]u8 = undefined;
        const cellsLen = std.fmt.bufPrint(&cellsText, "Cells: {d} (avg: {d})", .{ self.renderStats.cellsUpdated, cellsUpdatedAvg }) catch return;
        self.nextRenderBuffer.drawText(cellsLen, x + 1, y + row, fg, bg, 0) catch {};
        row += 1;

        if (self.renderStats.heapUsed > 0 or self.renderStats.heapTotal > 0) {
            var memoryText: [64]u8 = undefined;
            const memoryLen = std.fmt.bufPrint(&memoryText, "Memory: {d:.2}MB / {d:.2}MB / {d:.2}MB", .{ @as(f64, @floatFromInt(self.renderStats.heapUsed)) / 1024.0 / 1024.0, @as(f64, @floatFromInt(self.renderStats.heapTotal)) / 1024.0 / 1024.0, @as(f64, @floatFromInt(self.renderStats.arrayBuffers)) / 1024.0 / 1024.0 }) catch return;
            self.nextRenderBuffer.drawText(memoryLen, x + 1, y + row, fg, bg, 0) catch {};
            row += 1;
        }

        // Is threaded?
        var isThreadedText: [64]u8 = undefined;
        const isThreadedLen = std.fmt.bufPrint(&isThreadedText, "Threaded: {s}", .{if (self.useThread) "Yes" else "No"}) catch return;
        self.nextRenderBuffer.drawText(isThreadedLen, x + 1, y + row, fg, bg, 0) catch {};
        row += 1;
    }
};
