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
const StyledChunk = text_buffer.StyledChunk;

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
    try opt_buffer.drawTextBuffer(view, 0, 0);

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
    try opt_buffer.drawTextBuffer(view, 0, 0);
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
    try opt_buffer.drawTextBuffer(view, 0, 0);

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
    try opt_buffer.drawTextBuffer(view, 0, 0);

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
    try opt_buffer.drawTextBuffer(view, 0, 0);

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
    try opt_buffer.drawTextBuffer(view, 0, 0);

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
    try opt_buffer.drawTextBuffer(view, 0, 0);

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
    try opt_buffer.drawTextBuffer(view, 0, 0);

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
    try opt_buffer.drawTextBuffer(view, 0, 0);

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
    try opt_buffer.drawTextBuffer(view, 5, 5);

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
    try opt_buffer.drawTextBuffer(view, 0, 0);

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
    try opt_buffer.drawTextBuffer(view, 0, 0);

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
    try opt_buffer.drawTextBuffer(view, 0, 0);

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
    try opt_buffer.drawTextBuffer(view, 0, 0);

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
    try opt_buffer.drawTextBuffer(view, 0, 0);
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
    try opt_buffer.drawTextBuffer(view, 0, 0);

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
    try opt_buffer.drawTextBuffer(view, 0, 0);

    const virtual_lines = view.getVirtualLines();
    try std.testing.expect(virtual_lines.len > 1);
}

test "setStyledText - basic rendering with single chunk" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const style = try ss.SyntaxStyle.init(std.testing.allocator);
    defer style.deinit();
    tb.setSyntaxStyle(style);

    const text = "Hello World";
    const fg_color = [4]f32{ 1.0, 1.0, 1.0, 1.0 };

    const chunks = [_]StyledChunk{.{
        .text_ptr = text.ptr,
        .text_len = text.len,
        .fg_ptr = @ptrCast(&fg_color),
        .bg_ptr = null,
        .attributes = 0,
    }};

    try tb.setStyledText(&chunks);

    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    const result = out_buffer[0..written];

    try std.testing.expectEqualStrings("Hello World", result);
}

test "setStyledText - multiple chunks render correctly" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const style = try ss.SyntaxStyle.init(std.testing.allocator);
    defer style.deinit();
    tb.setSyntaxStyle(style);

    const text0 = "Hello ";
    const text1 = "World";
    const fg_color = [4]f32{ 1.0, 1.0, 1.0, 1.0 };

    const chunks = [_]StyledChunk{
        .{ .text_ptr = text0.ptr, .text_len = text0.len, .fg_ptr = @ptrCast(&fg_color), .bg_ptr = null, .attributes = 0 },
        .{ .text_ptr = text1.ptr, .text_len = text1.len, .fg_ptr = @ptrCast(&fg_color), .bg_ptr = null, .attributes = 0 },
    };

    try tb.setStyledText(&chunks);

    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    const result = out_buffer[0..written];

    try std.testing.expectEqualStrings("Hello World", result);
}

// Viewport Tests

test "viewport - basic vertical scrolling limits returned lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9");

    view.setViewport(.{ .x = 0, .y = 2, .width = 20, .height = 5 });

    const visible_lines = view.getVirtualLines();

    try std.testing.expectEqual(@as(usize, 5), visible_lines.len);
    try std.testing.expectEqual(@as(usize, 2), visible_lines[0].source_line);
    try std.testing.expectEqual(@as(usize, 6), visible_lines[4].source_line);
}

test "viewport - vertical scrolling at start boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4");

    view.setViewport(.{ .x = 0, .y = 0, .width = 20, .height = 3 });

    const visible_lines = view.getVirtualLines();

    try std.testing.expectEqual(@as(usize, 3), visible_lines.len);
    try std.testing.expectEqual(@as(usize, 0), visible_lines[0].source_line);
    try std.testing.expectEqual(@as(usize, 2), visible_lines[2].source_line);
}

test "viewport - vertical scrolling at end boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4");

    view.setViewport(.{ .x = 0, .y = 3, .width = 20, .height = 3 });

    const visible_lines = view.getVirtualLines();

    try std.testing.expectEqual(@as(usize, 2), visible_lines.len);
    try std.testing.expectEqual(@as(usize, 3), visible_lines[0].source_line);
    try std.testing.expectEqual(@as(usize, 4), visible_lines[1].source_line);
}

test "viewport - vertical scrolling beyond content" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 0\nLine 1\nLine 2");

    view.setViewport(.{ .x = 0, .y = 10, .width = 20, .height = 5 });

    const visible_lines = view.getVirtualLines();

    try std.testing.expectEqual(@as(usize, 0), visible_lines.len);
}

test "viewport - with wrapping vertical scrolling" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("This is a long line that will wrap\nShort\nAnother long line that wraps");

    view.setWrapMode(.word);
    view.setWrapWidth(15);
    view.updateVirtualLines();

    const total_vlines = view.getVirtualLineCount();
    try std.testing.expect(total_vlines > 3);

    view.setViewport(.{ .x = 0, .y = 2, .width = 15, .height = 3 });

    const visible_lines = view.getVirtualLines();

    try std.testing.expectEqual(@as(usize, 3), visible_lines.len);
}

test "viewport - getCachedLineInfo returns only viewport lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5");

    view.setViewport(.{ .x = 0, .y = 1, .width = 20, .height = 3 });

    const line_info = view.getCachedLineInfo();

    try std.testing.expectEqual(@as(usize, 3), line_info.starts.len);
    try std.testing.expectEqual(@as(usize, 3), line_info.widths.len);
}

test "viewport - changing viewport updates returned lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5");

    view.setViewport(.{ .x = 0, .y = 0, .width = 20, .height = 2 });
    const lines1 = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), lines1.len);
    try std.testing.expectEqual(@as(usize, 0), lines1[0].source_line);

    view.setViewport(.{ .x = 0, .y = 3, .width = 20, .height = 2 });
    const lines2 = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), lines2.len);
    try std.testing.expectEqual(@as(usize, 3), lines2[0].source_line);

    view.setViewport(.{ .x = 0, .y = 1, .width = 20, .height = 4 });
    const lines3 = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 4), lines3.len);
    try std.testing.expectEqual(@as(usize, 1), lines3[0].source_line);
}

test "viewport - null viewport returns all lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 0\nLine 1\nLine 2\nLine 3\nLine 4");

    const all_lines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 5), all_lines.len);

    view.setViewport(.{ .x = 0, .y = 1, .width = 20, .height = 2 });
    const viewport_lines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), viewport_lines.len);

    view.setViewport(null);
    const all_lines_again = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 5), all_lines_again.len);
}

test "viewport - setViewportSize convenience method" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 0\nLine 1\nLine 2\nLine 3");

    view.setViewportSize(20, 2);
    const vp1 = view.getViewport().?;
    try std.testing.expectEqual(@as(u32, 0), vp1.x);
    try std.testing.expectEqual(@as(u32, 0), vp1.y);
    try std.testing.expectEqual(@as(u32, 20), vp1.width);
    try std.testing.expectEqual(@as(u32, 2), vp1.height);

    view.setViewport(.{ .x = 5, .y = 1, .width = 20, .height = 2 });

    view.setViewportSize(30, 3);
    const vp2 = view.getViewport().?;
    try std.testing.expectEqual(@as(u32, 5), vp2.x);
    try std.testing.expectEqual(@as(u32, 1), vp2.y);
    try std.testing.expectEqual(@as(u32, 30), vp2.width);
    try std.testing.expectEqual(@as(u32, 3), vp2.height);
}

test "viewport - stores horizontal offset value with no wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRSTUVWXYZ");

    view.setWrapMode(.none);
    view.setWrapWidth(null);

    view.setViewport(.{ .x = 5, .y = 0, .width = 10, .height = 1 });

    const vp = view.getViewport().?;
    try std.testing.expectEqual(@as(u32, 5), vp.x);
    try std.testing.expectEqual(@as(u32, 0), vp.y);
    try std.testing.expectEqual(@as(u32, 10), vp.width);
    try std.testing.expectEqual(@as(u32, 1), vp.height);

    const lines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), lines.len);
}

test "viewport - preserves horizontal offset when changing vertical (no wrap)" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJ\nKLMNOPQRST\nUVWXYZ1234");

    view.setWrapMode(.none);
    view.setWrapWidth(null);

    view.setViewport(.{ .x = 3, .y = 0, .width = 8, .height = 2 });

    var vp = view.getViewport().?;
    try std.testing.expectEqual(@as(u32, 3), vp.x);
    try std.testing.expectEqual(@as(u32, 0), vp.y);

    view.setViewport(.{ .x = 3, .y = 1, .width = 8, .height = 2 });

    vp = view.getViewport().?;
    try std.testing.expectEqual(@as(u32, 3), vp.x);
    try std.testing.expectEqual(@as(u32, 1), vp.y);

    const visible_lines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), visible_lines.len);
    try std.testing.expectEqual(@as(usize, 1), visible_lines[0].source_line);
}

test "viewport - can set large horizontal offset (no wrap)" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Short\nLonger line here\nTiny");

    view.setWrapMode(.none);
    view.setWrapWidth(null);

    view.setViewport(.{ .x = 10, .y = 0, .width = 10, .height = 3 });

    const vp = view.getViewport().?;
    try std.testing.expectEqual(@as(u32, 10), vp.x);

    const visible_lines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 3), visible_lines.len);
}

test "viewport - horizontal and vertical offset combined (no wrap)" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 0: ABCDEFGHIJ\nLine 1: KLMNOPQRST\nLine 2: UVWXYZ1234\nLine 3: 567890ABCD");

    view.setWrapMode(.none);
    view.setWrapWidth(null);

    view.setViewport(.{ .x = 8, .y = 1, .width = 15, .height = 2 });

    const vp = view.getViewport().?;
    try std.testing.expectEqual(@as(u32, 8), vp.x);
    try std.testing.expectEqual(@as(u32, 1), vp.y);

    const visible_lines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), visible_lines.len);
    try std.testing.expectEqual(@as(usize, 1), visible_lines[0].source_line);
    try std.testing.expectEqual(@as(usize, 2), visible_lines[1].source_line);
}

test "viewport - horizontal scrolling only for no-wrap mode" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    const long_text = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    try tb.setText(long_text);

    view.setWrapMode(.none);
    view.setWrapWidth(null);
    view.setViewport(.{ .x = 10, .y = 0, .width = 15, .height = 1 });
    view.updateVirtualLines();

    var vp = view.getViewport().?;
    try std.testing.expectEqual(@as(u32, 10), vp.x);

    var lines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), lines.len);

    view.setWrapMode(.char);
    view.setViewport(.{ .x = 10, .y = 0, .width = 15, .height = 5 });
    view.updateVirtualLines();

    vp = view.getViewport().?;
    try std.testing.expectEqual(@as(u32, 10), vp.x);

    lines = view.getVirtualLines();
    try std.testing.expect(lines.len > 1);
}

test "viewport - horizontal offset irrelevant with wrapping enabled" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("This is a very long line that will wrap into multiple virtual lines");

    view.setWrapMode(.word);
    view.setWrapWidth(20);
    view.updateVirtualLines();

    const total_vlines = view.getVirtualLineCount();
    try std.testing.expect(total_vlines > 1);

    view.setViewport(.{ .x = 5, .y = 1, .width = 15, .height = 2 });

    const vp = view.getViewport().?;
    try std.testing.expectEqual(@as(u32, 5), vp.x);
    try std.testing.expectEqual(@as(u32, 1), vp.y);
    try std.testing.expectEqual(@as(u32, 15), vp.width);

    const visible_lines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), visible_lines.len);
}

test "viewport - zero width or height" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 0\nLine 1\nLine 2");

    view.setViewport(.{ .x = 0, .y = 0, .width = 20, .height = 0 });
    const lines1 = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 0), lines1.len);

    view.setViewport(.{ .x = 0, .y = 0, .width = 0, .height = 2 });
    const lines2 = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), lines2.len);
}

test "viewport - viewport sets wrap width automatically" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDD");

    view.setWrapMode(.char);

    view.setViewport(.{ .x = 0, .y = 0, .width = 10, .height = 5 });
    view.updateVirtualLines();

    const vline_count_10 = view.getVirtualLineCount();

    view.setViewport(.{ .x = 0, .y = 0, .width = 20, .height = 5 });
    view.updateVirtualLines();

    const vline_count_20 = view.getVirtualLineCount();

    try std.testing.expect(vline_count_10 > vline_count_20);
}

test "viewport - moving viewport dynamically (no wrap)" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("0123456789\nABCDEFGHIJ\nKLMNOPQRST\nUVWXYZ!@#$");

    view.setWrapMode(.none);
    view.setWrapWidth(null);

    view.setViewport(.{ .x = 0, .y = 0, .width = 5, .height = 2 });
    var vp = view.getViewport().?;
    try std.testing.expectEqual(@as(u32, 0), vp.x);
    try std.testing.expectEqual(@as(u32, 0), vp.y);
    const lines1 = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), lines1.len);
    try std.testing.expectEqual(@as(usize, 0), lines1[0].source_line);

    view.setViewport(.{ .x = 0, .y = 1, .width = 5, .height = 2 });
    vp = view.getViewport().?;
    try std.testing.expectEqual(@as(u32, 0), vp.x);
    try std.testing.expectEqual(@as(u32, 1), vp.y);
    const lines2 = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), lines2.len);
    try std.testing.expectEqual(@as(usize, 1), lines2[0].source_line);

    view.setViewport(.{ .x = 3, .y = 1, .width = 5, .height = 2 });
    vp = view.getViewport().?;
    try std.testing.expectEqual(@as(u32, 3), vp.x);
    try std.testing.expectEqual(@as(u32, 1), vp.y);
    const lines3 = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), lines3.len);

    view.setViewport(.{ .x = 5, .y = 2, .width = 5, .height = 2 });
    vp = view.getViewport().?;
    try std.testing.expectEqual(@as(u32, 5), vp.x);
    try std.testing.expectEqual(@as(u32, 2), vp.y);
    const lines4 = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), lines4.len);
    try std.testing.expectEqual(@as(usize, 2), lines4[0].source_line);
}

test "loadFile - loads and renders file correctly" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    const test_content = "ABC\nDEF";
    const tmpdir = std.testing.tmpDir(.{});
    var tmp = tmpdir;
    defer tmp.cleanup();

    const file = try tmp.dir.createFile("test.txt", .{});
    try file.writeAll(test_content);
    file.close();

    const dir_path = try tmp.dir.realpathAlloc(std.testing.allocator, ".");
    defer std.testing.allocator.free(dir_path);

    const file_path = try std.fs.path.join(std.testing.allocator, &[_][]const u8{ dir_path, "test.txt" });
    defer std.testing.allocator.free(file_path);

    try tb.loadFile(file_path);

    const line_count = tb.getLineCount();
    try std.testing.expectEqual(@as(u32, 2), line_count);

    const char_count = tb.getLength();
    try std.testing.expectEqual(@as(u32, 6), char_count);

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
    try opt_buffer.drawTextBuffer(view, 0, 0);

    var render_buffer: [200]u8 = undefined;
    const render_written = try opt_buffer.writeResolvedChars(&render_buffer, false);
    const render_result = render_buffer[0..render_written];

    try std.testing.expect(std.mem.startsWith(u8, render_result, "ABC"));
}

test "drawTextBuffer - horizontal viewport offset renders correctly without wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("0123456789ABCDEFGHIJ");

    view.setWrapMode(.none);
    view.setWrapWidth(null);
    view.setViewport(.{ .x = 5, .y = 0, .width = 10, .height = 1 });

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        1,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0);

    var out_buffer: [100]u8 = undefined;
    const written = try opt_buffer.writeResolvedChars(&out_buffer, false);
    const result = out_buffer[0..written];

    try std.testing.expect(std.mem.startsWith(u8, result, "56789ABCDE"));
}

test "drawTextBuffer - horizontal viewport offset with multiple lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNO\n0123456789!@#$%\nXYZ[\\]^_`{|}~");

    view.setWrapMode(.none);
    view.setWrapWidth(null);
    view.setViewport(.{ .x = 3, .y = 0, .width = 8, .height = 3 });

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        8,
        3,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0);

    var out_buffer: [100]u8 = undefined;
    const written = try opt_buffer.writeResolvedChars(&out_buffer, false);
    const result = out_buffer[0..written];

    try std.testing.expect(std.mem.indexOf(u8, result, "DEFGHIJK") != null);
    try std.testing.expect(std.mem.indexOf(u8, result, "3456789!") != null);
    try std.testing.expect(std.mem.indexOf(u8, result, "[\\]^_`{|") != null);
}

test "drawTextBuffer - combined horizontal and vertical viewport offsets" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line0ABCDEFGHIJ\nLine1KLMNOPQRST\nLine2UVWXYZ0123\nLine3456789!@#$");

    view.setWrapMode(.none);
    view.setWrapWidth(null);
    view.setViewport(.{ .x = 5, .y = 1, .width = 10, .height = 2 });

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        2,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0);

    var out_buffer: [100]u8 = undefined;
    const written = try opt_buffer.writeResolvedChars(&out_buffer, false);
    const result = out_buffer[0..written];

    try std.testing.expect(std.mem.indexOf(u8, result, "KLMNOPQRST") != null);
    try std.testing.expect(std.mem.indexOf(u8, result, "UVWXYZ0123") != null);
}

test "drawTextBuffer - horizontal viewport stops rendering at viewport width" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ");

    view.setWrapMode(.none);
    view.setWrapWidth(null);
    view.setViewport(.{ .x = 5, .y = 0, .width = 10, .height = 1 });

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        1,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0);

    var out_buffer: [100]u8 = undefined;
    const written = try opt_buffer.writeResolvedChars(&out_buffer, false);
    const result = out_buffer[0..written];

    try std.testing.expectEqualStrings("56789ABCDE", result[0..10]);

    const cell_9 = opt_buffer.get(9, 0);
    try std.testing.expect(cell_9 != null);
    try std.testing.expectEqual(@as(u32, 'E'), cell_9.?.char);
}

test "drawTextBuffer - horizontal viewport with small buffer renders only viewport width" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");

    view.setWrapMode(.none);
    view.setWrapWidth(null);
    view.setViewport(.{ .x = 10, .y = 0, .width = 5, .height = 1 });

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        1,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0);

    const cell_0 = opt_buffer.get(0, 0);
    try std.testing.expect(cell_0 != null);
    try std.testing.expectEqual(@as(u32, 'K'), cell_0.?.char);

    const cell_4 = opt_buffer.get(4, 0);
    try std.testing.expect(cell_4 != null);
    try std.testing.expectEqual(@as(u32, 'O'), cell_4.?.char);

    const cell_5 = opt_buffer.get(5, 0);
    try std.testing.expect(cell_5 != null);
    try std.testing.expectEqual(@as(u32, 32), cell_5.?.char);

    const cell_6 = opt_buffer.get(6, 0);
    try std.testing.expect(cell_6 != null);
    try std.testing.expectEqual(@as(u32, 32), cell_6.?.char);
}

test "drawTextBuffer - horizontal viewport width limits rendering (efficiency test)" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var long_line = std.ArrayList(u8).init(std.testing.allocator);
    defer long_line.deinit();
    try long_line.appendNTimes('A', 1000);

    try tb.setText(long_line.items);

    view.setWrapMode(.none);
    view.setWrapWidth(null);
    view.setViewport(.{ .x = 100, .y = 0, .width = 10, .height = 1 });

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        50,
        1,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0);

    var non_space_count: u32 = 0;
    var i: u32 = 0;
    while (i < 50) : (i += 1) {
        if (opt_buffer.get(i, 0)) |cell| {
            if (cell.char == 'A') {
                non_space_count += 1;
            }
        }
    }

    try std.testing.expectEqual(@as(u32, 10), non_space_count);
}

test "drawTextBuffer - overwriting wide grapheme with ASCII leaves no ghost chars" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try tb.setText("世界");
    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0);

    const first_cell = opt_buffer.get(0, 0) orelse unreachable;
    try std.testing.expect(gp.isGraphemeChar(first_cell.char));
    try std.testing.expectEqual(@as(u32, 2), gp.encodedCharWidth(first_cell.char));

    const second_cell = opt_buffer.get(1, 0) orelse unreachable;
    try std.testing.expect(gp.isContinuationChar(second_cell.char));

    try tb.setText("ABC");
    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0);

    const cell_a = opt_buffer.get(0, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 'A'), cell_a.char);
    try std.testing.expect(!gp.isGraphemeChar(cell_a.char));
    try std.testing.expect(!gp.isContinuationChar(cell_a.char));

    const cell_b = opt_buffer.get(1, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 'B'), cell_b.char);
    try std.testing.expect(!gp.isGraphemeChar(cell_b.char));
    try std.testing.expect(!gp.isContinuationChar(cell_b.char));

    const cell_c = opt_buffer.get(2, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 'C'), cell_c.char);
    try std.testing.expect(!gp.isGraphemeChar(cell_c.char));
    try std.testing.expect(!gp.isContinuationChar(cell_c.char));

    var out_buffer: [100]u8 = undefined;
    const written = try opt_buffer.writeResolvedChars(&out_buffer, false);
    const result = out_buffer[0..written];
    try std.testing.expect(std.mem.startsWith(u8, result, "ABC"));
}

test "drawTextBuffer - syntax style destroy does not crash" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var style = try ss.SyntaxStyle.init(std.testing.allocator);
    tb.setSyntaxStyle(style);

    const style_id = try style.registerStyle("test", .{ 1.0, 0.0, 0.0, 1.0 }, null, 0);
    try tb.setText("Hello World");
    try tb.addHighlightByCharRange(0, 5, style_id, 1, 0);

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
    try opt_buffer.drawTextBuffer(view, 0, 0);

    var out_buffer: [100]u8 = undefined;
    const written = try opt_buffer.writeResolvedChars(&out_buffer, false);
    const result = out_buffer[0..written];
    try std.testing.expect(std.mem.startsWith(u8, result, "Hello World"));

    style.deinit();

    try std.testing.expect(tb.getSyntaxStyle() == null);

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0);

    const written2 = try opt_buffer.writeResolvedChars(&out_buffer, false);
    const result2 = out_buffer[0..written2];
    try std.testing.expect(std.mem.startsWith(u8, result2, "Hello World"));
}

test "drawTextBuffer - tabs are rendered as spaces (empty cells)" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    tb.setTabWidth(4);

    try tb.setText("A\tB");

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
    try opt_buffer.drawTextBuffer(view, 0, 0);

    const cell_0 = opt_buffer.get(0, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 'A'), cell_0.char);

    const cell_1 = opt_buffer.get(1, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 32), cell_1.char);

    const cell_2 = opt_buffer.get(2, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 32), cell_2.char);

    const cell_3 = opt_buffer.get(3, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 32), cell_3.char);

    const cell_4 = opt_buffer.get(4, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 'B'), cell_4.char);
}


test "drawTextBuffer - tab indicator renders with correct color" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    tb.setTabWidth(4);
    try tb.setText("A\tB");

    view.setTabIndicator(@as(u32, '→'));
    view.setTabIndicatorColor(RGBA{ 0.25, 0.25, 0.25, 1.0 });

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
    try opt_buffer.drawTextBuffer(view, 0, 0);

    const cell_0 = opt_buffer.get(0, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 'A'), cell_0.char);

    const cell_1 = opt_buffer.get(1, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, '→'), cell_1.char);
    try std.testing.expectEqual(@as(f32, 0.25), cell_1.fg[0]);
    try std.testing.expectEqual(@as(f32, 0.25), cell_1.fg[1]);
    try std.testing.expectEqual(@as(f32, 0.25), cell_1.fg[2]);

    const cell_2 = opt_buffer.get(2, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 32), cell_2.char);

    const cell_3 = opt_buffer.get(3, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 32), cell_3.char);

    const cell_4 = opt_buffer.get(4, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 'B'), cell_4.char);
}

test "drawTextBuffer - tab without indicator renders as spaces" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    tb.setTabWidth(4);
    try tb.setText("A\tB");

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
    try opt_buffer.drawTextBuffer(view, 0, 0);

    const cell_0 = opt_buffer.get(0, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 'A'), cell_0.char);

    const cell_1 = opt_buffer.get(1, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 32), cell_1.char);

    const cell_2 = opt_buffer.get(2, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 32), cell_2.char);

    const cell_3 = opt_buffer.get(3, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 32), cell_3.char);

    const cell_4 = opt_buffer.get(4, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 'B'), cell_4.char);
}
