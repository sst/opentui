const std = @import("std");
const edit_buffer = @import("../edit-buffer.zig");
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const gp = @import("../grapheme.zig");

const EditBuffer = edit_buffer.EditBuffer;
const TextBufferView = text_buffer_view.TextBufferView;
const Cursor = edit_buffer.Cursor;

test "EditBuffer - init and deinit" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Should have empty buffer and one cursor at (0, 0)
    try std.testing.expectEqual(@as(u32, 0), eb.getTextBuffer().getLength());
    const cursor = eb.getCursor(0);
    try std.testing.expect(cursor != null);
    try std.testing.expectEqual(@as(u32, 0), cursor.?.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.?.col);
}

test "EditBuffer - insert single line at start" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello");

    // Verify text was inserted
    var out_buffer: [100]u8 = undefined;
    const written = eb.getTextBuffer().getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Hello", out_buffer[0..written]);

    // Cursor should be at end of text
    const cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 5), cursor.col);
}

test "EditBuffer - insert at middle of line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("HelloWorld");
    try eb.setCursor(0, 5);
    try eb.insertText(" ");

    var out_buffer: [100]u8 = undefined;
    const written = eb.getTextBuffer().getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Hello World", out_buffer[0..written]);

    const cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 6), cursor.col);
}

test "EditBuffer - insert multi-line text" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Line 1\nLine 2\nLine 3");

    var out_buffer: [100]u8 = undefined;
    const written = eb.getTextBuffer().getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Line 1\nLine 2\nLine 3", out_buffer[0..written]);

    // Should have 3 lines
    try std.testing.expectEqual(@as(u32, 3), eb.getTextBuffer().lineCount());

    // Cursor should be on last line
    const cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 2), cursor.row);
    try std.testing.expectEqual(@as(u32, 6), cursor.col);
}

test "EditBuffer - cursor movement" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Line 1\nLine 2");
    try eb.setCursor(0, 3);

    var cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 3), cursor.col);

    eb.moveRight();
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 4), cursor.col);

    eb.moveLeft();
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 3), cursor.col);

    eb.moveDown();
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 1), cursor.row);

    eb.moveUp();
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
}

test "EditBuffer - verify text buffer integration" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello\nWorld");

    // Verify underlying TextBuffer state
    const text_buf = eb.getTextBuffer();
    try std.testing.expectEqual(@as(u32, 2), text_buf.lineCount());

    var out_buffer: [100]u8 = undefined;
    const written = text_buf.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Hello\nWorld", out_buffer[0..written]);
}

test "EditBuffer - delete within line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello World");
    try eb.deleteRange(.{ .row = 0, .col = 5 }, .{ .row = 0, .col = 11 });

    var out_buffer: [100]u8 = undefined;
    const written = eb.getTextBuffer().getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Hello", out_buffer[0..written]);

    const cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 5), cursor.col);
}

test "EditBuffer - delete across lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Line 1\nLine 2\nLine 3");
    try eb.deleteRange(.{ .row = 0, .col = 5 }, .{ .row = 2, .col = 2 });

    var out_buffer: [100]u8 = undefined;
    const written = eb.getTextBuffer().getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Line ne 3", out_buffer[0..written]);

    try std.testing.expectEqual(@as(u32, 1), eb.getTextBuffer().lineCount());
}

test "EditBuffer - backspace at middle of line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello");
    try eb.backspace();

    var out_buffer: [100]u8 = undefined;
    const written = eb.getTextBuffer().getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Hell", out_buffer[0..written]);

    const cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 4), cursor.col);
}

test "EditBuffer - backspace at start of line merges with previous" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello\nWorld");
    try eb.setCursor(1, 0);
    try eb.backspace();

    var out_buffer: [100]u8 = undefined;
    const written = eb.getTextBuffer().getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("HelloWorld", out_buffer[0..written]);

    try std.testing.expectEqual(@as(u32, 1), eb.getTextBuffer().lineCount());
    const cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 5), cursor.col);
}

test "EditBuffer - deleteForward at middle of line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello");
    try eb.setCursor(0, 0);
    try eb.deleteForward();

    var out_buffer: [100]u8 = undefined;
    const written = eb.getTextBuffer().getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("ello", out_buffer[0..written]);

    const cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.col);
}

test "EditBuffer - deleteForward at end of line merges with next" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello\nWorld");
    try eb.setCursor(0, 5);
    try eb.deleteForward();

    var out_buffer: [100]u8 = undefined;
    const written = eb.getTextBuffer().getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("HelloWorld", out_buffer[0..written]);

    try std.testing.expectEqual(@as(u32, 1), eb.getTextBuffer().lineCount());
}

test "EditBuffer - insert in middle of long line with wrap offsets" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Insert a long line with many wrap break points (spaces, punctuation)
    const long_text = "This is a very long line with many words, punctuation! And more text to create wrap offsets.";
    try eb.insertText(long_text);

    // Insert text near the end (exercises wrap offset optimization in splitChunkAtWeight)
    try eb.setCursor(0, 80);
    try eb.insertText(" [INSERTED]");

    var out_buffer: [200]u8 = undefined;
    const written = eb.getTextBuffer().getPlainTextIntoBuffer(&out_buffer);

    // Verify insertion happened correctly
    try std.testing.expect(written > long_text.len);
    try std.testing.expect(std.mem.indexOf(u8, out_buffer[0..written], "[INSERTED]") != null);
}

test "EditBuffer - delete range in long line with wrap offsets" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Insert a long line with many wrap break points
    const long_text = "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.";
    try eb.insertText(long_text);

    // Delete a range in the middle (exercises wrap offset optimization)
    try eb.deleteRange(.{ .row = 0, .col = 20 }, .{ .row = 0, .col = 60 });

    var out_buffer: [200]u8 = undefined;
    const written = eb.getTextBuffer().getPlainTextIntoBuffer(&out_buffer);
    const result = out_buffer[0..written];

    // Verify deletion happened correctly
    try std.testing.expect(result.len < long_text.len);
    try std.testing.expect(std.mem.startsWith(u8, result, "The quick brown fox "));
}
