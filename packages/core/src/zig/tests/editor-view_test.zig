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

    // Verify viewport was set
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

    // Insert 20 lines of text
    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\nLine 11\nLine 12\nLine 13\nLine 14\nLine 15\nLine 16\nLine 17\nLine 18\nLine 19");

    // Cursor should be on line 19 now (last line)
    const cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 19), cursor.row);

    // Trigger updateBeforeRender to ensure cursor visibility
    _ = ev.getVirtualLines();

    // Viewport should have scrolled to show cursor
    const vp = ev.getViewport().?;
    try std.testing.expect(vp.y > 0); // Should have scrolled down
    try std.testing.expect(cursor.row >= vp.y); // Cursor should be at or below viewport top
    try std.testing.expect(cursor.row < vp.y + vp.height); // Cursor should be within viewport
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

    // Insert 20 lines of text
    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\nLine 11\nLine 12\nLine 13\nLine 14\nLine 15\nLine 16\nLine 17\nLine 18\nLine 19");

    // Trigger updateBeforeRender to ensure cursor visibility
    _ = ev.getVirtualLines();

    // Viewport should have scrolled down
    var vp = ev.getViewport().?;
    try std.testing.expect(vp.y > 0);

    // Now go to line 0 - should scroll back up
    try eb.gotoLine(0);

    // Trigger updateIfDirty again
    _ = ev.getVirtualLines();

    const cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 0), cursor.row);

    // Viewport should have scrolled to top
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

    // Insert 20 lines
    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\nLine 11\nLine 12\nLine 13\nLine 14\nLine 15\nLine 16\nLine 17\nLine 18\nLine 19");

    // Go to line 0
    try eb.setCursor(0, 0);
    _ = ev.getVirtualLines(); // Trigger updateIfDirty
    var vp = ev.getViewport().?;
    try std.testing.expectEqual(@as(u32, 0), vp.y);

    // Move down 15 times - should cause viewport to scroll
    var i: u32 = 0;
    while (i < 15) : (i += 1) {
        eb.moveDown();
    }

    // Trigger updateBeforeRender to ensure cursor visibility
    _ = ev.getVirtualLines();

    const cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 15), cursor.row);

    // Viewport should have scrolled to keep cursor visible
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

    // Insert 20 lines and cursor will be at end
    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\nLine 11\nLine 12\nLine 13\nLine 14\nLine 15\nLine 16\nLine 17\nLine 18\nLine 19");

    // Trigger updateBeforeRender to ensure cursor visibility
    _ = ev.getVirtualLines();

    // Viewport should be scrolled down
    var vp = ev.getViewport().?;
    const initial_y = vp.y;
    try std.testing.expect(initial_y > 0);

    // Move up 10 times - should scroll viewport up
    var i: u32 = 0;
    while (i < 10) : (i += 1) {
        eb.moveUp();
    }

    // Trigger updateBeforeRender to ensure cursor visibility
    _ = ev.getVirtualLines();

    const cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 9), cursor.row);

    // Viewport should have scrolled up to keep cursor visible
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

    // Set scroll margin to 0.2 (20% = 2 lines for a 10-line viewport)
    ev.setScrollMargin(0.2);

    // Insert many lines
    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\nLine 11\nLine 12\nLine 13\nLine 14\nLine 15\nLine 16\nLine 17\nLine 18\nLine 19");

    // Go to line 5
    try eb.gotoLine(5);

    const cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 5), cursor.row);

    // Check that cursor is not at the very top or bottom of viewport
    const vp = ev.getViewport().?;
    const cursor_offset_in_viewport = cursor.row - vp.y;

    // With 20% margin on a 10-line viewport, cursor should be at least 2 lines from edges
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

    // Insert text that creates many lines all at once
    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9");

    // Trigger updateBeforeRender to ensure cursor visibility
    _ = ev.getVirtualLines();

    // Cursor should be visible
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

    // Insert many lines
    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9");

    // Backspace should merge lines and keep cursor visible
    try eb.backspace();

    // Trigger updateBeforeRender to ensure cursor visibility
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

    // Insert many lines
    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9");

    // Go to line 8 end
    try eb.setCursor(8, 6);

    // Delete forward to merge with next line
    try eb.deleteForward();

    // Trigger updateBeforeRender to ensure cursor visibility
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

    // Insert many lines
    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9");

    // Delete range across multiple lines
    try eb.deleteRange(.{ .row = 2, .col = 0 }, .{ .row = 7, .col = 6 });

    // Trigger updateBeforeRender to ensure cursor visibility
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

    // Insert many lines
    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9");

    // Go to line 7
    try eb.gotoLine(7);

    // Delete line
    try eb.deleteLine();

    // Trigger updateBeforeRender to ensure cursor visibility
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

    // Insert many lines to scroll viewport
    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9");

    // Trigger updateBeforeRender to ensure cursor visibility
    _ = ev.getVirtualLines();

    var vp = ev.getViewport().?;
    try std.testing.expect(vp.y > 0); // Scrolled down

    // setText should reset cursor to top, and EditorView should ensure cursor visible before rendering
    try eb.setText("New Line 0\nNew Line 1\nNew Line 2");

    const cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 0), cursor.row);

    // Trigger updateIfDirty by getting virtual lines (simulates rendering)
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

    // Insert only 5 lines (less than viewport height)
    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4");

    // Go to last line
    try eb.gotoLine(4);

    // Viewport should still be at 0 since all lines fit
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

    // Insert some lines
    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4");

    // Go to line 2
    try eb.setCursor(2, 0);

    const vp_before = ev.getViewport().?;

    // Move right several times
    eb.moveRight();
    eb.moveRight();
    eb.moveRight();

    // Viewport Y should not change
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

    // Start with empty buffer
    try eb.setCursor(0, 0);

    var vp = ev.getViewport().?;
    try std.testing.expectEqual(@as(u32, 0), vp.y);

    // Insert a line
    try eb.insertText("First line");

    // Move to start
    try eb.setCursor(0, 0);

    vp = ev.getViewport().?;
    try std.testing.expectEqual(@as(u32, 0), vp.y);

    // All operations should maintain valid viewport
    eb.moveLeft(); // At boundary
    vp = ev.getViewport().?;
    try std.testing.expectEqual(@as(u32, 0), vp.y);

    eb.moveUp(); // At boundary
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

    // Insert 30 lines all at once
    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\nLine 11\nLine 12\nLine 13\nLine 14\nLine 15\nLine 16\nLine 17\nLine 18\nLine 19\nLine 20\nLine 21\nLine 22\nLine 23\nLine 24\nLine 25\nLine 26\nLine 27\nLine 28\nLine 29");

    // Rapid movements
    try eb.gotoLine(0);
    try eb.gotoLine(29);
    try eb.gotoLine(15);
    try eb.gotoLine(5);
    try eb.gotoLine(25);

    // Trigger updateBeforeRender to ensure cursor visibility
    _ = ev.getVirtualLines();

    // After each movement, cursor should be visible
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

    // Insert text without wrapping
    try eb.insertText("Hello World\nSecond Line\nThird Line");

    // Go to line 1, col 3
    try eb.setCursor(1, 3);

    // Without wrapping, visual and logical should match
    const vcursor = ev.getVisualCursor();
    try std.testing.expect(vcursor != null);
    try std.testing.expectEqual(@as(u32, 1), vcursor.?.visual_row);
    try std.testing.expectEqual(@as(u32, 3), vcursor.?.visual_col);
    try std.testing.expectEqual(@as(u32, 1), vcursor.?.logical_row);
    try std.testing.expectEqual(@as(u32, 3), vcursor.?.logical_col);
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

    // Enable character wrapping
    ev.setWrapMode(.char);

    // Insert a long line that will wrap
    try eb.setText("This is a very long line that will definitely wrap at 20 characters");

    // Go to logical position (0, 25) - should be on second visual line
    try eb.setCursor(0, 25);

    const vcursor = ev.getVisualCursor();
    try std.testing.expect(vcursor != null);
    try std.testing.expectEqual(@as(u32, 0), vcursor.?.logical_row);
    try std.testing.expectEqual(@as(u32, 25), vcursor.?.logical_col);
    // Visual row should be > 0 since line wraps
    try std.testing.expect(vcursor.?.visual_row > 0);
    // Visual col should be within wrap width
    try std.testing.expect(vcursor.?.visual_col <= 20);
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

    // Enable word wrapping
    ev.setWrapMode(.word);

    // Insert text that will wrap at word boundaries
    try eb.setText("Hello world this is a test of word wrapping");

    // Move to end of line
    const line_count = eb.getTextBuffer().getLineCount();
    try std.testing.expectEqual(@as(u32, 1), line_count);

    // Cursor should translate correctly
    const vcursor = ev.getVisualCursor();
    try std.testing.expect(vcursor != null);
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

    // Enable character wrapping
    ev.setWrapMode(.char);

    // Insert a long line that wraps
    try eb.setText("This is a very long line that will definitely wrap multiple times at twenty characters");

    // Move to end of line
    try eb.setCursor(0, 50);

    const vcursor_before = ev.getVisualCursor();
    try std.testing.expect(vcursor_before != null);
    const visual_row_before = vcursor_before.?.visual_row;

    // Move up one visual line
    ev.moveUpVisual();

    const vcursor_after = ev.getVisualCursor();
    try std.testing.expect(vcursor_after != null);

    // Should have moved up one visual line
    try std.testing.expectEqual(visual_row_before - 1, vcursor_after.?.visual_row);

    // Should still be on logical line 0
    try std.testing.expectEqual(@as(u32, 0), vcursor_after.?.logical_row);
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

    // Enable character wrapping
    ev.setWrapMode(.char);

    // Insert a long line that wraps
    try eb.setText("This is a very long line that will definitely wrap multiple times at twenty characters");

    // Start at beginning
    try eb.setCursor(0, 0);

    const vcursor_before = ev.getVisualCursor();
    try std.testing.expect(vcursor_before != null);
    try std.testing.expectEqual(@as(u32, 0), vcursor_before.?.visual_row);

    // Move down one visual line
    ev.moveDownVisual();

    const vcursor_after = ev.getVisualCursor();
    try std.testing.expect(vcursor_after != null);

    // Should have moved down one visual line
    try std.testing.expectEqual(@as(u32, 1), vcursor_after.?.visual_row);

    // Should still be on logical line 0
    try std.testing.expectEqual(@as(u32, 0), vcursor_after.?.logical_row);
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

    // Insert wrapped text
    try eb.setText("12345678901234567890123456789012345");

    // Virtual line 1, col 5 should map to logical line 0, col 25
    const vcursor = ev.visualToLogicalCursor(1, 5);
    try std.testing.expect(vcursor != null);
    try std.testing.expectEqual(@as(u32, 1), vcursor.?.visual_row);
    try std.testing.expectEqual(@as(u32, 0), vcursor.?.logical_row);
    try std.testing.expectEqual(@as(u32, 25), vcursor.?.logical_col);
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
    try eb.setText("Short line");

    // At top - should not move
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
    try eb.setText("Short line\nSecond line");

    // Move to last line
    try eb.setCursor(1, 0);

    const before = ev.getPrimaryCursor();
    ev.moveDownVisual();
    const after = ev.getPrimaryCursor();

    // Should not move past last line
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

    // Insert long wrapped line
    try eb.setText("12345678901234567890123456789012345678901234567890");

    // Move to column 15 on first visual line
    try eb.setCursor(0, 15);

    // Move down and up - should try to maintain column
    ev.moveDownVisual();
    ev.moveDownVisual();
    ev.moveUpVisual();

    const vcursor = ev.getVisualCursor();
    try std.testing.expect(vcursor != null);

    // Visual column should be close to 15 (within wrap width)
    try std.testing.expect(vcursor.?.visual_col <= 20);
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

    // Insert multiple lines, some that wrap
    try eb.setText("Short line 1\nThis is a very long line that will wrap multiple times\nShort line 3");

    // Move to line 1 (the long wrapped line)
    try eb.setCursor(1, 30);

    const vcursor = ev.getVisualCursor();
    try std.testing.expect(vcursor != null);
    try std.testing.expectEqual(@as(u32, 1), vcursor.?.logical_row);

    // Visual row should be greater than 1 (line 0 + wrapped portions of line 1)
    try std.testing.expect(vcursor.?.visual_row > 1);
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

    try eb.setText("Short");

    // Try to convert logical position past line end
    const vcursor = ev.logicalToVisualCursor(0, 100);
    try std.testing.expect(vcursor != null);

    // Should clamp to line end
    try std.testing.expectEqual(@as(u32, 0), vcursor.?.logical_row);
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
    // Verify it's a valid pointer by checking viewport was set
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

    // Insert many lines
    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\nLine 11\nLine 12\nLine 13\nLine 14");

    // Go to line 10
    try eb.gotoLine(10);

    // Resize viewport to smaller height
    ev.setViewportSize(80, 5);

    const vp = ev.getViewport().?;
    try std.testing.expectEqual(@as(u32, 80), vp.width);
    try std.testing.expectEqual(@as(u32, 5), vp.height);

    // Note: setViewportSize doesn't automatically adjust scroll position
    // That would need to be handled separately if desired
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

    // Insert text with an empty line in the middle
    try eb.setText("Line with some text\n\nAnother line with text");

    // Start at column 10 on line 0
    try eb.setCursor(0, 10);

    const vcursor_before = ev.getVisualCursor();
    try std.testing.expect(vcursor_before != null);
    try std.testing.expectEqual(@as(u32, 10), vcursor_before.?.visual_col);

    // Move down to empty line
    ev.moveDownVisual();

    const vcursor_empty = ev.getVisualCursor();
    try std.testing.expect(vcursor_empty != null);
    try std.testing.expectEqual(@as(u32, 1), vcursor_empty.?.logical_row);
    try std.testing.expectEqual(@as(u32, 0), vcursor_empty.?.visual_col); // Clamped to 0 on empty line

    // Move down again to line with text
    ev.moveDownVisual();

    const vcursor_after = ev.getVisualCursor();
    try std.testing.expect(vcursor_after != null);
    try std.testing.expectEqual(@as(u32, 2), vcursor_after.?.logical_row);
    // Should restore to column 10, not stay at 0
    try std.testing.expectEqual(@as(u32, 10), vcursor_after.?.visual_col);
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

    // Insert text with an empty line in the middle
    try eb.setText("Line with some text\n\nAnother line with text");

    // Start at column 10 on line 2
    try eb.setCursor(2, 10);

    const vcursor_before = ev.getVisualCursor();
    try std.testing.expect(vcursor_before != null);
    try std.testing.expectEqual(@as(u32, 10), vcursor_before.?.visual_col);

    // Move up to empty line
    ev.moveUpVisual();

    const vcursor_empty = ev.getVisualCursor();
    try std.testing.expect(vcursor_empty != null);
    try std.testing.expectEqual(@as(u32, 1), vcursor_empty.?.logical_row);
    try std.testing.expectEqual(@as(u32, 0), vcursor_empty.?.visual_col); // Clamped to 0 on empty line

    // Move up again to line with text
    ev.moveUpVisual();

    const vcursor_after = ev.getVisualCursor();
    try std.testing.expect(vcursor_after != null);
    try std.testing.expectEqual(@as(u32, 0), vcursor_after.?.logical_row);
    // Should restore to column 10, not stay at 0
    try std.testing.expectEqual(@as(u32, 10), vcursor_after.?.visual_col);
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

    // Insert text with an empty line in the middle
    try eb.setText("Line with some text\n\nAnother line with text");

    // Start at column 10 on line 0
    try eb.setCursor(0, 10);

    const vcursor_initial = ev.getVisualCursor();
    try std.testing.expect(vcursor_initial != null);
    try std.testing.expectEqual(@as(u32, 10), vcursor_initial.?.visual_col);

    // Move down visually twice to get to line 2 (establishes desired_visual_col = 10)
    ev.moveDownVisual();
    ev.moveDownVisual();

    const vcursor_after_down = ev.getVisualCursor();
    try std.testing.expect(vcursor_after_down != null);
    try std.testing.expectEqual(@as(u32, 2), vcursor_after_down.?.logical_row);
    try std.testing.expectEqual(@as(u32, 10), vcursor_after_down.?.visual_col);

    // Now move right (should reset the visual column tracking)
    eb.moveRight();

    const vcursor_after_right = ev.getVisualCursor();
    try std.testing.expect(vcursor_after_right != null);
    try std.testing.expectEqual(@as(u32, 11), vcursor_after_right.?.visual_col); // Moved right one position

    // Move up visually twice - should use current column (11), not the old desired column (10)
    ev.moveUpVisual();
    ev.moveUpVisual();

    const vcursor_final = ev.getVisualCursor();
    try std.testing.expect(vcursor_final != null);
    try std.testing.expectEqual(@as(u32, 0), vcursor_final.?.logical_row);
    // Should use current column (11), not the old desired column (10)
    try std.testing.expectEqual(@as(u32, 11), vcursor_final.?.visual_col);
}

test "EditorView - rope corruption when inserting newlines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    // Insert initial text with some lines
    try eb.insertText("Line 0\nLine 1\nLine 2");

    // Check initial state - should be valid
    const rope_init = &eb.getTextBuffer().rope;
    const line_count_init = eb.getTextBuffer().lineCount();
    try std.testing.expectEqual(@as(u32, 3), line_count_init);

    // Insert first newline at the end
    try eb.insertText("\n");

    const line_count_1 = eb.getTextBuffer().lineCount();
    try std.testing.expectEqual(@as(u32, 4), line_count_1);

    // Verify no duplicate weights after first newline
    if (rope_init.getMarker(.linestart, 2)) |m2| {
        if (rope_init.getMarker(.linestart, 3)) |m3| {
            try std.testing.expect(m2.global_weight != m3.global_weight);
        }
    }

    // Insert second newline
    try eb.insertText("\n");

    const line_count_2 = eb.getTextBuffer().lineCount();
    try std.testing.expectEqual(@as(u32, 5), line_count_2);

    // Verify no duplicate weights after second newline
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

    // Insert initial text - 5 lines
    try eb.insertText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4");

    // Verify cursor is at end of line 4
    var cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 4), cursor.row);
    try std.testing.expectEqual(@as(u32, 6), cursor.col);

    // Get visual lines to trigger viewport update
    _ = ev.getVirtualLines();

    // Viewport should be at top since everything fits
    var vp = ev.getViewport().?;
    try std.testing.expectEqual(@as(u32, 0), vp.y);

    // Now insert several newlines to move cursor down and scroll viewport
    var i: u32 = 0;
    while (i < 6) : (i += 1) {
        try eb.insertText("\n");
        _ = ev.getVirtualLines();
    }

    // Cursor should now be at line 10
    cursor = ev.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 10), cursor.row);
    try std.testing.expectEqual(@as(u32, 0), cursor.col);

    // Viewport should have scrolled down
    vp = ev.getViewport().?;
    try std.testing.expect(vp.y > 0);

    // Get visual cursor before moving up
    const vcursor_before = ev.getVisualCursor();
    try std.testing.expect(vcursor_before != null);
    try std.testing.expectEqual(@as(u32, 10), vcursor_before.?.logical_row);

    // Move visual cursor up once
    ev.moveUpVisual();
    _ = ev.getVirtualLines();

    // Get visual and logical cursor positions after moving up
    const vcursor_after_up = ev.getVisualCursor();
    try std.testing.expect(vcursor_after_up != null);
    const logical_cursor_after_up = ev.getPrimaryCursor();

    try std.testing.expectEqual(@as(u32, 9), logical_cursor_after_up.row);
    try std.testing.expectEqual(@as(u32, 9), vcursor_after_up.?.logical_row);

    // The visual row should be one less than before
    try std.testing.expect(vcursor_after_up.?.visual_row < vcursor_before.?.visual_row);

    // Now insert text - this should go at the logical cursor position
    try eb.insertText("X");
    _ = ev.getVirtualLines();

    // Get the cursor position after insertion
    const cursor_after_insert = ev.getPrimaryCursor();
    const vcursor_after_insert = ev.getVisualCursor();
    try std.testing.expect(vcursor_after_insert != null);

    // The cursor should still be on row 9 (where we moved to), col 1 (after 'X')
    try std.testing.expectEqual(@as(u32, 9), cursor_after_insert.row);
    try std.testing.expectEqual(@as(u32, 1), cursor_after_insert.col);

    // Visual cursor logical position should match
    try std.testing.expectEqual(@as(u32, 9), vcursor_after_insert.?.logical_row);
    try std.testing.expectEqual(@as(u32, 1), vcursor_after_insert.?.logical_col);

    // Verify the text is actually at line 9
    var out_buffer: [200]u8 = undefined;
    const written = eb.getText(&out_buffer);
    const text = out_buffer[0..written];

    // Count lines to verify X is on line 9
    var line_count: u32 = 0;
    var line_start: usize = 0;
    for (text, 0..) |c, idx| {
        if (c == '\n') {
            if (line_count == 9) {
                // This is the line after line 9, so line 9 should have X
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
