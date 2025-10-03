const std = @import("std");
const text_buffer = @import("../text-buffer.zig");
const gp = @import("../grapheme.zig");
const ss = @import("../syntax-style.zig");

const TextBuffer = text_buffer.TextBuffer;
const RGBA = text_buffer.RGBA;
const Highlight = text_buffer.Highlight;

const LineInfo = struct {
    line_count: u32,
    starts: []const u32,
    widths: []const u32,
    max_width: u32,
};

fn testWriteAndGetLineInfo(tb: *TextBuffer, text: []const u8) !LineInfo {
    try tb.setText(text);
    const cached = tb.getCachedLineInfo();
    return LineInfo{
        .line_count = tb.getLineCount(),
        .starts = cached.starts,
        .widths = cached.widths,
        .max_width = cached.max_width,
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

    const lineInfo = try testWriteAndGetLineInfo(tb, "");

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

    const lineInfo = try testWriteAndGetLineInfo(tb, "Hello World");

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

    const lineInfo = try testWriteAndGetLineInfo(tb, "Hello\nWorld");

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expectEqual(@as(u32, 6), lineInfo.starts[1]); // line_starts[1] ("Hello\n" = 6 chars)
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

    const lineInfo = try testWriteAndGetLineInfo(tb, "Line 1\nLine 2\nLine 3");

    try std.testing.expectEqual(@as(u32, 3), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expectEqual(@as(u32, 7), lineInfo.starts[1]); // line_starts[1] ("Line 1\n" = 7 chars)
    try std.testing.expectEqual(@as(u32, 14), lineInfo.starts[2]); // line_starts[2] ("Line 1\nLine 2\n" = 14 chars)

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

    const lineInfo = try testWriteAndGetLineInfo(tb, "Hello World\n");

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expectEqual(@as(u32, 12), lineInfo.starts[1]); // line_starts[1] ("Hello World\n" = 12 chars)
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

    const lineInfo = try testWriteAndGetLineInfo(tb, "Line 1\n\nLine 3");

    try std.testing.expectEqual(@as(u32, 3), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expectEqual(@as(u32, 7), lineInfo.starts[1]); // line_starts[1] ("Line 1\n" = 7 chars)
    try std.testing.expectEqual(@as(u32, 8), lineInfo.starts[2]); // line_starts[2] ("Line 1\n\n" = 8 chars)
}

test "TextBuffer line info - text starting with newline" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "\nHello World");

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]); // line_starts[0] (empty first line)
    try std.testing.expectEqual(@as(u32, 1), lineInfo.starts[1]); // line_starts[1] ("\n" = 1 char)
}

test "TextBuffer line info - only newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "\n\n\n");

    try std.testing.expectEqual(@as(u32, 4), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expectEqual(@as(u32, 1), lineInfo.starts[1]);
    try std.testing.expectEqual(@as(u32, 2), lineInfo.starts[2]);
    try std.testing.expectEqual(@as(u32, 3), lineInfo.starts[3]);
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

    const lineInfo = try testWriteAndGetLineInfo(tb, "Hello 世界 🌟");

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

    const lineInfo = try testWriteAndGetLineInfo(tb, "First\n\nThird");

    try std.testing.expectEqual(@as(u32, 3), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expectEqual(@as(u32, 6), lineInfo.starts[1]); // line_starts[1] ("First\n")
    try std.testing.expectEqual(@as(u32, 7), lineInfo.starts[2]); // line_starts[2] ("First\n\n")
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
    const lineInfo = try testWriteAndGetLineInfo(tb, &longText);

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
    const lineInfo = try testWriteAndGetLineInfo(tb, text);

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
    const lineInfo = try testWriteAndGetLineInfo(tb, "Red\nBlue");

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expectEqual(@as(u32, 4), lineInfo.starts[1]); // line_starts[1] ("Red\n" = 4 chars)
}

test "TextBuffer line info - buffer with only whitespace" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const lineInfo = try testWriteAndGetLineInfo(tb, "   \n \n ");

    try std.testing.expectEqual(@as(u32, 3), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expectEqual(@as(u32, 4), lineInfo.starts[1]); // line_starts[1] ("   \n" = 4 chars)
    try std.testing.expectEqual(@as(u32, 6), lineInfo.starts[2]); // line_starts[2] ("   \n \n" = 6 chars)

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

    const lineInfo = try testWriteAndGetLineInfo(tb, "A\nB\nC");

    try std.testing.expectEqual(@as(u32, 3), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expectEqual(@as(u32, 2), lineInfo.starts[1]); // line_starts[1] ("A\n" = 2 chars)
    try std.testing.expectEqual(@as(u32, 4), lineInfo.starts[2]); // line_starts[2] ("A\nB\n" = 4 chars)

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

    const lineInfo = try testWriteAndGetLineInfo(tb, "Normal\n123\n!@#\n测试\n");

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
    const lineInfo = try testWriteAndGetLineInfo(tb, longText);

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

    const lineInfo = try testWriteAndGetLineInfo(tb, text_builder.items);

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

    const lineInfo = try testWriteAndGetLineInfo(tb, "\nContent\n\nMore\n\n");

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

    const lineInfo = try testWriteAndGetLineInfo(tb, "café\nnaïve\nrésumé");

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

    const lineInfo = try testWriteAndGetLineInfo(tb, "Test\nText");

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expectEqual(@as(u32, 5), lineInfo.starts[1]); // line_starts[1] ("Test\n" = 5 chars)
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

    const lineInfo = try testWriteAndGetLineInfo(tb, "Hello 世界 🌟");

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

    const lineInfo = try testWriteAndGetLineInfo(tb, "Normal\n123\n!@#\n测试\n");

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
    const lineInfo = try testWriteAndGetLineInfo(tb, "Red\nBlue");

    try std.testing.expectEqual(@as(u32, 2), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expectEqual(@as(u32, 4), lineInfo.starts[1]); // line_starts[1] ("Red\n" = 4 chars)
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
    const lineInfo = try testWriteAndGetLineInfo(tb, &extremelyLongText);

    try std.testing.expectEqual(@as(u32, 1), lineInfo.line_count);
    try std.testing.expectEqual(@as(u32, 0), lineInfo.starts[0]);
    try std.testing.expect(lineInfo.widths[0] > 0);
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

    try tb.setText("Hello World");

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

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

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

    try tb.setText("0123456789");

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

    try tb.setText("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123");

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

    try tb.setText("Short\nAnother short line\nLast");

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

    try tb.setText("ABCDEFGHIJKLMNOPQRST\nShort");

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

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

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
    try tb.setText("12345678🌟");

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
    try tb.setText("123456789🌟ABC");

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
    try tb.setText("测试文字处理");

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
    try tb.setText("AB测试CD");

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
    try tb.setText("🌟");

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
    try tb.setText("🌟🌟🌟🌟🌟");

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
    try tb.setText("e\u{0301}e\u{0301}e\u{0301}"); // é é é using combining acute

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

    try tb.setText("Line 1\nLine 2\nLine 3");

    // Check line count matches expected
    try std.testing.expectEqual(@as(u32, 3), tb.getLineCount());

    // Verify line info is available
    const line_info = tb.getCachedLineInfo();
    try std.testing.expectEqual(@as(usize, 3), line_info.starts.len);
    try std.testing.expectEqual(@as(usize, 3), line_info.widths.len);
}

test "TextBuffer virtual lines - updated when wrap width set" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    // Initially no wrap
    try std.testing.expectEqual(@as(u32, 1), tb.getLineCount());

    // Set wrap width
    tb.setWrapWidth(10);
    try std.testing.expectEqual(@as(u32, 2), tb.getLineCount());
}

test "TextBuffer virtual lines - reset to match real lines when wrap removed" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST\nShort");

    // Set wrap width
    tb.setWrapWidth(10);
    try std.testing.expectEqual(@as(u32, 3), tb.getLineCount());

    // Remove wrap
    tb.setWrapWidth(null);

    // Should be back to 2 lines
    try std.testing.expectEqual(@as(u32, 2), tb.getLineCount());

    // Verify line info is consistent
    const line_info = tb.getCachedLineInfo();
    try std.testing.expectEqual(@as(usize, 2), line_info.starts.len);
    try std.testing.expectEqual(@as(usize, 2), line_info.widths.len);
}

test "TextBuffer virtual lines - multi-line text without wrap" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("First line\n\nThird line with more text\n");

    // Should have 4 lines (including empty line and trailing empty line)
    try std.testing.expectEqual(@as(u32, 4), tb.getLineCount());

    // Verify line info is available
    const line_info = tb.getCachedLineInfo();
    try std.testing.expectEqual(@as(usize, 4), line_info.starts.len);
    try std.testing.expectEqual(@as(usize, 4), line_info.widths.len);

    // Verify the line starts are monotonically increasing
    try std.testing.expect(line_info.starts[0] == 0);
    try std.testing.expect(line_info.starts[1] > line_info.starts[0]);
    try std.testing.expect(line_info.starts[2] > line_info.starts[1]);
    try std.testing.expect(line_info.starts[3] > line_info.starts[2]);
}

test "TextBuffer accessor methods - getVirtualLines and getLines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Line 1\nLine 2");

    // Test getVirtualLines returns correct data
    const virtual_lines = tb.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), virtual_lines.len);

    // Test getLines returns correct data
    const lines = tb.getLines();
    try std.testing.expectEqual(@as(usize, 2), lines.len);

    // Verify we can access chunks through the accessor
    try std.testing.expect(lines[0].chunks.items.len > 0);
    try std.testing.expect(virtual_lines[0].chunks.items.len > 0);
}

test "TextBuffer accessor methods - with wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    // Set wrap width
    tb.setWrapWidth(10);

    // Get virtual lines - should be wrapped
    const virtual_lines = tb.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), virtual_lines.len);

    // Get real lines - should be 1
    const lines = tb.getLines();
    try std.testing.expectEqual(@as(usize, 1), lines.len);

    // Verify virtual chunks reference the real line
    for (virtual_lines[0].chunks.items) |vchunk| {
        try std.testing.expectEqual(@as(usize, 0), vchunk.source_line);
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

    try tb.setText("Hello World");

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

    try tb.setText("Line 1\nLine 2\nLine 3");

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

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    // Set wrap width
    tb.setWrapWidth(10);

    // Should have 2 virtual lines now
    try std.testing.expectEqual(@as(u32, 2), tb.getVirtualLineCount());

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

    try tb.setText("Hello World");

    // No selection set
    const packed_info = tb.packSelectionInfo();
    try std.testing.expectEqual(@as(u64, 0xFFFFFFFF_FFFFFFFF), packed_info);
}

test "TextBuffer selection - selection at wrap boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    tb.setWrapWidth(10);

    // Select exactly at the wrap boundary (chars 9-11, which spans the wrap)
    _ = tb.setLocalSelection(9, 0, 1, 1, null, null);

    const packed_info = tb.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);

    const start = @as(u32, @intCast(packed_info >> 32));
    const end = @as(u32, @intCast(packed_info & 0xFFFFFFFF));
    try std.testing.expectEqual(@as(u32, 9), start);
    try std.testing.expectEqual(@as(u32, 11), end);
}

test "TextBuffer selection - spanning multiple wrapped lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Create text that will wrap to 3 lines at width 10
    try tb.setText("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123");

    tb.setWrapWidth(10);
    try std.testing.expectEqual(@as(u32, 3), tb.getVirtualLineCount());

    // Select from virtual line 0 to virtual line 2
    _ = tb.setLocalSelection(2, 0, 8, 2, null, null);

    const packed_info = tb.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);

    const start = @as(u32, @intCast(packed_info >> 32));
    const end = @as(u32, @intCast(packed_info & 0xFFFFFFFF));
    try std.testing.expectEqual(@as(u32, 2), start);
    try std.testing.expectEqual(@as(u32, 28), end); // 20 + 8
}

test "TextBuffer selection - changes when wrap width changes" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    // Initial wrap at width 10 - 2 virtual lines
    tb.setWrapWidth(10);
    _ = tb.setLocalSelection(5, 0, 5, 1, null, null); // Select from pos 5 on line 0 to pos 5 on line 1

    var packed_info = tb.packSelectionInfo();
    var start = @as(u32, @intCast(packed_info >> 32));
    var end = @as(u32, @intCast(packed_info & 0xFFFFFFFF));
    try std.testing.expectEqual(@as(u32, 5), start);
    try std.testing.expectEqual(@as(u32, 15), end);

    // Change wrap width to 5 - 4 virtual lines, but selection coordinates stay the same
    tb.setWrapWidth(5);
    _ = tb.setLocalSelection(5, 0, 5, 1, null, null);

    packed_info = tb.packSelectionInfo();
    start = @as(u32, @intCast(packed_info >> 32));
    end = @as(u32, @intCast(packed_info & 0xFFFFFFFF));

    // At width 5: line 0 = chars 0-4, line 1 = chars 5-9
    // Selection from (5,0) is invalid (line 0 only has 5 chars), wraps to line 1 char 0
    // So we expect different behavior
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);
}

test "TextBuffer selection - empty selection with wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("ABCDEFGHIJ");

    tb.setWrapWidth(5);

    // Select same position (empty selection)
    _ = tb.setLocalSelection(2, 0, 2, 0, null, null);

    const packed_info = tb.packSelectionInfo();
    // Empty selection should return no selection
    try std.testing.expectEqual(@as(u64, 0xFFFFFFFF_FFFFFFFF), packed_info);
}

test "TextBuffer selection - selection with newlines and wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Text with newlines that also needs wrapping
    try tb.setText("ABCDEFGHIJKLMNO\nPQRSTUVWXYZ");

    tb.setWrapWidth(10);

    // Without wrap: 2 real lines
    // With wrap at 10: line 0 wraps to 2 virtual lines, line 1 wraps to 3 virtual lines
    const vline_count = tb.getVirtualLineCount();
    try std.testing.expect(vline_count >= 3);

    // Select across the newline boundary
    _ = tb.setLocalSelection(5, 0, 5, 2, null, null);

    const packed_info = tb.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);
}

test "TextBuffer selection - reset clears selection" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello World");

    // Set selection
    _ = tb.setLocalSelection(0, 0, 5, 0, null, null);
    var packed_info = tb.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);

    // Reset selection
    tb.resetLocalSelection();
    packed_info = tb.packSelectionInfo();
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

    try tb.setText("Hello World");

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

    try tb.setText("ABCDEFGHIJKLMNOPQRSTUVWXYZ");

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

    try tb.setText("The quick brown fox jumps");

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

    try tb.setText("self-contained multi-line");

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

    try tb.setText("Hello,World.Test");

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

    try tb.setText("Hello wonderful world");

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

    try tb.setText("First line\n\nSecond line");

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

    try tb.setText("path/to/file");

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

    try tb.setText("array[index]value");

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

    try tb.setText("a b c d e f");

    // Set word wrap mode
    tb.setWrapMode(.word);
    tb.setWrapWidth(4);
    const wrapped_count = tb.getLineCount();

    // Should handle single character words properly
    try std.testing.expect(wrapped_count >= 3);
}

// ===== Advanced Wrapping Edge Cases =====

test "TextBuffer wrapping - very narrow width (1 char)" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("ABCDE");

    tb.setWrapWidth(1);
    const wrapped_count = tb.getLineCount();

    // Each character should be on its own line
    try std.testing.expectEqual(@as(u32, 5), wrapped_count);
}

test "TextBuffer wrapping - very narrow width (2 chars)" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("ABCDEF");

    tb.setWrapWidth(2);
    const wrapped_count = tb.getLineCount();

    // Should wrap to 3 lines
    try std.testing.expectEqual(@as(u32, 3), wrapped_count);
}

test "TextBuffer wrapping - switch between char and word mode" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello world test");

    tb.setWrapWidth(8);

    // Char mode
    tb.setWrapMode(.char);
    const char_count = tb.getLineCount();

    // Word mode
    tb.setWrapMode(.word);
    const word_count = tb.getLineCount();

    // Both should wrap, but potentially differently
    try std.testing.expect(char_count >= 2);
    try std.testing.expect(word_count >= 2);
}

test "TextBuffer wrapping - multiple consecutive newlines with wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("ABCDEFGHIJ\n\n\nKLMNOPQRST");

    tb.setWrapWidth(5);
    const wrapped_count = tb.getLineCount();

    // Should preserve all newlines: wrapped line 1, empty, empty, wrapped line 2
    // Line 1: "ABCDEFGHIJ" wraps to 2 lines
    // Line 2-3: empty lines
    // Line 4: "KLMNOPQRST" wraps to 2 lines
    try std.testing.expect(wrapped_count >= 6);
}

test "TextBuffer wrapping - only spaces should not create extra lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("          "); // 10 spaces

    tb.setWrapWidth(5);
    const wrapped_count = tb.getLineCount();

    // 10 spaces should wrap to 2 lines
    try std.testing.expectEqual(@as(u32, 2), wrapped_count);
}

test "TextBuffer wrapping - mixed tabs and spaces" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("AB\tCD\tEF");

    tb.setWrapWidth(5);
    const wrapped_count = tb.getLineCount();

    // Should handle tabs (tabs may be treated as single-width in the buffer)
    try std.testing.expect(wrapped_count >= 1);
}

test "TextBuffer wrapping - unicode emoji with varying widths" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Mix of single-width ASCII and wide emoji
    try tb.setText("A🌟B🎨C🚀D");

    tb.setWrapWidth(5);
    const wrapped_count = tb.getLineCount();

    // Should handle varying widths correctly
    try std.testing.expect(wrapped_count >= 2);
}

test "TextBuffer wrapping - line starts and widths consistency" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    tb.setWrapWidth(7);
    const line_count = tb.getLineCount();
    const line_info = tb.getCachedLineInfo();

    // Verify line starts and widths are consistent
    try std.testing.expectEqual(@as(usize, line_count), line_info.starts.len);
    try std.testing.expectEqual(@as(usize, line_count), line_info.widths.len);

    // Verify all widths are <= wrap width (except possibly the last line)
    for (line_info.widths, 0..) |width, i| {
        if (i < line_info.widths.len - 1) {
            try std.testing.expect(width <= 7);
        }
    }
}

test "TextBuffer wrapping - getVirtualLines reflects current wrap state" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    // No wrap
    var vlines = tb.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    // With wrap
    tb.setWrapWidth(10);
    vlines = tb.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), vlines.len);

    // Change wrap width
    tb.setWrapWidth(5);
    vlines = tb.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 4), vlines.len);

    // Remove wrap
    tb.setWrapWidth(null);
    vlines = tb.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);
}

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
    try tb.addHighlight(0, 0, 5, 1, null);

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
    try tb.addHighlight(0, 0, 5, 1, null);
    try tb.addHighlight(0, 6, 11, 2, null);

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
    try tb.addHighlight(0, 0, 6, 1, null);
    try tb.addHighlight(1, 0, 6, 2, null);
    try tb.addHighlight(2, 0, 6, 3, null);

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
    try tb.addHighlight(0, 0, 3, 1, 100);
    try tb.addHighlight(0, 3, 6, 2, 200);
    try tb.addHighlight(1, 0, 6, 3, 100);

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

    try tb.addHighlight(0, 0, 6, 1, null);
    try tb.addHighlight(0, 6, 10, 2, null);

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

    try tb.addHighlight(0, 0, 6, 1, null);
    try tb.addHighlight(1, 0, 6, 2, null);
    try tb.addHighlight(2, 0, 6, 3, null);

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
    try tb.addHighlight(0, 0, 8, 1, null);
    try tb.addHighlight(0, 5, 11, 2, null);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 2), highlights.len);
}

test "TextBuffer highlights - highlights preserved after wrap width change" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    try tb.addHighlight(0, 0, 10, 1, null);

    tb.setWrapWidth(10);

    // Highlights should still be there (they're on real lines, not virtual lines)
    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
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
    try tb.addHighlight(0, 0, 5, 1, null);

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
    try tb.addHighlight(0, 0, 8, keyword_id, null); // "function"
    try tb.addHighlight(0, 9, 14, string_id, null); // "hello"
    try tb.addHighlight(0, 17, 27, comment_id, null); // "// comment"

    // Verify highlights are stored
    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 3), highlights.len);

    // Verify we can resolve the styles
    const style = tb.getSyntaxStyle().?;
    try std.testing.expect(style.resolveById(keyword_id) != null);
    try std.testing.expect(style.resolveById(string_id) != null);
    try std.testing.expect(style.resolveById(comment_id) != null);
}
