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
    try std.testing.expectEqual(@as(u32, 32), cell_4.char);

    // With static tabs: A at col 0, tab takes 4 cols (1-4), B at col 5
    const cell_5 = opt_buffer.get(5, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 'B'), cell_5.char);
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
    try std.testing.expectEqual(@as(u32, 32), cell_4.char);

    // With static tabs: A at col 0, tab takes 4 cols (1-4), B at col 5
    const cell_5 = opt_buffer.get(5, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 'B'), cell_5.char);
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
    try std.testing.expectEqual(@as(u32, 32), cell_4.char);

    // With static tabs: A at col 0, tab takes 4 cols (1-4), B at col 5
    const cell_5 = opt_buffer.get(5, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 'B'), cell_5.char);
}

test "drawTextBuffer - mixed ASCII and Unicode with emoji renders completely" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("- ✅ All 881 native tests passs");

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        50,
        5,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0);

    const cell_0 = opt_buffer.get(0, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, '-'), cell_0.char);

    const cell_1 = opt_buffer.get(1, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, ' '), cell_1.char);

    const cell_2 = opt_buffer.get(2, 0) orelse unreachable;
    try std.testing.expect(gp.isGraphemeChar(cell_2.char));
    const width_2 = gp.encodedCharWidth(cell_2.char);
    try std.testing.expectEqual(@as(u32, 2), width_2);

    const cell_3 = opt_buffer.get(3, 0) orelse unreachable;
    try std.testing.expect(gp.isContinuationChar(cell_3.char));

    const cell_4 = opt_buffer.get(4, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, ' '), cell_4.char);

    const cell_5 = opt_buffer.get(5, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 'A'), cell_5.char);

    const cell_6 = opt_buffer.get(6, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 'l'), cell_6.char);

    const cell_7 = opt_buffer.get(7, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 'l'), cell_7.char);

    const cell_8 = opt_buffer.get(8, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, ' '), cell_8.char);

    const cell_9 = opt_buffer.get(9, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, '8'), cell_9.char);

    const cell_10 = opt_buffer.get(10, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, '8'), cell_10.char);

    const cell_11 = opt_buffer.get(11, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, '1'), cell_11.char);

    const cell_12 = opt_buffer.get(12, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, ' '), cell_12.char);

    const cell_13 = opt_buffer.get(13, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 'n'), cell_13.char);

    const cell_14 = opt_buffer.get(14, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 'a'), cell_14.char);

    const cell_15 = opt_buffer.get(15, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 't'), cell_15.char);

    const cell_16 = opt_buffer.get(16, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 'i'), cell_16.char);

    const cell_17 = opt_buffer.get(17, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 'v'), cell_17.char);

    const cell_18 = opt_buffer.get(18, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 'e'), cell_18.char);

    const cell_19 = opt_buffer.get(19, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, ' '), cell_19.char);

    const cell_20 = opt_buffer.get(20, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 't'), cell_20.char);

    const cell_21 = opt_buffer.get(21, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 'e'), cell_21.char);

    const cell_22 = opt_buffer.get(22, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 's'), cell_22.char);

    const cell_23 = opt_buffer.get(23, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 't'), cell_23.char);

    const cell_24 = opt_buffer.get(24, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 's'), cell_24.char);

    const cell_25 = opt_buffer.get(25, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, ' '), cell_25.char);

    const cell_26 = opt_buffer.get(26, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 'p'), cell_26.char);

    const cell_27 = opt_buffer.get(27, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 'a'), cell_27.char);

    const cell_28 = opt_buffer.get(28, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 's'), cell_28.char);

    const cell_29 = opt_buffer.get(29, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 's'), cell_29.char);

    const cell_30 = opt_buffer.get(30, 0) orelse unreachable;
    try std.testing.expectEqual(@as(u32, 's'), cell_30.char);

    var out_buffer: [500]u8 = undefined;
    const written = try opt_buffer.writeResolvedChars(&out_buffer, false);
    const result = out_buffer[0..written];

    try std.testing.expect(std.mem.indexOf(u8, result, "- ✅ All 881 native tests passs") != null);

    const plain_text = tb.getPlainTextIntoBuffer(&out_buffer);
    const plain_result = out_buffer[0..plain_text];
    try std.testing.expectEqualStrings("- ✅ All 881 native tests passs", plain_result);
}

test "viewport width = 31 exactly - last character rendering" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("- ✅ All 881 native tests passs");

    // Set viewport width to EXACTLY 31 (the display width needed)
    view.setViewport(text_buffer_view.Viewport{ .x = 0, .y = 0, .width = 31, .height = 1 });

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        50,
        5,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0);

    std.debug.print("\n=== VIEWPORT WIDTH = 31 TEST ===\n", .{});

    // Check critical cells
    var i: u32 = 0;
    while (i <= 30) : (i += 1) {
        if (opt_buffer.get(i, 0)) |cell| {
            std.debug.print("Cell {d:2}: ", .{i});
            if (cell.char >= 32 and cell.char < 127) {
                std.debug.print("'{c}'\n", .{@as(u8, @intCast(cell.char))});
            } else if (gp.isGraphemeChar(cell.char)) {
                std.debug.print("[GRAPHEME w={}]\n", .{gp.encodedCharWidth(cell.char)});
            } else if (gp.isContinuationChar(cell.char)) {
                std.debug.print("[CONTINUATION]\n", .{});
            } else {
                std.debug.print("SPACE\n", .{});
            }
        } else {
            std.debug.print("Cell {d:2}: NULL\n", .{i});
        }
    }

    // BUG CHECK: The last 's' at cell 30 should be present
    const cell_30 = opt_buffer.get(30, 0);
    if (cell_30) |c| {
        std.debug.print("\n✓ Cell 30 exists: '{c}'\n", .{@as(u8, @intCast(c.char))});
        try std.testing.expectEqual(@as(u32, 's'), c.char);
    } else {
        std.debug.print("\n✗ BUG REPRODUCED: Cell 30 is NULL!\n", .{});
        return error.TestFailed;
    }
}

test "drawTextBuffer - complex multilingual text with diverse scripts and emojis" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    const text =
        \\# The Celestial Journey of संस्कृति 🌟🔮✨
        \\In the beginning, there was नमस्ते 🙏 and the ancient wisdom of the ॐ symbol echoing through dimensions. The travelers 🧑‍🚀👨‍🚀👩‍🚀 embarked on their quest through the cosmos, guided by the mysterious རྒྱ་མཚོ and the luminous 🌈🦄🧚‍♀️ beings of light. They encountered the great देवनागरी scribes who wrote in flowing अक्षर characters, documenting everything in their sacred texts 📜📖✍️.
        \\## Chapter प्रथम: The Eastern Gardens 🏯🎋🌸
        \\The journey led them to the mystical lands where 漢字 (kanji) danced with ひらがな and カタカナ across ancient scrolls 📯🎴🎎. In the gardens of Seoul, they found 한글 inscriptions speaking of 사랑 (love) and 평화 (peace) 💝🕊️☮️. The monks meditated under the bodhi tree 🧘‍♂️🌳, contemplating the nature of धर्म while drinking matcha 🍵 and eating 餃子 dumplings 🥟.
        \\Strange creatures emerged from the mist: 🦥🦦🦧🦨🦩🦚🦜🦝🦞🦟. They spoke in riddles about the प्राचीन (ancient) ways and the नवीन (new) paths forward. "भविष्य में क्या है?" they asked, while the ໂຫຍ່າກເຈົ້າ whispered secrets in Lao script 🤫🗣️💬.
        \\## The संगम (Confluence) of Scripts 🌊📝🎭
        \\At the great confluence, they witnessed the merger of བོད་ཡིག (Tibetan), ગુજરાતી (Gujarati), and தமிழ் (Tamil) scripts flowing together like rivers 🏞️🌊💧. The scholars debated about ਪੰਜਾਬੀ philosophy while juggling 🤹‍♂️🎪🎨 colorful orbs that represented different తెలుగు concepts.
        \\The marketplace buzzed with activity 🏪🛒💰: merchants sold বাংলা spices 🌶️🧄🧅, ಕನ್ನಡ silks 🧵👘, and മലയാളം handicrafts 🎨🖼️. Children played with toys shaped like 🦖🦕🐉🐲 while their parents bargained using ancient ଓଡ଼ିଆ numerals and gestures 🤝🤲👐.
        \\## The Festival of ๑๐๐ Lanterns 🏮🎆🎇
        \\During the grand festival, they lit exactly ๑๐๐ (100 in Thai numerals) lanterns 🏮🕯️💡 that floated into the night sky like ascending ความหวัง (hopes). The celebration featured dancers 💃🕺🩰 performing classical moves from भरतनाट्यम tradition, their मुद्रा hand gestures telling stories of प्रेम and वीरता.
        \\Musicians played unusual instruments: the 🎻🎺🎷🎸🪕🪘 ensemble created harmonies that resonated with the वेद chants and མཆོད་རྟེན bells 🔔⛩️. The audience sat mesmerized 😵‍💫🤯✨, some sipping on bubble tea 🧋 while others enjoyed मिठाई sweets 🍬🍭🧁.
        \\## The འཕྲུལ་དེབ (Machine) Age Arrives ⚙️🤖🦾
        \\As modernity crept in, the ancient འཁོར་ལོ (wheel) gave way to 🚗🚕🚙🚌🚎 vehicles and eventually to 🚀🛸🛰️ spacecraft. The યુવાન (youth) learned to code in Python 🐍💻⌨️, but still honored their గురువు (teachers) who taught them the old ways of ज्ञान acquisition 🧠📚🎓.
        \\The সমাজ (society) transformed: robots 🤖🦾🦿 worked alongside humans 👨‍💼👩‍💼👨‍🔬👩‍🔬, and AI learned to read སྐད (languages) from across the planet 🌍🌎🌏. Yet somehow, the essence of मानवता remained intact, preserved in the கவிதை (poetry) and the ກາບແກ້ວ stories passed down through generations 👴👵👨‍👩‍👧‍👦.
        \\## The Final ಅಧ್ಯಾಯ (Chapter) 🌅🌄🌠
        \\As the sun set over the പർവ്വതങ്ങൾ (mountains) 🏔️⛰️🗻, our travelers realized that every script, every symbol—from ا to ㄱ to অ to अ—represented not just sounds, but entire civilizations' worth of विचार (thoughts) and ಕನಸು (dreams) 💭💤🌌.
        \\They gathered around the final campfire 🔥🏕️, sharing stories in ภาษา (languages) both ancient and new. Someone brought out a guitar 🎸 and started singing in ગીત form, while others prepared ආහාර (food) 🍛🍲🥘 seasoned with love ❤️💕💖 and memories 📸🎞️📹.
        \\And so they learned that whether written in দেবনাগরী, 中文, 한글, or ไทย, the human experience transcends boundaries 🌐🤝🌈. The weird emojis 🦩🧿🪬🫀🫁🧠 and complex scripts were all part of the same beautiful བསྟན་པ (teaching): that diversity is our greatest strength 💪✊🙌.
        \\The end. समाप्त. 끝. จบ. முடிவு. ముగింపు. সমাপ্তি. ഒടുക്കം. ಅಂತ್ಯ. અંત. 🎬🎭🎪✨🌟⭐
        \\
    ;

    try tb.setText(text);

    // Test with word wrapping
    view.setWrapMode(.word);
    view.setWrapWidth(80);
    view.updateVirtualLines();

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        100,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0);

    // Verify the text buffer can handle complex multilingual content
    const virtual_lines = view.getVirtualLines();
    try std.testing.expect(virtual_lines.len > 0);

    // Test that we can get the plain text back
    var plain_buffer: [10000]u8 = undefined;
    const plain_len = tb.getPlainTextIntoBuffer(&plain_buffer);
    const plain_text = plain_buffer[0..plain_len];

    // Verify some key multilingual content is present
    try std.testing.expect(std.mem.indexOf(u8, plain_text, "संस्कृति") != null);
    try std.testing.expect(std.mem.indexOf(u8, plain_text, "नमस्ते") != null);
    try std.testing.expect(std.mem.indexOf(u8, plain_text, "漢字") != null);
    try std.testing.expect(std.mem.indexOf(u8, plain_text, "한글") != null);
    try std.testing.expect(std.mem.indexOf(u8, plain_text, "தமிழ்") != null);
    try std.testing.expect(std.mem.indexOf(u8, plain_text, "বাংলা") != null);
    try std.testing.expect(std.mem.indexOf(u8, plain_text, "ಕನ್ನಡ") != null);
    try std.testing.expect(std.mem.indexOf(u8, plain_text, "മലയാളം") != null);
    try std.testing.expect(std.mem.indexOf(u8, plain_text, "🌟") != null);
    try std.testing.expect(std.mem.indexOf(u8, plain_text, "🙏") != null);

    // Test with no wrapping
    view.setWrapMode(.none);
    view.setWrapWidth(null);
    view.updateVirtualLines();

    const no_wrap_lines = view.getVirtualLines();
    // Should have one line per actual newline in the text
    try std.testing.expect(no_wrap_lines.len > 10);

    // Test with character wrapping on narrow width
    view.setWrapMode(.char);
    view.setWrapWidth(40);
    view.updateVirtualLines();

    const char_wrap_lines = view.getVirtualLines();
    // Should wrap into many more lines
    try std.testing.expect(char_wrap_lines.len > virtual_lines.len);

    // Test viewport scrolling through the content
    view.setWrapMode(.word);
    view.setWrapWidth(80);
    view.setViewport(.{ .x = 0, .y = 10, .width = 80, .height = 20 });
    view.updateVirtualLines();

    const viewport_lines = view.getVirtualLines();
    try std.testing.expect(viewport_lines.len <= 20);

    // Verify rendering doesn't crash with complex emoji sequences
    try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try opt_buffer.drawTextBuffer(view, 0, 0);

    // Test that line count is reasonable
    const line_count = tb.getLineCount();
    try std.testing.expect(line_count > 15);
}
