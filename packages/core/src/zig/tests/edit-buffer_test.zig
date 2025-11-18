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

test "EditBuffer - moveRight past tab at start of line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("\tHello");
    try eb.setCursor(0, 0);

    eb.moveRight();
    const cursor = eb.getCursor(0).?;
    try std.testing.expect(cursor.col > 0);

    eb.moveRight();
    const cursor2 = eb.getCursor(0).?;
    try std.testing.expect(cursor2.col > cursor.col);
}

test "EditBuffer - moveRight after typing before tab" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("\tWorld");
    try eb.setCursor(0, 0);
    try eb.insertText("Hi");

    const cursor_after_insert = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor_after_insert.row);

    eb.moveRight();
    const cursor_after_move1 = eb.getCursor(0).?;
    try std.testing.expect(cursor_after_move1.col > cursor_after_insert.col);

    eb.moveRight();
    const cursor_after_move2 = eb.getCursor(0).?;
    try std.testing.expect(cursor_after_move2.col > cursor_after_move1.col);

    eb.moveRight();
    const cursor_after_move3 = eb.getCursor(0).?;
    try std.testing.expect(cursor_after_move3.col > cursor_after_move2.col);
}

test "EditBuffer - moveRight between two tabs" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("\t\tHello");
    try eb.setCursor(0, 0);

    var prev_col: u32 = 0;
    var i: u32 = 0;
    while (i < 10) : (i += 1) {
        eb.moveRight();
        const cursor = eb.getCursor(0).?;
        try std.testing.expect(cursor.col >= prev_col);
        prev_col = cursor.col;
    }
}

test "EditBuffer - type and move around single tab" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("\t");
    try eb.setCursor(0, 0);
    try eb.insertText("a");

    var buffer: [100]u8 = undefined;
    _ = eb.getText(&buffer);

    const cursor1 = eb.getCursor(0).?;
    try std.testing.expectEqual(@as(u32, 0), cursor1.row);
    _ = iter_mod.lineWidthAt(&eb.tb.rope, 0);

    _ = iter_mod.getGraphemeWidthAt(&eb.tb.rope, &eb.tb.mem_registry, 0, cursor1.col, eb.tb.tab_width, eb.tb.width_method);

    eb.moveRight();
    const cursor2 = eb.getCursor(0).?;
    const line_width2 = iter_mod.lineWidthAt(&eb.tb.rope, 0);
    const gw2 = iter_mod.getGraphemeWidthAt(&eb.tb.rope, &eb.tb.mem_registry, 0, cursor2.col, eb.tb.tab_width, eb.tb.width_method);
    try std.testing.expect(cursor2.col > cursor1.col);

    // After moving right once, we're at the end of the line (col=3, line_width=3)
    // We can't move any further
    try std.testing.expectEqual(line_width2, cursor2.col);
    try std.testing.expectEqual(@as(u32, 0), gw2); // No grapheme to move to
}

test "EditBuffer - insert text between tabs and move right" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("\t\tx");
    try eb.setCursor(0, 0);

    eb.moveRight();
    _ = eb.getCursor(0).?;

    try eb.insertText("A");
    const after_insert = eb.getCursor(0).?;

    eb.moveRight();
    const after_move1 = eb.getCursor(0).?;
    try std.testing.expect(after_move1.col > after_insert.col);

    eb.moveRight();
    const after_move2 = eb.getCursor(0).?;
    try std.testing.expect(after_move2.col > after_move1.col);

    eb.moveRight();
    const after_move3 = eb.getCursor(0).?;
    // Should reach append position (line_width) and stay there
    try std.testing.expectEqual(after_move2.col, after_move3.col);
}

test "EditBuffer - insert after tab and move around" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("\t");
    const tab_width = eb.getCursor(0).?.col;

    try eb.insertText("x");
    const after_x = eb.getCursor(0).?;

    eb.moveLeft();
    const before_x = eb.getCursor(0).?;
    try std.testing.expectEqual(tab_width, before_x.col);

    eb.moveRight();
    const back_at_x = eb.getCursor(0).?;
    try std.testing.expectEqual(after_x.col, back_at_x.col);

    // Already at append position (after 'x'), can't move further on single line
    eb.moveRight();
    const still_at_x = eb.getCursor(0).?;
    try std.testing.expectEqual(back_at_x.col, still_at_x.col);
}

test "EditBuffer - cursor stuck after typing around tab" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("hello\tworld");
    try eb.setCursor(0, 5);

    eb.moveRight();
    const pos1 = eb.getCursor(0).?;

    eb.moveRight();
    const pos2 = eb.getCursor(0).?;
    try std.testing.expect(pos2.col > pos1.col);
}

test "EditBuffer - complex tab scenario" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("\tx\ty");
    try eb.setCursor(0, 0);

    const line_width = iter_mod.lineWidthAt(&eb.tb.rope, 0);

    eb.moveRight();
    const p1 = eb.getCursor(0).?;

    eb.moveRight();
    const p2 = eb.getCursor(0).?;
    try std.testing.expect(p2.col > p1.col);

    eb.moveRight();
    const p3 = eb.getCursor(0).?;
    try std.testing.expect(p3.col > p2.col);

    eb.moveRight();
    const p4 = eb.getCursor(0).?;
    try std.testing.expect(p4.col > p3.col);
    try std.testing.expectEqual(line_width, p4.col);

    // Already at append position, can't move further
    eb.moveRight();
    const p5 = eb.getCursor(0).?;
    try std.testing.expectEqual(p4.col, p5.col);
}

test "EditBuffer - cursor stuck at tab in middle of line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("a\tb");
    try eb.setCursor(0, 1);

    var buffer: [100]u8 = undefined;
    _ = eb.getText(&buffer);

    eb.moveRight();
    const p1 = eb.getCursor(0).?;

    eb.moveRight();
    const p2 = eb.getCursor(0).?;
    try std.testing.expect(p2.col > p1.col);
}

test "EditBuffer - type between tabs then move right" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("\t\t");
    try eb.setCursor(0, 2);
    try eb.insertText("x");

    const line_width = iter_mod.lineWidthAt(&eb.tb.rope, 0);
    const after_insert = eb.getCursor(0).?;

    eb.moveRight();
    const p1 = eb.getCursor(0).?;
    try std.testing.expect(p1.col > after_insert.col);
    try std.testing.expectEqual(line_width, p1.col);

    // Already at append position, can't move further
    eb.moveRight();
    const p2 = eb.getCursor(0).?;
    try std.testing.expectEqual(p1.col, p2.col);
}

test "EditBuffer - tabs only with cursor movement" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("\t\t\t");
    try eb.setCursor(0, 0);

    var prev_col: u32 = 0;
    var i: u32 = 0;
    while (i < 5) : (i += 1) {
        _ = iter_mod.lineWidthAt(&eb.tb.rope, 0);
        _ = iter_mod.getGraphemeWidthAt(&eb.tb.rope, &eb.tb.mem_registry, 0, prev_col, eb.tb.tab_width, eb.tb.width_method);
        eb.moveRight();
        const cursor = eb.getCursor(0).?;
        try std.testing.expect(cursor.col >= prev_col);
        prev_col = cursor.col;
    }
}

// ===== getTextRange Tests =====

test "EditBuffer - getTextRange basic ASCII" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello World");

    var buffer: [100]u8 = undefined;
    const len = try eb.getTextRange(0, 5, &buffer);
    try std.testing.expectEqualStrings("Hello", buffer[0..len]);
}

test "EditBuffer - getTextRange full text" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello World");

    var buffer: [100]u8 = undefined;
    const len = try eb.getTextRange(0, 11, &buffer);
    try std.testing.expectEqualStrings("Hello World", buffer[0..len]);
}

test "EditBuffer - getTextRange with emojis" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello 👋 World");

    var buffer: [100]u8 = undefined;
    // "Hello " = 6 cols, emoji = 2 cols, so emoji is at offset 6-8
    const len = try eb.getTextRange(6, 8, &buffer);
    try std.testing.expectEqualStrings("👋", buffer[0..len]);
}

test "EditBuffer - getTextRange emoji with skin tone" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Waving hand with medium skin tone
    try eb.insertText("Hi 👋🏽 there");

    var buffer: [100]u8 = undefined;
    // "Hi " = 3 cols, emoji = 2 cols
    const len = try eb.getTextRange(3, 5, &buffer);
    try std.testing.expectEqualStrings("👋🏽", buffer[0..len]);
}

test "EditBuffer - getTextRange flag emoji" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // USA flag 🇺🇸 (regional indicator symbols)
    try eb.insertText("Flag: 🇺🇸 here");

    var buffer: [100]u8 = undefined;
    // "Flag: " = 6 cols, flag = 2 cols
    const len = try eb.getTextRange(6, 8, &buffer);
    try std.testing.expectEqualStrings("🇺🇸", buffer[0..len]);
}

test "EditBuffer - getTextRange family emoji" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Family emoji (ZWJ sequence): 👨‍👩‍👧‍👦
    try eb.insertText("Family: 👨‍👩‍👧‍👦 end");

    var buffer: [100]u8 = undefined;
    // "Family: " = 8 cols, family emoji should be 2 cols
    const len = try eb.getTextRange(8, 10, &buffer);
    try std.testing.expectEqualStrings("👨‍👩‍👧‍👦", buffer[0..len]);
}

test "EditBuffer - getTextRange Devanagari with combining marks" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // "नमस्ते" (Namaste in Devanagari) - 5 display columns with zero-width combining marks
    try eb.insertText("Say नमस्ते ok");

    var buffer: [100]u8 = undefined;
    // "Say " = 4 cols (0-3), "नमस्ते" = 5 cols (4-8), " " = col 9
    const len = try eb.getTextRange(4, 8, &buffer);
    try std.testing.expectEqualStrings("नमस्ते", buffer[0..len]);
}

test "EditBuffer - getTextRange CJK characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // "你好" (Hello in Chinese) - each character is 2 cols wide
    try eb.insertText("Say 你好 end");

    var buffer: [100]u8 = undefined;
    // "Say " = 4 cols, 你 = 2 cols, 好 = 2 cols
    const len = try eb.getTextRange(4, 8, &buffer);
    try std.testing.expectEqualStrings("你好", buffer[0..len]);
}

test "EditBuffer - getTextRange single CJK character" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("A 日 B");

    var buffer: [100]u8 = undefined;
    // "A " = 2 cols, 日 = 2 cols at offset 2-4
    const len = try eb.getTextRange(2, 4, &buffer);
    try std.testing.expectEqualStrings("日", buffer[0..len]);
}

test "EditBuffer - getTextRange across lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello\nWorld");

    var buffer: [100]u8 = undefined;
    // "Hello" = 5 cols, newline = 1 weight, "Wo" = 2 cols
    const len = try eb.getTextRange(3, 8, &buffer);
    try std.testing.expectEqualStrings("lo\nWo", buffer[0..len]);
}

test "EditBuffer - getTextRange with tabs" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("A\tB");

    var buffer: [100]u8 = undefined;
    // Should include the tab character
    const len = try eb.getTextRange(0, 10, &buffer);
    try std.testing.expectEqualStrings("A\tB", buffer[0..len]);
}

test "EditBuffer - getTextRange partial grapheme snap to start" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // CJK character is 2 cols wide
    try eb.insertText("A 好 B");

    var buffer: [100]u8 = undefined;
    // Try to get range starting at middle of 好 (offset 3), should snap to start (offset 2)
    const len = try eb.getTextRange(3, 5, &buffer);
    try std.testing.expectEqualStrings("好 ", buffer[0..len]);
}

test "EditBuffer - getTextRange partial grapheme snap to end" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // CJK character is 2 cols wide
    try eb.insertText("A 好 B");

    var buffer: [100]u8 = undefined;
    // Try to get range ending at middle of 好 (offset 3), should snap to end (offset 4)
    const len = try eb.getTextRange(0, 3, &buffer);
    try std.testing.expectEqualStrings("A 好", buffer[0..len]);
}

test "EditBuffer - getTextRange empty range" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello");

    var buffer: [100]u8 = undefined;
    const len = try eb.getTextRange(5, 5, &buffer);
    try std.testing.expectEqual(@as(usize, 0), len);
}

test "EditBuffer - getTextRange out of bounds" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello");

    var buffer: [100]u8 = undefined;
    const len = try eb.getTextRange(0, 1000, &buffer);
    try std.testing.expectEqualStrings("Hello", buffer[0..len]);
}

test "EditBuffer - getTextRange mixed scripts" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Mix of ASCII, emoji, CJK, Devanagari
    try eb.insertText("Hi 👋 世界 नमस्ते");

    var buffer: [100]u8 = undefined;
    // Get everything
    const total_len = try eb.getTextRange(0, 100, &buffer);
    try std.testing.expectEqualStrings("Hi 👋 世界 नमस्ते", buffer[0..total_len]);

    // Get just the emoji
    const emoji_len = try eb.getTextRange(3, 5, &buffer);
    try std.testing.expectEqualStrings("👋", buffer[0..emoji_len]);

    // Get the CJK part: "Hi " = 3, "👋 " = 3, "世界" = 4 (cols 6-10)
    const cjk_len = try eb.getTextRange(6, 10, &buffer);
    try std.testing.expectEqualStrings("世界", buffer[0..cjk_len]);
}

test "EditBuffer - getTextRange before cursor" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello World");
    try eb.setCursor(0, 5);

    const cursor = eb.getCursor(0).?;
    var buffer: [100]u8 = undefined;

    // Get text before cursor
    const len = try eb.getTextRange(0, cursor.offset, &buffer);
    try std.testing.expectEqualStrings("Hello", buffer[0..len]);
}

test "EditBuffer - getTextRange char before cursor" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hello World");
    try eb.setCursor(0, 5);

    const cursor = eb.getCursor(0).?;
    var buffer: [100]u8 = undefined;

    // Get last char before cursor (if cursor > 0)
    if (cursor.offset > 0) {
        const prev_width = iter_mod.getPrevGraphemeWidth(&eb.tb.rope, &eb.tb.mem_registry, cursor.row, cursor.col, eb.tb.tab_width, eb.tb.width_method);
        const len = try eb.getTextRange(cursor.offset - prev_width, cursor.offset, &buffer);
        try std.testing.expectEqualStrings("o", buffer[0..len]);
    }
}

test "EditBuffer - getTextRange emoji before cursor" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Hi 👋");
    try eb.setCursor(0, 5); // After emoji

    const cursor = eb.getCursor(0).?;
    var buffer: [100]u8 = undefined;

    // Get emoji before cursor
    const prev_width = iter_mod.getPrevGraphemeWidth(&eb.tb.rope, &eb.tb.mem_registry, cursor.row, cursor.col, eb.tb.tab_width, eb.tb.width_method);
    const len = try eb.getTextRange(cursor.offset - prev_width, cursor.offset, &buffer);
    try std.testing.expectEqualStrings("👋", buffer[0..len]);
}

test "EditBuffer - getTextRange multiline with emojis" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Line1 👋\nLine2 🎉\nLine3");

    var buffer: [100]u8 = undefined;
    // Get across all lines
    const len = try eb.getTextRange(0, 100, &buffer);
    try std.testing.expectEqualStrings("Line1 👋\nLine2 🎉\nLine3", buffer[0..len]);
}
