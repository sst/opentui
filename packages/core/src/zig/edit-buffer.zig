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
        }

        // Add remaining text after last break (or entire text if no breaks)
        if (local_start < bytes.len) {
            const chunk = self.tb.createChunk(base_mem_id, base_start + local_start, base_start + @as(u32, @intCast(bytes.len)));
            try segments.append(Segment{ .text = chunk });
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
        const new_offset = insert_offset + inserted_width;
        if (iter_mod.offsetToCoords(&self.tb.rope, new_offset)) |coords| {
            self.cursors.items[0] = .{ .row = coords.row, .col = coords.col, .desired_col = coords.col };
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
            // At start of line - delete the break segment before this line to merge with previous
            // Need to find the break segment that precedes this line
            const Context = struct {
                target_row: u32,
                break_seg_idx: ?u32 = null,
                current_line: u32 = 0,
                seg_idx: u32 = 0,

                fn callback(ctx_ptr: *anyopaque, seg: *const Segment, idx: u32) UnifiedRope.Node.WalkerResult {
                    const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                    ctx.seg_idx = idx;

                    if (seg.isBreak()) {
                        // This break ends line current_line and starts line current_line+1
                        if (ctx.current_line + 1 == ctx.target_row) {
                            ctx.break_seg_idx = idx;
                            return .{ .keep_walking = false };
                        }
                        ctx.current_line += 1;
                    }
                    return .{};
                }
            };

            var ctx = Context{ .target_row = cursor.row };
            self.tb.rope.walk(&ctx, Context.callback) catch {};

            if (ctx.break_seg_idx) |break_idx| {
                // Calculate the width of the previous line BEFORE deleting the break
                var prev_line_width: u32 = 0;
                if (cursor.row > 0) {
                    const FindWidth = struct {
                        row: u32,
                        width: u32 = 0,
                        fn line_callback(line_ctx_ptr: *anyopaque, line_info: iter_mod.LineInfo) void {
                            const line_ctx = @as(*@This(), @ptrCast(@alignCast(line_ctx_ptr)));
                            if (line_info.line_idx == line_ctx.row) {
                                line_ctx.width = line_info.width;
                            }
                        }
                    };
                    var find_ctx = FindWidth{ .row = cursor.row - 1 };
                    iter_mod.walkLines(&self.tb.rope, &find_ctx, FindWidth.line_callback);
                    prev_line_width = find_ctx.width;
                }

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
                if (cursor.row > 0) {
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

        // Check if we're at end of a line
        const FindLineWidth = struct {
            row: u32,
            width: u32 = 0,
            found: bool = false,
            fn callback(ctx_ptr: *anyopaque, line_info: iter_mod.LineInfo) void {
                const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                if (line_info.line_idx == ctx.row) {
                    ctx.width = line_info.width;
                    ctx.found = true;
                }
            }
        };
        var line_ctx = FindLineWidth{ .row = cursor.row };
        iter_mod.walkLines(&self.tb.rope, &line_ctx, FindLineWidth.callback);

        if (line_ctx.found and cursor.col >= line_ctx.width) {
            // At end of line - delete the break segment after this line to merge with next
            const Context = struct {
                target_row: u32,
                break_seg_idx: ?u32 = null,
                current_line: u32 = 0,

                fn callback(ctx_ptr: *anyopaque, seg: *const Segment, idx: u32) UnifiedRope.Node.WalkerResult {
                    const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));

                    if (seg.isBreak()) {
                        // This break ends line current_line
                        if (ctx.current_line == ctx.target_row) {
                            ctx.break_seg_idx = idx;
                            return .{ .keep_walking = false };
                        }
                        ctx.current_line += 1;
                    }
                    return .{};
                }
            };

            var ctx = Context{ .target_row = cursor.row };
            self.tb.rope.walk(&ctx, Context.callback) catch {};

            if (ctx.break_seg_idx) |break_idx| {
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
            // Find the width of the previous line
            const Context = struct {
                row: u32,
                width: u32 = 0,
                fn callback(ctx_ptr: *anyopaque, line_info: iter_mod.LineInfo) void {
                    const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                    if (line_info.line_idx == ctx.row) {
                        ctx.width = line_info.width;
                    }
                }
            };
            var ctx = Context{ .row = self.cursors.items[0].row };
            iter_mod.walkLines(&self.tb.rope, &ctx, Context.callback);
            self.cursors.items[0].col = ctx.width;
        }
        // Horizontal movement resets desired column
        self.cursors.items[0].desired_col = self.cursors.items[0].col;
    }

    pub fn moveRight(self: *EditBuffer) void {
        if (self.cursors.items.len == 0) return;
        const cursor = &self.cursors.items[0];

        // Find current line width
        const Context = struct {
            row: u32,
            width: u32 = 0,
            line_count: u32 = 0,
            fn callback(ctx_ptr: *anyopaque, line_info: iter_mod.LineInfo) void {
                const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                if (line_info.line_idx == ctx.row) {
                    ctx.width = line_info.width;
                }
                ctx.line_count = line_info.line_idx + 1;
            }
        };
        var ctx = Context{ .row = cursor.row };
        iter_mod.walkLines(&self.tb.rope, &ctx, Context.callback);

        if (cursor.col < ctx.width) {
            cursor.col += 1;
        } else if (cursor.row + 1 < ctx.line_count) {
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

            // Try to move to desired column, but clamp to line width
            const Context = struct {
                row: u32,
                width: u32 = 0,
                fn callback(ctx_ptr: *anyopaque, line_info: iter_mod.LineInfo) void {
                    const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                    if (line_info.line_idx == ctx.row) {
                        ctx.width = line_info.width;
                    }
                }
            };
            var ctx = Context{ .row = cursor.row };
            iter_mod.walkLines(&self.tb.rope, &ctx, Context.callback);

            // Move to desired column if possible, otherwise clamp to line end
            cursor.col = @min(cursor.desired_col, ctx.width);
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

            // Try to move to desired column, but clamp to line width
            const Context = struct {
                row: u32,
                width: u32 = 0,
                fn callback(ctx_ptr: *anyopaque, line_info: iter_mod.LineInfo) void {
                    const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                    if (line_info.line_idx == ctx.row) {
                        ctx.width = line_info.width;
                    }
                }
            };
            var ctx = Context{ .row = cursor.row };
            iter_mod.walkLines(&self.tb.rope, &ctx, Context.callback);

            // Move to desired column if possible, otherwise clamp to line end
            cursor.col = @min(cursor.desired_col, ctx.width);
        }
    }
};
