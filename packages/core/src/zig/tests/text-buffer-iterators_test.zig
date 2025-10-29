const std = @import("std");
const testing = std.testing;
const iter_mod = @import("../text-buffer-iterators.zig");
const seg_mod = @import("../text-buffer-segment.zig");
const utf8 = @import("../utf8.zig");
const gwidth = @import("../gwidth.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");

const Segment = seg_mod.Segment;
const UnifiedRope = seg_mod.UnifiedRope;
const LineInfo = iter_mod.LineInfo;
const TextChunk = seg_mod.TextChunk;
const MemRegistry = seg_mod.MemRegistry;

/// Helper to create a TextChunk from text bytes
fn createChunk(
    allocator: std.mem.Allocator,
    registry: *MemRegistry,
    text: []const u8,
    display_width: *const DisplayWidth,
) !TextChunk {
    const mem = try allocator.dupe(u8, text);
    const mem_id = try registry.register(mem, true);

    // Calculate width
    var width: u32 = 0;
    var is_ascii = true;
    var i: usize = 0;
    while (i < text.len) {
        const cp_len = std.unicode.utf8ByteSequenceLength(text[i]) catch 1;
        if (cp_len > 1) is_ascii = false;
        const cp = std.unicode.utf8Decode(text[i .. i + cp_len]) catch 0x0;
        const w = display_width.codePointWidth(cp);
        width += @as(u32, @intCast(@max(0, w)));
        i += cp_len;
    }

    return TextChunk{
        .mem_id = mem_id,
        .byte_start = 0,
        .byte_end = @intCast(text.len),
        .width = @intCast(width),
        .flags = if (is_ascii) TextChunk.Flags.ASCII_ONLY else 0,
    };
}

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
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var graphemes_data = try Graphemes.init(allocator);
    defer graphemes_data.deinit(allocator);
    var display_width = try DisplayWidth.init(allocator);
    defer display_width.deinit(allocator);

    var registry = MemRegistry.init(allocator);
    defer registry.deinit();

    var rope = try UnifiedRope.init(allocator);
    try rope.append(Segment{ .linestart = {} });

    // "Hello" - all ASCII, each character is width 1
    const chunk = try createChunk(allocator, &registry, "Hello", &display_width);
    try rope.append(Segment{ .text = chunk });

    // Test getting width at various positions
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&rope, &registry, 0, 0, 2)); // 'H'
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&rope, &registry, 0, 1, 2)); // 'e'
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&rope, &registry, 0, 2, 2)); // 'l'
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&rope, &registry, 0, 3, 2)); // 'l'
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&rope, &registry, 0, 4, 2)); // 'o'

    // At end of line
    try testing.expectEqual(@as(u32, 0), iter_mod.getGraphemeWidthAt(&rope, &registry, 0, 5, 2));

    // Beyond end of line
    try testing.expectEqual(@as(u32, 0), iter_mod.getGraphemeWidthAt(&rope, &registry, 0, 10, 2));
}

test "getGraphemeWidthAt - emoji and wide characters" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var graphemes_data = try Graphemes.init(allocator);
    defer graphemes_data.deinit(allocator);
    var display_width = try DisplayWidth.init(allocator);
    defer display_width.deinit(allocator);

    var registry = MemRegistry.init(allocator);
    defer registry.deinit();

    var rope = try UnifiedRope.init(allocator);
    try rope.append(Segment{ .linestart = {} });

    // "a😀b" - 'a' (width 1), emoji (width 2), 'b' (width 1)
    const chunk = try createChunk(allocator, &registry, "a😀b", &display_width);
    try rope.append(Segment{ .text = chunk });

    // 'a' at column 0
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&rope, &registry, 0, 0, 2));

    // emoji at column 1 (width 2)
    try testing.expectEqual(@as(u32, 2), iter_mod.getGraphemeWidthAt(&rope, &registry, 0, 1, 2));

    // 'b' at column 3
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&rope, &registry, 0, 3, 2));

    // At end
    try testing.expectEqual(@as(u32, 0), iter_mod.getGraphemeWidthAt(&rope, &registry, 0, 4, 2));
}

test "getGraphemeWidthAt - multiple chunks" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var graphemes_data = try Graphemes.init(allocator);
    defer graphemes_data.deinit(allocator);
    var display_width = try DisplayWidth.init(allocator);
    defer display_width.deinit(allocator);

    var registry = MemRegistry.init(allocator);
    defer registry.deinit();

    var rope = try UnifiedRope.init(allocator);
    try rope.append(Segment{ .linestart = {} });

    // "Hello" + " " + "World"
    const chunk1 = try createChunk(allocator, &registry, "Hello", &display_width);
    const chunk2 = try createChunk(allocator, &registry, " ", &display_width);
    const chunk3 = try createChunk(allocator, &registry, "World", &display_width);

    try rope.append(Segment{ .text = chunk1 });
    try rope.append(Segment{ .text = chunk2 });
    try rope.append(Segment{ .text = chunk3 });

    // Test in first chunk
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&rope, &registry, 0, 0, 2)); // 'H'
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&rope, &registry, 0, 4, 2)); // 'o'

    // Test in second chunk
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&rope, &registry, 0, 5, 2)); // ' '

    // Test in third chunk
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&rope, &registry, 0, 6, 2)); // 'W'
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&rope, &registry, 0, 10, 2)); // 'd'

    // At end
    try testing.expectEqual(@as(u32, 0), iter_mod.getGraphemeWidthAt(&rope, &registry, 0, 11, 2));
}

test "getGraphemeWidthAt - empty line" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var registry = MemRegistry.init(allocator);
    defer registry.deinit();

    var rope = try UnifiedRope.init(allocator);
    try rope.append(Segment{ .linestart = {} });

    // Empty line - just linestart, no text
    try testing.expectEqual(@as(u32, 0), iter_mod.getGraphemeWidthAt(&rope, &registry, 0, 0, 2));
}

test "getGraphemeWidthAt - at chunk boundary" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var graphemes_data = try Graphemes.init(allocator);
    defer graphemes_data.deinit(allocator);
    var display_width = try DisplayWidth.init(allocator);
    defer display_width.deinit(allocator);

    var registry = MemRegistry.init(allocator);
    defer registry.deinit();

    var rope = try UnifiedRope.init(allocator);
    try rope.append(Segment{ .linestart = {} });

    // Two chunks: "abc" (width 3) + "def" (width 3)
    const chunk1 = try createChunk(allocator, &registry, "abc", &display_width);
    const chunk2 = try createChunk(allocator, &registry, "def", &display_width);

    try rope.append(Segment{ .text = chunk1 });
    try rope.append(Segment{ .text = chunk2 });

    // At boundary: col 3 is first char of second chunk
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&rope, &registry, 0, 3, 2)); // 'd'
}

test "getGraphemeWidthAt - after break segment" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var graphemes_data = try Graphemes.init(allocator);
    defer graphemes_data.deinit(allocator);
    var display_width = try DisplayWidth.init(allocator);
    defer display_width.deinit(allocator);

    var registry = MemRegistry.init(allocator);
    defer registry.deinit();

    var rope = try UnifiedRope.init(allocator);
    try rope.append(Segment{ .linestart = {} });

    const chunk1 = try createChunk(allocator, &registry, "abc", &display_width);
    try rope.append(Segment{ .text = chunk1 });
    try rope.append(Segment{ .brk = {} });
    try rope.append(Segment{ .linestart = {} });

    const chunk2 = try createChunk(allocator, &registry, "def", &display_width);
    try rope.append(Segment{ .text = chunk2 });

    // Test on line 0
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&rope, &registry, 0, 0, 2)); // 'a'
    try testing.expectEqual(@as(u32, 0), iter_mod.getGraphemeWidthAt(&rope, &registry, 0, 3, 2)); // end of line

    // Test on line 1
    try testing.expectEqual(@as(u32, 1), iter_mod.getGraphemeWidthAt(&rope, &registry, 1, 0, 2)); // 'd'
}

test "getPrevGraphemeWidth - ASCII text" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var graphemes_data = try Graphemes.init(allocator);
    defer graphemes_data.deinit(allocator);
    var display_width = try DisplayWidth.init(allocator);
    defer display_width.deinit(allocator);

    var registry = MemRegistry.init(allocator);
    defer registry.deinit();

    var rope = try UnifiedRope.init(allocator);
    try rope.append(Segment{ .linestart = {} });

    // "Hello" - all ASCII
    const chunk = try createChunk(allocator, &registry, "Hello", &display_width);
    try rope.append(Segment{ .text = chunk });

    // At start - no previous grapheme
    try testing.expectEqual(@as(u32, 0), iter_mod.getPrevGraphemeWidth(&rope, &registry, 0, 0, 2));

    // Previous graphemes
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&rope, &registry, 0, 1, 2)); // before 'e'
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&rope, &registry, 0, 2, 2)); // before first 'l'
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&rope, &registry, 0, 3, 2)); // before second 'l'
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&rope, &registry, 0, 4, 2)); // before 'o'
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&rope, &registry, 0, 5, 2)); // at end
}

test "getPrevGraphemeWidth - emoji and wide characters" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var graphemes_data = try Graphemes.init(allocator);
    defer graphemes_data.deinit(allocator);
    var display_width = try DisplayWidth.init(allocator);
    defer display_width.deinit(allocator);

    var registry = MemRegistry.init(allocator);
    defer registry.deinit();

    var rope = try UnifiedRope.init(allocator);
    try rope.append(Segment{ .linestart = {} });

    // "a😀b" - 'a' (width 1), emoji (width 2), 'b' (width 1)
    const chunk = try createChunk(allocator, &registry, "a😀b", &display_width);
    try rope.append(Segment{ .text = chunk });

    // At start
    try testing.expectEqual(@as(u32, 0), iter_mod.getPrevGraphemeWidth(&rope, &registry, 0, 0, 2));

    // Before emoji (previous is 'a')
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&rope, &registry, 0, 1, 2));

    // After emoji (previous is emoji, width 2)
    try testing.expectEqual(@as(u32, 2), iter_mod.getPrevGraphemeWidth(&rope, &registry, 0, 3, 2));

    // At end (previous is 'b')
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&rope, &registry, 0, 4, 2));
}

test "getPrevGraphemeWidth - at chunk boundary" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var graphemes_data = try Graphemes.init(allocator);
    defer graphemes_data.deinit(allocator);
    var display_width = try DisplayWidth.init(allocator);
    defer display_width.deinit(allocator);

    var registry = MemRegistry.init(allocator);
    defer registry.deinit();

    var rope = try UnifiedRope.init(allocator);
    try rope.append(Segment{ .linestart = {} });

    // Two chunks: "abc" (width 3) + "def" (width 3)
    const chunk1 = try createChunk(allocator, &registry, "abc", &display_width);
    const chunk2 = try createChunk(allocator, &registry, "def", &display_width);

    try rope.append(Segment{ .text = chunk1 });
    try rope.append(Segment{ .text = chunk2 });

    // At exact chunk boundary: col 3 (start of second chunk)
    // Previous grapheme should be 'c' from first chunk
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&rope, &registry, 0, 3, 2));

    // Within second chunk
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&rope, &registry, 0, 4, 2)); // before 'e'
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&rope, &registry, 0, 5, 2)); // before 'f'
}

test "getPrevGraphemeWidth - emoji at chunk boundary" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var graphemes_data = try Graphemes.init(allocator);
    defer graphemes_data.deinit(allocator);
    var display_width = try DisplayWidth.init(allocator);
    defer display_width.deinit(allocator);

    var registry = MemRegistry.init(allocator);
    defer registry.deinit();

    var rope = try UnifiedRope.init(allocator);
    try rope.append(Segment{ .linestart = {} });

    // Two chunks: "a😀" (width 3) + "b" (width 1)
    const chunk1 = try createChunk(allocator, &registry, "a😀", &display_width);
    const chunk2 = try createChunk(allocator, &registry, "b", &display_width);

    try rope.append(Segment{ .text = chunk1 });
    try rope.append(Segment{ .text = chunk2 });

    // At exact chunk boundary: col 3 (start of second chunk)
    // Previous grapheme should be the emoji (width 2) from first chunk
    try testing.expectEqual(@as(u32, 2), iter_mod.getPrevGraphemeWidth(&rope, &registry, 0, 3, 2));
}

test "getPrevGraphemeWidth - multiple chunks" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var graphemes_data = try Graphemes.init(allocator);
    defer graphemes_data.deinit(allocator);
    var display_width = try DisplayWidth.init(allocator);
    defer display_width.deinit(allocator);

    var registry = MemRegistry.init(allocator);
    defer registry.deinit();

    var rope = try UnifiedRope.init(allocator);
    try rope.append(Segment{ .linestart = {} });

    // "Hello" + " " + "😀"
    const chunk1 = try createChunk(allocator, &registry, "Hello", &display_width);
    const chunk2 = try createChunk(allocator, &registry, " ", &display_width);
    const chunk3 = try createChunk(allocator, &registry, "😀", &display_width);

    try rope.append(Segment{ .text = chunk1 });
    try rope.append(Segment{ .text = chunk2 });
    try rope.append(Segment{ .text = chunk3 });

    // In first chunk
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&rope, &registry, 0, 1, 2)); // before 'e'

    // At boundary between first and second
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&rope, &registry, 0, 5, 2)); // before ' '

    // At boundary between second and third
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&rope, &registry, 0, 6, 2)); // before emoji

    // At end (after emoji)
    try testing.expectEqual(@as(u32, 2), iter_mod.getPrevGraphemeWidth(&rope, &registry, 0, 8, 2)); // after emoji
}

test "getPrevGraphemeWidth - empty line" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var registry = MemRegistry.init(allocator);
    defer registry.deinit();

    var rope = try UnifiedRope.init(allocator);
    try rope.append(Segment{ .linestart = {} });

    // Empty line
    try testing.expectEqual(@as(u32, 0), iter_mod.getPrevGraphemeWidth(&rope, &registry, 0, 0, 2));
}

test "getPrevGraphemeWidth - col beyond line width" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var graphemes_data = try Graphemes.init(allocator);
    defer graphemes_data.deinit(allocator);
    var display_width = try DisplayWidth.init(allocator);
    defer display_width.deinit(allocator);

    var registry = MemRegistry.init(allocator);
    defer registry.deinit();

    var rope = try UnifiedRope.init(allocator);
    try rope.append(Segment{ .linestart = {} });

    const chunk = try createChunk(allocator, &registry, "abc", &display_width);
    try rope.append(Segment{ .text = chunk });

    // Request col 100, should clamp to line width (3) and return 'c'
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&rope, &registry, 0, 100, 2));
}

test "getPrevGraphemeWidth - multiline" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var graphemes_data = try Graphemes.init(allocator);
    defer graphemes_data.deinit(allocator);
    var display_width = try DisplayWidth.init(allocator);
    defer display_width.deinit(allocator);

    var registry = MemRegistry.init(allocator);
    defer registry.deinit();

    var rope = try UnifiedRope.init(allocator);
    try rope.append(Segment{ .linestart = {} });

    const chunk1 = try createChunk(allocator, &registry, "abc", &display_width);
    try rope.append(Segment{ .text = chunk1 });
    try rope.append(Segment{ .brk = {} });
    try rope.append(Segment{ .linestart = {} });

    const chunk2 = try createChunk(allocator, &registry, "😀xyz", &display_width);
    try rope.append(Segment{ .text = chunk2 });

    // Line 0
    try testing.expectEqual(@as(u32, 0), iter_mod.getPrevGraphemeWidth(&rope, &registry, 0, 0, 2));
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&rope, &registry, 0, 3, 2)); // after 'c'

    // Line 1
    try testing.expectEqual(@as(u32, 0), iter_mod.getPrevGraphemeWidth(&rope, &registry, 1, 0, 2)); // start of line
    try testing.expectEqual(@as(u32, 2), iter_mod.getPrevGraphemeWidth(&rope, &registry, 1, 2, 2)); // after emoji
    try testing.expectEqual(@as(u32, 1), iter_mod.getPrevGraphemeWidth(&rope, &registry, 1, 3, 2)); // after 'x'
}
