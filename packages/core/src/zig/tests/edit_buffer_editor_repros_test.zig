const std = @import("std");
const testing = std.testing;
const edit_buffer_mod = @import("../edit-buffer.zig");
const gp = @import("../grapheme.zig");
const gwidth = @import("../gwidth.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");

var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
const allocator = arena.allocator();

fn createEditBuffer() !*edit_buffer_mod.EditBuffer {
    const pool = gp.initGlobalPool(allocator);
    const unicode_data = gp.initGlobalUnicodeData(allocator);
    const graphemes_ptr, const display_width_ptr = unicode_data;

    return try edit_buffer_mod.EditBuffer.init(
        allocator,
        pool,
        .unicode,
        graphemes_ptr,
        display_width_ptr,
    );
}

test "EditBuffer: goto end and insert" {
    const edit_buf = try createEditBuffer();
    defer edit_buf.deinit();

    try edit_buf.setText("Hello");
    try edit_buf.gotoLine(9999); // Move to end
    try edit_buf.insertText("!");

    var out_buffer: [100]u8 = undefined;
    const len = edit_buf.getText(&out_buffer);
    const text = out_buffer[0..len];

    try testing.expectEqualStrings("Hello!", text);
}

test "EditBuffer: end insert text" {
    const edit_buf = try createEditBuffer();
    defer edit_buf.deinit();

    try edit_buf.setText("Hello");
    try edit_buf.gotoLine(9999); // Move to end
    try edit_buf.insertText(" World");

    var out_buffer: [100]u8 = undefined;
    const len = edit_buf.getText(&out_buffer);
    const text = out_buffer[0..len];

    try testing.expectEqualStrings("Hello World", text);
}

test "EditBuffer: backspace at end" {
    const edit_buf = try createEditBuffer();
    defer edit_buf.deinit();

    try edit_buf.setText("Hello");
    try edit_buf.gotoLine(9999); // Move to end
    try edit_buf.backspace();

    var out_buffer: [100]u8 = undefined;
    const len = edit_buf.getText(&out_buffer);
    const text = out_buffer[0..len];

    try testing.expectEqualStrings("Hell", text);
}

test "EditBuffer: newline at end" {
    const edit_buf = try createEditBuffer();
    defer edit_buf.deinit();

    try edit_buf.setText("Hello");
    try edit_buf.gotoLine(9999); // Move to end
    try edit_buf.insertText("\n");

    var out_buffer: [100]u8 = undefined;
    const len = edit_buf.getText(&out_buffer);
    const text = out_buffer[0..len];

    try testing.expectEqualStrings("Hello\n", text);
}

test "EditBuffer: delete line in 3-line doc" {
    const edit_buf = try createEditBuffer();
    defer edit_buf.deinit();

    try edit_buf.setText("Line 1\nLine 2\nLine 3");
    try edit_buf.gotoLine(1); // Go to line 2 (0-indexed)
    try edit_buf.deleteLine();

    var out_buffer: [100]u8 = undefined;
    const len = edit_buf.getText(&out_buffer);
    const text = out_buffer[0..len];

    try testing.expectEqualStrings("Line 1\nLine 3", text);
}

test "EditBuffer: clamp setCursor to line width" {
    const edit_buf = try createEditBuffer();
    defer edit_buf.deinit();

    try edit_buf.setText("ABC");
    try edit_buf.setCursor(0, 9999); // Try to set to col 9999

    const pos = edit_buf.getCursorPosition();
    try testing.expectEqual(@as(u32, 0), pos.line);
    try testing.expectEqual(@as(u32, 3), pos.visual_col); // Should clamp to 3 (line width)
}

test "EditBuffer: grapheme movement - emoji" {
    const edit_buf = try createEditBuffer();
    defer edit_buf.deinit();

    // "A🌟B" - emoji has width 2
    try edit_buf.setText("A🌟B");
    try edit_buf.setCursor(0, 0); // Start at A

    // Move right from A (col 0) -> should be at col 1
    edit_buf.moveRight();
    var pos = edit_buf.getCursorPosition();
    try testing.expectEqual(@as(u32, 1), pos.visual_col);

    // Move right from col 1 (emoji) -> should advance by 2 to col 3
    edit_buf.moveRight();
    pos = edit_buf.getCursorPosition();
    try testing.expectEqual(@as(u32, 3), pos.visual_col);

    // Move left from col 3 -> should go back by emoji width (2) to col 1
    edit_buf.moveLeft();
    pos = edit_buf.getCursorPosition();
    try testing.expectEqual(@as(u32, 1), pos.visual_col);

    // Move left from col 1 -> should go back by A width (1) to col 0
    edit_buf.moveLeft();
    pos = edit_buf.getCursorPosition();
    try testing.expectEqual(@as(u32, 0), pos.visual_col);
}

test "EditBuffer: grapheme movement - ASCII" {
    const edit_buf = try createEditBuffer();
    defer edit_buf.deinit();

    try edit_buf.setText("ABC");
    try edit_buf.setCursor(0, 0);

    // Move right 3 times
    edit_buf.moveRight();
    var pos = edit_buf.getCursorPosition();
    try testing.expectEqual(@as(u32, 1), pos.visual_col);

    edit_buf.moveRight();
    pos = edit_buf.getCursorPosition();
    try testing.expectEqual(@as(u32, 2), pos.visual_col);

    edit_buf.moveRight();
    pos = edit_buf.getCursorPosition();
    try testing.expectEqual(@as(u32, 3), pos.visual_col);

    // Move left 3 times
    edit_buf.moveLeft();
    pos = edit_buf.getCursorPosition();
    try testing.expectEqual(@as(u32, 2), pos.visual_col);

    edit_buf.moveLeft();
    pos = edit_buf.getCursorPosition();
    try testing.expectEqual(@as(u32, 1), pos.visual_col);

    edit_buf.moveLeft();
    pos = edit_buf.getCursorPosition();
    try testing.expectEqual(@as(u32, 0), pos.visual_col);
}
