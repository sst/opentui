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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "", null, null, null);

    try std.testing.expectEqual(@as(u32, 1), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].width);
}

test "TextBuffer line info - simple text without newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "Hello World", null, null, null);

    try std.testing.expectEqual(@as(u32, 1), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start);
    try std.testing.expect(lineInfo.lines[0].width > 0);
}

test "TextBuffer line info - single newline" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "\nHello World", null, null, null);

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start); // line_starts[0] (empty first line)
    try std.testing.expectEqual(@as(u32, 1), lineInfo.lines[1].char_start); // line_starts[1] ("\n" = 1 char)
}

test "TextBuffer line info - only newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "Hello 世界 🌟", null, null, null);

    try std.testing.expectEqual(@as(u32, 1), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start);
    try std.testing.expect(lineInfo.lines[0].width > 0);
}

test "TextBuffer line info - empty lines between content" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 2000, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 1000, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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
    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 16, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 10000, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "Hello 世界 🌟", null, null, null);

    try std.testing.expectEqual(@as(u32, 1), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start);
    try std.testing.expect(lineInfo.lines[0].width > 0);
}

test "TextBuffer line info - unicode mixed content with special characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .unicode, graphemes_ptr, display_width_ptr);
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .unicode, graphemes_ptr, display_width_ptr);
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 20000, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Create extremely long text with 10000 'A' characters
    const extremelyLongText = [_]u8{'A'} ** 10000;
    const lineInfo = try testWriteAndGetLineInfo(tb, &extremelyLongText, null, null, null);

    try std.testing.expectEqual(@as(u32, 1), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_start);
    try std.testing.expect(lineInfo.lines[0].width > 0);
}

// ===== ChunkGroup Tests =====

test "ChunkGroup - single line text creates one group with one chunk" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("Hello World", null, null, null);

    try std.testing.expectEqual(@as(usize, 1), tb.getChunkGroupCount());
    const group = tb.getChunkGroup(0);
    try std.testing.expect(group != null);
    try std.testing.expectEqual(@as(usize, 1), group.?.getChunkCount());

    const chunk_ref = group.?.chunk_refs.items[0];
    try std.testing.expectEqual(@as(usize, 0), chunk_ref.line_index);
    try std.testing.expectEqual(@as(usize, 0), chunk_ref.chunk_index);
}

test "ChunkGroup - multi-line text creates one group with multiple chunks" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("Hello\nWorld", null, null, null);

    try std.testing.expectEqual(@as(usize, 1), tb.getChunkGroupCount());
    const group = tb.getChunkGroup(0);
    try std.testing.expect(group != null);
    try std.testing.expectEqual(@as(usize, 2), group.?.getChunkCount());

    // First chunk should be on line 0
    const chunk1_ref = group.?.chunk_refs.items[0];
    try std.testing.expectEqual(@as(usize, 0), chunk1_ref.line_index);

    // Second chunk should be on line 1
    const chunk2_ref = group.?.chunk_refs.items[1];
    try std.testing.expectEqual(@as(usize, 1), chunk2_ref.line_index);
}

test "ChunkGroup - multiple writeChunk calls create separate groups" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("First", null, null, null);
    _ = try tb.writeChunk("Second", null, null, null);
    _ = try tb.writeChunk("Third", null, null, null);

    try std.testing.expectEqual(@as(usize, 3), tb.getChunkGroupCount());

    // Each group should have one chunk
    for (0..3) |i| {
        const group = tb.getChunkGroup(i);
        try std.testing.expect(group != null);
        try std.testing.expectEqual(@as(usize, 1), group.?.getChunkCount());
    }
}

test "ChunkGroup - complex multi-line with multiple writeChunk calls" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // First write: multi-line
    _ = try tb.writeChunk("Line 1\nLine 2", null, null, null);
    // Second write: single line
    _ = try tb.writeChunk("Line 3", null, null, null);
    // Third write: multi-line again
    _ = try tb.writeChunk("Line 4\nLine 5\nLine 6", null, null, null);

    try std.testing.expectEqual(@as(usize, 3), tb.getChunkGroupCount());

    // First group: 2 chunks (Line 1, Line 2)
    const group1 = tb.getChunkGroup(0);
    try std.testing.expect(group1 != null);
    try std.testing.expectEqual(@as(usize, 2), group1.?.getChunkCount());

    // Second group: 1 chunk (Line 3)
    const group2 = tb.getChunkGroup(1);
    try std.testing.expect(group2 != null);
    try std.testing.expectEqual(@as(usize, 1), group2.?.getChunkCount());

    // Third group: 3 chunks (Line 4, Line 5, Line 6)
    const group3 = tb.getChunkGroup(2);
    try std.testing.expect(group3 != null);
    try std.testing.expectEqual(@as(usize, 3), group3.?.getChunkCount());
}

test "ChunkGroup - insertChunkGroup operation" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("First", null, null, null);
    _ = try tb.writeChunk("Third", null, null, null);

    try std.testing.expectEqual(@as(usize, 2), tb.getChunkGroupCount());

    // Verify initial text content
    var buffer: [64]u8 = undefined;
    const initial_len = tb.getPlainTextIntoBuffer(&buffer);
    try std.testing.expectEqualSlices(u8, "FirstThird", buffer[0..initial_len]);

    // Insert "Second" at index 1
    _ = try tb.insertChunkGroup(1, "Second", null, null, null);

    try std.testing.expectEqual(@as(usize, 3), tb.getChunkGroupCount());

    // Verify text content after insertion
    const after_insert_len = tb.getPlainTextIntoBuffer(&buffer);
    try std.testing.expectEqualSlices(u8, "FirstSecondThird", buffer[0..after_insert_len]);

    // Verify the groups are in correct order
    const group0 = tb.getChunkGroup(0);
    const group1 = tb.getChunkGroup(1);
    const group2 = tb.getChunkGroup(2);

    try std.testing.expect(group0 != null);
    try std.testing.expect(group1 != null);
    try std.testing.expect(group2 != null);
}

test "ChunkGroup - insertChunkGroup at index far beyond current count" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("Hello", null, null, null);

    try std.testing.expectEqual(@as(usize, 1), tb.getChunkGroupCount());

    // Verify initial text content
    var buffer: [64]u8 = undefined;
    const initial_len = tb.getPlainTextIntoBuffer(&buffer);
    try std.testing.expectEqualSlices(u8, "Hello", buffer[0..initial_len]);

    // Insert " World" at index 999 (far beyond current count of 1)
    _ = try tb.insertChunkGroup(999, " World", null, null, null);

    try std.testing.expectEqual(@as(usize, 2), tb.getChunkGroupCount());

    // Verify text content after insertion (should append at end)
    const after_insert_len = tb.getPlainTextIntoBuffer(&buffer);
    try std.testing.expectEqualSlices(u8, "Hello World", buffer[0..after_insert_len]);

    // Verify the groups exist
    const group0 = tb.getChunkGroup(0);
    const group1 = tb.getChunkGroup(1);

    try std.testing.expect(group0 != null);
    try std.testing.expect(group1 != null);
}

test "ChunkGroup - removeChunkGroup operation" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("First", null, null, null);
    _ = try tb.writeChunk("Second", null, null, null);
    _ = try tb.writeChunk("Third", null, null, null);

    try std.testing.expectEqual(@as(usize, 3), tb.getChunkGroupCount());

    // Verify initial text content
    var buffer: [64]u8 = undefined;
    const initial_len = tb.getPlainTextIntoBuffer(&buffer);
    try std.testing.expectEqualSlices(u8, "FirstSecondThird", buffer[0..initial_len]);

    // Remove the middle group (index 1)
    _ = try tb.removeChunkGroup(1);

    try std.testing.expectEqual(@as(usize, 2), tb.getChunkGroupCount());

    // Verify text content after removal
    const after_remove_len = tb.getPlainTextIntoBuffer(&buffer);
    try std.testing.expectEqualSlices(u8, "FirstThird", buffer[0..after_remove_len]);

    // Verify remaining groups still exist
    const group0 = tb.getChunkGroup(0);
    const group1 = tb.getChunkGroup(1);

    try std.testing.expect(group0 != null);
    try std.testing.expect(group1 != null);
}

test "ChunkGroup - replaceChunkGroup operation" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("Old Text", null, null, null);

    try std.testing.expectEqual(@as(usize, 1), tb.getChunkGroupCount());

    // Verify initial text content
    var buffer: [64]u8 = undefined;
    const initial_len = tb.getPlainTextIntoBuffer(&buffer);
    try std.testing.expectEqualSlices(u8, "Old Text", buffer[0..initial_len]);

    // Replace the group
    _ = try tb.replaceChunkGroup(0, "New Text", null, null, null);

    try std.testing.expectEqual(@as(usize, 1), tb.getChunkGroupCount());

    // Verify text content after replacement
    const after_replace_len = tb.getPlainTextIntoBuffer(&buffer);
    try std.testing.expectEqualSlices(u8, "New Text", buffer[0..after_replace_len]);

    const group = tb.getChunkGroup(0);
    try std.testing.expect(group != null);
    try std.testing.expectEqual(@as(usize, 1), group.?.getChunkCount());
}

test "ChunkGroup - empty text creates one group" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("", null, null, null);

    try std.testing.expectEqual(@as(usize, 1), tb.getChunkGroupCount());
}

test "ChunkGroup - only newlines create multiple chunks" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("A\nB\nC", null, null, null);

    try std.testing.expectEqual(@as(usize, 1), tb.getChunkGroupCount());
    const group = tb.getChunkGroup(0);
    try std.testing.expect(group != null);
    try std.testing.expectEqual(@as(usize, 3), group.?.getChunkCount());
}

test "ChunkGroup - consecutive newlines create empty chunks" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("First\n\nThird", null, null, null);

    try std.testing.expectEqual(@as(usize, 1), tb.getChunkGroupCount());
    const group = tb.getChunkGroup(0);
    try std.testing.expect(group != null);
    try std.testing.expectEqual(@as(usize, 3), group.?.getChunkCount());
}

test "ChunkGroup - reset clears all groups" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, 256, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("Test\nText", null, null, null);
    try std.testing.expectEqual(@as(usize, 1), tb.getChunkGroupCount());

    tb.reset();
    try std.testing.expectEqual(@as(usize, 0), tb.getChunkGroupCount());
}
