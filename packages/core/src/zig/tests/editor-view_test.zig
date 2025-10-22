const std = @import("std");
const editor_view = @import("../editor-view.zig");
const edit_buffer = @import("../edit-buffer.zig");
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const gp = @import("../grapheme.zig");

const EditorView = editor_view.EditorView;
const EditBuffer = edit_buffer.EditBuffer;
const Cursor = edit_buffer.Cursor;
const Viewport = text_buffer_view.Viewport;

test "EditorView - init and deinit" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 24);
    defer ev.deinit();

    const vp = ev.getViewport();
    try std.testing.expect(vp != null);
    try std.testing.expectEqual(@as(u32, 80), vp.?.width);
    try std.testing.expectEqual(@as(u32, 24), vp.?.height);
    try std.testing.expectEqual(@as(u32, 0), vp.?.y);
}

test "EditorView - ensureCursorVisible scrolls down when cursor moves below viewport" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 10);
    defer ev.deinit();

    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\nLine 11\nLine 12\nLine 13\nLine 14\nLine 15\nLine 16\nLine 17\nLine 18\nLine 19");

    const cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 19), cursor.row);

    _ = ev.getVirtualLines();

    const vp = ev.getViewport().?;
    try std.testing.expect(vp.y > 0);
    try std.testing.expect(cursor.row >= vp.y);
    try std.testing.expect(cursor.row < vp.y + vp.height);
}

test "EditorView - ensureCursorVisible scrolls up when cursor moves above viewport" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 10);
    defer ev.deinit();

    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\nLine 11\nLine 12\nLine 13\nLine 14\nLine 15\nLine 16\nLine 17\nLine 18\nLine 19");

    _ = ev.getVirtualLines();

    var vp = ev.getViewport().?;
    try std.testing.expect(vp.y > 0);

    try eb.gotoLine(0);

    _ = ev.getVirtualLines();

    const cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 0), cursor.row);

    vp = ev.getViewport().?;
    try std.testing.expectEqual(@as(u32, 0), vp.y);
}

test "EditorView - moveDown scrolls viewport automatically" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 10);
    defer ev.deinit();

    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\nLine 11\nLine 12\nLine 13\nLine 14\nLine 15\nLine 16\nLine 17\nLine 18\nLine 19");

    try eb.setCursor(0, 0);
    _ = ev.getVirtualLines();
    var vp = ev.getViewport().?;
    try std.testing.expectEqual(@as(u32, 0), vp.y);

    var i: u32 = 0;
    while (i < 15) : (i += 1) {
        eb.moveDown();
    }

    _ = ev.getVirtualLines();

    const cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 15), cursor.row);

    vp = ev.getViewport().?;
    try std.testing.expect(cursor.row >= vp.y);
    try std.testing.expect(cursor.row < vp.y + vp.height);
}

test "EditorView - moveUp scrolls viewport automatically" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 10);
    defer ev.deinit();

    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\nLine 11\nLine 12\nLine 13\nLine 14\nLine 15\nLine 16\nLine 17\nLine 18\nLine 19");

    _ = ev.getVirtualLines();

    var vp = ev.getViewport().?;
    const initial_y = vp.y;
    try std.testing.expect(initial_y > 0);

    var i: u32 = 0;
    while (i < 10) : (i += 1) {
        eb.moveUp();
    }

    _ = ev.getVirtualLines();

    const cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 9), cursor.row);

    vp = ev.getViewport().?;
    try std.testing.expect(vp.y < initial_y);
    try std.testing.expect(cursor.row >= vp.y);
    try std.testing.expect(cursor.row < vp.y + vp.height);
}

test "EditorView - scroll margin keeps cursor away from edges" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 10);
    defer ev.deinit();

    ev.setScrollMargin(0.2);

    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\nLine 11\nLine 12\nLine 13\nLine 14\nLine 15\nLine 16\nLine 17\nLine 18\nLine 19");

    try eb.gotoLine(5);

    const cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 5), cursor.row);

    const vp = ev.getViewport().?;
    const cursor_offset_in_viewport = cursor.row - vp.y;

    try std.testing.expect(cursor_offset_in_viewport >= 2);
    try std.testing.expect(cursor_offset_in_viewport < vp.height - 2);
}

test "EditorView - insertText with newlines maintains cursor visibility" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 5);
    defer ev.deinit();

    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9");

    _ = ev.getVirtualLines();

    const cursor = ev.getPrimaryCursor();
    const vp = ev.getViewport().?;

    try std.testing.expect(cursor.row >= vp.y);
    try std.testing.expect(cursor.row < vp.y + vp.height);
}

test "EditorView - backspace at line start maintains visibility" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 5);
    defer ev.deinit();

    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9");

    try eb.backspace();

    _ = ev.getVirtualLines();

    const cursor = ev.getPrimaryCursor();
    const vp = ev.getViewport().?;

    try std.testing.expect(cursor.row >= vp.y);
    try std.testing.expect(cursor.row < vp.y + vp.height);
}

test "EditorView - deleteForward at line end maintains visibility" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 5);
    defer ev.deinit();

    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9");

    try eb.setCursor(8, 6);

    try eb.deleteForward();

    _ = ev.getVirtualLines();

    const cursor = ev.getPrimaryCursor();
    const vp = ev.getViewport().?;

    try std.testing.expect(cursor.row >= vp.y);
    try std.testing.expect(cursor.row < vp.y + vp.height);
}

test "EditorView - deleteRange maintains cursor visibility" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 5);
    defer ev.deinit();

    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9");

    try eb.deleteRange(.{ .row = 2, .col = 0 }, .{ .row = 7, .col = 6 });

    _ = ev.getVirtualLines();

    const cursor = ev.getPrimaryCursor();
    const vp = ev.getViewport().?;

    try std.testing.expect(cursor.row >= vp.y);
    try std.testing.expect(cursor.row < vp.y + vp.height);
}

test "EditorView - deleteLine maintains cursor visibility" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 5);
    defer ev.deinit();

    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9");

    try eb.gotoLine(7);

    try eb.deleteLine();

    _ = ev.getVirtualLines();

    const cursor = ev.getPrimaryCursor();
    const vp = ev.getViewport().?;

    try std.testing.expect(cursor.row >= vp.y);
    try std.testing.expect(cursor.row < vp.y + vp.height);
}

test "EditorView - setText resets viewport to top" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 5);
    defer ev.deinit();

    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9");

    _ = ev.getVirtualLines();

    var vp = ev.getViewport().?;
    try std.testing.expect(vp.y > 0);

    try eb.setText("New Line 0\nNew Line 1\nNew Line 2", false);

    const cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 0), cursor.row);

    _ = ev.getVirtualLines();

    vp = ev.getViewport().?;
    try std.testing.expectEqual(@as(u32, 0), vp.y);
}

test "EditorView - viewport respects total line count as max offset" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 10);
    defer ev.deinit();

    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4");

    try eb.gotoLine(4);

    const vp = ev.getViewport().?;
    try std.testing.expectEqual(@as(u32, 0), vp.y);
}

test "EditorView - horizontal movement doesn't affect vertical scroll" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 10);
    defer ev.deinit();

    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4");

    try eb.setCursor(2, 0);

    const vp_before = ev.getViewport().?;

    eb.moveRight();
    eb.moveRight();
    eb.moveRight();

    const vp_after = ev.getViewport().?;
    try std.testing.expectEqual(vp_before.y, vp_after.y);
}

test "EditorView - cursor at boundaries doesn't cause invalid viewport" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 10);
    defer ev.deinit();

    try eb.setCursor(0, 0);

    var vp = ev.getViewport().?;
    try std.testing.expectEqual(@as(u32, 0), vp.y);

    try eb.insertText("First line");

    try eb.setCursor(0, 0);

    vp = ev.getViewport().?;
    try std.testing.expectEqual(@as(u32, 0), vp.y);

    eb.moveLeft();
    vp = ev.getViewport().?;
    try std.testing.expectEqual(@as(u32, 0), vp.y);

    eb.moveUp();
    vp = ev.getViewport().?;
    try std.testing.expectEqual(@as(u32, 0), vp.y);
}

test "EditorView - rapid cursor movements maintain visibility" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 10);
    defer ev.deinit();

    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\nLine 11\nLine 12\nLine 13\nLine 14\nLine 15\nLine 16\nLine 17\nLine 18\nLine 19\nLine 20\nLine 21\nLine 22\nLine 23\nLine 24\nLine 25\nLine 26\nLine 27\nLine 28\nLine 29");

    try eb.gotoLine(0);
    try eb.gotoLine(29);
    try eb.gotoLine(15);
    try eb.gotoLine(5);
    try eb.gotoLine(25);

    _ = ev.getVirtualLines();

    const cursor = ev.getPrimaryCursor();
    const vp = ev.getViewport().?;

    try std.testing.expect(cursor.row >= vp.y);
    try std.testing.expect(cursor.row < vp.y + vp.height);
}

// ============================================================================
// VisualCursor Tests - Wrapping-aware cursor translation
// ============================================================================

test "EditorView - VisualCursor without wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 10);
    defer ev.deinit();

    try eb.insertText("Hello World\nSecond Line\nThird Line");

    try eb.setCursor(1, 3);

    const vcursor = ev.getVisualCursor();
    try std.testing.expectEqual(@as(u32, 1), vcursor.visual_row);
    try std.testing.expectEqual(@as(u32, 3), vcursor.visual_col);
    try std.testing.expectEqual(@as(u32, 1), vcursor.logical_row);
    try std.testing.expectEqual(@as(u32, 3), vcursor.logical_col);
}

test "EditorView - VisualCursor with character wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    ev.setWrapMode(.char);

    try eb.setText("This is a very long line that will definitely wrap at 20 characters", false);

    try eb.setCursor(0, 25);

    const vcursor = ev.getVisualCursor();
    try std.testing.expectEqual(@as(u32, 0), vcursor.logical_row);
    try std.testing.expectEqual(@as(u32, 25), vcursor.logical_col);
    try std.testing.expect(vcursor.visual_row > 0);
    try std.testing.expect(vcursor.visual_col <= 20);
}

test "EditorView - VisualCursor with word wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    ev.setWrapMode(.word);

    try eb.setText("Hello world this is a test of word wrapping", false);

    const line_count = eb.getTextBuffer().getLineCount();
    try std.testing.expectEqual(@as(u32, 1), line_count);

    _ = ev.getVisualCursor();
}

test "EditorView - moveUpVisual with wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    ev.setWrapMode(.char);

    try eb.setText("This is a very long line that will definitely wrap multiple times at twenty characters", false);

    try eb.setCursor(0, 50);

    const vcursor_before = ev.getVisualCursor();
    const visual_row_before = vcursor_before.visual_row;

    ev.moveUpVisual();

    const vcursor_after = ev.getVisualCursor();

    try std.testing.expectEqual(visual_row_before - 1, vcursor_after.visual_row);

    try std.testing.expectEqual(@as(u32, 0), vcursor_after.logical_row);
}

test "EditorView - moveDownVisual with wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    ev.setWrapMode(.char);

    try eb.setText("This is a very long line that will definitely wrap multiple times at twenty characters", false);

    try eb.setCursor(0, 0);

    const vcursor_before = ev.getVisualCursor();
    try std.testing.expectEqual(@as(u32, 0), vcursor_before.visual_row);

    ev.moveDownVisual();

    const vcursor_after = ev.getVisualCursor();

    try std.testing.expectEqual(@as(u32, 1), vcursor_after.visual_row);

    try std.testing.expectEqual(@as(u32, 0), vcursor_after.logical_row);
}

test "EditorView - visualToLogicalCursor conversion" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    ev.setWrapMode(.char);

    try eb.setText("12345678901234567890123456789012345", false);

    if (ev.visualToLogicalCursor(1, 5)) |vcursor| {
        try std.testing.expectEqual(@as(u32, 1), vcursor.visual_row);
        try std.testing.expectEqual(@as(u32, 0), vcursor.logical_row);
        try std.testing.expectEqual(@as(u32, 25), vcursor.logical_col);
    }
}

test "EditorView - moveUpVisual at top boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    ev.setWrapMode(.char);
    try eb.setText("Short line", false);

    try eb.setCursor(0, 0);

    const before = ev.getPrimaryCursor();
    ev.moveUpVisual();
    const after = ev.getPrimaryCursor();

    try std.testing.expectEqual(before.row, after.row);
    try std.testing.expectEqual(before.col, after.col);
}

test "EditorView - moveDownVisual at bottom boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    ev.setWrapMode(.char);
    try eb.setText("Short line\nSecond line", false);

    try eb.setCursor(1, 0);

    const before = ev.getPrimaryCursor();
    ev.moveDownVisual();
    const after = ev.getPrimaryCursor();

    try std.testing.expectEqual(before.row, after.row);
}

test "EditorView - VisualCursor preserves desired column across wrapped lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    ev.setWrapMode(.char);

    try eb.setText("12345678901234567890123456789012345678901234567890", false);

    try eb.setCursor(0, 15);

    ev.moveDownVisual();
    ev.moveDownVisual();
    ev.moveUpVisual();

    const vcursor = ev.getVisualCursor();

    try std.testing.expect(vcursor.visual_col <= 20);
}

test "EditorView - VisualCursor with multiple logical lines and wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    ev.setWrapMode(.char);

    try eb.setText("Short line 1\nThis is a very long line that will wrap multiple times\nShort line 3", false);

    try eb.setCursor(1, 30);

    const vcursor = ev.getVisualCursor();
    try std.testing.expectEqual(@as(u32, 1), vcursor.logical_row);

    try std.testing.expect(vcursor.visual_row > 1);
}

test "EditorView - logicalToVisualCursor handles cursor past line end" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 10);
    defer ev.deinit();

    try eb.setText("Short", false);

    const vcursor = ev.logicalToVisualCursor(0, 100);

    try std.testing.expectEqual(@as(u32, 0), vcursor.logical_row);
}

test "EditorView - getTextBufferView returns correct view" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 10);
    defer ev.deinit();

    const tbv = ev.getTextBufferView();
    const vp = tbv.getViewport();
    try std.testing.expect(vp != null);
}

test "EditorView - getEditBuffer returns correct buffer" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 10);
    defer ev.deinit();

    const returned_eb = ev.getEditBuffer();
    try std.testing.expect(returned_eb == eb);
}

test "EditorView - setViewportSize maintains cursor visibility" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 10);
    defer ev.deinit();

    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\nLine 11\nLine 12\nLine 13\nLine 14");

    try eb.gotoLine(10);

    ev.setViewportSize(80, 5);

    const vp = ev.getViewport().?;
    try std.testing.expectEqual(@as(u32, 80), vp.width);
    try std.testing.expectEqual(@as(u32, 5), vp.height);

    // setViewportSize doesn't automatically adjust scroll position
}

test "EditorView - moveDownVisual across empty line preserves desired column" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 10);
    defer ev.deinit();

    try eb.setText("Line with some text\n\nAnother line with text", false);

    try eb.setCursor(0, 10);

    const vcursor_before = ev.getVisualCursor();
    try std.testing.expectEqual(@as(u32, 10), vcursor_before.visual_col);

    ev.moveDownVisual();

    const vcursor_empty = ev.getVisualCursor();
    try std.testing.expectEqual(@as(u32, 1), vcursor_empty.logical_row);
    try std.testing.expectEqual(@as(u32, 0), vcursor_empty.visual_col);

    ev.moveDownVisual();

    const vcursor_after = ev.getVisualCursor();
    try std.testing.expectEqual(@as(u32, 2), vcursor_after.logical_row);
    try std.testing.expectEqual(@as(u32, 10), vcursor_after.visual_col);
}

test "EditorView - moveUpVisual across empty line preserves desired column" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 10);
    defer ev.deinit();

    try eb.setText("Line with some text\n\nAnother line with text", false);

    try eb.setCursor(2, 10);

    const vcursor_before = ev.getVisualCursor();
    try std.testing.expectEqual(@as(u32, 10), vcursor_before.visual_col);

    ev.moveUpVisual();

    const vcursor_empty = ev.getVisualCursor();
    try std.testing.expectEqual(@as(u32, 1), vcursor_empty.logical_row);
    try std.testing.expectEqual(@as(u32, 0), vcursor_empty.visual_col);

    ev.moveUpVisual();

    const vcursor_after = ev.getVisualCursor();
    try std.testing.expectEqual(@as(u32, 0), vcursor_after.logical_row);
    try std.testing.expectEqual(@as(u32, 10), vcursor_after.visual_col);
}

test "EditorView - horizontal movement resets desired visual column" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 10);
    defer ev.deinit();

    try eb.setText("Line with some text\n\nAnother line with text", false);

    try eb.setCursor(0, 10);

    const vcursor_initial = ev.getVisualCursor();
    try std.testing.expectEqual(@as(u32, 10), vcursor_initial.visual_col);

    ev.moveDownVisual();
    ev.moveDownVisual();

    const vcursor_after = ev.getVisualCursor();
    try std.testing.expectEqual(@as(u32, 2), vcursor_after.logical_row);
    try std.testing.expectEqual(@as(u32, 10), vcursor_after.visual_col);

    eb.moveRight();

    const vcursor_after_right = ev.getVisualCursor();
    try std.testing.expectEqual(@as(u32, 11), vcursor_after_right.visual_col);

    ev.moveUpVisual();
    ev.moveUpVisual();

    const vcursor_final = ev.getVisualCursor();
    try std.testing.expectEqual(@as(u32, 0), vcursor_final.logical_row);
    try std.testing.expectEqual(@as(u32, 11), vcursor_final.visual_col);
}

test "EditorView - inserting newlines maintains rope integrity" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    try eb.insertText("Line 0\nLine 1\nLine 2");

    const rope_init = &eb.getTextBuffer().rope;
    const line_count_init = eb.getTextBuffer().lineCount();
    try std.testing.expectEqual(@as(u32, 3), line_count_init);

    try eb.insertText("\n");

    const line_count_1 = eb.getTextBuffer().lineCount();
    try std.testing.expectEqual(@as(u32, 4), line_count_1);

    if (rope_init.getMarker(.linestart, 2)) |m2| {
        if (rope_init.getMarker(.linestart, 3)) |m3| {
            try std.testing.expect(m2.global_weight != m3.global_weight);
        }
    }

    try eb.insertText("\n");

    const line_count_2 = eb.getTextBuffer().lineCount();
    try std.testing.expectEqual(@as(u32, 5), line_count_2);

    if (rope_init.getMarker(.linestart, 3)) |m3| {
        if (rope_init.getMarker(.linestart, 4)) |m4| {
            try std.testing.expect(m3.global_weight != m4.global_weight);
        }
    }
}

test "EditorView - visual cursor stays in sync after scrolling and moving up" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 10);
    defer ev.deinit();

    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4");

    var cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 4), cursor.row);
    try std.testing.expectEqual(@as(u32, 6), cursor.col);

    _ = ev.getVirtualLines();

    var vp = ev.getViewport().?;
    try std.testing.expectEqual(@as(u32, 0), vp.y);

    var i: u32 = 0;
    while (i < 6) : (i += 1) {
        try eb.insertText("\n");
        _ = ev.getVirtualLines();
    }

    cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 10), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);

    vp = ev.getViewport().?;
    try std.testing.expect(vp.y > 0);

    const vcursor_before = ev.getVisualCursor();
    try std.testing.expectEqual(@as(u32, 10), vcursor_before.logical_row);

    ev.moveUpVisual();
    _ = ev.getVirtualLines();

    const vcursor_after_up = ev.getVisualCursor();
    const logical_cursor_after_up = ev.getPrimaryCursor();

    try std.testing.expectEqual(@as(u32, 9), logical_cursor_after_up.row);
    try std.testing.expectEqual(@as(u32, 9), vcursor_after_up.logical_row);

    try std.testing.expect(vcursor_after_up.visual_row < vcursor_before.visual_row);

    try eb.insertText("X");
    _ = ev.getVirtualLines();

    const cursor_after_insert = ev.getPrimaryCursor();
    const vcursor_after_insert = ev.getVisualCursor();

    try std.testing.expectEqual(@as(u32, 9), cursor_after_insert.row);
    try std.testing.expectEqual(@as(u32, 1), cursor_after_insert.col);

    try std.testing.expectEqual(@as(u32, 9), vcursor_after_insert.logical_row);
    try std.testing.expectEqual(@as(u32, 1), vcursor_after_insert.logical_col);

    var out_buffer: [200]u8 = undefined;
    const written = eb.getText(&out_buffer);
    const text = out_buffer[0..written];

    var line_count: u32 = 0;
    var line_start: usize = 0;
    for (text, 0..) |c, idx| {
        if (c == '\n') {
            if (line_count == 9) {
                const line_9 = text[line_start..idx];
                try std.testing.expect(line_9.len >= 1);
                try std.testing.expectEqual(@as(u8, 'X'), line_9[0]);
                break;
            }
            line_count += 1;
            line_start = idx + 1;
        }
    }
}

test "EditorView - cursor positioning after wide grapheme" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 10);
    defer ev.deinit();

    try eb.insertText("AB東CD");

    const cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 6), cursor.col);

    try eb.setCursor(0, 4);
    const cursor_after_move = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 4), cursor_after_move.col);

    const vcursor = ev.getVisualCursor();
    try std.testing.expectEqual(@as(u32, 0), vcursor.logical_row);
    try std.testing.expectEqual(@as(u32, 4), vcursor.logical_col);
    try std.testing.expectEqual(@as(u32, 4), vcursor.visual_col);
}

test "EditorView - backspace after wide grapheme updates cursor correctly" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 10);
    defer ev.deinit();

    try eb.insertText("AB東CD");

    try eb.setCursor(0, 4);

    try eb.backspace();

    const cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 2), cursor.col);

    const vcursor = ev.getVisualCursor();
    try std.testing.expectEqual(@as(u32, 2), vcursor.logical_col);
    try std.testing.expectEqual(@as(u32, 2), vcursor.visual_col);

    var out_buffer: [100]u8 = undefined;
    const written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("ABCD", out_buffer[0..written]);
}

test "EditorView - viewport scrolling with wrapped lines: down + edit + up" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    const tbv = ev.getTextBufferView();
    tbv.setWrapMode(.char);
    ev.setViewport(Viewport{ .x = 0, .y = 0, .width = 20, .height = 10 });

    try eb.setText("AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDDEEEEEEEEEEFFFFFFFFFFFFGGGGGGGGGGHHHHHHHHHHIIIIIIIIIIJJJJJJJJJJKKKKKKKKKKLLLLLLLLLLMMMMMMMMMMNNNNNNNNNNOOOOOOOOOOPPPPPPPPPPQQQQQQQQQQRRRRRRRRRRSSSSSSSSSSTTTTTTTTTTUUUUUUUUUUVVVVVVVVVVWWWWWWWWWWXXXXXXXXXXYYYYYYYYYYZZZZZZZZZZ", false);

    try eb.setCursor(0, 0);
    _ = ev.getVirtualLines();

    var vp = ev.getViewport().?;
    const initial_vp_y = vp.y;
    try std.testing.expectEqual(@as(u32, 0), initial_vp_y);

    ev.moveDownVisual();
    ev.moveDownVisual();
    ev.moveDownVisual();
    _ = ev.getVirtualLines();

    vp = ev.getViewport().?;
    _ = vp.y;

    _ = ev.getVisualCursor();

    try eb.insertText("X");
    _ = ev.getVirtualLines();

    vp = ev.getViewport().?;
    _ = vp.y;

    ev.moveUpVisual();
    ev.moveUpVisual();
    ev.moveUpVisual();
    _ = ev.getVirtualLines();

    vp = ev.getViewport().?;
    const final_vp_y = vp.y;

    const vcursor_final = ev.getVisualCursor();

    try std.testing.expectEqual(@as(u32, 0), vcursor_final.visual_row);
    try std.testing.expectEqual(@as(u32, 0), final_vp_y);
}

test "EditorView - viewport scrolling with wrapped lines: aggressive down + edit + up sequence" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    const tbv = ev.getTextBufferView();
    tbv.setWrapMode(.char);
    ev.setViewport(Viewport{ .x = 0, .y = 0, .width = 20, .height = 10 });

    try eb.setText("AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDDEEEEEEEEEEFFFFFFFFFFFFGGGGGGGGGGHHHHHHHHHHIIIIIIIIIIJJJJJJJJJJKKKKKKKKKKLLLLLLLLLLMMMMMMMMMMNNNNNNNNNNOOOOOOOOOOPPPPPPPPPPQQQQQQQQQQRRRRRRRRRRSSSSSSSSSSTTTTTTTTTTUUUUUUUUUUVVVVVVVVVVWWWWWWWWWWXXXXXXXXXXYYYYYYYYYYZZZZZZZZZZ", false);

    try eb.setCursor(0, 0);
    _ = ev.getVirtualLines();

    const total_vlines = ev.getTotalVirtualLineCount();
    try std.testing.expect(total_vlines > 10);

    var vp = ev.getViewport().?;
    try std.testing.expectEqual(@as(u32, 0), vp.y);

    var i: u32 = 0;
    while (i < 12) : (i += 1) {
        ev.moveDownVisual();
    }
    _ = ev.getVirtualLines();

    vp = ev.getViewport().?;
    try std.testing.expect(vp.y > 0);

    try eb.insertText("TEST");
    _ = ev.getVirtualLines();

    i = 0;
    while (i < 12) : (i += 1) {
        ev.moveUpVisual();
    }
    _ = ev.getVirtualLines();

    vp = ev.getViewport().?;
    const vcursor = ev.getVisualCursor();

    try std.testing.expectEqual(@as(u32, 0), vcursor.visual_row);
    try std.testing.expectEqual(@as(u32, 0), vp.y);
}

test "EditorView - viewport scrolling with wrapped lines: multiple edits and movements" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 15, 8);
    defer ev.deinit();

    const tbv = ev.getTextBufferView();
    tbv.setWrapMode(.char);
    ev.setViewport(Viewport{ .x = 0, .y = 0, .width = 15, .height = 8 });

    try eb.setText("AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDDEEEEEEEEEEFFFFFFFFFFFFGGGGGGGGGGHHHHHHHHHHIIIIIIIIIIJJJJJJJJJJKKKKKKKKKKLLLLLLLLLLMMMMMMMMMMNNNNNNNNNNOOOOOOOOOOPPPPPPPPPPQQQQQQQQQQRRRRRRRRRRSSSSSSSSSSTTTTTTTTTTUUUUUUUUUUVVVVVVVVVV", false);

    try eb.setCursor(0, 0);
    _ = ev.getVirtualLines();

    ev.moveDownVisual();
    ev.moveDownVisual();
    _ = ev.getVirtualLines();

    try eb.insertText("A");
    _ = ev.getVirtualLines();

    ev.moveDownVisual();
    _ = ev.getVirtualLines();

    try eb.insertText("B");
    _ = ev.getVirtualLines();

    ev.moveUpVisual();
    ev.moveUpVisual();
    ev.moveUpVisual();
    _ = ev.getVirtualLines();

    const vp = ev.getViewport().?;
    const vcursor = ev.getVisualCursor();

    try std.testing.expectEqual(@as(u32, 0), vcursor.visual_row);
    try std.testing.expectEqual(@as(u32, 0), vp.y);
}

test "EditorView - viewport scrolling with wrapped lines: verify viewport consistency" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    const tbv = ev.getTextBufferView();
    tbv.setWrapMode(.char);
    ev.setViewport(Viewport{ .x = 0, .y = 0, .width = 20, .height = 10 });

    try eb.setText("AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDDEEEEEEEEEEFFFFFFFFFFFFGGGGGGGGGGHHHHHHHHHHIIIIIIIIIIJJJJJJJJJJKKKKKKKKKKLLLLLLLLLLMMMMMMMMMMNNNNNNNNNNOOOOOOOOOOPPPPPPPPPPQQQQQQQQQQRRRRRRRRRRSSSSSSSSSSTTTTTTTTTTUUUUUUUUUUVVVVVVVVVVWWWWWWWWWWXXXXXXXXXXYYYYYYYYYYZZZZZZZZZZ", false);

    try eb.setCursor(0, 0);
    _ = ev.getVirtualLines();

    const vline_count = ev.getTotalVirtualLineCount();
    try std.testing.expect(vline_count >= 10);

    var movements_down: u32 = 0;
    var i: u32 = 0;
    while (i < 5) : (i += 1) {
        const vcursor_before = ev.getVisualCursor();
        ev.moveDownVisual();
        const vcursor_after = ev.getVisualCursor();
        if (true) {
            if (vcursor_after.visual_row > vcursor_before.visual_row) {
                movements_down += 1;
            }
        }
    }
    _ = ev.getVirtualLines();

    _ = ev.getViewport().?;
    _ = ev.getVisualCursor();

    try eb.insertText("EDITED");
    _ = ev.getVirtualLines();

    i = 0;
    while (i < movements_down) : (i += 1) {
        ev.moveUpVisual();
    }
    _ = ev.getVirtualLines();

    const vp_final = ev.getViewport().?;
    const vcursor_final = ev.getVisualCursor();

    try std.testing.expectEqual(@as(u32, 0), vcursor_final.visual_row);
    try std.testing.expectEqual(@as(u32, 0), vp_final.y);
}

test "EditorView - viewport scrolling with wrapped lines: backspace after scroll" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    const tbv = ev.getTextBufferView();
    tbv.setWrapMode(.char);
    ev.setViewport(Viewport{ .x = 0, .y = 0, .width = 20, .height = 10 });

    try eb.setText("AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDDEEEEEEEEEEFFFFFFFFFFFFGGGGGGGGGGHHHHHHHHHHIIIIIIIIIIJJJJJJJJJJKKKKKKKKKKLLLLLLLLLLMMMMMMMMMMNNNNNNNNNNOOOOOOOOOOPPPPPPPPPPQQQQQQQQQQRRRRRRRRRRSSSSSSSSSSTTTTTTTTTTUUUUUUUUUUVVVVVVVVVVWWWWWWWWWWXXXXXXXXXXYYYYYYYYYYZZZZZZZZZZ", false);

    try eb.setCursor(0, 0);
    _ = ev.getVirtualLines();

    ev.moveDownVisual();
    ev.moveDownVisual();
    _ = ev.getVirtualLines();

    try eb.backspace();
    _ = ev.getVirtualLines();

    ev.moveUpVisual();
    ev.moveUpVisual();
    _ = ev.getVirtualLines();

    const vp = ev.getViewport().?;
    const vcursor = ev.getVisualCursor();

    try std.testing.expectEqual(@as(u32, 0), vcursor.visual_row);
    try std.testing.expectEqual(@as(u32, 0), vp.y);
}

test "EditorView - viewport scrolling with wrapped lines: viewport follows cursor precisely" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 5);
    defer ev.deinit();

    const tbv = ev.getTextBufferView();
    tbv.setWrapMode(.char);
    ev.setViewport(Viewport{ .x = 0, .y = 0, .width = 20, .height = 5 });

    try eb.setText("AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDDEEEEEEEEEEFFFFFFFFFFFFGGGGGGGGGGHHHHHHHHHHIIIIIIIIIIJJJJJJJJJJKKKKKKKKKKLLLLLLLLLLMMMMMMMMMMNNNNNNNNNNOOOOOOOOOOPPPPPPPPPPQQQQQQQQQQRRRRRRRRRRSSSSSSSSSSTTTTTTTTTTUUUUUUUUUUVVVVVVVVVVWWWWWWWWWWXXXXXXXXXXYYYYYYYYYYZZZZZZZZZZ", false);

    try eb.setCursor(0, 0);
    _ = ev.getVirtualLines();

    var i: u32 = 0;
    while (i < 10) : (i += 1) {
        ev.moveDownVisual();
        _ = ev.getVirtualLines();

        const vp = ev.getViewport().?;
        const vcursor = ev.getVisualCursor();

        // visual_row is now viewport-relative, should be in range [0, vp.height)
        try std.testing.expect(vcursor.visual_row >= 0);
        try std.testing.expect(vcursor.visual_row < vp.height);
    }

    try eb.insertText("MIDDLE");
    _ = ev.getVirtualLines();

    const vp_middle = ev.getViewport().?;
    const vcursor_middle = ev.getVisualCursor();
    // visual_row is now viewport-relative, should be in range [0, vp.height)
    try std.testing.expect(vcursor_middle.visual_row >= 0);
    try std.testing.expect(vcursor_middle.visual_row < vp_middle.height);

    i = 0;
    while (i < 10) : (i += 1) {
        ev.moveUpVisual();
        _ = ev.getVirtualLines();

        const vp = ev.getViewport().?;
        const vcursor = ev.getVisualCursor();

        // visual_row is now viewport-relative, should be in range [0, vp.height)
        try std.testing.expect(vcursor.visual_row >= 0);
        try std.testing.expect(vcursor.visual_row < vp.height);
    }

    const vp_final = ev.getViewport().?;
    const vcursor_final = ev.getVisualCursor();

    try std.testing.expectEqual(@as(u32, 0), vcursor_final.visual_row);
    try std.testing.expectEqual(@as(u32, 0), vp_final.y);
}

test "EditorView - wrapped lines: specific scenario with insert and deletions" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    const tbv = ev.getTextBufferView();
    tbv.setWrapMode(.char);
    ev.setViewport(Viewport{ .x = 0, .y = 0, .width = 20, .height = 10 });

    try eb.setText("AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDDEEEEEEEEEEFFFFFFFFFFFFGGGGGGGGGGHHHHHHHHHHIIIIIIIIIIJJJJJJJJJJKKKKKKKKKKLLLLLLLLLLMMMMMMMMMMNNNNNNNNNNOOOOOOOOOOPPPPPPPPPPQQQQQQQQQQRRRRRRRRRRSSSSSSSSSSTTTTTTTTTTUUUUUUUUUUVVVVVVVVVVWWWWWWWWWWXXXXXXXXXXYYYYYYYYYYZZZZZZZZZZ", false);

    try eb.setCursor(0, 0);
    _ = ev.getVirtualLines();

    var vp = ev.getViewport().?;
    try std.testing.expectEqual(@as(u32, 0), vp.y);

    ev.moveDownVisual();
    ev.moveDownVisual();
    ev.moveDownVisual();
    ev.moveDownVisual();
    ev.moveDownVisual();
    _ = ev.getVirtualLines();

    vp = ev.getViewport().?;
    const vcursor_mid = ev.getVisualCursor();
    try std.testing.expectEqual(@as(u32, 5), vcursor_mid.visual_row);

    try eb.insertText("XXX");
    _ = ev.getVirtualLines();

    vp = ev.getViewport().?;
    const vcursor_after_insert = ev.getVisualCursor();
    // visual_row is now viewport-relative, should be in range [0, vp.height)
    try std.testing.expect(vcursor_after_insert.visual_row >= 0);
    try std.testing.expect(vcursor_after_insert.visual_row < vp.height);

    try eb.backspace();
    try eb.backspace();
    try eb.backspace();
    _ = ev.getVirtualLines();

    ev.moveUpVisual();
    ev.moveUpVisual();
    ev.moveUpVisual();
    ev.moveUpVisual();
    ev.moveUpVisual();
    _ = ev.getVirtualLines();

    vp = ev.getViewport().?;
    const vcursor_final2 = ev.getVisualCursor();

    try std.testing.expectEqual(@as(u32, 0), vcursor_final2.visual_row);
    try std.testing.expectEqual(@as(u32, 0), vp.y);
}

test "EditorView - wrapped lines: many small edits with viewport scrolling" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 15, 8);
    defer ev.deinit();

    const tbv = ev.getTextBufferView();
    tbv.setWrapMode(.char);
    ev.setViewport(Viewport{ .x = 0, .y = 0, .width = 15, .height = 8 });

    try eb.setText("AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDDEEEEEEEEEEFFFFFFFFFFFFGGGGGGGGGGHHHHHHHHHHIIIIIIIIIIJJJJJJJJJJKKKKKKKKKKLLLLLLLLLLMMMMMMMMMMNNNNNNNNNNOOOOOOOOOOPPPPPPPPPPQQQQQQQQQQRRRRRRRRRRSSSSSSSSSSTTTTTTTTTTUUUUUUUUUUVVVVVVVVVV", false);

    try eb.setCursor(0, 0);
    _ = ev.getVirtualLines();

    ev.moveDownVisual();
    ev.moveDownVisual();
    _ = ev.getVirtualLines();

    try eb.insertText("1");
    _ = ev.getVirtualLines();

    ev.moveDownVisual();
    _ = ev.getVirtualLines();

    try eb.insertText("2");
    _ = ev.getVirtualLines();

    ev.moveDownVisual();
    _ = ev.getVirtualLines();

    try eb.insertText("3");
    _ = ev.getVirtualLines();

    ev.moveUpVisual();
    _ = ev.getVirtualLines();

    try eb.insertText("4");
    _ = ev.getVirtualLines();

    ev.moveUpVisual();
    ev.moveUpVisual();
    ev.moveUpVisual();
    _ = ev.getVirtualLines();

    const vp2 = ev.getViewport().?;
    const vcursor2 = ev.getVisualCursor();

    try std.testing.expectEqual(@as(u32, 0), vcursor2.visual_row);
    try std.testing.expectEqual(@as(u32, 0), vp2.y);
}

test "EditorView - horizontal scroll: cursor moves right beyond viewport" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    try eb.setText("This is a very long line that exceeds the viewport width of 20 characters", false);

    try eb.setCursor(0, 0);
    _ = ev.getVirtualLines();

    var vp = ev.getViewport().?;
    try std.testing.expectEqual(@as(u32, 0), vp.x);

    try eb.setCursor(0, 50);
    _ = ev.getVirtualLines();

    vp = ev.getViewport().?;
    try std.testing.expect(vp.x > 0);

    const cursor = ev.getPrimaryCursor();
    try std.testing.expect(cursor.col >= vp.x);
    try std.testing.expect(cursor.col < vp.x + vp.width);
}

test "EditorView - horizontal scroll: cursor moves left to beginning" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    try eb.setText("This is a very long line that exceeds the viewport width of 20 characters", false);

    try eb.setCursor(0, 50);
    _ = ev.getVirtualLines();

    var vp = ev.getViewport().?;
    try std.testing.expect(vp.x > 0);

    try eb.setCursor(0, 0);
    _ = ev.getVirtualLines();

    vp = ev.getViewport().?;
    try std.testing.expectEqual(@as(u32, 0), vp.x);
}

test "EditorView - horizontal scroll: moveRight scrolls viewport" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    try eb.setText("AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDDEEEEEEEEEEFFFFFFFFFFFFGGGGGGGGGGHHHHHHHHHHIIIIIIIIIIJJJJJJJJJJKKKKKKKKKKLLLLLLLLLLMMMMMMMMMMNNNNNNNNNNOOOOOOOOOOPPPPPPPPPP", false);

    try eb.setCursor(0, 0);
    _ = ev.getVirtualLines();

    var vp = ev.getViewport().?;
    try std.testing.expectEqual(@as(u32, 0), vp.x);

    var i: u32 = 0;
    while (i < 50) : (i += 1) {
        eb.moveRight();
    }

    _ = ev.getVirtualLines();

    vp = ev.getViewport().?;
    try std.testing.expect(vp.x > 0);

    const cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 50), cursor.col);
    try std.testing.expect(cursor.col >= vp.x);
    try std.testing.expect(cursor.col < vp.x + vp.width);
}

test "EditorView - horizontal scroll: moveLeft scrolls viewport back" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    try eb.setText("AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDDEEEEEEEEEEFFFFFFFFFFFFGGGGGGGGGGHHHHHHHHHHIIIIIIIIIIJJJJJJJJJJKKKKKKKKKKLLLLLLLLLLMMMMMMMMMMNNNNNNNNNNOOOOOOOOOOPPPPPPPPPP", false);

    try eb.setCursor(0, 50);
    _ = ev.getVirtualLines();

    var vp = ev.getViewport().?;
    const initial_x = vp.x;
    try std.testing.expect(initial_x > 0);

    var i: u32 = 0;
    while (i < 30) : (i += 1) {
        eb.moveLeft();
    }

    _ = ev.getVirtualLines();

    vp = ev.getViewport().?;
    try std.testing.expect(vp.x < initial_x);

    const cursor = ev.getPrimaryCursor();
    try std.testing.expect(cursor.col >= vp.x);
    try std.testing.expect(cursor.col < vp.x + vp.width);
}

test "EditorView - horizontal scroll: editing in scrolled view" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    try eb.setText("AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDDEEEEEEEEEEFFFFFFFFFFFFGGGGGGGGGGHHHHHHHHHHIIIIIIIIIIJJJJJJJJJJKKKKKKKKKKLLLLLLLLLLMMMMMMMMMMNNNNNNNNNNOOOOOOOOOOPPPPPPPPPP", false);

    try eb.setCursor(0, 50);
    _ = ev.getVirtualLines();

    var vp = ev.getViewport().?;
    try std.testing.expect(vp.x > 0);

    try eb.insertText("XYZ");
    _ = ev.getVirtualLines();

    vp = ev.getViewport().?;
    const cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 53), cursor.col);
    try std.testing.expect(cursor.col >= vp.x);
    try std.testing.expect(cursor.col < vp.x + vp.width);

    var out_buffer: [200]u8 = undefined;
    const written = eb.getText(&out_buffer);
    const text = out_buffer[0..written];
    try std.testing.expect(std.mem.indexOf(u8, text, "XYZ") != null);
}

test "EditorView - horizontal scroll: backspace in scrolled view" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    try eb.setText("AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDDEEEEEEEEEEFFFFFFFFFFFFGGGGGGGGGGHHHHHHHHHHIIIIIIIIIIJJJJJJJJJJKKKKKKKKKKLLLLLLLLLLMMMMMMMMMMNNNNNNNNNNOOOOOOOOOOPPPPPPPPPP", false);

    try eb.setCursor(0, 50);
    _ = ev.getVirtualLines();

    var vp = ev.getViewport().?;
    try std.testing.expect(vp.x > 0);

    try eb.backspace();
    try eb.backspace();
    try eb.backspace();
    _ = ev.getVirtualLines();

    vp = ev.getViewport().?;
    const cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 47), cursor.col);
    try std.testing.expect(cursor.col >= vp.x);
    try std.testing.expect(cursor.col < vp.x + vp.width);
}

test "EditorView - horizontal scroll: short lines reset scroll" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    try eb.setText("Short line\nAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDDEEEEEEEEEEFFFFFFFFFFGGGGGGGGGGHHHHHHHHHHIIIIIIIIIIJJJJJJJJJJ\nAnother short", false);

    try eb.setCursor(1, 50);
    _ = ev.getVirtualLines();

    var vp = ev.getViewport().?;
    try std.testing.expect(vp.x > 0);

    try eb.setCursor(0, 5);
    _ = ev.getVirtualLines();

    vp = ev.getViewport().?;
    try std.testing.expect(vp.x <= 5);

    try eb.setCursor(1, 50);
    _ = ev.getVirtualLines();

    vp = ev.getViewport().?;
    try std.testing.expect(vp.x > 0);
}

test "EditorView - horizontal scroll: scroll margin works" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    ev.setScrollMargin(0.2);

    try eb.setText("AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDDEEEEEEEEEEFFFFFFFFFFFFGGGGGGGGGGHHHHHHHHHHIIIIIIIIIIJJJJJJJJJJKKKKKKKKKKLLLLLLLLLLMMMMMMMMMMNNNNNNNNNNOOOOOOOOOOPPPPPPPPPP", false);

    try eb.setCursor(0, 0);
    _ = ev.getVirtualLines();

    var i: u32 = 0;
    while (i < 25) : (i += 1) {
        eb.moveRight();
    }

    _ = ev.getVirtualLines();

    const vp = ev.getViewport().?;
    const cursor = ev.getPrimaryCursor();

    const cursor_offset_in_viewport = cursor.col - vp.x;
    try std.testing.expect(cursor_offset_in_viewport >= 4);
    try std.testing.expect(cursor_offset_in_viewport < vp.width - 4);
}

test "EditorView - horizontal scroll: no scrolling with wrapping enabled" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    ev.setWrapMode(.char);

    try eb.setText("AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDDEEEEEEEEEEFFFFFFFFFFFFGGGGGGGGGGHHHHHHHHHHIIIIIIIIIIJJJJJJJJJJKKKKKKKKKKLLLLLLLLLLMMMMMMMMMMNNNNNNNNNNOOOOOOOOOOPPPPPPPPPP", false);

    try eb.setCursor(0, 50);
    _ = ev.getVirtualLines();

    const vp = ev.getViewport().?;
    try std.testing.expectEqual(@as(u32, 0), vp.x);
}

test "EditorView - horizontal scroll: cursor position correct after scrolling" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    try eb.setText("AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDDEEEEEEEEEEFFFFFFFFFFFFGGGGGGGGGGHHHHHHHHHHIIIIIIIIIIJJJJJJJJJJKKKKKKKKKKLLLLLLLLLLMMMMMMMMMMNNNNNNNNNNOOOOOOOOOOPPPPPPPPPP", false);

    try eb.setCursor(0, 0);
    _ = ev.getVirtualLines();

    var i: u32 = 0;
    while (i < 50) : (i += 1) {
        eb.moveRight();
        _ = ev.getVirtualLines();

        const cursor = ev.getPrimaryCursor();
        const vp = ev.getViewport().?;
        const vcursor = ev.getVisualCursor();

        try std.testing.expectEqual(cursor.col, vcursor.logical_col);
        try std.testing.expect(cursor.col >= vp.x);
        try std.testing.expect(cursor.col < vp.x + vp.width);
    }
}

test "EditorView - horizontal scroll: rapid movements maintain visibility" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    try eb.setText("AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDDEEEEEEEEEEFFFFFFFFFFFFGGGGGGGGGGHHHHHHHHHHIIIIIIIIIIJJJJJJJJJJKKKKKKKKKKLLLLLLLLLLMMMMMMMMMMNNNNNNNNNNOOOOOOOOOOPPPPPPPPPP", false);

    try eb.setCursor(0, 0);
    try eb.setCursor(0, 80);
    try eb.setCursor(0, 40);
    try eb.setCursor(0, 10);
    try eb.setCursor(0, 60);

    _ = ev.getVirtualLines();

    const vp = ev.getViewport().?;
    const cursor = ev.getPrimaryCursor();

    try std.testing.expectEqual(@as(u32, 60), cursor.col);
    try std.testing.expect(cursor.col >= vp.x);
    try std.testing.expect(cursor.col < vp.x + vp.width);
}

test "EditorView - horizontal scroll: goto end of long line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 10);
    defer ev.deinit();

    const long_line = "AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDDEEEEEEEEEEFFFFFFFFFFFFGGGGGGGGGGHHHHHHHHHHIIIIIIIIIIJJJJJJJJJJKKKKKKKKKKLLLLLLLLLLMMMMMMMMMMNNNNNNNNNNOOOOOOOOOOPPPPPPPPPP";
    try eb.setText(long_line, false);

    try eb.setCursor(0, 0);
    _ = ev.getVirtualLines();

    try eb.setCursor(0, @intCast(long_line.len));
    _ = ev.getVirtualLines();

    const vp = ev.getViewport().?;
    const cursor = ev.getPrimaryCursor();

    try std.testing.expect(vp.x > 0);
    try std.testing.expect(cursor.col >= vp.x);
    try std.testing.expect(cursor.col < vp.x + vp.width);
}

test "EditorView - horizontal scroll: combined vertical and horizontal scrolling" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 20, 5);
    defer ev.deinit();

    const line0 = "AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDDEEEEEEEEEEFFFFFFFFFFFFGGGGGGGGGGHHHHHHHHHHIIIIIIIIIIJJJJJJJJJJ";
    const repeated_line = "\nAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDDEEEEEEEEEEFFFFFFFFFFGGGGGGGGGGHHHHHHHHHHIIIIIIIIIIJJJJJJJJJJ";

    var buffer: [3000]u8 = undefined;
    var fbs = std.io.fixedBufferStream(&buffer);
    const writer = fbs.writer();
    writer.writeAll(line0) catch unreachable;
    var i: u32 = 1;
    while (i < 20) : (i += 1) {
        writer.writeAll(repeated_line) catch unreachable;
    }

    const text = fbs.getWritten();
    try eb.setText(text, false);

    try eb.setCursor(15, 60);
    _ = ev.getVirtualLines();

    const vp = ev.getViewport().?;
    const cursor = ev.getPrimaryCursor();

    try std.testing.expect(vp.y > 0);
    try std.testing.expect(vp.x > 0);

    try std.testing.expect(cursor.row >= vp.y);
    try std.testing.expect(cursor.row < vp.y + vp.height);
    try std.testing.expect(cursor.col >= vp.x);
    try std.testing.expect(cursor.col < vp.x + vp.width);
}

test "EditorView - deleteSelectedText single line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb_inst = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb_inst.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb_inst, 80, 24);
    defer ev.deinit();

    try eb_inst.setText("Hello World", false);

    ev.text_buffer_view.setSelection(0, 5, null, null);

    const sel_before = ev.text_buffer_view.getSelection();
    try std.testing.expect(sel_before != null);
    try std.testing.expectEqual(@as(u32, 0), sel_before.?.start);
    try std.testing.expectEqual(@as(u32, 5), sel_before.?.end);

    try ev.deleteSelectedText();

    var out_buffer: [100]u8 = undefined;
    const written = ev.getText(&out_buffer);
    try std.testing.expectEqualStrings(" World", out_buffer[0..written]);

    const cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);

    const sel_after = ev.text_buffer_view.getSelection();
    try std.testing.expect(sel_after == null);
}

test "EditorView - deleteSelectedText multi-line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb_inst = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb_inst.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb_inst, 80, 24);
    defer ev.deinit();

    try eb_inst.setText("Line 1\nLine 2\nLine 3", false);

    ev.text_buffer_view.setSelection(2, 15, null, null);

    try ev.deleteSelectedText();

    var out_buffer: [100]u8 = undefined;
    const written = ev.getText(&out_buffer);
    try std.testing.expectEqualStrings("Liine 3", out_buffer[0..written]);

    const cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 2), cursor.col);
}

test "EditorView - deleteSelectedText with wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb_inst = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb_inst.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb_inst, 20, 10);
    defer ev.deinit();

    ev.setWrapMode(.char);

    try eb_inst.setText("ABCDEFGHIJKLMNOPQRSTUVWXYZ", false);

    const vline_count = ev.getTotalVirtualLineCount();
    try std.testing.expect(vline_count >= 2);

    ev.text_buffer_view.setSelection(5, 15, null, null);

    try ev.deleteSelectedText();

    var out_buffer: [100]u8 = undefined;
    const written = ev.getText(&out_buffer);
    try std.testing.expectEqualStrings("ABCDEPQRSTUVWXYZ", out_buffer[0..written]);

    const cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 5), cursor.col);
}

test "EditorView - deleteSelectedText with viewport scrolled" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb_inst = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb_inst.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb_inst, 40, 5);
    defer ev.deinit();

    try eb_inst.setText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\nLine 11\nLine 12\nLine 13\nLine 14\nLine 15\nLine 16\nLine 17\nLine 18\nLine 19", false);

    try eb_inst.gotoLine(10);
    _ = ev.getVirtualLines();

    var vp = ev.getViewport().?;
    try std.testing.expect(vp.y > 0);

    ev.text_buffer_view.setSelection(50, 70, null, null);

    try ev.deleteSelectedText();

    _ = ev.getVirtualLines();
    vp = ev.getViewport().?;
    const cursor = ev.getPrimaryCursor();

    try std.testing.expect(cursor.row >= vp.y);
    try std.testing.expect(cursor.row < vp.y + vp.height);
}

test "EditorView - deleteSelectedText with no selection" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb_inst = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb_inst.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb_inst, 80, 24);
    defer ev.deinit();

    try eb_inst.setText("Hello World", false);

    try ev.deleteSelectedText();

    var out_buffer: [100]u8 = undefined;
    const written = ev.getText(&out_buffer);
    try std.testing.expectEqualStrings("Hello World", out_buffer[0..written]);
}

test "EditorView - deleteSelectedText entire line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb_inst = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb_inst.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb_inst, 80, 24);
    defer ev.deinit();

    try eb_inst.setText("First\nSecond\nThird\n", false);

    ev.text_buffer_view.setSelection(5, 13, null, null);

    try ev.deleteSelectedText();

    var out_buffer: [100]u8 = undefined;
    const written = ev.getText(&out_buffer);
    try std.testing.expectEqualStrings("FirstThird\n", out_buffer[0..written]);

    const cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 5), cursor.col);
}

test "EditorView - deleteSelectedText respects selection with empty lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb_inst = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb_inst.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb_inst, 40, 10);
    defer ev.deinit();

    ev.setWrapMode(.word);

    try eb_inst.setText("AAAA\n\nBBBB\n\nCCCC", false);

    try eb_inst.setCursor(2, 0);

    _ = ev.text_buffer_view.setLocalSelection(0, 2, 4, 2, null, null);

    const sel = ev.text_buffer_view.getSelection();
    try std.testing.expect(sel != null);

    try std.testing.expectEqual(@as(u32, 6), sel.?.start);
    try std.testing.expectEqual(@as(u32, 10), sel.?.end);

    var selected_buffer: [100]u8 = undefined;
    const selected_len = ev.text_buffer_view.getSelectedTextIntoBuffer(&selected_buffer);
    const selected_text = selected_buffer[0..selected_len];
    try std.testing.expectEqualStrings("BBBB", selected_text);

    try ev.deleteSelectedText();

    var out_buffer: [100]u8 = undefined;
    const written = ev.getText(&out_buffer);
    try std.testing.expectEqualStrings("AAAA\n\n\n\nCCCC", out_buffer[0..written]);

    const cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 2), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);
}

test "EditorView - word wrapping with space insertion maintains cursor sync" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 15, 10);
    defer ev.deinit();

    ev.setWrapMode(.word);
    ev.setViewport(Viewport{ .x = 0, .y = 0, .width = 15, .height = 10 });

    try eb.setText("AAAAAAAAAAAAAAAAAAA", false);
    try eb.setCursor(0, 7);
    try eb.insertText(" ");

    const logical_cursor_after_space = eb.getPrimaryCursor();
    const vcursor_after_space = ev.getVisualCursor();

    try std.testing.expectEqual(@as(u32, 0), logical_cursor_after_space.row);
    try std.testing.expectEqual(@as(u32, 8), logical_cursor_after_space.col);

    try std.testing.expectEqual(@as(u32, 0), vcursor_after_space.logical_row);
    try std.testing.expectEqual(@as(u32, 0), vcursor_after_space.visual_row);

    try eb.backspace();

    const logical_cursor_after_backspace = eb.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 0), logical_cursor_after_backspace.row);
    try std.testing.expectEqual(@as(u32, 7), logical_cursor_after_backspace.col);
}

test "EditorView - getVisualCursor always returns on empty buffer" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 24);
    defer ev.deinit();

    const vcursor = ev.getVisualCursor();
    try std.testing.expectEqual(@as(u32, 0), vcursor.visual_row);
    try std.testing.expectEqual(@as(u32, 0), vcursor.visual_col);
    try std.testing.expectEqual(@as(u32, 0), vcursor.logical_row);
    try std.testing.expectEqual(@as(u32, 0), vcursor.logical_col);
}

test "EditorView - logicalToVisualCursor clamps row beyond last line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 24);
    defer ev.deinit();

    try eb.setText("Line 1\nLine 2\nLine 3", false);

    const vcursor = ev.logicalToVisualCursor(100, 0);
    try std.testing.expectEqual(@as(u32, 2), vcursor.logical_row);
    try std.testing.expectEqual(@as(u32, 0), vcursor.logical_col);
}

test "EditorView - logicalToVisualCursor clamps col beyond line width" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var ev = try EditorView.init(std.testing.allocator, eb, 80, 24);
    defer ev.deinit();

    try eb.setText("Hello", false);

    const vcursor = ev.logicalToVisualCursor(0, 100);
    try std.testing.expectEqual(@as(u32, 0), vcursor.logical_row);
    try std.testing.expectEqual(@as(u32, 5), vcursor.logical_col);
    try std.testing.expectEqual(@as(u32, 5), vcursor.visual_col);
}
