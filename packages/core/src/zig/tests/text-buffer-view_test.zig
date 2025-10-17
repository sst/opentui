const std = @import("std");
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const gp = @import("../grapheme.zig");

const TextBuffer = text_buffer.TextBufferArray;
const TextBufferView = text_buffer_view.TextBufferViewArray;
const RGBA = text_buffer.RGBA;

// ===== Text Wrapping Tests =====

test "TextBufferView wrapping - no wrap returns same line count" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello World");

    const no_wrap_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 1), no_wrap_count);

    view.setWrapWidth(null);
    const still_no_wrap = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 1), still_no_wrap);
}

test "TextBufferView wrapping - simple wrap splits line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    const no_wrap_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 1), no_wrap_count);

    view.setWrapMode(.char);
    view.setWrapWidth(10);
    const wrapped_count = view.getVirtualLineCount();

    try std.testing.expectEqual(@as(u32, 2), wrapped_count);
}

test "TextBufferView wrapping - wrap at exact boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("0123456789");

    view.setWrapMode(.char);
    view.setWrapWidth(10);
    const wrapped_count = view.getVirtualLineCount();

    try std.testing.expectEqual(@as(u32, 1), wrapped_count);
}

test "TextBufferView wrapping - preserves newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Short\nAnother short line\nLast");

    const no_wrap_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 3), no_wrap_count);

    view.setWrapMode(.char);
    view.setWrapWidth(50);
    const wrapped_count = view.getVirtualLineCount();

    try std.testing.expectEqual(@as(u32, 3), wrapped_count);
}

// ===== Selection Tests =====

test "TextBufferView selection - basic selection without wrap" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello World");

    // Set a local selection
    _ = view.setLocalSelection(2, 0, 7, 0, null, null);

    // Get selection info
    const packed_info = view.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);

    // Selection should be from char 2 to 7
    const start = @as(u32, @intCast(packed_info >> 32));
    const end = @as(u32, @intCast(packed_info & 0xFFFFFFFF));
    try std.testing.expectEqual(@as(u32, 2), start);
    try std.testing.expectEqual(@as(u32, 7), end);
}

test "TextBufferView selection - with wrapped lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    // Set wrap width
    view.setWrapMode(.char);
    view.setWrapWidth(10);

    // Should have 2 virtual lines now
    try std.testing.expectEqual(@as(u32, 2), view.getVirtualLineCount());

    // Select across the wrap boundary
    _ = view.setLocalSelection(5, 0, 5, 1, null, null);

    const packed_info = view.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);

    // Selection should span from char 5 to char 15 (5 chars into second virtual line)
    const start = @as(u32, @intCast(packed_info >> 32));
    const end = @as(u32, @intCast(packed_info & 0xFFFFFFFF));
    try std.testing.expectEqual(@as(u32, 5), start);
    try std.testing.expectEqual(@as(u32, 15), end);
}

test "TextBufferView selection - no selection returns all bits set" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello World");

    // No selection set
    const packed_info = view.packSelectionInfo();
    try std.testing.expectEqual(@as(u64, 0xFFFFFFFF_FFFFFFFF), packed_info);
}

// ===== Word Wrapping Tests =====

test "TextBufferView word wrapping - basic word wrap at space" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello World");

    // Set word wrap mode
    view.setWrapMode(.word);
    view.setWrapWidth(8);
    const wrapped_count = view.getVirtualLineCount();

    // Should wrap at the space: "Hello " and "World"
    try std.testing.expectEqual(@as(u32, 2), wrapped_count);
}

test "TextBufferView word wrapping - long word exceeds width" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRSTUVWXYZ");

    // Set word wrap mode
    view.setWrapMode(.word);
    view.setWrapWidth(10);
    const wrapped_count = view.getVirtualLineCount();

    // Since there's no word boundary, should fall back to character wrapping
    try std.testing.expectEqual(@as(u32, 3), wrapped_count);
}

// ===== Text Extraction Tests =====

test "TextBufferView getSelectedTextIntoBuffer - simple selection" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello World");
    view.setSelection(6, 11, null, null);

    var buffer: [100]u8 = undefined;
    const len = view.getSelectedTextIntoBuffer(&buffer);
    const text = buffer[0..len];

    try std.testing.expectEqualStrings("World", text);
}

test "TextBufferView getSelectedTextIntoBuffer - with newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 1\nLine 2\nLine 3");
    // Rope offsets: "Line 1" (0-5) + newline (6) + "Line 2" (7-12) + newline (13) + "Line 3" (14-19)
    // Selection [0, 9) = "Line 1" (0-5) + newline (6) + "Li" (7-8) = 9 chars
    view.setSelection(0, 9, null, null);

    var buffer: [100]u8 = undefined;
    const len = view.getSelectedTextIntoBuffer(&buffer);
    const text = buffer[0..len];

    try std.testing.expectEqualStrings("Line 1\nLi", text);
}

// ===== Cached Line Info Tests =====

test "TextBufferView getCachedLineInfo - with wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    view.setWrapMode(.char);
    view.setWrapWidth(7);
    const line_count = view.getVirtualLineCount();
    const line_info = view.getCachedLineInfo();

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

// ===== Virtual Line Span Tests =====

test "TextBufferView virtual line spans - with highlights" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    // Add highlight from col 5 to 15 (spans both virtual lines)
    try tb.addHighlight(0, 5, 15, 1, 1, null);

    // Set wrap width
    view.setWrapMode(.char);
    view.setWrapWidth(10);

    // Should have 2 virtual lines
    try std.testing.expectEqual(@as(u32, 2), view.getVirtualLineCount());

    // Get virtual line span info for both lines
    const vline0_info = view.getVirtualLineSpans(0);
    const vline1_info = view.getVirtualLineSpans(1);

    // Both virtual lines should reference the same source line
    try std.testing.expectEqual(@as(usize, 0), vline0_info.source_line);
    try std.testing.expectEqual(@as(usize, 0), vline1_info.source_line);

    // First virtual line has col_offset 0, second has col_offset 10
    try std.testing.expectEqual(@as(u32, 0), vline0_info.col_offset);
    try std.testing.expectEqual(@as(u32, 10), vline1_info.col_offset);

    // Both should have access to the same spans (from the real line)
    try std.testing.expect(vline0_info.spans.len > 0);
    try std.testing.expect(vline1_info.spans.len > 0);
}

// ===== View Updates After Buffer Changes =====

test "TextBufferView updates after buffer setText" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("First text");
    view.setWrapMode(.char);
    view.setWrapWidth(5);
    const count1 = view.getVirtualLineCount();

    // Change buffer content - should automatically mark view dirty
    try tb.setText("New text that is much longer");

    const count2 = view.getVirtualLineCount();

    // Should have more lines after the change
    try std.testing.expect(count2 > count1);
}

// ===== Additional Text Wrapping Tests =====

test "TextBufferView wrapping - multiple wrap lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123");

    view.setWrapMode(.char);
    view.setWrapWidth(10);
    const wrapped_count = view.getVirtualLineCount();

    try std.testing.expectEqual(@as(u32, 3), wrapped_count);
}

test "TextBufferView wrapping - long line with newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST\nShort");

    const no_wrap_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 2), no_wrap_count);

    view.setWrapMode(.char);
    view.setWrapWidth(10);
    const wrapped_count = view.getVirtualLineCount();

    try std.testing.expectEqual(@as(u32, 3), wrapped_count);
}

test "TextBufferView wrapping - change wrap width" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    view.setWrapMode(.char);
    view.setWrapWidth(10);
    var wrapped_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 2), wrapped_count);

    view.setWrapMode(.char);
    view.setWrapWidth(5);
    wrapped_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 4), wrapped_count);

    view.setWrapMode(.char);
    view.setWrapWidth(20);
    wrapped_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 1), wrapped_count);

    view.setWrapWidth(null);
    wrapped_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 1), wrapped_count);
}

// ===== Additional Text Wrapping Edge Case Tests =====

test "TextBufferView wrapping - grapheme at exact boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    // Create text with emoji that takes 2 cells at position 9-10
    try tb.setText("12345678🌟");

    view.setWrapMode(.char);
    view.setWrapWidth(10);
    const wrapped_count = view.getVirtualLineCount();

    // Should fit exactly on one line (8 chars + 2-cell emoji = 10)
    try std.testing.expectEqual(@as(u32, 1), wrapped_count);
}

test "TextBufferView wrapping - grapheme split across boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    // Create text where emoji would straddle the boundary
    try tb.setText("123456789🌟ABC");

    view.setWrapMode(.char);
    view.setWrapWidth(10);
    const wrapped_count = view.getVirtualLineCount();

    // Should wrap: line 1 has "123456789", line 2 has "🌟ABC"
    try std.testing.expectEqual(@as(u32, 2), wrapped_count);
}

test "TextBufferView wrapping - CJK characters at boundaries" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    // CJK characters typically take 2 cells each
    try tb.setText("测试文字处理");

    view.setWrapMode(.char);
    view.setWrapWidth(10);
    const wrapped_count = view.getVirtualLineCount();

    // 6 CJK chars × 2 cells = 12 cells, should wrap to 2 lines
    try std.testing.expectEqual(@as(u32, 2), wrapped_count);
}

test "TextBufferView wrapping - mixed width characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    // Mix of single-width and double-width characters
    try tb.setText("AB测试CD");

    view.setWrapMode(.char);
    view.setWrapWidth(6);
    const wrapped_count = view.getVirtualLineCount();

    // "AB" (2) + "测试" (4) = 6 cells on first line, "CD" on second
    try std.testing.expectEqual(@as(u32, 2), wrapped_count);
}

test "TextBufferView wrapping - single wide character exceeds width" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    // Emoji takes 2 cells but wrap width is 1
    try tb.setText("🌟");

    view.setWrapMode(.char);
    view.setWrapWidth(1);
    const wrapped_count = view.getVirtualLineCount();

    // Wide char that doesn't fit should still be on one line (can't split grapheme)
    try std.testing.expectEqual(@as(u32, 1), wrapped_count);
}

test "TextBufferView wrapping - multiple consecutive wide characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    // Multiple emojis in a row
    try tb.setText("🌟🌟🌟🌟🌟");

    view.setWrapMode(.char);
    view.setWrapWidth(6);
    const wrapped_count = view.getVirtualLineCount();

    // 5 emojis × 2 cells = 10 cells, with width 6 should be 2 lines
    try std.testing.expectEqual(@as(u32, 2), wrapped_count);
}

test "TextBufferView wrapping - zero width characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    // Text with combining characters (zero-width)
    try tb.setText("e\u{0301}e\u{0301}e\u{0301}"); // é é é using combining acute

    view.setWrapMode(.char);
    view.setWrapWidth(2);
    const wrapped_count = view.getVirtualLineCount();

    // Should consider the actual width after combining
    try std.testing.expect(wrapped_count >= 1);
}

// ===== Additional Word Wrapping Tests =====

test "TextBufferView word wrapping - multiple words" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("The quick brown fox jumps");

    // Set word wrap mode
    view.setWrapMode(.word);
    view.setWrapWidth(15);
    const wrapped_count = view.getVirtualLineCount();

    // Should wrap intelligently at word boundaries
    try std.testing.expect(wrapped_count >= 2);
}

test "TextBufferView word wrapping - hyphenated words" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("self-contained multi-line");

    // Set word wrap mode
    view.setWrapMode(.word);
    view.setWrapWidth(12);
    const wrapped_count = view.getVirtualLineCount();

    // Should break at hyphens
    try std.testing.expect(wrapped_count >= 2);
}

test "TextBufferView word wrapping - punctuation boundaries" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello,World.Test");

    // Set word wrap mode
    view.setWrapMode(.word);
    view.setWrapWidth(8);
    const wrapped_count = view.getVirtualLineCount();

    // Should break at punctuation
    try std.testing.expect(wrapped_count >= 2);
}

test "TextBufferView word wrapping - compare char vs word mode" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello wonderful world");

    // Test with char mode first
    view.setWrapMode(.char);
    view.setWrapWidth(10);
    const char_wrapped_count = view.getVirtualLineCount();

    // Now test with word mode
    view.setWrapMode(.word);
    const word_wrapped_count = view.getVirtualLineCount();

    // Both should wrap, but potentially differently
    try std.testing.expect(char_wrapped_count >= 2);
    try std.testing.expect(word_wrapped_count >= 2);
}

test "TextBufferView word wrapping - empty lines preserved" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("First line\n\nSecond line");

    // Set word wrap mode
    view.setWrapMode(.word);
    view.setWrapWidth(8);
    const wrapped_count = view.getVirtualLineCount();

    // Should preserve empty lines
    try std.testing.expect(wrapped_count >= 3);
}

test "TextBufferView word wrapping - slash as boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("path/to/file");

    // Set word wrap mode
    view.setWrapMode(.word);
    view.setWrapWidth(8);
    const wrapped_count = view.getVirtualLineCount();

    // Should break at slashes
    try std.testing.expect(wrapped_count >= 2);
}

test "TextBufferView word wrapping - brackets as boundaries" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("array[index]value");

    // Set word wrap mode
    view.setWrapMode(.word);
    view.setWrapWidth(10);
    const wrapped_count = view.getVirtualLineCount();

    // Should break at brackets
    try std.testing.expect(wrapped_count >= 2);
}

test "TextBufferView word wrapping - single character at boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("a b c d e f");

    // Set word wrap mode
    view.setWrapMode(.word);
    view.setWrapWidth(4);
    const wrapped_count = view.getVirtualLineCount();

    // Should handle single character words properly
    try std.testing.expect(wrapped_count >= 3);
}

// ===== Advanced Wrapping Edge Cases =====

test "TextBufferView wrapping - very narrow width (1 char)" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDE");

    view.setWrapMode(.char);
    view.setWrapWidth(1);
    const wrapped_count = view.getVirtualLineCount();

    // Each character should be on its own line
    try std.testing.expectEqual(@as(u32, 5), wrapped_count);
}

test "TextBufferView wrapping - very narrow width (2 chars)" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEF");

    view.setWrapMode(.char);
    view.setWrapWidth(2);
    const wrapped_count = view.getVirtualLineCount();

    // Should wrap to 3 lines
    try std.testing.expectEqual(@as(u32, 3), wrapped_count);
}

test "TextBufferView wrapping - switch between char and word mode" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello world test");

    view.setWrapMode(.char);
    view.setWrapWidth(8);

    // Char mode
    view.setWrapMode(.char);
    const char_count = view.getVirtualLineCount();

    // Word mode
    view.setWrapMode(.word);
    const word_count = view.getVirtualLineCount();

    // Both should wrap, but potentially differently
    try std.testing.expect(char_count >= 2);
    try std.testing.expect(word_count >= 2);
}

test "TextBufferView wrapping - multiple consecutive newlines with wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJ\n\n\nKLMNOPQRST");

    view.setWrapMode(.char);
    view.setWrapWidth(5);
    const wrapped_count = view.getVirtualLineCount();

    // Should preserve all newlines: wrapped line 1, empty, empty, wrapped line 2
    // Line 1: "ABCDEFGHIJ" wraps to 2 lines
    // Line 2-3: empty lines
    // Line 4: "KLMNOPQRST" wraps to 2 lines
    try std.testing.expect(wrapped_count >= 6);
}

test "TextBufferView wrapping - only spaces should not create extra lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("          "); // 10 spaces

    view.setWrapMode(.char);
    view.setWrapWidth(5);
    const wrapped_count = view.getVirtualLineCount();

    // 10 spaces should wrap to 2 lines
    try std.testing.expectEqual(@as(u32, 2), wrapped_count);
}

test "TextBufferView wrapping - mixed tabs and spaces" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("AB\tCD\tEF");

    view.setWrapMode(.char);
    view.setWrapWidth(5);
    const wrapped_count = view.getVirtualLineCount();

    // Should handle tabs (tabs may be treated as single-width in the buffer)
    try std.testing.expect(wrapped_count >= 1);
}

test "TextBufferView wrapping - unicode emoji with varying widths" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    // Mix of single-width ASCII and wide emoji
    try tb.setText("A🌟B🎨C🚀D");

    view.setWrapMode(.char);
    view.setWrapWidth(5);
    const wrapped_count = view.getVirtualLineCount();

    // Should handle varying widths correctly
    try std.testing.expect(wrapped_count >= 2);
}

test "TextBufferView wrapping - getVirtualLines reflects current wrap state" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    // No wrap
    var vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    // With wrap
    view.setWrapMode(.char);
    view.setWrapWidth(10);
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), vlines.len);

    // Change wrap width
    view.setWrapMode(.char);
    view.setWrapWidth(5);
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 4), vlines.len);

    // Remove wrap
    view.setWrapWidth(null);
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);
}

// ===== Additional Selection Tests =====

test "TextBufferView selection - multi-line selection without wrap" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 1\nLine 2\nLine 3");

    // Select from middle of line 1 to middle of line 2
    _ = view.setLocalSelection(2, 0, 4, 1, null, null);

    const packed_info = view.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);
}

test "TextBufferView selection - selection at wrap boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    view.setWrapMode(.char);
    view.setWrapWidth(10);

    // Select exactly at the wrap boundary (chars 9-11, which spans the wrap)
    _ = view.setLocalSelection(9, 0, 1, 1, null, null);

    const packed_info = view.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);

    const start = @as(u32, @intCast(packed_info >> 32));
    const end = @as(u32, @intCast(packed_info & 0xFFFFFFFF));
    try std.testing.expectEqual(@as(u32, 9), start);
    try std.testing.expectEqual(@as(u32, 11), end);
}

test "TextBufferView selection - spanning multiple wrapped lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    // Create text that will wrap to 3 lines at width 10
    try tb.setText("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123");

    view.setWrapMode(.char);
    view.setWrapWidth(10);
    try std.testing.expectEqual(@as(u32, 3), view.getVirtualLineCount());

    // Select from virtual line 0 to virtual line 2
    _ = view.setLocalSelection(2, 0, 8, 2, null, null);

    const packed_info = view.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);

    const start = @as(u32, @intCast(packed_info >> 32));
    const end = @as(u32, @intCast(packed_info & 0xFFFFFFFF));
    try std.testing.expectEqual(@as(u32, 2), start);
    try std.testing.expectEqual(@as(u32, 28), end); // 20 + 8
}

test "TextBufferView selection - changes when wrap width changes" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    // Initial wrap at width 10 - 2 virtual lines
    view.setWrapMode(.char);
    view.setWrapWidth(10);
    _ = view.setLocalSelection(5, 0, 5, 1, null, null); // Select from pos 5 on line 0 to pos 5 on line 1

    var packed_info = view.packSelectionInfo();
    var start = @as(u32, @intCast(packed_info >> 32));
    var end = @as(u32, @intCast(packed_info & 0xFFFFFFFF));
    try std.testing.expectEqual(@as(u32, 5), start);
    try std.testing.expectEqual(@as(u32, 15), end);

    // Change wrap width to 5 - 4 virtual lines, but selection coordinates stay the same
    view.setWrapMode(.char);
    view.setWrapWidth(5);
    _ = view.setLocalSelection(5, 0, 5, 1, null, null);

    packed_info = view.packSelectionInfo();
    start = @as(u32, @intCast(packed_info >> 32));
    end = @as(u32, @intCast(packed_info & 0xFFFFFFFF));

    // At width 5: line 0 = chars 0-4, line 1 = chars 5-9
    // Selection from (5,0) is invalid (line 0 only has 5 chars), wraps to line 1 char 0
    // So we expect different behavior
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);
}

test "TextBufferView selection - empty selection with wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJ");

    view.setWrapMode(.char);
    view.setWrapWidth(5);

    // Select same position (empty selection)
    _ = view.setLocalSelection(2, 0, 2, 0, null, null);

    const packed_info = view.packSelectionInfo();
    // Empty selection should return no selection
    try std.testing.expectEqual(@as(u64, 0xFFFFFFFF_FFFFFFFF), packed_info);
}

test "TextBufferView selection - with newlines and wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    // Text with newlines that also needs wrapping
    try tb.setText("ABCDEFGHIJKLMNO\nPQRSTUVWXYZ");

    view.setWrapMode(.char);
    view.setWrapWidth(10);

    // Without wrap: 2 real lines
    // With wrap at 10: line 0 wraps to 2 virtual lines, line 1 wraps to 3 virtual lines
    const vline_count = view.getVirtualLineCount();
    try std.testing.expect(vline_count >= 3);

    // Select across the newline boundary
    _ = view.setLocalSelection(5, 0, 5, 2, null, null);

    const packed_info = view.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);
}

test "TextBufferView selection - reset clears selection" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello World");

    // Set selection
    _ = view.setLocalSelection(0, 0, 5, 0, null, null);
    var packed_info = view.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);

    // Reset selection
    view.resetLocalSelection();
    packed_info = view.packSelectionInfo();
    try std.testing.expectEqual(@as(u64, 0xFFFFFFFF_FFFFFFFF), packed_info);
}

test "TextBufferView selection - spanning multiple lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Red\nBlue");
    // Rope offsets: "Red" (0-2) + newline (3) + "Blue" (4-7)
    // Selection [2, 5) = "d" (2) + newline (3) + "B" (4) = 3 chars
    view.setSelection(2, 5, null, null);

    var buffer: [100]u8 = undefined;
    const len = view.getSelectedTextIntoBuffer(&buffer);
    const text = buffer[0..len];

    try std.testing.expectEqualStrings("d\nB", text);
}

// ===== Additional Line Info Tests =====

test "TextBufferView line info - empty buffer" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("");

    const line_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 1), line_count);

    const line_info = view.getCachedLineInfo();
    try std.testing.expectEqual(@as(usize, 1), line_info.starts.len);
    try std.testing.expectEqual(@as(u32, 0), line_info.starts[0]);
    try std.testing.expectEqual(@as(u32, 0), line_info.widths[0]);
}

test "TextBufferView line info - simple text without newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello World");

    const line_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 1), line_count);

    const line_info = view.getCachedLineInfo();
    try std.testing.expectEqual(@as(u32, 0), line_info.starts[0]);
    try std.testing.expect(line_info.widths[0] > 0);
}

test "TextBufferView line info - text ending with newline" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello World\n");

    const line_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 2), line_count);

    const line_info = view.getCachedLineInfo();
    try std.testing.expectEqual(@as(u32, 0), line_info.starts[0]);
    try std.testing.expect(line_info.widths[0] > 0);
    try std.testing.expect(line_info.widths[1] >= 0);
}

test "TextBufferView line info - consecutive newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 1\n\nLine 3");

    const line_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 3), line_count);

    const line_info = view.getCachedLineInfo();
    try std.testing.expectEqual(@as(u32, 0), line_info.starts[0]);
}

test "TextBufferView line info - only newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("\n\n\n");

    const line_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 4), line_count);

    const line_info = view.getCachedLineInfo();
    for (line_info.widths) |width| {
        try std.testing.expect(width >= 0);
    }
}

test "TextBufferView line info - wide characters (Unicode)" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello 世界 🌟");

    const line_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 1), line_count);

    const line_info = view.getCachedLineInfo();
    try std.testing.expect(line_info.widths[0] > 0);
}

test "TextBufferView line info - very long lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    // Create a long text with 1000 'A' characters
    const longText = [_]u8{'A'} ** 1000;
    try tb.setText(&longText);

    const line_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 1), line_count);

    const line_info = view.getCachedLineInfo();
    try std.testing.expect(line_info.widths[0] > 0);
}

test "TextBufferView line info - buffer with only whitespace" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("   \n \n ");

    const line_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 3), line_count);

    const line_info = view.getCachedLineInfo();
    for (line_info.widths) |width| {
        try std.testing.expect(width >= 0);
    }
}

test "TextBufferView line info - single character lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("A\nB\nC");

    const line_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 3), line_count);

    const line_info = view.getCachedLineInfo();
    for (line_info.widths) |width| {
        try std.testing.expect(width > 0);
    }
}

test "TextBufferView line info - complex Unicode combining characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("café\nnaïve\nrésumé");

    const line_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 3), line_count);

    const line_info = view.getCachedLineInfo();
    for (line_info.widths) |width| {
        try std.testing.expect(width > 0);
    }
}

test "TextBufferView line info - extremely long single line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    // Create extremely long text with 10000 'A' characters
    const extremelyLongText = [_]u8{'A'} ** 10000;
    try tb.setText(&extremelyLongText);

    const line_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 1), line_count);

    const line_info = view.getCachedLineInfo();
    try std.testing.expect(line_info.widths[0] > 0);
}

test "TextBufferView line info - extremely long line with wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    // Create extremely long text with 10000 'A' characters
    const extremelyLongText = [_]u8{'A'} ** 10000;
    try tb.setText(&extremelyLongText);

    view.setWrapMode(.char);
    view.setWrapWidth(80);
    const wrapped_count = view.getVirtualLineCount();

    // Should wrap to many lines
    try std.testing.expect(wrapped_count > 100);
}

// ===== Text Extraction Tests =====

test "TextBufferView getPlainTextIntoBuffer - simple text without newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello World");

    var buffer: [100]u8 = undefined;
    const len = view.getPlainTextIntoBuffer(&buffer);
    const text = buffer[0..len];

    try std.testing.expectEqualStrings("Hello World", text);
}

test "TextBufferView getPlainTextIntoBuffer - text with newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 1\nLine 2\nLine 3");

    var buffer: [100]u8 = undefined;
    const len = view.getPlainTextIntoBuffer(&buffer);
    const text = buffer[0..len];

    try std.testing.expectEqualStrings("Line 1\nLine 2\nLine 3", text);
}

test "TextBufferView getPlainTextIntoBuffer - text with only newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("\n\n\n");

    var buffer: [100]u8 = undefined;
    const len = view.getPlainTextIntoBuffer(&buffer);
    const text = buffer[0..len];

    try std.testing.expectEqualStrings("\n\n\n", text);
}

test "TextBufferView getPlainTextIntoBuffer - empty lines between content" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("First\n\nThird");

    var buffer: [100]u8 = undefined;
    const len = view.getPlainTextIntoBuffer(&buffer);
    const text = buffer[0..len];

    try std.testing.expectEqualStrings("First\n\nThird", text);
}

// ===== Additional Line Info Tests (from original suite) =====

test "TextBufferView line info - text starting with newline" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("\nHello World");

    const line_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 2), line_count);

    const line_info = view.getCachedLineInfo();
    try std.testing.expectEqual(@as(u32, 0), line_info.starts[0]);
    // Line 1 starts after empty line 0 (width=0) + newline (1), so char_offset = 1
    try std.testing.expectEqual(@as(u32, 1), line_info.starts[1]);
}

test "TextBufferView line info - lines with different widths" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var text_builder = std.ArrayList(u8).init(std.testing.allocator);
    defer text_builder.deinit();
    try text_builder.appendSlice("Short\n");
    try text_builder.appendNTimes('A', 50);
    try text_builder.appendSlice("\nMedium");
    const text = text_builder.items;

    try tb.setText(text);

    const line_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 3), line_count);

    const line_info = view.getCachedLineInfo();
    try std.testing.expect(line_info.widths[0] < line_info.widths[1]);
    try std.testing.expect(line_info.widths[1] > line_info.widths[2]);
}

test "TextBufferView line info - alternating empty and content lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("\nContent\n\nMore\n\n");

    const line_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 6), line_count);

    const line_info = view.getCachedLineInfo();
    for (line_info.widths) |width| {
        try std.testing.expect(width >= 0);
    }
}

test "TextBufferView line info - thousands of lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var text_builder = std.ArrayList(u8).init(std.testing.allocator);
    defer text_builder.deinit();

    var i: u32 = 0;
    while (i < 999) : (i += 1) {
        try std.fmt.format(text_builder.writer(), "Line {}\n", .{i});
    }
    try std.fmt.format(text_builder.writer(), "Line {}", .{i});

    try tb.setText(text_builder.items);

    const line_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 1000), line_count);

    const line_info = view.getCachedLineInfo();
    try std.testing.expectEqual(@as(u32, 0), line_info.starts[0]);

    var line_idx: u32 = 1;
    while (line_idx < 1000) : (line_idx += 1) {
        try std.testing.expect(line_info.starts[line_idx] > line_info.starts[line_idx - 1]);
    }
}

// ===== Highlight System Tests =====

test "TextBufferView highlights - add single highlight to line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello World");

    try tb.addHighlight(0, 0, 5, 1, 0, null);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
    try std.testing.expectEqual(@as(u32, 0), highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 5), highlights[0].col_end);
    try std.testing.expectEqual(@as(u32, 1), highlights[0].style_id);
}

test "TextBufferView highlights - add multiple highlights to same line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello World");

    try tb.addHighlight(0, 0, 5, 1, 0, null);
    try tb.addHighlight(0, 6, 11, 2, 0, null);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 2), highlights.len);
    try std.testing.expectEqual(@as(u32, 1), highlights[0].style_id);
    try std.testing.expectEqual(@as(u32, 2), highlights[1].style_id);
}

test "TextBufferView highlights - add highlights to multiple lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 1\nLine 2\nLine 3");

    try tb.addHighlight(0, 0, 6, 1, 0, null);
    try tb.addHighlight(1, 0, 6, 2, 0, null);
    try tb.addHighlight(2, 0, 6, 3, 0, null);

    try std.testing.expectEqual(@as(usize, 1), tb.getLineHighlights(0).len);
    try std.testing.expectEqual(@as(usize, 1), tb.getLineHighlights(1).len);
    try std.testing.expectEqual(@as(usize, 1), tb.getLineHighlights(2).len);
}

test "TextBufferView highlights - remove highlights by reference" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 1\nLine 2");

    try tb.addHighlight(0, 0, 3, 1, 0, 100);
    try tb.addHighlight(0, 3, 6, 2, 0, 200);
    try tb.addHighlight(1, 0, 6, 3, 0, 100);

    tb.removeHighlightsByRef(100);

    const line0_highlights = tb.getLineHighlights(0);
    const line1_highlights = tb.getLineHighlights(1);

    try std.testing.expectEqual(@as(usize, 1), line0_highlights.len);
    try std.testing.expectEqual(@as(u32, 2), line0_highlights[0].style_id);
    try std.testing.expectEqual(@as(usize, 0), line1_highlights.len);
}

test "TextBufferView highlights - clear line highlights" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 1\nLine 2");

    try tb.addHighlight(0, 0, 6, 1, 0, null);
    try tb.addHighlight(0, 6, 10, 2, 0, null);

    tb.clearLineHighlights(0);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 0), highlights.len);
}

test "TextBufferView highlights - clear all highlights" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 1\nLine 2\nLine 3");

    try tb.addHighlight(0, 0, 6, 1, 0, null);
    try tb.addHighlight(1, 0, 6, 2, 0, null);
    try tb.addHighlight(2, 0, 6, 3, 0, null);

    tb.clearAllHighlights();

    try std.testing.expectEqual(@as(usize, 0), tb.getLineHighlights(0).len);
    try std.testing.expectEqual(@as(usize, 0), tb.getLineHighlights(1).len);
    try std.testing.expectEqual(@as(usize, 0), tb.getLineHighlights(2).len);
}

test "TextBufferView highlights - overlapping highlights" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello World");

    try tb.addHighlight(0, 0, 8, 1, 0, null);
    try tb.addHighlight(0, 5, 11, 2, 0, null);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 2), highlights.len);
}

test "TextBufferView highlights - style spans computed correctly" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("0123456789");

    try tb.addHighlight(0, 0, 3, 1, 1, null);
    try tb.addHighlight(0, 5, 8, 2, 1, null);

    const spans = tb.getLineSpans(0);
    try std.testing.expect(spans.len > 0);

    var found_style1 = false;
    var found_style2 = false;
    for (spans) |span| {
        if (span.style_id == 1) found_style1 = true;
        if (span.style_id == 2) found_style2 = true;
    }
    try std.testing.expect(found_style1);
    try std.testing.expect(found_style2);
}

test "TextBufferView highlights - priority handling in spans" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("0123456789");

    try tb.addHighlight(0, 0, 8, 1, 1, null);
    try tb.addHighlight(0, 3, 6, 2, 5, null);

    const spans = tb.getLineSpans(0);
    try std.testing.expect(spans.len > 0);

    var found_high_priority = false;
    for (spans) |span| {
        if (span.col >= 3 and span.col < 6 and span.style_id == 2) {
            found_high_priority = true;
        }
    }
    try std.testing.expect(found_high_priority);
}

// ===== Character Range Highlight Tests =====

test "TextBufferView char range highlights - single line highlight" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello World");

    try tb.addHighlightByCharRange(0, 5, 1, 1, null);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
    try std.testing.expectEqual(@as(u32, 0), highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 5), highlights[0].col_end);
    try std.testing.expectEqual(@as(u32, 1), highlights[0].style_id);
}

test "TextBufferView char range highlights - multi-line highlight" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello\nWorld\nTest");

    // Highlight from chars 3-9 (not counting newlines: char 3 in "Hello", char 9 at end of "World")
    try tb.addHighlightByCharRange(3, 9, 1, 1, null);

    const line0_highlights = tb.getLineHighlights(0);
    const line1_highlights = tb.getLineHighlights(1);

    try std.testing.expectEqual(@as(usize, 1), line0_highlights.len);
    try std.testing.expectEqual(@as(usize, 1), line1_highlights.len);

    try std.testing.expectEqual(@as(u32, 3), line0_highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 5), line0_highlights[0].col_end);

    try std.testing.expectEqual(@as(u32, 0), line1_highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 4), line1_highlights[0].col_end);
}

test "TextBufferView char range highlights - spanning three lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line1\nLine2\nLine3");

    try tb.addHighlightByCharRange(3, 13, 1, 1, null);

    const line0_highlights = tb.getLineHighlights(0);
    const line1_highlights = tb.getLineHighlights(1);
    const line2_highlights = tb.getLineHighlights(2);

    try std.testing.expectEqual(@as(usize, 1), line0_highlights.len);
    try std.testing.expectEqual(@as(usize, 1), line1_highlights.len);
    try std.testing.expectEqual(@as(usize, 1), line2_highlights.len);

    try std.testing.expectEqual(@as(u32, 3), line0_highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 0), line1_highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 0), line2_highlights[0].col_start);
}

test "TextBufferView char range highlights - empty range" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello World");

    try tb.addHighlightByCharRange(5, 5, 1, 1, null);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 0), highlights.len);
}

test "TextBufferView char range highlights - multiple non-overlapping ranges" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("function hello() { return 42; }");

    try tb.addHighlightByCharRange(0, 8, 1, 1, null);
    try tb.addHighlightByCharRange(9, 14, 2, 1, null);
    try tb.addHighlightByCharRange(19, 25, 3, 1, null);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 3), highlights.len);
    try std.testing.expectEqual(@as(u32, 1), highlights[0].style_id);
    try std.testing.expectEqual(@as(u32, 2), highlights[1].style_id);
    try std.testing.expectEqual(@as(u32, 3), highlights[2].style_id);
}

test "TextBufferView char range highlights - with reference ID for removal" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line1\nLine2\nLine3");

    try tb.addHighlightByCharRange(0, 5, 1, 1, 100);
    try tb.addHighlightByCharRange(6, 11, 2, 1, 100);

    try std.testing.expectEqual(@as(usize, 1), tb.getLineHighlights(0).len);
    try std.testing.expectEqual(@as(usize, 1), tb.getLineHighlights(1).len);

    tb.removeHighlightsByRef(100);

    try std.testing.expectEqual(@as(usize, 0), tb.getLineHighlights(0).len);
    try std.testing.expectEqual(@as(usize, 0), tb.getLineHighlights(1).len);
}

// ===== Highlights with Wrapping Tests =====

test "TextBufferView highlights - work correctly with wrapped lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    try tb.addHighlight(0, 5, 15, 1, 1, null);

    view.setWrapMode(.char);
    view.setWrapWidth(10);

    try std.testing.expectEqual(@as(u32, 2), view.getVirtualLineCount());

    const vline0_info = view.getVirtualLineSpans(0);
    const vline1_info = view.getVirtualLineSpans(1);

    try std.testing.expectEqual(@as(usize, 0), vline0_info.source_line);
    try std.testing.expectEqual(@as(usize, 0), vline1_info.source_line);

    try std.testing.expectEqual(@as(u32, 0), vline0_info.col_offset);
    try std.testing.expectEqual(@as(u32, 10), vline1_info.col_offset);

    try std.testing.expect(vline0_info.spans.len > 0);
    try std.testing.expect(vline1_info.spans.len > 0);
}

test "TextBufferView highlights - multiple highlights on wrapped line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRSTUVWXYZ");

    try tb.addHighlight(0, 2, 8, 1, 1, null);
    try tb.addHighlight(0, 12, 18, 2, 1, null);
    try tb.addHighlight(0, 22, 26, 3, 1, null);

    view.setWrapMode(.char);
    view.setWrapWidth(10);

    const vline_count = view.getVirtualLineCount();
    try std.testing.expect(vline_count >= 3);

    for (0..vline_count) |i| {
        const vline_info = view.getVirtualLineSpans(i);
        try std.testing.expectEqual(@as(usize, 0), vline_info.source_line);
        try std.testing.expectEqual(@as(u32, @intCast(i * 10)), vline_info.col_offset);
    }
}

test "TextBufferView highlights - with emojis and wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("AB🌟CD🎨EF🚀GH");

    try tb.addHighlight(0, 2, 8, 1, 1, null);

    view.setWrapMode(.char);
    view.setWrapWidth(6);

    const vline_count = view.getVirtualLineCount();
    try std.testing.expect(vline_count >= 2);

    const vline0_info = view.getVirtualLineSpans(0);
    const vline1_info = view.getVirtualLineSpans(1);

    try std.testing.expectEqual(@as(usize, 0), vline0_info.source_line);
    try std.testing.expectEqual(@as(usize, 0), vline1_info.source_line);

    try std.testing.expectEqual(@as(u32, 0), vline0_info.col_offset);
    try std.testing.expect(vline1_info.col_offset == 6);

    try std.testing.expect(vline0_info.spans.len > 0);
}

test "TextBufferView highlights - with CJK characters and wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("AB测试CD文字EF");

    try tb.addHighlight(0, 2, 6, 1, 1, null);

    view.setWrapMode(.char);
    view.setWrapWidth(6);

    const vline_count = view.getVirtualLineCount();
    try std.testing.expect(vline_count >= 2);

    for (0..vline_count) |i| {
        const vline_info = view.getVirtualLineSpans(i);
        try std.testing.expectEqual(@as(usize, 0), vline_info.source_line);

        if (i == 0) {
            try std.testing.expectEqual(@as(u32, 0), vline_info.col_offset);
        } else if (i == 1) {
            try std.testing.expectEqual(@as(u32, 6), vline_info.col_offset);
        }
    }
}

test "TextBufferView highlights - mixed ASCII and wide chars with wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello🌟世界");

    try tb.addHighlight(0, 5, 11, 1, 1, null);

    view.setWrapMode(.char);
    view.setWrapWidth(7);

    const vline_count = view.getVirtualLineCount();
    try std.testing.expect(vline_count >= 2);

    const vline0_info = view.getVirtualLineSpans(0);
    const vline1_info = view.getVirtualLineSpans(1);

    try std.testing.expectEqual(@as(usize, 0), vline0_info.source_line);
    try std.testing.expectEqual(@as(usize, 0), vline1_info.source_line);

    try std.testing.expectEqual(@as(u32, 0), vline0_info.col_offset);
    try std.testing.expectEqual(@as(u32, 7), vline1_info.col_offset);

    try std.testing.expect(vline0_info.spans.len > 0);
    try std.testing.expect(vline1_info.spans.len > 0);
}

test "TextBufferView highlights - emoji at wrap boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCD🌟EFGH");

    try tb.addHighlight(0, 3, 7, 1, 1, null);

    view.setWrapMode(.char);
    view.setWrapWidth(5);

    const vline_count = view.getVirtualLineCount();
    try std.testing.expect(vline_count >= 2);

    const vline0_info = view.getVirtualLineSpans(0);
    const vline1_info = view.getVirtualLineSpans(1);

    try std.testing.expectEqual(@as(u32, 0), vline0_info.col_offset);
    try std.testing.expect(vline1_info.col_offset >= 4);
}

// ===== Highlights with Graphemes (No Wrapping) Tests =====

test "TextBufferView highlights - emojis without wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("AB🌟CD🎨EF");

    try tb.addHighlight(0, 2, 8, 1, 1, null);

    const vline_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 1), vline_count);

    const spans = tb.getLineSpans(0);
    try std.testing.expect(spans.len > 0);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
    try std.testing.expectEqual(@as(u32, 2), highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 8), highlights[0].col_end);
}

test "TextBufferView highlights - CJK without wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("AB测试CD");

    try tb.addHighlight(0, 2, 6, 1, 1, null);

    const vline_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 1), vline_count);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
    try std.testing.expectEqual(@as(u32, 2), highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 6), highlights[0].col_end);

    const spans = tb.getLineSpans(0);
    try std.testing.expect(spans.len > 0);
}

test "TextBufferView highlights - mixed width graphemes without wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("A🌟B测C试D");

    try tb.addHighlight(0, 1, 4, 1, 1, null);
    try tb.addHighlight(0, 4, 7, 2, 1, null);

    const vline_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 1), vline_count);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 2), highlights.len);
    try std.testing.expectEqual(@as(u32, 1), highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 4), highlights[0].col_end);
    try std.testing.expectEqual(@as(u32, 4), highlights[1].col_start);
    try std.testing.expectEqual(@as(u32, 7), highlights[1].col_end);

    const spans = tb.getLineSpans(0);
    try std.testing.expect(spans.len > 0);
}

test "TextBufferView highlights - emoji at start without wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("🌟ABCD");

    try tb.addHighlight(0, 0, 3, 1, 1, null);

    const vline_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 1), vline_count);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
    try std.testing.expectEqual(@as(u32, 0), highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 3), highlights[0].col_end);
}

test "TextBufferView highlights - emoji at end without wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCD🌟");

    try tb.addHighlight(0, 3, 6, 1, 1, null);

    const vline_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 1), vline_count);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
    try std.testing.expectEqual(@as(u32, 3), highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 6), highlights[0].col_end);
}

test "TextBufferView highlights - consecutive emojis without wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("A🌟🎨🚀B");

    try tb.addHighlight(0, 1, 7, 1, 1, null);

    const vline_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 1), vline_count);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
    try std.testing.expectEqual(@as(u32, 1), highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 7), highlights[0].col_end);
}

// ===== Accessor Method Tests =====

test "TextBufferView accessor methods - getVirtualLines and getLines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 1\nLine 2");

    // Test getVirtualLines returns correct data
    const virtual_lines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), virtual_lines.len);

    // Test lineCount returns correct data from buffer
    try std.testing.expectEqual(@as(u32, 2), tb.lineCount());

    // Verify we can access chunks through virtual lines
    try std.testing.expect(virtual_lines[0].chunks.items.len > 0);
}

test "TextBufferView accessor methods - with wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    // Set wrap width
    view.setWrapMode(.char);
    view.setWrapWidth(10);

    // Get virtual lines - should be wrapped
    const virtual_lines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), virtual_lines.len);

    // Get real line count - should be 1
    try std.testing.expectEqual(@as(u32, 1), tb.lineCount());
}

// ===== Virtual Line Relationship Tests =====

test "TextBufferView virtual lines - match real lines when no wrap" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 1\nLine 2\nLine 3");

    // Check line count matches expected
    try std.testing.expectEqual(@as(u32, 3), view.getVirtualLineCount());
    try std.testing.expectEqual(@as(u32, 3), tb.getLineCount());

    // Verify line info is available
    const line_info = view.getCachedLineInfo();
    try std.testing.expectEqual(@as(usize, 3), line_info.starts.len);
    try std.testing.expectEqual(@as(usize, 3), line_info.widths.len);
}

test "TextBufferView virtual lines - updated when wrap width set" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    // Initially no wrap
    try std.testing.expectEqual(@as(u32, 1), view.getVirtualLineCount());

    // Set wrap width
    view.setWrapMode(.char);
    view.setWrapWidth(10);
    try std.testing.expectEqual(@as(u32, 2), view.getVirtualLineCount());
}

test "TextBufferView virtual lines - reset to match real lines when wrap removed" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST\nShort");

    // Set wrap width
    view.setWrapMode(.char);
    view.setWrapWidth(10);
    try std.testing.expectEqual(@as(u32, 3), view.getVirtualLineCount());

    // Remove wrap
    view.setWrapWidth(null);

    // Should be back to 2 lines
    try std.testing.expectEqual(@as(u32, 2), view.getVirtualLineCount());

    // Verify line info is consistent
    const line_info = view.getCachedLineInfo();
    try std.testing.expectEqual(@as(usize, 2), line_info.starts.len);
    try std.testing.expectEqual(@as(usize, 2), line_info.widths.len);
}

test "TextBufferView virtual lines - multi-line text without wrap" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("First line\n\nThird line with more text\n");

    // Should have 4 lines (including empty line and trailing empty line)
    try std.testing.expectEqual(@as(u32, 4), view.getVirtualLineCount());

    // Verify line info is available
    const line_info = view.getCachedLineInfo();
    try std.testing.expectEqual(@as(usize, 4), line_info.starts.len);
    try std.testing.expectEqual(@as(usize, 4), line_info.widths.len);

    // Verify the line starts are monotonically non-decreasing (empty lines have same start)
    try std.testing.expect(line_info.starts[0] == 0);
    try std.testing.expect(line_info.starts[1] >= line_info.starts[0]);
    try std.testing.expect(line_info.starts[2] >= line_info.starts[1]);
    try std.testing.expect(line_info.starts[3] >= line_info.starts[2]);
}

// ===== Line Info Consistency Tests =====

test "TextBufferView line info - line starts and widths consistency" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    view.setWrapMode(.char);
    view.setWrapWidth(7);
    const line_count = view.getVirtualLineCount();
    const line_info = view.getCachedLineInfo();

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

test "TextBufferView line info - line starts monotonically increasing" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var text_builder = std.ArrayList(u8).init(std.testing.allocator);
    defer text_builder.deinit();

    var i: u32 = 0;
    while (i < 99) : (i += 1) {
        try std.fmt.format(text_builder.writer(), "Line {}\n", .{i});
    }
    try std.fmt.format(text_builder.writer(), "Line {}", .{i});

    try tb.setText(text_builder.items);

    const line_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 100), line_count);

    const line_info = view.getCachedLineInfo();
    try std.testing.expectEqual(@as(u32, 0), line_info.starts[0]);

    // Check that line starts are monotonically increasing
    var line_idx: u32 = 1;
    while (line_idx < 100) : (line_idx += 1) {
        try std.testing.expect(line_info.starts[line_idx] >= line_info.starts[line_idx - 1]);
    }
}

// ===== Additional Edge Case Tests =====

test "TextBufferView - highlights preserved after wrap width change" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    try tb.addHighlight(0, 0, 10, 1, 0, null);

    view.setWrapMode(.char);
    view.setWrapWidth(10);

    // Highlights should still be there (they're on real lines, not virtual lines)
    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
}

test "TextBufferView - get highlights from non-existent line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 1");

    // Get highlights from line that doesn't have any
    const highlights = tb.getLineHighlights(10);
    try std.testing.expectEqual(@as(usize, 0), highlights.len);
}

test "TextBufferView - char range highlights out of bounds" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello");

    // Range extends beyond text length - should handle gracefully
    try tb.addHighlightByCharRange(3, 100, 1, 1, null);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
    try std.testing.expectEqual(@as(u32, 3), highlights[0].col_start);
}

test "TextBufferView - char range highlights invalid range" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello World");

    // Invalid range (start > end) should add no highlights
    try tb.addHighlightByCharRange(10, 5, 1, 1, null);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 0), highlights.len);
}

test "TextBufferView - char range highlights exact line boundaries" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

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

test "TextBufferView - char range highlights unicode text" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello 世界 🌟");

    // Highlight the entire text by character count
    const text_len = tb.getLength();
    try tb.addHighlightByCharRange(0, text_len, 1, 1, null);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
}

// ===== Automatic View Update Tests =====

test "TextBufferView automatic updates - view reflects buffer changes immediately" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    // Set initial text
    try tb.setText("Hello");
    try std.testing.expectEqual(@as(u32, 1), view.getVirtualLineCount());

    var buffer: [100]u8 = undefined;
    const len1 = view.getPlainTextIntoBuffer(&buffer);
    try std.testing.expectEqualStrings("Hello", buffer[0..len1]);

    // Change buffer content - view should automatically update
    try tb.setText("Hello\nWorld");
    try std.testing.expectEqual(@as(u32, 2), view.getVirtualLineCount());

    const len2 = view.getPlainTextIntoBuffer(&buffer);
    try std.testing.expectEqualStrings("Hello\nWorld", buffer[0..len2]);
}

test "TextBufferView automatic updates - multiple views update independently" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view1 = try TextBufferView.init(std.testing.allocator, tb);
    defer view1.deinit();

    var view2 = try TextBufferView.init(std.testing.allocator, tb);
    defer view2.deinit();

    // Set text - both views should see it
    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    try std.testing.expectEqual(@as(u32, 1), view1.getVirtualLineCount());
    try std.testing.expectEqual(@as(u32, 1), view2.getVirtualLineCount());

    // Set different wrap widths on each view
    view1.setWrapMode(.char);
    view1.setWrapWidth(10);
    view2.setWrapMode(.char);
    view2.setWrapWidth(5);

    // Views should have different virtual line counts
    try std.testing.expectEqual(@as(u32, 2), view1.getVirtualLineCount());
    try std.testing.expectEqual(@as(u32, 4), view2.getVirtualLineCount());

    // Change buffer - both should update automatically
    try tb.setText("Short");

    try std.testing.expectEqual(@as(u32, 1), view1.getVirtualLineCount());
    try std.testing.expectEqual(@as(u32, 1), view2.getVirtualLineCount());
}

test "TextBufferView automatic updates - view destroyed doesn't affect others" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view1 = try TextBufferView.init(std.testing.allocator, tb);
    defer view1.deinit();

    var view2 = try TextBufferView.init(std.testing.allocator, tb);

    try tb.setText("Hello");
    try std.testing.expectEqual(@as(u32, 1), view1.getVirtualLineCount());
    try std.testing.expectEqual(@as(u32, 1), view2.getVirtualLineCount());

    // Destroy view2
    view2.deinit();

    // view1 should still work and update
    try tb.setText("Hello\nWorld");
    try std.testing.expectEqual(@as(u32, 2), view1.getVirtualLineCount());
}

test "TextBufferView automatic updates - with wrapping across buffer changes" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    // Set wrap width first
    view.setWrapMode(.char);
    view.setWrapWidth(10);

    // Set text that will wrap
    try tb.setText("ABCDEFGHIJKLMNOPQRST");
    try std.testing.expectEqual(@as(u32, 2), view.getVirtualLineCount());

    const info1 = view.getCachedLineInfo();
    try std.testing.expectEqual(@as(usize, 2), info1.starts.len);

    // Change to shorter text - should update automatically
    try tb.setText("Short");
    try std.testing.expectEqual(@as(u32, 1), view.getVirtualLineCount());

    const info2 = view.getCachedLineInfo();
    try std.testing.expectEqual(@as(usize, 1), info2.starts.len);

    // Change to longer text - should update automatically
    try tb.setText("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    const vline_count = view.getVirtualLineCount();
    try std.testing.expect(vline_count >= 3);

    const info3 = view.getCachedLineInfo();
    try std.testing.expect(info3.starts.len >= 3);
}

test "TextBufferView automatic updates - reset clears content and marks views dirty" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    // Set text
    try tb.setText("Hello World");
    try std.testing.expectEqual(@as(u32, 1), view.getVirtualLineCount());

    // Reset buffer - view should automatically see cleared buffer (0 lines)
    tb.reset();
    try std.testing.expectEqual(@as(u32, 0), view.getVirtualLineCount());

    // After setText with empty string, should have 1 empty line
    try tb.setText("");
    try std.testing.expectEqual(@as(u32, 1), view.getVirtualLineCount());

    var buffer: [100]u8 = undefined;
    const len = view.getPlainTextIntoBuffer(&buffer);
    try std.testing.expectEqual(@as(usize, 0), len);
}

test "TextBufferView automatic updates - view updates work with selection" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello World");
    view.setSelection(0, 5, null, null);

    var buffer: [100]u8 = undefined;
    var len = view.getSelectedTextIntoBuffer(&buffer);
    try std.testing.expectEqualStrings("Hello", buffer[0..len]);

    // Change text - selection still works (though may be out of bounds)
    try tb.setText("Hi");

    // Get new plain text to verify update
    len = view.getPlainTextIntoBuffer(&buffer);
    try std.testing.expectEqualStrings("Hi", buffer[0..len]);
}

test "TextBufferView automatic updates - multiple views with different wrap settings" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view_nowrap = try TextBufferView.init(std.testing.allocator, tb);
    defer view_nowrap.deinit();

    var view_wrap10 = try TextBufferView.init(std.testing.allocator, tb);
    defer view_wrap10.deinit();
    view_wrap10.setWrapMode(.char);
    view_wrap10.setWrapWidth(10);

    var view_wrap5 = try TextBufferView.init(std.testing.allocator, tb);
    defer view_wrap5.deinit();
    view_wrap5.setWrapMode(.char);
    view_wrap5.setWrapWidth(5);

    // Set text that will wrap differently
    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    // Each view should reflect the text with their wrap settings
    try std.testing.expectEqual(@as(u32, 1), view_nowrap.getVirtualLineCount());
    try std.testing.expectEqual(@as(u32, 2), view_wrap10.getVirtualLineCount());
    try std.testing.expectEqual(@as(u32, 4), view_wrap5.getVirtualLineCount());

    // Update text - all views should automatically update
    try tb.setText("Short");

    try std.testing.expectEqual(@as(u32, 1), view_nowrap.getVirtualLineCount());
    try std.testing.expectEqual(@as(u32, 1), view_wrap10.getVirtualLineCount());
    try std.testing.expectEqual(@as(u32, 1), view_wrap5.getVirtualLineCount());

    // Set longer text again
    try tb.setText("ABCDEFGHIJKLMNOPQRSTUVWXYZ");

    try std.testing.expectEqual(@as(u32, 1), view_nowrap.getVirtualLineCount());
    try std.testing.expectEqual(@as(u32, 3), view_wrap10.getVirtualLineCount());
    try std.testing.expectEqual(@as(u32, 6), view_wrap5.getVirtualLineCount());
}
