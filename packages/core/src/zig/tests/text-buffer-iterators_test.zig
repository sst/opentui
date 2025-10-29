const std = @import("std");
const testing = std.testing;
const iter_mod = @import("../text-buffer-iterators.zig");
const seg_mod = @import("../text-buffer-segment.zig");
const text_buffer = @import("../text-buffer.zig");
const gp = @import("../grapheme.zig");

const Segment = seg_mod.Segment;
const UnifiedRope = seg_mod.UnifiedRope;
const LineInfo = iter_mod.LineInfo;
const TextChunk = seg_mod.TextChunk;
const TextBuffer = text_buffer.UnifiedTextBuffer;

test "walkLines - empty rope" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var rope = try UnifiedRope.init(allocator);

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
    iter_mod.walkLines(&rope, &ctx, Context.callback, true);

    try testing.expectEqual(@as(u32, 1), ctx.count);
}

test "walkLines - single text segment" {
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

    const Context = struct {
        lines: std.ArrayList(LineInfo),

        fn callback(ctx_ptr: *anyopaque, line_info: LineInfo) void {
            const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
            ctx.lines.append(line_info) catch {};
        }
    };

    var ctx = Context{ .lines = std.ArrayList(LineInfo).init(allocator) };
    defer ctx.lines.deinit();

    iter_mod.walkLines(&rope, &ctx, Context.callback, true);

    try testing.expectEqual(@as(usize, 1), ctx.lines.items.len);
    try testing.expectEqual(@as(u32, 10), ctx.lines.items[0].width);
}

test "walkLines - text + break + text" {
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

    const Context = struct {
        lines: std.ArrayList(LineInfo),

        fn callback(ctx_ptr: *anyopaque, line_info: LineInfo) void {
            const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
            ctx.lines.append(line_info) catch {};
        }
    };

    var ctx = Context{ .lines = std.ArrayList(LineInfo).init(allocator) };
    defer ctx.lines.deinit();

    iter_mod.walkLines(&rope, &ctx, Context.callback, true);

    try testing.expectEqual(@as(usize, 2), ctx.lines.items.len);

    try testing.expectEqual(@as(u32, 0), ctx.lines.items[0].line_idx);
    try testing.expectEqual(@as(u32, 10), ctx.lines.items[0].width);
    try testing.expectEqual(@as(u32, 0), ctx.lines.items[0].char_offset);

    try testing.expectEqual(@as(u32, 1), ctx.lines.items[1].line_idx);
    try testing.expectEqual(@as(u32, 5), ctx.lines.items[1].width);
    try testing.expectEqual(@as(u32, 11), ctx.lines.items[1].char_offset); // Includes newline weight
}

test "walkLines - exclude newlines in offset" {
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

    const Context = struct {
        lines: std.ArrayList(LineInfo),

        fn callback(ctx_ptr: *anyopaque, line_info: LineInfo) void {
            const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
            ctx.lines.append(line_info) catch {};
        }
    };

    var ctx = Context{ .lines = std.ArrayList(LineInfo).init(allocator) };
    defer ctx.lines.deinit();

    iter_mod.walkLines(&rope, &ctx, Context.callback, false);

    try testing.expectEqual(@as(usize, 2), ctx.lines.items.len);

    // Line 0: char_offset should be 0 (no newlines before it)
    try testing.expectEqual(@as(u32, 0), ctx.lines.items[0].line_idx);
    try testing.expectEqual(@as(u32, 10), ctx.lines.items[0].width);
    try testing.expectEqual(@as(u32, 0), ctx.lines.items[0].char_offset);

    // Line 1: char_offset should be 10 (not 11, excludes the newline)
    try testing.expectEqual(@as(u32, 1), ctx.lines.items[1].line_idx);
    try testing.expectEqual(@as(u32, 5), ctx.lines.items[1].width);
    try testing.expectEqual(@as(u32, 10), ctx.lines.items[1].char_offset); // Excludes newline weight
}

test "coordsToOffset - valid coordinates" {
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

test "getGraphemeWidthAt - ASCII text" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // "Hello" - all ASCII, each character is width 1
    try tb.setText("Hello");

    // Test getting width at various positions
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 0, tb.tab_width)); // 'H'
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 1, tb.tab_width)); // 'e'
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 2, tb.tab_width)); // 'l'
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 3, tb.tab_width)); // 'l'
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 4, tb.tab_width)); // 'o'

    // At end of line
    try testing.expectEqual(@as(u32, 0), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 5, tb.tab_width));

    // Beyond end of line
    try testing.expectEqual(@as(u32, 0), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 10, tb.tab_width));
}

test "getGraphemeWidthAt - emoji and wide characters" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // "a😀b" - 'a' (width 1), emoji (width 2), 'b' (width 1)
    try tb.setText("a😀b");

    // 'a' at column 0
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 0, tb.tab_width));

    // emoji at column 1 (width 2)
    try testing.expectEqual(@as(u32, 2), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 1, tb.tab_width));

    // 'b' at column 3
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 3, tb.tab_width));

    // At end
    try testing.expectEqual(@as(u32, 0), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 4, tb.tab_width));
}

test "getGraphemeWidthAt - multiple chunks" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // "Hello World" - setText creates a single chunk but tests the iteration logic
    try tb.setText("Hello World");

    // Test at various positions
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 0, tb.tab_width)); // 'H'
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 4, tb.tab_width)); // 'o'
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 5, tb.tab_width)); // ' '
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 6, tb.tab_width)); // 'W'
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 10, tb.tab_width)); // 'd'

    // At end
    try testing.expectEqual(@as(u32, 0), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 11, tb.tab_width));
}

test "getGraphemeWidthAt - empty line" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Empty line
    try tb.setText("");

    // Empty line - just linestart, no text
    try testing.expectEqual(@as(u32, 0), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 0, tb.tab_width));
}

test "getGraphemeWidthAt - at chunk boundary" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // "abcdef" - setText creates single chunk, but tests logic
    try tb.setText("abcdef");

    // At position 3
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 3, tb.tab_width)); // 'd'
}

test "getGraphemeWidthAt - after break segment" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // "abc\ndef" - two lines
    try tb.setText("abc\ndef");

    // Test on line 0
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 0, tb.tab_width)); // 'a'
    try testing.expectEqual(@as(u32, 0), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 3, tb.tab_width)); // end of line

    // Test on line 1
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 1, 0, tb.tab_width)); // 'd'
}

test "getPrevGraphemeWidth - ASCII text" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // "Hello" - all ASCII
    try tb.setText("Hello");

    // At start - no previous grapheme
    try testing.expectEqual(@as(u32, 0), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 0, tb.tab_width));

    // Previous graphemes
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 1, tb.tab_width)); // before 'e'
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 2, tb.tab_width)); // before first 'l'
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 3, tb.tab_width)); // before second 'l'
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 4, tb.tab_width)); // before 'o'
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 5, tb.tab_width)); // at end
}

test "getPrevGraphemeWidth - emoji and wide characters" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // "a😀b" - 'a' (width 1), emoji (width 2), 'b' (width 1)
    try tb.setText("a😀b");

    // At start
    try testing.expectEqual(@as(u32, 0), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 0, tb.tab_width));

    // Before emoji (previous is 'a')
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 1, tb.tab_width));

    // After emoji (previous is emoji, width 2)
    try testing.expectEqual(@as(u32, 2), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 3, tb.tab_width));

    // At end (previous is 'b')
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 4, tb.tab_width));
}

test "getPrevGraphemeWidth - at chunk boundary" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // "abcdef"
    try tb.setText("abcdef");

    // At position 3
    // Previous grapheme should be 'c'
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 3, tb.tab_width));

    // At other positions
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 4, tb.tab_width)); // before 'e'
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 5, tb.tab_width)); // before 'f'
}

test "getPrevGraphemeWidth - emoji at chunk boundary" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // "a😀b"
    try tb.setText("a😀b");

    // At col 3 (after emoji)
    // Previous grapheme should be the emoji (width 2)
    try testing.expectEqual(@as(u32, 2), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 3, tb.tab_width));
}

test "getPrevGraphemeWidth - multiple chunks" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // "Hello 😀"
    try tb.setText("Hello 😀");

    // In first part
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 1, tb.tab_width)); // before 'e'

    // Before space
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 5, tb.tab_width)); // before ' '

    // Before emoji
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 6, tb.tab_width)); // before emoji

    // At end (after emoji)
    try testing.expectEqual(@as(u32, 2), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 8, tb.tab_width)); // after emoji
}

test "getPrevGraphemeWidth - empty line" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Empty line
    try tb.setText("");

    try testing.expectEqual(@as(u32, 0), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 0, tb.tab_width));
}

test "getPrevGraphemeWidth - col beyond line width" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("abc");

    // Request col 100, should clamp to line width (3) and return 'c'
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 100, tb.tab_width));
}

test "getPrevGraphemeWidth - multiline" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("abc\n😀xyz");

    // Line 0
    try testing.expectEqual(@as(u32, 0), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 0, tb.tab_width));
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 3, tb.tab_width)); // after 'c'

    // Line 1
    try testing.expectEqual(@as(u32, 0), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 1, 0, tb.tab_width)); // start of line
    try testing.expectEqual(@as(u32, 2), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 1, 2, tb.tab_width)); // after emoji
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 1, 3, tb.tab_width)); // after 'x'
}

// ====== NEW TESTS FOR MISSING EDGE CASES ======

test "getGraphemeWidthAt - CJK characters (Chinese)" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // "a世界b" - 'a' (width 1), '世' (width 2), '界' (width 2), 'b' (width 1)
    try tb.setText("a世界b");

    // 'a' at column 0
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 0, tb.tab_width));

    // '世' at column 1 (width 2)
    try testing.expectEqual(@as(u32, 2), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 1, tb.tab_width));

    // '界' at column 3 (width 2)
    try testing.expectEqual(@as(u32, 2), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 3, tb.tab_width));

    // 'b' at column 5
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 5, tb.tab_width));

    // At end
    try testing.expectEqual(@as(u32, 0), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 6, tb.tab_width));
}

test "getGraphemeWidthAt - various emoji including star" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // "🌟🎉" - star emoji (width 2), party emoji (width 2)
    try tb.setText("🌟🎉");

    // Star emoji at column 0 (width 2)
    try testing.expectEqual(@as(u32, 2), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 0, tb.tab_width));

    // Party emoji at column 2 (width 2)
    try testing.expectEqual(@as(u32, 2), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 2, tb.tab_width));

    // At end
    try testing.expectEqual(@as(u32, 0), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 4, tb.tab_width));
}

test "getGraphemeWidthAt - tab characters" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();
    tb.setTabWidth(4);

    // "a\tb\t\tc" - 'a', tab (width 4), 'b', tab (width 4), tab (width 4), 'c'
    try tb.setText("a\tb\t\tc");

    // 'a' at column 0
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 0, tb.tab_width));

    // tab at column 1 (width 4)
    try testing.expectEqual(@as(u32, 4), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 1, tb.tab_width));

    // 'b' at column 5 (after tab)
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 5, tb.tab_width));

    // tab at column 6
    try testing.expectEqual(@as(u32, 4), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 6, tb.tab_width));

    // tab at column 10
    try testing.expectEqual(@as(u32, 4), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 10, tb.tab_width));

    // 'c' at column 14
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 14, tb.tab_width));
}

test "getGraphemeWidthAt - tab with different tab_width" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("x\ty");

    // tab with tab_width=2
    tb.setTabWidth(2);
    try testing.expectEqual(@as(u32, 2), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 1, 2));

    // tab with tab_width=8
    try testing.expectEqual(@as(u32, 8), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 1, 8));
}

test "getGraphemeWidthAt - middle of wide character" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // "世" - Chinese character with width 2
    try tb.setText("世");

    // At column 0 (start of wide char) - should return width 2
    try testing.expectEqual(@as(u32, 2), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 0, tb.tab_width));

    // At column 1 (middle of wide char) - should return 0 or handle gracefully
    // This tests what happens when querying inside a wide character's display width
    const result = iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 1, tb.tab_width);
    // The actual behavior depends on implementation - document what we get
    _ = result; // Verify it doesn't crash
}

test "getGraphemeWidthAt - invalid row" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("test");

    // Only one line (line 0), query line 5
    try testing.expectEqual(@as(u32, 0), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 5, 0, tb.tab_width));
}

test "getPrevGraphemeWidth - CJK characters" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // "a世界b" - 'a' (width 1), '世' (width 2), '界' (width 2), 'b' (width 1)
    try tb.setText("a世界b");

    // At start
    try testing.expectEqual(@as(u32, 0), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 0, tb.tab_width));

    // Before '世' (previous is 'a')
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 1, tb.tab_width));

    // After '世' (previous is '世', width 2)
    try testing.expectEqual(@as(u32, 2), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 3, tb.tab_width));

    // After '界' (previous is '界', width 2)
    try testing.expectEqual(@as(u32, 2), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 5, tb.tab_width));

    // At end (previous is 'b')
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 6, tb.tab_width));
}

test "getPrevGraphemeWidth - star emoji" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // "x🌟y" - 'x' (width 1), star emoji (width 2), 'y' (width 1)
    try tb.setText("x🌟y");

    // Before star (previous is 'x')
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 1, tb.tab_width));

    // After star (previous is star, width 2)
    try testing.expectEqual(@as(u32, 2), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 3, tb.tab_width));

    // At end (previous is 'y')
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 4, tb.tab_width));
}

test "getPrevGraphemeWidth - tabs" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();
    tb.setTabWidth(4);

    // "a\tb" - 'a', tab (width 4), 'b'
    try tb.setText("a\tb");

    // Before tab (previous is 'a')
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 1, tb.tab_width));

    // After tab (previous is tab, width 4)
    try testing.expectEqual(@as(u32, 4), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 5, tb.tab_width));

    // At end (previous is 'b')
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 6, tb.tab_width));
}

test "getPrevGraphemeWidth - invalid row" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("test");

    // Only one line (line 0), query line 10
    try testing.expectEqual(@as(u32, 0), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 10, 5, tb.tab_width));
}

test "getGraphemeWidthAt and getPrevGraphemeWidth - mixed content" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();
    tb.setTabWidth(4);

    // Complex line: "Hi\t世🌟!" - ASCII, tab, CJK, emoji, ASCII
    try tb.setText("Hi\t世🌟!");

    // Test getGraphemeWidthAt at various positions
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 0, tb.tab_width)); // 'H'
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 1, tb.tab_width)); // 'i'
    try testing.expectEqual(@as(u32, 4), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 2, tb.tab_width)); // tab
    try testing.expectEqual(@as(u32, 2), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 6, tb.tab_width)); // '世'
    try testing.expectEqual(@as(u32, 2), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 8, tb.tab_width)); // '🌟'
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&tb.rope, &tb.mem_registry, 0, 10, tb.tab_width)); // '!'

    // Test getPrevGraphemeWidth
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 1, tb.tab_width)); // before 'i'
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 2, tb.tab_width)); // before tab
    try testing.expectEqual(@as(u32, 4), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 6, tb.tab_width)); // before '世'
    try testing.expectEqual(@as(u32, 2), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 8, tb.tab_width)); // before '🌟'
    try testing.expectEqual(@as(u32, 2), iter_mod.getPrevGraphemeWidth(&tb.rope, &tb.mem_registry, 0, 10, tb.tab_width)); // before '!'
}
