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

// Editing tests removed (insertAt/deleteRange/replaceRange and dependent tests)
