const std = @import("std");
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const gp = @import("../grapheme.zig");

const TextBuffer = text_buffer.TextBuffer;
const TextBufferView = text_buffer_view.TextBufferView;
const Viewport = text_buffer_view.Viewport;

// ===== Viewport-Aware Selection Tests =====

test "Selection - vertical viewport selection without wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    // Create text with many lines
    try tb.setText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9");

    // Set viewport starting at line 5, showing 5 lines
    view.setViewport(Viewport{ .x = 0, .y = 5, .width = 10, .height = 5 });

    // Select from viewport-local (0, 0) to (4, 2) - should be absolute lines 5-7
    // Line 5: "Line 5" (6 chars)
    // Line 6: "Line 6" (6 chars)
    // Line 7: "Line 7" (first 2 chars: "Li")
    _ = view.setLocalSelection(0, 0, 2, 2, null, null);

    var buffer: [100]u8 = undefined;
    const len = view.getSelectedTextIntoBuffer(&buffer);
    const text = buffer[0..len];

    // Should select from start of absolute line 5 to col 2 of absolute line 7
    try std.testing.expect(std.mem.indexOf(u8, text, "Line 5") != null);
    try std.testing.expect(std.mem.indexOf(u8, text, "Line 6") != null);
    try std.testing.expect(std.mem.indexOf(u8, text, "Li") != null);
    try std.testing.expect(std.mem.indexOf(u8, text, "Line 7") == null); // Should not have full "Line 7"
}

test "Selection - horizontal viewport selection without wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    // Create a long single line
    try tb.setText("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");

    // Set viewport with horizontal scroll at column 10
    view.setViewport(Viewport{ .x = 10, .y = 0, .width = 10, .height = 1 });

    // Select viewport-local (0, 0) to (5, 0) - should be absolute columns [10, 15)
    // Characters at positions 10-14: "KLMNO"
    _ = view.setLocalSelection(0, 0, 5, 0, null, null);

    var buffer: [100]u8 = undefined;
    const len = view.getSelectedTextIntoBuffer(&buffer);
    const text = buffer[0..len];

    try std.testing.expectEqualStrings("KLMNO", text);
}

test "Selection - wrapping mode ignores horizontal viewport offset" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    // Create a long single line
    try tb.setText("ABCDEFGHIJKLMNOPQRSTUVWXYZ");

    // Enable character wrapping
    view.setWrapMode(.char);
    view.setWrapWidth(10);

    // Set viewport with x=10 (but should be ignored in wrap mode)
    view.setViewport(Viewport{ .x = 10, .y = 0, .width = 10, .height = 3 });

    // Select viewport-local (0, 0) to (5, 0) - in wrap mode, x offset is ignored
    // Should select first 5 characters of the first virtual line: "ABCDE"
    _ = view.setLocalSelection(0, 0, 5, 0, null, null);

    var buffer: [100]u8 = undefined;
    const len = view.getSelectedTextIntoBuffer(&buffer);
    const text = buffer[0..len];

    try std.testing.expectEqualStrings("ABCDE", text);
}

test "Selection - vertical viewport with wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    // Create text that will wrap
    try tb.setText("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");

    // Enable wrapping at 10 chars
    view.setWrapMode(.char);
    view.setWrapWidth(10);

    // This creates 4 virtual lines:
    // vline 0: "ABCDEFGHIJ"
    // vline 1: "KLMNOPQRST"
    // vline 2: "UVWXYZ0123"
    // vline 3: "456789"

    const vline_count = view.getVirtualLineCount();
    try std.testing.expectEqual(@as(u32, 4), vline_count);

    // Set viewport showing lines 1-2
    view.setViewport(Viewport{ .x = 0, .y = 1, .width = 10, .height = 2 });

    // Select viewport-local (0, 0) to (5, 1)
    // Should select from start of vline 1 to col 5 of vline 2
    // "KLMNOPQRST" + "UVWXY"
    _ = view.setLocalSelection(0, 0, 5, 1, null, null);

    var buffer: [100]u8 = undefined;
    const len = view.getSelectedTextIntoBuffer(&buffer);
    const text = buffer[0..len];

    try std.testing.expectEqualStrings("KLMNOPQRSTUVWXY", text);
}

test "Selection - across empty line with viewport offset" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    // Create text with empty lines
    try tb.setText("Line0\n\nLine2\nLine3\nLine4");

    // Set viewport starting at line 1 (the empty line)
    view.setViewport(Viewport{ .x = 0, .y = 1, .width = 10, .height = 3 });

    // Select from viewport-local (0, 0) to (3, 2)
    // Absolute lines 1-3: empty line, "Line2", "Line3" (first 3 chars)
    _ = view.setLocalSelection(0, 0, 3, 2, null, null);

    var buffer: [100]u8 = undefined;
    const len = view.getSelectedTextIntoBuffer(&buffer);
    const text = buffer[0..len];

    // Should contain newline for empty line, "Line2", newline, and "Lin" from "Line3"
    try std.testing.expect(std.mem.indexOf(u8, text, "Line2") != null);
    try std.testing.expect(std.mem.indexOf(u8, text, "Lin") != null);
}

test "Selection - viewport offset with multi-line selection" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("AAA\nBBB\nCCC\nDDD\nEEE\nFFF\nGGG\nHHH");

    // Set viewport at y=2
    view.setViewport(Viewport{ .x = 0, .y = 2, .width = 10, .height = 4 });

    // Select viewport-local entire first visible line (line 2 absolute = "CCC")
    _ = view.setLocalSelection(0, 0, 3, 0, null, null);

    var buffer: [100]u8 = undefined;
    const len = view.getSelectedTextIntoBuffer(&buffer);
    const text = buffer[0..len];

    try std.testing.expectEqualStrings("CCC", text);
}

test "Selection - combined horizontal and vertical viewport offsets" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    // Create multiple long lines
    try tb.setText("ABCDEFGHIJKLMNOPQRSTUVWXYZ\n0123456789ABCDEFGHIJKLMNOP\nQRSTUVWXYZ0123456789ABCDEF");

    // Set viewport with both x and y offsets
    view.setViewport(Viewport{ .x = 5, .y = 1, .width = 10, .height = 2 });

    // Select viewport-local (0, 0) to (5, 0)
    // Absolute: line 1, columns [5, 10)
    // Line 1 is "0123456789ABCDEFGHIJKLMNOP"
    // Columns 5-9: "56789"
    _ = view.setLocalSelection(0, 0, 5, 0, null, null);

    var buffer: [100]u8 = undefined;
    const len = view.getSelectedTextIntoBuffer(&buffer);
    const text = buffer[0..len];

    try std.testing.expectEqualStrings("56789", text);
}

test "Selection - viewport without offsets behaves as before" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello World");

    // Set viewport at origin
    view.setViewport(Viewport{ .x = 0, .y = 0, .width = 20, .height = 5 });

    // Select from (2, 0) to (7, 0)
    _ = view.setLocalSelection(2, 0, 7, 0, null, null);

    var buffer: [100]u8 = undefined;
    const len = view.getSelectedTextIntoBuffer(&buffer);
    const text = buffer[0..len];

    try std.testing.expectEqualStrings("llo W", text);
}

test "Selection - no viewport behaves as before" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello World");

    // No viewport set - coordinates should work as absolute
    _ = view.setLocalSelection(2, 0, 7, 0, null, null);

    var buffer: [100]u8 = undefined;
    const len = view.getSelectedTextIntoBuffer(&buffer);
    const text = buffer[0..len];

    try std.testing.expectEqualStrings("llo W", text);
}

test "Selection - VALIDATION: verify selection range matches extracted text with viewport" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line0\nLine1\nLine2\nLine3\nLine4\nLine5\nLine6\nLine7\nLine8\nLine9");

    // Set viewport showing lines 5-9 (offsetY=5)
    view.setViewport(Viewport{ .x = 0, .y = 5, .width = 10, .height = 5 });

    // Select viewport-local (0, 0) to (5, 0) - should be absolute line 5, cols 0-5
    _ = view.setLocalSelection(0, 0, 5, 0, null, null);

    // Get the selection range
    const selection = view.getSelection();
    try std.testing.expect(selection != null);

    // Get the selected text
    var selected_buffer: [100]u8 = undefined;
    const selected_len = view.getSelectedTextIntoBuffer(&selected_buffer);
    const selected_text = selected_buffer[0..selected_len];

    // The selected text should be "Line5" (first 5 chars of line 5)
    try std.testing.expectEqualStrings("Line5", selected_text);

    // Now verify that the selection range (start, end) corresponds to the correct bytes in the full text
    // When we extract full_text[start..end], we should get the same as selected_text
    // BUT: full_text includes newlines, so we need to account for that
    // Lines 0-4 each have 5 chars + 1 newline = 6 bytes each = 30 bytes
    // Line 5 starts at byte 30
    const expected_start: u32 = 30; // Start of line 5
    const expected_end: u32 = 35; // First 5 chars of line 5

    try std.testing.expectEqual(expected_start, selection.?.start);
    try std.testing.expectEqual(expected_end, selection.?.end);
}

test "Selection - VALIDATION: multi-line selection range with viewport" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("AAA\nBBB\nCCC\nDDD\nEEE\nFFF\nGGG\nHHH");

    // Set viewport at line 3 (showing lines 3-7)
    view.setViewport(Viewport{ .x = 0, .y = 3, .width = 10, .height = 5 });

    // Select viewport-local (0, 0) to (3, 2)
    // Should select: absolute line 3 full + line 4 full + line 5 first 3 chars
    // = "DDD" + "\n" + "EEE" + "\n" + "FFF"
    _ = view.setLocalSelection(0, 0, 3, 2, null, null);

    var selected_buffer: [100]u8 = undefined;
    const selected_len = view.getSelectedTextIntoBuffer(&selected_buffer);
    const selected_text = selected_buffer[0..selected_len];

    // Should select "DDD\nEEE\nFFF"
    try std.testing.expectEqualStrings("DDD\nEEE\nFFF", selected_text);

    // Verify the selection range matches
    const selection = view.getSelection();
    try std.testing.expect(selection != null);

    // Calculate expected byte positions
    // Lines 0-2: 3 chars + newline each = 4 bytes * 3 = 12 bytes
    // Line 3 starts at byte 12
    // We want: DDD (3) + \n (1) + EEE (3) + \n (1) + FFF (3) = 11 bytes
    const expected_start: u32 = 12; // Start of line 3
    const expected_end: u32 = 23; // End of "FFF" on line 5

    try std.testing.expectEqual(expected_start, selection.?.start);
    try std.testing.expectEqual(expected_end, selection.?.end);
}

test "Selection - RENDER TEST: selection highlights correct cells with viewport scroll" {
    const buffer_mod = @import("../buffer.zig");
    const RGBA = buffer_mod.RGBA;

    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("AAA\nBBB\nCCC\nDDD\nEEE\nFFF\nGGG\nHHH");

    // Set viewport at line 3 (showing lines 3-7: DDD, EEE, FFF, GGG, HHH)
    view.setViewport(Viewport{ .x = 0, .y = 3, .width = 10, .height = 5 });

    // Select viewport-local (0, 0) to (3, 0) - should select first visible line "DDD"
    const red_bg = RGBA{ 1.0, 0.0, 0.0, 1.0 };
    _ = view.setLocalSelection(0, 0, 3, 0, red_bg, null);

    // Create a buffer to render into
    var render_buffer = try buffer_mod.OptimizedBuffer.init(std.testing.allocator, pool, 20, 10, .unicode, graphemes_ptr, display_width_ptr);
    defer render_buffer.deinit();

    // Draw the text buffer view at position (0, 0) on the render buffer
    try render_buffer.drawTextBuffer(view, 0, 0);

    // Now check that the first 3 cells on row 0 have red background
    // These should correspond to "DDD" which is the first line in the viewport (absolute line 3)
    var x: u32 = 0;
    while (x < 3) : (x += 1) {
        const cell = render_buffer.get(x, 0);
        try std.testing.expect(cell != null);

        // Check if background is red
        const bg = cell.?.bg;
        try std.testing.expectApproxEqAbs(@as(f32, 1.0), bg[0], 0.01); // Red
        try std.testing.expectApproxEqAbs(@as(f32, 0.0), bg[1], 0.01); // Green
        try std.testing.expectApproxEqAbs(@as(f32, 0.0), bg[2], 0.01); // Blue
    }

    // Cell at x=3 should NOT have red background (not selected)
    const cell_3 = render_buffer.get(3, 0);
    try std.testing.expect(cell_3 != null);
    const bg_3 = cell_3.?.bg;
    // Should be black or default, not red
    try std.testing.expect(bg_3[0] < 0.5); // Not red
}
