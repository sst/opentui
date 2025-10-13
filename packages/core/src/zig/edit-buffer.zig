const std = @import("std");
const Allocator = std.mem.Allocator;
const tb = @import("text-buffer.zig");
const gp = @import("grapheme.zig");
const gwidth = @import("gwidth.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");

const TextBufferRope = tb.TextBufferRope;
const TextChunk = tb.TextChunk;
const TextLine = tb.TextLine;
const GraphemeInfo = tb.GraphemeInfo;
const Rope = tb.Rope;
const ArrayRope = tb.ArrayRope;

pub const EditBufferError = error{
    OutOfMemory,
    InvalidCursor,
};

/// Cursor position (row, col in display-width coordinates)
pub const Cursor = struct {
    row: u32,
    col: u32,
};

/// Append-only buffer for inserted text
/// Grows as needed and registers with TextBuffer
const AddBuffer = struct {
    mem_id: u8,
    ptr: [*]u8,
    len: usize,
    cap: usize,
    allocator: Allocator,

    fn init(allocator: Allocator, text_buffer: *TextBufferRope, initial_cap: usize) !AddBuffer {
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

    fn ensureCapacity(self: *AddBuffer, text_buffer: *TextBufferRope, need: usize) !void {
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

/// EditBuffer provides cursor-based text editing on a TextBufferRope
pub const EditBuffer = struct {
    tb: *TextBufferRope,
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

        const text_buffer = try TextBufferRope.init(allocator, pool, width_method, graphemes_data, display_width);
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

        // Create an initial empty line
        var empty_line = try TextLine(Rope(TextChunk)).init(text_buffer.allocator);
        empty_line.char_offset = 0;
        empty_line.width = 0;
        try text_buffer.lines.append(empty_line);

        return self;
    }

    pub fn deinit(self: *EditBuffer) void {
        self.tb.deinit();
        self.cursors.deinit(self.allocator);
        self.allocator.destroy(self);
    }

    pub fn getTextBuffer(self: *EditBuffer) *TextBufferRope {
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
            try self.cursors.append(self.allocator, .{ .row = row, .col = col });
        } else {
            self.cursors.items[0] = .{ .row = row, .col = col };
        }
    }

    /// Split a TextChunk at a specific weight (display width)
    /// Returns left and right chunks
    fn splitChunkAtWeight(
        self: *EditBuffer,
        chunk: *const TextChunk,
        weight: u32,
    ) error{ OutOfBounds, OutOfMemory }!Rope(TextChunk).Node.LeafSplitResult {
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

        // Split inside the chunk using cached graphemes
        const graphemes = chunk.getGraphemes(
            &self.tb.mem_registry,
            self.tb.allocator,
            &self.tb.graphemes_data,
            self.tb.width_method,
            &self.tb.display_width,
        ) catch return error.OutOfMemory;

        var accumulated_width: u32 = 0;
        var split_byte_offset: u32 = 0;
        var left_width: u32 = 0;

        for (graphemes) |g| {
            if (accumulated_width >= weight) break;
            accumulated_width += g.width;
            split_byte_offset = g.byte_offset + g.byte_len;
            left_width += g.width;
        }

        const left_chunk = TextChunk{
            .mem_id = chunk.mem_id,
            .byte_start = chunk.byte_start,
            .byte_end = chunk.byte_start + split_byte_offset,
            .width = left_width,
        };

        const right_chunk = TextChunk{
            .mem_id = chunk.mem_id,
            .byte_start = chunk.byte_start + split_byte_offset,
            .byte_end = chunk.byte_end,
            .width = chunk_weight - left_width,
        };

        return .{ .left = left_chunk, .right = right_chunk };
    }

    /// Ensure add buffer has capacity for n bytes
    fn ensureAddCapacity(self: *EditBuffer, need: usize) !void {
        try self.add_buffer.ensureCapacity(self.tb, need);
    }

    /// Insert text at the primary cursor
    pub fn insertText(self: *EditBuffer, bytes: []const u8) !void {
        if (bytes.len == 0) return;
        if (self.cursors.items.len == 0) return;

        const cursor = self.cursors.items[0];

        // Ensure add buffer capacity
        try self.ensureAddCapacity(bytes.len);

        // Split input by newlines
        var segments = std.ArrayList([]const u8).init(self.allocator);
        defer segments.deinit();

        var start: usize = 0;
        var i: usize = 0;
        while (i < bytes.len) : (i += 1) {
            if (bytes[i] == '\n') {
                try segments.append(bytes[start..i]);
                start = i + 1;
            }
        }
        // Append last segment
        try segments.append(bytes[start..]);

        const line_count = self.tb.lineCount();
        if (cursor.row >= line_count) return EditBufferError.InvalidCursor;

        // Get the target line
        const target_line = self.tb.getLine(cursor.row) orelse return EditBufferError.InvalidCursor;

        if (segments.items.len == 1) {
            // Single-line insert: split chunks at cursor.col and insert
            try self.insertSingleLineAtCursor(target_line, cursor, bytes);
        } else {
            // Multi-line insert: split line, create new lines for middle segments
            try self.insertMultiLineAtCursor(cursor, segments.items);
        }

        // Update char offsets from insertion point
        self.recomputeCharOffsetsFrom(cursor.row);

        // Mark views dirty
        self.tb.markViewsDirty();

        // Move cursor to end of inserted text
        const last_seg = segments.items[segments.items.len - 1];
        if (segments.items.len == 1) {
            self.cursors.items[0].col = cursor.col + self.tb.measureText(last_seg);
        } else {
            self.cursors.items[0].row = cursor.row + @as(u32, @intCast(segments.items.len - 1));
            self.cursors.items[0].col = self.tb.measureText(last_seg);
        }
    }

    fn insertSingleLineAtCursor(self: *EditBuffer, target_line: *const TextLine(Rope(TextChunk)), cursor: Cursor, bytes: []const u8) !void {
        // Append to add buffer
        const chunk_ref = self.add_buffer.append(bytes);
        const new_chunk = TextChunk{
            .mem_id = chunk_ref.mem_id,
            .byte_start = chunk_ref.start,
            .byte_end = chunk_ref.end,
            .width = self.tb.measureText(bytes),
        };

        const mut_line = @constCast(target_line);
        const total_weight = mut_line.chunks.totalWeight();

        if (cursor.col == 0) {
            // Insert at beginning
            try mut_line.chunks.insert(0, new_chunk);
        } else if (cursor.col >= total_weight) {
            // Insert at end
            try mut_line.chunks.append(new_chunk);
        } else {
            // Use rope insertSliceByWeight with context-aware callback
            const splitter = self.makeChunkSplitter();
            try mut_line.chunks.insertSliceByWeight(cursor.col, &[_]TextChunk{new_chunk}, &splitter);
        }

        // Update line width and char count
        mut_line.width = self.recomputeLineWidth(target_line);
        self.tb.char_count += new_chunk.width;
    }

    fn insertMultiLineAtCursor(self: *EditBuffer, cursor: Cursor, segments: []const []const u8) !void {
        const target_line = self.tb.getLine(cursor.row) orelse return EditBufferError.InvalidCursor;
        const mut_line = @constCast(target_line);

        const splitter = self.makeChunkSplitter();

        // Split current line at cursor.col (keep left, save right for last new line)
        var right_chunks = try mut_line.chunks.splitByWeight(cursor.col, &splitter);

        // Add first segment to current line (left-half)
        const first_chunk_ref = self.add_buffer.append(segments[0]);
        const first_chunk = TextChunk{
            .mem_id = first_chunk_ref.mem_id,
            .byte_start = first_chunk_ref.start,
            .byte_end = first_chunk_ref.end,
            .width = self.tb.measureText(segments[0]),
        };
        try mut_line.chunks.append(first_chunk);
        mut_line.width = self.recomputeLineWidth(target_line);

        // Create new lines for middle and last segments
        var new_lines = std.ArrayList(TextLine(Rope(TextChunk))).init(self.allocator);
        defer new_lines.deinit();

        // Middle segments (1 to n-2)
        var seg_idx: usize = 1;
        while (seg_idx < segments.len - 1) : (seg_idx += 1) {
            const seg_chunk_ref = self.add_buffer.append(segments[seg_idx]);
            const seg_chunk = TextChunk{
                .mem_id = seg_chunk_ref.mem_id,
                .byte_start = seg_chunk_ref.start,
                .byte_end = seg_chunk_ref.end,
                .width = self.tb.measureText(segments[seg_idx]),
            };

            var new_line = try TextLine(Rope(TextChunk)).init(self.tb.allocator);
            try new_line.chunks.append(seg_chunk);
            new_line.width = seg_chunk.width;
            new_line.char_offset = 0;
            try new_lines.append(new_line);
        }

        // Last segment + right-half chunks
        const last_seg = segments[segments.len - 1];
        const last_chunk_ref = self.add_buffer.append(last_seg);
        const last_chunk = TextChunk{
            .mem_id = last_chunk_ref.mem_id,
            .byte_start = last_chunk_ref.start,
            .byte_end = last_chunk_ref.end,
            .width = self.tb.measureText(last_seg),
        };

        var last_line = try TextLine(Rope(TextChunk)).init(self.tb.allocator);
        try last_line.chunks.append(last_chunk);

        // Concat the right-half chunks from the original line
        try last_line.chunks.concat(&right_chunks);

        last_line.width = self.recomputeLineWidth(&last_line);
        last_line.char_offset = 0;
        try new_lines.append(last_line);

        // Insert new lines after cursor.row
        const insert_row = cursor.row + 1;
        try self.tb.lines.insert_slice(insert_row, new_lines.items);

        // Update char_count
        for (new_lines.items) |line| {
            self.tb.char_count += line.width;
        }
    }

    pub fn recomputeLineWidth(self: *EditBuffer, line: *const TextLine(Rope(TextChunk))) u32 {
        _ = self;
        var total: u32 = 0;

        const Context = struct {
            total: *u32,
            fn walker(ctx_ptr: *anyopaque, chunk: *const TextChunk, _: u32) Rope(TextChunk).Node.WalkerResult {
                const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                ctx.total.* += chunk.width;
                return .{};
            }
        };

        var ctx = Context{ .total = &total };
        line.chunks.walk(&ctx, Context.walker) catch {};
        return total;
    }

    fn recomputeCharOffsetsFrom(self: *EditBuffer, start_row: u32) void {
        const line_count = self.tb.lineCount();
        if (start_row >= line_count) return;

        var char_offset: u32 = if (start_row > 0) blk: {
            if (self.tb.getLine(start_row - 1)) |prev_line| {
                break :blk prev_line.char_offset + prev_line.width;
            }
            break :blk 0;
        } else 0;

        var row = start_row;
        while (row < line_count) : (row += 1) {
            if (self.tb.getLine(row)) |line| {
                const mut_line = @constCast(line);
                mut_line.char_offset = char_offset;
                char_offset += line.width;
            }
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

        const line_count = self.tb.lineCount();
        if (start.row >= line_count or end.row >= line_count) return EditBufferError.InvalidCursor;

        if (start.row == end.row) {
            // Delete within a single line
            try self.deleteWithinLine(start.row, start.col, end.col);
        } else {
            // Delete across multiple lines
            try self.deleteAcrossLines(start, end);
        }

        // Update char offsets from deletion point
        self.recomputeCharOffsetsFrom(start.row);

        // Mark views dirty
        self.tb.markViewsDirty();

        // Set cursor to start of deleted range
        if (self.cursors.items.len > 0) {
            self.cursors.items[0] = start;
        }
    }

    /// Create a LeafSplitFn callback that captures self for chunk splitting
    pub fn makeChunkSplitter(self: *EditBuffer) Rope(TextChunk).Node.LeafSplitFn {
        return .{
            .ctx = self,
            .splitFn = splitChunkCallback,
        };
    }

    fn splitChunkCallback(
        ctx: ?*anyopaque,
        allocator: Allocator,
        leaf: *const TextChunk,
        weight_in_leaf: u32,
    ) error{ OutOfBounds, OutOfMemory }!Rope(TextChunk).Node.LeafSplitResult {
        _ = allocator;
        const edit_buf = @as(*EditBuffer, @ptrCast(@alignCast(ctx.?)));
        return edit_buf.splitChunkAtWeight(leaf, weight_in_leaf);
    }

    fn deleteWithinLine(self: *EditBuffer, row: u32, start_col: u32, end_col: u32) !void {
        if (start_col >= end_col) return;

        const line = self.tb.getLine(row) orelse return;
        const mut_line = @constCast(line);
        const old_width = line.width;

        // Use rope deleteRangeByWeight to delete the range from the chunk rope
        const splitter = self.makeChunkSplitter();
        try mut_line.chunks.deleteRangeByWeight(start_col, end_col, &splitter);

        // Update line width and char count
        mut_line.width = self.recomputeLineWidth(line);
        const deleted_width = old_width - mut_line.width;
        if (self.tb.char_count >= deleted_width) {
            self.tb.char_count -= deleted_width;
        } else {
            self.tb.char_count = 0;
        }
    }

    fn deleteAcrossLines(self: *EditBuffer, start: Cursor, end: Cursor) !void {
        const start_line = self.tb.getLine(start.row) orelse return;
        const end_line = self.tb.getLine(end.row) orelse return;
        const mut_start_line = @constCast(start_line);

        const splitter = self.makeChunkSplitter();

        // Calculate deleted width before modification
        var deleted_width: u32 = if (start_line.width > start.col)
            start_line.width - start.col
        else
            0;

        // Add widths of middle lines
        var row = start.row + 1;
        while (row < end.row) : (row += 1) {
            if (self.tb.getLine(row)) |line| {
                deleted_width += line.width;
            }
        }

        // Add deleted portion of end line
        deleted_width += end.col;

        // Split start line at start.col (keep left, discard right)
        _ = try mut_start_line.chunks.splitByWeight(start.col, &splitter);
        // We don't need the right part as it will be discarded

        // Split end line at end.col (discard left, keep right)
        const mut_end_line = @constCast(end_line);
        var end_right = try mut_end_line.chunks.splitByWeight(end.col, &splitter);

        // Concat the right part of end line to start line
        try mut_start_line.chunks.concat(&end_right);

        // Update start line width
        mut_start_line.width = self.recomputeLineWidth(start_line);

        // Delete middle lines (start.row+1 to end.row inclusive)
        if (end.row > start.row) {
            try self.tb.lines.delete_range(start.row + 1, end.row + 1);
        }

        // Update char count
        if (self.tb.char_count >= deleted_width) {
            self.tb.char_count -= deleted_width;
        } else {
            self.tb.char_count = 0;
        }
    }

    pub fn backspace(self: *EditBuffer) !void {
        if (self.cursors.items.len == 0) return;
        const cursor = self.cursors.items[0];

        // At start of buffer - nothing to delete
        if (cursor.row == 0 and cursor.col == 0) return;

        if (cursor.col == 0) {
            // At start of line - merge with previous line
            if (cursor.row > 0) {
                const prev_line = self.tb.getLine(cursor.row - 1) orelse return;
                const end_col = prev_line.width;

                // Delete the newline by merging lines
                try self.deleteRange(
                    .{ .row = cursor.row - 1, .col = end_col },
                    .{ .row = cursor.row, .col = 0 },
                );
            }
        } else {
            // Delete one character/grapheme before cursor
            // For simplicity, delete one display-width unit
            try self.deleteRange(
                .{ .row = cursor.row, .col = cursor.col - 1 },
                .{ .row = cursor.row, .col = cursor.col },
            );
        }
    }

    pub fn deleteForward(self: *EditBuffer) !void {
        if (self.cursors.items.len == 0) return;
        const cursor = self.cursors.items[0];

        const line = self.tb.getLine(cursor.row) orelse return;

        // At end of line
        if (cursor.col >= line.width) {
            // Merge with next line if it exists
            if (cursor.row + 1 < self.tb.lineCount()) {
                try self.deleteRange(
                    .{ .row = cursor.row, .col = cursor.col },
                    .{ .row = cursor.row + 1, .col = 0 },
                );
            }
        } else {
            // Delete one character/grapheme after cursor
            try self.deleteRange(
                .{ .row = cursor.row, .col = cursor.col },
                .{ .row = cursor.row, .col = cursor.col + 1 },
            );
        }
    }

    pub fn moveLeft(self: *EditBuffer) void {
        if (self.cursors.items.len == 0) return;
        if (self.cursors.items[0].col > 0) {
            self.cursors.items[0].col -= 1;
        }
    }

    pub fn moveRight(self: *EditBuffer) void {
        if (self.cursors.items.len == 0) return;
        const cursor = &self.cursors.items[0];
        if (self.tb.getLine(cursor.row)) |line| {
            if (cursor.col < line.width) {
                cursor.col += 1;
            }
        }
    }

    pub fn moveUp(self: *EditBuffer) void {
        if (self.cursors.items.len == 0) return;
        if (self.cursors.items[0].row > 0) {
            self.cursors.items[0].row -= 1;
        }
    }

    pub fn moveDown(self: *EditBuffer) void {
        if (self.cursors.items.len == 0) return;
        const cursor = &self.cursors.items[0];
        if (cursor.row + 1 < self.tb.lineCount()) {
            cursor.row += 1;
        }
    }
};
