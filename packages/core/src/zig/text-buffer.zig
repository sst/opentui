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
    InvalidId,
};

/// A chunk represents a contiguous sequence of characters with the same styling
pub const TextChunk = struct {
    offset: u32,
    length: u32,
    fg: ?RGBA,
    bg: ?RGBA,
    attributes: u16,
};

pub const ChunkRef = struct {
    line_index: usize,
    chunk_index: usize,
};

/// A ChunkGroup tracks references to TextChunks that were created from a single writeChunk call
/// This allows mapping StyledText operations to the native text buffer
pub const ChunkGroup = struct {
    /// References to TextChunks created from this group, in order
    chunk_refs: std.ArrayList(ChunkRef),

    pub fn init(allocator: Allocator) ChunkGroup {
        return .{
            .chunk_refs = std.ArrayList(ChunkRef).init(allocator),
        };
    }

    pub fn deinit(self: *ChunkGroup) void {
        self.chunk_refs.deinit();
    }

    pub fn addChunkRef(self: *ChunkGroup, line_index: usize, chunk_index: usize) !void {
        try self.chunk_refs.append(ChunkRef{
            .line_index = line_index,
            .chunk_index = chunk_index,
        });
    }

    pub fn getChunkCount(self: *const ChunkGroup) usize {
        return self.chunk_refs.items.len;
    }
};

/// A line contains multiple chunks and tracks its total width and start position
pub const TextLine = struct {
    chunks: std.ArrayList(TextChunk),
    width: u32,
    char_start: u32,

    pub fn init(allocator: Allocator) TextLine {
        return .{
            .chunks = std.ArrayList(TextChunk).init(allocator),
            .width = 0,
            .char_start = 0,
        };
    }

    pub fn deinit(self: *TextLine) void {
        self.chunks.deinit();
    }
};

pub const LocalSelection = struct {
    anchorX: i32,
    anchorY: i32,
    focusX: i32,
    focusY: i32,
    isActive: bool,
};

/// TextBuffer holds chunks of styled text organized by lines
/// Only character codes are stored in a contiguous buffer, styling metadata is per-chunk
pub const TextBuffer = struct {
    char: []u32,
    capacity: u32,
    char_count: u32,
    selection: ?TextSelection,
    local_selection: ?LocalSelection,
    default_fg: ?RGBA,
    default_bg: ?RGBA,
    default_attributes: ?u8,

    allocator: Allocator,
    global_allocator: Allocator,
    arena: *std.heap.ArenaAllocator,

    lines: std.ArrayList(TextLine),
    current_line: usize,
    current_line_width: u32,

    chunk_groups: std.ArrayList(*ChunkGroup),

    pool: *gp.GraphemePool,
    graphemes_data: Graphemes,
    display_width: DisplayWidth,
    grapheme_tracker: gp.GraphemeTracker,
    width_method: gwidth.WidthMethod,

    pub fn init(global_allocator: Allocator, length: u32, pool: *gp.GraphemePool, width_method: gwidth.WidthMethod, graphemes_data: *Graphemes, display_width: *DisplayWidth) TextBufferError!*TextBuffer {
        if (length == 0) return TextBufferError.InvalidDimensions;

        const self = global_allocator.create(TextBuffer) catch return TextBufferError.OutOfMemory;
        errdefer global_allocator.destroy(self);

        const internal_arena = global_allocator.create(std.heap.ArenaAllocator) catch return TextBufferError.OutOfMemory;
        errdefer global_allocator.destroy(internal_arena);
        internal_arena.* = std.heap.ArenaAllocator.init(std.heap.page_allocator);

        const internal_allocator = internal_arena.allocator();

        const graph = graphemes_data.*;
        const dw = display_width.*;

        var lines = std.ArrayList(TextLine).init(internal_allocator);

        errdefer {
            for (lines.items) |*line| {
                line.deinit();
            }
            lines.deinit();
        }

        var chunk_groups = std.ArrayList(*ChunkGroup).init(internal_allocator);
        errdefer chunk_groups.deinit();

        const first_line = TextLine.init(internal_allocator);
        lines.append(first_line) catch return TextBufferError.OutOfMemory;

        self.* = .{
            .char = internal_allocator.alloc(u32, length) catch return TextBufferError.OutOfMemory,
            .capacity = length,
            .char_count = 0,
            .selection = null,
            .local_selection = null,
            .default_fg = null,
            .default_bg = null,
            .default_attributes = null,
            .allocator = internal_allocator,
            .global_allocator = global_allocator,
            .arena = internal_arena,
            .lines = lines,
            .current_line = 0,
            .current_line_width = 0,
            .chunk_groups = chunk_groups,
            .pool = pool,
            .graphemes_data = graph,
            .display_width = dw,
            .grapheme_tracker = gp.GraphemeTracker.init(global_allocator, pool),
            .width_method = width_method,
        };

        @memset(self.char, ' ');

        return self;
    }

    pub fn deinit(self: *TextBuffer) void {
        self.grapheme_tracker.deinit();
        self.arena.deinit();
        self.global_allocator.destroy(self.arena);
        self.global_allocator.destroy(self);
    }

    pub fn getCharPtr(self: *TextBuffer) [*]u32 {
        return self.char.ptr;
    }

    pub fn getLength(self: *const TextBuffer) u32 {
        return self.char_count;
    }

    pub fn getCapacity(self: *const TextBuffer) u32 {
        return self.capacity;
    }

    fn ensureCapacity(self: *TextBuffer, additional_chars: u32) TextBufferError!void {
        if (self.char_count + additional_chars > self.capacity) {
            const new_capacity = @max(self.capacity * 2, self.char_count + additional_chars);
            self.char = self.allocator.realloc(self.char, new_capacity) catch return TextBufferError.OutOfMemory;
            self.capacity = new_capacity;
        }
    }

    pub fn reset(self: *TextBuffer) void {
        self.grapheme_tracker.clear();

        _ = self.arena.reset(if (self.arena.queryCapacity() > 0) .retain_capacity else .free_all);

        self.char_count = 0;
        self.current_line = 0;
        self.current_line_width = 0;
        self.local_selection = null;
        self.selection = null;

        self.char = self.allocator.alloc(u32, self.capacity) catch {
            @panic("TextBuffer.reset: alloc failed");
        };

        self.lines = std.ArrayList(TextLine).init(self.allocator);
        self.chunk_groups = std.ArrayList(*ChunkGroup).init(self.allocator);

        const first_line = TextLine.init(self.allocator);
        self.lines.append(first_line) catch {};
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

    pub fn getSelection(self: *const TextBuffer) ?TextSelection {
        return self.selection;
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

    pub fn resize(self: *TextBuffer, newCapacity: u32) TextBufferError!void {
        if (newCapacity == self.capacity) return;
        if (newCapacity == 0) return TextBufferError.InvalidDimensions;

        const old_capacity = self.capacity;
        self.char = self.allocator.realloc(self.char, newCapacity) catch return TextBufferError.OutOfMemory;

        if (newCapacity > old_capacity) {
            @memset(self.char[old_capacity..newCapacity], ' ');
        }

        self.capacity = newCapacity;
    }

    /// Write a UTF-8 encoded text chunk with styling to the buffer
    /// Creates a new chunk with the specified styling and adds it to the current line
    /// Returns flags: bit 0 = resized during write, bits 1-31 = number of cells written
    pub fn writeChunk(self: *TextBuffer, textBytes: []const u8, fg: ?RGBA, bg: ?RGBA, attr: ?u8) TextBufferError!u32 {
        // Empty text creates a single chunk group
        if (textBytes.len == 0) {
            const chunk_group = self.allocator.create(ChunkGroup) catch return TextBufferError.OutOfMemory;
            chunk_group.* = ChunkGroup.init(self.allocator);
            errdefer {
                chunk_group.deinit();
                self.allocator.destroy(chunk_group);
            }
            self.chunk_groups.append(chunk_group) catch return TextBufferError.OutOfMemory;
            return 0;
        }

        const chunk_group = self.allocator.create(ChunkGroup) catch return TextBufferError.OutOfMemory;
        chunk_group.* = ChunkGroup.init(self.allocator);
        errdefer {
            chunk_group.deinit();
            self.allocator.destroy(chunk_group);
        }

        var attrValue: u16 = 0;

        // Handle default colors and attributes
        if (fg == null) {
            attrValue |= USE_DEFAULT_FG;
        }
        if (bg == null) {
            attrValue |= USE_DEFAULT_BG;
        }
        if (attr) |a| {
            attrValue |= @as(u16, a);
        } else {
            attrValue |= USE_DEFAULT_ATTR;
        }

        var iter = self.graphemes_data.iterator(textBytes);
        var cellCount: u32 = 0;
        var wasResized: bool = false;
        const estimatedCapacity = textBytes.len * 2;
        try self.ensureCapacity(@intCast(estimatedCapacity));
        if (self.capacity != self.char.len) {
            wasResized = true;
        }
        var current_chunk_offset = self.char_count;
        var current_chunk_chars: u32 = 0;
        var current_chunk_width: u32 = 0;

        iter = self.graphemes_data.iterator(textBytes);

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
                    // zero-width/control cluster: skip
                    continue;
                }
                const width: u32 = @intCast(width_u16);
                required = width;

                if (bytes.len == 1 and width == 1 and bytes[0] >= 32) {
                    encoded_char = @as(u32, bytes[0]);
                } else {
                    const gid = self.pool.alloc(bytes) catch return TextBufferError.OutOfMemory;
                    encoded_char = gp.packGraphemeStart(gid & gp.GRAPHEME_ID_MASK, width);
                    self.grapheme_tracker.add(gid);
                }
            }

            if (gp.isGraphemeChar(encoded_char)) {
                const right = gp.charRightExtent(encoded_char);
                const gid: u32 = gp.graphemeIdFromChar(encoded_char);

                self.char[self.char_count] = encoded_char;
                self.char_count += 1;
                current_chunk_chars += 1;

                var k: u32 = 1;
                while (k <= right and self.char_count < self.capacity) : (k += 1) {
                    const cont = gp.packContinuation(k, right - k, gid);
                    self.char[self.char_count] = cont;
                    self.char_count += 1;
                    current_chunk_chars += 1;
                }
            } else {
                self.char[self.char_count] = encoded_char;
                self.char_count += 1;
                current_chunk_chars += 1;
            }

            if (is_newline) {
                if (current_chunk_chars > 0) {
                    const chunk = TextChunk{
                        .offset = current_chunk_offset,
                        .length = current_chunk_chars,
                        .fg = fg,
                        .bg = bg,
                        .attributes = attrValue,
                    };

                    if (self.current_line < self.lines.items.len) {
                        const chunk_index = self.lines.items[self.current_line].chunks.items.len;
                        self.lines.items[self.current_line].chunks.append(chunk) catch return TextBufferError.OutOfMemory;
                        self.lines.items[self.current_line].width += current_chunk_width;

                        chunk_group.addChunkRef(self.current_line, chunk_index) catch return TextBufferError.OutOfMemory;
                    }

                    current_chunk_offset = self.char_count;
                    current_chunk_chars = 0;
                    current_chunk_width = 0;
                }

                if (self.current_line < self.lines.items.len) {
                    self.lines.items[self.current_line].width = self.current_line_width;
                }

                self.current_line_width = 0;

                self.current_line += 1;
                if (self.current_line >= self.lines.items.len) {
                    var new_line = TextLine.init(self.allocator);
                    new_line.char_start = self.char_count;
                    self.lines.append(new_line) catch return TextBufferError.OutOfMemory;
                }

                cellCount += 1;
            } else {
                current_chunk_width += required;
                self.current_line_width += required;
                cellCount += required;
            }
        }

        // Create final chunk if there's remaining content
        if (current_chunk_chars > 0) {
            const chunk = TextChunk{
                .offset = current_chunk_offset,
                .length = current_chunk_chars,
                .fg = fg,
                .bg = bg,
                .attributes = attrValue,
            };

            if (self.current_line < self.lines.items.len) {
                const chunk_index = self.lines.items[self.current_line].chunks.items.len;
                self.lines.items[self.current_line].chunks.append(chunk) catch return TextBufferError.OutOfMemory;
                self.lines.items[self.current_line].width += current_chunk_width;

                chunk_group.addChunkRef(self.current_line, chunk_index) catch return TextBufferError.OutOfMemory;
            }
        }

        self.chunk_groups.append(chunk_group) catch return TextBufferError.OutOfMemory;

        const resizeFlag: u32 = if (wasResized) 1 else 0;
        return (cellCount << 1) | resizeFlag;
    }

    pub fn finalizeLineInfo(self: *TextBuffer) void {
        // Update the final line's width
        if (self.current_line < self.lines.items.len) {
            self.lines.items[self.current_line].width = self.current_line_width;
        }
    }

    pub fn getLineCount(self: *const TextBuffer) u32 {
        return @intCast(self.lines.items.len);
    }

    /// Format: [start:u32][end:u32] packed into u64
    /// If no selection, returns 0xFFFFFFFF_FFFFFFFF (all bits set)
    pub fn packSelectionInfo(self: *const TextBuffer) u64 {
        if (self.selection) |sel| {
            return (@as(u64, sel.start) << 32) | @as(u64, sel.end);
        } else {
            return 0xFFFF_FFFF_FFFF_FFFF;
        }
    }

    /// Set local selection coordinates and automatically calculate character positions
    /// Returns true if the selection changed, false otherwise
    pub fn setLocalSelection(self: *TextBuffer, anchorX: i32, anchorY: i32, focusX: i32, focusY: i32, bgColor: ?RGBA, fgColor: ?RGBA) bool {
        const new_local_sel = LocalSelection{
            .anchorX = anchorX,
            .anchorY = anchorY,
            .focusX = focusX,
            .focusY = focusY,
            .isActive = true,
        };

        const coords_changed = if (self.local_selection) |old_sel| blk: {
            break :blk old_sel.anchorX != new_local_sel.anchorX or
                old_sel.anchorY != new_local_sel.anchorY or
                old_sel.focusX != new_local_sel.focusX or
                old_sel.focusY != new_local_sel.focusY;
        } else true;

        self.local_selection = new_local_sel;

        const char_selection = self.calculateMultiLineSelection();
        var selection_changed = coords_changed;

        if (char_selection) |sel| {
            const new_selection = TextSelection{
                .start = sel.start,
                .end = sel.end,
                .bgColor = bgColor,
                .fgColor = fgColor,
            };

            if (self.selection) |old_sel| {
                if (old_sel.start != new_selection.start or
                    old_sel.end != new_selection.end)
                {
                    selection_changed = true;
                }
            } else {
                selection_changed = true;
            }

            self.selection = new_selection;
        } else {
            if (self.selection != null) {
                selection_changed = true;
            }
            self.selection = null;
        }

        return selection_changed;
    }

    pub fn resetLocalSelection(self: *TextBuffer) void {
        self.local_selection = null;
        self.selection = null;
    }

    /// Calculate character positions from local selection coordinates
    /// Returns null if no valid selection
    fn calculateMultiLineSelection(self: *const TextBuffer) ?struct { start: u32, end: u32 } {
        const local_sel = self.local_selection orelse return null;
        if (!local_sel.isActive) return null;

        var selectionStart: ?u32 = null;
        var selectionEnd: ?u32 = null;

        const startY = @min(local_sel.anchorY, local_sel.focusY);
        const endY = @max(local_sel.anchorY, local_sel.focusY);

        // Determine anchor and focus points based on selection direction
        var selStartX: i32 = undefined;
        var selEndX: i32 = undefined;

        if (local_sel.anchorY < local_sel.focusY or
            (local_sel.anchorY == local_sel.focusY and local_sel.anchorX <= local_sel.focusX))
        {
            selStartX = local_sel.anchorX;
            selEndX = local_sel.focusX;
        } else {
            selStartX = local_sel.focusX;
            selEndX = local_sel.anchorX;
        }

        for (self.lines.items, 0..) |line, i| {
            const lineY = @as(i32, @intCast(i));

            if (lineY < startY or lineY > endY) continue;

            const lineStart = line.char_start;
            const lineWidth = line.width;
            const lineEnd = if (i < self.lines.items.len - 1)
                self.lines.items[i + 1].char_start - 1
            else
                lineStart + lineWidth;

            if (lineY > startY and lineY < endY) {
                // Entire line is selected
                if (selectionStart == null) selectionStart = lineStart;
                selectionEnd = lineEnd;
            } else if (lineY == startY and lineY == endY) {
                // Selection starts and ends on this line
                const localStartX = @max(0, @min(selStartX, @as(i32, @intCast(lineWidth))));
                const localEndX = @max(0, @min(selEndX, @as(i32, @intCast(lineWidth))));
                if (localStartX != localEndX) {
                    selectionStart = lineStart + @as(u32, @intCast(localStartX));
                    selectionEnd = lineStart + @as(u32, @intCast(localEndX));
                }
            } else if (lineY == startY) {
                // Selection starts on this line
                const localStartX = @max(0, @min(selStartX, @as(i32, @intCast(lineWidth))));
                if (localStartX < lineWidth) {
                    selectionStart = lineStart + @as(u32, @intCast(localStartX));
                    selectionEnd = lineEnd;
                }
            } else if (lineY == endY) {
                // Selection ends on this line
                const localEndX = @max(0, @min(selEndX, @as(i32, @intCast(lineWidth))));
                if (localEndX > 0) {
                    if (selectionStart == null) selectionStart = lineStart;
                    selectionEnd = lineStart + @as(u32, @intCast(localEndX));
                }
            }
        }

        return if (selectionStart != null and selectionEnd != null and selectionStart.? < selectionEnd.?)
            .{ .start = selectionStart.?, .end = selectionEnd.? }
        else
            null;
    }

    /// Extract selected text as UTF-8 bytes from the char buffer into provided output buffer
    /// Returns the number of bytes written to the output buffer
    pub fn getSelectedTextIntoBuffer(self: *const TextBuffer, out_buffer: []u8) usize {
        const selection = self.selection orelse return 0;
        const start = selection.start;
        const end = selection.end;

        var out_index: usize = 0;
        var count: u32 = 0;

        // Iterate through all lines and chunks, similar to rendering
        for (self.lines.items) |line| {
            for (line.chunks.items) |chunk| {
                var chunk_char_index: u32 = 0;
                while (chunk_char_index < chunk.length and count < end and out_index < out_buffer.len) : (chunk_char_index += 1) {
                    const global_char_index = chunk.offset + chunk_char_index;
                    const c = self.char[global_char_index];

                    if (!gp.isContinuationChar(c)) {
                        if (count >= start) {
                            if (gp.isGraphemeChar(c)) {
                                const gid = gp.graphemeIdFromChar(c);
                                const grapheme_bytes = self.pool.get(gid) catch continue;
                                const copy_len = @min(grapheme_bytes.len, out_buffer.len - out_index);
                                @memcpy(out_buffer[out_index .. out_index + copy_len], grapheme_bytes[0..copy_len]);
                                out_index += copy_len;
                            } else {
                                var utf8_buf: [4]u8 = undefined;
                                const utf8_len = std.unicode.utf8Encode(@intCast(c), &utf8_buf) catch 1;
                                const copy_len = @min(utf8_len, out_buffer.len - out_index);
                                @memcpy(out_buffer[out_index .. out_index + copy_len], utf8_buf[0..copy_len]);
                                out_index += copy_len;
                            }
                        }
                        count += 1;

                        // Skip continuation characters for graphemes
                        if (gp.isGraphemeChar(c)) {
                            const right_extent = gp.charRightExtent(c);
                            var k: u32 = 0;
                            while (k < right_extent and chunk_char_index + 1 < chunk.length) : (k += 1) {
                                chunk_char_index += 1;
                                // Verify the continuation character exists
                                const cont_index = chunk.offset + chunk_char_index;
                                if (cont_index >= self.char_count or !gp.isContinuationChar(self.char[cont_index])) {
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        return out_index;
    }

    /// Extract all text as UTF-8 bytes from the char buffer into provided output buffer
    /// Returns the number of bytes written to the output buffer
    pub fn getPlainTextIntoBuffer(self: *const TextBuffer, out_buffer: []u8) usize {
        var out_index: usize = 0;

        // Iterate through all lines and chunks, similar to rendering
        for (self.lines.items) |line| {
            for (line.chunks.items) |chunk| {
                var chunk_char_index: u32 = 0;
                while (chunk_char_index < chunk.length and out_index < out_buffer.len) : (chunk_char_index += 1) {
                    const global_char_index = chunk.offset + chunk_char_index;
                    const c = self.char[global_char_index];

                    if (!gp.isContinuationChar(c)) {
                        if (gp.isGraphemeChar(c)) {
                            const gid = gp.graphemeIdFromChar(c);
                            const grapheme_bytes = self.pool.get(gid) catch continue;
                            const copy_len = @min(grapheme_bytes.len, out_buffer.len - out_index);
                            @memcpy(out_buffer[out_index .. out_index + copy_len], grapheme_bytes[0..copy_len]);
                            out_index += copy_len;
                        } else {
                            var utf8_buf: [4]u8 = undefined;
                            const utf8_len = std.unicode.utf8Encode(@intCast(c), &utf8_buf) catch 1;
                            const copy_len = @min(utf8_len, out_buffer.len - out_index);
                            @memcpy(out_buffer[out_index .. out_index + copy_len], utf8_buf[0..copy_len]);
                            out_index += copy_len;
                        }

                        // Skip continuation characters for graphemes
                        if (gp.isGraphemeChar(c)) {
                            const right_extent = gp.charRightExtent(c);
                            var k: u32 = 0;
                            while (k < right_extent and chunk_char_index + 1 < chunk.length) : (k += 1) {
                                chunk_char_index += 1;
                                // Verify the continuation character exists
                                const cont_index = chunk.offset + chunk_char_index;
                                if (cont_index >= self.char_count or !gp.isContinuationChar(self.char[cont_index])) {
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        return out_index;
    }

    /// Insert a chunk group at the specified index
    /// This maps to StyledText.insert() operation
    pub fn insertChunkGroup(self: *TextBuffer, index: usize, text_bytes: []const u8, fg: ?RGBA, bg: ?RGBA, attr: ?u8) TextBufferError!u32 {
        if (text_bytes.len == 0) return self.char_count;

        // TODO: Inserts currently leak, as they only append
        // - will be solved with a global text pool

        const old_char_count = self.char_count;
        // TODO: Use a re-usable parseChunk function instead of writeChunk and .pop workaround
        _ = try self.writeChunk(text_bytes, fg, bg, attr);
        const new_chunk_group = self.chunk_groups.pop() orelse return TextBufferError.InvalidIndex;

        if (index >= self.chunk_groups.items.len) {
            self.chunk_groups.append(new_chunk_group) catch return TextBufferError.OutOfMemory;
            return self.char_count;
        }

        // TODO: Everything form here on seems very inefficient, can be improved

        // Move chunks from temporary lines to correct insertion point
        const target_group = self.chunk_groups.items[index];
        const insert_line_idx = if (target_group.chunk_refs.items.len > 0)
            target_group.chunk_refs.items[0].line_index
        else
            0;
        const insert_chunk_idx = if (target_group.chunk_refs.items.len > 0)
            target_group.chunk_refs.items[0].chunk_index
        else
            0;

        if (insert_line_idx < self.lines.items.len) {
            var target_line = &self.lines.items[insert_line_idx];

            var inserted_chunk_idx: ?usize = null;
            for (target_line.chunks.items, 0..) |chunk, i| {
                if (chunk.offset >= old_char_count) {
                    inserted_chunk_idx = i;
                    break;
                }
            }

            if (inserted_chunk_idx) |idx| {
                const inserted_chunk = target_line.chunks.orderedRemove(idx);

                target_line.chunks.insert(insert_chunk_idx, inserted_chunk) catch return TextBufferError.OutOfMemory;

                for (new_chunk_group.chunk_refs.items) |*ref| {
                    if (ref.line_index == insert_line_idx) {
                        ref.chunk_index = insert_chunk_idx;
                    }
                }
            }
        }

        self.chunk_groups.insert(index, new_chunk_group) catch return TextBufferError.OutOfMemory;

        return self.char_count;
    }

    /// Remove a chunk group at the specified index
    /// This maps to StyledText.remove() operation
    pub fn removeChunkGroup(self: *TextBuffer, index: usize) TextBufferError!u32 {
        if (index >= self.chunk_groups.items.len) return TextBufferError.InvalidIndex;

        const chunk_group = self.chunk_groups.items[index];

        var i = chunk_group.chunk_refs.items.len;
        while (i > 0) {
            i -= 1;
            const chunk_ref = chunk_group.chunk_refs.items[i];
            if (chunk_ref.line_index < self.lines.items.len and
                chunk_ref.chunk_index < self.lines.items[chunk_ref.line_index].chunks.items.len)
            {
                _ = self.lines.items[chunk_ref.line_index].chunks.orderedRemove(chunk_ref.chunk_index);
            }
        }

        _ = self.chunk_groups.orderedRemove(index);
        chunk_group.deinit();
        self.allocator.destroy(chunk_group);

        return self.char_count;
    }

    /// Replace a chunk group at the specified index
    /// This maps to StyledText.replace() operation
    pub fn replaceChunkGroup(self: *TextBuffer, index: usize, text_bytes: []const u8, fg: ?RGBA, bg: ?RGBA, attr: ?u8) TextBufferError!u32 {
        if (index >= self.chunk_groups.items.len) return TextBufferError.InvalidIndex;

        _ = try self.removeChunkGroup(index);

        return try self.insertChunkGroup(index, text_bytes, fg, bg, attr);
    }

    /// Get the number of chunk groups
    pub fn getChunkGroupCount(self: *const TextBuffer) usize {
        return self.chunk_groups.items.len;
    }

    /// Get a chunk group by index
    pub fn getChunkGroup(self: *const TextBuffer, index: usize) ?*const ChunkGroup {
        if (index >= self.chunk_groups.items.len) return null;
        return self.chunk_groups.items[index];
    }
};
