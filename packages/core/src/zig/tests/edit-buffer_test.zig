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

    _ = iter_mod.getGraphemeWidthAt(&eb.tb.rope, &eb.tb.mem_registry, 0, cursor1.col, eb.tb.tab_width);

    eb.moveRight();
    const cursor2 = eb.getCursor(0).?;
    const line_width2 = iter_mod.lineWidthAt(&eb.tb.rope, 0);
    const gw2 = iter_mod.getGraphemeWidthAt(&eb.tb.rope, &eb.tb.mem_registry, 0, cursor2.col, eb.tb.tab_width);
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
        _ = iter_mod.getGraphemeWidthAt(&eb.tb.rope, &eb.tb.mem_registry, 0, prev_col, eb.tb.tab_width);
        eb.moveRight();
        const cursor = eb.getCursor(0).?;
        try std.testing.expect(cursor.col >= prev_col);
        prev_col = cursor.col;
    }
}
