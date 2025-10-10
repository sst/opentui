const std = @import("std");
const text_buffer = @import("../text-buffer.zig");
const gp = @import("../grapheme.zig");

const TextBuffer = text_buffer.TextBuffer;

// ===== Coordinate Conversion Tests =====

test "TextBuffer coords - coordsToCharOffset simple text" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello\nWorld");

    // Line 0, col 0 -> offset 0
    try std.testing.expectEqual(@as(u32, 0), tb.coordsToCharOffset(0, 0).?);

    // Line 0, col 3 -> offset 3
    try std.testing.expectEqual(@as(u32, 3), tb.coordsToCharOffset(0, 3).?);

    // Line 0, col 5 (end) -> offset 5
    try std.testing.expectEqual(@as(u32, 5), tb.coordsToCharOffset(0, 5).?);

    // Line 1, col 0 -> offset 5
    try std.testing.expectEqual(@as(u32, 5), tb.coordsToCharOffset(1, 0).?);

    // Line 1, col 3 -> offset 8
    try std.testing.expectEqual(@as(u32, 8), tb.coordsToCharOffset(1, 3).?);
}

test "TextBuffer coords - coordsToCharOffset out of bounds" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello");

    // Row out of bounds
    try std.testing.expect(tb.coordsToCharOffset(10, 0) == null);

    // Col out of bounds
    try std.testing.expect(tb.coordsToCharOffset(0, 100) == null);
}

test "TextBuffer coords - charOffsetToCoords simple text" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello\nWorld");

    // Offset 0 -> (0, 0)
    const coords0 = tb.charOffsetToCoords(0).?;
    try std.testing.expectEqual(@as(u32, 0), coords0.row);
    try std.testing.expectEqual(@as(u32, 0), coords0.col);

    // Offset 3 -> (0, 3)
    const coords3 = tb.charOffsetToCoords(3).?;
    try std.testing.expectEqual(@as(u32, 0), coords3.row);
    try std.testing.expectEqual(@as(u32, 3), coords3.col);

    // Offset 5 -> (1, 0) - start of second line
    const coords5 = tb.charOffsetToCoords(5).?;
    try std.testing.expectEqual(@as(u32, 1), coords5.row);
    try std.testing.expectEqual(@as(u32, 0), coords5.col);

    // Offset 8 -> (1, 3)
    const coords8 = tb.charOffsetToCoords(8).?;
    try std.testing.expectEqual(@as(u32, 1), coords8.row);
    try std.testing.expectEqual(@as(u32, 3), coords8.col);
}

test "TextBuffer coords - charOffsetToCoords out of bounds" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello");

    // Offset beyond text length
    try std.testing.expect(tb.charOffsetToCoords(100) == null);
}

test "TextBuffer coords - round trip conversion" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Line1\nLine2\nLine3");

    // Test round trip: coords -> offset -> coords
    const test_coords = [_]struct { row: u32, col: u32 }{
        .{ .row = 0, .col = 0 },
        .{ .row = 0, .col = 3 },
        .{ .row = 1, .col = 0 },
        .{ .row = 1, .col = 2 },
        .{ .row = 2, .col = 4 },
    };

    for (test_coords) |coord| {
        const offset = tb.coordsToCharOffset(coord.row, coord.col).?;
        const result = tb.charOffsetToCoords(offset).?;
        try std.testing.expectEqual(coord.row, result.row);
        try std.testing.expectEqual(coord.col, result.col);
    }
}

test "TextBuffer coords - coordsToByteOffset basic" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello\nWorld");

    // Line 0, col 0
    const byte_info0 = tb.coordsToByteOffset(0, 0).?;
    try std.testing.expectEqual(@as(u32, 0), byte_info0.byte_offset);

    // Line 1, col 0
    const byte_info1 = tb.coordsToByteOffset(1, 0).?;
    try std.testing.expectEqual(@as(u32, 6), byte_info1.byte_offset); // After "Hello\n"
}

test "TextBuffer coords - coordsToByteOffset with unicode" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello 世界");

    // Should handle multi-byte characters correctly
    const byte_info = tb.coordsToByteOffset(0, 0).?;
    try std.testing.expect(byte_info.mem_id == 0);
}

test "TextBuffer coords - addHighlightByCoords" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello\nWorld");

    // Highlight "ello" on first line
    try tb.addHighlightByCoords(0, 1, 0, 5, 1, 1, null);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
    try std.testing.expectEqual(@as(u32, 1), highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 5), highlights[0].col_end);
}

test "TextBuffer coords - addHighlightByCoords multi-line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello\nWorld");

    // Highlight from line 0 col 3 to line 1 col 3
    try tb.addHighlightByCoords(0, 3, 1, 3, 1, 1, null);

    const line0_highlights = tb.getLineHighlights(0);
    const line1_highlights = tb.getLineHighlights(1);

    try std.testing.expectEqual(@as(usize, 1), line0_highlights.len);
    try std.testing.expectEqual(@as(usize, 1), line1_highlights.len);
}

// ===== insertAt Tests =====

test "TextBuffer editing - insertAt at beginning of line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("World");

    const insert_text = "Hello ";
    const mem_id = try tb.registerMemBuffer(insert_text, false);
    try tb.insertAt(0, 0, mem_id, 0, 6);

    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Hello World", out_buffer[0..written]);
}

test "TextBuffer editing - insertAt at end of line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello");

    const insert_text = " World";
    const mem_id = try tb.registerMemBuffer(insert_text, false);
    try tb.insertAt(0, 5, mem_id, 0, 6);

    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Hello World", out_buffer[0..written]);
}

test "TextBuffer editing - insertAt in middle of line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("HelloWorld");

    const insert_text = " ";
    const mem_id = try tb.registerMemBuffer(insert_text, false);
    try tb.insertAt(0, 5, mem_id, 0, 1);

    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Hello World", out_buffer[0..written]);
}

test "TextBuffer editing - insertAt multiple times" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("ac");

    const insert_text = "b";
    const mem_id = try tb.registerMemBuffer(insert_text, false);

    // Insert 'b' at position 1
    try tb.insertAt(0, 1, mem_id, 0, 1);

    var out_buffer: [100]u8 = undefined;
    var written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("abc", out_buffer[0..written]);

    // Insert another 'b' at position 2
    try tb.insertAt(0, 2, mem_id, 0, 1);

    written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("abbc", out_buffer[0..written]);
}

test "TextBuffer editing - insertAt on second line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Line1\nLine2");

    const insert_text = "X";
    const mem_id = try tb.registerMemBuffer(insert_text, false);
    try tb.insertAt(1, 2, mem_id, 0, 1);

    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Line1\nLiXne2", out_buffer[0..written]);
}

test "TextBuffer editing - insertAt with unicode" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello");

    const insert_text = " 世界";
    const mem_id = try tb.registerMemBuffer(insert_text, false);
    try tb.insertAt(0, 5, mem_id, 0, @intCast(insert_text.len));

    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Hello 世界", out_buffer[0..written]);
}

test "TextBuffer editing - insertAt updates line width" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hi");
    const initial_len = tb.getLength();

    const insert_text = "123";
    const mem_id = try tb.registerMemBuffer(insert_text, false);
    try tb.insertAt(0, 2, mem_id, 0, 3);

    const new_len = tb.getLength();
    try std.testing.expectEqual(initial_len + 3, new_len);
}

test "TextBuffer editing - insertAt invalid row" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello");

    const insert_text = "X";
    const mem_id = try tb.registerMemBuffer(insert_text, false);

    const result = tb.insertAt(10, 0, mem_id, 0, 1);
    try std.testing.expectError(text_buffer.TextBufferError.InvalidIndex, result);
}

test "TextBuffer editing - insertAt invalid col" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello");

    const insert_text = "X";
    const mem_id = try tb.registerMemBuffer(insert_text, false);

    const result = tb.insertAt(0, 100, mem_id, 0, 1);
    try std.testing.expectError(text_buffer.TextBufferError.InvalidIndex, result);
}

// ===== deleteRange Tests =====

test "TextBuffer editing - deleteRange from beginning" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello World");

    // Delete "Hello "
    try tb.deleteRange(0, 0, 0, 6);

    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("World", out_buffer[0..written]);
}

test "TextBuffer editing - deleteRange from middle" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello World");

    // Delete " Wor"
    try tb.deleteRange(0, 5, 0, 9);

    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Hellold", out_buffer[0..written]);
}

test "TextBuffer editing - deleteRange to end" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello World");

    // Delete " World"
    try tb.deleteRange(0, 5, 0, 11);

    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Hello", out_buffer[0..written]);
}

test "TextBuffer editing - deleteRange entire line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello World");

    // Delete entire line
    try tb.deleteRange(0, 0, 0, 11);

    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("", out_buffer[0..written]);
}

test "TextBuffer editing - deleteRange multi-line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Line1\nLine2\nLine3");

    // Delete from middle of line 0 to middle of line 2
    try tb.deleteRange(0, 2, 2, 3);

    const line_count = tb.getLineCount();
    try std.testing.expectEqual(@as(u32, 1), line_count);

    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Lie3", out_buffer[0..written]);
}

test "TextBuffer editing - deleteRange updates length" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello World");
    const initial_len = tb.getLength();

    // Delete 5 characters
    try tb.deleteRange(0, 5, 0, 10);

    const new_len = tb.getLength();
    try std.testing.expectEqual(initial_len - 5, new_len);
}

test "TextBuffer editing - deleteRange with unicode" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello 世界 Test");

    // Delete the unicode characters (display width, not byte length)
    const text_len = tb.getLength();
    try tb.deleteRange(0, 6, 0, text_len - 5);

    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Hello  Test", out_buffer[0..written]);
}

test "TextBuffer editing - deleteRange invalid range" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello");

    // Start > end should be no-op
    try tb.deleteRange(0, 5, 0, 2);

    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Hello", out_buffer[0..written]);
}

// ===== replaceRange Tests =====

test "TextBuffer editing - replaceRange simple" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello World");

    // Replace "World" with "There"
    const replace_text = "There";
    const mem_id = try tb.registerMemBuffer(replace_text, false);
    try tb.replaceRange(0, 6, 0, 11, mem_id, 0, 5);

    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Hello There", out_buffer[0..written]);
}

test "TextBuffer editing - replaceRange with longer text" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hi");

    // Replace "Hi" with "Hello World"
    const replace_text = "Hello World";
    const mem_id = try tb.registerMemBuffer(replace_text, false);
    try tb.replaceRange(0, 0, 0, 2, mem_id, 0, 11);

    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Hello World", out_buffer[0..written]);
}

test "TextBuffer editing - replaceRange with shorter text" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello World");

    // Replace "Hello World" with "Hi"
    const replace_text = "Hi";
    const mem_id = try tb.registerMemBuffer(replace_text, false);
    try tb.replaceRange(0, 0, 0, 11, mem_id, 0, 2);

    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Hi", out_buffer[0..written]);
}

// ===== Combined Operations Tests =====

test "TextBuffer editing - insert then delete" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello");

    // Insert " World"
    const insert_text = " World";
    const mem_id = try tb.registerMemBuffer(insert_text, false);
    try tb.insertAt(0, 5, mem_id, 0, 6);

    // Delete "ello"
    try tb.deleteRange(0, 1, 0, 5);

    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("H World", out_buffer[0..written]);
}

test "TextBuffer editing - multiple edits on same line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("abc");

    const insert_text = "X";
    const mem_id = try tb.registerMemBuffer(insert_text, false);

    // Insert X at position 1: aXbc
    try tb.insertAt(0, 1, mem_id, 0, 1);

    // Insert X at position 3: aXbXc
    try tb.insertAt(0, 3, mem_id, 0, 1);

    // Delete character at position 2: aXXc
    try tb.deleteRange(0, 2, 0, 3);

    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("aXXc", out_buffer[0..written]);
}

test "TextBuffer editing - edits preserve other lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Line1\nLine2\nLine3");

    // Edit only line 1
    const insert_text = "X";
    const mem_id = try tb.registerMemBuffer(insert_text, false);
    try tb.insertAt(1, 2, mem_id, 0, 1);

    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try std.testing.expectEqualStrings("Line1\nLiXne2\nLine3", out_buffer[0..written]);
}

test "TextBuffer editing - coordinates stay valid after edits on different line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Line1\nLine2");

    // Get offset for line 1, col 2 before edit
    const offset_before = tb.coordsToCharOffset(1, 2).?;

    // Edit line 0 (shouldn't affect line 1 coordinates within the line)
    const insert_text = "XXX";
    const mem_id = try tb.registerMemBuffer(insert_text, false);
    try tb.insertAt(0, 0, mem_id, 0, 3);

    // Line 1, col 2 should still be valid (though offset changes)
    const offset_after = tb.coordsToCharOffset(1, 2).?;

    // Offsets should be different (line 1 starts later now)
    try std.testing.expect(offset_after > offset_before);

    // But coordinates should still resolve
    const coords = tb.charOffsetToCoords(offset_after).?;
    try std.testing.expectEqual(@as(u32, 1), coords.row);
    try std.testing.expectEqual(@as(u32, 2), coords.col);
}

test "TextBuffer editing - views marked dirty after insertAt" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello");

    const view_id = try tb.registerView();
    defer tb.unregisterView(view_id);

    tb.clearViewDirty(view_id);
    try std.testing.expect(!tb.isViewDirty(view_id));

    const insert_text = "X";
    const mem_id = try tb.registerMemBuffer(insert_text, false);
    try tb.insertAt(0, 0, mem_id, 0, 1);

    try std.testing.expect(tb.isViewDirty(view_id));
}

test "TextBuffer editing - views marked dirty after deleteRange" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello");

    const view_id = try tb.registerView();
    defer tb.unregisterView(view_id);

    tb.clearViewDirty(view_id);
    try std.testing.expect(!tb.isViewDirty(view_id));

    try tb.deleteRange(0, 0, 0, 2);

    try std.testing.expect(tb.isViewDirty(view_id));
}
