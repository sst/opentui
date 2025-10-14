const std = @import("std");
const testing = std.testing;
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const gp = @import("../grapheme.zig");

const UnifiedTextBuffer = text_buffer.UnifiedTextBuffer;
const UnifiedTextBufferView = text_buffer_view.UnifiedTextBufferView;
const RGBA = text_buffer.RGBA;

test "UnifiedTextBufferView - init and deinit" {
    std.debug.print("\n[TEST START] UnifiedTextBufferView - init and deinit\n", .{});

    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const unicode_data = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = unicode_data;

    std.debug.print("[TEST] Creating buffer...\n", .{});
    var tb = try UnifiedTextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    std.debug.print("[TEST] Creating view...\n", .{});
    var view = try UnifiedTextBufferView.init(testing.allocator, tb);
    defer view.deinit();

    // THIS IS WHERE IT HANGS!
    std.debug.print("[TEST] Calling getVirtualLineCount...\n", .{});
    const count = view.getVirtualLineCount();
    std.debug.print("[TEST] Got count: {d}\n", .{count});

    // // Empty buffer has 1 empty line
    // try testing.expectEqual(@as(u32, 1), count);
    // std.debug.print("[TEST END] UnifiedTextBufferView - init and deinit ✓\n", .{});
}

// test "UnifiedTextBufferView - no wrapping single line" {
//     const pool = gp.initGlobalPool(testing.allocator);
//     defer gp.deinitGlobalPool();

//     const unicode_data = gp.initGlobalUnicodeData(testing.allocator);
//     defer gp.deinitGlobalUnicodeData(testing.allocator);
//     const graphemes_ptr, const display_width_ptr = unicode_data;

//     var tb = try UnifiedTextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
//     defer tb.deinit();

//     try tb.setText("Hello, world!");

//     var view = try UnifiedTextBufferView.init(testing.allocator, tb);
//     defer view.deinit();

//     try testing.expectEqual(@as(u32, 1), view.getVirtualLineCount());

//     const vlines = view.getVirtualLines();
//     try testing.expectEqual(@as(usize, 1), vlines.len);
//     try testing.expectEqual(@as(u32, 13), vlines[0].width);
// }

// test "UnifiedTextBufferView - no wrapping multiple lines" {
//     const pool = gp.initGlobalPool(testing.allocator);
//     defer gp.deinitGlobalPool();

//     const unicode_data = gp.initGlobalUnicodeData(testing.allocator);
//     defer gp.deinitGlobalUnicodeData(testing.allocator);
//     const graphemes_ptr, const display_width_ptr = unicode_data;

//     var tb = try UnifiedTextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
//     defer tb.deinit();

//     try tb.setText("Line1\nLine2\nLine3");

//     var view = try UnifiedTextBufferView.init(testing.allocator, tb);
//     defer view.deinit();

//     try testing.expectEqual(@as(u32, 3), view.getVirtualLineCount());

//     const vlines = view.getVirtualLines();
//     try testing.expectEqual(@as(usize, 3), vlines.len);

//     try testing.expectEqual(@as(u32, 5), vlines[0].width);
//     try testing.expectEqual(@as(u32, 0), vlines[0].char_offset);
//     try testing.expectEqual(@as(u32, 0), vlines[0].source_line);

//     try testing.expectEqual(@as(u32, 5), vlines[1].width);
//     try testing.expectEqual(@as(u32, 5), vlines[1].char_offset);
//     try testing.expectEqual(@as(u32, 1), vlines[1].source_line);

//     try testing.expectEqual(@as(u32, 5), vlines[2].width);
//     try testing.expectEqual(@as(u32, 10), vlines[2].char_offset);
//     try testing.expectEqual(@as(u32, 2), vlines[2].source_line);
// }

// test "UnifiedTextBufferView - cached line info" {
//     const pool = gp.initGlobalPool(testing.allocator);
//     defer gp.deinitGlobalPool();

//     const unicode_data = gp.initGlobalUnicodeData(testing.allocator);
//     defer gp.deinitGlobalUnicodeData(testing.allocator);
//     const graphemes_ptr, const display_width_ptr = unicode_data;

//     var tb = try UnifiedTextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
//     defer tb.deinit();

//     try tb.setText("Short\nMedium line\nX");

//     var view = try UnifiedTextBufferView.init(testing.allocator, tb);
//     defer view.deinit();

//     const line_info = view.getCachedLineInfo();
//     try testing.expectEqual(@as(usize, 3), line_info.starts.len);
//     try testing.expectEqual(@as(usize, 3), line_info.widths.len);
//     try testing.expectEqual(@as(u32, 11), line_info.max_width); // "Medium line" is longest
// }

// test "UnifiedTextBufferView - dirty tracking" {
//     const pool = gp.initGlobalPool(testing.allocator);
//     defer gp.deinitGlobalPool();

//     const unicode_data = gp.initGlobalUnicodeData(testing.allocator);
//     defer gp.deinitGlobalUnicodeData(testing.allocator);
//     const graphemes_ptr, const display_width_ptr = unicode_data;

//     var tb = try UnifiedTextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
//     defer tb.deinit();

//     try tb.setText("Test");

//     var view = try UnifiedTextBufferView.init(testing.allocator, tb);
//     defer view.deinit();

//     // First access builds virtual lines
//     _ = view.getVirtualLineCount();

//     // Change text - should mark view dirty
//     try tb.setText("New text");

//     // Should rebuild virtual lines
//     const count = view.getVirtualLineCount();
//     try testing.expectEqual(@as(u32, 1), count);
// }

// test "UnifiedTextBufferView - selection" {
//     const pool = gp.initGlobalPool(testing.allocator);
//     defer gp.deinitGlobalPool();

//     const unicode_data = gp.initGlobalUnicodeData(testing.allocator);
//     defer gp.deinitGlobalUnicodeData(testing.allocator);
//     const graphemes_ptr, const display_width_ptr = unicode_data;

//     var tb = try UnifiedTextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
//     defer tb.deinit();

//     try tb.setText("Hello, world!");

//     var view = try UnifiedTextBufferView.init(testing.allocator, tb);
//     defer view.deinit();

//     const blue: RGBA = .{ 0.0, 0.0, 1.0, 1.0 };
//     const white: RGBA = .{ 1.0, 1.0, 1.0, 1.0 };

//     view.setSelection(0, 5, blue, white);

//     const sel = view.getSelection();
//     try testing.expect(sel != null);
//     try testing.expectEqual(@as(u32, 0), sel.?.start);
//     try testing.expectEqual(@as(u32, 5), sel.?.end);

//     view.resetSelection();
//     try testing.expect(view.getSelection() == null);
// }
