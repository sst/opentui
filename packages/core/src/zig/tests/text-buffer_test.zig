const std = @import("std");
const text_buffer = @import("../text-buffer.zig");
const gp = @import("../grapheme.zig");

const TextBuffer = text_buffer.TextBuffer;
const RGBA = text_buffer.RGBA;

const LineInfo = struct {
    line_count: u32,
    lines: []const text_buffer.TextLine,
};

fn testWriteAndGetLineInfo(tb: *TextBuffer, text: []const u8, fg: ?RGBA, bg: ?RGBA, attr: ?u8) !LineInfo {
    _ = try tb.writeChunk(text, fg, bg, attr);
    tb.finalizeLineInfo();
    return LineInfo{
        .line_count = tb.getLineCount(),
        .lines = tb.lines.items,
    };
}

test "TextBuffer line info - empty buffer" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "", null, null, null);

    try std.testing.expectEqual(@as(u32, 1), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].width);
}

test "TextBuffer line info - simple text without newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "Hello World", null, null, null);

    try std.testing.expectEqual(@as(u32, 1), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start);
    try std.testing.expect(lineInfo.lines[0].width > 0);
}

test "TextBuffer line info - single newline" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "Hello\nWorld", null, null, null);

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start);
    try std.testing.expectEqual(@as(u32, 6), lineInfo.lines[1].char_start); // line_starts[1] ("Hello\n" = 6 chars)
    try std.testing.expect(lineInfo.lines[0].width > 0);
    try std.testing.expect(lineInfo.lines[1].width > 0);
}

test "TextBuffer line info - multiple lines separated by newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "Line 1\nLine 2\nLine 3", null, null, null);

    try std.testing.expectEqual(@as(u32, 3), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start);
    try std.testing.expectEqual(@as(u32, 7), lineInfo.lines[1].char_start); // line_starts[1] ("Line 1\n" = 7 chars)
    try std.testing.expectEqual(@as(u32, 14), lineInfo.lines[2].char_start); // line_starts[2] ("Line 1\nLine 2\n" = 14 chars)

    // All line widths should be > 0
    try std.testing.expect(lineInfo.lines[0].width > 0);
    try std.testing.expect(lineInfo.lines[1].width > 0);
    try std.testing.expect(lineInfo.lines[2].width > 0);
}

test "TextBuffer line info - text ending with newline" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "Hello World\n", null, null, null);

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start);
    try std.testing.expectEqual(@as(u32, 12), lineInfo.lines[1].char_start); // line_starts[1] ("Hello World\n" = 12 chars)
    try std.testing.expect(lineInfo.lines[0].width > 0);
    try std.testing.expect(lineInfo.lines[1].width >= 0); // line_widths[1] (second line may have width 0 or some default width)
}

test "TextBuffer line info - consecutive newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "Line 1\n\nLine 3", null, null, null);

    try std.testing.expectEqual(@as(u32, 3), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start);
    try std.testing.expectEqual(@as(u32, 7), lineInfo.lines[1].char_start); // line_starts[1] ("Line 1\n" = 7 chars)
    try std.testing.expectEqual(@as(u32, 8), lineInfo.lines[2].char_start); // line_starts[2] ("Line 1\n\n" = 8 chars)
}

test "TextBuffer line info - text starting with newline" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "\nHello World", null, null, null);

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start); // line_starts[0] (empty first line)
    try std.testing.expectEqual(@as(u32, 1), lineInfo.lines[1].char_start); // line_starts[1] ("\n" = 1 char)
}

test "TextBuffer line info - only newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "\n\n\n", null, null, null);

    try std.testing.expectEqual(@as(u32, 4), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start);
    try std.testing.expectEqual(@as(u32, 1), lineInfo.lines[1].char_start);
    try std.testing.expectEqual(@as(u32, 2), lineInfo.lines[2].char_start);
    try std.testing.expectEqual(@as(u32, 3), lineInfo.lines[3].char_start);
    // All line widths should be >= 0
    try std.testing.expect(lineInfo.lines[0].width >= 0);
    try std.testing.expect(lineInfo.lines[1].width >= 0);
    try std.testing.expect(lineInfo.lines[2].width >= 0);
    try std.testing.expect(lineInfo.lines[3].width >= 0);
}

test "TextBuffer line info - wide characters (Unicode)" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "Hello 世界 🌟", null, null, null);

    try std.testing.expectEqual(@as(u32, 1), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start);
    try std.testing.expect(lineInfo.lines[0].width > 0);
}

test "TextBuffer line info - empty lines between content" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "First\n\nThird", null, null, null);

    try std.testing.expectEqual(@as(u32, 3), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start);
    try std.testing.expectEqual(@as(u32, 6), lineInfo.lines[1].char_start); // line_starts[1] ("First\n")
    try std.testing.expectEqual(@as(u32, 7), lineInfo.lines[2].char_start); // line_starts[2] ("First\n\n")
}

test "TextBuffer line info - very long lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 2000, pool, .wcwidth);
    defer tb.deinit();

    // Create a long text with 1000 'A' characters
    const longText = [_]u8{'A'} ** 1000;
    const lineInfo = try testWriteAndGetLineInfo(tb, &longText, null, null, null);

    try std.testing.expectEqual(@as(u32, 1), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start);
    try std.testing.expect(lineInfo.lines[0].width > 0);
}

test "TextBuffer line info - lines with different widths" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 1000, pool, .wcwidth);
    defer tb.deinit();

    // Create text with different line lengths
    var text_builder = std.ArrayList(u8).init(std.testing.allocator);
    defer text_builder.deinit();
    try text_builder.appendSlice("Short\n");
    try text_builder.appendNTimes('A', 50);
    try text_builder.appendSlice("\nMedium");
    const text = text_builder.items;
    const lineInfo = try testWriteAndGetLineInfo(tb, text, null, null, null);

    try std.testing.expectEqual(@as(u32, 3), lineInfo.line_count);
    try std.testing.expect(lineInfo.lines[0].width < lineInfo.lines[1].width); // Short < Long
    try std.testing.expect(lineInfo.lines[1].width > lineInfo.lines[2].width); // Long > Medium
}

test "TextBuffer line info - styled text with colors" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth);
    defer tb.deinit();

    // Write "Red" with red foreground
    const red_fg = RGBA{ 1.0, 0.0, 0.0, 1.0 };
    _ = try tb.writeChunk("Red", red_fg, null, null);

    // Write newline
    _ = try tb.writeChunk("\n", null, null, null);

    // Write "Blue" with blue foreground
    const blue_fg = RGBA{ 0.0, 0.0, 1.0, 1.0 };
    _ = try tb.writeChunk("Blue", blue_fg, null, null);

    const lineInfo = try testWriteAndGetLineInfo(tb, "", null, null, null);

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start);
    try std.testing.expectEqual(@as(u32, 4), lineInfo.lines[1].char_start); // line_starts[1] ("Red\n" = 4 chars)
}

test "TextBuffer line info - buffer with only whitespace" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "   \n \n ", null, null, null);

    try std.testing.expectEqual(@as(u32, 3), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start);
    try std.testing.expectEqual(@as(u32, 4), lineInfo.lines[1].char_start); // line_starts[1] ("   \n" = 4 chars)
    try std.testing.expectEqual(@as(u32, 6), lineInfo.lines[2].char_start); // line_starts[2] ("   \n \n" = 6 chars)

    // Whitespace should still contribute to line widths
    try std.testing.expect(lineInfo.lines[0].width >= 0);
    try std.testing.expect(lineInfo.lines[1].width >= 0);
    try std.testing.expect(lineInfo.lines[2].width >= 0);
}

test "TextBuffer line info - single character lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "A\nB\nC", null, null, null);

    try std.testing.expectEqual(@as(u32, 3), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start);
    try std.testing.expectEqual(@as(u32, 2), lineInfo.lines[1].char_start); // line_starts[1] ("A\n" = 2 chars)
    try std.testing.expectEqual(@as(u32, 4), lineInfo.lines[2].char_start); // line_starts[2] ("A\nB\n" = 4 chars)

    // All widths should be > 0
    try std.testing.expect(lineInfo.lines[0].width > 0);
    try std.testing.expect(lineInfo.lines[1].width > 0);
    try std.testing.expect(lineInfo.lines[2].width > 0);
}

test "TextBuffer line info - mixed content with special characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "Normal\n123\n!@#\n测试\n", null, null, null);

    try std.testing.expectEqual(@as(u32, 5), lineInfo.line_count); // line_count (4 lines + empty line at end)
    // All line widths should be >= 0
    try std.testing.expect(lineInfo.lines[0].width >= 0);
    try std.testing.expect(lineInfo.lines[1].width >= 0);
    try std.testing.expect(lineInfo.lines[2].width >= 0);
    try std.testing.expect(lineInfo.lines[3].width >= 0);
    try std.testing.expect(lineInfo.lines[4].width >= 0);
}

test "TextBuffer line info - buffer resize operations" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    // Create a small buffer that will need to resize
    var tb = try TextBuffer.init(std.testing.allocator, 16, pool, .wcwidth);
    defer tb.deinit();

    // Add text that will cause multiple resizes
    var text_builder = std.ArrayList(u8).init(std.testing.allocator);
    defer text_builder.deinit();
    try text_builder.appendNTimes('A', 100);
    try text_builder.appendSlice("\n");
    try text_builder.appendNTimes('B', 100);
    const longText = text_builder.items;
    const lineInfo = try testWriteAndGetLineInfo(tb, longText, null, null, null);

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
}

test "TextBuffer line info - thousands of lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 10000, pool, .wcwidth);
    defer tb.deinit();

    // Create text with 1000 lines
    var text_builder = std.ArrayList(u8).init(std.testing.allocator);
    defer text_builder.deinit();

    var i: u32 = 0;
    while (i < 999) : (i += 1) {
        try std.fmt.format(text_builder.writer(), "Line {}\n", .{i});
    }
    // Last line without newline
    try std.fmt.format(text_builder.writer(), "Line {}", .{i});

    const lineInfo = try testWriteAndGetLineInfo(tb, text_builder.items, null, null, null);

    try std.testing.expectEqual(@as(u32, 1000), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start);

    // Check that line starts are monotonically increasing
    var line_idx: u32 = 1;
    while (line_idx < 1000) : (line_idx += 1) {
        try std.testing.expect(lineInfo.lines[line_idx].char_start > lineInfo.lines[line_idx - 1].char_start);
    }
}

test "TextBuffer line info - alternating empty and content lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "\nContent\n\nMore\n\n", null, null, null);

    try std.testing.expectEqual(@as(u32, 6), lineInfo.line_count);
    // All line widths should be >= 0
    try std.testing.expect(lineInfo.lines[0].width >= 0);
    try std.testing.expect(lineInfo.lines[1].width >= 0);
    try std.testing.expect(lineInfo.lines[2].width >= 0);
    try std.testing.expect(lineInfo.lines[3].width >= 0);
    try std.testing.expect(lineInfo.lines[4].width >= 0);
    try std.testing.expect(lineInfo.lines[5].width >= 0);
}

test "TextBuffer line info - complex Unicode combining characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "café\nnaïve\nrésumé", null, null, null);

    try std.testing.expectEqual(@as(u32, 3), lineInfo.line_count);
    try std.testing.expect(lineInfo.lines[0].width > 0);
    try std.testing.expect(lineInfo.lines[1].width > 0);
    try std.testing.expect(lineInfo.lines[2].width > 0);
}

test "TextBuffer line info - default styles" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth);
    defer tb.deinit();

    // Set default styles
    const red_fg = RGBA{ 1.0, 0.0, 0.0, 1.0 };
    const black_bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    tb.setDefaultFg(red_fg);
    tb.setDefaultBg(black_bg);
    tb.setDefaultAttributes(1);

    const lineInfo = try testWriteAndGetLineInfo(tb, "Test\nText", null, null, null);

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start);
    try std.testing.expectEqual(@as(u32, 5), lineInfo.lines[1].char_start); // line_starts[1] ("Test\n" = 5 chars)
    // All line widths should be >= 0
    try std.testing.expect(lineInfo.lines[0].width >= 0);
    try std.testing.expect(lineInfo.lines[1].width >= 0);
}

test "TextBuffer line info - reset defaults" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth);
    defer tb.deinit();

    // Set and then reset defaults
    const red_fg = RGBA{ 1.0, 0.0, 0.0, 1.0 };
    tb.setDefaultFg(red_fg);
    tb.resetDefaults();

    const lineInfo = try testWriteAndGetLineInfo(tb, "Test\nText", null, null, null);

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start);
    try std.testing.expectEqual(@as(u32, 5), lineInfo.lines[1].char_start);
    // All line widths should be >= 0
    try std.testing.expect(lineInfo.lines[0].width >= 0);
    try std.testing.expect(lineInfo.lines[1].width >= 0);
}

test "TextBuffer line info - unicode width method" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .unicode);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "Hello 世界 🌟", null, null, null);

    try std.testing.expectEqual(@as(u32, 1), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start);
    try std.testing.expect(lineInfo.lines[0].width > 0);
}

test "TextBuffer line info - unicode mixed content with special characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .unicode);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "Normal\n123\n!@#\n测试\n", null, null, null);

    try std.testing.expectEqual(@as(u32, 5), lineInfo.line_count); // line_count (4 lines + empty line at end)
    // All line widths should be >= 0
    try std.testing.expect(lineInfo.lines[0].width >= 0);
    try std.testing.expect(lineInfo.lines[1].width >= 0);
    try std.testing.expect(lineInfo.lines[2].width >= 0);
    try std.testing.expect(lineInfo.lines[3].width >= 0);
    try std.testing.expect(lineInfo.lines[4].width >= 0);
}

test "TextBuffer line info - unicode styled text with colors and attributes" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .unicode);
    defer tb.deinit();

    // Write "Red" with red foreground
    const red_fg = RGBA{ 1.0, 0.0, 0.0, 1.0 };
    _ = try tb.writeChunk("Red", red_fg, null, null);

    // Write newline
    _ = try tb.writeChunk("\n", null, null, null);

    // Write "Blue" with blue foreground
    const blue_fg = RGBA{ 0.0, 0.0, 1.0, 1.0 };
    _ = try tb.writeChunk("Blue", blue_fg, null, null);

    const lineInfo = try testWriteAndGetLineInfo(tb, "", null, null, null);

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start);
    try std.testing.expectEqual(@as(u32, 4), lineInfo.lines[1].char_start); // line_starts[1] ("Red\n" = 4 chars)
    // All line widths should be >= 0
    try std.testing.expect(lineInfo.lines[0].width >= 0);
    try std.testing.expect(lineInfo.lines[1].width >= 0);
}

test "TextBuffer line info - extremely long single line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, 20000, pool, .wcwidth);
    defer tb.deinit();

    // Create extremely long text with 10000 'A' characters
    const extremelyLongText = [_]u8{'A'} ** 10000;
    const lineInfo = try testWriteAndGetLineInfo(tb, &extremelyLongText, null, null, null);

    try std.testing.expectEqual(@as(u32, 1), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start);
    try std.testing.expect(lineInfo.lines[0].width > 0);
}
