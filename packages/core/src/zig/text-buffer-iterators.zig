const std = @import("std");
const Allocator = std.mem.Allocator;
const seg_mod = @import("text-buffer-segment.zig");

const Segment = seg_mod.Segment;
const UnifiedRope = seg_mod.UnifiedRope;
const TextChunk = seg_mod.TextChunk;

/// Information about a logical line in the unified rope
pub const LineInfo = struct {
    /// Line index (0-based)
    line_idx: u32,
    /// Character offset at start of this line
    char_offset: u32,
    /// Display width of this line (in cells)
    width: u32,
    /// Segment index where this line starts (inclusive)
    seg_start: u32,
    /// Segment index where this line ends (exclusive, points to break or end)
    seg_end: u32,
};

/// Row/col coordinates
pub const Coords = struct {
    row: u32,
    col: u32,
};

/// Walk all logical lines in a unified rope
/// Uses the rope's walk() API for O(n) traversal without allocations
/// Callback receives LineInfo for each line
pub fn walkLines(
    rope: *const UnifiedRope,
    ctx: *anyopaque,
    callback: *const fn (ctx: *anyopaque, line_info: LineInfo) void,
) void {
    // Special case: empty rope - emit nothing (0 lines)
    // setText("") will handle creating the single empty line
    if (rope.count() == 0) {
        return;
    }

    const WalkContext = struct {
        user_ctx: *anyopaque,
        user_callback: *const fn (ctx: *anyopaque, line_info: LineInfo) void,
        current_line_idx: u32 = 0,
        current_char_offset: u32 = 0,
        line_start_seg: u32 = 0,
        current_seg_idx: u32 = 0,
        line_width: u32 = 0,

        fn walker(walk_ctx_ptr: *anyopaque, seg: *const Segment, idx: u32) UnifiedRope.Node.WalkerResult {
            const walk_ctx = @as(*@This(), @ptrCast(@alignCast(walk_ctx_ptr)));

            if (seg.isBreak()) {
                // Emit line via callback
                walk_ctx.user_callback(walk_ctx.user_ctx, LineInfo{
                    .line_idx = walk_ctx.current_line_idx,
                    .char_offset = walk_ctx.current_char_offset,
                    .width = walk_ctx.line_width,
                    .seg_start = walk_ctx.line_start_seg,
                    .seg_end = idx, // Don't include the break
                });

                walk_ctx.current_line_idx += 1;
                walk_ctx.current_char_offset += walk_ctx.line_width;
                walk_ctx.line_start_seg = idx + 1;
                walk_ctx.line_width = 0;
            } else if (seg.asText()) |chunk| {
                walk_ctx.line_width += chunk.width;
            }

            walk_ctx.current_seg_idx = idx + 1;
            return .{};
        }
    };

    var walk_ctx = WalkContext{
        .user_ctx = ctx,
        .user_callback = callback,
    };
    rope.walk(&walk_ctx, WalkContext.walker) catch {};

    // Emit final line if we have content after last break OR if we had at least one break
    // (A trailing break creates an empty final line)
    const had_breaks = walk_ctx.current_line_idx > 0;
    const has_content_after_break = walk_ctx.line_start_seg < walk_ctx.current_seg_idx;

    if (has_content_after_break or had_breaks) {
        callback(ctx, LineInfo{
            .line_idx = walk_ctx.current_line_idx,
            .char_offset = walk_ctx.current_char_offset,
            .width = walk_ctx.line_width,
            .seg_start = walk_ctx.line_start_seg,
            .seg_end = walk_ctx.current_seg_idx,
        });
    }
}

/// Walk lines and their segments in a single O(n) pass
/// This is the most efficient way to iterate lines and their content
/// Callbacks:
///   - segment_callback: Called for each text segment within a line (line_idx, chunk, chunk_idx_in_line)
///   - line_end_callback: Called when a line ends (line_info)
pub fn walkLinesAndSegments(
    rope: *const UnifiedRope,
    ctx: *anyopaque,
    segment_callback: *const fn (ctx: *anyopaque, line_idx: u32, chunk: *const TextChunk, chunk_idx_in_line: u32) void,
    line_end_callback: *const fn (ctx: *anyopaque, line_info: LineInfo) void,
) void {
    // Special case: empty rope - emit nothing (0 lines)
    // setText("") will handle creating the single empty line
    if (rope.count() == 0) {
        return;
    }

    const WalkContext = struct {
        user_ctx: *anyopaque,
        seg_callback: *const fn (ctx: *anyopaque, line_idx: u32, chunk: *const TextChunk, chunk_idx_in_line: u32) void,
        line_callback: *const fn (ctx: *anyopaque, line_info: LineInfo) void,
        current_line_idx: u32 = 0,
        current_char_offset: u32 = 0,
        line_start_seg: u32 = 0,
        current_seg_idx: u32 = 0,
        line_width: u32 = 0,
        chunk_idx_in_line: u32 = 0,

        fn walker(walk_ctx_ptr: *anyopaque, seg: *const Segment, idx: u32) UnifiedRope.Node.WalkerResult {
            const walk_ctx = @as(*@This(), @ptrCast(@alignCast(walk_ctx_ptr)));

            if (seg.asText()) |chunk| {
                // Emit segment immediately
                walk_ctx.seg_callback(walk_ctx.user_ctx, walk_ctx.current_line_idx, chunk, walk_ctx.chunk_idx_in_line);
                walk_ctx.chunk_idx_in_line += 1;
                walk_ctx.line_width += chunk.width;
            } else if (seg.isBreak()) {
                // Emit line
                walk_ctx.line_callback(walk_ctx.user_ctx, LineInfo{
                    .line_idx = walk_ctx.current_line_idx,
                    .char_offset = walk_ctx.current_char_offset,
                    .width = walk_ctx.line_width,
                    .seg_start = walk_ctx.line_start_seg,
                    .seg_end = idx, // Don't include the break
                });

                walk_ctx.current_line_idx += 1;
                walk_ctx.current_char_offset += walk_ctx.line_width;
                walk_ctx.line_start_seg = idx + 1;
                walk_ctx.line_width = 0;
                walk_ctx.chunk_idx_in_line = 0;
            }

            walk_ctx.current_seg_idx = idx + 1;
            return .{};
        }
    };

    var walk_ctx = WalkContext{
        .user_ctx = ctx,
        .seg_callback = segment_callback,
        .line_callback = line_end_callback,
    };
    rope.walk(&walk_ctx, WalkContext.walker) catch {};

    // Emit final line if we have content after last break OR if we had at least one break
    // (A trailing break creates an empty final line)
    const had_breaks = walk_ctx.current_line_idx > 0;
    const has_content_after_break = walk_ctx.line_start_seg < walk_ctx.current_seg_idx;

    if (has_content_after_break or had_breaks) {
        line_end_callback(ctx, LineInfo{
            .line_idx = walk_ctx.current_line_idx,
            .char_offset = walk_ctx.current_char_offset,
            .width = walk_ctx.line_width,
            .seg_start = walk_ctx.line_start_seg,
            .seg_end = walk_ctx.current_seg_idx,
        });
    }
}

/// Walk text segments in a segment range - for compatibility
/// For best performance, use walkLinesAndSegments instead
pub fn walkSegments(
    rope: *const UnifiedRope,
    seg_start: u32,
    seg_end: u32,
    ctx: *anyopaque,
    callback: *const fn (ctx: *anyopaque, chunk: *const TextChunk, idx: u32) void,
) void {
    if (seg_start >= seg_end) return;

    var chunk_idx: u32 = 0;
    var seg_idx = seg_start;

    // For small ranges, direct get() is acceptable
    while (seg_idx < seg_end) : (seg_idx += 1) {
        if (rope.get(seg_idx)) |seg| {
            if (seg.asText()) |chunk| {
                callback(ctx, chunk, chunk_idx);
                chunk_idx += 1;
            }
        }
    }
}

/// Get the total number of logical lines in a unified rope
pub fn getLineCount(rope: *const UnifiedRope) u32 {
    const metrics = rope.root.metrics();
    return metrics.custom.break_count + 1;
}

/// Get the maximum line width in the entire rope
pub fn getMaxLineWidth(rope: *const UnifiedRope) u32 {
    const metrics = rope.root.metrics();
    return metrics.custom.max_line_width;
}

/// Get the total display width (character count) of the rope
pub fn getTotalWidth(rope: *const UnifiedRope) u32 {
    const metrics = rope.root.metrics();
    return metrics.custom.total_width;
}

/// Convert (row, col) coordinates to absolute character offset
/// Returns null if coordinates are out of bounds
pub fn coordsToOffset(rope: *const UnifiedRope, row: u32, col: u32) ?u32 {
    const Context = struct {
        row: u32,
        col: u32,
        result: ?u32 = null,

        fn callback(ctx_ptr: *anyopaque, line_info: LineInfo) void {
            const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
            if (line_info.line_idx == ctx.row) {
                if (ctx.col > line_info.width) {
                    ctx.result = null;
                } else {
                    ctx.result = line_info.char_offset + ctx.col;
                }
            }
        }
    };

    var ctx = Context{ .row = row, .col = col };
    walkLines(rope, &ctx, Context.callback);
    return ctx.result;
}

/// Convert absolute character offset to (row, col) coordinates
/// Returns null if offset is out of bounds
/// Note: Offsets at line boundaries belong to the START of the next line,
/// except for the very last offset which belongs to the end of the last line
pub fn offsetToCoords(rope: *const UnifiedRope, offset: u32) ?Coords {
    const Context = struct {
        offset: u32,
        result: ?Coords = null,
        last_line_info: ?LineInfo = null,

        fn callback(ctx_ptr: *anyopaque, line_info: LineInfo) void {
            const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
            const line_end = line_info.char_offset + line_info.width;

            // Check if offset is within this line (not including the end, unless it's the last line)
            if (ctx.offset >= line_info.char_offset and ctx.offset < line_end) {
                ctx.result = Coords{
                    .row = line_info.line_idx,
                    .col = ctx.offset - line_info.char_offset,
                };
            }

            ctx.last_line_info = line_info;
        }
    };

    var ctx = Context{ .offset = offset };
    walkLines(rope, &ctx, Context.callback);

    // Special case: offset exactly at the end of the last line
    if (ctx.result == null and ctx.last_line_info != null) {
        const line_info = ctx.last_line_info.?;
        const line_end = line_info.char_offset + line_info.width;
        if (offset == line_end) {
            ctx.result = Coords{
                .row = line_info.line_idx,
                .col = line_info.width,
            };
        }
    }

    return ctx.result;
}
