const std = @import("std");
const Allocator = std.mem.Allocator;
const buffer = @import("buffer.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");
const gp = @import("grapheme.zig");
const gwidth = @import("gwidth.zig");

pub const RGBA = buffer.RGBA;
pub const TextSelection = buffer.TextSelection;

pub const USE_DEFAULT_FG: u16 = 0x8000;
pub const USE_DEFAULT_BG: u16 = 0x4000;
pub const USE_DEFAULT_ATTR: u16 = 0x2000;
pub const ATTR_MASK: u16 = 0x00FF;

pub const TextBufferError = error{
    OutOfMemory,
    InvalidDimensions,
    InvalidIndex,
};

/// TextBuffer holds packed arrays for styled text fragments
/// Similar to OptimizedBuffer but specifically for text fragments
pub const TextBuffer = struct {
    char: []u32,
    fg: []RGBA,
    bg: []RGBA,
    attributes: []u16,
    length: u32,
    cursor: u32,
    selection: ?TextSelection,
    default_fg: ?RGBA,
    default_bg: ?RGBA,
    default_attributes: ?u8,
    allocator: Allocator,

    line_starts: std.ArrayList(u32),
    line_widths: std.ArrayList(u32),
    current_line_width: u32,

    pool: *gp.GraphemePool,
    graphemes_data: Graphemes,
    display_width: DisplayWidth,
    grapheme_tracker: gp.GraphemeTracker,
    width_method: gwidth.WidthMethod,

    pub fn init(allocator: Allocator, length: u32, pool: *gp.GraphemePool, width_method: gwidth.WidthMethod) TextBufferError!*TextBuffer {
        if (length == 0) return TextBufferError.InvalidDimensions;

        const self = allocator.create(TextBuffer) catch return TextBufferError.OutOfMemory;
        errdefer allocator.destroy(self);

        const graph = Graphemes.init(allocator) catch return TextBufferError.OutOfMemory;
        errdefer graph.deinit(allocator);
        const dw = DisplayWidth.initWithGraphemes(allocator, graph) catch return TextBufferError.OutOfMemory;
        errdefer dw.deinit(allocator);

        self.* = .{
            .char = allocator.alloc(u32, length) catch return TextBufferError.OutOfMemory,
            .fg = allocator.alloc(RGBA, length) catch return TextBufferError.OutOfMemory,
            .bg = allocator.alloc(RGBA, length) catch return TextBufferError.OutOfMemory,
            .attributes = allocator.alloc(u16, length) catch return TextBufferError.OutOfMemory,
            .length = length,
            .cursor = 0,
            .selection = null,
            .default_fg = null,
            .default_bg = null,
            .default_attributes = null,
            .allocator = allocator,
            .line_starts = std.ArrayList(u32).init(allocator),
            .line_widths = std.ArrayList(u32).init(allocator),
            .current_line_width = 0,
            .pool = pool,
            .graphemes_data = graph,
            .display_width = dw,
            .grapheme_tracker = gp.GraphemeTracker.init(allocator, pool),
            .width_method = width_method,
        };

        @memset(self.char, ' ');
        @memset(self.fg, .{ 1.0, 1.0, 1.0, 1.0 });
        @memset(self.bg, .{ 0.0, 0.0, 0.0, 0.0 });
        @memset(self.attributes, 0);

        self.line_starts.append(0) catch return TextBufferError.OutOfMemory;

        return self;
    }

    pub fn deinit(self: *TextBuffer) void {
        self.grapheme_tracker.deinit();
        self.display_width.deinit(self.allocator);
        self.graphemes_data.deinit(self.allocator);
        self.allocator.free(self.char);
        self.allocator.free(self.fg);
        self.allocator.free(self.bg);
        self.allocator.free(self.attributes);
        self.line_starts.deinit();
        self.line_widths.deinit();
        self.allocator.destroy(self);
    }

    pub fn getCharPtr(self: *TextBuffer) [*]u32 {
        return self.char.ptr;
    }

    pub fn getFgPtr(self: *TextBuffer) [*]RGBA {
        return self.fg.ptr;
    }

    pub fn getBgPtr(self: *TextBuffer) [*]RGBA {
        return self.bg.ptr;
    }

    pub fn getAttributesPtr(self: *TextBuffer) [*]u16 {
        return self.attributes.ptr;
    }

    pub fn getLength(self: *const TextBuffer) u32 {
        return self.cursor;
    }

    pub fn getCapacity(self: *const TextBuffer) u32 {
        return self.length;
    }

    pub fn setCell(self: *TextBuffer, index: u32, char: u32, fg: RGBA, bg: RGBA, attr: u16) TextBufferError!void {
        if (index >= self.length) return TextBufferError.InvalidIndex;
        // If we are setting a grapheme start, expand continuations and track pool usage
        if (gp.isGraphemeChar(char)) {
            const right = gp.charRightExtent(char);
            // write start
            self.char[index] = char;
            self.fg[index] = fg;
            self.bg[index] = bg;
            self.attributes[index] = attr;

            const gid: u32 = gp.graphemeIdFromChar(char);
            self.grapheme_tracker.add(gid);

            var k: u32 = 1;
            while (k <= right and (index + k) < self.length) : (k += 1) {
                const cont = gp.packContinuation(k, right - k, gid);
                self.char[index + k] = cont;
                self.fg[index + k] = fg;
                self.bg[index + k] = bg;
                self.attributes[index + k] = attr;
            }
        } else {
            self.char[index] = char;
            self.fg[index] = fg;
            self.bg[index] = bg;
            self.attributes[index] = attr;
        }
    }

    /// Concatenate another TextBuffer to create a new combined buffer
    pub fn concat(self: *const TextBuffer, other: *const TextBuffer) TextBufferError!*TextBuffer {
        const newLength = self.cursor + other.cursor;
        const result = try init(self.allocator, newLength, self.pool, self.width_method);

        @memcpy(result.char[0..self.cursor], self.char[0..self.cursor]);
        @memcpy(result.fg[0..self.cursor], self.fg[0..self.cursor]);
        @memcpy(result.bg[0..self.cursor], self.bg[0..self.cursor]);
        @memcpy(result.attributes[0..self.cursor], self.attributes[0..self.cursor]);

        @memcpy(result.char[self.cursor .. self.cursor + other.cursor], other.char[0..other.cursor]);
        @memcpy(result.fg[self.cursor .. self.cursor + other.cursor], other.fg[0..other.cursor]);
        @memcpy(result.bg[self.cursor .. self.cursor + other.cursor], other.bg[0..other.cursor]);
        @memcpy(result.attributes[self.cursor .. self.cursor + other.cursor], other.attributes[0..other.cursor]);

        result.cursor = newLength;

        result.line_starts.clearRetainingCapacity();
        result.line_widths.clearRetainingCapacity();
        for (self.line_starts.items) |start| {
            result.line_starts.append(start) catch {};
        }
        for (self.line_widths.items) |width| {
            result.line_widths.append(width) catch {};
        }

        for (other.line_starts.items[1..]) |start| {
            result.line_starts.append(start + self.cursor) catch {};
        }
        for (other.line_widths.items) |width| {
            result.line_widths.append(width) catch {};
        }

        result.current_line_width = other.current_line_width;

        return result;
    }

    pub fn reset(self: *TextBuffer) void {
        self.grapheme_tracker.clear();
        self.cursor = 0;
        self.line_starts.clearRetainingCapacity();
        self.line_widths.clearRetainingCapacity();
        self.current_line_width = 0;
        self.line_starts.append(0) catch {};
    }

    pub fn setSelection(self: *TextBuffer, start: u32, end: u32, bgColor: ?RGBA, fgColor: ?RGBA) void {
        self.selection = TextSelection{
            .start = start,
            .end = end,
            .bgColor = bgColor,
            .fgColor = fgColor,
        };
    }

    pub fn resetSelection(self: *TextBuffer) void {
        self.selection = null;
    }

    pub fn setDefaultFg(self: *TextBuffer, fg: ?RGBA) void {
        self.default_fg = fg;
    }

    pub fn setDefaultBg(self: *TextBuffer, bg: ?RGBA) void {
        self.default_bg = bg;
    }

    pub fn setDefaultAttributes(self: *TextBuffer, attributes: ?u8) void {
        self.default_attributes = attributes;
    }

    pub fn resetDefaults(self: *TextBuffer) void {
        self.default_fg = null;
        self.default_bg = null;
        self.default_attributes = null;
    }

    pub fn resize(self: *TextBuffer, newLength: u32) TextBufferError!void {
        if (newLength == self.length) return;
        if (newLength == 0) return TextBufferError.InvalidDimensions;

        self.char = self.allocator.realloc(self.char, newLength) catch return TextBufferError.OutOfMemory;
        self.fg = self.allocator.realloc(self.fg, newLength) catch return TextBufferError.OutOfMemory;
        self.bg = self.allocator.realloc(self.bg, newLength) catch return TextBufferError.OutOfMemory;
        self.attributes = self.allocator.realloc(self.attributes, newLength) catch return TextBufferError.OutOfMemory;

        if (newLength > self.length) {
            @memset(self.char[self.length..newLength], ' ');
            @memset(self.fg[self.length..newLength], .{ 1.0, 1.0, 1.0, 1.0 });
            @memset(self.bg[self.length..newLength], .{ 0.0, 0.0, 0.0, 0.0 });
            @memset(self.attributes[self.length..newLength], 0);
        }

        self.length = newLength;
    }

    /// Write a UTF-8 encoded text chunk with styling to the buffer at the current cursor position
    /// This advances the cursor by the number of cells written (including continuation cells) and auto-resizes if needed
    /// Returns flags: bit 0 = resized during write, bits 1-31 = number of cells written
    pub fn writeChunk(self: *TextBuffer, textBytes: []const u8, fg: ?RGBA, bg: ?RGBA, attr: ?u8) TextBufferError!u32 {
        var attrValue: u16 = 0;

        const useFg = fg orelse blk: {
            attrValue |= USE_DEFAULT_FG;
            break :blk self.default_fg orelse .{ 1.0, 1.0, 1.0, 1.0 };
        };

        const useBg = bg orelse blk: {
            attrValue |= USE_DEFAULT_BG;
            break :blk self.default_bg orelse .{ 0.0, 0.0, 0.0, 0.0 };
        };

        if (attr) |a| {
            attrValue |= @as(u16, a);
        } else {
            attrValue |= USE_DEFAULT_ATTR;
            attrValue |= @as(u16, self.default_attributes orelse 0);
        }

        var iter = self.graphemes_data.iterator(textBytes);
        var cellCount: u32 = 0;
        var wasResized: bool = false;

        while (iter.next()) |gc| {
            const bytes = gc.bytes(textBytes);

            var required: u32 = 0;
            var encoded_char: u32 = 0;
            var is_newline: bool = false;

            if (bytes.len == 1 and bytes[0] == '\n') {
                required = 1;
                is_newline = true;
                encoded_char = '\n';
            } else {
                const width_u16: u16 = gwidth.gwidth(bytes, self.width_method, &self.display_width);
                if (width_u16 == 0) {
                    // zero-width/control cluster: skip for now
                    std.debug.panic("zero-width/control cluster: {s}\n", .{bytes});
                    continue;
                }
                const width: u32 = @intCast(width_u16);
                required = width;

                if (bytes.len == 1 and width == 1 and bytes[0] >= 32) {
                    encoded_char = @as(u32, bytes[0]);
                } else {
                    const gid = self.pool.alloc(bytes) catch return TextBufferError.OutOfMemory;
                    encoded_char = gp.packGraphemeStart(gid & gp.GRAPHEME_ID_MASK, width);
                }
            }

            if (self.cursor + required > self.length) {
                const needed: u32 = self.cursor + required - self.length;
                const grow_by: u32 = if (needed > 256) needed else 256;
                try self.resize(self.length + grow_by);
                wasResized = true;
            }

            try self.setCell(self.cursor, encoded_char, useFg, useBg, attrValue);

            if (is_newline) {
                self.line_widths.append(self.current_line_width) catch {};
                self.line_starts.append(self.cursor + 1) catch {};
                self.current_line_width = 0;
                self.cursor += 1;
                cellCount += 1;
            } else {
                self.cursor += required;
                self.current_line_width += required;
                cellCount += required;
            }
        }

        const resizeFlag: u32 = if (wasResized) 1 else 0;
        return (cellCount << 1) | resizeFlag;
    }

    pub fn finalizeLineInfo(self: *TextBuffer) void {
        if (self.current_line_width > 0 or self.cursor == 0) {
            self.line_widths.append(self.current_line_width) catch {};
        }
    }

    pub fn getLineStarts(self: *const TextBuffer) []const u32 {
        return self.line_starts.items;
    }

    pub fn getLineWidths(self: *const TextBuffer) []const u32 {
        return self.line_widths.items;
    }

    pub fn getLineCount(self: *const TextBuffer) u32 {
        return @intCast(self.line_starts.items.len);
    }
};
