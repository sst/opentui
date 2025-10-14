const std = @import("std");
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const buffer = @import("../buffer.zig");
const gp = @import("../grapheme.zig");

const TextBuffer = text_buffer.TextBuffer;
const TextBufferView = text_buffer_view.TextBufferView;
const RGBA = text_buffer.RGBA;

test "Selection - basic selection without wrap" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello World");

    _ = view.setLocalSelection(2, 0, 7, 0, null, null);

    const packed_info = view.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);

    const start = @as(u32, @intCast(packed_info >> 32));
    const end = @as(u32, @intCast(packed_info & 0xFFFFFFFF));
    try std.testing.expectEqual(@as(u32, 2), start);
    try std.testing.expectEqual(@as(u32, 7), end);
}

test "Selection - with wrapped lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    view.setWrapWidth(10);

    try std.testing.expectEqual(@as(u32, 2), view.getVirtualLineCount());

    _ = view.setLocalSelection(5, 0, 5, 1, null, null);

    const packed_info = view.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);

    const start = @as(u32, @intCast(packed_info >> 32));
    const end = @as(u32, @intCast(packed_info & 0xFFFFFFFF));
    try std.testing.expectEqual(@as(u32, 5), start);
    try std.testing.expectEqual(@as(u32, 15), end);
}

test "Selection - no selection returns all bits set" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello World");

    const packed_info = view.packSelectionInfo();
    try std.testing.expectEqual(@as(u64, 0xFFFFFFFF_FFFFFFFF), packed_info);
}

test "Selection - with newline characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 1\nLine 2\nLine 3");

    _ = view.setLocalSelection(2, 1, 4, 2, null, null);

    const packed_info = view.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);

    var out_buffer: [100]u8 = undefined;
    const len = view.getSelectedTextIntoBuffer(&out_buffer);
    const text = out_buffer[0..len];

    try std.testing.expect(std.mem.indexOf(u8, text, "ne 2") != null);
    try std.testing.expect(std.mem.indexOf(u8, text, "\n") != null);
}

test "Selection - across empty lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 1\nLine 2\n\nLine 4");

    _ = view.setLocalSelection(0, 0, 2, 2, null, null);

    const packed_info = view.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);

    const start = @as(u32, @intCast(packed_info >> 32));
    const end = @as(u32, @intCast(packed_info & 0xFFFFFFFF));
    try std.testing.expectEqual(@as(u32, 0), start);
    try std.testing.expectEqual(@as(u32, 12), end);
}

test "Selection - ending in empty line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 1\n\nLine 3");

    _ = view.setLocalSelection(0, 0, 3, 1, null, null);

    const packed_info = view.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);

    const start = @as(u32, @intCast(packed_info >> 32));
    try std.testing.expectEqual(@as(u32, 0), start);
}

test "Selection - spanning multiple lines completely" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("First\nSecond\nThird");

    _ = view.setLocalSelection(0, 1, 6, 1, null, null);

    var out_buffer: [100]u8 = undefined;
    const len = view.getSelectedTextIntoBuffer(&out_buffer);
    const text = out_buffer[0..len];

    try std.testing.expectEqualStrings("Second", text);
}

test "Selection - including multiple line breaks" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("A\nB\nC\nD");

    _ = view.setLocalSelection(0, 1, 1, 2, null, null);

    var out_buffer: [100]u8 = undefined;
    const len = view.getSelectedTextIntoBuffer(&out_buffer);
    const text = out_buffer[0..len];

    try std.testing.expect(std.mem.indexOf(u8, text, "\n") != null);
    try std.testing.expect(std.mem.indexOf(u8, text, "B") != null);
    try std.testing.expect(std.mem.indexOf(u8, text, "C") != null);
}

test "Selection - at line boundaries" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line1\nLine2\nLine3");

    _ = view.setLocalSelection(4, 0, 2, 1, null, null);

    var out_buffer: [100]u8 = undefined;
    const len = view.getSelectedTextIntoBuffer(&out_buffer);
    const text = out_buffer[0..len];

    try std.testing.expect(std.mem.indexOf(u8, text, "1") != null);
    try std.testing.expect(std.mem.indexOf(u8, text, "\n") != null);
    try std.testing.expect(std.mem.indexOf(u8, text, "Li") != null);
}

test "Selection - empty text" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("");

    _ = view.setLocalSelection(0, 0, 0, 0, null, null);

    const packed_info = view.packSelectionInfo();
    try std.testing.expectEqual(@as(u64, 0xFFFFFFFF_FFFFFFFF), packed_info);
}

test "Selection - single character" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("A");

    _ = view.setLocalSelection(0, 0, 1, 0, null, null);

    const packed_info = view.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);

    const start = @as(u32, @intCast(packed_info >> 32));
    const end = @as(u32, @intCast(packed_info & 0xFFFFFFFF));
    try std.testing.expectEqual(@as(u32, 0), start);
    try std.testing.expectEqual(@as(u32, 1), end);

    var out_buffer: [100]u8 = undefined;
    const len = view.getSelectedTextIntoBuffer(&out_buffer);
    const text = out_buffer[0..len];
    try std.testing.expectEqualStrings("A", text);
}

test "Selection - zero-width selection" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello World");

    _ = view.setLocalSelection(5, 0, 5, 0, null, null);

    const packed_info = view.packSelectionInfo();
    try std.testing.expectEqual(@as(u64, 0xFFFFFFFF_FFFFFFFF), packed_info);
}

test "Selection - beyond text bounds" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hi");

    _ = view.setLocalSelection(0, 0, 10, 0, null, null);

    const packed_info = view.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);

    const start = @as(u32, @intCast(packed_info >> 32));
    const end = @as(u32, @intCast(packed_info & 0xFFFFFFFF));
    try std.testing.expectEqual(@as(u32, 0), start);
    try std.testing.expectEqual(@as(u32, 2), end);
}

test "Selection - clear selection" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello World");

    _ = view.setLocalSelection(0, 0, 5, 0, null, null);
    var packed_info = view.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);

    view.resetLocalSelection();
    packed_info = view.packSelectionInfo();
    try std.testing.expectEqual(@as(u64, 0xFFFFFFFF_FFFFFFFF), packed_info);
}

test "Selection - at wrap boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    view.setWrapWidth(10);

    _ = view.setLocalSelection(9, 0, 1, 1, null, null);

    const packed_info = view.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);

    const start = @as(u32, @intCast(packed_info >> 32));
    const end = @as(u32, @intCast(packed_info & 0xFFFFFFFF));
    try std.testing.expectEqual(@as(u32, 9), start);
    try std.testing.expectEqual(@as(u32, 11), end);
}

test "Selection - spanning multiple wrapped lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123");

    view.setWrapWidth(10);
    try std.testing.expectEqual(@as(u32, 3), view.getVirtualLineCount());

    _ = view.setLocalSelection(2, 0, 8, 2, null, null);

    const packed_info = view.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);

    const start = @as(u32, @intCast(packed_info >> 32));
    const end = @as(u32, @intCast(packed_info & 0xFFFFFFFF));
    try std.testing.expectEqual(@as(u32, 2), start);
    try std.testing.expectEqual(@as(u32, 28), end);
}

test "Selection - changes when wrap width changes" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRST");

    view.setWrapWidth(10);
    _ = view.setLocalSelection(5, 0, 5, 1, null, null);

    var packed_info = view.packSelectionInfo();
    var start = @as(u32, @intCast(packed_info >> 32));
    var end = @as(u32, @intCast(packed_info & 0xFFFFFFFF));
    try std.testing.expectEqual(@as(u32, 5), start);
    try std.testing.expectEqual(@as(u32, 15), end);

    view.setWrapWidth(5);
    _ = view.setLocalSelection(5, 0, 5, 1, null, null);

    packed_info = view.packSelectionInfo();
    start = @as(u32, @intCast(packed_info >> 32));
    end = @as(u32, @intCast(packed_info & 0xFFFFFFFF));

    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);
}

test "Selection - with newlines and wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNO\nPQRSTUVWXYZ");

    view.setWrapWidth(10);

    const vline_count = view.getVirtualLineCount();
    try std.testing.expect(vline_count >= 3);

    _ = view.setLocalSelection(5, 0, 5, 2, null, null);

    const packed_info = view.packSelectionInfo();
    try std.testing.expect(packed_info != 0xFFFFFFFF_FFFFFFFF);
}

test "Selection - getSelectedText simple" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello World");
    view.setSelection(6, 11, null, null);

    var out_buffer: [100]u8 = undefined;
    const len = view.getSelectedTextIntoBuffer(&out_buffer);
    const text = out_buffer[0..len];

    try std.testing.expectEqualStrings("World", text);
}

test "Selection - getSelectedText with newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 1\nLine 2\nLine 3");
    view.setSelection(0, 9, null, null);

    var out_buffer: [100]u8 = undefined;
    const len = view.getSelectedTextIntoBuffer(&out_buffer);
    const text = out_buffer[0..len];

    try std.testing.expectEqualStrings("Line 1\nLin", text);
}

test "Selection - spanning multiple lines with getSelectedText" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Red\nBlue");
    view.setSelection(2, 5, null, null);

    var out_buffer: [100]u8 = undefined;
    const len = view.getSelectedTextIntoBuffer(&out_buffer);
    const text = out_buffer[0..len];

    try std.testing.expectEqualStrings("d\nBl", text);
}

test "Selection - with graphemes" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello 🌍 World");

    view.setSelection(0, 8, null, null);

    var out_buffer: [100]u8 = undefined;
    const len = view.getSelectedTextIntoBuffer(&out_buffer);
    const text = out_buffer[0..len];

    try std.testing.expect(std.mem.indexOf(u8, text, "Hello") != null);
    try std.testing.expect(std.mem.indexOf(u8, text, "🌍") != null);
}
