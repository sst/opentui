const std = @import("std");
const edit_buffer = @import("../edit-buffer.zig");
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const gp = @import("../grapheme.zig");
const iter_mod = @import("../text-buffer-iterators.zig");

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

test "EditBuffer - cursor movement at boundaries" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Line 1\nLine 2\nLine 3");

    // Test left at start of line
    try eb.setCursor(1, 0);
    eb.moveLeft();
    var cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row); // Moved to previous line
    try std.testing.expectEqual(@as(u32, 6), cursor.col); // At end of "Line 1"

    // Test left at start of buffer
    try eb.setCursor(0, 0);
    eb.moveLeft();
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row); // Stays at first line
    try std.testing.expectEqual(@as(u32, 0), cursor.col); // Stays at column 0

    // Test right at end of line
    try eb.setCursor(0, 6);
    eb.moveRight();
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 1), cursor.row); // Moved to next line
    try std.testing.expectEqual(@as(u32, 0), cursor.col); // At start of line

    // Test right at end of buffer
    try eb.setCursor(2, 6);
    eb.moveRight();
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 2), cursor.row); // Stays at last line
    try std.testing.expectEqual(@as(u32, 6), cursor.col); // Stays at end

    // Test up at first line
    try eb.setCursor(0, 3);
    eb.moveUp();
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row); // Stays at first line

    // Test down at last line
    try eb.setCursor(2, 3);
    eb.moveDown();
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 2), cursor.row); // Stays at last line
}

test "EditBuffer - cursor movement on empty lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Create text with empty lines
    try eb.insertText("Line 1\n\nLine 3");

    // Move to empty line (line 1)
    try eb.setCursor(1, 0);
    var cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 1), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);

    // Try to move right on empty line - should stay at 0
    eb.moveRight();
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 2), cursor.row); // Moved to next line
    try std.testing.expectEqual(@as(u32, 0), cursor.col);

    // Try to move left from start of line after empty
    eb.moveLeft();
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 1), cursor.row); // Back to empty line
    try std.testing.expectEqual(@as(u32, 0), cursor.col);
}

test "EditBuffer - cursor movement after editing resets desired column" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Long line here\nMid\nAnother long line");

    // Set cursor to column 10, move down through short line
    try eb.setCursor(0, 10);
    eb.moveDown();
    var cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 1), cursor.row);
    try std.testing.expectEqual(@as(u32, 3), cursor.col); // Clamped to "Mid" length

    // Move right - this should reset desired column
    eb.moveRight();
    cursor = eb.getCursor(0).?;
    // After moving right at end of line, we're at start of next line
    try std.testing.expectEqual(@as(u32, 2), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);

    // Now move up - should use column 0, not the original 10
    eb.moveUp();
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 1), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col); // Uses new desired column (0, not 10)
}

test "EditBuffer - cursor wrapping at line boundaries" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("ABC\nDEF\nGHI");

    // Start at end of first line
    try eb.setCursor(0, 3);
    var cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 3), cursor.col);

    // Move right - should wrap to next line
    eb.moveRight();
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 1), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);

    // Move left - should wrap back to previous line end
    eb.moveLeft();
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 3), cursor.col);
}

test "EditBuffer - insert newline on empty line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Create text with multiple empty lines in the middle
    try eb.insertText("Line 1\n\n\n\nLine 5");

    var out_buffer: [100]u8 = undefined;
    var written = eb.getTextBuffer().getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Line 1\n\n\n\nLine 5", out_buffer[0..written]);

    // Position cursor on empty line 2 (0-indexed, so row 2)
    try eb.setCursor(2, 0);
    var cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 2), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);

    // Insert a newline (simulating Enter key)
    try eb.insertText("\n");

    // Cursor should now be on line 3, column 0 (the new empty line we just created)
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 3), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);

    // Verify the text is correct (added one more empty line)
    written = eb.getTextBuffer().getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Line 1\n\n\n\n\nLine 5", out_buffer[0..written]);

    // Verify line count increased by 1
    try std.testing.expectEqual(@as(u32, 6), eb.getTextBuffer().lineCount());
}

test "EditBuffer - setText clears and sets new content" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Insert some initial text
    try eb.insertText("Old content\nTo be replaced");
    try std.testing.expectEqual(@as(u32, 2), eb.getTextBuffer().lineCount());

    // Set new text
    try eb.setText("New content\nLine 2\nLine 3");

    // Verify old content is gone and new content is present
    var out_buffer: [100]u8 = undefined;
    const written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("New content\nLine 2\nLine 3", out_buffer[0..written]);

    // Verify line count
    try std.testing.expectEqual(@as(u32, 3), eb.getTextBuffer().lineCount());

    // Verify cursor is reset to (0, 0)
    const cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);
}

test "EditBuffer - setText with empty string" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Insert some text first
    try eb.insertText("Some text");

    // Set to empty
    try eb.setText("");

    var out_buffer: [100]u8 = undefined;
    const written = eb.getText(&out_buffer);
    try std.testing.expectEqual(@as(usize, 0), written);

    // Should have 1 empty line
    try std.testing.expectEqual(@as(u32, 1), eb.getTextBuffer().lineCount());

    // Cursor at (0, 0)
    const cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);
}

test "EditBuffer - getText returns correct content" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    const test_text = "Hello\nWorld\nFrom\nEditBuffer";
    try eb.insertText(test_text);

    var out_buffer: [100]u8 = undefined;
    const written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings(test_text, out_buffer[0..written]);
}

test "EditBuffer - deleteLine removes current line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Line 1\nLine 2\nLine 3\nLine 4");
    try std.testing.expectEqual(@as(u32, 4), eb.getTextBuffer().lineCount());

    // Delete line 2 (0-indexed: line 1)
    try eb.setCursor(1, 3);
    try eb.deleteLine();

    var out_buffer: [100]u8 = undefined;
    const written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("Line 1\nLine 3\nLine 4", out_buffer[0..written]);

    try std.testing.expectEqual(@as(u32, 3), eb.getTextBuffer().lineCount());

    // Cursor should be at start of the line that moved up
    const cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 1), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);
}

test "EditBuffer - deleteLine on first line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Line 1\nLine 2\nLine 3");
    try eb.setCursor(0, 0);
    try eb.deleteLine();

    var out_buffer: [100]u8 = undefined;
    const written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("Line 2\nLine 3", out_buffer[0..written]);

    try std.testing.expectEqual(@as(u32, 2), eb.getTextBuffer().lineCount());
}

test "EditBuffer - deleteLine on last line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Line 1\nLine 2\nLine 3");
    try std.testing.expectEqual(@as(u32, 3), eb.getTextBuffer().lineCount());

    try eb.setCursor(2, 0);
    try eb.deleteLine();

    try std.testing.expectEqual(@as(u32, 2), eb.getTextBuffer().lineCount());

    var out_buffer: [100]u8 = undefined;
    const written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("Line 1\nLine 2", out_buffer[0..written]);
}

test "EditBuffer - setCursor to move to line start" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello World\nAnother Line");

    // Position cursor in the middle of line 1
    try eb.setCursor(1, 8);
    var cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 1), cursor.row);
    try std.testing.expectEqual(@as(u32, 8), cursor.col);

    // Move to line start using setCursor
    try eb.setCursor(cursor.row, 0);
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 1), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);

    // Move to line 0 and do it again
    try eb.setCursor(0, 5);
    cursor = eb.getCursor(0).?;
    try eb.setCursor(cursor.row, 0);
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);
}

test "EditBuffer - gotoLine moves to specified line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4");

    // Start at line 0
    var cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 4), cursor.row); // Cursor is at end after insert

    // Go to line 2
    try eb.gotoLine(2);
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 2), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);

    // Go to line 0
    try eb.gotoLine(0);
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);

    // Go to last line
    try eb.gotoLine(4);
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 4), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);
}

test "EditBuffer - gotoLine clamps to valid range" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Line 0\nLine 1\nLine 2");

    // Try to go to line 100 (out of bounds)
    try eb.gotoLine(100);
    const cursor = eb.getCursor(0).?;
    // Should clamp to last line (line 2) and go to end of that line
    try std.testing.expectEqual(@as(u32, 2), cursor.row);
    try std.testing.expectEqual(@as(u32, 6), cursor.col); // "Line 2" has 6 characters
}

test "EditBuffer - getCursorPosition returns correct info" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello\nWorld\nFrom\nZig");

    // Move to a specific position
    try eb.setCursor(2, 3);

    const pos = eb.getCursorPosition();
    try std.testing.expectEqual(@as(u32, 2), pos.line);
    try std.testing.expectEqual(@as(u32, 3), pos.visual_col);
}

test "EditBuffer - getCursorPosition with wide characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // "東京" has 4 display width but 6 bytes
    try eb.insertText("Hello 東京 World");
    try eb.setCursor(0, 10); // After "東京 "

    const pos = eb.getCursorPosition();
    try std.testing.expectEqual(@as(u32, 0), pos.line);
    try std.testing.expectEqual(@as(u32, 10), pos.visual_col);
}

test "EditBuffer - setText followed by insertText" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // This test verifies that setText properly re-registers the AddBuffer
    // (without allocating new memory) so that subsequent insertText operations
    // don't crash (the original bug). The exact text manipulation behavior
    // is tested by the TypeScript tests.

    // Set initial text
    try eb.setText("Line 1\nLine 2\nLine 3");
    try std.testing.expectEqual(@as(u32, 3), eb.getTextBuffer().lineCount());

    // Verify setText worked
    var out_buffer: [100]u8 = undefined;
    var written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("Line 1\nLine 2\nLine 3", out_buffer[0..written]);

    // Move to start of last line (different from TypeScript test which uses gotoLine)
    try eb.setCursor(0, 0);

    // Insert some text - this should NOT crash after setText
    try eb.insertText("X");

    // Verify insertion worked
    written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("XLine 1\nLine 2\nLine 3", out_buffer[0..written]);
}

test "EditBuffer - backspace on third line with empty middle line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Create 3 lines: [text, empty, text]
    try eb.insertText("First\n\nThird");

    var out_buffer: [100]u8 = undefined;
    var written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("First\n\nThird", out_buffer[0..written]);
    try std.testing.expectEqual(@as(u32, 3), eb.getTextBuffer().lineCount());

    // Position cursor on third line at column 5 (end of "Third")
    try eb.setCursor(2, 5);
    var cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 2), cursor.row);
    try std.testing.expectEqual(@as(u32, 5), cursor.col);

    // Backspace once - should delete 'd' and cursor should be at col 4
    try eb.backspace();
    cursor = eb.getCursor(0).?;
    written = eb.getText(&out_buffer);
    try std.testing.expectEqual(@as(u32, 2), cursor.row);
    try std.testing.expectEqual(@as(u32, 4), cursor.col);
    try std.testing.expectEqualStrings("First\n\nThir", out_buffer[0..written]);

    // Continue backspacing through "Thir"
    try eb.backspace();
    try eb.backspace();
    try eb.backspace();

    // After backspacing 'T' (the first and only char on line 2)
    try eb.backspace();
    cursor = eb.getCursor(0).?;
    written = eb.getText(&out_buffer);

    // After deleting 'T', we should still be on row 2, col 0, with the empty line preserved
    try std.testing.expectEqual(@as(u32, 2), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);
    try std.testing.expectEqualStrings("First\n\n", out_buffer[0..written]);
    try std.testing.expectEqual(@as(u32, 3), eb.getTextBuffer().lineCount());

    // Next backspace should merge with empty line (row 1)
    try eb.backspace();
    cursor = eb.getCursor(0).?;
    written = eb.getText(&out_buffer);

    // Now we should be on row 1 (the previous empty line), col 0
    try std.testing.expectEqual(@as(u32, 1), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);
    try std.testing.expectEqual(@as(u32, 2), eb.getTextBuffer().lineCount());
}

test "EditBuffer - deleteForward on first line with empty middle line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Create 3 lines: [text, empty, text]
    try eb.insertText("First\n\nThird");

    var out_buffer: [100]u8 = undefined;
    var written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("First\n\nThird", out_buffer[0..written]);
    try std.testing.expectEqual(@as(u32, 3), eb.getTextBuffer().lineCount());

    // Position cursor at start of first line
    try eb.setCursor(0, 0);
    var cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);

    // Delete forward through "First"
    try eb.deleteForward(); // Delete 'F'
    cursor = eb.getCursor(0).?;
    written = eb.getText(&out_buffer);
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);
    try std.testing.expectEqualStrings("irst\n\nThird", out_buffer[0..written]);

    // Continue deleting through "irst"
    try eb.deleteForward(); // Delete 'i'
    try eb.deleteForward(); // Delete 'r'
    try eb.deleteForward(); // Delete 's'
    try eb.deleteForward(); // Delete 't'

    cursor = eb.getCursor(0).?;
    written = eb.getText(&out_buffer);

    // After deleting all chars on first line, cursor should be at row 0, col 0
    // with empty line and "Third" preserved
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);
    try std.testing.expectEqualStrings("\n\nThird", out_buffer[0..written]);
    try std.testing.expectEqual(@as(u32, 3), eb.getTextBuffer().lineCount());
}

test "EditBuffer - moveLeft to end of line then insertText one char at a time" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Insert two lines
    try eb.insertText("First\nSecond");

    var out_buffer: [100]u8 = undefined;
    var written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("First\nSecond", out_buffer[0..written]);
    try std.testing.expectEqual(@as(u32, 2), eb.getTextBuffer().lineCount());

    // Cursor should be at end of second line (row=1, col=6)
    var cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 1), cursor.row);
    try std.testing.expectEqual(@as(u32, 6), cursor.col);

    // Move cursor to start of second line
    try eb.setCursor(1, 0);
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 1), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);

    // Move left once - should wrap to end of first line
    eb.moveLeft();
    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 5), cursor.col); // At end of "First"

    // Now insert characters one at a time
    try eb.insertText("X");
    written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("FirstX\nSecond", out_buffer[0..written]);

    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 6), cursor.col);

    try eb.insertText("Y");
    written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("FirstXY\nSecond", out_buffer[0..written]);

    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 7), cursor.col);

    try eb.insertText("Z");
    written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("FirstXYZ\nSecond", out_buffer[0..written]);

    cursor = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 8), cursor.col);

    // Verify we still have 2 lines
    try std.testing.expectEqual(@as(u32, 2), eb.getTextBuffer().lineCount());
}

test "EditBuffer - newline at col 0 then insertText" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Initial text
    try eb.insertText("Line 1\nLine 2");

    var out_buffer: [200]u8 = undefined;

    // Go to start of line 1 (row=1, col=0)
    try eb.setCursor(1, 0);

    // Insert a newline
    try eb.insertText("\n");

    var cursor = eb.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 2), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);

    // Now insert text - should go at start of line 2
    try eb.insertText("X");

    cursor = eb.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 2), cursor.row);
    try std.testing.expectEqual(@as(u32, 1), cursor.col);

    const written = eb.getText(&out_buffer);

    // Verify text structure: Line 1, empty line, X on line 2, then Line 2
    try std.testing.expectEqualStrings("Line 1\n\nXLine 2", out_buffer[0..written]);

    // Verify all markers have distinct weights
    const rope = &eb.getTextBuffer().rope;
    const line_count = eb.getTextBuffer().lineCount();
    var prev_weight: ?u32 = null;
    var i: u32 = 0;
    while (i < line_count) : (i += 1) {
        if (rope.getMarker(.linestart, i)) |m| {
            if (prev_weight) |pw| {
                try std.testing.expect(m.global_weight != pw);
            }
            prev_weight = m.global_weight;
        }
    }
}

test "EditBuffer - multiple newlines then char-by-char typing" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Start with some text
    try eb.insertText("Line 1\nLine 2");

    // Insert several newlines at the end (simulating user pressing Enter multiple times)
    try eb.insertText("\n");
    try eb.insertText("\n");
    try eb.insertText("\n");

    var cursor = eb.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 4), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);

    // Type characters one by one (simulating user typing)
    try eb.insertText("h");
    try eb.insertText("e");
    try eb.insertText("l");
    try eb.insertText("l");
    try eb.insertText("o");

    cursor = eb.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 4), cursor.row);
    try std.testing.expectEqual(@as(u32, 5), cursor.col);

    // Move cursor up 2 lines
    eb.moveUp();
    eb.moveUp();

    cursor = eb.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 2), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);

    // Type more characters
    try eb.insertText("t");
    try eb.insertText("e");
    try eb.insertText("s");
    try eb.insertText("t");

    cursor = eb.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 2), cursor.row);
    try std.testing.expectEqual(@as(u32, 4), cursor.col);

    var out_buffer: [200]u8 = undefined;
    const written = eb.getText(&out_buffer);

    // Verify markers are all distinct (no corruption)
    const rope = &eb.getTextBuffer().rope;
    const line_count = eb.getTextBuffer().lineCount();
    var i: u32 = 0;
    var prev_weight: ?u32 = null;
    while (i < line_count) : (i += 1) {
        if (rope.getMarker(.linestart, i)) |m| {
            if (prev_weight) |pw| {
                try std.testing.expect(m.global_weight != pw);
            }
            prev_weight = m.global_weight;
        }
    }

    // Verify text is correct
    try std.testing.expect(std.mem.indexOf(u8, out_buffer[0..written], "test") != null);
    try std.testing.expect(std.mem.indexOf(u8, out_buffer[0..written], "hello") != null);
}

test "EditBuffer - backspace after wide grapheme deletes entire grapheme" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Insert text with wide character (東 is width 2)
    try eb.insertText("AB東CD");

    var out_buffer: [100]u8 = undefined;
    var written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("AB東CD", out_buffer[0..written]);

    // Cursor should be at end: A(1) + B(1) + 東(2) + C(1) + D(1) = 6
    var cursor = eb.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 6), cursor.col);

    // Move cursor to position right after 東 (col = 4)
    try eb.setCursor(0, 4);
    cursor = eb.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 4), cursor.col);

    // Backspace once - should delete the entire 東 grapheme
    try eb.backspace();

    // Verify 東 is gone
    written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("ABCD", out_buffer[0..written]);

    // Cursor should now be at col 2 (after AB, where 東 was)
    cursor = eb.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 2), cursor.col);
}

test "EditBuffer - backspace after multiple wide graphemes" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Insert text with multiple wide characters
    try eb.insertText("東京");

    var out_buffer: [100]u8 = undefined;
    var written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("東京", out_buffer[0..written]);

    // Cursor should be at: 東(2) + 京(2) = 4
    var cursor = eb.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 4), cursor.col);

    // Backspace once - should delete 京
    try eb.backspace();
    written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("東", out_buffer[0..written]);

    cursor = eb.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 2), cursor.col);

    // Backspace again - should delete 東
    try eb.backspace();
    written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("", out_buffer[0..written]);

    cursor = eb.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);
}

test "EditBuffer - backspace mixed narrow and wide graphemes" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Insert mixed width text: H(1) e(1) l(1) l(1) o(1) 東(2) W(1) o(1) r(1) l(1) d(1) = 12 total
    try eb.insertText("Hello東World");

    var out_buffer: [100]u8 = undefined;
    var written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("Hello東World", out_buffer[0..written]);

    var cursor = eb.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 12), cursor.col);

    // Backspace through "World" (5 single-width chars)
    try eb.backspace();
    try eb.backspace();
    try eb.backspace();
    try eb.backspace();
    try eb.backspace();

    written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("Hello東", out_buffer[0..written]);

    cursor = eb.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 7), cursor.col);

    // Backspace once more - should delete the wide 東 in one go
    try eb.backspace();

    written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("Hello", out_buffer[0..written]);

    cursor = eb.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 5), cursor.col);
}
