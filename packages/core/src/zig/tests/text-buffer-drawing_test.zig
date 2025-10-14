const std = @import("std");
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const buffer = @import("../buffer.zig");
const gp = @import("../grapheme.zig");
const ss = @import("../syntax-style.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");

const TextBuffer = text_buffer.TextBuffer;
const TextBufferView = text_buffer_view.TextBufferView;
const OptimizedBuffer = buffer.OptimizedBuffer;
const RGBA = text_buffer.RGBA;
const WrapMode = text_buffer.WrapMode;

test "drawTextBuffer - simple single line text" {
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

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0, null);

    var out_buffer: [100]u8 = undefined;
    const written = try opt_buffer.writeResolvedChars(&out_buffer, false);
    const result = out_buffer[0..written];

    try std.testing.expect(std.mem.startsWith(u8, result, "Hello World"));
}

test "drawTextBuffer - empty text buffer" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("");

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0, null);
}

test "drawTextBuffer - multiple lines without wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 1\nLine 2\nLine 3");

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        10,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0, null);

    const virtual_lines = view.getVirtualLines();
    try std.testing.expect(virtual_lines.len == 3);
}

test "drawTextBuffer - text wrapping at word boundaries" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("This is a long line that should wrap at word boundaries");
    view.setWrapMode(.word);
    view.setWrapWidth(15);
    view.updateVirtualLines();

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        15,
        10,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0, null);

    const virtual_lines = view.getVirtualLines();
    try std.testing.expect(virtual_lines.len > 1);
}

test "drawTextBuffer - text wrapping at character boundaries" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    view.setWrapMode(.char);
    view.setWrapWidth(10);
    view.updateVirtualLines();

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        10,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0, null);

    const virtual_lines = view.getVirtualLines();
    try std.testing.expect(virtual_lines.len == 4);
}

test "drawTextBuffer - no wrapping with none mode" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("This is a very long line that extends beyond the buffer width");
    view.setWrapMode(.word);
    view.setWrapWidth(null);
    view.updateVirtualLines();

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0, null);

    const virtual_lines = view.getVirtualLines();
    try std.testing.expect(virtual_lines.len == 1);
}

test "drawTextBuffer - wrapped text with multiple lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("First long line that wraps\nSecond long line that also wraps\nThird line");
    view.setWrapMode(.word);
    view.setWrapWidth(15);
    view.updateVirtualLines();

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        15,
        15,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0, null);

    const virtual_lines = view.getVirtualLines();
    try std.testing.expect(virtual_lines.len >= 3);
}

test "drawTextBuffer - unicode characters with wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello 世界 🌟 Test wrapping");
    view.setWrapMode(.word);
    view.setWrapWidth(15);
    view.updateVirtualLines();

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        15,
        10,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0, null);

    const virtual_lines = view.getVirtualLines();
    try std.testing.expect(virtual_lines.len > 0);
}

test "drawTextBuffer - wrapping preserves wide characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("測試測試測試測試測試");
    view.setWrapMode(.char);
    view.setWrapWidth(10);
    view.updateVirtualLines();

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        10,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0, null);

    const virtual_lines = view.getVirtualLines();
    try std.testing.expect(virtual_lines.len > 1);
}

test "drawTextBuffer - wrapped text with offset position" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Short line that wraps nicely");
    view.setWrapMode(.word);
    view.setWrapWidth(10);
    view.updateVirtualLines();

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        20,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 5, 5, null);

    const cell = opt_buffer.get(5, 5);
    try std.testing.expect(cell != null);
    try std.testing.expect(cell.?.char != 32);
}

test "drawTextBuffer - clipping with scrolled view" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 1\nLine 2\nLine 3\nLine 4");

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0, null);

    const virtual_lines = view.getVirtualLines();
    try std.testing.expect(virtual_lines.len >= 4);
}

test "drawTextBuffer - wrapping with very narrow width" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello");
    view.setWrapMode(.char);
    view.setWrapWidth(3);
    view.updateVirtualLines();

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        3,
        10,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0, null);

    const virtual_lines = view.getVirtualLines();
    try std.testing.expect(virtual_lines.len == 2);
}

test "drawTextBuffer - word wrap doesn't break mid-word" {
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
    view.setWrapMode(.word);
    view.setWrapWidth(8);
    view.updateVirtualLines();

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        8,
        5,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0, null);

    const virtual_lines = view.getVirtualLines();
    try std.testing.expect(virtual_lines.len == 2);
}

test "drawTextBuffer - empty lines render correctly" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 1\n\nLine 3");

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        10,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0, null);

    const virtual_lines = view.getVirtualLines();
    try std.testing.expect(virtual_lines.len == 3);
}

test "drawTextBuffer - wrapping with tabs" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello\tWorld\tTest");
    view.setWrapMode(.word);
    view.setWrapWidth(15);
    view.updateVirtualLines();

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        15,
        10,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0, null);
}

test "drawTextBuffer - very long unwrapped line clipping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var long_text = std.ArrayList(u8).init(std.testing.allocator);
    defer long_text.deinit();
    try long_text.appendNTimes('A', 200);

    try tb.setText(long_text.items);
    view.setWrapMode(.word);
    view.setWrapWidth(null);

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0, null);

    const virtual_lines = view.getVirtualLines();
    try std.testing.expect(virtual_lines.len == 1);
}

test "drawTextBuffer - wrap mode transitions" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("This is a test line for wrapping");

    view.setWrapMode(.word);
    view.setWrapWidth(null);
    view.updateVirtualLines();
    const no_wrap_lines = view.getVirtualLines().len;

    view.setWrapMode(.char);
    view.setWrapWidth(10);
    view.updateVirtualLines();
    const char_lines = view.getVirtualLines().len;

    view.setWrapMode(.word);
    view.setWrapWidth(10);
    view.updateVirtualLines();
    const word_lines = view.getVirtualLines().len;

    try std.testing.expect(no_wrap_lines == 1);
    try std.testing.expect(char_lines > 1);
    try std.testing.expect(word_lines > 1);
}

test "drawTextBuffer - changing wrap width updates virtual lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("AAAAAAAAAAAAAAAAAAAAAAAAAAAA");

    view.setWrapMode(.char);
    view.setWrapWidth(10);
    view.updateVirtualLines();
    const lines_10 = view.getVirtualLines().len;

    view.setWrapWidth(20);
    view.updateVirtualLines();
    const lines_20 = view.getVirtualLines().len;

    view.setWrapWidth(5);
    view.updateVirtualLines();
    const lines_5 = view.getVirtualLines().len;

    try std.testing.expect(lines_10 > lines_20);
    try std.testing.expect(lines_5 > lines_10);
}

test "drawTextBuffer - wrapping with mixed ASCII and Unicode" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABC測試DEF試験GHI");
    view.setWrapMode(.char);
    view.setWrapWidth(10);
    view.updateVirtualLines();

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        10,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0, null);

    const virtual_lines = view.getVirtualLines();
    try std.testing.expect(virtual_lines.len > 1);
}
