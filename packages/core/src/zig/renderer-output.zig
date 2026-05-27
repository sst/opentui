//! Output transport backends for `CliRenderer`.
//!
//! The renderer's render path writes ANSI bytes into an abstract writer
//! supplied by an `OutputBackend`. Two variants are available:
//!
//!   - `StdoutBackend`: writes directly to `process.stdout` with optional
//!     background-thread handoff for I/O latency hiding.
//!
//!   - `FeedBackend`: writes into a `NativeSpanFeed.Stream` whose chunks are
//!     consumed from TypeScript and piped to a user-supplied Writable
//!     (typically an SSH channel).
//!
//! The backend is a tagged union. `CliRenderer.render` performs exactly one
//! `switch` on the backend using `inline else` to pick the right variant's
//! writer type at compile time — keeping the render path generic over the
//! writer without scattering backend-specific switches across the codebase.

const std = @import("std");
const Allocator = std.mem.Allocator;
const ansi = @import("ansi.zig");
const NativeSpanFeed = @import("native-span-feed.zig");

pub const OUTPUT_BUFFER_SIZE = 1024 * 1024 * 2; // 2 MiB, double-buffered per StdoutBackend for thread handoff

/// Tagged union dispatching to StdoutBackend or FeedBackend.
pub const OutputBackend = union(enum) {
    stdout: StdoutBackend,
    feed: FeedBackend,

    /// Synchronously emit a pre-built byte sequence (setup/shutdown/query).
    pub fn writeOut(self: *OutputBackend, data: []const u8) void {
        switch (self.*) {
            inline else => |*b| b.writeOut(data),
        }
    }

    /// Synchronously emit multiple pre-built byte sequences.
    pub fn writeOutMultiple(self: *OutputBackend, data_slices: []const []const u8) void {
        switch (self.*) {
            inline else => |*b| b.writeOutMultiple(data_slices),
        }
    }

    /// Return true if the frame should be skipped (e.g. backpressure).
    /// Callers preserve catch-up semantics by not updating `lastRenderTime`
    /// when this returns true.
    pub fn shouldSkipFrame(self: *OutputBackend) bool {
        switch (self.*) {
            inline else => |*b| return b.shouldSkipFrame(),
        }
    }

    pub fn supportsThreading(self: *OutputBackend) bool {
        switch (self.*) {
            inline else => |*b| return b.supportsThreading(),
        }
    }

    pub fn setUseThread(self: *OutputBackend, use_thread: bool) void {
        switch (self.*) {
            inline else => |*b| b.setUseThread(use_thread),
        }
    }

    pub fn isUseThread(self: *OutputBackend) bool {
        switch (self.*) {
            inline else => |*b| return b.isUseThread(),
        }
    }

    /// Backend-specific behavior that runs after the shutdown ANSI sequence
    /// has been written (e.g. stdout's cursor-reshow sleep workaround).
    pub fn performShutdownExtras(self: *OutputBackend) void {
        switch (self.*) {
            inline else => |*b| b.performShutdownExtras(),
        }
    }

    /// Return the most recently rendered frame's output bytes, for testing.
    /// Only meaningful for the stdout backend; feed-backed callers should
    /// drain bytes via the NativeSpanFeed directly.
    pub fn getLastOutputForTest(self: *OutputBackend) []const u8 {
        switch (self.*) {
            .stdout => |*sb| return sb.getLastOutputForTest(),
            .feed => return &.{},
        }
    }

    /// Microseconds spent on the last write (populated after endFrame).
    pub fn getLastWriteTimeUs(self: *OutputBackend) ?f64 {
        switch (self.*) {
            inline else => |*b| return b.lastWriteTimeUs,
        }
    }

    /// Write a backend-specific debug dump into `out`. Called from the
    /// `dumpOutputBuffer` helper on `CliRenderer`; keeps backend-specific
    /// formatting internal so the renderer never switches on the tag.
    pub fn dumpTo(self: *OutputBackend, out: anytype) void {
        switch (self.*) {
            inline else => |*b| b.dumpTo(out),
        }
    }

    pub fn deinit(self: *OutputBackend, allocator: Allocator) void {
        switch (self.*) {
            inline else => |*b| b.deinit(allocator),
        }
    }
};

/// Backend that writes directly to `process.stdout` via `std.fs.File.stdout()`.
///
/// Owns all state that was previously scattered across `CliRenderer`:
///   - Double-buffered per-instance output arrays (`instanceOutputA/B`)
///   - The active-buffer enum (was a file-scope static, now per-instance)
///   - Render thread handle + mutex + condition + flags
///   - The small stdout writer buffer
///
/// The per-instance buffers fix a correctness issue with the pre-existing
/// file-scope static buffers: multiple concurrent renderers would clobber each
/// other's output. This makes per-process multi-renderer scenarios safe.
pub const StdoutBackend = struct {
    const BufferId = enum { A, B };

    // Per-instance (was file-scope pre-refactor).
    instanceOutputA: []u8,
    instanceOutputB: []u8,
    instanceOutputLenA: usize = 0,
    instanceOutputLenB: usize = 0,
    instanceActiveBuffer: BufferId = .A,
    lastCommittedBuffer: BufferId = .A,
    hasCommittedFrame: bool = false,

    stdoutBuffer: [4096]u8 = undefined,

    useThread: bool = false,
    renderThread: ?std.Thread = null,
    renderMutex: std.Thread.Mutex = .{},
    renderCondition: std.Thread.Condition = .{},
    renderRequested: bool = false,
    shouldTerminate: bool = false,
    renderInProgress: bool = false,

    // Handoff buffer for the render thread
    currentOutputBuffer: []u8 = &[_]u8{},
    currentOutputLen: usize = 0,

    // Testing mode short-circuits I/O while still filling instance buffers so
    // `getLastOutputForTest` can return the rendered ANSI.
    testing: bool,

    lastWriteTimeUs: ?f64 = null,

    pub fn create(allocator: Allocator, testing: bool) !StdoutBackend {
        const a_buf = try allocator.alloc(u8, OUTPUT_BUFFER_SIZE);
        errdefer allocator.free(a_buf);
        const b_buf = try allocator.alloc(u8, OUTPUT_BUFFER_SIZE);
        errdefer allocator.free(b_buf);

        return StdoutBackend{
            .instanceOutputA = a_buf,
            .instanceOutputB = b_buf,
            .testing = testing,
        };
    }

    pub fn deinit(self: *StdoutBackend, allocator: Allocator) void {
        if (self.renderThread) |thread| {
            self.renderMutex.lock();
            while (self.renderInProgress) {
                self.renderCondition.wait(&self.renderMutex);
            }
            self.shouldTerminate = true;
            // Do NOT set renderRequested — the thread should wake, see
            // shouldTerminate, and exit without a final spurious write of
            // the stale last-frame buffer. Previously setting renderRequested
            // here caused a stale frame to be emitted AFTER the shutdown
            // ANSI sequence had already restored the terminal.
            self.renderCondition.signal();
            self.renderMutex.unlock();
            thread.join();
            self.renderThread = null;
        }

        allocator.free(self.instanceOutputA);
        allocator.free(self.instanceOutputB);
    }

    pub fn shouldSkipFrame(_: *StdoutBackend) bool {
        return false;
    }

    pub fn supportsThreading(_: *StdoutBackend) bool {
        return true;
    }

    pub fn isUseThread(self: *StdoutBackend) bool {
        return self.useThread;
    }

    pub fn setUseThread(self: *StdoutBackend, use_thread: bool) void {
        if (self.useThread == use_thread) return;

        if (use_thread) {
            if (self.renderThread == null) {
                self.renderThread = std.Thread.spawn(.{}, renderThreadFn, .{self}) catch |err| {
                    std.log.warn("Failed to spawn render thread: {}, falling back to non-threaded mode", .{err});
                    self.useThread = false;
                    return;
                };
            }
        } else {
            if (self.renderThread) |thread| {
                self.renderMutex.lock();
                while (self.renderInProgress) {
                    self.renderCondition.wait(&self.renderMutex);
                }
                self.shouldTerminate = true;
                // Wake the thread with a terminate-only signal; do not set
                // renderRequested (that would replay the stale buffer).
                self.renderCondition.signal();
                self.renderMutex.unlock();

                thread.join();
                self.renderThread = null;
                self.shouldTerminate = false;
                // Reset request/progress flags so a future setUseThread(true)
                // does not wake on a stale request.
                self.renderRequested = false;
                self.renderInProgress = false;
            }
        }

        self.useThread = use_thread;
    }

    /// Frame-time writer context. A pointer to the backend so writes know
    /// which active buffer to append to.
    pub const WriterCtx = struct {
        backend: *StdoutBackend,
    };

    pub const Writer = std.io.GenericWriter(WriterCtx, error{BufferFull}, bufferWrite);

    fn bufferWrite(ctx: WriterCtx, data: []const u8) error{BufferFull}!usize {
        const self = ctx.backend;
        const bufferLen = if (self.instanceActiveBuffer == .A)
            &self.instanceOutputLenA
        else
            &self.instanceOutputLenB;
        const buffer = if (self.instanceActiveBuffer == .A)
            self.instanceOutputA
        else
            self.instanceOutputB;

        if (bufferLen.* + data.len > buffer.len) {
            return error.BufferFull;
        }

        @memcpy(buffer[bufferLen.*..][0..data.len], data);
        bufferLen.* += data.len;
        return data.len;
    }

    // TODO: std.io.GenericWriter is deprecated but the replacement is much more involved.
    // Migrate when the ecosystem stabilizes.
    pub fn writer(self: *StdoutBackend) Writer {
        return .{ .context = .{ .backend = self } };
    }

    pub fn beginFrame(self: *StdoutBackend) void {
        if (self.instanceActiveBuffer == .A) {
            self.instanceOutputLenA = 0;
        } else {
            self.instanceOutputLenB = 0;
        }
    }

    pub fn endFrame(self: *StdoutBackend) void {
        const writeStart = std.time.microTimestamp();
        const committed_buffer = self.instanceActiveBuffer;

        if (self.useThread) {
            self.renderMutex.lock();
            while (self.renderInProgress) {
                self.renderCondition.wait(&self.renderMutex);
            }

            // Hand off the just-written buffer to the render thread and flip
            // active to the other one for the next frame.
            if (self.instanceActiveBuffer == .A) {
                self.instanceActiveBuffer = .B;
                self.currentOutputBuffer = self.instanceOutputA;
                self.currentOutputLen = self.instanceOutputLenA;
            } else {
                self.instanceActiveBuffer = .A;
                self.currentOutputBuffer = self.instanceOutputB;
                self.currentOutputLen = self.instanceOutputLenB;
            }

            self.renderRequested = true;
            self.renderInProgress = true;
            self.renderCondition.signal();
            self.renderMutex.unlock();
        } else {
            if (!self.testing) {
                var stdoutWriter = std.fs.File.stdout().writer(&self.stdoutBuffer);
                const w = &stdoutWriter.interface;
                const to_write = if (self.instanceActiveBuffer == .A)
                    self.instanceOutputA[0..self.instanceOutputLenA]
                else
                    self.instanceOutputB[0..self.instanceOutputLenB];
                w.writeAll(to_write) catch {};
                w.flush() catch {};
            }
            self.lastWriteTimeUs = @as(f64, @floatFromInt(std.time.microTimestamp() - writeStart));
        }

        self.lastCommittedBuffer = committed_buffer;
        self.hasCommittedFrame = true;
    }

    fn renderThreadFn(self: *StdoutBackend) void {
        while (true) {
            self.renderMutex.lock();
            while (!self.renderRequested and !self.shouldTerminate) {
                self.renderCondition.wait(&self.renderMutex);
            }

            // Terminate wins: when shouldTerminate is set, exit without
            // writing even if a render was also requested. This keeps
            // shutdown-ANSI the last thing on the wire.
            if (self.shouldTerminate) {
                self.renderMutex.unlock();
                break;
            }

            self.renderRequested = false;

            const outputData = self.currentOutputBuffer;
            const outputLen = self.currentOutputLen;

            const writeStart = std.time.microTimestamp();

            if (outputLen > 0 and !self.testing) {
                var stdoutWriter = std.fs.File.stdout().writer(&self.stdoutBuffer);
                const w = &stdoutWriter.interface;
                w.writeAll(outputData[0..outputLen]) catch {};
                w.flush() catch {};
            }

            self.lastWriteTimeUs = @as(f64, @floatFromInt(std.time.microTimestamp() - writeStart));
            self.renderInProgress = false;
            self.renderCondition.signal();
            self.renderMutex.unlock();
        }
    }

    pub fn writeOut(self: *StdoutBackend, data: []const u8) void {
        if (data.len == 0) return;
        if (self.testing) return;

        if (self.useThread) {
            self.renderMutex.lock();
            while (self.renderInProgress) {
                self.renderCondition.wait(&self.renderMutex);
            }
            self.renderMutex.unlock();
        }

        var stdoutWriter = std.fs.File.stdout().writer(&self.stdoutBuffer);
        const w = &stdoutWriter.interface;
        w.writeAll(data) catch {};
        w.flush() catch {};
    }

    pub fn writeOutMultiple(self: *StdoutBackend, data_slices: []const []const u8) void {
        if (self.testing) return;

        if (self.useThread) {
            self.renderMutex.lock();
            while (self.renderInProgress) {
                self.renderCondition.wait(&self.renderMutex);
            }
            self.renderMutex.unlock();
        }

        var totalLen: usize = 0;
        for (data_slices) |slice| {
            totalLen += slice.len;
        }
        if (totalLen == 0) return;

        var stdoutWriter = std.fs.File.stdout().writer(&self.stdoutBuffer);
        const w = &stdoutWriter.interface;
        for (data_slices) |slice| {
            w.writeAll(slice) catch {};
        }
        w.flush() catch {};
    }

    /// Sleep + re-emit showCursor. Workaround for Ghostty not showing the cursor
    /// after shutdown. Stdout-specific; remote clients handle their own cursor.
    ///
    /// In testing mode, skip both the sleep and the emit — tests don't observe
    /// the terminal, so paying ~20 ms per destroy is pure overhead.
    pub fn performShutdownExtras(self: *StdoutBackend) void {
        if (self.testing) return;

        std.Thread.sleep(10 * std.time.ns_per_ms);

        var stdoutWriter = std.fs.File.stdout().writer(&self.stdoutBuffer);
        const w = &stdoutWriter.interface;
        w.writeAll(ansi.ANSI.showCursor) catch {};
        w.flush() catch {};

        std.Thread.sleep(10 * std.time.ns_per_ms);
    }

    /// Return the most recently committed instance buffer's rendered output.
    pub fn getLastOutputForTest(self: *StdoutBackend) []const u8 {
        if (!self.hasCommittedFrame) return &.{};

        const buffer = if (self.lastCommittedBuffer == .A) self.instanceOutputA else self.instanceOutputB;
        const len = if (self.lastCommittedBuffer == .A) self.instanceOutputLenA else self.instanceOutputLenB;
        return buffer[0..len];
    }

    /// Write a debug dump of the last rendered output into `out`. The
    /// committed-buffer marker is explicit because non-threaded rendering does
    /// not flip the active buffer after each frame.
    pub fn dumpTo(self: *StdoutBackend, out: anytype) void {
        const last = if (self.hasCommittedFrame) blk: {
            const buf = if (self.lastCommittedBuffer == .A) self.instanceOutputA else self.instanceOutputB;
            const len = if (self.lastCommittedBuffer == .A) self.instanceOutputLenA else self.instanceOutputLenB;
            break :blk buf[0..len];
        } else &.{};

        if (last.len > 0) {
            out.writeAll(last) catch return;
        } else {
            out.writeAll("(no output rendered yet)\n") catch return;
        }
        out.writeAll("\n================\n") catch return;
        out.print("Buffer size: {d} bytes\n", .{last.len}) catch return;
        const active_label: []const u8 = if (self.instanceActiveBuffer == .A) "A" else "B";
        const committed_label: []const u8 = if (self.lastCommittedBuffer == .A) "A" else "B";
        out.print("Active buffer: {s}\n", .{active_label}) catch return;
        out.print("Last committed buffer: {s}\n", .{committed_label}) catch return;
    }
};

/// Backend that writes to a `NativeSpanFeed.Stream`. The feed owns its own
/// chunk memory; we hold only a non-owning pointer. The TypeScript side is
/// responsible for allocating and destroying the feed; this backend simply
/// writes into it and commits on frame boundaries.
///
/// Feed writes are in-memory ring-buffer ops with no I/O, so threading adds
/// synchronization cost without latency-hiding benefit. Backpressure is
/// exposed via `shouldSkipFrame`: when the span queue is saturated, frames
/// are skipped at the render loop with catch-up semantics preserved.
///
/// FeedBackend does not honor a `testing` flag: the TypeScript side allocates
/// a feed only when `!config.testing`, so this backend is never constructed
/// in tests of the renderer pipeline. Zig tests that want to exercise the
/// feed path should drain the feed directly.
pub const FeedBackend = struct {
    feed: *NativeSpanFeed.Stream,

    /// Set when a frame's write to the feed fails. Suppresses the tail commit
    /// in `endFrame`; uncommitted pending bytes are discarded immediately so a
    /// later successful frame cannot commit stale data from the failed frame.
    /// Note: if `Stream.write` auto-committed intermediate chunks mid-frame
    /// (auto_commit_on_full=true), those bytes have already escaped to the span
    /// ring and cannot be recalled here.
    frameWriteFailed: bool = false,

    lastWriteTimeUs: ?f64 = null,

    pub fn create(feed: *NativeSpanFeed.Stream) FeedBackend {
        return FeedBackend{ .feed = feed };
    }

    pub fn deinit(_: *FeedBackend, _: Allocator) void {
        // Feed memory is owned by the TypeScript side. Nothing to free here.
    }

    pub fn shouldSkipFrame(self: *FeedBackend) bool {
        const stats = self.feed.getStats();
        const cap = self.feed.options.span_queue_capacity;
        return cap > 0 and stats.pending_spans >= cap;
    }

    pub fn supportsThreading(_: *FeedBackend) bool {
        return false;
    }

    pub fn setUseThread(_: *FeedBackend, _: bool) void {
        // No-op: feed writes don't benefit from threading.
    }

    pub fn isUseThread(_: *FeedBackend) bool {
        return false;
    }

    pub const WriterCtx = struct {
        backend: *FeedBackend,
    };

    pub const Writer = std.io.GenericWriter(WriterCtx, error{BufferFull}, frameWrite);

    fn frameWrite(ctx: WriterCtx, data: []const u8) error{BufferFull}!usize {
        const self = ctx.backend;
        self.feed.write(data) catch {
            self.frameWriteFailed = true;
            self.feed.discardPending();
            return error.BufferFull;
        };
        return data.len;
    }

    pub fn writer(self: *FeedBackend) Writer {
        return .{ .context = .{ .backend = self } };
    }

    pub fn beginFrame(self: *FeedBackend) void {
        self.feed.discardPending();
        self.frameWriteFailed = false;
    }

    pub fn endFrame(self: *FeedBackend) void {
        const writeStart = std.time.microTimestamp();

        if (self.frameWriteFailed) {
            self.feed.discardPending();
        } else {
            self.feed.commit() catch {
                self.feed.discardPending();
            };
        }

        self.lastWriteTimeUs = @as(f64, @floatFromInt(std.time.microTimestamp() - writeStart));
    }

    pub fn writeOut(self: *FeedBackend, data: []const u8) void {
        if (data.len == 0) return;
        self.feed.write(data) catch {
            self.feed.discardPending();
            return;
        };
        self.feed.commit() catch {
            self.feed.discardPending();
        };
    }

    pub fn writeOutMultiple(self: *FeedBackend, data_slices: []const []const u8) void {
        var totalLen: usize = 0;
        for (data_slices) |slice| totalLen += slice.len;
        if (totalLen == 0) return;

        var wrote_any = false;
        for (data_slices) |slice| {
            self.feed.write(slice) catch {
                self.feed.discardPending();
                return;
            };
            wrote_any = true;
        }
        if (wrote_any) self.feed.commit() catch {
            self.feed.discardPending();
        };
    }

    pub fn performShutdownExtras(_: *FeedBackend) void {}

    /// Write a debug dump placeholder. FeedBackend has no flat previous-frame
    /// slice — callers wanting feed bytes should drain the NativeSpanFeed.
    pub fn dumpTo(_: *FeedBackend, out: anytype) void {
        out.writeAll("(feed backend — drain spans from the NativeSpanFeed for output)\n") catch return;
        out.writeAll("\n================\n") catch return;
    }
};
