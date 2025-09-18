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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "", null, null, null);

    try std.testing.expectEqual(@as(u32, 1), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_offset);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].width);
}

test "TextBuffer line info - simple text without newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "Hello World", null, null, null);

    try std.testing.expectEqual(@as(u32, 1), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_offset);
    try std.testing.expect(lineInfo.lines[0].width > 0);
}

test "TextBuffer line info - single newline" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "Hello\nWorld", null, null, null);

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_offset);
    try std.testing.expectEqual(@as(u32, 6), lineInfo.lines[1].char_offset); // line_starts[1] ("Hello\n" = 6 chars)
    try std.testing.expect(lineInfo.lines[0].width > 0);
    try std.testing.expect(lineInfo.lines[1].width > 0);
}

test "TextBuffer line info - multiple lines separated by newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "Line 1\nLine 2\nLine 3", null, null, null);

    try std.testing.expectEqual(@as(u32, 3), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_offset);
    try std.testing.expectEqual(@as(u32, 7), lineInfo.lines[1].char_offset); // line_starts[1] ("Line 1\n" = 7 chars)
    try std.testing.expectEqual(@as(u32, 14), lineInfo.lines[2].char_offset); // line_starts[2] ("Line 1\nLine 2\n" = 14 chars)

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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "Hello World\n", null, null, null);

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_offset);
    try std.testing.expectEqual(@as(u32, 12), lineInfo.lines[1].char_offset); // line_starts[1] ("Hello World\n" = 12 chars)
    try std.testing.expect(lineInfo.lines[0].width > 0);
    try std.testing.expect(lineInfo.lines[1].width >= 0); // line_widths[1] (second line may have width 0 or some default width)
}

test "TextBuffer line info - consecutive newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "Line 1\n\nLine 3", null, null, null);

    try std.testing.expectEqual(@as(u32, 3), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_offset);
    try std.testing.expectEqual(@as(u32, 7), lineInfo.lines[1].char_offset); // line_starts[1] ("Line 1\n" = 7 chars)
    try std.testing.expectEqual(@as(u32, 8), lineInfo.lines[2].char_offset); // line_starts[2] ("Line 1\n\n" = 8 chars)
}

test "TextBuffer line info - text starting with newline" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "\nHello World", null, null, null);

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_offset); // line_starts[0] (empty first line)
    try std.testing.expectEqual(@as(u32, 1), lineInfo.lines[1].char_offset); // line_starts[1] ("\n" = 1 char)
}

test "TextBuffer line info - only newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "\n\n\n", null, null, null);

    try std.testing.expectEqual(@as(u32, 4), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_offset);
    try std.testing.expectEqual(@as(u32, 1), lineInfo.lines[1].char_offset);
    try std.testing.expectEqual(@as(u32, 2), lineInfo.lines[2].char_offset);
    try std.testing.expectEqual(@as(u32, 3), lineInfo.lines[3].char_offset);
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "Hello 世界 🌟", null, null, null);

    try std.testing.expectEqual(@as(u32, 1), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_offset);
    try std.testing.expect(lineInfo.lines[0].width > 0);
}

test "TextBuffer line info - empty lines between content" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "First\n\nThird", null, null, null);

    try std.testing.expectEqual(@as(u32, 3), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_offset);
    try std.testing.expectEqual(@as(u32, 6), lineInfo.lines[1].char_offset); // line_starts[1] ("First\n")
    try std.testing.expectEqual(@as(u32, 7), lineInfo.lines[2].char_offset); // line_starts[2] ("First\n\n")
}

test "TextBuffer line info - very long lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Create a long text with 1000 'A' characters
    const longText = [_]u8{'A'} ** 1000;
    const lineInfo = try testWriteAndGetLineInfo(tb, &longText, null, null, null);

    try std.testing.expectEqual(@as(u32, 1), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_offset);
    try std.testing.expect(lineInfo.lines[0].width > 0);
}

test "TextBuffer line info - lines with different widths" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_offset);
    try std.testing.expectEqual(@as(u32, 4), lineInfo.lines[1].char_offset); // line_starts[1] ("Red\n" = 4 chars)
}

test "TextBuffer line info - buffer with only whitespace" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "   \n \n ", null, null, null);

    try std.testing.expectEqual(@as(u32, 3), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_offset);
    try std.testing.expectEqual(@as(u32, 4), lineInfo.lines[1].char_offset); // line_starts[1] ("   \n" = 4 chars)
    try std.testing.expectEqual(@as(u32, 6), lineInfo.lines[2].char_offset); // line_starts[2] ("   \n \n" = 6 chars)

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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "A\nB\nC", null, null, null);

    try std.testing.expectEqual(@as(u32, 3), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_offset);
    try std.testing.expectEqual(@as(u32, 2), lineInfo.lines[1].char_offset); // line_starts[1] ("A\n" = 2 chars)
    try std.testing.expectEqual(@as(u32, 4), lineInfo.lines[2].char_offset); // line_starts[2] ("A\nB\n" = 4 chars)

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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_offset);

    // Check that line starts are monotonically increasing
    var line_idx: u32 = 1;
    while (line_idx < 1000) : (line_idx += 1) {
        try std.testing.expect(lineInfo.lines[line_idx].char_offset > lineInfo.lines[line_idx - 1].char_offset);
    }
}

test "TextBuffer line info - alternating empty and content lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Set default styles
    const red_fg = RGBA{ 1.0, 0.0, 0.0, 1.0 };
    const black_bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    tb.setDefaultFg(red_fg);
    tb.setDefaultBg(black_bg);
    tb.setDefaultAttributes(1);

    const lineInfo = try testWriteAndGetLineInfo(tb, "Test\nText", null, null, null);

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_offset);
    try std.testing.expectEqual(@as(u32, 5), lineInfo.lines[1].char_offset); // line_starts[1] ("Test\n" = 5 chars)
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Set and then reset defaults
    const red_fg = RGBA{ 1.0, 0.0, 0.0, 1.0 };
    tb.setDefaultFg(red_fg);
    tb.resetDefaults();

    const lineInfo = try testWriteAndGetLineInfo(tb, "Test\nText", null, null, null);

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_offset);
    try std.testing.expectEqual(@as(u32, 5), lineInfo.lines[1].char_offset);
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "Hello 世界 🌟", null, null, null);

    try std.testing.expectEqual(@as(u32, 1), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_offset);
    try std.testing.expect(lineInfo.lines[0].width > 0);
}

test "TextBuffer line info - unicode mixed content with special characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
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
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_offset);
    try std.testing.expectEqual(@as(u32, 4), lineInfo.lines[1].char_offset); // line_starts[1] ("Red\n" = 4 chars)
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Create extremely long text with 10000 'A' characters
    const extremelyLongText = [_]u8{'A'} ** 10000;
    const lineInfo = try testWriteAndGetLineInfo(tb, &extremelyLongText, null, null, null);

    try std.testing.expectEqual(@as(u32, 1), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.lines[0].char_offset);
    try std.testing.expect(lineInfo.lines[0].width > 0);
}

// ===== ChunkGroup Tests =====

test "ChunkGroup - single line text creates one group with one chunk" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("Test\nText", null, null, null);
    try std.testing.expectEqual(@as(usize, 1), tb.getChunkGroupCount());

    tb.reset();
    try std.testing.expectEqual(@as(usize, 0), tb.getChunkGroupCount());
}

// ===== Text Wrapping Tests =====

test "TextBuffer wrapping - no wrap returns same line count" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("Hello World", null, null, null);
    tb.finalizeLineInfo();

    const no_wrap_count = tb.getLineCount();
    try std.testing.expectEqual(@as(u32, 1), no_wrap_count);

    tb.setWrapWidth(null);
    const still_no_wrap = tb.getLineCount();
    try std.testing.expectEqual(@as(u32, 1), still_no_wrap);
}

test "TextBuffer wrapping - simple wrap splits line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("ABCDEFGHIJKLMNOPQRST", null, null, null);
    tb.finalizeLineInfo();

    const no_wrap_count = tb.getLineCount();
    try std.testing.expectEqual(@as(u32, 1), no_wrap_count);

    tb.setWrapWidth(10);
    const wrapped_count = tb.getLineCount();

    try std.testing.expectEqual(@as(u32, 2), wrapped_count);
}

test "TextBuffer wrapping - wrap at exact boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("0123456789", null, null, null);
    tb.finalizeLineInfo();

    tb.setWrapWidth(10);
    const wrapped_count = tb.getLineCount();

    try std.testing.expectEqual(@as(u32, 1), wrapped_count);
}

test "TextBuffer wrapping - multiple wrap lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123", null, null, null);
    tb.finalizeLineInfo();

    tb.setWrapWidth(10);
    tb.updateVirtualLines(); // Force update
    const wrapped_count = tb.getLineCount();

    try std.testing.expectEqual(@as(u32, 3), wrapped_count);
}

test "TextBuffer wrapping - preserves newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("Short\nAnother short line\nLast", null, null, null);
    tb.finalizeLineInfo();

    const no_wrap_count = tb.getLineCount();
    try std.testing.expectEqual(@as(u32, 3), no_wrap_count);

    tb.setWrapWidth(50);
    const wrapped_count = tb.getLineCount();

    try std.testing.expectEqual(@as(u32, 3), wrapped_count);
}

test "TextBuffer wrapping - long line with newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("ABCDEFGHIJKLMNOPQRST\nShort", null, null, null);
    tb.finalizeLineInfo();

    const no_wrap_count = tb.getLineCount();
    try std.testing.expectEqual(@as(u32, 2), no_wrap_count);

    tb.setWrapWidth(10);
    const wrapped_count = tb.getLineCount();

    try std.testing.expectEqual(@as(u32, 3), wrapped_count);
}

test "TextBuffer wrapping - change wrap width" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("ABCDEFGHIJKLMNOPQRST", null, null, null);
    tb.finalizeLineInfo();

    tb.setWrapWidth(10);
    var wrapped_count = tb.getLineCount();
    try std.testing.expectEqual(@as(u32, 2), wrapped_count);

    tb.setWrapWidth(5);
    wrapped_count = tb.getLineCount();
    try std.testing.expectEqual(@as(u32, 4), wrapped_count);

    tb.setWrapWidth(20);
    wrapped_count = tb.getLineCount();
    try std.testing.expectEqual(@as(u32, 1), wrapped_count);

    tb.setWrapWidth(null);
    wrapped_count = tb.getLineCount();
    try std.testing.expectEqual(@as(u32, 1), wrapped_count);
}

// ===== Additional Text Wrapping Edge Case Tests =====

test "TextBuffer wrapping - grapheme at exact boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Create text with emoji that takes 2 cells at position 9-10
    _ = try tb.writeChunk("12345678🌟", null, null, null);
    tb.finalizeLineInfo();

    tb.setWrapWidth(10);
    const wrapped_count = tb.getLineCount();

    // Should fit exactly on one line (8 chars + 2-cell emoji = 10)
    try std.testing.expectEqual(@as(u32, 1), wrapped_count);
}

test "TextBuffer wrapping - grapheme split across boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Create text where emoji would straddle the boundary
    _ = try tb.writeChunk("123456789🌟ABC", null, null, null);
    tb.finalizeLineInfo();

    tb.setWrapWidth(10);
    const wrapped_count = tb.getLineCount();

    // Should wrap: line 1 has "123456789", line 2 has "🌟ABC"
    try std.testing.expectEqual(@as(u32, 2), wrapped_count);
}

test "TextBuffer wrapping - CJK characters at boundaries" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // CJK characters typically take 2 cells each
    _ = try tb.writeChunk("测试文字处理", null, null, null);
    tb.finalizeLineInfo();

    tb.setWrapWidth(10);
    const wrapped_count = tb.getLineCount();

    // 6 CJK chars × 2 cells = 12 cells, should wrap to 2 lines
    try std.testing.expectEqual(@as(u32, 2), wrapped_count);
}

test "TextBuffer wrapping - mixed width characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Mix of single-width and double-width characters
    _ = try tb.writeChunk("AB测试CD", null, null, null);
    tb.finalizeLineInfo();

    tb.setWrapWidth(6);
    const wrapped_count = tb.getLineCount();

    // "AB" (2) + "测试" (4) = 6 cells on first line, "CD" on second
    try std.testing.expectEqual(@as(u32, 2), wrapped_count);
}

test "TextBuffer wrapping - single wide character exceeds width" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Emoji takes 2 cells but wrap width is 1
    _ = try tb.writeChunk("🌟", null, null, null);
    tb.finalizeLineInfo();

    tb.setWrapWidth(1);
    const wrapped_count = tb.getLineCount();

    // Wide char that doesn't fit should still be on one line (can't split grapheme)
    try std.testing.expectEqual(@as(u32, 1), wrapped_count);
}

test "TextBuffer wrapping - multiple consecutive wide characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Multiple emojis in a row
    _ = try tb.writeChunk("🌟🌟🌟🌟🌟", null, null, null);
    tb.finalizeLineInfo();

    tb.setWrapWidth(6);
    const wrapped_count = tb.getLineCount();

    // 5 emojis × 2 cells = 10 cells, with width 6 should be 2 lines
    try std.testing.expectEqual(@as(u32, 2), wrapped_count);
}

test "TextBuffer wrapping - zero width characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Text with combining characters (zero-width)
    _ = try tb.writeChunk("e\u{0301}e\u{0301}e\u{0301}", null, null, null); // é é é using combining acute
    tb.finalizeLineInfo();

    tb.setWrapWidth(2);
    const wrapped_count = tb.getLineCount();

    // Should consider the actual width after combining
    try std.testing.expect(wrapped_count >= 1);
}

// ===== Virtual Lines Tests =====

test "TextBuffer virtual lines - match real lines when no wrap" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("Line 1\nLine 2\nLine 3", null, null, null);
    tb.finalizeLineInfo();

    // Force update virtual lines without wrap
    tb.updateVirtualLines();

    // Virtual lines should match real lines exactly
    try std.testing.expectEqual(@as(usize, 3), tb.lines.items.len);
    try std.testing.expectEqual(@as(usize, 3), tb.virtual_lines.items.len);

    // Check each virtual line matches corresponding real line
    for (tb.lines.items, tb.virtual_lines.items) |real_line, virtual_line| {
        try std.testing.expectEqual(real_line.width, virtual_line.width);
        try std.testing.expectEqual(real_line.char_offset, virtual_line.char_offset);
    }
}

test "TextBuffer virtual lines - updated when wrap width set" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("ABCDEFGHIJKLMNOPQRST", null, null, null);
    tb.finalizeLineInfo();

    // Initially no wrap
    tb.updateVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), tb.virtual_lines.items.len);

    // Set wrap width
    tb.setWrapWidth(10);
    tb.updateVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), tb.virtual_lines.items.len);
}

test "TextBuffer virtual lines - reset to match real lines when wrap removed" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("ABCDEFGHIJKLMNOPQRST\nShort", null, null, null);
    tb.finalizeLineInfo();

    // Set wrap width
    tb.setWrapWidth(10);
    tb.updateVirtualLines();
    try std.testing.expectEqual(@as(usize, 3), tb.virtual_lines.items.len);

    // Remove wrap
    tb.setWrapWidth(null);
    tb.updateVirtualLines();

    // Should be back to matching real lines
    try std.testing.expectEqual(@as(usize, 2), tb.lines.items.len);
    try std.testing.expectEqual(@as(usize, 2), tb.virtual_lines.items.len);

    for (tb.lines.items, tb.virtual_lines.items) |real_line, virtual_line| {
        try std.testing.expectEqual(real_line.width, virtual_line.width);
        try std.testing.expectEqual(real_line.char_offset, virtual_line.char_offset);
    }
}

test "TextBuffer virtual lines - multi-line text without wrap" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("First line\n\nThird line with more text\n", null, null, null);
    tb.finalizeLineInfo();
    tb.updateVirtualLines();

    // Should have 4 lines (including empty line and trailing empty line)
    try std.testing.expectEqual(@as(usize, 4), tb.lines.items.len);
    try std.testing.expectEqual(@as(usize, 4), tb.virtual_lines.items.len);

    // All virtual lines should match real lines
    for (tb.lines.items, tb.virtual_lines.items, 0..) |real_line, virtual_line, i| {
        try std.testing.expectEqual(real_line.width, virtual_line.width);
        try std.testing.expectEqual(real_line.char_offset, virtual_line.char_offset);

        // Verify chunks match
        try std.testing.expectEqual(real_line.chunks.items.len, virtual_line.chunks.items.len);
        for (virtual_line.chunks.items) |vchunk| {
            try std.testing.expectEqual(i, vchunk.source_line);
        }
    }
}

// ===== Selection Tests =====

test "TextBuffer selection - basic selection without wrap" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("Hello World", null, null, null);
    tb.finalizeLineInfo();

    // Set a local selection
    _ = tb.setLocalSelection(2, 0, 7, 0, null, null);

    // Get selection info
    const packed_info = tb.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);

    // Selection should be from char 2 to 7
    const start = @as(u32, @intCast(packed_info >> 32));
    const end = @as(u32, @intCast(packed_info & 0xFFFFFFFF));
    try std.testing.expectEqual(@as(u32, 2), start);
    try std.testing.expectEqual(@as(u32, 7), end);
}

test "TextBuffer selection - multi-line selection without wrap" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("Line 1\nLine 2\nLine 3", null, null, null);
    tb.finalizeLineInfo();

    // Select from middle of line 1 to middle of line 2
    _ = tb.setLocalSelection(2, 0, 4, 1, null, null);

    const packed_info = tb.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);
}

test "TextBuffer selection - selection with wrapped lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("ABCDEFGHIJKLMNOPQRST", null, null, null);
    tb.finalizeLineInfo();

    // Set wrap width
    tb.setWrapWidth(10);
    tb.updateVirtualLines();

    // Should have 2 virtual lines now
    try std.testing.expectEqual(@as(usize, 2), tb.virtual_lines.items.len);

    // Select across the wrap boundary
    _ = tb.setLocalSelection(5, 0, 5, 1, null, null);

    const packed_info = tb.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);

    // Selection should span from char 5 to char 15 (5 chars into second virtual line)
    const start = @as(u32, @intCast(packed_info >> 32));
    const end = @as(u32, @intCast(packed_info & 0xFFFFFFFF));
    try std.testing.expectEqual(@as(u32, 5), start);
    try std.testing.expectEqual(@as(u32, 15), end);
}

test "TextBuffer selection - no selection returns all bits set" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("Hello World", null, null, null);
    tb.finalizeLineInfo();

    // No selection set
    const packed_info = tb.packSelectionInfo();
    try std.testing.expectEqual(@as(u64, 0xFFFFFFFF_FFFFFFFF), packed_info);
}

// ===== Word Wrapping Tests =====

test "TextBuffer word wrapping - basic word wrap at space" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("Hello World", null, null, null);
    tb.finalizeLineInfo();

    // Set word wrap mode
    tb.setWrapMode(.word);
    tb.setWrapWidth(8);
    const wrapped_count = tb.getLineCount();

    // Should wrap at the space: "Hello " and "World"
    try std.testing.expectEqual(@as(u32, 2), wrapped_count);
}

test "TextBuffer word wrapping - long word exceeds width" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("ABCDEFGHIJKLMNOPQRSTUVWXYZ", null, null, null);
    tb.finalizeLineInfo();

    // Set word wrap mode
    tb.setWrapMode(.word);
    tb.setWrapWidth(10);
    const wrapped_count = tb.getLineCount();

    // Since there's no word boundary, should fall back to character wrapping
    try std.testing.expectEqual(@as(u32, 3), wrapped_count);
}

test "TextBuffer word wrapping - multiple words" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("The quick brown fox jumps", null, null, null);
    tb.finalizeLineInfo();

    // Set word wrap mode
    tb.setWrapMode(.word);
    tb.setWrapWidth(15);
    const wrapped_count = tb.getLineCount();

    // Should wrap intelligently at word boundaries
    try std.testing.expect(wrapped_count >= 2);
}

test "TextBuffer word wrapping - hyphenated words" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("self-contained multi-line", null, null, null);
    tb.finalizeLineInfo();

    // Set word wrap mode
    tb.setWrapMode(.word);
    tb.setWrapWidth(12);
    const wrapped_count = tb.getLineCount();

    // Should break at hyphens
    try std.testing.expect(wrapped_count >= 2);
}

test "TextBuffer word wrapping - punctuation boundaries" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("Hello,World.Test", null, null, null);
    tb.finalizeLineInfo();

    // Set word wrap mode
    tb.setWrapMode(.word);
    tb.setWrapWidth(8);
    const wrapped_count = tb.getLineCount();

    // Should break at punctuation
    try std.testing.expect(wrapped_count >= 2);
}

test "TextBuffer word wrapping - compare char vs word mode" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("Hello wonderful world", null, null, null);
    tb.finalizeLineInfo();

    // Test with char mode first
    tb.setWrapMode(.char);
    tb.setWrapWidth(10);
    const char_wrapped_count = tb.getLineCount();

    // Now test with word mode
    tb.setWrapMode(.word);
    const word_wrapped_count = tb.getLineCount();

    // Both should wrap, but potentially differently
    try std.testing.expect(char_wrapped_count >= 2);
    try std.testing.expect(word_wrapped_count >= 2);
}

test "TextBuffer word wrapping - empty lines preserved" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("First line\n\nSecond line", null, null, null);
    tb.finalizeLineInfo();

    // Set word wrap mode
    tb.setWrapMode(.word);
    tb.setWrapWidth(8);
    const wrapped_count = tb.getLineCount();

    // Should preserve empty lines
    try std.testing.expect(wrapped_count >= 3);
}

test "TextBuffer word wrapping - slash as boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("path/to/file", null, null, null);
    tb.finalizeLineInfo();

    // Set word wrap mode
    tb.setWrapMode(.word);
    tb.setWrapWidth(8);
    const wrapped_count = tb.getLineCount();

    // Should break at slashes
    try std.testing.expect(wrapped_count >= 2);
}

test "TextBuffer word wrapping - brackets as boundaries" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("array[index]value", null, null, null);
    tb.finalizeLineInfo();

    // Set word wrap mode
    tb.setWrapMode(.word);
    tb.setWrapWidth(10);
    const wrapped_count = tb.getLineCount();

    // Should break at brackets
    try std.testing.expect(wrapped_count >= 2);
}

test "TextBuffer word wrapping - single character at boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    _ = try tb.writeChunk("a b c d e f", null, null, null);
    tb.finalizeLineInfo();

    // Set word wrap mode
    tb.setWrapMode(.word);
    tb.setWrapWidth(4);
    const wrapped_count = tb.getLineCount();

    // Should handle single character words properly
    try std.testing.expect(wrapped_count >= 3);
}
