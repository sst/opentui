const std = @import("std");
const testing = std.testing;
const utf8 = @import("../utf8.zig");

// ============================================================================
// WCWIDTH-SPECIFIC TESTS
// These tests verify wcwidth mode behavior where each codepoint is treated
// as a separate character (tmux-style), vs unicode mode where grapheme
// clusters are treated as single units.
// ============================================================================

// ============================================================================
// GRAPHEME INFO TESTS - WCWIDTH MODE
// ============================================================================

test "findGraphemeInfo wcwidth: empty string" {
    var result = std.ArrayList(utf8.GraphemeInfo).init(testing.allocator);
    defer result.deinit();

    try utf8.findGraphemeInfo("", 4, true, .wcwidth, &result);
    try testing.expectEqual(@as(usize, 0), result.items.len);
}

test "findGraphemeInfo wcwidth: ASCII-only returns empty" {
    var result = std.ArrayList(utf8.GraphemeInfo).init(testing.allocator);
    defer result.deinit();

    try utf8.findGraphemeInfo("hello world", 4, true, .wcwidth, &result);
    try testing.expectEqual(@as(usize, 0), result.items.len);
}

test "findGraphemeInfo wcwidth: ASCII with tab" {
    var result = std.ArrayList(utf8.GraphemeInfo).init(testing.allocator);
    defer result.deinit();

    try utf8.findGraphemeInfo("hello\tworld", 4, false, .wcwidth, &result);

    // Should have one entry for the tab
    try testing.expectEqual(@as(usize, 1), result.items.len);
    try testing.expectEqual(@as(u32, 5), result.items[0].byte_offset);
    try testing.expectEqual(@as(u8, 1), result.items[0].byte_len);
    try testing.expectEqual(@as(u8, 4), result.items[0].width);
    try testing.expectEqual(@as(u32, 5), result.items[0].col_offset);
}

test "findGraphemeInfo wcwidth: CJK characters" {
    var result = std.ArrayList(utf8.GraphemeInfo).init(testing.allocator);
    defer result.deinit();

    const text = "hello世界";
    try utf8.findGraphemeInfo(text, 4, false, .wcwidth, &result);

    // Should have two entries for the CJK characters (each codepoint separately)
    try testing.expectEqual(@as(usize, 2), result.items.len);

    // First CJK char '世' at byte 5
    try testing.expectEqual(@as(u32, 5), result.items[0].byte_offset);
    try testing.expectEqual(@as(u8, 3), result.items[0].byte_len);
    try testing.expectEqual(@as(u8, 2), result.items[0].width);
    try testing.expectEqual(@as(u32, 5), result.items[0].col_offset);

    // Second CJK char '界' at byte 8
    try testing.expectEqual(@as(u32, 8), result.items[1].byte_offset);
    try testing.expectEqual(@as(u8, 3), result.items[1].byte_len);
    try testing.expectEqual(@as(u8, 2), result.items[1].width);
    try testing.expectEqual(@as(u32, 7), result.items[1].col_offset);
}

test "findGraphemeInfo wcwidth: emoji with skin tone - each codepoint separate" {
    var result = std.ArrayList(utf8.GraphemeInfo).init(testing.allocator);
    defer result.deinit();

    const text = "👋🏿"; // Wave (4 bytes) + skin tone modifier (4 bytes)
    try utf8.findGraphemeInfo(text, 4, false, .wcwidth, &result);

    // In wcwidth mode, these are TWO separate codepoints
    try testing.expectEqual(@as(usize, 2), result.items.len);

    // First codepoint: wave emoji
    try testing.expectEqual(@as(u32, 0), result.items[0].byte_offset);
    try testing.expectEqual(@as(u8, 4), result.items[0].byte_len);
    try testing.expectEqual(@as(u8, 2), result.items[0].width);

    // Second codepoint: skin tone modifier
    try testing.expectEqual(@as(u32, 4), result.items[1].byte_offset);
    try testing.expectEqual(@as(u8, 4), result.items[1].byte_len);
    try testing.expectEqual(@as(u8, 2), result.items[1].width);
}

test "findGraphemeInfo wcwidth: emoji with ZWJ - each codepoint separate" {
    var result = std.ArrayList(utf8.GraphemeInfo).init(testing.allocator);
    defer result.deinit();

    const text = "👩‍🚀"; // Woman + ZWJ + Rocket
    try utf8.findGraphemeInfo(text, 4, false, .wcwidth, &result);

    // In wcwidth mode, we see woman (width 2) and rocket (width 2)
    // ZWJ has width 0 so it's not in the list
    try testing.expectEqual(@as(usize, 2), result.items.len);
}

test "findGraphemeInfo wcwidth: combining mark - base and mark separate" {
    var result = std.ArrayList(utf8.GraphemeInfo).init(testing.allocator);
    defer result.deinit();

    const text = "e\u{0301}test"; // e + combining acute accent
    try utf8.findGraphemeInfo(text, 4, false, .wcwidth, &result);

    // In wcwidth mode, combining mark is a separate codepoint with width 0
    // So we don't see it in the results (only non-zero width codepoints)
    // We only see 'e' (ASCII, not included) and no combining mark
    try testing.expectEqual(@as(usize, 0), result.items.len);
}

test "findGraphemeInfo wcwidth vs unicode: emoji with skin tone" {
    var result_wcwidth = std.ArrayList(utf8.GraphemeInfo).init(testing.allocator);
    defer result_wcwidth.deinit();
    var result_unicode = std.ArrayList(utf8.GraphemeInfo).init(testing.allocator);
    defer result_unicode.deinit();

    const text = "Hi👋🏿Bye";

    try utf8.findGraphemeInfo(text, 4, false, .wcwidth, &result_wcwidth);
    try utf8.findGraphemeInfo(text, 4, false, .unicode, &result_unicode);

    // wcwidth: 2 codepoints (wave + skin tone)
    try testing.expectEqual(@as(usize, 2), result_wcwidth.items.len);

    // unicode: 1 grapheme cluster
    try testing.expectEqual(@as(usize, 1), result_unicode.items.len);
    try testing.expectEqual(@as(u32, 2), result_unicode.items[0].byte_offset);
    try testing.expectEqual(@as(u8, 8), result_unicode.items[0].byte_len); // Both codepoints
}

test "findGraphemeInfo wcwidth vs unicode: flag emoji" {
    var result_wcwidth = std.ArrayList(utf8.GraphemeInfo).init(testing.allocator);
    defer result_wcwidth.deinit();
    var result_unicode = std.ArrayList(utf8.GraphemeInfo).init(testing.allocator);
    defer result_unicode.deinit();

    const text = "🇺🇸"; // US flag (two regional indicators)

    try utf8.findGraphemeInfo(text, 4, false, .wcwidth, &result_wcwidth);
    try utf8.findGraphemeInfo(text, 4, false, .unicode, &result_unicode);

    // wcwidth: 2 codepoints (two regional indicators, each width 1)
    try testing.expectEqual(@as(usize, 2), result_wcwidth.items.len);
    try testing.expectEqual(@as(u8, 1), result_wcwidth.items[0].width);
    try testing.expectEqual(@as(u8, 1), result_wcwidth.items[1].width);

    // unicode: 1 grapheme cluster (flag, width 2)
    try testing.expectEqual(@as(usize, 1), result_unicode.items.len);
    try testing.expectEqual(@as(u8, 2), result_unicode.items[0].width);
}

// ============================================================================
// WIDTH CALCULATION TESTS - WCWIDTH MODE
// ============================================================================

test "getWidthAt wcwidth: combining mark has zero width" {
    const text = "e\u{0301}"; // e + combining acute accent

    // In wcwidth mode, combining mark is a separate codepoint
    const width_e = utf8.getWidthAt(text, 0, 8, .wcwidth);
    try testing.expectEqual(@as(u32, 1), width_e); // Just 'e'

    const width_combining = utf8.getWidthAt(text, 1, 8, .wcwidth);
    try testing.expectEqual(@as(u32, 0), width_combining); // Combining mark has width 0
}

test "calculateTextWidth wcwidth: emoji with skin tone counts both codepoints" {
    const text = "👋🏿"; // Wave + dark skin tone

    const width_wcwidth = utf8.calculateTextWidth(text, 4, false, .wcwidth);
    const width_unicode = utf8.calculateTextWidth(text, 4, false, .unicode);

    // wcwidth: counts both codepoints (2 + 2 = 4)
    try testing.expectEqual(@as(u32, 4), width_wcwidth);

    // unicode: single grapheme cluster (width 2)
    try testing.expectEqual(@as(u32, 2), width_unicode);
}

test "calculateTextWidth wcwidth: flag emoji counts both RIs" {
    const text = "🇺🇸"; // US flag

    const width_wcwidth = utf8.calculateTextWidth(text, 4, false, .wcwidth);
    const width_unicode = utf8.calculateTextWidth(text, 4, false, .unicode);

    // wcwidth: counts both regional indicators (1 + 1 = 2)
    try testing.expectEqual(@as(u32, 2), width_wcwidth);

    // unicode: single flag grapheme (width 2)
    try testing.expectEqual(@as(u32, 2), width_unicode);
}
