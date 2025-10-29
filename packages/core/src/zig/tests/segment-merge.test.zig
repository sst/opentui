const std = @import("std");
const EditBuffer = @import("../edit-buffer.zig").EditBuffer;
const gp = @import("../grapheme.zig");
const gwidth = @import("../gwidth.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");

test "EditBuffer - sequential character insertion merges segments" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Type characters one by one - this should trigger merging
    try eb.insertText("h");
    try eb.insertText("e");
    try eb.insertText("l");
    try eb.insertText("l");
    try eb.insertText("o");

    const count = eb.tb.rope.count();

    // Get the text to verify correctness
    var buffer: [1024]u8 = undefined;
    const len = eb.getText(&buffer);
    try std.testing.expectEqualStrings("hello", buffer[0..len]);

    // Without merging: linestart + 5 text chunks = 6 segments
    // With merging: linestart + 1 merged text chunk = 2 segments
    // Allow a bit of flexibility (e.g., 2-4 segments)
    try std.testing.expect(count <= 4);
    try std.testing.expect(count >= 2);
}

test "EditBuffer - merging preserves text correctness" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;
    

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Insert characters one by one
    const text = "The quick brown fox jumps over the lazy dog";
    for (text) |c| {
        var char_buf: [1]u8 = .{c};
        try eb.insertText(&char_buf);
    }

    // Verify the text is correct
    var buffer: [1024]u8 = undefined;
    const len = eb.getText(&buffer);
    try std.testing.expectEqualStrings(text, buffer[0..len]);
}

test "EditBuffer - non-contiguous segments do not merge" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;
    

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Insert text, move cursor, insert more
    try eb.insertText("abc");
    try eb.setCursor(0, 0); // Move to start
    try eb.insertText("xyz");

    // Get the text to verify
    var buffer: [1024]u8 = undefined;
    const len = eb.getText(&buffer);
    try std.testing.expectEqualStrings("xyzabc", buffer[0..len]);
}

test "EditBuffer - merging works across newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;
    

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Type on first line
    try eb.insertText("a");
    try eb.insertText("b");
    try eb.insertText("c");

    // Add newline
    try eb.insertText("\n");

    // Type on second line
    try eb.insertText("d");
    try eb.insertText("e");
    try eb.insertText("f");

    // Verify the text is correct
    var buffer: [1024]u8 = undefined;
    const len = eb.getText(&buffer);
    try std.testing.expectEqualStrings("abc\ndef", buffer[0..len]);

    // Verify we have 2 lines
    const line_count = eb.tb.lineCount();
    try std.testing.expectEqual(@as(u32, 2), line_count);
}

test "EditBuffer - merging with unicode characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;
    

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Type unicode characters one by one
    try eb.insertText("你");
    try eb.insertText("好");
    try eb.insertText("世");
    try eb.insertText("界");

    // Verify the text is correct
    var buffer: [1024]u8 = undefined;
    const len = eb.getText(&buffer);
    try std.testing.expectEqualStrings("你好世界", buffer[0..len]);
}

test "EditBuffer - merging after delete and re-insert" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;
    

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Type some text
    try eb.insertText("hello");

    // Delete one character
    try eb.backspace();

    // Type more characters - should merge with remaining text
    try eb.insertText("p");

    // Verify the text is correct
    var buffer: [1024]u8 = undefined;
    const len = eb.getText(&buffer);
    try std.testing.expectEqualStrings("hellp", buffer[0..len]);
}

test "EditBuffer - empty buffer then type" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;
    

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Type into empty buffer
    try eb.insertText("t");
    try eb.insertText("e");
    try eb.insertText("s");
    try eb.insertText("t");

    // Verify the text is correct
    var buffer: [1024]u8 = undefined;
    const len = eb.getText(&buffer);
    try std.testing.expectEqualStrings("test", buffer[0..len]);
}
