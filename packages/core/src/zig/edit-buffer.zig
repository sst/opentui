const std = @import("std");
const Allocator = std.mem.Allocator;
const tb = @import("text-buffer.zig");
const iter_mod = @import("text-buffer-iterators.zig");
const seg_mod = @import("text-buffer-segment.zig");
const gp = @import("grapheme.zig");
const gwidth = @import("gwidth.zig");
const utf8 = @import("utf8.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");

const UnifiedTextBuffer = tb.UnifiedTextBuffer;
const TextChunk = seg_mod.TextChunk;
const Segment = seg_mod.Segment;
const UnifiedRope = seg_mod.UnifiedRope;

pub const EditBufferError = error{
    OutOfMemory,
    InvalidCursor,
};

/// Cursor position (row, col in display-width coordinates)
pub const Cursor = struct {
    row: u32,
    col: u32,
    desired_col: u32 = 0, // Preserved column for up/down navigation
};

/// Append-only buffer for inserted text
/// Grows as needed and registers with TextBuffer
const AddBuffer = struct {
    mem_id: u8,
    ptr: [*]u8,
    len: usize,
    cap: usize,
    allocator: Allocator,

    fn init(allocator: Allocator, text_buffer: *UnifiedTextBuffer, initial_cap: usize) !AddBuffer {
        const mem = try allocator.alloc(u8, initial_cap);
        // Register the full buffer with the text buffer (we'll track len separately)
        const mem_id = try text_buffer.registerMemBuffer(mem, true);

        return .{
            .mem_id = mem_id,
            .ptr = mem.ptr,
            .len = 0,
            .cap = mem.len,
            .allocator = allocator,
        };
    }

    fn ensureCapacity(self: *AddBuffer, text_buffer: *UnifiedTextBuffer, need: usize) !void {
        if (self.len + need <= self.cap) return;

        // Allocate new buffer with doubled capacity
        const new_cap = @max(self.cap * 2, self.len + need);
        const new_mem = try self.allocator.alloc(u8, new_cap);
        const new_mem_id = try text_buffer.registerMemBuffer(new_mem, true);

        // Switch to new buffer (old buffer remains registered for existing chunks)
        self.mem_id = new_mem_id;
        self.ptr = new_mem.ptr;
        self.len = 0;
        self.cap = new_mem.len;
    }

    fn append(self: *AddBuffer, bytes: []const u8) struct { mem_id: u8, start: u32, end: u32 } {
        std.debug.assert(self.len + bytes.len <= self.cap);
        const start: u32 = @intCast(self.len);

        // Create a slice from the pointer for safe memcpy
        const dest_slice = self.ptr[0..self.cap];
        @memcpy(dest_slice[self.len .. self.len + bytes.len], bytes);

        self.len += bytes.len;
        const end: u32 = @intCast(self.len);
        return .{ .mem_id = self.mem_id, .start = start, .end = end };
    }
};

/// EditBuffer provides cursor-based text editing on a UnifiedTextBuffer
pub const EditBuffer = struct {
    tb: *UnifiedTextBuffer,
    add_buffer: AddBuffer,
    cursors: std.ArrayListUnmanaged(Cursor),
    allocator: Allocator,

    pub fn init(
        allocator: Allocator,
        pool: *gp.GraphemePool,
        width_method: gwidth.WidthMethod,
        graphemes_data: *Graphemes,
        display_width: *DisplayWidth,
    ) !*EditBuffer {
        const self = try allocator.create(EditBuffer);
        errdefer allocator.destroy(self);

        const text_buffer = try UnifiedTextBuffer.init(allocator, pool, width_method, graphemes_data, display_width);
        errdefer text_buffer.deinit();

        const add_buffer = try AddBuffer.init(allocator, text_buffer, 65536); // 64 KiB initial
        errdefer {}

        var cursors: std.ArrayListUnmanaged(Cursor) = .{};
        errdefer cursors.deinit(allocator);

        // Initialize with one cursor at (0, 0)
        try cursors.append(allocator, .{ .row = 0, .col = 0 });

        self.* = .{
            .tb = text_buffer,
            .add_buffer = add_buffer,
            .cursors = cursors,
            .allocator = allocator,
        };

        // Create an initial empty line (single empty text segment with linestart marker)
        const empty_mem_id = try text_buffer.registerMemBuffer(&[_]u8{}, false);
        const empty_chunk = text_buffer.createChunk(empty_mem_id, 0, 0);
        try text_buffer.rope.append(Segment{ .linestart = {} });
        try text_buffer.rope.append(Segment{ .text = empty_chunk });

        return self;
    }

    pub fn deinit(self: *EditBuffer) void {
        self.tb.deinit();
        self.cursors.deinit(self.allocator);
        self.allocator.destroy(self);
    }

    pub fn getTextBuffer(self: *EditBuffer) *UnifiedTextBuffer {
        return self.tb;
    }

    pub fn getCursor(self: *const EditBuffer, idx: usize) ?Cursor {
        if (idx >= self.cursors.items.len) return null;
        return self.cursors.items[idx];
    }

    pub fn getPrimaryCursor(self: *const EditBuffer) Cursor {
        if (self.cursors.items.len == 0) return .{ .row = 0, .col = 0 };
        return self.cursors.items[0];
    }

    pub fn setCursor(self: *EditBuffer, row: u32, col: u32) !void {
        if (self.cursors.items.len == 0) {
            try self.cursors.append(self.allocator, .{ .row = row, .col = col, .desired_col = col });
        } else {
            self.cursors.items[0] = .{ .row = row, .col = col, .desired_col = col };
        }
    }

    /// Ensure add buffer has capacity for n bytes
    fn ensureAddCapacity(self: *EditBuffer, need: usize) !void {
        try self.add_buffer.ensureCapacity(self.tb, need);
    }

    /// Get line width using O(1) marker lookups
    /// Uses linestart markers to determine line boundaries
    fn getLineWidth(self: *const EditBuffer, row: u32) u32 {
        const linestart_count = self.tb.rope.markerCount(.linestart);
        if (row >= linestart_count) return 0;

        // Get the character offset at the start of this line
        const line_marker = self.tb.rope.getMarker(.linestart, row) orelse return 0;
        const line_start_offset = line_marker.global_weight;

        // Get the character offset at the start of the next line (or end of buffer)
        const line_end_offset = if (row + 1 < linestart_count) blk: {
            const next_marker = self.tb.rope.getMarker(.linestart, row + 1) orelse return 0;
            break :blk next_marker.global_weight;
        } else blk: {
            break :blk iter_mod.getTotalWidth(&self.tb.rope);
        };

        return line_end_offset - line_start_offset;
    }

    /// Split a TextChunk at a specific weight (display width)
    /// Returns left and right chunks
    /// Uses wrap offsets to narrow down the search range and minimize grapheme iteration
    fn splitChunkAtWeight(
        self: *EditBuffer,
        chunk: *const TextChunk,
        weight: u32,
    ) error{ OutOfBounds, OutOfMemory }!struct { left: TextChunk, right: TextChunk } {
        const chunk_weight = chunk.width;

        if (weight == 0) {
            return .{
                .left = TextChunk{ .mem_id = 0, .byte_start = 0, .byte_end = 0, .width = 0 },
                .right = chunk.*,
            };
        } else if (weight >= chunk_weight) {
            return .{
                .left = chunk.*,
                .right = TextChunk{ .mem_id = 0, .byte_start = 0, .byte_end = 0, .width = 0 },
            };
        }

        const chunk_bytes = chunk.getBytes(&self.tb.mem_registry);

        // Get wrap offsets to narrow down the search range
        const wrap_offsets = chunk.getWrapOffsets(
            &self.tb.mem_registry,
            self.tb.allocator,
        ) catch return error.OutOfMemory;

        // Find the wrap offset range that contains our target weight
        var search_start_byte: u32 = 0;
        var search_end_byte: u32 = @intCast(chunk_bytes.len);
        var width_before_range: u32 = 0;

        if (wrap_offsets.len > 0) {
            // Binary search to find the wrap offset closest to but before the target weight
            for (wrap_offsets) |wrap_break| {
                if (wrap_break.char_offset >= weight) {
                    search_end_byte = wrap_break.byte_offset;
                    break;
                }
                search_start_byte = wrap_break.byte_offset;
                width_before_range = wrap_break.char_offset;
            }
        }

        // Now iterate graphemes only in the narrowed range
        const search_bytes = chunk_bytes[search_start_byte..search_end_byte];
        var iter = self.tb.getGraphemeIterator(search_bytes);

        var accumulated_width: u32 = width_before_range;
        var split_byte_offset: u32 = search_start_byte;
        var left_width: u32 = width_before_range;

        while (iter.next()) |gc| {
            const gbytes = gc.bytes(search_bytes);
            const width_u16: u16 = gwidth.gwidth(gbytes, self.tb.width_method, &self.tb.display_width);

            if (width_u16 == 0) {
                split_byte_offset += @intCast(gbytes.len);
                continue;
            }

            const g_width: u32 = @intCast(width_u16);

            if (accumulated_width >= weight) break;

            accumulated_width += g_width;
            split_byte_offset += @intCast(gbytes.len);
            left_width += g_width;
        }

        const left_chunk = self.tb.createChunk(
            chunk.mem_id,
            chunk.byte_start,
            chunk.byte_start + split_byte_offset,
        );

        const right_chunk = self.tb.createChunk(
            chunk.mem_id,
            chunk.byte_start + split_byte_offset,
            chunk.byte_end,
        );

        return .{ .left = left_chunk, .right = right_chunk };
    }

    /// Create a LeafSplitFn callback for splitting segments
    pub fn makeSegmentSplitter(self: *EditBuffer) UnifiedRope.Node.LeafSplitFn {
        return .{
            .ctx = self,
            .splitFn = splitSegmentCallback,
        };
    }

    fn splitSegmentCallback(
        ctx: ?*anyopaque,
        allocator: Allocator,
        leaf: *const Segment,
        weight_in_leaf: u32,
    ) error{ OutOfBounds, OutOfMemory }!UnifiedRope.Node.LeafSplitResult {
        _ = allocator;
        const edit_buf = @as(*EditBuffer, @ptrCast(@alignCast(ctx.?)));

        // Segments can only split if they're text segments
        // Breaks cannot be split (weight is 0 anyway)
        if (leaf.asText()) |chunk| {
            const result = try edit_buf.splitChunkAtWeight(chunk, weight_in_leaf);
            return .{
                .left = Segment{ .text = result.left },
                .right = Segment{ .text = result.right },
            };
        } else {
            // Break segment - cannot split, return as-is
            // This shouldn't happen if weight calculation is correct
            return .{
                .left = Segment{ .brk = {} },
                .right = Segment{ .brk = {} },
            };
        }
    }

    /// Insert text at the primary cursor
    pub fn insertText(self: *EditBuffer, bytes: []const u8) !void {
        if (bytes.len == 0) return;
        if (self.cursors.items.len == 0) return;

        const cursor = self.cursors.items[0];

        // Ensure add buffer capacity
        try self.ensureAddCapacity(bytes.len);

        // Convert cursor position to character offset
        const insert_offset = iter_mod.coordsToOffset(&self.tb.rope, cursor.row, cursor.col) orelse return EditBufferError.InvalidCursor;

        // Append entire bytes to AddBuffer once (single copy)
        const chunk_ref = self.add_buffer.append(bytes);
        const base_mem_id = chunk_ref.mem_id;
        const base_start = chunk_ref.start;

        // Detect line breaks using SIMD16
        var break_result = utf8.LineBreakResult.init(self.allocator);
        defer break_result.deinit();
        try utf8.findLineBreaksSIMD16(bytes, &break_result);

        // Build segments from the single appended range
        var segments = std.ArrayList(Segment).init(self.allocator);
        defer segments.deinit();

        var local_start: u32 = 0;
        var inserted_width: u32 = 0;
        var width_after_last_break: u32 = 0; // Width of text after the last newline

        for (break_result.breaks.items) |line_break| {
            const break_pos: u32 = @intCast(line_break.pos);
            const local_end: u32 = switch (line_break.kind) {
                .CRLF => break_pos - 1,
                .CR, .LF => break_pos,
            };

            // Add text segment for content before the break (if any)
            if (local_end > local_start) {
                const chunk = self.tb.createChunk(base_mem_id, base_start + local_start, base_start + local_end);
                try segments.append(Segment{ .text = chunk });
                inserted_width += chunk.width;
            }

            // Add break segment and linestart for next line
            try segments.append(Segment{ .brk = {} });
            try segments.append(Segment{ .linestart = {} });

            local_start = break_pos + 1;
            // Reset width counter - text after this break goes on the new line
            width_after_last_break = 0;
        }

        // Add remaining text after last break (or entire text if no breaks)
        if (local_start < bytes.len) {
            const chunk = self.tb.createChunk(base_mem_id, base_start + local_start, base_start + @as(u32, @intCast(bytes.len)));
            try segments.append(Segment{ .text = chunk });
            width_after_last_break = chunk.width;
            inserted_width += chunk.width;
        }

        // Insert segments into rope at the offset
        if (segments.items.len > 0) {
            const splitter = self.makeSegmentSplitter();
            try self.tb.rope.insertSliceByWeight(insert_offset, segments.items, &splitter);

            // Update char count
            self.tb.char_count += inserted_width;
        }

        // Mark views dirty
        self.tb.markViewsDirty();

        // Update cursor position to end of inserted text
        const num_breaks = break_result.breaks.items.len;
        if (num_breaks > 0) {
            // We inserted newlines - cursor moves to a new line
            self.cursors.items[0] = .{
                .row = cursor.row + @as(u32, @intCast(num_breaks)),
                .col = width_after_last_break,
                .desired_col = width_after_last_break,
            };
        } else {
            // No line breaks - cursor stays on same line, moves forward
            self.cursors.items[0] = .{
                .row = cursor.row,
                .col = cursor.col + inserted_width,
                .desired_col = cursor.col + inserted_width,
            };
        }
    }

    pub fn deleteRange(self: *EditBuffer, start_cursor: Cursor, end_cursor: Cursor) !void {
        // Normalize cursors (ensure start <= end)
        var start = start_cursor;
        var end = end_cursor;
        if (start.row > end.row or (start.row == end.row and start.col > end.col)) {
            const temp = start;
            start = end;
            end = temp;
        }

        // Empty range - nothing to delete
        if (start.row == end.row and start.col == end.col) return;

        // Convert to character offsets
        const start_offset = iter_mod.coordsToOffset(&self.tb.rope, start.row, start.col) orelse return EditBufferError.InvalidCursor;
        const end_offset = iter_mod.coordsToOffset(&self.tb.rope, end.row, end.col) orelse return EditBufferError.InvalidCursor;

        if (start_offset >= end_offset) return;

        // The weight difference is the character count being deleted
        const deleted_width = end_offset - start_offset;

        // Delete the range using rope's deleteRangeByWeight with splitter
        const splitter = self.makeSegmentSplitter();
        try self.tb.rope.deleteRangeByWeight(start_offset, end_offset, &splitter);

        // Update char count
        if (self.tb.char_count >= deleted_width) {
            self.tb.char_count -= deleted_width;
        } else {
            self.tb.char_count = 0;
        }

        // Mark views dirty
        self.tb.markViewsDirty();

        // Set cursor to start of deleted range
        if (self.cursors.items.len > 0) {
            self.cursors.items[0] = .{ .row = start.row, .col = start.col, .desired_col = start.col };
        }
    }

    pub fn backspace(self: *EditBuffer) !void {
        if (self.cursors.items.len == 0) return;
        const cursor = self.cursors.items[0];

        // At start of buffer - nothing to delete
        if (cursor.row == 0 and cursor.col == 0) return;

        if (cursor.col == 0) {
            // At start of line - use O(1) marker lookup to find the break before this line
            // The break before line N is break marker at index N-1
            if (cursor.row > 0) {
                const marker_pos = self.tb.rope.getMarker(.brk, cursor.row - 1);

                if (marker_pos) |pos| {
                    const break_idx = pos.leaf_index;

                    // Calculate the width of the previous line BEFORE deleting the break
                    const prev_line_width = self.getLineWidth(cursor.row - 1);

                    // Delete the break segment
                    try self.tb.rope.delete(break_idx);

                    // Also remove the following linestart if present
                    // After deleting break_idx, the linestart that was at break_idx+1 is now at break_idx
                    if (self.tb.rope.get(break_idx)) |seg| {
                        if (seg.isLineStart()) {
                            try self.tb.rope.delete(break_idx);
                        }
                    }

                    // Mark views dirty
                    self.tb.markViewsDirty();

                    // Move cursor to end of previous line (using the width we calculated before the merge)
                    self.cursors.items[0] = .{ .row = cursor.row - 1, .col = prev_line_width, .desired_col = prev_line_width };
                }
            }
        } else {
            // Delete one character before cursor
            const cursor_offset = iter_mod.coordsToOffset(&self.tb.rope, cursor.row, cursor.col) orelse return;
            if (cursor_offset == 0) return;

            const delete_start = cursor_offset - 1;
            const delete_end = cursor_offset;

            const splitter = self.makeSegmentSplitter();
            try self.tb.rope.deleteRangeByWeight(delete_start, delete_end, &splitter);

            // Update char count
            if (self.tb.char_count > 0) {
                self.tb.char_count -= 1;
            }

            // Mark views dirty
            self.tb.markViewsDirty();

            // Update cursor position
            if (iter_mod.offsetToCoords(&self.tb.rope, delete_start)) |coords| {
                self.cursors.items[0] = .{ .row = coords.row, .col = coords.col, .desired_col = coords.col };
            }
        }
    }

    pub fn deleteForward(self: *EditBuffer) !void {
        if (self.cursors.items.len == 0) return;
        const cursor = self.cursors.items[0];

        // Check if we're at end of a line using O(1) marker lookup
        const line_width = self.getLineWidth(cursor.row);

        if (cursor.col >= line_width) {
            // At end of line - use O(1) marker lookup to find the break ending this line
            // The break that ends line N is break marker at index N
            const marker_pos = self.tb.rope.getMarker(.brk, cursor.row);

            if (marker_pos) |pos| {
                const break_idx = pos.leaf_index;

                // Delete the break segment
                try self.tb.rope.delete(break_idx);

                // Also remove the following linestart if present
                // After deleting break_idx, the linestart that was at break_idx+1 is now at break_idx
                if (self.tb.rope.get(break_idx)) |seg| {
                    if (seg.isLineStart()) {
                        try self.tb.rope.delete(break_idx);
                    }
                }

                // Mark views dirty
                self.tb.markViewsDirty();

                // Cursor stays at same position
            }
        } else {
            // Delete one character after cursor
            const cursor_offset = iter_mod.coordsToOffset(&self.tb.rope, cursor.row, cursor.col) orelse return;

            // Check if we're at the end
            if (cursor_offset >= self.tb.char_count) return;

            const delete_start = cursor_offset;
            const delete_end = cursor_offset + 1;

            const splitter = self.makeSegmentSplitter();
            try self.tb.rope.deleteRangeByWeight(delete_start, delete_end, &splitter);

            // Update char count
            if (self.tb.char_count > 0) {
                self.tb.char_count -= 1;
            }

            // Mark views dirty
            self.tb.markViewsDirty();

            // Cursor stays at same position (content shifted left)
        }
    }

    pub fn moveLeft(self: *EditBuffer) void {
        if (self.cursors.items.len == 0) return;
        if (self.cursors.items[0].col > 0) {
            self.cursors.items[0].col -= 1;
        } else if (self.cursors.items[0].row > 0) {
            // Move to end of previous line
            self.cursors.items[0].row -= 1;
            // Get the width of the previous line using O(1) marker lookup
            const line_width = self.getLineWidth(self.cursors.items[0].row);
            self.cursors.items[0].col = line_width;
        }
        // Horizontal movement resets desired column
        self.cursors.items[0].desired_col = self.cursors.items[0].col;
    }

    pub fn moveRight(self: *EditBuffer) void {
        if (self.cursors.items.len == 0) return;
        const cursor = &self.cursors.items[0];

        // Get current line width using O(1) marker lookup
        const line_width = self.getLineWidth(cursor.row);
        const line_count = self.tb.getLineCount();

        if (cursor.col < line_width) {
            cursor.col += 1;
        } else if (cursor.row + 1 < line_count) {
            // Move to start of next line
            cursor.row += 1;
            cursor.col = 0;
        }
        // Horizontal movement resets desired column
        cursor.desired_col = cursor.col;
    }

    pub fn moveUp(self: *EditBuffer) void {
        if (self.cursors.items.len == 0) return;
        const cursor = &self.cursors.items[0];

        if (cursor.row > 0) {
            // If this is the first vertical movement, save current column as desired
            if (cursor.desired_col == 0) {
                cursor.desired_col = cursor.col;
            }

            cursor.row -= 1;

            // Get line width using O(1) marker lookup
            const line_width = self.getLineWidth(cursor.row);

            // Move to desired column if possible, otherwise clamp to line end
            cursor.col = @min(cursor.desired_col, line_width);
        }
    }

    pub fn moveDown(self: *EditBuffer) void {
        if (self.cursors.items.len == 0) return;
        const cursor = &self.cursors.items[0];

        // Get line count
        const line_count = self.tb.getLineCount();
        if (cursor.row + 1 < line_count) {
            // If this is the first vertical movement, save current column as desired
            if (cursor.desired_col == 0) {
                cursor.desired_col = cursor.col;
            }

            cursor.row += 1;

            // Get line width using O(1) marker lookup
            const line_width = self.getLineWidth(cursor.row);

            // Move to desired column if possible, otherwise clamp to line end
            cursor.col = @min(cursor.desired_col, line_width);
        }
    }

    pub fn setText(self: *EditBuffer, text: []const u8) !void {
        try self.tb.setText(text);
        try self.setCursor(0, 0);
    }

    pub fn getText(self: *EditBuffer, out_buffer: []u8) usize {
        return self.tb.getPlainTextIntoBuffer(out_buffer);
    }

    pub fn deleteLine(self: *EditBuffer) !void {
        const cursor = self.getPrimaryCursor();
        const line_count = self.tb.lineCount();

        if (cursor.row >= line_count) return;

        if (cursor.row + 1 < line_count) {
            // Not the last line - delete line content and merge with next
            try self.deleteRange(
                .{ .row = cursor.row, .col = 0 },
                .{ .row = cursor.row + 1, .col = 0 },
            );
        } else if (cursor.row > 0) {
            // Last line but not the only line - use O(1) marker lookup to find the break
            // The break before line N is break marker at index N-1
            const marker_pos = self.tb.rope.getMarker(.brk, cursor.row - 1);

            if (marker_pos) |pos| {
                const break_idx = pos.leaf_index;

                // First delete the line content
                const line_width = self.getLineWidth(cursor.row);
                if (line_width > 0) {
                    try self.deleteRange(
                        .{ .row = cursor.row, .col = 0 },
                        .{ .row = cursor.row, .col = line_width },
                    );
                }

                // Then delete the break segment
                try self.tb.rope.delete(break_idx);

                // And remove the following linestart
                if (self.tb.rope.get(break_idx)) |seg| {
                    if (seg.isLineStart()) {
                        try self.tb.rope.delete(break_idx);
                    }
                }

                self.tb.markViewsDirty();

                // Move cursor to end of previous line
                const prev_line_width = self.getLineWidth(cursor.row - 1);
                self.cursors.items[0] = .{ .row = cursor.row - 1, .col = prev_line_width, .desired_col = prev_line_width };
            }
        } else {
            // Only line - clear content
            const line_width = self.getLineWidth(cursor.row);
            if (line_width > 0) {
                try self.deleteRange(
                    .{ .row = cursor.row, .col = 0 },
                    .{ .row = cursor.row, .col = line_width },
                );
            }
        }
    }

    // TODO Remove
    pub fn moveCursorToLineStart(self: *EditBuffer) !void {
        const cursor = self.getPrimaryCursor();
        try self.setCursor(cursor.row, 0);
    }

    pub fn gotoLine(self: *EditBuffer, line: u32) !void {
        const line_count = self.tb.lineCount();
        const target_line = @min(line, line_count -| 1);
        try self.setCursor(target_line, 0);
    }

    pub fn getCursorPosition(self: *const EditBuffer) struct { line: u32, char_pos: u32, visual_col: u32 } {
        const cursor = self.getPrimaryCursor();

        return .{
            .line = cursor.row,
            .visual_col = cursor.col,
            // TODO: Reimplement absolute character position calculation using rope iterators
            .char_pos = cursor.col,
        };
    }
};
