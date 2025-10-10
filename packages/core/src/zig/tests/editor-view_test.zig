const std = @import("std");
const testing = std.testing;
const tb = @import("../text-buffer.zig");
const tbv = @import("../text-buffer-view.zig");
const edv = @import("../editor-view.zig");
const gp = @import("../grapheme.zig");

const TextBufferArray = tb.TextBufferArray;
const TextBufferView = tbv.TextBufferView;
const EditorView = edv.EditorView;
const Viewport = edv.Viewport;

// Helper to initialize text buffer with required grapheme infrastructure
fn initTextBuffer() !*TextBufferArray {
    const pool = gp.initGlobalPool(testing.allocator);
    const gd = gp.initGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;
    return TextBufferArray.init(testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
}

fn deinitGraphemeGlobals() void {
    gp.deinitGlobalUnicodeData(testing.allocator);
    gp.deinitGlobalPool();
}

test "EditorView: init and deinit" {
    var text_buffer = try initTextBuffer();
    defer {
        text_buffer.deinit();
        deinitGraphemeGlobals();
    }

    var text_buffer_view = try TextBufferView.init(testing.allocator, text_buffer);
    defer text_buffer_view.deinit();

    var editor_view = try EditorView.init(testing.allocator, text_buffer_view);
    defer editor_view.deinit();

    try testing.expect(editor_view.viewport == null);
    try testing.expectEqual(@as(f32, 0.15), editor_view.scroll_margin);
}

test "EditorView: set and get viewport" {
    var text_buffer = try initTextBuffer();
    defer {
        text_buffer.deinit();
        deinitGraphemeGlobals();
    }

    var text_buffer_view = try TextBufferView.init(testing.allocator, text_buffer);
    defer text_buffer_view.deinit();

    var editor_view = try EditorView.init(testing.allocator, text_buffer_view);
    defer editor_view.deinit();

    const vp = Viewport{ .x = 0, .y = 0, .width = 80, .height = 24 };
    editor_view.setViewport(vp);

    const retrieved = editor_view.getViewport();
    try testing.expect(retrieved != null);
    try testing.expectEqual(@as(u32, 0), retrieved.?.x);
    try testing.expectEqual(@as(u32, 0), retrieved.?.y);
    try testing.expectEqual(@as(u32, 80), retrieved.?.width);
    try testing.expectEqual(@as(u32, 24), retrieved.?.height);
}

test "EditorView: viewport slicing with no wrapping" {
    var text_buffer = try initTextBuffer();
    defer {
        text_buffer.deinit();
        deinitGraphemeGlobals();
    }

    // Add 100 lines of text
    var text_lines = std.ArrayList(u8).init(testing.allocator);
    defer text_lines.deinit();
    var i: usize = 0;
    while (i < 100) : (i += 1) {
        try text_lines.writer().print("Line {d}\n", .{i});
    }
    try text_buffer.setText(text_lines.items);

    var text_buffer_view = try TextBufferView.init(testing.allocator, text_buffer);
    defer text_buffer_view.deinit();

    var editor_view = try EditorView.init(testing.allocator, text_buffer_view);
    defer editor_view.deinit();

    // Set viewport to show lines 10-34 (25 lines starting at offset 10)
    const vp = Viewport{ .x = 0, .y = 10, .width = 80, .height = 25 };
    editor_view.setViewport(vp);

    const vlines = editor_view.getVirtualLines();
    try testing.expectEqual(@as(usize, 25), vlines.len);

    // First virtual line should be from source line 10
    try testing.expectEqual(@as(usize, 10), vlines[0].source_line);
    // Last virtual line should be from source line 34
    try testing.expectEqual(@as(usize, 34), vlines[24].source_line);
}

test "EditorView: viewport slicing at end of content" {
    var text_buffer = try initTextBuffer();
    defer {
        text_buffer.deinit();
        deinitGraphemeGlobals();
    }

    // Add 10 lines of text
    var text_lines = std.ArrayList(u8).init(testing.allocator);
    defer text_lines.deinit();
    var i: usize = 0;
    while (i < 10) : (i += 1) {
        try text_lines.writer().print("Line {d}\n", .{i});
    }
    try text_buffer.setText(text_lines.items);

    var text_buffer_view = try TextBufferView.init(testing.allocator, text_buffer);
    defer text_buffer_view.deinit();

    var editor_view = try EditorView.init(testing.allocator, text_buffer_view);
    defer editor_view.deinit();

    // Set viewport beyond content
    const vp = Viewport{ .x = 0, .y = 5, .width = 80, .height = 25 };
    editor_view.setViewport(vp);

    const vlines = editor_view.getVirtualLines();
    // Should only return remaining lines (5 onwards)
    // Note: setText adds an extra line for the final newline, so we have 11 lines total (0-10)
    // Viewport starts at 5, so we get lines 5-10 = 6 lines
    try testing.expectEqual(@as(usize, 6), vlines.len);
}

test "EditorView: wrap width override when wrapping enabled" {
    var text_buffer = try initTextBuffer();
    defer {
        text_buffer.deinit();
        deinitGraphemeGlobals();
    }

    // Add a long line that will wrap
    const long_line = "This is a very long line that will definitely wrap when we set a narrow viewport width. " ++
        "It contains many words and should be split across multiple virtual lines.";
    try text_buffer.setText(long_line);

    var text_buffer_view = try TextBufferView.init(testing.allocator, text_buffer);
    defer text_buffer_view.deinit();

    // Enable wrapping with initial width
    text_buffer_view.setWrapWidth(80);
    text_buffer_view.setWrapMode(.word);

    var editor_view = try EditorView.init(testing.allocator, text_buffer_view);
    defer editor_view.deinit();

    // Set viewport with narrow width - this should override wrap width
    const vp = Viewport{ .x = 0, .y = 0, .width = 40, .height = 25 };
    editor_view.setViewport(vp);

    // Verify wrap width was overridden
    try testing.expectEqual(@as(?u32, 40), text_buffer_view.wrap_width);

    const vlines = editor_view.getVirtualLines();
    // Should have multiple virtual lines due to wrapping at width 40
    try testing.expect(vlines.len > 1);
}

test "EditorView: no reflow when viewport offset changes without width change" {
    var text_buffer = try initTextBuffer();
    defer {
        text_buffer.deinit();
        deinitGraphemeGlobals();
    }

    // Add 50 lines
    var text_lines = std.ArrayList(u8).init(testing.allocator);
    defer text_lines.deinit();
    var i: usize = 0;
    while (i < 50) : (i += 1) {
        try text_lines.writer().print("Line {d}\n", .{i});
    }
    try text_buffer.setText(text_lines.items);

    var text_buffer_view = try TextBufferView.init(testing.allocator, text_buffer);
    defer text_buffer_view.deinit();

    text_buffer_view.setWrapWidth(80);

    var editor_view = try EditorView.init(testing.allocator, text_buffer_view);
    defer editor_view.deinit();

    // Set initial viewport
    const vp1 = Viewport{ .x = 0, .y = 0, .width = 80, .height = 25 };
    editor_view.setViewport(vp1);

    const initial_wrap_override = editor_view.last_wrap_override;

    // Change only y offset (scrolling)
    const vp2 = Viewport{ .x = 0, .y = 10, .width = 80, .height = 25 };
    editor_view.setViewport(vp2);

    // Wrap override should remain the same (no reflow triggered)
    try testing.expectEqual(initial_wrap_override, editor_view.last_wrap_override);

    const vlines = editor_view.getVirtualLines();
    try testing.expectEqual(@as(usize, 25), vlines.len);
    try testing.expectEqual(@as(usize, 10), vlines[0].source_line);
}

test "EditorView: ensureCursorVisible - cursor below viewport" {
    var text_buffer = try initTextBuffer();
    defer {
        text_buffer.deinit();
        deinitGraphemeGlobals();
    }

    // Add 100 lines
    var text_lines = std.ArrayList(u8).init(testing.allocator);
    defer text_lines.deinit();
    var i: usize = 0;
    while (i < 100) : (i += 1) {
        try text_lines.writer().print("Line {d}\n", .{i});
    }
    try text_buffer.setText(text_lines.items);

    var text_buffer_view = try TextBufferView.init(testing.allocator, text_buffer);
    defer text_buffer_view.deinit();

    var editor_view = try EditorView.init(testing.allocator, text_buffer_view);
    defer editor_view.deinit();

    editor_view.setScrollMargin(0.1); // 10% margin

    // Set viewport showing lines 0-24
    const vp = Viewport{ .x = 0, .y = 0, .width = 80, .height = 25 };
    editor_view.setViewport(vp);

    // Move cursor to line 50 (below viewport)
    editor_view.ensureCursorVisible(50);

    const new_vp = editor_view.getViewport().?;
    // Viewport should have scrolled to keep cursor visible with margin
    try testing.expect(new_vp.y > 0);
    // Cursor should be visible: 50 should be >= new_vp.y and < new_vp.y + 25
    try testing.expect(50 >= new_vp.y);
    try testing.expect(50 < new_vp.y + 25);
}

test "EditorView: ensureCursorVisible - cursor above viewport" {
    var text_buffer = try initTextBuffer();
    defer {
        text_buffer.deinit();
        deinitGraphemeGlobals();
    }

    // Add 100 lines
    var text_lines = std.ArrayList(u8).init(testing.allocator);
    defer text_lines.deinit();
    var i: usize = 0;
    while (i < 100) : (i += 1) {
        try text_lines.writer().print("Line {d}\n", .{i});
    }
    try text_buffer.setText(text_lines.items);

    var text_buffer_view = try TextBufferView.init(testing.allocator, text_buffer);
    defer text_buffer_view.deinit();

    var editor_view = try EditorView.init(testing.allocator, text_buffer_view);
    defer editor_view.deinit();

    editor_view.setScrollMargin(0.1); // 10% margin

    // Set viewport showing lines 50-74
    const vp = Viewport{ .x = 0, .y = 50, .width = 80, .height = 25 };
    editor_view.setViewport(vp);

    // Move cursor to line 10 (above viewport)
    editor_view.ensureCursorVisible(10);

    const new_vp = editor_view.getViewport().?;
    // Viewport should have scrolled up
    try testing.expect(new_vp.y < 50);
    // Cursor should be visible
    try testing.expect(10 >= new_vp.y);
    try testing.expect(10 < new_vp.y + 25);
}

test "EditorView: ensureCursorVisible - cursor at top margin" {
    var text_buffer = try initTextBuffer();
    defer {
        text_buffer.deinit();
        deinitGraphemeGlobals();
    }

    // Add 100 lines
    var text_lines = std.ArrayList(u8).init(testing.allocator);
    defer text_lines.deinit();
    var i: usize = 0;
    while (i < 100) : (i += 1) {
        try text_lines.writer().print("Line {d}\n", .{i});
    }
    try text_buffer.setText(text_lines.items);

    var text_buffer_view = try TextBufferView.init(testing.allocator, text_buffer);
    defer text_buffer_view.deinit();

    var editor_view = try EditorView.init(testing.allocator, text_buffer_view);
    defer editor_view.deinit();

    editor_view.setScrollMargin(0.2); // 20% margin = 5 lines for height 25

    // Set viewport showing lines 20-44
    const vp = Viewport{ .x = 0, .y = 20, .width = 80, .height = 25 };
    editor_view.setViewport(vp);

    // Move cursor to line 22 (within top margin)
    editor_view.ensureCursorVisible(22);

    const new_vp = editor_view.getViewport().?;
    // Viewport should scroll up to maintain margin
    try testing.expect(new_vp.y < 20);
}

test "EditorView: getCachedLineInfo for viewport" {
    var text_buffer = try initTextBuffer();
    defer {
        text_buffer.deinit();
        deinitGraphemeGlobals();
    }

    // Add lines with different widths
    const text = "Short\nMedium line\nThis is a much longer line with more content\nTiny\nAnother line\n";
    try text_buffer.setText(text);

    var text_buffer_view = try TextBufferView.init(testing.allocator, text_buffer);
    defer text_buffer_view.deinit();

    var editor_view = try EditorView.init(testing.allocator, text_buffer_view);
    defer editor_view.deinit();

    // Set viewport to show lines 1-3
    const vp = Viewport{ .x = 0, .y = 1, .width = 80, .height = 3 };
    editor_view.setViewport(vp);

    const line_info = editor_view.getCachedLineInfo();

    // Should have info for 3 lines
    try testing.expectEqual(@as(usize, 3), line_info.starts.len);
    try testing.expectEqual(@as(usize, 3), line_info.widths.len);

    // Widths should be for lines 1, 2, 3
    try testing.expect(line_info.widths[0] > 0); // "Medium line"
    try testing.expect(line_info.widths[1] > line_info.widths[0]); // "This is a much longer..."
}

test "EditorView: getTotalVirtualLineCount" {
    var text_buffer = try initTextBuffer();
    defer {
        text_buffer.deinit();
        deinitGraphemeGlobals();
    }

    // Add 10 lines
    var text_lines = std.ArrayList(u8).init(testing.allocator);
    defer text_lines.deinit();
    var i: usize = 0;
    while (i < 10) : (i += 1) {
        try text_lines.writer().print("Line {d}\n", .{i});
    }
    try text_buffer.setText(text_lines.items);

    var text_buffer_view = try TextBufferView.init(testing.allocator, text_buffer);
    defer text_buffer_view.deinit();

    var editor_view = try EditorView.init(testing.allocator, text_buffer_view);
    defer editor_view.deinit();

    // Set viewport to show only 5 lines
    const vp = Viewport{ .x = 0, .y = 0, .width = 80, .height = 5 };
    editor_view.setViewport(vp);

    // getVirtualLines should return 5 (viewport slice)
    try testing.expectEqual(@as(usize, 5), editor_view.getVirtualLines().len);

    // getTotalVirtualLineCount should return 11 (all lines, including empty line from final \n)
    try testing.expectEqual(@as(u32, 11), editor_view.getTotalVirtualLineCount());
}
