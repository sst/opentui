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

test "EditBuffer - backspace at BOL removes linestart marker" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Line 1\nLine 2\nLine 3");

    // Verify we have 3 lines
    try std.testing.expectEqual(@as(u32, 3), eb.getTextBuffer().lineCount());

    // Move to start of line 2
    try eb.setCursor(1, 0);
    try eb.backspace();

    // Should merge to 2 lines
    try std.testing.expectEqual(@as(u32, 2), eb.getTextBuffer().lineCount());

    var out_buffer: [100]u8 = undefined;
    const written = eb.getTextBuffer().getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Line 1Line 2\nLine 3", out_buffer[0..written]);

    // Cursor should be at end of previous line
    const cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 6), cursor.col);
}

test "EditBuffer - deleteForward at EOL removes linestart marker" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Line 1\nLine 2\nLine 3");

    // Verify we have 3 lines
    try std.testing.expectEqual(@as(u32, 3), eb.getTextBuffer().lineCount());

    // Move to end of line 1
    try eb.setCursor(0, 6);
    try eb.deleteForward();

    // Should merge to 2 lines
    try std.testing.expectEqual(@as(u32, 2), eb.getTextBuffer().lineCount());

    var out_buffer: [100]u8 = undefined;
    const written = eb.getTextBuffer().getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Line 1Line 2\nLine 3", out_buffer[0..written]);

    // Cursor should stay at same position
    const cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 6), cursor.col);
}

test "EditBuffer - insert wide Unicode characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Insert wide characters (東京 = 4 display width, 6 bytes)
    try eb.insertText("Hello 東京 World");

    var out_buffer: [100]u8 = undefined;
    const written = eb.getTextBuffer().getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Hello 東京 World", out_buffer[0..written]);

    // Cursor should account for wide character display width
    // "Hello " = 6, "東京" = 4, " World" = 6 => total 16
    const cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 16), cursor.col);
}

test "EditBuffer - delete wide Unicode characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("ABC東京DEF");

    // "ABC" = 3 cols, "東" = 2, "京" = 2, "DEF" = 3
    // Total: 3 + 2 + 2 + 3 = 10
    // Delete from col 3 to col 7 (delete 東京)
    try eb.deleteRange(.{ .row = 0, .col = 3 }, .{ .row = 0, .col = 7 });

    var out_buffer: [100]u8 = undefined;
    const written = eb.getTextBuffer().getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("ABCDEF", out_buffer[0..written]);

    const cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 3), cursor.col);
}

test "EditBuffer - insert combining characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Insert text with combining diacritical marks (e + combining acute = é)
    try eb.insertText("Cafe\u{0301}"); // Café with combining accent

    var out_buffer: [100]u8 = undefined;
    const written = eb.getTextBuffer().getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Cafe\u{0301}", out_buffer[0..written]);

    // Cursor position should be 4 (combining mark doesn't add width)
    const cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 4), cursor.col);
}

test "EditBuffer - preserve column when moving up/down" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Create text with lines of varying lengths:
    // Line 0: "Long line here" (14 chars)
    // Line 1: "Short" (5 chars)
    // Line 2: "Another long line" (17 chars)
    try eb.insertText("Long line here\nShort\nAnother long line");

    // Move cursor to column 10 on line 0
    try eb.setCursor(0, 10);
    var cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 10), cursor.col);

    // Move down to line 1 (only 5 chars) - should clamp to end of line
    eb.moveDown();
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 1), cursor.row);
    try std.testing.expectEqual(@as(u32, 5), cursor.col); // Clamped to line end

    // Move down to line 2 (17 chars) - should restore to column 10
    eb.moveDown();
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 2), cursor.row);
    try std.testing.expectEqual(@as(u32, 10), cursor.col); // Restored to desired column!

    // Move up to line 1 again - should clamp to 5
    eb.moveUp();
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 1), cursor.row);
    try std.testing.expectEqual(@as(u32, 5), cursor.col);

    // Move up to line 0 - should restore to column 10
    eb.moveUp();
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 10), cursor.col); // Restored again!
}

test "EditBuffer - horizontal movement resets desired column" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Long line here\nShort\nAnother long line");

    // Move cursor to column 10 on line 0
    try eb.setCursor(0, 10);

    // Move down (preserves column 10)
    eb.moveDown();
    var cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 5), cursor.col); // Clamped to line 1 end

    // Move left - this should reset desired column to 4
    eb.moveLeft();
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 4), cursor.col);

    // Move down to line 2 - should go to column 4 (not 10)
    eb.moveDown();
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 2), cursor.row);
    try std.testing.expectEqual(@as(u32, 4), cursor.col); // Uses new desired column
}

test "EditBuffer - column preservation with wide characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Lines with wide characters
    // Line 0: "Hello 東京" (Hello = 5, space = 1, 東 = 2, 京 = 2, total = 10)
    // Line 1: "Hi" (2 chars)
    // Line 2: "World 世界" (World = 5, space = 1, 世 = 2, 界 = 2, total = 10)
    try eb.insertText("Hello 東京\nHi\nWorld 世界");

    // Move cursor to column 8 on line 0 (after 東)
    try eb.setCursor(0, 8);
    var cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 8), cursor.col);

    // Move down to line 1 - should clamp to 2
    eb.moveDown();
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 1), cursor.row);
    try std.testing.expectEqual(@as(u32, 2), cursor.col);

    // Move down to line 2 - should restore to column 8
    eb.moveDown();
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 2), cursor.row);
    try std.testing.expectEqual(@as(u32, 8), cursor.col); // Restored!
}
