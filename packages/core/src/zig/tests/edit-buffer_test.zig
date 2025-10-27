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

    try std.testing.expectEqual(@as(u32, 0), eb.getTextBuffer().getLength());
    const cursor = eb.getCursor(0);
    try std.testing.expect(cursor != null);
    try std.testing.expectEqual(@as(u32, 0), cursor.?.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.?.col);
}

test "EditBuffer - placeholder shows when empty" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Set placeholder with styled text
    const text = "Enter text here...";
    const gray_color = text_buffer.RGBA{ 0.4, 0.4, 0.4, 1.0 };
    const chunks = [_]text_buffer.StyledChunk{.{
        .text_ptr = text.ptr,
        .text_len = text.len,
        .fg_ptr = @ptrCast(&gray_color),
        .bg_ptr = null,
        .attributes = 0,
    }};
    try eb.setPlaceholderStyledText(&chunks);

    // getText should return empty (placeholder is display-only)
    var out_buffer: [100]u8 = undefined;
    const text_len = eb.getText(&out_buffer);
    try std.testing.expectEqual(@as(usize, 0), text_len);

    // But the underlying text buffer should contain the placeholder text
    const tb_len = eb.getTextBuffer().getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Enter text here...", out_buffer[0..tb_len]);
}

test "EditBuffer - inserting removes placeholder" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Set placeholder with styled text
    const text = "Placeholder";
    const gray_color = text_buffer.RGBA{ 0.4, 0.4, 0.4, 1.0 };
    const chunks = [_]text_buffer.StyledChunk{.{
        .text_ptr = text.ptr,
        .text_len = text.len,
        .fg_ptr = @ptrCast(&gray_color),
        .bg_ptr = null,
        .attributes = 0,
    }};
    try eb.setPlaceholderStyledText(&chunks);

    var out_buffer: [100]u8 = undefined;

    // Verify placeholder is active
    var text_len = eb.getText(&out_buffer);
    try std.testing.expectEqual(@as(usize, 0), text_len);

    // Insert actual text
    try eb.insertText("Hello");

    // getText should now return actual text
    text_len = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("Hello", out_buffer[0..text_len]);

    // TextBuffer should also have actual text
    const tb_len = eb.getTextBuffer().getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Hello", out_buffer[0..tb_len]);
}

test "EditBuffer - deleting to empty reactivates placeholder" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Set placeholder with styled text
    const text = "Type something...";
    const gray_color = text_buffer.RGBA{ 0.4, 0.4, 0.4, 1.0 };
    const chunks = [_]text_buffer.StyledChunk{.{
        .text_ptr = text.ptr,
        .text_len = text.len,
        .fg_ptr = @ptrCast(&gray_color),
        .bg_ptr = null,
        .attributes = 0,
    }};
    try eb.setPlaceholderStyledText(&chunks);

    // Insert text to remove placeholder
    try eb.insertText("Hi");

    var out_buffer: [100]u8 = undefined;
    var text_len = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("Hi", out_buffer[0..text_len]);

    // Delete all text
    try eb.deleteRange(.{ .row = 0, .col = 0 }, .{ .row = 0, .col = 2 });

    // getText should return empty (placeholder is active again)
    text_len = eb.getText(&out_buffer);
    try std.testing.expectEqual(@as(usize, 0), text_len);

    // But TextBuffer should have placeholder
    const tb_len = eb.getTextBuffer().getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Type something...", out_buffer[0..tb_len]);
}

test "EditBuffer - placeholder styled text works" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Create styled chunks
    const text1 = "Hello ";
    const text2 = "World";
    const red_color = text_buffer.RGBA{ 1.0, 0.0, 0.0, 1.0 };
    const blue_color = text_buffer.RGBA{ 0.0, 0.0, 1.0, 1.0 };

    const chunks = [_]text_buffer.StyledChunk{
        .{
            .text_ptr = text1.ptr,
            .text_len = text1.len,
            .fg_ptr = @ptrCast(&red_color),
            .bg_ptr = null,
            .attributes = 0,
        },
        .{
            .text_ptr = text2.ptr,
            .text_len = text2.len,
            .fg_ptr = @ptrCast(&blue_color),
            .bg_ptr = null,
            .attributes = 0,
        },
    };

    // Set styled placeholder
    try eb.setPlaceholderStyledText(&chunks);

    // Verify placeholder is active (getText returns empty)
    var out_buffer: [100]u8 = undefined;
    const text_len = eb.getText(&out_buffer);
    try std.testing.expectEqual(@as(usize, 0), text_len);

    // Verify we have 2 highlights stored
    try std.testing.expectEqual(@as(usize, 2), eb.placeholder_highlights.items.len);
}

test "EditBuffer - backspace to empty reactivates placeholder" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Set placeholder with styled text
    const text = "Empty...";
    const gray_color = text_buffer.RGBA{ 0.4, 0.4, 0.4, 1.0 };
    const chunks = [_]text_buffer.StyledChunk{.{
        .text_ptr = text.ptr,
        .text_len = text.len,
        .fg_ptr = @ptrCast(&gray_color),
        .bg_ptr = null,
        .attributes = 0,
    }};
    try eb.setPlaceholderStyledText(&chunks);

    // Insert text
    try eb.insertText("A");

    var out_buffer: [100]u8 = undefined;
    var text_len = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("A", out_buffer[0..text_len]);

    // Backspace to delete it
    try eb.backspace();

    // getText should return empty (placeholder active)
    text_len = eb.getText(&out_buffer);
    try std.testing.expectEqual(@as(usize, 0), text_len);

    // TextBuffer should have placeholder
    const tb_len = eb.getTextBuffer().getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Empty...", out_buffer[0..tb_len]);
}

test "EditBuffer - next word boundary basic" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello World");
    try eb.setCursor(0, 0);

    const next_cursor = eb.getNextWordBoundary();
    try std.testing.expectEqual(@as(u32, 0), next_cursor.row);
    try std.testing.expectEqual(@as(u32, 6), next_cursor.col);
}

test "EditBuffer - prev word boundary basic" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello World");
    try eb.setCursor(0, 7);

    const prev_cursor = eb.getPrevWordBoundary();
    try std.testing.expectEqual(@as(u32, 0), prev_cursor.row);
    try std.testing.expectEqual(@as(u32, 6), prev_cursor.col);
}

test "EditBuffer - next word boundary across line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello\nWorld");
    try eb.setCursor(0, 5);

    const next_cursor = eb.getNextWordBoundary();
    try std.testing.expectEqual(@as(u32, 1), next_cursor.row);
    try std.testing.expectEqual(@as(u32, 0), next_cursor.col);
}

test "EditBuffer - prev word boundary across line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello\nWorld");
    try eb.setCursor(1, 0);

    const prev_cursor = eb.getPrevWordBoundary();
    try std.testing.expectEqual(@as(u32, 0), prev_cursor.row);
    try std.testing.expectEqual(@as(u32, 5), prev_cursor.col);
}

test "EditBuffer - hyphen word boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("self-contained");
    try eb.setCursor(0, 0);

    const next_cursor = eb.getNextWordBoundary();
    try std.testing.expectEqual(@as(u32, 0), next_cursor.row);
    try std.testing.expectEqual(@as(u32, 5), next_cursor.col);
}

test "EditBuffer - multiple word boundaries" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("The quick brown fox");
    try eb.setCursor(0, 0);

    var cursor = eb.getNextWordBoundary();
    try std.testing.expectEqual(@as(u32, 4), cursor.col);

    try eb.setCursor(cursor.row, cursor.col);
    cursor = eb.getNextWordBoundary();
    try std.testing.expectEqual(@as(u32, 10), cursor.col);

    try eb.setCursor(cursor.row, cursor.col);
    cursor = eb.getNextWordBoundary();
    try std.testing.expectEqual(@as(u32, 16), cursor.col);
}

test "EditBuffer - word boundary at end of line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello");
    try eb.setCursor(0, 5);

    const next_cursor = eb.getNextWordBoundary();
    try std.testing.expectEqual(@as(u32, 0), next_cursor.row);
    try std.testing.expectEqual(@as(u32, 5), next_cursor.col);
}

test "EditBuffer - word boundary at start of line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello");
    try eb.setCursor(0, 0);

    const prev_cursor = eb.getPrevWordBoundary();
    try std.testing.expectEqual(@as(u32, 0), prev_cursor.row);
    try std.testing.expectEqual(@as(u32, 0), prev_cursor.col);
}

test "EditBuffer - getEOL basic" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello World");
    try eb.setCursor(0, 0);

    const eol_cursor = eb.getEOL();
    try std.testing.expectEqual(@as(u32, 0), eol_cursor.row);
    try std.testing.expectEqual(@as(u32, 11), eol_cursor.col);
}

test "EditBuffer - getEOL at end of line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello");
    try eb.setCursor(0, 5);

    const eol_cursor = eb.getEOL();
    try std.testing.expectEqual(@as(u32, 0), eol_cursor.row);
    try std.testing.expectEqual(@as(u32, 5), eol_cursor.col);
}

test "EditBuffer - getEOL multi-line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello\nWorld\nTest");
    try eb.setCursor(1, 0);

    const eol_cursor = eb.getEOL();
    try std.testing.expectEqual(@as(u32, 1), eol_cursor.row);
    try std.testing.expectEqual(@as(u32, 5), eol_cursor.col);
}

test "EditBuffer - getEOL empty line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello\n\nWorld");
    try eb.setCursor(1, 0);

    const eol_cursor = eb.getEOL();
    try std.testing.expectEqual(@as(u32, 1), eol_cursor.row);
    try std.testing.expectEqual(@as(u32, 0), eol_cursor.col);
}
