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

    // Set placeholder
    try eb.setPlaceholder("Enter text here...");

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

    // Set placeholder
    try eb.setPlaceholder("Placeholder");

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

    // Set placeholder
    try eb.setPlaceholder("Type something...");

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

test "EditBuffer - placeholder color setter works" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Set placeholder
    try eb.setPlaceholder("Placeholder");

    // Change color (should not crash)
    const new_color = text_buffer.RGBA{ 1.0, 0.0, 0.0, 1.0 };
    try eb.setPlaceholderColor(new_color);

    // Verify placeholder is still active
    var out_buffer: [100]u8 = undefined;
    const text_len = eb.getText(&out_buffer);
    try std.testing.expectEqual(@as(usize, 0), text_len);
}

test "EditBuffer - backspace to empty reactivates placeholder" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Set placeholder
    try eb.setPlaceholder("Empty...");

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
