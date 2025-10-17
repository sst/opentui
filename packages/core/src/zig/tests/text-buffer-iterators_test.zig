const std = @import("std");
const testing = std.testing;
const iter_mod = @import("../text-buffer-iterators.zig");
const seg_mod = @import("../text-buffer-segment.zig");

const Segment = seg_mod.Segment;
const UnifiedRope = seg_mod.UnifiedRope;
const LineInfo = iter_mod.LineInfo;
const TextChunk = seg_mod.TextChunk;

test "walkLines - empty rope" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    const rope = try UnifiedRope.init(allocator);

    const Context = struct {
        count: u32 = 0,
        first_line: ?LineInfo = null,

        fn callback(ctx_ptr: *anyopaque, line_info: LineInfo) void {
            const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
            if (ctx.count == 0) {
                ctx.first_line = line_info;
            }
            ctx.count += 1;
        }
    };

    var ctx = Context{};
    iter_mod.walkLines(&rope, &ctx, Context.callback);

    // Empty rope = 0 lines (caller should use setText("") to create 1 empty line)
    try testing.expectEqual(@as(u32, 0), ctx.count);
}

test "walkLines - single text segment" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var rope = try UnifiedRope.init(allocator);
    try rope.append(Segment{
        .text = TextChunk{
            .mem_id = 0,
            .byte_start = 0,
            .byte_end = 10,
            .width = 10,
            .flags = 0,
        },
    });

    const Context = struct {
        lines: std.ArrayList(LineInfo),

        fn callback(ctx_ptr: *anyopaque, line_info: LineInfo) void {
            const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
            ctx.lines.append(line_info) catch {};
        }
    };

    var ctx = Context{ .lines = std.ArrayList(LineInfo).init(allocator) };
    defer ctx.lines.deinit();

    iter_mod.walkLines(&rope, &ctx, Context.callback);

    try testing.expectEqual(@as(usize, 1), ctx.lines.items.len);
    try testing.expectEqual(@as(u32, 10), ctx.lines.items[0].width);
}

test "walkLines - text + break + text" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var rope = try UnifiedRope.init(allocator);
    try rope.append(Segment{
        .text = TextChunk{
            .mem_id = 0,
            .byte_start = 0,
            .byte_end = 10,
            .width = 10,
            .flags = 0,
        },
    });
    try rope.append(Segment{ .brk = {} });
    try rope.append(Segment{
        .text = TextChunk{
            .mem_id = 0,
            .byte_start = 10,
            .byte_end = 15,
            .width = 5,
            .flags = 0,
        },
    });

    const Context = struct {
        lines: std.ArrayList(LineInfo),

        fn callback(ctx_ptr: *anyopaque, line_info: LineInfo) void {
            const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
            ctx.lines.append(line_info) catch {};
        }
    };

    var ctx = Context{ .lines = std.ArrayList(LineInfo).init(allocator) };
    defer ctx.lines.deinit();

    iter_mod.walkLines(&rope, &ctx, Context.callback);

    try testing.expectEqual(@as(usize, 2), ctx.lines.items.len);

    try testing.expectEqual(@as(u32, 0), ctx.lines.items[0].line_idx);
    try testing.expectEqual(@as(u32, 10), ctx.lines.items[0].width);
    try testing.expectEqual(@as(u32, 0), ctx.lines.items[0].char_offset);

    try testing.expectEqual(@as(u32, 1), ctx.lines.items[1].line_idx);
    try testing.expectEqual(@as(u32, 5), ctx.lines.items[1].width);
    try testing.expectEqual(@as(u32, 10), ctx.lines.items[1].char_offset);
}

test "coordsToOffset - valid coordinates" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var rope = try UnifiedRope.init(allocator);
    // Line 0 starts here
    try rope.append(Segment{ .linestart = {} });
    try rope.append(Segment{
        .text = TextChunk{
            .mem_id = 0,
            .byte_start = 0,
            .byte_end = 10,
            .width = 10,
            .flags = 0,
        },
    });
    try rope.append(Segment{ .brk = {} });
    // Line 1 starts here
    try rope.append(Segment{ .linestart = {} });
    try rope.append(Segment{
        .text = TextChunk{
            .mem_id = 0,
            .byte_start = 10,
            .byte_end = 15,
            .width = 5,
            .flags = 0,
        },
    });

    const offset1 = iter_mod.coordsToOffset(&rope, 0, 5);
    try testing.expect(offset1 != null);
    try testing.expectEqual(@as(u32, 5), offset1.?);

    // With newline weight, line 1 starts at offset 11 (line0_width=10 + newline=1)
    const offset2 = iter_mod.coordsToOffset(&rope, 1, 0);
    try testing.expect(offset2 != null);
    try testing.expectEqual(@as(u32, 11), offset2.?);

    const offset3 = iter_mod.coordsToOffset(&rope, 1, 3);
    try testing.expect(offset3 != null);
    try testing.expectEqual(@as(u32, 14), offset3.?);
}

test "offsetToCoords - valid offsets" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var rope = try UnifiedRope.init(allocator);
    // Line 0 starts here
    try rope.append(Segment{ .linestart = {} });
    try rope.append(Segment{
        .text = TextChunk{
            .mem_id = 0,
            .byte_start = 0,
            .byte_end = 10,
            .width = 10,
            .flags = 0,
        },
    });
    try rope.append(Segment{ .brk = {} });
    // Line 1 starts here
    try rope.append(Segment{ .linestart = {} });
    try rope.append(Segment{
        .text = TextChunk{
            .mem_id = 0,
            .byte_start = 10,
            .byte_end = 15,
            .width = 5,
            .flags = 0,
        },
    });

    const coords1 = iter_mod.offsetToCoords(&rope, 5);
    try testing.expect(coords1 != null);
    try testing.expectEqual(@as(u32, 0), coords1.?.row);
    try testing.expectEqual(@as(u32, 5), coords1.?.col);

    // Offset 10 is the newline at end of line 0, which maps to col=10 on row 0
    const coords2 = iter_mod.offsetToCoords(&rope, 10);
    try testing.expect(coords2 != null);
    try testing.expectEqual(@as(u32, 0), coords2.?.row);
    try testing.expectEqual(@as(u32, 10), coords2.?.col);

    // Offset 11 is the start of line 1
    const coords2b = iter_mod.offsetToCoords(&rope, 11);
    try testing.expect(coords2b != null);
    try testing.expectEqual(@as(u32, 1), coords2b.?.row);
    try testing.expectEqual(@as(u32, 0), coords2b.?.col);

    const coords3 = iter_mod.offsetToCoords(&rope, 14);
    try testing.expect(coords3 != null);
    try testing.expectEqual(@as(u32, 1), coords3.?.row);
    try testing.expectEqual(@as(u32, 3), coords3.?.col);
}

test "Helper functions" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var rope = try UnifiedRope.init(allocator);
    try rope.append(Segment{ .linestart = {} });
    try rope.append(Segment{
        .text = TextChunk{
            .mem_id = 0,
            .byte_start = 0,
            .byte_end = 10,
            .width = 10,
            .flags = 0,
        },
    });
    try rope.append(Segment{ .brk = {} });
    try rope.append(Segment{ .linestart = {} });
    try rope.append(Segment{
        .text = TextChunk{
            .mem_id = 0,
            .byte_start = 10,
            .byte_end = 15,
            .width = 5,
            .flags = 0,
        },
    });

    try testing.expectEqual(@as(u32, 2), iter_mod.getLineCount(&rope));
    try testing.expectEqual(@as(u32, 10), iter_mod.getMaxLineWidth(&rope));
    try testing.expectEqual(@as(u32, 15), iter_mod.getTotalWidth(&rope));
}

test "coordsToOffset and offsetToCoords - round trip" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var rope = try UnifiedRope.init(allocator);
    // Line 0 starts here
    try rope.append(Segment{ .linestart = {} });
    try rope.append(Segment{
        .text = TextChunk{
            .mem_id = 0,
            .byte_start = 0,
            .byte_end = 10,
            .width = 10,
            .flags = 0,
        },
    });
    try rope.append(Segment{ .brk = {} });
    // Line 1 starts here
    try rope.append(Segment{ .linestart = {} });
    try rope.append(Segment{
        .text = TextChunk{
            .mem_id = 0,
            .byte_start = 10,
            .byte_end = 18,
            .width = 8,
            .flags = 0,
        },
    });

    const test_cases = [_]struct { row: u32, col: u32 }{
        .{ .row = 0, .col = 0 },
        .{ .row = 0, .col = 5 },
        .{ .row = 0, .col = 9 },
        .{ .row = 1, .col = 0 },
        .{ .row = 1, .col = 4 },
        .{ .row = 1, .col = 7 },
    };

    for (test_cases) |tc| {
        const offset = iter_mod.coordsToOffset(&rope, tc.row, tc.col);
        try testing.expect(offset != null);

        const coords = iter_mod.offsetToCoords(&rope, offset.?);
        try testing.expect(coords != null);
        try testing.expectEqual(tc.row, coords.?.row);
        try testing.expectEqual(tc.col, coords.?.col);
    }
}
