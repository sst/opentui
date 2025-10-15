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
    return metrics.custom.linestart_count;
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
/// Optimized O(1) implementation using linestart marker lookups
pub fn coordsToOffset(rope: *UnifiedRope, row: u32, col: u32) ?u32 {
    const linestart_count = rope.markerCount(.linestart);
    if (row >= linestart_count) return null;

    // Lookup linestart marker for this row
    const marker = rope.getMarker(.linestart, row) orelse return null;
    const line_char_offset = marker.global_weight;

    // Get line width to validate col
    const next_line_offset = if (row + 1 < linestart_count) blk: {
        const next_marker = rope.getMarker(.linestart, row + 1) orelse return null;
        break :blk next_marker.global_weight;
    } else blk: {
        break :blk getTotalWidth(rope);
    };

    const line_width = next_line_offset - line_char_offset;
    if (col > line_width) return null;

    return line_char_offset + col;
}

/// Convert absolute character offset to (row, col) coordinates
/// Returns null if offset is out of bounds
/// Optimized O(log n) implementation using binary search on linestart markers
pub fn offsetToCoords(rope: *UnifiedRope, offset: u32) ?Coords {
    const linestart_count = rope.markerCount(.linestart);
    if (linestart_count == 0) return null;

    const total_width = getTotalWidth(rope);
    if (offset > total_width) return null;

    // Binary search to find the line containing this offset
    var left: u32 = 0;
    var right: u32 = linestart_count;

    while (left < right) {
        const mid = left + (right - left) / 2;
        const marker = rope.getMarker(.linestart, mid) orelse return null;
        const line_start = marker.global_weight;

        if (offset < line_start) {
            right = mid;
        } else {
            // Check if offset is in this line
            const next_line_start = if (mid + 1 < linestart_count) blk: {
                const next_marker = rope.getMarker(.linestart, mid + 1) orelse return null;
                break :blk next_marker.global_weight;
            } else blk: {
                break :blk total_width;
            };

            if (offset < next_line_start or (offset == total_width and mid + 1 == linestart_count)) {
                // Found the line
                return Coords{
                    .row = mid,
                    .col = offset - line_start,
                };
            }
            left = mid + 1;
        }
    }

    return null;
}

/// Get the display width of a specific line using O(1) marker lookups
pub fn lineWidthAt(rope: *UnifiedRope, row: u32) u32 {
    const linestart_count = rope.markerCount(.linestart);
    if (row >= linestart_count) return 0;

    // Get the character offset at the start of this line
    const line_marker = rope.getMarker(.linestart, row) orelse return 0;
    const line_start_offset = line_marker.global_weight;

    // Get the character offset at the start of the next line (or end of buffer)
    const line_end_offset = if (row + 1 < linestart_count) blk: {
        const next_marker = rope.getMarker(.linestart, row + 1) orelse return 0;
        break :blk next_marker.global_weight;
    } else blk: {
        break :blk getTotalWidth(rope);
    };

    return line_end_offset - line_start_offset;
}
