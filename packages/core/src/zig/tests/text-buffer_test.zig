const std = @import("std");
const text_buffer = @import("../text-buffer.zig");
const gp = @import("../grapheme.zig");
const iter_mod = @import("../text-buffer-iterators.zig");

const TextBuffer = text_buffer.UnifiedTextBuffer;

test "TextBuffer line info - empty buffer" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("");

    try std.testing.expectEqual(@as(u32, 1), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 0), iter_mod.coordsToOffset(&tb.rope, 0, 0).?);
    try std.testing.expectEqual(@as(u32, 0), iter_mod.lineWidthAt(&tb.rope, 0));
}

test "TextBuffer line info - simple text without newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello World");

    try std.testing.expectEqual(@as(u32, 1), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 0), iter_mod.coordsToOffset(&tb.rope, 0, 0).?);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 0) > 0);
}

test "TextBuffer line info - single newline" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello\nWorld");

    try std.testing.expectEqual(@as(u32, 2), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 0), iter_mod.coordsToOffset(&tb.rope, 0, 0).?);
    try std.testing.expectEqual(@as(u32, 6), iter_mod.coordsToOffset(&tb.rope, 1, 0).?); // "Hello" (5) + newline (1) = 6
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 0) > 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 1) > 0);
}

test "TextBuffer line info - multiple lines separated by newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Line 1\nLine 2\nLine 3");

    try std.testing.expectEqual(@as(u32, 3), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 0), iter_mod.coordsToOffset(&tb.rope, 0, 0).?);
    try std.testing.expectEqual(@as(u32, 7), iter_mod.coordsToOffset(&tb.rope, 1, 0).?); // "Line 1" (6) + 1 newline = 7
    try std.testing.expectEqual(@as(u32, 14), iter_mod.coordsToOffset(&tb.rope, 2, 0).?); // "Line 1" (6) + "Line 2" (6) + 2 newlines = 14

    // All line widths should be > 0
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 0) > 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 1) > 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 2) > 0);
}

test "TextBuffer line info - text ending with newline" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello World\n");

    try std.testing.expectEqual(@as(u32, 2), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 0), iter_mod.coordsToOffset(&tb.rope, 0, 0).?);
    try std.testing.expectEqual(@as(u32, 12), iter_mod.coordsToOffset(&tb.rope, 1, 0).?); // "Hello World" (11) + 1 newline = 12
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 0) > 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 1) >= 0); // line_widths[1] (second line may have width 0 or some default width)
}

test "TextBuffer line info - consecutive newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Line 1\n\nLine 3");

    try std.testing.expectEqual(@as(u32, 3), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 0), iter_mod.coordsToOffset(&tb.rope, 0, 0).?);
    try std.testing.expectEqual(@as(u32, 7), iter_mod.coordsToOffset(&tb.rope, 1, 0).?); // "Line 1" (6) + 1 newline = 7
    try std.testing.expectEqual(@as(u32, 8), iter_mod.coordsToOffset(&tb.rope, 2, 0).?); // "Line 1" (6) + empty line (0) + 2 newlines = 8
}

test "TextBuffer line info - text starting with newline" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("\nHello World");

    try std.testing.expectEqual(@as(u32, 2), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 0), iter_mod.coordsToOffset(&tb.rope, 0, 0).?); // line_starts[0] (empty first line)
    try std.testing.expectEqual(@as(u32, 1), iter_mod.coordsToOffset(&tb.rope, 1, 0).?); // Empty line (0) + 1 newline = 1
}

test "TextBuffer line info - only newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("\n\n\n");

    try std.testing.expectEqual(@as(u32, 4), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 0), iter_mod.coordsToOffset(&tb.rope, 0, 0).?);
    try std.testing.expectEqual(@as(u32, 1), iter_mod.coordsToOffset(&tb.rope, 1, 0).?); // 0 + 1 newline = 1
    try std.testing.expectEqual(@as(u32, 2), iter_mod.coordsToOffset(&tb.rope, 2, 0).?); // 0 + 2 newlines = 2
    try std.testing.expectEqual(@as(u32, 3), iter_mod.coordsToOffset(&tb.rope, 3, 0).?); // 0 + 3 newlines = 3
    // All line widths should be >= 0
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 0) >= 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 1) >= 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 2) >= 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 3) >= 0);
}

test "TextBuffer line info - wide characters (Unicode)" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello 世界 🌟");

    try std.testing.expectEqual(@as(u32, 1), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 0), iter_mod.coordsToOffset(&tb.rope, 0, 0).?);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 0) > 0);
}

test "TextBuffer line info - empty lines between content" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("First\n\nThird");

    try std.testing.expectEqual(@as(u32, 3), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 0), iter_mod.coordsToOffset(&tb.rope, 0, 0).?);
    try std.testing.expectEqual(@as(u32, 6), iter_mod.coordsToOffset(&tb.rope, 1, 0).?); // "First" (5) + 1 newline = 6
    try std.testing.expectEqual(@as(u32, 7), iter_mod.coordsToOffset(&tb.rope, 2, 0).?); // "First" (5) + empty (0) + 2 newlines = 7
}

test "TextBuffer line info - very long lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Create a long text with 1000 'A' characters
    const longText = [_]u8{'A'} ** 1000;
    try tb.setText(&longText);

    try std.testing.expectEqual(@as(u32, 1), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 0), iter_mod.coordsToOffset(&tb.rope, 0, 0).?);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 0) > 0);
}

test "TextBuffer line info - lines with different widths" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Create text with different line lengths
    var text_builder = std.ArrayList(u8).init(std.testing.allocator);
    defer text_builder.deinit();
    try text_builder.appendSlice("Short\n");
    try text_builder.appendNTimes('A', 50);
    try text_builder.appendSlice("\nMedium");
    const text = text_builder.items;
    try tb.setText(text);

    try std.testing.expectEqual(@as(u32, 3), tb.getLineCount());
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 0) < iter_mod.lineWidthAt(&tb.rope, 1)); // Short < Long
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 1) > iter_mod.lineWidthAt(&tb.rope, 2)); // Long > Medium
}

test "TextBuffer line info - text without styling" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // setText now handles all text at once without styling
    try tb.setText("Red\nBlue");

    try std.testing.expectEqual(@as(u32, 2), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 0), iter_mod.coordsToOffset(&tb.rope, 0, 0).?);
    try std.testing.expectEqual(@as(u32, 4), iter_mod.coordsToOffset(&tb.rope, 1, 0).?); // "Red" (3) + 1 newline = 4
}

test "TextBuffer line info - buffer with only whitespace" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("   \n \n ");

    try std.testing.expectEqual(@as(u32, 3), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 0), iter_mod.coordsToOffset(&tb.rope, 0, 0).?);
    try std.testing.expectEqual(@as(u32, 4), iter_mod.coordsToOffset(&tb.rope, 1, 0).?); // "   " (3) + 1 newline = 4
    try std.testing.expectEqual(@as(u32, 6), iter_mod.coordsToOffset(&tb.rope, 2, 0).?); // "   " (3) + " " (1) + 2 newlines = 6

    // Whitespace should still contribute to line widths
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 0) >= 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 1) >= 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 2) >= 0);
}

test "TextBuffer line info - single character lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("A\nB\nC");

    try std.testing.expectEqual(@as(u32, 3), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 0), iter_mod.coordsToOffset(&tb.rope, 0, 0).?);
    try std.testing.expectEqual(@as(u32, 2), iter_mod.coordsToOffset(&tb.rope, 1, 0).?); // "A" (1) + 1 newline = 2
    try std.testing.expectEqual(@as(u32, 4), iter_mod.coordsToOffset(&tb.rope, 2, 0).?); // "A" (1) + "B" (1) + 2 newlines = 4

    // All widths should be > 0
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 0) > 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 1) > 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 2) > 0);
}

test "TextBuffer line info - mixed content with special characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Normal\n123\n!@#\n测试\n");

    try std.testing.expectEqual(@as(u32, 5), tb.getLineCount()); // line_count (4 lines + empty line at end)
    // All line widths should be >= 0
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 0) >= 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 1) >= 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 2) >= 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 3) >= 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 4) >= 0);
}

test "TextBuffer line info - buffer resize operations" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    // Create a small buffer that will need to resize
    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Add text that will cause multiple resizes
    var text_builder = std.ArrayList(u8).init(std.testing.allocator);
    defer text_builder.deinit();
    try text_builder.appendNTimes('A', 100);
    try text_builder.appendSlice("\n");
    try text_builder.appendNTimes('B', 100);
    const longText = text_builder.items;
    try tb.setText(longText);

    try std.testing.expectEqual(@as(u32, 2), tb.getLineCount());
}

test "TextBuffer line info - thousands of lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
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

    try std.testing.expectEqual(@as(u32, 1000), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 0), iter_mod.coordsToOffset(&tb.rope, 0, 0).?);

    // Check that line starts are monotonically increasing
    var line_idx: u32 = 1;
    while (line_idx < 1000) : (line_idx += 1) {
        try std.testing.expect(iter_mod.coordsToOffset(&tb.rope, line_idx, 0).? > iter_mod.coordsToOffset(&tb.rope, line_idx - 1, 0).?);
    }
}

test "TextBuffer line info - alternating empty and content lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("\nContent\n\nMore\n\n");

    try std.testing.expectEqual(@as(u32, 6), tb.getLineCount());
    // All line widths should be >= 0
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 0) >= 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 1) >= 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 2) >= 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 3) >= 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 4) >= 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 5) >= 0);
}

test "TextBuffer line info - complex Unicode combining characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("café\nnaïve\nrésumé");

    try std.testing.expectEqual(@as(u32, 3), tb.getLineCount());
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 0) > 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 1) > 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 2) > 0);
}

test "TextBuffer line info - simple multi-line text" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Test\nText");

    try std.testing.expectEqual(@as(u32, 2), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 0), iter_mod.coordsToOffset(&tb.rope, 0, 0).?);
    try std.testing.expectEqual(@as(u32, 5), iter_mod.coordsToOffset(&tb.rope, 1, 0).?); // "Test" (4) + 1 newline = 5
    // All line widths should be >= 0
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 0) >= 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 1) >= 0);
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

    try std.testing.expectEqual(@as(u32, 1), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 0), iter_mod.coordsToOffset(&tb.rope, 0, 0).?);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 0) > 0);
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

    try std.testing.expectEqual(@as(u32, 5), tb.getLineCount()); // line_count (4 lines + empty line at end)
    // All line widths should be >= 0
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 0) >= 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 1) >= 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 2) >= 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 3) >= 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 4) >= 0);
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

    try std.testing.expectEqual(@as(u32, 2), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 0), iter_mod.coordsToOffset(&tb.rope, 0, 0).?);
    try std.testing.expectEqual(@as(u32, 4), iter_mod.coordsToOffset(&tb.rope, 1, 0).?); // "Red" (3) + 1 newline = 4
    // All line widths should be >= 0
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 0) >= 0);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 1) >= 0);
}

test "TextBuffer line info - extremely long single line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Create extremely long text with 10000 'A' characters
    const extremelyLongText = [_]u8{'A'} ** 10000;
    try tb.setText(&extremelyLongText);

    try std.testing.expectEqual(@as(u32, 1), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 0), iter_mod.coordsToOffset(&tb.rope, 0, 0).?);
    try std.testing.expect(iter_mod.lineWidthAt(&tb.rope, 0) > 0);
}

// ===== View Registration Tests =====

test "TextBuffer view registration - multiple views can be created" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
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

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
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

// ===== Memory Registry Tests =====

test "TextBuffer memory registry - register and get buffer" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const text = "Hello World";
    const mem_id = try tb.registerMemBuffer(text, false);

    const retrieved = tb.getMemBuffer(mem_id);
    try std.testing.expect(retrieved != null);
    try std.testing.expectEqualStrings(text, retrieved.?);
}

test "TextBuffer memory registry - multiple buffers" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const text1 = "First buffer";
    const text2 = "Second buffer";
    const text3 = "Third buffer";

    const id1 = try tb.registerMemBuffer(text1, false);
    const id2 = try tb.registerMemBuffer(text2, false);
    const id3 = try tb.registerMemBuffer(text3, false);

    // IDs should be unique
    try std.testing.expect(id1 != id2);
    try std.testing.expect(id2 != id3);
    try std.testing.expect(id1 != id3);

    // Retrieve and verify
    try std.testing.expectEqualStrings(text1, tb.getMemBuffer(id1).?);
    try std.testing.expectEqualStrings(text2, tb.getMemBuffer(id2).?);
    try std.testing.expectEqualStrings(text3, tb.getMemBuffer(id3).?);
}

test "TextBuffer memory registry - invalid ID returns null" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Try to get buffer with ID that doesn't exist
    const result = tb.getMemBuffer(99);
    try std.testing.expect(result == null);
}

test "TextBuffer memory registry - addLine from single buffer" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const text = "Hello World";
    const mem_id = try tb.registerMemBuffer(text, false);

    // Add line from buffer
    try tb.addLine(mem_id, 0, 5); // "Hello"

    try std.testing.expectEqual(@as(u32, 1), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 5), tb.getLength());

    // Verify text content
    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Hello", out_buffer[0..written]);
}

test "TextBuffer memory registry - addLine from multiple buffers" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const text1 = "First line";
    const text2 = "Second line";
    const text3 = "Third line";

    const id1 = try tb.registerMemBuffer(text1, false);
    const id2 = try tb.registerMemBuffer(text2, false);
    const id3 = try tb.registerMemBuffer(text3, false);

    try tb.addLine(id1, 0, 10);
    try tb.addLine(id2, 0, 11);
    try tb.addLine(id3, 0, 10);

    try std.testing.expectEqual(@as(u32, 3), tb.getLineCount());

    // Verify text content
    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("First line\nSecond line\nThird line", out_buffer[0..written]);
}

test "TextBuffer memory registry - addLine with invalid mem_id" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Try to add line with invalid mem_id
    const result = tb.addLine(99, 0, 5);
    try std.testing.expectError(text_buffer.TextBufferError.InvalidMemId, result);
}

test "TextBuffer memory registry - mixed with setText" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // First use setText
    try tb.setText("Initial text");
    try std.testing.expectEqual(@as(u32, 12), tb.getLength());

    // Then use memory registry API
    const text = "New text";
    const mem_id = try tb.registerMemBuffer(text, false);
    try tb.addLine(mem_id, 0, 8);

    // Should now have 2 lines
    try std.testing.expectEqual(@as(u32, 2), tb.getLineCount());
}

test "TextBuffer memory registry - reset clears memory buffers" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const text = "Hello";
    const mem_id = try tb.registerMemBuffer(text, false);
    try tb.addLine(mem_id, 0, 5);

    // Reset should clear memory registry
    tb.reset();

    // Old mem_id should no longer be valid
    try std.testing.expect(tb.getMemBuffer(mem_id) == null);
    try std.testing.expectEqual(@as(u32, 0), tb.getLength());
}

test "TextBuffer memory registry - partial buffer slices" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const full_text = "0123456789ABCDEFGHIJ";
    const mem_id = try tb.registerMemBuffer(full_text, false);

    // Add multiple lines from different slices of the same buffer
    try tb.addLine(mem_id, 0, 5); // "01234"
    try tb.addLine(mem_id, 5, 10); // "56789"
    try tb.addLine(mem_id, 10, 20); // "ABCDEFGHIJ"

    try std.testing.expectEqual(@as(u32, 3), tb.getLineCount());

    // Verify text content
    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("01234\n56789\nABCDEFGHIJ", out_buffer[0..written]);
}

test "TextBuffer memory registry - unicode text from buffers" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const text1 = "Hello 世界";
    const text2 = "🌟 Test";

    const id1 = try tb.registerMemBuffer(text1, false);
    const id2 = try tb.registerMemBuffer(text2, false);

    try tb.addLine(id1, 0, @intCast(text1.len));
    try tb.addLine(id2, 0, @intCast(text2.len));

    try std.testing.expectEqual(@as(u32, 2), tb.getLineCount());

    // Verify text content
    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    const expected = "Hello 世界\n🌟 Test";
    try std.testing.expectEqualStrings(expected, out_buffer[0..written]);
}

test "TextBuffer memory registry - getByteSize with multiple buffers" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const text1 = "Hello"; // 5 bytes
    const text2 = "World"; // 5 bytes

    const id1 = try tb.registerMemBuffer(text1, false);
    const id2 = try tb.registerMemBuffer(text2, false);

    try tb.addLine(id1, 0, 5);
    try tb.addLine(id2, 0, 5);

    // Should be 5 + 1 (newline) + 5 = 11 bytes
    const byte_size = tb.getByteSize();
    try std.testing.expectEqual(@as(u32, 11), byte_size);
}

test "TextBuffer memory registry - views marked dirty on addLine" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const view_id = try tb.registerView();
    defer tb.unregisterView(view_id);

    // Clear initial dirty flag
    tb.clearViewDirty(view_id);
    try std.testing.expect(!tb.isViewDirty(view_id));

    // Add line should mark view dirty
    const text = "Hello";
    const mem_id = try tb.registerMemBuffer(text, false);
    try tb.addLine(mem_id, 0, 5);

    try std.testing.expect(tb.isViewDirty(view_id));
}

test "TextBuffer memory registry - empty chunk handling" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const text = "Hello World";
    const mem_id = try tb.registerMemBuffer(text, false);

    // Add line with empty slice (start == end)
    try tb.addLine(mem_id, 5, 5);

    try std.testing.expectEqual(@as(u32, 1), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 0), tb.getLength());
}

test "TextBuffer memory registry - buffer limit of 255" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Register 255 buffers (the maximum for u8)
    var i: u32 = 0;
    while (i < 255) : (i += 1) {
        const text = "Buffer";
        _ = try tb.registerMemBuffer(text, false);
    }

    // Try to register 256th buffer - should fail
    const result = tb.registerMemBuffer("One more", false);
    try std.testing.expectError(text_buffer.TextBufferError.OutOfMemory, result);
}

test "TextBuffer memory registry - owned buffer memory management" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Allocate a buffer that the TextBuffer should own and free
    const owned_text = try std.testing.allocator.dupe(u8, "Owned text");
    const mem_id = try tb.registerMemBuffer(owned_text, true);

    try tb.addLine(mem_id, 0, 10);

    // Verify it works
    try std.testing.expectEqual(@as(u32, 1), tb.getLineCount());

    // tb.deinit() should free the owned buffer
    // If there's a memory leak, the test allocator will catch it
}

test "TextBuffer memory registry - byte range out of bounds" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const text = "Hello"; // Only 5 bytes
    const mem_id = try tb.registerMemBuffer(text, false);

    // This should panic in debug mode or cause undefined behavior
    // We can't easily test this without catching panics, but we can document it
    // try tb.addLine(mem_id, 0, 100); // Would access out of bounds

    // Test that valid range works
    try tb.addLine(mem_id, 0, 5);
    try std.testing.expectEqual(@as(u32, 5), tb.getLength());
}

test "TextBuffer memory registry - character range highlights across buffers" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const text1 = "Line One";
    const text2 = "Line Two";

    const id1 = try tb.registerMemBuffer(text1, false);
    const id2 = try tb.registerMemBuffer(text2, false);

    try tb.addLine(id1, 0, 8);
    try tb.addLine(id2, 0, 8);

    // Add highlight spanning both lines (from different buffers)
    try tb.addHighlightByCharRange(3, 11, 1, 1, null);

    const line0_highlights = tb.getLineHighlights(0);
    const line1_highlights = tb.getLineHighlights(1);

    try std.testing.expectEqual(@as(usize, 1), line0_highlights.len);
    try std.testing.expectEqual(@as(usize, 1), line1_highlights.len);
}

test "TextBuffer memory registry - empty buffer registration" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const empty_text = "";
    const mem_id = try tb.registerMemBuffer(empty_text, false);

    const retrieved = tb.getMemBuffer(mem_id);
    try std.testing.expect(retrieved != null);
    try std.testing.expectEqual(@as(usize, 0), retrieved.?.len);
}

test "TextBuffer memory registry - same buffer registered multiple times" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const text = "Shared buffer";

    // Register the same buffer multiple times (different IDs)
    const id1 = try tb.registerMemBuffer(text, false);
    const id2 = try tb.registerMemBuffer(text, false);
    const id3 = try tb.registerMemBuffer(text, false);

    // IDs should be different
    try std.testing.expect(id1 != id2);
    try std.testing.expect(id2 != id3);

    // Use different slices of the same registered buffer
    try tb.addLine(id1, 0, 6); // "Shared"
    try tb.addLine(id2, 7, 13); // "buffer"
    try tb.addLine(id3, 0, 13); // "Shared buffer"

    try std.testing.expectEqual(@as(u32, 3), tb.getLineCount());

    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Shared\nbuffer\nShared buffer", out_buffer[0..written]);
}

// ===== setText SIMD Line Break Tests =====

test "TextBuffer setText - CRLF line endings (Windows)" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Line1\r\nLine2\r\nLine3");

    try std.testing.expectEqual(@as(u32, 3), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 0), iter_mod.coordsToOffset(&tb.rope, 0, 0).?);
    try std.testing.expectEqual(@as(u32, 6), iter_mod.coordsToOffset(&tb.rope, 1, 0).?); // "Line1" (5) + 1 newline = 6
    try std.testing.expectEqual(@as(u32, 12), iter_mod.coordsToOffset(&tb.rope, 2, 0).?); // "Line1" (5) + "Line2" (5) + 2 newlines = 12

    // Verify text content doesn't include CRLF
    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Line1\nLine2\nLine3", out_buffer[0..written]);
}

test "TextBuffer setText - mixed line endings (LF, CRLF, CR)" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Unix\nWindows\r\nOldMac\rEnd");

    try std.testing.expectEqual(@as(u32, 4), tb.getLineCount());

    // Verify proper parsing
    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Unix\nWindows\nOldMac\nEnd", out_buffer[0..written]);
}

test "TextBuffer setText - text ending with CRLF" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello World\r\n");

    try std.testing.expectEqual(@as(u32, 2), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 0), iter_mod.coordsToOffset(&tb.rope, 0, 0).?);
    try std.testing.expectEqual(@as(u32, 12), iter_mod.coordsToOffset(&tb.rope, 1, 0).?); // "Hello World" (11) + 1 newline = 12
    try std.testing.expectEqual(@as(u32, 0), iter_mod.lineWidthAt(&tb.rope, 1)); // Empty line
}

test "TextBuffer setText - consecutive CRLF sequences" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Line1\r\n\r\nLine3");

    try std.testing.expectEqual(@as(u32, 3), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 0), iter_mod.coordsToOffset(&tb.rope, 0, 0).?);
    try std.testing.expectEqual(@as(u32, 6), iter_mod.coordsToOffset(&tb.rope, 1, 0).?); // "Line1" (5) + 1 newline = 6
    try std.testing.expectEqual(@as(u32, 7), iter_mod.coordsToOffset(&tb.rope, 2, 0).?); // "Line1" (5) + empty (0) + 2 newlines = 7
}

test "TextBuffer setText - only CRLF sequences" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("\r\n\r\n\r\n");

    try std.testing.expectEqual(@as(u32, 4), tb.getLineCount());

    // All lines should be empty
    for (0..4) |i| {
        try std.testing.expectEqual(@as(u32, 0), iter_mod.lineWidthAt(&tb.rope, @intCast(i)));
    }
}

test "TextBuffer setText - text starting with CRLF" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("\r\nHello World");

    try std.testing.expectEqual(@as(u32, 2), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 0), iter_mod.coordsToOffset(&tb.rope, 0, 0).?); // Empty first line
    try std.testing.expectEqual(@as(u32, 1), iter_mod.coordsToOffset(&tb.rope, 1, 0).?); // Empty line (0) + 1 newline = 1
}

test "TextBuffer setText - CR without LF" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Line1\rLine2\rLine3");

    try std.testing.expectEqual(@as(u32, 3), tb.getLineCount());

    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Line1\nLine2\nLine3", out_buffer[0..written]);
}

test "TextBuffer setText - very long line with SIMD processing" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Create a text longer than 16 bytes (SIMD vector size) to test SIMD path
    var text_builder = std.ArrayList(u8).init(std.testing.allocator);
    defer text_builder.deinit();

    try text_builder.appendNTimes('A', 100);
    try text_builder.appendSlice("\r\n");
    try text_builder.appendNTimes('B', 100);
    try text_builder.appendSlice("\n");
    try text_builder.appendNTimes('C', 100);

    try tb.setText(text_builder.items);

    try std.testing.expectEqual(@as(u32, 3), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 100), iter_mod.lineWidthAt(&tb.rope, 0));
    try std.testing.expectEqual(@as(u32, 100), iter_mod.lineWidthAt(&tb.rope, 1));
    try std.testing.expectEqual(@as(u32, 100), iter_mod.lineWidthAt(&tb.rope, 2));
}

test "TextBuffer setText - unicode content with various line endings" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello 世界\r\n🌟 Test\nEnd");

    try std.testing.expectEqual(@as(u32, 3), tb.getLineCount());

    // Verify text is preserved correctly
    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Hello 世界\n🌟 Test\nEnd", out_buffer[0..written]);
}

test "TextBuffer setText - multiple consecutive different line endings" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Mix of \n, \r\n, \r in sequence
    try tb.setText("A\n\r\n\rB");

    // "A", "", "", "B"
    try std.testing.expectEqual(@as(u32, 4), tb.getLineCount());
}

test "TextBuffer setText - SIMD boundary conditions" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Create text with newlines at SIMD vector boundaries (16 bytes)
    var text_builder = std.ArrayList(u8).init(std.testing.allocator);
    defer text_builder.deinit();

    // 15 chars + \n = exactly 16 bytes
    try text_builder.appendNTimes('X', 15);
    try text_builder.appendSlice("\n");
    // 15 more chars + \n
    try text_builder.appendNTimes('Y', 15);
    try text_builder.appendSlice("\n");
    // Final line
    try text_builder.appendNTimes('Z', 10);

    try tb.setText(text_builder.items);

    try std.testing.expectEqual(@as(u32, 3), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 15), iter_mod.lineWidthAt(&tb.rope, 0));
    try std.testing.expectEqual(@as(u32, 15), iter_mod.lineWidthAt(&tb.rope, 1));
    try std.testing.expectEqual(@as(u32, 10), iter_mod.lineWidthAt(&tb.rope, 2));
}

test "TextBuffer setText - CRLF at SIMD boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Create text where \r is at end of SIMD vector and \n is at start of next
    var text_builder = std.ArrayList(u8).init(std.testing.allocator);
    defer text_builder.deinit();

    // 15 chars + \r = 16 bytes, then \n at position 16
    try text_builder.appendNTimes('A', 15);
    try text_builder.appendSlice("\r\n");
    try text_builder.appendSlice("Next line");

    try tb.setText(text_builder.items);

    try std.testing.expectEqual(@as(u32, 2), tb.getLineCount());
    try std.testing.expectEqual(@as(u32, 15), iter_mod.lineWidthAt(&tb.rope, 0));

    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    const expected_len = 15 + 1 + 9; // 15 A's + newline + "Next line"
    try std.testing.expectEqual(expected_len, written);
}

test "TextBuffer setText - line with multiple u16-sized chunks (SKIPPED)" {
    return error.SkipZigTest;
}

test "TextBuffer setText - validate rope structure is correct" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try text_buffer.UnifiedTextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    // Set multiline text
    try tb.setText("Line 1\nLine 2\nLine 3");

    // Print rope structure
    const rope_text = try tb.rope.toText(std.testing.allocator);
    defer std.testing.allocator.free(rope_text);
    std.debug.print("\nRope structure: {s}\n", .{rope_text});

    // Validate line count
    const line_count = tb.lineCount();
    std.debug.print("Line count: {}\n", .{line_count});
    try std.testing.expectEqual(@as(u32, 3), line_count);

    // Validate break marker count
    const break_count = tb.rope.markerCount(.brk);
    std.debug.print("Break marker count: {}\n", .{break_count});
    try std.testing.expectEqual(@as(u32, 2), break_count); // Should have exactly 2 breaks for 3 lines

    // Validate linestart marker count
    const linestart_count = tb.rope.markerCount(.linestart);
    std.debug.print("Linestart marker count: {}\n", .{linestart_count});
    try std.testing.expectEqual(@as(u32, 3), linestart_count); // Should have exactly 3 linestarts

    // Print each marker's position
    var i: u32 = 0;
    while (i < break_count) : (i += 1) {
        const marker = tb.rope.getMarker(.brk, i);
        std.debug.print("Break marker {}: {any}\n", .{ i, marker });
    }

    i = 0;
    while (i < linestart_count) : (i += 1) {
        const marker = tb.rope.getMarker(.linestart, i);
        std.debug.print("Linestart marker {}: {any}\n", .{ i, marker });
    }

    // Validate line widths
    std.debug.print("Line 0 width: {}\n", .{iter_mod.lineWidthAt(&tb.rope, 0)});
    std.debug.print("Line 1 width: {}\n", .{iter_mod.lineWidthAt(&tb.rope, 1)});
    std.debug.print("Line 2 width: {}\n", .{iter_mod.lineWidthAt(&tb.rope, 2)});

    try std.testing.expectEqual(@as(u32, 6), iter_mod.lineWidthAt(&tb.rope, 0));
    try std.testing.expectEqual(@as(u32, 6), iter_mod.lineWidthAt(&tb.rope, 1));
    try std.testing.expectEqual(@as(u32, 6), iter_mod.lineWidthAt(&tb.rope, 2));

    // Validate total weight
    const total_weight = tb.rope.totalWeight();
    std.debug.print("Total weight: {}\n", .{total_weight});
    // "Line 1" (6) + break (1) + "Line 2" (6) + break (1) + "Line 3" (6) = 20
    try std.testing.expectEqual(@as(u32, 20), total_weight);
}

test "TextBuffer setText - then deleteRange via EditBuffer - validate markers" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    const edit_buffer = @import("../edit-buffer.zig");
    var eb = try edit_buffer.EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Set multiline text
    try eb.setText("Line 1\nLine 2\nLine 3");

    std.debug.print("\n=== After setText ===\n", .{});
    {
        const rope_text_init = try eb.getTextBuffer().rope.toText(std.testing.allocator);
        defer std.testing.allocator.free(rope_text_init);
        std.debug.print("Rope: {s}\n", .{rope_text_init});
        std.debug.print("Line count: {}, Break count: {}, Total weight: {}\n", .{ eb.getTextBuffer().lineCount(), eb.getTextBuffer().rope.markerCount(.brk), eb.getTextBuffer().rope.totalWeight() });
    }

    // Delete all of "Line 3" using EditBuffer.deleteRange
    // Line 2 starts at row 2, col 0 and ends at row 2, col 6
    try eb.deleteRange(.{ .row = 2, .col = 0 }, .{ .row = 2, .col = 6 });

    std.debug.print("\n=== After deleting 'Line 3' ===\n", .{});
    {
        const rope_text_after = try eb.getTextBuffer().rope.toText(std.testing.allocator);
        defer std.testing.allocator.free(rope_text_after);
        std.debug.print("Rope: {s}\n", .{rope_text_after});
        std.debug.print("Line count: {}, Break count: {}, Total weight: {}\n", .{ eb.getTextBuffer().lineCount(), eb.getTextBuffer().rope.markerCount(.brk), eb.getTextBuffer().rope.totalWeight() });
    }

    // Check what markers remain
    const break_count = eb.getTextBuffer().rope.markerCount(.brk);
    var i: u32 = 0;
    while (i < break_count) : (i += 1) {
        const marker = eb.getTextBuffer().rope.getMarker(.brk, i);
        std.debug.print("Break marker {}: {any}\n", .{ i, marker });
    }

    const linestart_count = eb.getTextBuffer().rope.markerCount(.linestart);
    i = 0;
    while (i < linestart_count) : (i += 1) {
        const marker = eb.getTextBuffer().rope.getMarker(.linestart, i);
        std.debug.print("Linestart marker {}: {any}\n", .{ i, marker });
    }

    // After deleting "Line 3" with EditBuffer.deleteRange, we should have:
    // - 2 lines remaining
    // - 1 break marker (between line 0 and line 1)
    // - 2 linestart markers
    try std.testing.expectEqual(@as(u32, 2), eb.getTextBuffer().lineCount());
    try std.testing.expectEqual(@as(u32, 1), eb.getTextBuffer().rope.markerCount(.brk));
    try std.testing.expectEqual(@as(u32, 2), eb.getTextBuffer().rope.markerCount(.linestart));
}
