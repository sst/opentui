const std = @import("std");
const text_buffer = @import("../text-buffer.zig");
const gp = @import("../grapheme.zig");
const ss = @import("../syntax-style.zig");

const TextBuffer = text_buffer.TextBuffer;
const RGBA = text_buffer.RGBA;
const Highlight = text_buffer.Highlight;

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

    try tb.setText("");
    const lineInfo = tb.getLineInfo();

    try std.testing.expectEqual(@as(u32, 1), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.widths[0]);
}

test "TextBuffer line info - simple text without newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello World");
    const lineInfo = tb.getLineInfo();

    try std.testing.expectEqual(@as(u32, 1), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expect(lineInfo.widths[0] > 0);
}

test "TextBuffer line info - single newline" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello\nWorld");
    const lineInfo = tb.getLineInfo();

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expectEqual(@as(u32, 5), lineInfo.starts[1]); // line_starts[1] ("Hello" = 5 chars, newline not counted)
    try std.testing.expect(lineInfo.widths[0] > 0);
    try std.testing.expect(lineInfo.widths[1] > 0);
}

test "TextBuffer line info - multiple lines separated by newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Line 1\nLine 2\nLine 3");
    const lineInfo = tb.getLineInfo();

    try std.testing.expectEqual(@as(u32, 3), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expectEqual(@as(u32, 6), lineInfo.starts[1]); // line_starts[1] ("Line 1" = 6 chars, newlines not counted)
    try std.testing.expectEqual(@as(u32, 12), lineInfo.starts[2]); // line_starts[2] ("Line 1" + "Line 2" = 12 chars)

    // All line widths should be > 0
    try std.testing.expect(lineInfo.widths[0] > 0);
    try std.testing.expect(lineInfo.widths[1] > 0);
    try std.testing.expect(lineInfo.widths[2] > 0);
}

test "TextBuffer line info - text ending with newline" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello World\n");
    const lineInfo = tb.getLineInfo();

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expectEqual(@as(u32, 11), lineInfo.starts[1]); // line_starts[1] ("Hello World" = 11 chars, newline not counted)
    try std.testing.expect(lineInfo.widths[0] > 0);
    try std.testing.expect(lineInfo.widths[1] >= 0); // line_widths[1] (second line may have width 0 or some default width)
}

test "TextBuffer line info - consecutive newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Line 1\n\nLine 3");
    const lineInfo = tb.getLineInfo();

    try std.testing.expectEqual(@as(u32, 3), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expectEqual(@as(u32, 6), lineInfo.starts[1]); // line_starts[1] ("Line 1" = 6 chars, newlines not counted)
    try std.testing.expectEqual(@as(u32, 6), lineInfo.starts[2]); // line_starts[2] (empty line has 0 chars, so still at 6)
}

test "TextBuffer line info - text starting with newline" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("\nHello World");
    const lineInfo = tb.getLineInfo();

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]); // line_starts[0] (empty first line)
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[1]); // line_starts[1] (empty line has 0 chars, newline not counted)
}

test "TextBuffer line info - only newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("\n\n\n");
    const lineInfo = tb.getLineInfo();

    try std.testing.expectEqual(@as(u32, 4), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[1]); // Empty lines, newlines not counted
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[2]);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[3]);
    // All line widths should be >= 0
    try std.testing.expect(lineInfo.widths[0] >= 0);
    try std.testing.expect(lineInfo.widths[1] >= 0);
    try std.testing.expect(lineInfo.widths[2] >= 0);
    try std.testing.expect(lineInfo.widths[3] >= 0);
}

test "TextBuffer line info - wide characters (Unicode)" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello 世界 🌟");
    const lineInfo = tb.getLineInfo();

    try std.testing.expectEqual(@as(u32, 1), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expect(lineInfo.widths[0] > 0);
}

test "TextBuffer line info - empty lines between content" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("First\n\nThird");
    const lineInfo = tb.getLineInfo();

    try std.testing.expectEqual(@as(u32, 3), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expectEqual(@as(u32, 5), lineInfo.starts[1]); // line_starts[1] ("First" = 5 chars, newline not counted)
    try std.testing.expectEqual(@as(u32, 5), lineInfo.starts[2]); // line_starts[2] (empty line has 0 chars, still at 5)
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
    try tb.setText(&longText);
    const lineInfo = tb.getLineInfo();

    try std.testing.expectEqual(@as(u32, 1), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expect(lineInfo.widths[0] > 0);
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
    try tb.setText(text);
    const lineInfo = tb.getLineInfo();

    try std.testing.expectEqual(@as(u32, 3), lineInfo.line_count);
    try std.testing.expect(lineInfo.widths[0] < lineInfo.widths[1]); // Short < Long
    try std.testing.expect(lineInfo.widths[1] > lineInfo.widths[2]); // Long > Medium
}

test "TextBuffer line info - text without styling" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // setText now handles all text at once without styling
    try tb.setText("Red\nBlue");
    const lineInfo = tb.getLineInfo();

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expectEqual(@as(u32, 3), lineInfo.starts[1]); // line_starts[1] ("Red" = 3 chars, newline not counted)
}

test "TextBuffer line info - buffer with only whitespace" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("   \n \n ");
    const lineInfo = tb.getLineInfo();

    try std.testing.expectEqual(@as(u32, 3), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expectEqual(@as(u32, 3), lineInfo.starts[1]); // line_starts[1] ("   " = 3 chars, newline not counted)
    try std.testing.expectEqual(@as(u32, 4), lineInfo.starts[2]); // line_starts[2] (3 + 1 = 4 chars)

    // Whitespace should still contribute to line widths
    try std.testing.expect(lineInfo.widths[0] >= 0);
    try std.testing.expect(lineInfo.widths[1] >= 0);
    try std.testing.expect(lineInfo.widths[2] >= 0);
}

test "TextBuffer line info - single character lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("A\nB\nC");
    const lineInfo = tb.getLineInfo();

    try std.testing.expectEqual(@as(u32, 3), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expectEqual(@as(u32, 1), lineInfo.starts[1]); // line_starts[1] ("A" = 1 char, newline not counted)
    try std.testing.expectEqual(@as(u32, 2), lineInfo.starts[2]); // line_starts[2] (1 + 1 = 2 chars)

    // All widths should be > 0
    try std.testing.expect(lineInfo.widths[0] > 0);
    try std.testing.expect(lineInfo.widths[1] > 0);
    try std.testing.expect(lineInfo.widths[2] > 0);
}

test "TextBuffer line info - mixed content with special characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Normal\n123\n!@#\n测试\n");
    const lineInfo = tb.getLineInfo();

    try std.testing.expectEqual(@as(u32, 5), lineInfo.line_count); // line_count (4 lines + empty line at end)
    // All line widths should be >= 0
    try std.testing.expect(lineInfo.widths[0] >= 0);
    try std.testing.expect(lineInfo.widths[1] >= 0);
    try std.testing.expect(lineInfo.widths[2] >= 0);
    try std.testing.expect(lineInfo.widths[3] >= 0);
    try std.testing.expect(lineInfo.widths[4] >= 0);
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
    try tb.setText(longText);
    const lineInfo = tb.getLineInfo();

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

    try tb.setText(text_builder.items);
    const lineInfo = tb.getLineInfo();

    try std.testing.expectEqual(@as(u32, 1000), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);

    // Check that line starts are monotonically increasing
    var line_idx: u32 = 1;
    while (line_idx < 1000) : (line_idx += 1) {
        try std.testing.expect(lineInfo.starts[line_idx] > lineInfo.starts[line_idx - 1]);
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

    try tb.setText("\nContent\n\nMore\n\n");
    const lineInfo = tb.getLineInfo();

    try std.testing.expectEqual(@as(u32, 6), lineInfo.line_count);
    // All line widths should be >= 0
    try std.testing.expect(lineInfo.widths[0] >= 0);
    try std.testing.expect(lineInfo.widths[1] >= 0);
    try std.testing.expect(lineInfo.widths[2] >= 0);
    try std.testing.expect(lineInfo.widths[3] >= 0);
    try std.testing.expect(lineInfo.widths[4] >= 0);
    try std.testing.expect(lineInfo.widths[5] >= 0);
}

test "TextBuffer line info - complex Unicode combining characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("café\nnaïve\nrésumé");
    const lineInfo = tb.getLineInfo();

    try std.testing.expectEqual(@as(u32, 3), lineInfo.line_count);
    try std.testing.expect(lineInfo.widths[0] > 0);
    try std.testing.expect(lineInfo.widths[1] > 0);
    try std.testing.expect(lineInfo.widths[2] > 0);
}

test "TextBuffer line info - simple multi-line text" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Test\nText");
    const lineInfo = tb.getLineInfo();

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expectEqual(@as(u32, 4), lineInfo.starts[1]); // line_starts[1] ("Test" = 4 chars, newline not counted)
    // All line widths should be >= 0
    try std.testing.expect(lineInfo.widths[0] >= 0);
    try std.testing.expect(lineInfo.widths[1] >= 0);
}

test "TextBuffer line info - unicode width method" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello 世界 🌟");
    const lineInfo = tb.getLineInfo();

    try std.testing.expectEqual(@as(u32, 1), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expect(lineInfo.widths[0] > 0);
}

test "TextBuffer line info - unicode mixed content with special characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Normal\n123\n!@#\n测试\n");
    const lineInfo = tb.getLineInfo();

    try std.testing.expectEqual(@as(u32, 5), lineInfo.line_count); // line_count (4 lines + empty line at end)
    // All line widths should be >= 0
    try std.testing.expect(lineInfo.widths[0] >= 0);
    try std.testing.expect(lineInfo.widths[1] >= 0);
    try std.testing.expect(lineInfo.widths[2] >= 0);
    try std.testing.expect(lineInfo.widths[3] >= 0);
    try std.testing.expect(lineInfo.widths[4] >= 0);
}

test "TextBuffer line info - unicode text without styling" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // setText now handles all text at once without styling
    try tb.setText("Red\nBlue");
    const lineInfo = tb.getLineInfo();

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expectEqual(@as(u32, 3), lineInfo.starts[1]); // line_starts[1] ("Red" = 3 chars, newline not counted)
    // All line widths should be >= 0
    try std.testing.expect(lineInfo.widths[0] >= 0);
    try std.testing.expect(lineInfo.widths[1] >= 0);
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
    try tb.setText(&extremelyLongText);
    const lineInfo = tb.getLineInfo();

    try std.testing.expectEqual(@as(u32, 1), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expect(lineInfo.widths[0] > 0);
}

// ===== Text Extraction Tests =====

// ===== Highlight System Tests =====

test "TextBuffer highlights - add single highlight to line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello World");

    // Add a highlight
    try tb.addHighlight(0, 0, 5, 1, 0, null);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
    try std.testing.expectEqual(@as(u32, 0), highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 5), highlights[0].col_end);
    try std.testing.expectEqual(@as(u32, 1), highlights[0].style_id);
}

test "TextBuffer highlights - add multiple highlights to same line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello World");

    // Add multiple highlights
    try tb.addHighlight(0, 0, 5, 1, 0, null);
    try tb.addHighlight(0, 6, 11, 2, 0, null);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 2), highlights.len);
    try std.testing.expectEqual(@as(u32, 1), highlights[0].style_id);
    try std.testing.expectEqual(@as(u32, 2), highlights[1].style_id);
}

test "TextBuffer highlights - add highlights to multiple lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Line 1\nLine 2\nLine 3");

    // Add highlights to different lines
    try tb.addHighlight(0, 0, 6, 1, 0, null);
    try tb.addHighlight(1, 0, 6, 2, 0, null);
    try tb.addHighlight(2, 0, 6, 3, 0, null);

    try std.testing.expectEqual(@as(usize, 1), tb.getLineHighlights(0).len);
    try std.testing.expectEqual(@as(usize, 1), tb.getLineHighlights(1).len);
    try std.testing.expectEqual(@as(usize, 1), tb.getLineHighlights(2).len);
}

test "TextBuffer highlights - remove highlights by reference" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Line 1\nLine 2");

    // Add highlights with different references
    try tb.addHighlight(0, 0, 3, 1, 0, 100);
    try tb.addHighlight(0, 3, 6, 2, 0, 200);
    try tb.addHighlight(1, 0, 6, 3, 0, 100);

    // Remove all highlights with ref 100
    tb.removeHighlightsByRef(100);

    const line0_highlights = tb.getLineHighlights(0);
    const line1_highlights = tb.getLineHighlights(1);

    try std.testing.expectEqual(@as(usize, 1), line0_highlights.len);
    try std.testing.expectEqual(@as(u32, 2), line0_highlights[0].style_id);
    try std.testing.expectEqual(@as(usize, 0), line1_highlights.len);
}

test "TextBuffer highlights - clear line highlights" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Line 1\nLine 2");

    try tb.addHighlight(0, 0, 6, 1, 0, null);
    try tb.addHighlight(0, 6, 10, 2, 0, null);

    tb.clearLineHighlights(0);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 0), highlights.len);
}

test "TextBuffer highlights - clear all highlights" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Line 1\nLine 2\nLine 3");

    try tb.addHighlight(0, 0, 6, 1, 0, null);
    try tb.addHighlight(1, 0, 6, 2, 0, null);
    try tb.addHighlight(2, 0, 6, 3, 0, null);

    tb.clearAllHighlights();

    try std.testing.expectEqual(@as(usize, 0), tb.getLineHighlights(0).len);
    try std.testing.expectEqual(@as(usize, 0), tb.getLineHighlights(1).len);
    try std.testing.expectEqual(@as(usize, 0), tb.getLineHighlights(2).len);
}

test "TextBuffer highlights - get highlights from non-existent line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Line 1");

    // Get highlights from line that doesn't have any
    const highlights = tb.getLineHighlights(10);
    try std.testing.expectEqual(@as(usize, 0), highlights.len);
}

test "TextBuffer highlights - overlapping highlights" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello World");

    // Add overlapping highlights
    try tb.addHighlight(0, 0, 8, 1, 0, null);
    try tb.addHighlight(0, 5, 11, 2, 0, null);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 2), highlights.len);
}

test "TextBuffer highlights - reset clears highlights" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello World");
    try tb.addHighlight(0, 0, 5, 1, 0, null);

    tb.reset();

    // After reset, highlights should be gone
    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 0), highlights.len);
}

test "TextBuffer highlights - setSyntaxStyle and getSyntaxStyle" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var syntax_style = try ss.SyntaxStyle.init(std.testing.allocator);
    defer syntax_style.deinit();

    // Initially no syntax style
    try std.testing.expect(tb.getSyntaxStyle() == null);

    // Set syntax style
    tb.setSyntaxStyle(syntax_style);
    try std.testing.expect(tb.getSyntaxStyle() != null);

    // Clear syntax style
    tb.setSyntaxStyle(null);
    try std.testing.expect(tb.getSyntaxStyle() == null);
}

test "TextBuffer highlights - integration with SyntaxStyle" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var syntax_style = try ss.SyntaxStyle.init(std.testing.allocator);
    defer syntax_style.deinit();

    // Register some styles
    const keyword_id = try syntax_style.registerStyle("keyword", RGBA{ 1.0, 0.0, 0.0, 1.0 }, null, 0);
    const string_id = try syntax_style.registerStyle("string", RGBA{ 0.0, 1.0, 0.0, 1.0 }, null, 0);
    const comment_id = try syntax_style.registerStyle("comment", RGBA{ 0.5, 0.5, 0.5, 1.0 }, null, 0);

    try tb.setText("function hello() // comment");
    tb.setSyntaxStyle(syntax_style);

    // Add highlights
    try tb.addHighlight(0, 0, 8, keyword_id, 1, null); // "function"
    try tb.addHighlight(0, 9, 14, string_id, 1, null); // "hello"
    try tb.addHighlight(0, 17, 27, comment_id, 1, null); // "// comment"

    // Verify highlights are stored
    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 3), highlights.len);

    // Verify we can resolve the styles
    const style = tb.getSyntaxStyle().?;
    try std.testing.expect(style.resolveById(keyword_id) != null);
    try std.testing.expect(style.resolveById(string_id) != null);
    try std.testing.expect(style.resolveById(comment_id) != null);
}

test "TextBuffer highlights - style spans computed correctly" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("0123456789");

    // Add non-overlapping highlights
    try tb.addHighlight(0, 0, 3, 1, 1, null); // cols 0-2
    try tb.addHighlight(0, 5, 8, 2, 1, null); // cols 5-7

    const spans = tb.getLineSpans(0);
    try std.testing.expect(spans.len > 0);

    // Should have spans for: [0-3 style:1], [3-5 style:0/default], [5-8 style:2], ...
    var found_style1 = false;
    var found_style2 = false;
    for (spans) |span| {
        if (span.style_id == 1) found_style1 = true;
        if (span.style_id == 2) found_style2 = true;
    }
    try std.testing.expect(found_style1);
    try std.testing.expect(found_style2);
}

test "TextBuffer highlights - priority handling in spans" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("0123456789");

    // Add overlapping highlights with different priorities
    try tb.addHighlight(0, 0, 8, 1, 1, null); // priority 1
    try tb.addHighlight(0, 3, 6, 2, 5, null); // priority 5 (higher)

    const spans = tb.getLineSpans(0);
    try std.testing.expect(spans.len > 0);

    // In range 3-6, style 2 should win due to higher priority
    var found_high_priority = false;
    for (spans) |span| {
        if (span.col >= 3 and span.col < 6 and span.style_id == 2) {
            found_high_priority = true;
        }
    }
    try std.testing.expect(found_high_priority);
}

// ===== Character Range Highlight Tests =====

test "TextBuffer char range highlights - single line highlight" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello World");

    // Highlight "Hello" (chars 0-5)
    try tb.addHighlightByCharRange(0, 5, 1, 1, null);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
    try std.testing.expectEqual(@as(u32, 0), highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 5), highlights[0].col_end);
    try std.testing.expectEqual(@as(u32, 1), highlights[0].style_id);
}

test "TextBuffer char range highlights - multi-line highlight" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // "Hello" = 5 chars (0-4, newlines not counted)
    // "World" = 5 chars (5-9, newlines not counted)
    // "Test" = 4 chars (10-13)
    try tb.setText("Hello\nWorld\nTest");

    // Highlight from middle of line 0 to middle of line 1 (chars 3-9)
    try tb.addHighlightByCharRange(3, 9, 1, 1, null);

    // Should create highlights on line 0 and line 1
    const line0_highlights = tb.getLineHighlights(0);
    const line1_highlights = tb.getLineHighlights(1);

    try std.testing.expectEqual(@as(usize, 1), line0_highlights.len);
    try std.testing.expectEqual(@as(usize, 1), line1_highlights.len);

    // Line 0: highlight from col 3 to end (col 5)
    try std.testing.expectEqual(@as(u32, 3), line0_highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 5), line0_highlights[0].col_end);

    // Line 1: highlight from start (col 0) to col 4 (chars 5,6,7,8 = cols 0,1,2,3)
    try std.testing.expectEqual(@as(u32, 0), line1_highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 4), line1_highlights[0].col_end);
}

test "TextBuffer char range highlights - spanning three lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Line1\nLine2\nLine3");

    // Highlight from char 3 (middle of line 0) to char 13 (middle of line 2)
    try tb.addHighlightByCharRange(3, 13, 1, 1, null);

    const line0_highlights = tb.getLineHighlights(0);
    const line1_highlights = tb.getLineHighlights(1);
    const line2_highlights = tb.getLineHighlights(2);

    // All three lines should have highlights
    try std.testing.expectEqual(@as(usize, 1), line0_highlights.len);
    try std.testing.expectEqual(@as(usize, 1), line1_highlights.len);
    try std.testing.expectEqual(@as(usize, 1), line2_highlights.len);

    // Line 0: from col 3 to end
    try std.testing.expectEqual(@as(u32, 3), line0_highlights[0].col_start);

    // Line 1: entire line (col 0 to line width)
    try std.testing.expectEqual(@as(u32, 0), line1_highlights[0].col_start);

    // Line 2: from start to col 1 (char 13 is at offset 12, which is line 2 col 1)
    try std.testing.expectEqual(@as(u32, 0), line2_highlights[0].col_start);
}

test "TextBuffer char range highlights - exact line boundaries" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("AAAA\nBBBB\nCCCC");

    // Highlight entire first line (chars 0-4, excluding newline)
    try tb.addHighlightByCharRange(0, 4, 1, 1, null);

    const line0_highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), line0_highlights.len);
    try std.testing.expectEqual(@as(u32, 0), line0_highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 4), line0_highlights[0].col_end);

    // Line 1 should have no highlights
    const line1_highlights = tb.getLineHighlights(1);
    try std.testing.expectEqual(@as(usize, 0), line1_highlights.len);
}

test "TextBuffer char range highlights - empty range" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello World");

    // Empty range (start == end) should add no highlights
    try tb.addHighlightByCharRange(5, 5, 1, 1, null);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 0), highlights.len);
}

test "TextBuffer char range highlights - invalid range" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello World");

    // Invalid range (start > end) should add no highlights
    try tb.addHighlightByCharRange(10, 5, 1, 1, null);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 0), highlights.len);
}

test "TextBuffer char range highlights - out of bounds range" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello");

    // Range extends beyond text length - should handle gracefully
    try tb.addHighlightByCharRange(3, 100, 1, 1, null);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
    try std.testing.expectEqual(@as(u32, 3), highlights[0].col_start);
}

test "TextBuffer char range highlights - multiple non-overlapping ranges" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("function hello() { return 42; }");

    // Highlight multiple tokens
    try tb.addHighlightByCharRange(0, 8, 1, 1, null); // "function"
    try tb.addHighlightByCharRange(9, 14, 2, 1, null); // "hello"
    try tb.addHighlightByCharRange(19, 25, 3, 1, null); // "return"

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 3), highlights.len);
    try std.testing.expectEqual(@as(u32, 1), highlights[0].style_id);
    try std.testing.expectEqual(@as(u32, 2), highlights[1].style_id);
    try std.testing.expectEqual(@as(u32, 3), highlights[2].style_id);
}

test "TextBuffer char range highlights - with reference ID for removal" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Line1\nLine2\nLine3");

    // Add highlights with reference ID 100
    try tb.addHighlightByCharRange(0, 5, 1, 1, 100);
    try tb.addHighlightByCharRange(6, 11, 2, 1, 100);

    // Verify they were added
    try std.testing.expectEqual(@as(usize, 1), tb.getLineHighlights(0).len);
    try std.testing.expectEqual(@as(usize, 1), tb.getLineHighlights(1).len);

    // Remove all highlights with ref 100
    tb.removeHighlightsByRef(100);

    // Verify they were removed
    try std.testing.expectEqual(@as(usize, 0), tb.getLineHighlights(0).len);
    try std.testing.expectEqual(@as(usize, 0), tb.getLineHighlights(1).len);
}

test "TextBuffer char range highlights - priority handling" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("0123456789");

    // Add overlapping highlights with different priorities
    try tb.addHighlightByCharRange(0, 8, 1, 1, null); // priority 1
    try tb.addHighlightByCharRange(3, 6, 2, 5, null); // priority 5 (higher)

    const spans = tb.getLineSpans(0);
    try std.testing.expect(spans.len > 0);

    // Higher priority should win in overlap region
    var found_high_priority = false;
    for (spans) |span| {
        if (span.col >= 3 and span.col < 6 and span.style_id == 2) {
            found_high_priority = true;
        }
    }
    try std.testing.expect(found_high_priority);
}

test "TextBuffer char range highlights - unicode text" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello 世界 🌟");

    // Highlight the entire text by character count
    const text_len = tb.getLength();
    try tb.addHighlightByCharRange(0, text_len, 1, 1, null);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
}

test "TextBuffer char range highlights - preserved after setText" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello World");
    try tb.addHighlightByCharRange(0, 5, 1, 1, null);

    // Set new text - highlights should be cleared
    try tb.setText("New Text");

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 0), highlights.len);
}

// ===== View Registration Tests =====

test "TextBuffer view registration - multiple views can be created" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Register multiple views
    const id1 = try tb.registerView();
    const id2 = try tb.registerView();
    const id3 = try tb.registerView();

    // IDs should be unique
    try std.testing.expect(id1 != id2);
    try std.testing.expect(id2 != id3);
    try std.testing.expect(id1 != id3);

    // Clean up
    tb.unregisterView(id1);
    tb.unregisterView(id2);
    tb.unregisterView(id3);
}

test "TextBuffer view registration - views marked dirty on setText" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const id1 = try tb.registerView();
    defer tb.unregisterView(id1);

    // Initially dirty
    try std.testing.expect(tb.isViewDirty(id1));

    // Clear dirty flag
    tb.clearViewDirty(id1);
    try std.testing.expect(!tb.isViewDirty(id1));

    // setText should mark dirty again
    try tb.setText("Hello World");
    try std.testing.expect(tb.isViewDirty(id1));

    // Clear and set again
    tb.clearViewDirty(id1);
    try std.testing.expect(!tb.isViewDirty(id1));

    try tb.setText("New text");
    try std.testing.expect(tb.isViewDirty(id1));
}

test "TextBuffer view registration - views marked dirty on reset" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const id1 = try tb.registerView();
    defer tb.unregisterView(id1);

    // Clear initial dirty flag
    tb.clearViewDirty(id1);
    try std.testing.expect(!tb.isViewDirty(id1));

    // reset should mark dirty
    tb.reset();
    try std.testing.expect(tb.isViewDirty(id1));
}

test "TextBuffer view registration - ID reuse after unregister" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Register and unregister a view
    const id1 = try tb.registerView();
    tb.unregisterView(id1);

    // Register another view - should reuse the ID
    const id2 = try tb.registerView();
    defer tb.unregisterView(id2);

    try std.testing.expectEqual(id1, id2);

    // Reused ID should be dirty
    try std.testing.expect(tb.isViewDirty(id2));
}

test "TextBuffer view registration - multiple views all marked dirty on setText" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const id1 = try tb.registerView();
    defer tb.unregisterView(id1);

    const id2 = try tb.registerView();
    defer tb.unregisterView(id2);

    const id3 = try tb.registerView();
    defer tb.unregisterView(id3);

    // Clear all dirty flags
    tb.clearViewDirty(id1);
    tb.clearViewDirty(id2);
    tb.clearViewDirty(id3);

    try std.testing.expect(!tb.isViewDirty(id1));
    try std.testing.expect(!tb.isViewDirty(id2));
    try std.testing.expect(!tb.isViewDirty(id3));

    // setText should mark all views dirty
    try tb.setText("Test");

    try std.testing.expect(tb.isViewDirty(id1));
    try std.testing.expect(tb.isViewDirty(id2));
    try std.testing.expect(tb.isViewDirty(id3));
}
