const std = @import("std");
const edit_buffer = @import("../edit-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const gp = @import("../grapheme.zig");

const EditBuffer = edit_buffer.EditBuffer;
const TextBufferView = text_buffer_view.TextBufferView;

test "Word wrap - editing around wrap boundary creates correct wrap" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(18);

    // Start with text that fits within 18 chars
    try eb.setText("hello my good", false);

    const vlines1 = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines1.len);

    // Now add " friend" - this should wrap "friend" to next line
    try eb.setCursor(0, 13);
    try eb.insertText(" friend");

    const vlines2 = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), vlines2.len);

    // First line should be "hello my good " (14 chars)
    try std.testing.expectEqual(@as(u32, 14), vlines2[0].width);

    // Second line should be "friend" (6 chars)
    try std.testing.expectEqual(@as(u32, 6), vlines2[1].width);
}

test "Word wrap - backspace and retype near boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(18);

    // Start with text that wraps
    try eb.setText("hello my good friend", false);

    var vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), vlines.len);

    // Delete "friend"
    try eb.setCursor(0, 20);
    var i: usize = 0;
    while (i < 7) : (i += 1) {
        try eb.backspace();
    }

    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    // Type "friend" back
    try eb.insertText(" friend");

    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), vlines.len);

    // Should still wrap correctly with "friend" on second line
    try std.testing.expectEqual(@as(u32, 14), vlines[0].width);
    try std.testing.expectEqual(@as(u32, 6), vlines[1].width);
}

test "Word wrap - type character by character near boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(18);

    try eb.setText("hello my good ", false);

    var vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    // Type "f"
    try eb.setCursor(0, 14);
    try eb.insertText("f");

    vlines = view.getVirtualLines();
    // Should still be on one line
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    // Type "r"
    try eb.insertText("r");
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    // Type "i"
    try eb.insertText("i");
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    // Type "e" - now at 18 chars total, equals wrap width but doesn't exceed
    try eb.insertText("e");
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    // Type "n" - now at 19 chars, exceeds wrap width of 18, should wrap
    try eb.insertText("n");
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), vlines.len);

    // Type "d" - now at 20 chars, still wrapped
    try eb.insertText("d");
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), vlines.len);

    // Now add space - "friend" should wrap as a whole word
    try eb.insertText(" ");
    vlines = view.getVirtualLines();

    // Expected: "hello my good " on line 0, "friend " on line 1
    try std.testing.expectEqual(@as(usize, 2), vlines.len);
    try std.testing.expectEqual(@as(u32, 14), vlines[0].width);
    try std.testing.expectEqual(@as(u32, 7), vlines[1].width);
}

test "Word wrap - insert word in middle causes rewrap" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(20);

    try eb.setText("hello friend", false);

    var vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    // Insert "my good " between "hello" and "friend"
    try eb.setCursor(0, 6);
    try eb.insertText("my good ");

    vlines = view.getVirtualLines();
    // "hello my good friend" = 20 chars, equals wrap width, should NOT wrap
    try std.testing.expectEqual(@as(usize, 1), vlines.len);
}

test "Word wrap - delete word causes rewrap" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(18);

    try eb.setText("hello my good friend buddy", false);

    var vlines = view.getVirtualLines();
    // Should wrap
    try std.testing.expect(vlines.len >= 2);

    // Delete "my good "
    try eb.setCursor(0, 6);
    var i: usize = 0;
    while (i < 8) : (i += 1) {
        try eb.deleteForward();
    }

    vlines = view.getVirtualLines();
    // "hello friend buddy" = 18 chars, equals wrap width, should NOT wrap
    try std.testing.expectEqual(@as(usize, 1), vlines.len);
}

test "Word wrap - rapid edits maintain correct wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(18);

    try eb.setText("hello my ", false);
    try eb.setCursor(0, 9);
    try eb.insertText("g");
    try eb.insertText("o");
    try eb.insertText("o");
    try eb.insertText("d");
    try eb.insertText(" ");
    try eb.insertText("f");
    try eb.insertText("r");
    try eb.insertText("i");
    try eb.insertText("e");
    try eb.insertText("n");
    try eb.insertText("d");

    const vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), vlines.len);

    // Verify correct line widths
    try std.testing.expectEqual(@as(u32, 14), vlines[0].width);
    try std.testing.expectEqual(@as(u32, 6), vlines[1].width);
}

test "Word wrap - fragmented at exact word boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(18);

    // Build text incrementally to create fragmentation
    try eb.setText("hello ", false);
    try eb.setCursor(0, 6);
    try eb.insertText("my ");
    try eb.insertText("good ");
    try eb.insertText("friend");

    const vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), vlines.len);
    try std.testing.expectEqual(@as(u32, 14), vlines[0].width);
    try std.testing.expectEqual(@as(u32, 6), vlines[1].width);
}

test "Word wrap - chunk boundary at start of word (FAILS)" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(18);

    // Type text in a way that creates chunk boundaries
    try eb.setText("hello my good ", false);
    try eb.setCursor(0, 14);

    // This creates a new chunk for "f"
    try eb.insertText("f");

    // Backspace and retype to fragment differently
    try eb.backspace();
    try eb.insertText("friend");

    const vlines = view.getVirtualLines();

    // BUG: This might incorrectly wrap at the chunk boundary
    // Expected: 2 lines with "hello my good " and "friend"
    // Actual might be: 2 lines with "hello my good f" and "riend"
    try std.testing.expectEqual(@as(usize, 2), vlines.len);
    try std.testing.expectEqual(@as(u32, 14), vlines[0].width);
    try std.testing.expectEqual(@as(u32, 6), vlines[1].width);
}

test "Word wrap - multiple edits create complex fragmentation (FAILS)" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(20);

    // Build text with multiple edits to create fragmentation
    try eb.setText("hello ", false);
    try eb.setCursor(0, 6);
    try eb.insertText("w");
    try eb.backspace();
    try eb.insertText("m");
    try eb.insertText("y");
    try eb.insertText(" ");
    try eb.insertText("g");
    try eb.insertText("o");
    try eb.backspace();
    try eb.insertText("o");
    try eb.insertText("o");
    try eb.insertText("d");
    try eb.insertText(" ");
    try eb.insertText("x");
    try eb.backspace();
    try eb.insertText("f");
    try eb.insertText("r");
    try eb.insertText("iend");

    const vlines = view.getVirtualLines();

    // Verify text content first
    var buffer: [100]u8 = undefined;
    const len = view.getPlainTextIntoBuffer(&buffer);
    try std.testing.expectEqualStrings("hello my good friend", buffer[0..len]);

    // "hello my good friend" = 20 chars with wrap width 20, equals but doesn't exceed
    try std.testing.expectEqual(@as(usize, 1), vlines.len);
}

test "Word wrap - insert at wrap boundary with existing wrap (FAILS)" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(15);

    // Start with wrapped text
    try eb.setText("hello world test", false);

    var vlines = view.getVirtualLines();
    try std.testing.expect(vlines.len >= 2);

    // Insert character near wrap boundary
    try eb.setCursor(0, 11); // After "hello world"
    try eb.insertText("s");

    vlines = view.getVirtualLines();

    // Should maintain word-based wrapping
    // Text is now "hello worlds test"
    // Should wrap as "hello worlds" and "test" or similar
    try std.testing.expect(vlines.len >= 2);

    // Verify each virtual line respects word boundaries
    for (vlines) |vline| {
        try std.testing.expect(vline.width <= 15);
    }
}

test "Word wrap - word at exact wrap width (FAILS)" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(20);

    // Create text where a word is exactly at wrap width
    try eb.setText("12345678901234567890", false); // Exactly 20 chars, no spaces

    var vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    // Add a space and another word
    try eb.setCursor(0, 20);
    try eb.insertText(" word");

    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), vlines.len);
    try std.testing.expectEqual(@as(u32, 20), vlines[0].width);
    try std.testing.expectEqual(@as(u32, 5), vlines[1].width);
}

test "Word wrap - debug virtual line contents" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(18);

    // Create fragmented rope like in the original test
    try eb.setText("hello my good ", false);
    try eb.setCursor(0, 14);
    try eb.insertText("f");
    try eb.backspace();
    try eb.insertText("friend");

    const vlines = view.getVirtualLines();

    std.debug.print("\nNumber of virtual lines: {}\n", .{vlines.len});
    for (vlines, 0..) |vline, i| {
        std.debug.print("VLine {}: width={}, chunks={}, char_offset={}, source_col_offset={}\n", .{ i, vline.width, vline.chunks.items.len, vline.char_offset, vline.source_col_offset });

        // Print each chunk in the virtual line
        for (vline.chunks.items, 0..) |vchunk, j| {
            const chunk_bytes = vchunk.chunk.getBytes(&eb.getTextBuffer().mem_registry);
            const start = vchunk.grapheme_start;
            _ = start;
            std.debug.print("  Chunk {}: start={}, count={}, width={}, total_chunk_width={}, bytes_len={}\n", .{ j, vchunk.grapheme_start, vchunk.grapheme_count, vchunk.width, vchunk.chunk.width, chunk_bytes.len });
        }
    }

    try std.testing.expectEqual(@as(usize, 2), vlines.len);
}

test "Word wrap - incremental character edits near boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(18);

    try eb.setText("hello my good ", false);

    var vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    // Type "friend" one character at a time
    try eb.setCursor(0, 14);
    try eb.insertText("f");
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    try eb.insertText("r");
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    try eb.insertText("i");
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    try eb.insertText("e");
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    try eb.insertText("n");
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), vlines.len);

    try eb.insertText("d");
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), vlines.len);

    // Verify final wrapping
    try std.testing.expectEqual(@as(u32, 14), vlines[0].width);
    try std.testing.expectEqual(@as(u32, 6), vlines[1].width);
}
