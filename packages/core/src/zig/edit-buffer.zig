const std = @import("std");
const Allocator = std.mem.Allocator;
const tb = @import("text-buffer.zig");
const iter_mod = @import("text-buffer-iterators.zig");
const seg_mod = @import("text-buffer-segment.zig");
const gp = @import("grapheme.zig");
const gwidth = @import("gwidth.zig");
const utf8 = @import("utf8.zig");
const event_emitter = @import("event-emitter.zig");
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

pub const EditBufferEvent = enum {
    cursorChanged,
};

/// Cursor position (row, col in display-width coordinates)
pub const Cursor = struct {
    row: u32,
    col: u32,
    desired_col: u32 = 0,
};

const AddBuffer = struct {
    mem_id: u8,
    ptr: [*]u8,
    len: usize,
    cap: usize,
    allocator: Allocator,

    fn init(allocator: Allocator, text_buffer: *UnifiedTextBuffer, initial_cap: usize) !AddBuffer {
        const mem = try allocator.alloc(u8, initial_cap);
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

        // TODO: Create a new buffer, register the new buffer and use the new mem_id for subsequent inserts
        const new_cap = @max(self.cap * 2, self.len + need);
        const new_mem = try self.allocator.alloc(u8, new_cap);
        const new_mem_id = try text_buffer.registerMemBuffer(new_mem, true);
        self.mem_id = new_mem_id;
        self.ptr = new_mem.ptr;
        self.len = 0;
        self.cap = new_mem.len;
    }

    fn append(self: *AddBuffer, bytes: []const u8) struct { mem_id: u8, start: u32, end: u32 } {
        std.debug.assert(self.len + bytes.len <= self.cap);
        const start: u32 = @intCast(self.len);

        const dest_slice = self.ptr[0..self.cap];
        @memcpy(dest_slice[self.len .. self.len + bytes.len], bytes);

        self.len += bytes.len;
        const end: u32 = @intCast(self.len);
        return .{ .mem_id = self.mem_id, .start = start, .end = end };
    }
};

pub const EditBuffer = struct {
    tb: *UnifiedTextBuffer,
    add_buffer: AddBuffer,
    cursors: std.ArrayListUnmanaged(Cursor),
    allocator: Allocator,
    events: event_emitter.EventEmitter(EditBufferEvent),

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

        try cursors.append(allocator, .{ .row = 0, .col = 0 });

        self.* = .{
            .tb = text_buffer,
            .add_buffer = add_buffer,
            .cursors = cursors,
            .allocator = allocator,
            .events = event_emitter.EventEmitter(EditBufferEvent).init(allocator),
        };

        const empty_mem_id = try text_buffer.registerMemBuffer(&[_]u8{}, false);
        const empty_chunk = text_buffer.createChunk(empty_mem_id, 0, 0);
        try text_buffer.rope.append(Segment{ .linestart = {} });
        try text_buffer.rope.append(Segment{ .text = empty_chunk });

        return self;
    }

    pub fn deinit(self: *EditBuffer) void {
        // Registry owns all AddBuffer memory, don't free it manually
        self.events.deinit();
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
        const line_count = self.tb.lineCount();
        const clamped_row = @min(row, line_count -| 1);

        const line_width = self.getLineWidth(clamped_row);
        const clamped_col = @min(col, line_width);

        if (self.cursors.items.len == 0) {
            try self.cursors.append(self.allocator, .{ .row = clamped_row, .col = clamped_col, .desired_col = clamped_col });
        } else {
            self.cursors.items[0] = .{ .row = clamped_row, .col = clamped_col, .desired_col = clamped_col };
        }

        self.events.emit(.cursorChanged);
    }

    fn ensureAddCapacity(self: *EditBuffer, need: usize) !void {
        try self.add_buffer.ensureCapacity(self.tb, need);
    }

    /// Get line width using O(1) marker lookups
    /// Uses linestart markers to determine line boundaries
    fn getLineWidth(self: *const EditBuffer, row: u32) u32 {
        return iter_mod.lineWidthAt(&self.tb.rope, row);
    }

    /// Get the display width of the grapheme at or after the given column on a line
    /// Returns 0 if at end of line
    fn getGraphemeWidthAt(self: *const EditBuffer, row: u32, col: u32) u32 {
        const line_width = self.getLineWidth(row);
        if (col >= line_width) return 0;

        const linestart_marker = self.tb.rope.getMarker(.linestart, row) orelse return 0;
        const line_start_idx = linestart_marker.leaf_index;

        var accumulated_width: u32 = 0;
        var seg_idx = line_start_idx + 1; // Skip the linestart marker itself

        while (seg_idx < self.tb.rope.count()) : (seg_idx += 1) {
            const seg = self.tb.rope.get(seg_idx) orelse break;

            if (seg.isBreak() or seg.isLineStart()) break;

            if (seg.asText()) |chunk| {
                const chunk_bytes = chunk.getBytes(&self.tb.mem_registry);
                var iter = self.tb.getGraphemeIterator(chunk_bytes);

                while (iter.next()) |gc| {
                    const gbytes = gc.bytes(chunk_bytes);
                    const g_width: u32 = @intCast(gwidth.gwidth(gbytes, self.tb.width_method, &self.tb.display_width));

                    if (accumulated_width == col) {
                        return g_width;
                    }

                    accumulated_width += g_width;
                    if (accumulated_width > col) break;
                }
            }
        }

        return 0;
    }

    /// Get the display width of the grapheme before the given column on a line
    /// Returns 0 if at start of line
    fn getPrevGraphemeWidth(self: *const EditBuffer, row: u32, col: u32) u32 {
        if (col == 0) return 0;

        const line_width = self.getLineWidth(row);
        if (col > line_width) return 0;

        const linestart_marker = self.tb.rope.getMarker(.linestart, row) orelse return 0;
        const line_start_idx = linestart_marker.leaf_index;

        var accumulated_width: u32 = 0;
        var prev_g_width: u32 = 0;
        var seg_idx = line_start_idx + 1; // Skip the linestart marker itself

        while (seg_idx < self.tb.rope.count()) : (seg_idx += 1) {
            const seg = self.tb.rope.get(seg_idx) orelse break;

            if (seg.isBreak() or seg.isLineStart()) break;

            if (seg.asText()) |chunk| {
                const chunk_bytes = chunk.getBytes(&self.tb.mem_registry);
                var iter = self.tb.getGraphemeIterator(chunk_bytes);

                while (iter.next()) |gc| {
                    const gbytes = gc.bytes(chunk_bytes);
                    const g_width: u32 = @intCast(gwidth.gwidth(gbytes, self.tb.width_method, &self.tb.display_width));

                    if (accumulated_width == col) {
                        return prev_g_width;
                    }

                    prev_g_width = g_width;
                    accumulated_width += g_width;
                }
            }
        }

        return prev_g_width;
    }

    /// Split a TextChunk at a specific weight (display width)
    /// Returns left and right chunks
    /// Simple grapheme iteration accumulating display width
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
        var iter = self.tb.getGraphemeIterator(chunk_bytes);

        var accumulated_width: u32 = 0;
        var split_byte_offset: u32 = 0;

        while (iter.next()) |gc| {
            const gbytes = gc.bytes(chunk_bytes);
            const width_u16: u16 = gwidth.gwidth(gbytes, self.tb.width_method, &self.tb.display_width);

            if (width_u16 == 0) {
                split_byte_offset += @intCast(gbytes.len);
                continue;
            }

            const g_width: u32 = @intCast(width_u16);

            if (accumulated_width >= weight) break;

            accumulated_width += g_width;
            split_byte_offset += @intCast(gbytes.len);
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

        if (leaf.asText()) |chunk| {
            const result = try edit_buf.splitChunkAtWeight(chunk, weight_in_leaf);
            return .{
                .left = Segment{ .text = result.left },
                .right = Segment{ .text = result.right },
            };
        } else {
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

        try self.autoStoreUndo();

        const cursor = self.cursors.items[0];

        try self.ensureAddCapacity(bytes.len);

        // Convert cursor position to character offset
        const insert_offset = iter_mod.coordsToOffset(&self.tb.rope, cursor.row, cursor.col) orelse return EditBufferError.InvalidCursor;

        const chunk_ref = self.add_buffer.append(bytes);
        const base_mem_id = chunk_ref.mem_id;
        const base_start = chunk_ref.start;

        // Detect line breaks using SIMD16
        var break_result = utf8.LineBreakResult.init(self.allocator);
        defer break_result.deinit();
        try utf8.findLineBreaksSIMD16(bytes, &break_result);

        var segments = std.ArrayList(Segment).init(self.allocator);
        defer segments.deinit();

        // Special handling for insertion at column 0 (start of line):
        // Linestart markers have weight 0, so inserting at their weight position
        // places content BEFORE the marker, which puts it on the previous line.
        // Solution: When at col==0 on row>0, use the rope's insert-by-index API
        // to insert AFTER the linestart marker instead of before it.
        const insert_at_line_start = (cursor.col == 0 and cursor.row > 0);
        var insert_after_marker_index: ?usize = null;

        if (insert_at_line_start) {
            // Find the linestart marker for this row and get its leaf index
            if (self.tb.rope.getMarker(.linestart, cursor.row)) |marker| {
                insert_after_marker_index = marker.leaf_index;
            }
        }

        var local_start: u32 = 0;
        var inserted_width: u32 = 0;
        var width_after_last_break: u32 = 0; // Width of text after the last newline

        for (break_result.breaks.items) |line_break| {
            const break_pos: u32 = @intCast(line_break.pos);
            const local_end: u32 = switch (line_break.kind) {
                .CRLF => break_pos - 1,
                .CR, .LF => break_pos,
            };

            if (local_end > local_start) {
                const chunk = self.tb.createChunk(base_mem_id, base_start + local_start, base_start + local_end);
                try segments.append(Segment{ .text = chunk });
                inserted_width += chunk.width;
            }

            try segments.append(Segment{ .brk = {} });
            try segments.append(Segment{ .linestart = {} });

            local_start = break_pos + 1;
            width_after_last_break = 0;
        }

        // Add remaining text after last break (or entire text if no breaks)
        if (local_start < bytes.len) {
            const chunk = self.tb.createChunk(base_mem_id, base_start + local_start, base_start + @as(u32, @intCast(bytes.len)));
            try segments.append(Segment{ .text = chunk });
            width_after_last_break = chunk.width;
            inserted_width += chunk.width;
        }

        if (segments.items.len > 0) {
            if (insert_after_marker_index) |marker_idx| {
                var idx: usize = marker_idx + 1;
                for (segments.items) |seg| {
                    try self.tb.rope.insert(@intCast(idx), seg);
                    idx += 1;
                }
            } else {
                const splitter = self.makeSegmentSplitter();
                try self.tb.rope.insertSliceByWeight(insert_offset, segments.items, &splitter);
            }

            // Update char count
            self.tb.char_count += inserted_width;
        }

        const num_breaks = break_result.breaks.items.len;
        if (num_breaks > 0) {
            self.cursors.items[0] = .{
                .row = cursor.row + @as(u32, @intCast(num_breaks)),
                .col = width_after_last_break,
                .desired_col = width_after_last_break,
            };
        } else {
            self.cursors.items[0] = .{
                .row = cursor.row,
                .col = cursor.col + inserted_width,
                .desired_col = cursor.col + inserted_width,
            };
        }

        self.tb.markViewsDirty();
        self.events.emit(.cursorChanged);
    }

    pub fn deleteRange(self: *EditBuffer, start_cursor: Cursor, end_cursor: Cursor) !void {
        var start = start_cursor;
        var end = end_cursor;
        if (start.row > end.row or (start.row == end.row and start.col > end.col)) {
            const temp = start;
            start = end;
            end = temp;
        }

        if (start.row == end.row and start.col == end.col) return;

        try self.autoStoreUndo();

        // Convert to character offsets
        const start_offset = iter_mod.coordsToOffset(&self.tb.rope, start.row, start.col) orelse return EditBufferError.InvalidCursor;
        const end_offset = iter_mod.coordsToOffset(&self.tb.rope, end.row, end.col) orelse return EditBufferError.InvalidCursor;

        if (start_offset >= end_offset) return;

        const deleted_width = end_offset - start_offset;
        const deleted_lines = end.row - start.row;

        // Delete the range using rope's deleteRangeByWeight with splitter
        const splitter = self.makeSegmentSplitter();
        try self.tb.rope.deleteRangeByWeight(start_offset, end_offset, &splitter);

        // Update char count
        if (self.tb.char_count >= deleted_width) {
            self.tb.char_count -= deleted_width;
        } else {
            self.tb.char_count = 0;
        }

        // When deleting across line boundaries, deleteRangeByWeight removes text and breaks
        // but not zero-weight linestart markers. Clean up orphaned linestart markers.
        // After deletion, linestart markers at start.row+1 onwards are orphaned if they exist.
        if (deleted_lines > 0) {
            // Remove deleted_lines number of linestart markers starting from start.row
            // (Don't remove linestart at start.row itself, only the ones after it)
            var removed_count: u32 = 0;
            while (removed_count < deleted_lines) : (removed_count += 1) {
                // Try to get linestart at start.row (this is the one that should remain)
                // Check if there's another linestart right after it (the orphaned one)
                if (self.tb.rope.getMarker(.linestart, start.row)) |marker| {
                    const idx = marker.leaf_index;
                    // Look for linestart markers after this one
                    var search_idx = idx + 1;
                    while (search_idx < self.tb.rope.count()) : (search_idx += 1) {
                        if (self.tb.rope.get(search_idx)) |seg| {
                            if (seg.isLineStart()) {
                                // Found an orphaned linestart - delete it
                                try self.tb.rope.delete(search_idx);
                                break;
                            } else if (seg.isBreak()) {
                                // Hit a break before finding linestart - not orphaned
                                break;
                            }
                        }
                    }
                } else {
                    break;
                }
            }
        }

        // Clean up orphaned break markers at the end of the rope
        // A break at the end is orphaned if not followed by linestart+text
        // Don't remove linestart markers - we need at least one for the first line
        while (true) {
            const rope_count = self.tb.rope.count();
            if (rope_count == 0) break;

            const last_seg = self.tb.rope.get(rope_count - 1) orelse break;

            if (last_seg.isBreak()) {
                // Break at end is orphaned
                try self.tb.rope.delete(rope_count - 1);
                continue;
            }
            break;
        }

        // Ensure we always have at least linestart + text (even if empty text)
        if (self.tb.rope.count() == 1) {
            if (self.tb.rope.get(0)) |first_seg| {
                if (first_seg.isLineStart()) {
                    // Add empty text chunk
                    const empty_mem_id = try self.tb.registerMemBuffer(&[_]u8{}, false);
                    const empty_chunk = self.tb.createChunk(empty_mem_id, 0, 0);
                    try self.tb.rope.append(Segment{ .text = empty_chunk });
                }
            }
        }

        self.tb.markViewsDirty();

        // Set cursor to start of deleted range, but clamp to valid line
        if (self.cursors.items.len > 0) {
            const line_count = self.tb.lineCount();
            const clamped_row = if (start.row >= line_count) line_count -| 1 else start.row;
            const line_width = if (line_count > 0) self.getLineWidth(clamped_row) else 0;
            const clamped_col = @min(start.col, line_width);

            self.cursors.items[0] = .{ .row = clamped_row, .col = clamped_col, .desired_col = clamped_col };
        }

        self.events.emit(.cursorChanged);
    }

    pub fn backspace(self: *EditBuffer) !void {
        if (self.cursors.items.len == 0) return;
        const cursor = self.cursors.items[0];

        if (cursor.row == 0 and cursor.col == 0) return;

        if (cursor.col == 0) {
            // At start of line - delete from end of previous line to current position
            if (cursor.row > 0) {
                const prev_line_width = self.getLineWidth(cursor.row - 1);
                try self.deleteRange(
                    .{ .row = cursor.row - 1, .col = prev_line_width },
                    .{ .row = cursor.row, .col = 0 },
                );
            }
        } else {
            // Delete previous grapheme
            const prev_grapheme_width = self.getPrevGraphemeWidth(cursor.row, cursor.col);
            if (prev_grapheme_width == 0) return; // Nothing to delete

            const target_col = cursor.col - prev_grapheme_width;
            try self.deleteRange(
                .{ .row = cursor.row, .col = target_col },
                .{ .row = cursor.row, .col = cursor.col },
            );
        }
    }

    pub fn deleteForward(self: *EditBuffer) !void {
        if (self.cursors.items.len == 0) return;
        const cursor = self.cursors.items[0];

        try self.autoStoreUndo();

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

                if (self.tb.char_count > 0) {
                    self.tb.char_count -= 1;
                }

                self.tb.markViewsDirty();
            }
        } else {
            const start_offset = iter_mod.coordsToOffset(&self.tb.rope, cursor.row, cursor.col) orelse return;
            const end_offset = iter_mod.coordsToOffset(&self.tb.rope, cursor.row, cursor.col + 1) orelse return;

            const splitter = self.makeSegmentSplitter();
            try self.tb.rope.deleteRangeByWeight(start_offset, end_offset, &splitter);

            if (self.tb.char_count > 0) {
                self.tb.char_count -= 1;
            }

            self.tb.markViewsDirty();
        }
    }

    pub fn moveLeft(self: *EditBuffer) void {
        if (self.cursors.items.len == 0) return;
        const cursor = &self.cursors.items[0];

        if (cursor.col > 0) {
            const prev_width = self.getPrevGraphemeWidth(cursor.row, cursor.col);
            cursor.col -= prev_width;
        } else if (cursor.row > 0) {
            cursor.row -= 1;
            const line_width = self.getLineWidth(cursor.row);
            cursor.col = line_width;
        }
        cursor.desired_col = cursor.col;

        self.events.emit(.cursorChanged);
    }

    pub fn moveRight(self: *EditBuffer) void {
        if (self.cursors.items.len == 0) return;
        const cursor = &self.cursors.items[0];

        const line_width = self.getLineWidth(cursor.row);
        const line_count = self.tb.getLineCount();

        if (cursor.col < line_width) {
            const grapheme_width = self.getGraphemeWidthAt(cursor.row, cursor.col);
            cursor.col += grapheme_width;
        } else if (cursor.row + 1 < line_count) {
            cursor.row += 1;
            cursor.col = 0;
        }
        cursor.desired_col = cursor.col;

        self.events.emit(.cursorChanged);
    }

    pub fn moveUp(self: *EditBuffer) void {
        if (self.cursors.items.len == 0) return;
        const cursor = &self.cursors.items[0];

        if (cursor.row > 0) {
            if (cursor.desired_col == 0) {
                cursor.desired_col = cursor.col;
            }

            cursor.row -= 1;

            const line_width = self.getLineWidth(cursor.row);

            cursor.col = @min(cursor.desired_col, line_width);
        }

        self.events.emit(.cursorChanged);
    }

    pub fn moveDown(self: *EditBuffer) void {
        if (self.cursors.items.len == 0) return;
        const cursor = &self.cursors.items[0];

        const line_count = self.tb.getLineCount();
        if (cursor.row + 1 < line_count) {
            if (cursor.desired_col == 0) {
                cursor.desired_col = cursor.col;
            }

            cursor.row += 1;

            const line_width = self.getLineWidth(cursor.row);

            cursor.col = @min(cursor.desired_col, line_width);
        }

        self.events.emit(.cursorChanged);
    }

    pub fn setText(self: *EditBuffer, text: []const u8) !void {
        try self.tb.setText(text);

        const new_mem = try self.allocator.alloc(u8, self.add_buffer.cap);
        const new_mem_id = try self.tb.registerMemBuffer(new_mem, true);
        self.add_buffer.mem_id = new_mem_id;
        self.add_buffer.ptr = new_mem.ptr;
        self.add_buffer.len = 0;

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
            try self.deleteRange(
                .{ .row = cursor.row, .col = 0 },
                .{ .row = cursor.row + 1, .col = 0 },
            );
        } else if (cursor.row > 0) {
            const prev_line_width = self.getLineWidth(cursor.row - 1);
            const curr_line_width = self.getLineWidth(cursor.row);

            try self.deleteRange(
                .{ .row = cursor.row - 1, .col = prev_line_width },
                .{ .row = cursor.row, .col = curr_line_width },
            );

            self.tb.markViewsDirty();

            self.cursors.items[0] = .{ .row = cursor.row - 1, .col = prev_line_width, .desired_col = prev_line_width };
        } else {
            const line_width = self.getLineWidth(cursor.row);
            if (line_width > 0) {
                try self.deleteRange(
                    .{ .row = cursor.row, .col = 0 },
                    .{ .row = cursor.row, .col = line_width },
                );
            }
        }
    }

    pub fn gotoLine(self: *EditBuffer, line: u32) !void {
        const line_count = self.tb.lineCount();
        const target_line = @min(line, line_count -| 1);

        if (line >= line_count) {
            const last_line_width = self.getLineWidth(target_line);
            try self.setCursor(target_line, last_line_width);
        } else {
            try self.setCursor(target_line, 0);
        }
    }

    pub fn getCursorPosition(self: *const EditBuffer) struct { line: u32, visual_col: u32 } {
        const cursor = self.getPrimaryCursor();

        return .{
            .line = cursor.row,
            .visual_col = cursor.col,
        };
    }

    pub fn debugLogRope(self: *const EditBuffer) void {
        self.tb.debugLogRope();
    }

    fn autoStoreUndo(self: *EditBuffer) !void {
        try self.tb.rope.store_undo("edit");
    }

    pub fn undo(self: *EditBuffer) ![]const u8 {
        const prev_meta = try self.tb.rope.undo("current");

        self.tb.char_count = self.tb.rope.root.metrics().weight();

        const cursor = self.getPrimaryCursor();
        try self.setCursor(cursor.row, cursor.col);

        self.tb.markViewsDirty();
        self.events.emit(.cursorChanged);

        return prev_meta;
    }

    pub fn redo(self: *EditBuffer) ![]const u8 {
        const next_meta = try self.tb.rope.redo();

        self.tb.char_count = self.tb.rope.root.metrics().weight();

        const cursor = self.getPrimaryCursor();
        try self.setCursor(cursor.row, cursor.col);

        self.tb.markViewsDirty();
        self.events.emit(.cursorChanged);

        return next_meta;
    }

    pub fn canUndo(self: *const EditBuffer) bool {
        return self.tb.rope.can_undo();
    }

    pub fn canRedo(self: *const EditBuffer) bool {
        return self.tb.rope.can_redo();
    }

    pub fn clearHistory(self: *EditBuffer) void {
        self.tb.rope.clear_history();
    }
};
