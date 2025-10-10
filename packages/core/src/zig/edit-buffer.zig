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
    ) !struct { left: TextChunk, right: TextChunk } {
        const chunk_weight = chunk.width;

        if (weight == 0) {
            return .{
                .left = TextChunk{ .mem_id = 0, .byte_start = 0, .byte_end = 0, .width = 0, .graphemes = null },
                .right = chunk.*,
            };
        } else if (weight >= chunk_weight) {
            return .{
                .left = chunk.*,
                .right = TextChunk{ .mem_id = 0, .byte_start = 0, .byte_end = 0, .width = 0, .graphemes = null },
            };
        }

        // Split inside the chunk using cached graphemes
        const graphemes = try chunk.getGraphemes(
            &self.tb.mem_registry,
            self.tb.allocator,
            &self.tb.graphemes_data,
            self.tb.width_method,
            &self.tb.display_width,
        );

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
            .graphemes = null,
        };

        const right_chunk = TextChunk{
            .mem_id = chunk.mem_id,
            .byte_start = chunk.byte_start + split_byte_offset,
            .byte_end = chunk.byte_end,
            .width = chunk_weight - left_width,
            .graphemes = null,
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
            .graphemes = null,
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
            // Find which chunk contains cursor.col and split it
            var accumulated: u32 = 0;
            var chunk_idx: u32 = 0;
            var found_chunk: ?*const TextChunk = null;
            var weight_in_chunk: u32 = 0;

            const FindContext = struct {
                target_weight: u32,
                accumulated: *u32,
                found_chunk: *?*const TextChunk,
                found_idx: *u32,
                weight_in_chunk: *u32,

                fn walker(ctx_ptr: *anyopaque, chunk: *const TextChunk, idx: u32) Rope(TextChunk).Node.WalkerResult {
                    const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                    if (ctx.target_weight < ctx.accumulated.* + chunk.width) {
                        ctx.found_chunk.* = chunk;
                        ctx.found_idx.* = idx;
                        ctx.weight_in_chunk.* = ctx.target_weight - ctx.accumulated.*;
                        return .{ .keep_walking = false };
                    }
                    ctx.accumulated.* += chunk.width;
                    return .{};
                }
            };

            var find_ctx = FindContext{
                .target_weight = cursor.col,
                .accumulated = &accumulated,
                .found_chunk = &found_chunk,
                .found_idx = &chunk_idx,
                .weight_in_chunk = &weight_in_chunk,
            };
            mut_line.chunks.walk(&find_ctx, FindContext.walker) catch {};

            if (found_chunk) |chunk| {
                // Split this chunk
                const split_result = try self.splitChunkAtWeight(chunk, weight_in_chunk);

                // Delete the original chunk
                try mut_line.chunks.delete(chunk_idx);

                // Insert in order: left, new, right
                var insert_idx = chunk_idx;
                if (split_result.left.width > 0) {
                    std.debug.print("Inserting left at idx={}\n", .{insert_idx});
                    try mut_line.chunks.insert(insert_idx, split_result.left);
                    insert_idx += 1;
                }
                std.debug.print("Inserting new chunk at idx={}\n", .{insert_idx});
                try mut_line.chunks.insert(insert_idx, new_chunk);
                insert_idx += 1;
                if (split_result.right.width > 0) {
                    std.debug.print("Inserting right at idx={}\n", .{insert_idx});
                    try mut_line.chunks.insert(insert_idx, split_result.right);
                }
            }
        }

        // Update line width and char count
        mut_line.width = self.recomputeLineWidth(target_line);
        self.tb.char_count += new_chunk.width;
    }

    fn insertMultiLineAtCursor(self: *EditBuffer, cursor: Cursor, segments: []const []const u8) !void {
        // For now, use a simpler approach: collect all chunks from line, manually split at cursor.col,
        // and rebuild the chunks with the inserted segments
        const target_line = self.tb.getLine(cursor.row) orelse return EditBufferError.InvalidCursor;
        const mut_line = @constCast(target_line);

        // Collect all existing chunks into an array
        var existing_chunks = try mut_line.chunks.to_array(self.allocator);
        defer self.allocator.free(existing_chunks);

        // Find split point
        var accumulated: u32 = 0;
        var split_chunk_idx: usize = 0;
        var weight_in_split_chunk: u32 = 0;

        for (existing_chunks, 0..) |chunk, idx| {
            if (cursor.col < accumulated + chunk.width) {
                split_chunk_idx = idx;
                weight_in_split_chunk = cursor.col - accumulated;
                break;
            }
            accumulated += chunk.width;
        }

        // Build new chunks for the first line (left-half + first segment)
        mut_line.chunks = try Rope(TextChunk).init(self.tb.allocator);

        // Add left-half chunks
        for (existing_chunks[0..split_chunk_idx]) |chunk| {
            try mut_line.chunks.append(chunk);
        }

        // Split the split_chunk if needed
        if (split_chunk_idx < existing_chunks.len and weight_in_split_chunk > 0) {
            const split_result = try self.splitChunkAtWeight(&existing_chunks[split_chunk_idx], weight_in_split_chunk);
            if (split_result.left.width > 0) {
                try mut_line.chunks.append(split_result.left);
            }
        }

        // Add first segment
        const first_chunk_ref = self.add_buffer.append(segments[0]);
        const first_chunk = TextChunk{
            .mem_id = first_chunk_ref.mem_id,
            .byte_start = first_chunk_ref.start,
            .byte_end = first_chunk_ref.end,
            .width = self.tb.measureText(segments[0]),
            .graphemes = null,
        };
        try mut_line.chunks.append(first_chunk);
        mut_line.width = self.recomputeLineWidth(target_line);

        // Create new lines for middle and last segments
        var new_lines = std.ArrayList(TextLine(Rope(TextChunk))).init(self.allocator);
        defer new_lines.deinit();

        // Middle segments
        var seg_idx: usize = 1;
        while (seg_idx < segments.len - 1) : (seg_idx += 1) {
            const seg_chunk_ref = self.add_buffer.append(segments[seg_idx]);
            const seg_chunk = TextChunk{
                .mem_id = seg_chunk_ref.mem_id,
                .byte_start = seg_chunk_ref.start,
                .byte_end = seg_chunk_ref.end,
                .width = self.tb.measureText(segments[seg_idx]),
                .graphemes = null,
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
            .graphemes = null,
        };

        var last_line = try TextLine(Rope(TextChunk)).init(self.tb.allocator);
        try last_line.chunks.append(last_chunk);

        // Add right-half of split chunk
        if (split_chunk_idx < existing_chunks.len) {
            const split_result = try self.splitChunkAtWeight(&existing_chunks[split_chunk_idx], weight_in_split_chunk);
            if (split_result.right.width > 0) {
                try last_line.chunks.append(split_result.right);
            }
            // Add remaining chunks
            for (existing_chunks[split_chunk_idx + 1 ..]) |chunk| {
                try last_line.chunks.append(chunk);
            }
        }

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

    fn recomputeLineWidth(self: *EditBuffer, line: *const TextLine(Rope(TextChunk))) u32 {
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

    pub fn deleteRange(self: *EditBuffer, start: Cursor, end: Cursor) !void {
        // TODO: Implement
        _ = self;
        _ = start;
        _ = end;
        return EditBufferError.OutOfMemory;
    }

    pub fn backspace(self: *EditBuffer) !void {
        _ = self;
        // TODO: Implement backspace
    }

    pub fn deleteForward(self: *EditBuffer) !void {
        _ = self;
        // TODO: Implement deleteForward
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
