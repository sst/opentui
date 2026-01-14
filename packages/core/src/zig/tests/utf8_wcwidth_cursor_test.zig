const std = @import("std");
const testing = std.testing;
const utf8 = @import("../utf8.zig");

test "wcwidth: cursor movement through emoji with skin tone" {
    const text = "👋🏿"; // Wave (2) + dark skin tone (2) = 4 columns total

    // getWidthAt for each codepoint
    const width_wave = utf8.getWidthAt(text, 0, 4, .wcwidth);
    try testing.expectEqual(@as(u32, 2), width_wave);

    const width_skin = utf8.getWidthAt(text, 4, 4, .wcwidth);
    try testing.expectEqual(@as(u32, 2), width_skin);

    // Total width
    const total = utf8.calculateTextWidth(text, 4, false, .wcwidth);
    try testing.expectEqual(@as(u32, 4), total);
}

test "wcwidth: cursor movement through ZWJ sequence" {
    const text = "👩‍🚀"; // Woman + ZWJ + Rocket = 4 columns (2+0+2)

    // Total width
    const total = utf8.calculateTextWidth(text, 4, false, .wcwidth);
    try testing.expectEqual(@as(u32, 4), total);

    // getWidthAt for each codepoint
    const width_woman = utf8.getWidthAt(text, 0, 4, .wcwidth);
    try testing.expectEqual(@as(u32, 2), width_woman);

    // ZWJ is at byte 4, width 0
    const width_zwj = utf8.getWidthAt(text, 4, 4, .wcwidth);
    try testing.expectEqual(@as(u32, 0), width_zwj);

    // Rocket at byte 7
    const width_rocket = utf8.getWidthAt(text, 7, 4, .wcwidth);
    try testing.expectEqual(@as(u32, 2), width_rocket);
}

test "wcwidth: cursor movement through family emoji" {
    const text = "👨‍👩‍👧"; // Man + ZWJ + Woman + ZWJ + Girl = 6 columns (2+0+2+0+2)

    const total = utf8.calculateTextWidth(text, 4, false, .wcwidth);
    try testing.expectEqual(@as(u32, 6), total);

    // Verify each codepoint's width
    const width_man = utf8.getWidthAt(text, 0, 4, .wcwidth);
    try testing.expectEqual(@as(u32, 2), width_man);

    const width_zwj1 = utf8.getWidthAt(text, 4, 4, .wcwidth);
    try testing.expectEqual(@as(u32, 0), width_zwj1);

    const width_woman = utf8.getWidthAt(text, 7, 4, .wcwidth);
    try testing.expectEqual(@as(u32, 2), width_woman);

    const width_zwj2 = utf8.getWidthAt(text, 11, 4, .wcwidth);
    try testing.expectEqual(@as(u32, 0), width_zwj2);

    const width_girl = utf8.getWidthAt(text, 14, 4, .wcwidth);
    try testing.expectEqual(@as(u32, 2), width_girl);
}

test "wcwidth: getPrevGraphemeStart through emoji with skin tone" {
    const text = "A👋🏿B"; // A(1) + 👋(2) + 🏿(2) + B(1) = 6 columns

    // From end (after B)
    const r_end = utf8.getPrevGraphemeStart(text, text.len, 4, .wcwidth);
    try testing.expect(r_end != null);
    try testing.expectEqual(@as(u32, 1), r_end.?.width); // B

    // From B
    const r_b = utf8.getPrevGraphemeStart(text, r_end.?.start_offset, 4, .wcwidth);
    try testing.expect(r_b != null);
    try testing.expectEqual(@as(u32, 2), r_b.?.width); // Skin tone

    // From skin tone
    const r_skin = utf8.getPrevGraphemeStart(text, r_b.?.start_offset, 4, .wcwidth);
    try testing.expect(r_skin != null);
    try testing.expectEqual(@as(u32, 2), r_skin.?.width); // Wave

    // From wave
    const r_wave = utf8.getPrevGraphemeStart(text, r_skin.?.start_offset, 4, .wcwidth);
    try testing.expect(r_wave != null);
    try testing.expectEqual(@as(u32, 1), r_wave.?.width); // A
}

test "wcwidth: getPrevGraphemeStart through ZWJ sequence" {
    const text = "X👩‍🚀Y"; // X(1) + 👩(2) + ZWJ(0) + 🚀(2) + Y(1) = 6 columns

    // From end (after Y)
    const r_end = utf8.getPrevGraphemeStart(text, text.len, 4, .wcwidth);
    try testing.expect(r_end != null);
    try testing.expectEqual(@as(u32, 1), r_end.?.width); // Y

    // From Y
    const r_y = utf8.getPrevGraphemeStart(text, r_end.?.start_offset, 4, .wcwidth);
    try testing.expect(r_y != null);
    try testing.expectEqual(@as(u32, 2), r_y.?.width); // Rocket

    // From rocket
    const r_rocket = utf8.getPrevGraphemeStart(text, r_y.?.start_offset, 4, .wcwidth);
    try testing.expect(r_rocket != null);
    try testing.expectEqual(@as(u32, 2), r_rocket.?.width); // Woman (ZWJ is skipped)

    // From woman
    const r_woman = utf8.getPrevGraphemeStart(text, r_rocket.?.start_offset, 4, .wcwidth);
    try testing.expect(r_woman != null);
    try testing.expectEqual(@as(u32, 1), r_woman.?.width); // X
}

test "wcwidth: findPosByWidth through emoji sequence" {
    const text = "AB👋🏿CD"; // A(1) B(1) 👋(2) 🏿(2) C(1) D(1) = 8 columns

    // include_start_before=false (selection start)
    // At col 3, we can include AB (cols 0-1) but not 👋 (cols 2-3)
    const pos_start = utf8.findPosByWidth(text, 3, 4, false, false, .wcwidth);
    try testing.expectEqual(@as(u32, 2), pos_start.byte_offset); // After AB

    // include_start_before=true (selection end)
    // At col 3, 👋 starts at col 2 which is < 3, so include it
    const pos_end = utf8.findPosByWidth(text, 3, 4, false, true, .wcwidth);
    try testing.expectEqual(@as(u32, 6), pos_end.byte_offset); // After 👋🏿
}

test "wcwidth: findWrapPosByWidth through emoji" {
    const text = "Hi👋🏿Bye"; // H(1) i(1) 👋(2) 🏿(2) B(1) y(1) e(1) = 10 columns

    // Wrap at 4 columns - should stop after "Hi👋" (cols 0-3)
    const wrap_4 = utf8.findWrapPosByWidth(text, 4, 4, false, .wcwidth);
    try testing.expectEqual(@as(u32, 6), wrap_4.byte_offset); // After "Hi👋"
    try testing.expectEqual(@as(u32, 4), wrap_4.columns_used);

    // Wrap at 5 columns - should still stop after "Hi👋" (can't fit skin tone)
    const wrap_5 = utf8.findWrapPosByWidth(text, 5, 4, false, .wcwidth);
    try testing.expectEqual(@as(u32, 6), wrap_5.byte_offset);
    try testing.expectEqual(@as(u32, 4), wrap_5.columns_used);

    // Wrap at 6 columns - should include skin tone
    const wrap_6 = utf8.findWrapPosByWidth(text, 6, 4, false, .wcwidth);
    try testing.expectEqual(@as(u32, 10), wrap_6.byte_offset); // After "Hi👋🏿"
    try testing.expectEqual(@as(u32, 6), wrap_6.columns_used);
}

test "wcwidth: combining marks have zero width" {
    const text = "e\u{0301}"; // e + combining acute

    const width_e = utf8.getWidthAt(text, 0, 4, .wcwidth);
    try testing.expectEqual(@as(u32, 1), width_e);

    const width_combining = utf8.getWidthAt(text, 1, 4, .wcwidth);
    try testing.expectEqual(@as(u32, 0), width_combining);

    const total = utf8.calculateTextWidth(text, 4, false, .wcwidth);
    try testing.expectEqual(@as(u32, 1), total);
}

test "wcwidth: CJK characters have width 2" {
    const text = "你好世界"; // 4 CJK characters

    const total = utf8.calculateTextWidth(text, 4, false, .wcwidth);
    try testing.expectEqual(@as(u32, 8), total);

    // Each character has width 2
    const width_char1 = utf8.getWidthAt(text, 0, 4, .wcwidth);
    try testing.expectEqual(@as(u32, 2), width_char1);

    const width_char2 = utf8.getWidthAt(text, 3, 4, .wcwidth);
    try testing.expectEqual(@as(u32, 2), width_char2);
}

test "wcwidth: variation selectors have zero width" {
    const text = "☺\u{FE0F}"; // Smiling face (3 bytes) + VS16 (3 bytes)

    const width_face = utf8.getWidthAt(text, 0, 4, .wcwidth);
    try testing.expectEqual(@as(u32, 1), width_face);

    // VS16 starts at byte 3
    const width_vs = utf8.getWidthAt(text, 3, 4, .wcwidth);
    try testing.expectEqual(@as(u32, 0), width_vs);

    const total = utf8.calculateTextWidth(text, 4, false, .wcwidth);
    try testing.expectEqual(@as(u32, 1), total);
}

test "wcwidth: flag emoji counts both regional indicators" {
    const text = "🇺🇸"; // US flag = two regional indicators

    const width_ri1 = utf8.getWidthAt(text, 0, 4, .wcwidth);
    try testing.expectEqual(@as(u32, 1), width_ri1);

    const width_ri2 = utf8.getWidthAt(text, 4, 4, .wcwidth);
    try testing.expectEqual(@as(u32, 1), width_ri2);

    const total = utf8.calculateTextWidth(text, 4, false, .wcwidth);
    try testing.expectEqual(@as(u32, 2), total);
}

test "wcwidth: mixed content with cursor movement" {
    const text = "A👋🏿B世C"; // A(1) 👋(2) 🏿(2) B(1) 世(2) C(1) = 9 columns

    // getPrevGraphemeStart from various positions
    const r_end = utf8.getPrevGraphemeStart(text, text.len, 4, .wcwidth);
    try testing.expect(r_end != null);
    try testing.expectEqual(@as(u32, 1), r_end.?.width); // C

    const r_cjk = utf8.getPrevGraphemeStart(text, r_end.?.start_offset, 4, .wcwidth);
    try testing.expect(r_cjk != null);
    try testing.expectEqual(@as(u32, 2), r_cjk.?.width); // 世

    const r_b = utf8.getPrevGraphemeStart(text, r_cjk.?.start_offset, 4, .wcwidth);
    try testing.expect(r_b != null);
    try testing.expectEqual(@as(u32, 1), r_b.?.width); // B

    const r_skin = utf8.getPrevGraphemeStart(text, r_b.?.start_offset, 4, .wcwidth);
    try testing.expect(r_skin != null);
    try testing.expectEqual(@as(u32, 2), r_skin.?.width); // 🏿

    const r_wave = utf8.getPrevGraphemeStart(text, r_skin.?.start_offset, 4, .wcwidth);
    try testing.expect(r_wave != null);
    try testing.expectEqual(@as(u32, 2), r_wave.?.width); // 👋

    const r_a = utf8.getPrevGraphemeStart(text, r_wave.?.start_offset, 4, .wcwidth);
    try testing.expect(r_a != null);
    try testing.expectEqual(@as(u32, 1), r_a.?.width); // A
}

test "wcwidth: findGraphemeInfo with emoji" {
    var result: std.ArrayListUnmanaged(utf8.GraphemeInfo) = .{};
    defer result.deinit(testing.allocator);

    const text = "👋🏿"; // Wave + skin tone modifier
    try utf8.findGraphemeInfo(text, 4, false, .wcwidth, testing.allocator, &result);

    // Emoji with skin tone forms a single grapheme cluster (emoji modifier base + modifier)
    try testing.expectEqual(@as(usize, 1), result.items.len);

    // The entire emoji sequence as one grapheme cluster
    try testing.expectEqual(@as(u32, 0), result.items[0].byte_offset);
    try testing.expectEqual(@as(u8, 8), result.items[0].byte_len); // 4 + 4 = 8 bytes
    try testing.expectEqual(@as(u8, 4), result.items[0].width); // 2 + 2 (wcwidth sum)
}

test "wcwidth: findGraphemeInfo with ZWJ sequence" {
    var result: std.ArrayListUnmanaged(utf8.GraphemeInfo) = .{};
    defer result.deinit(testing.allocator);

    const text = "👩‍🚀"; // Woman + ZWJ + Rocket
    try utf8.findGraphemeInfo(text, 4, false, .wcwidth, testing.allocator, &result);

    // In wcwidth mode, ZWJ sequences stay together as one cluster (for rendering)
    // The entire ZWJ sequence is treated as one grapheme cluster
    try testing.expectEqual(@as(usize, 1), result.items.len);

    // The entire ZWJ sequence as one cluster
    try testing.expectEqual(@as(u32, 0), result.items[0].byte_offset);
    try testing.expectEqual(@as(u8, 11), result.items[0].byte_len); // 4 + 3 + 4 = 11 bytes
    try testing.expectEqual(@as(u8, 4), result.items[0].width); // 2 + 0 + 2 = 4
}

test "wcwidth: findGraphemeInfo with combining marks" {
    var result: std.ArrayListUnmanaged(utf8.GraphemeInfo) = .{};
    defer result.deinit(testing.allocator);

    const text = "e\u{0301}"; // e + combining acute
    try utf8.findGraphemeInfo(text, 4, false, .wcwidth, testing.allocator, &result);

    // Should have one entry (e + combining)
    try testing.expectEqual(@as(usize, 1), result.items.len);
    try testing.expectEqual(@as(u32, 0), result.items[0].byte_offset);
    try testing.expectEqual(@as(u8, 3), result.items[0].byte_len);
    try testing.expectEqual(@as(u8, 1), result.items[0].width);
}

test "wcwidth: tab width handling" {
    const text = "A\tB"; // A + tab + B

    const total = utf8.calculateTextWidth(text, 4, false, .wcwidth);
    try testing.expectEqual(@as(u32, 6), total); // A(1) + tab(4) + B(1)

    const tab_width = utf8.getWidthAt(text, 1, 4, .wcwidth);
    try testing.expectEqual(@as(u32, 4), tab_width);
}

test "wcwidth: boundary at wide character" {
    const text = "世X"; // 世(2) X(1) = 3 columns

    // At col 2, X starts at col 2 which is at the boundary
    const pos_start = utf8.findPosByWidth(text, 2, 4, false, false, .wcwidth);
    try testing.expectEqual(@as(u32, 3), pos_start.byte_offset); // After 世
    try testing.expectEqual(@as(u32, 2), pos_start.columns_used);

    // With include_start_before=true, X starts at col 2 which is at boundary (>= max_columns)
    // So it stops BEFORE X, returning position after 世
    const pos_end = utf8.findPosByWidth(text, 2, 4, false, true, .wcwidth);
    try testing.expectEqual(@as(u32, 3), pos_end.byte_offset); // After 世, not X
    try testing.expectEqual(@as(u32, 2), pos_end.columns_used);

    // At col 3, X starts at col 2 which is < 3, so it should be included
    const pos_3 = utf8.findPosByWidth(text, 3, 4, false, true, .wcwidth);
    try testing.expectEqual(@as(u32, 4), pos_3.byte_offset); // After X
    try testing.expectEqual(@as(u32, 3), pos_3.columns_used);
}
