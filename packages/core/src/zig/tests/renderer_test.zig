const std = @import("std");
const renderer = @import("../renderer.zig");
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const buffer = @import("../buffer.zig");
const gp = @import("../grapheme.zig");
const ss = @import("../syntax-style.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");

const CliRenderer = renderer.CliRenderer;
const TextBuffer = text_buffer.TextBuffer;
const TextBufferView = text_buffer_view.TextBufferView;
const OptimizedBuffer = buffer.OptimizedBuffer;
const RGBA = text_buffer.RGBA;

test "renderer - create and destroy" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
        graphemes_ptr,
        display_width_ptr,
        true,
    );
    defer cli_renderer.destroy();

    try std.testing.expectEqual(@as(u32, 80), cli_renderer.width);
    try std.testing.expectEqual(@as(u32, 24), cli_renderer.height);
    try std.testing.expect(cli_renderer.testing == true);
}

test "renderer - simple text rendering to currentRenderBuffer" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello World");

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
        graphemes_ptr,
        display_width_ptr,
        true,
    );
    defer cli_renderer.destroy();

    const next_buffer = cli_renderer.getNextBuffer();
    try next_buffer.drawTextBuffer(view, 0, 0);

    cli_renderer.render(false);

    const current_buffer = cli_renderer.getCurrentBuffer();

    const cell_h = current_buffer.get(0, 0);
    try std.testing.expect(cell_h != null);
    try std.testing.expectEqual(@as(u32, 'H'), cell_h.?.char);

    const cell_e = current_buffer.get(1, 0);
    try std.testing.expect(cell_e != null);
    try std.testing.expectEqual(@as(u32, 'e'), cell_e.?.char);

    const cell_w = current_buffer.get(6, 0);
    try std.testing.expect(cell_w != null);
    try std.testing.expectEqual(@as(u32, 'W'), cell_w.?.char);
}

test "renderer - multi-line text rendering" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Line 1\nLine 2\nLine 3");

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
        graphemes_ptr,
        display_width_ptr,
        true,
    );
    defer cli_renderer.destroy();

    const next_buffer = cli_renderer.getNextBuffer();
    try next_buffer.drawTextBuffer(view, 0, 0);
    cli_renderer.render(false);

    const current_buffer = cli_renderer.getCurrentBuffer();

    const cell_line1 = current_buffer.get(0, 0);
    try std.testing.expect(cell_line1 != null);
    try std.testing.expectEqual(@as(u32, 'L'), cell_line1.?.char);

    const cell_line2 = current_buffer.get(0, 1);
    try std.testing.expect(cell_line2 != null);
    try std.testing.expectEqual(@as(u32, 'L'), cell_line2.?.char);

    const cell_line3 = current_buffer.get(0, 2);
    try std.testing.expect(cell_line3 != null);
    try std.testing.expectEqual(@as(u32, 'L'), cell_line3.?.char);
}

test "renderer - emoji (wide grapheme) rendering" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hi 👋 there");

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
        graphemes_ptr,
        display_width_ptr,
        true,
    );
    defer cli_renderer.destroy();

    const next_buffer = cli_renderer.getNextBuffer();
    try next_buffer.drawTextBuffer(view, 0, 0);
    cli_renderer.render(false);

    const current_buffer = cli_renderer.getCurrentBuffer();

    const cell_h = current_buffer.get(0, 0);
    try std.testing.expect(cell_h != null);
    try std.testing.expectEqual(@as(u32, 'H'), cell_h.?.char);

    const cell_i = current_buffer.get(1, 0);
    try std.testing.expect(cell_i != null);
    try std.testing.expectEqual(@as(u32, 'i'), cell_i.?.char);

    const cell_space1 = current_buffer.get(2, 0);
    try std.testing.expect(cell_space1 != null);
    try std.testing.expectEqual(@as(u32, ' '), cell_space1.?.char);

    const cell_emoji = current_buffer.get(3, 0);
    try std.testing.expect(cell_emoji != null);
    try std.testing.expect(gp.isGraphemeChar(cell_emoji.?.char));

    const cell_emoji_continuation = current_buffer.get(4, 0);
    try std.testing.expect(cell_emoji_continuation != null);
    try std.testing.expect(gp.isContinuationChar(cell_emoji_continuation.?.char));

    const cell_space2 = current_buffer.get(5, 0);
    try std.testing.expect(cell_space2 != null);
    try std.testing.expectEqual(@as(u32, ' '), cell_space2.?.char);

    const cell_t = current_buffer.get(6, 0);
    try std.testing.expect(cell_t != null);
    try std.testing.expectEqual(@as(u32, 't'), cell_t.?.char);
}

test "renderer - CJK characters rendering" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Hello 世界");

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
        graphemes_ptr,
        display_width_ptr,
        true,
    );
    defer cli_renderer.destroy();

    const next_buffer = cli_renderer.getNextBuffer();
    try next_buffer.drawTextBuffer(view, 0, 0);
    cli_renderer.render(false);

    const current_buffer = cli_renderer.getCurrentBuffer();

    const cell_h = current_buffer.get(0, 0);
    try std.testing.expect(cell_h != null);
    try std.testing.expectEqual(@as(u32, 'H'), cell_h.?.char);

    const cell_space = current_buffer.get(5, 0);
    try std.testing.expect(cell_space != null);
    try std.testing.expectEqual(@as(u32, ' '), cell_space.?.char);

    const cell_cjk1 = current_buffer.get(6, 0);
    try std.testing.expect(cell_cjk1 != null);
    try std.testing.expect(gp.isGraphemeChar(cell_cjk1.?.char));

    const cell_cjk1_continuation = current_buffer.get(7, 0);
    try std.testing.expect(cell_cjk1_continuation != null);
    try std.testing.expect(gp.isContinuationChar(cell_cjk1_continuation.?.char));

    const cell_cjk2 = current_buffer.get(8, 0);
    try std.testing.expect(cell_cjk2 != null);
    try std.testing.expect(gp.isGraphemeChar(cell_cjk2.?.char));

    const cell_cjk2_continuation = current_buffer.get(9, 0);
    try std.testing.expect(cell_cjk2_continuation != null);
    try std.testing.expect(gp.isContinuationChar(cell_cjk2_continuation.?.char));
}

test "renderer - mixed ASCII, emoji, and CJK" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("A 😀 世");

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
        graphemes_ptr,
        display_width_ptr,
        true,
    );
    defer cli_renderer.destroy();

    const next_buffer = cli_renderer.getNextBuffer();
    try next_buffer.drawTextBuffer(view, 0, 0);
    cli_renderer.render(false);

    const current_buffer = cli_renderer.getCurrentBuffer();

    const cell_a = current_buffer.get(0, 0);
    try std.testing.expect(cell_a != null);
    try std.testing.expectEqual(@as(u32, 'A'), cell_a.?.char);

    const cell_space1 = current_buffer.get(1, 0);
    try std.testing.expect(cell_space1 != null);
    try std.testing.expectEqual(@as(u32, ' '), cell_space1.?.char);

    const cell_emoji = current_buffer.get(2, 0);
    try std.testing.expect(cell_emoji != null);
    try std.testing.expect(gp.isGraphemeChar(cell_emoji.?.char));

    const cell_emoji_continuation = current_buffer.get(3, 0);
    try std.testing.expect(cell_emoji_continuation != null);
    try std.testing.expect(gp.isContinuationChar(cell_emoji_continuation.?.char));

    const cell_space2 = current_buffer.get(4, 0);
    try std.testing.expect(cell_space2 != null);
    try std.testing.expectEqual(@as(u32, ' '), cell_space2.?.char);

    const cell_cjk = current_buffer.get(5, 0);
    try std.testing.expect(cell_cjk != null);
    try std.testing.expect(gp.isGraphemeChar(cell_cjk.?.char));

    const cell_cjk_continuation = current_buffer.get(6, 0);
    try std.testing.expect(cell_cjk_continuation != null);
    try std.testing.expect(gp.isContinuationChar(cell_cjk_continuation.?.char));
}

test "renderer - resize updates dimensions" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
        graphemes_ptr,
        display_width_ptr,
        true,
    );
    defer cli_renderer.destroy();

    try std.testing.expectEqual(@as(u32, 80), cli_renderer.width);
    try std.testing.expectEqual(@as(u32, 24), cli_renderer.height);

    try cli_renderer.resize(120, 40);

    try std.testing.expectEqual(@as(u32, 120), cli_renderer.width);
    try std.testing.expectEqual(@as(u32, 40), cli_renderer.height);
}

test "renderer - background color setting" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
        graphemes_ptr,
        display_width_ptr,
        true,
    );
    defer cli_renderer.destroy();

    const bg_color = RGBA{ 0.1, 0.2, 0.3, 1.0 };
    cli_renderer.setBackgroundColor(bg_color);

    try std.testing.expectEqual(bg_color, cli_renderer.backgroundColor);
}

test "renderer - empty text buffer renders correctly" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("");

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
        graphemes_ptr,
        display_width_ptr,
        true,
    );
    defer cli_renderer.destroy();

    const next_buffer = cli_renderer.getNextBuffer();
    try next_buffer.drawTextBuffer(view, 0, 0);
    cli_renderer.render(false);
}

test "renderer - multiple renders update currentRenderBuffer" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
        graphemes_ptr,
        display_width_ptr,
        true,
    );
    defer cli_renderer.destroy();

    try tb.setText("Hello");
    const next_buffer = cli_renderer.getNextBuffer();
    try next_buffer.drawTextBuffer(view, 0, 0);
    cli_renderer.render(false);

    var current_buffer = cli_renderer.getCurrentBuffer();
    var first_cell = current_buffer.get(0, 0);
    try std.testing.expect(first_cell != null);
    try std.testing.expectEqual(@as(u32, 'H'), first_cell.?.char);

    try tb.setText("World");
    const next_buffer2 = cli_renderer.getNextBuffer();
    try next_buffer2.drawTextBuffer(view, 0, 0);
    cli_renderer.render(false);

    current_buffer = cli_renderer.getCurrentBuffer();
    first_cell = current_buffer.get(0, 0);
    try std.testing.expect(first_cell != null);
    try std.testing.expectEqual(@as(u32, 'W'), first_cell.?.char);
}

test "renderer - 1000 frame render loop with setStyledText" {
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

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
        graphemes_ptr,
        display_width_ptr,
        true,
    );
    defer cli_renderer.destroy();

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        24,
        .{ .pool = pool, .width_method = .unicode },
        graphemes_ptr,
        display_width_ptr,
    );
    defer opt_buffer.deinit();

    const frame_texts = [_][]const u8{
        "Frame ASCII",
        "Frame 👋 emoji",
        "Frame 世界 CJK",
        "Mixed 😀 世",
    };

    const fg_color = [4]f32{ 1.0, 0.8, 0.6, 1.0 };
    const bg_color = [4]f32{ 0.1, 0.1, 0.2, 1.0 };

    var frame: u32 = 0;
    while (frame < 1000) : (frame += 1) {
        const text_idx = frame % frame_texts.len;
        const text = frame_texts[text_idx];

        const chunks = [_]text_buffer.StyledChunk{.{
            .text_ptr = text.ptr,
            .text_len = text.len,
            .fg_ptr = @ptrCast(&fg_color),
            .bg_ptr = @ptrCast(&bg_color),
            .attributes = 0,
        }};

        try tb.setStyledText(&chunks);
        try opt_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
        try opt_buffer.drawTextBuffer(view, 0, 0);

        const next_buffer = cli_renderer.getNextBuffer();
        try next_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
        next_buffer.drawFrameBuffer(0, 0, opt_buffer, null, null, null, null);

        cli_renderer.render(false);

        if (frame % 100 == 0) {
            const current_buffer = cli_renderer.getCurrentBuffer();
            const first_cell = current_buffer.get(0, 0);
            try std.testing.expect(first_cell != null);
            try std.testing.expect(first_cell.?.char != 32);

            try std.testing.expectEqual(frame + 1, cli_renderer.renderStats.frameCount);
        }
    }

    try std.testing.expectEqual(@as(u64, 1000), cli_renderer.renderStats.frameCount);

    const current_buffer = cli_renderer.getCurrentBuffer();
    const final_cell = current_buffer.get(0, 0);
    try std.testing.expect(final_cell != null);
    try std.testing.expectEqual(@as(u32, 'M'), final_cell.?.char);
}

test "renderer - grapheme pool refcounting with frame buffer fast path" {
    const limited_pool = gp.initGlobalPoolWithOptions(std.testing.allocator, .{
        .slots_per_page = [_]u32{ 2, 2, 2, 2, 2 },
    });
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, limited_pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const style = try ss.SyntaxStyle.init(std.testing.allocator);
    defer style.deinit();
    tb.setSyntaxStyle(style);

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        limited_pool,
        graphemes_ptr,
        display_width_ptr,
        true,
    );
    defer cli_renderer.destroy();

    var frame_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        24,
        .{ .pool = limited_pool, .width_method = .unicode, .respectAlpha = false },
        graphemes_ptr,
        display_width_ptr,
    );
    defer frame_buffer.deinit();

    const fg_color = [4]f32{ 1.0, 1.0, 1.0, 1.0 };
    const bg_color = [4]f32{ 0.0, 0.0, 0.0, 0.0 };

    const text_with_emoji = "👋";
    const chunks = [_]text_buffer.StyledChunk{.{
        .text_ptr = text_with_emoji.ptr,
        .text_len = text_with_emoji.len,
        .fg_ptr = @ptrCast(&fg_color),
        .bg_ptr = @ptrCast(&bg_color),
        .attributes = 0,
    }};
    try tb.setStyledText(&chunks);
    try frame_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    try frame_buffer.drawTextBuffer(view, 0, 0);

    const next_buffer = cli_renderer.getNextBuffer();
    next_buffer.setRespectAlpha(false);
    try next_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);

    next_buffer.drawFrameBuffer(0, 0, frame_buffer, null, null, null, null);

    try frame_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);

    var i: usize = 0;
    while (i < 10) : (i += 1) {
        const new_text = "🎉🚀💯";
        const new_chunks = [_]text_buffer.StyledChunk{.{
            .text_ptr = new_text.ptr,
            .text_len = new_text.len,
            .fg_ptr = @ptrCast(&fg_color),
            .bg_ptr = @ptrCast(&bg_color),
            .attributes = 0,
        }};
        try tb.setStyledText(&new_chunks);
        try frame_buffer.drawTextBuffer(view, 0, 0);
        try frame_buffer.clear(.{ 0.0, 0.0, 0.0, 1.0 }, 32);
    }

    cli_renderer.render(false);

    const current_buffer = cli_renderer.getCurrentBuffer();
    const rendered_cell = current_buffer.get(0, 0);
    try std.testing.expect(rendered_cell != null);
}
