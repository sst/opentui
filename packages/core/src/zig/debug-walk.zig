const std = @import("std");
const seg_mod = @import("text-buffer-segment.zig");
const iter_mod = @import("text-buffer-iterators.zig");
const tb = @import("text-buffer.zig");

const Segment = seg_mod.Segment;
const UnifiedRope = seg_mod.UnifiedRope;

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    std.debug.print("Creating rope...\n", .{});

    var rope = try UnifiedRope.init(allocator);

    // Create simple test: text + break + text
    try rope.append(Segment{
        .text = tb.TextChunk{
            .mem_id = 0,
            .byte_start = 0,
            .byte_end = 5,
            .width = 5,
            .flags = 0,
        },
    });
    try rope.append(Segment{ .brk = {} });
    try rope.append(Segment{
        .text = tb.TextChunk{
            .mem_id = 0,
            .byte_start = 5,
            .byte_end = 10,
            .width = 5,
            .flags = 0,
        },
    });

    std.debug.print("Rope has {d} segments\n", .{rope.count()});
    std.debug.print("Testing walkLines...\n", .{});

    const LineCtx = struct {
        count: u32 = 0,
        fn callback(ctx_ptr: *anyopaque, line_info: iter_mod.LineInfo) void {
            const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
            std.debug.print("  Line {d}: width={d}, char_offset={d}\n", .{ line_info.line_idx, line_info.width, line_info.char_offset });
            ctx.count += 1;
        }
    };

    var line_ctx = LineCtx{};
    iter_mod.walkLines(&rope, &line_ctx, LineCtx.callback);
    std.debug.print("walkLines emitted {d} lines\n", .{line_ctx.count});

    std.debug.print("\nTesting walkLinesAndSegments...\n", .{});

    const BothCtx = struct {
        line_count: u32 = 0,
        seg_count: u32 = 0,

        fn seg_callback(ctx_ptr: *anyopaque, line_idx: u32, chunk: *const tb.TextChunk, chunk_idx: u32) void {
            const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
            std.debug.print("    Segment in line {d}: chunk_idx={d}, width={d}\n", .{ line_idx, chunk_idx, chunk.width });
            ctx.seg_count += 1;
        }

        fn line_callback(ctx_ptr: *anyopaque, line_info: iter_mod.LineInfo) void {
            const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
            std.debug.print("  Line {d}: width={d}\n", .{ line_info.line_idx, line_info.width });
            ctx.line_count += 1;
        }
    };

    var both_ctx = BothCtx{};
    iter_mod.walkLinesAndSegments(&rope, &both_ctx, BothCtx.seg_callback, BothCtx.line_callback);
    std.debug.print("walkLinesAndSegments emitted {d} lines and {d} segments\n", .{ both_ctx.line_count, both_ctx.seg_count });

    std.debug.print("\n✓ Debug complete\n", .{});
}
