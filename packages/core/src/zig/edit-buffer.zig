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
        // Register with owned=true so registry manages the lifetime
        // Never free this manually - registry owns it
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
        // Register with owned=true so registry manages it
        // Never free old buffer - rope may still reference it
        const new_mem_id = try text_buffer.registerMemBuffer(new_mem, true);

        // Switch to new buffer (old buffer remains in registry)
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

        // Initialize with one cursor at (0, 0)
        try cursors.append(allocator, .{ .row = 0, .col = 0 });

        self.* = .{
            .tb = text_buffer,
            .add_buffer = add_buffer,
            .cursors = cursors,
            .allocator = allocator,
            .events = event_emitter.EventEmitter(EditBufferEvent).init(allocator),
        };

        // Create an initial empty line (single empty text segment with linestart marker)
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
        // Clamp row to valid line range
        const line_count = self.tb.lineCount();
        const clamped_row = @min(row, line_count -| 1);

        // Clamp column to line width
        const line_width = self.getLineWidth(clamped_row);
        const clamped_col = @min(col, line_width);

        if (self.cursors.items.len == 0) {
            try self.cursors.append(self.allocator, .{ .row = clamped_row, .col = clamped_col, .desired_col = clamped_col });
        } else {
            self.cursors.items[0] = .{ .row = clamped_row, .col = clamped_col, .desired_col = clamped_col };
        }

        self.events.emit(.cursorChanged);
    }

    /// Ensure add buffer has capacity for n bytes
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

        // Find the text segments for this line
        const linestart_marker = self.tb.rope.getMarker(.linestart, row) orelse return 0;
        const line_start_idx = linestart_marker.leaf_index;

        // Walk segments from linestart to accumulate width until we reach target column
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

        // Find the text segments for this line
        const linestart_marker = self.tb.rope.getMarker(.linestart, row) orelse return 0;
        const line_start_idx = linestart_marker.leaf_index;

        // Walk segments and track grapheme widths
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

            // Stop when we've accumulated the target weight
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

        // Insert segments into rope
        if (segments.items.len > 0) {
            if (insert_after_marker_index) |marker_idx| {
                // Insert at column 0: use index-based insertion to go AFTER the linestart marker
                // Insert segments one by one after the marker
                var idx: usize = marker_idx + 1;
                for (segments.items) |seg| {
                    try self.tb.rope.insert(@intCast(idx), seg);
                    idx += 1;
                }
            } else {
                // Normal insertion: use weight-based insertion
                const splitter = self.makeSegmentSplitter();
                try self.tb.rope.insertSliceByWeight(insert_offset, segments.items, &splitter);
            }

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

        self.events.emit(.cursorChanged);
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

        self.events.emit(.cursorChanged);
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

                    // Decrement char_count by 1 (newline has weight 1)
                    if (self.tb.char_count > 0) {
                        self.tb.char_count -= 1;
                    }

                    // Mark views dirty
                    self.tb.markViewsDirty();

                    // Move cursor to end of previous line (using the width we calculated before the merge)
                    self.cursors.items[0] = .{ .row = cursor.row - 1, .col = prev_line_width, .desired_col = prev_line_width };
                }
            }
        } else {
            // Delete one character before cursor within the same line
            const target_col = cursor.col - 1;
            const start_offset = iter_mod.coordsToOffset(&self.tb.rope, cursor.row, target_col) orelse return;
            const end_offset = iter_mod.coordsToOffset(&self.tb.rope, cursor.row, cursor.col) orelse return;

            const splitter = self.makeSegmentSplitter();
            try self.tb.rope.deleteRangeByWeight(start_offset, end_offset, &splitter);

            // Update char count
            if (self.tb.char_count > 0) {
                self.tb.char_count -= 1;
            }

            // Mark views dirty
            self.tb.markViewsDirty();

            // Update cursor position
            self.cursors.items[0] = .{ .row = cursor.row, .col = target_col, .desired_col = target_col };
        }

        self.events.emit(.cursorChanged);
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

                // Decrement char_count by 1 (newline has weight 1)
                if (self.tb.char_count > 0) {
                    self.tb.char_count -= 1;
                }

                // Mark views dirty
                self.tb.markViewsDirty();

                // Cursor stays at same position
            }
        } else {
            // Delete one character after cursor within the same line
            const start_offset = iter_mod.coordsToOffset(&self.tb.rope, cursor.row, cursor.col) orelse return;
            const end_offset = iter_mod.coordsToOffset(&self.tb.rope, cursor.row, cursor.col + 1) orelse return;

            const splitter = self.makeSegmentSplitter();
            try self.tb.rope.deleteRangeByWeight(start_offset, end_offset, &splitter);

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
        const cursor = &self.cursors.items[0];

        if (cursor.col > 0) {
            // Get width of previous grapheme and move left by that amount
            const prev_width = self.getPrevGraphemeWidth(cursor.row, cursor.col);
            cursor.col -= prev_width;
        } else if (cursor.row > 0) {
            // Move to end of previous line
            cursor.row -= 1;
            // Get the width of the previous line using O(1) marker lookup
            const line_width = self.getLineWidth(cursor.row);
            cursor.col = line_width;
        }
        // Horizontal movement resets desired column
        cursor.desired_col = cursor.col;

        self.events.emit(.cursorChanged);
    }

    pub fn moveRight(self: *EditBuffer) void {
        if (self.cursors.items.len == 0) return;
        const cursor = &self.cursors.items[0];

        // Get current line width using O(1) marker lookup
        const line_width = self.getLineWidth(cursor.row);
        const line_count = self.tb.getLineCount();

        if (cursor.col < line_width) {
            // Get width of current grapheme and move right by that amount
            const grapheme_width = self.getGraphemeWidthAt(cursor.row, cursor.col);
            cursor.col += grapheme_width;
        } else if (cursor.row + 1 < line_count) {
            // Move to start of next line
            cursor.row += 1;
            cursor.col = 0;
        }
        // Horizontal movement resets desired column
        cursor.desired_col = cursor.col;

        self.events.emit(.cursorChanged);
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

        self.events.emit(.cursorChanged);
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

        self.events.emit(.cursorChanged);
    }

    pub fn setText(self: *EditBuffer, text: []const u8) !void {
        try self.tb.setText(text);

        // IMPORTANT: tb.setText() calls reset() which clears the memory registry.
        // Allocate a fresh AddBuffer since the old one is now orphaned in the registry.
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
            // Not the last line - delete line content and merge with next
            try self.deleteRange(
                .{ .row = cursor.row, .col = 0 },
                .{ .row = cursor.row + 1, .col = 0 },
            );
        } else if (cursor.row > 0) {
            // Last line but not the only line
            // Delete from end of previous line (including newline) to end of current line
            const prev_line_width = self.getLineWidth(cursor.row - 1);
            const curr_line_width = self.getLineWidth(cursor.row);

            try self.deleteRange(
                .{ .row = cursor.row - 1, .col = prev_line_width },
                .{ .row = cursor.row, .col = curr_line_width },
            );

            self.tb.markViewsDirty();

            // Move cursor to end of previous line
            self.cursors.items[0] = .{ .row = cursor.row - 1, .col = prev_line_width, .desired_col = prev_line_width };
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

    pub fn gotoLine(self: *EditBuffer, line: u32) !void {
        const line_count = self.tb.lineCount();
        const target_line = @min(line, line_count -| 1);

        // If line is beyond the last line, go to end of last line
        if (line >= line_count) {
            const last_line_width = self.getLineWidth(target_line);
            try self.setCursor(target_line, last_line_width);
        } else {
            try self.setCursor(target_line, 0);
        }
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

    pub fn debugLogRope(self: *const EditBuffer) void {
        self.tb.debugLogRope();
    }
};
