const std = @import("std");
const renderer = @import("../renderer.zig");
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const buffer = @import("../buffer.zig");
const gp = @import("../grapheme.zig");
const ss = @import("../syntax-style.zig");
const link = @import("../link.zig");
const ansi = @import("../ansi.zig");

const CliRenderer = renderer.CliRenderer;
const TextBuffer = text_buffer.TextBuffer;
const TextBufferView = text_buffer_view.TextBufferView;
const OptimizedBuffer = buffer.OptimizedBuffer;
const RGBA = text_buffer.RGBA;

fn createWithOptionsOnce(allocator: std.mem.Allocator, width: u32, height: u32) !void {
    const pool = gp.initGlobalPool(allocator);
    defer gp.deinitGlobalPool();
    defer link.deinitGlobalLinkPool();

    var cli_renderer = try CliRenderer.createWithOptions(allocator, width, height, pool, true, false);
    cli_renderer.destroy();
}

test "renderer - createWithOptions late allocation failure cleans up" {
    const allocation_count = blk: {
        var counting_allocator = std.testing.FailingAllocator.init(std.testing.allocator, .{});
        try createWithOptionsOnce(counting_allocator.allocator(), 80, 24);
        break :blk counting_allocator.alloc_index;
    };

    try std.testing.expect(allocation_count > 0);

    var failing_allocator = std.testing.FailingAllocator.init(std.testing.allocator, .{
        .fail_index = allocation_count - 1,
    });

    try std.testing.expectError(error.OutOfMemory, createWithOptionsOnce(failing_allocator.allocator(), 80, 24));
    try std.testing.expect(failing_allocator.has_induced_failure);
    try std.testing.expectEqual(failing_allocator.allocated_bytes, failing_allocator.freed_bytes);
}

test "renderer - create and destroy" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
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
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("Hello World");

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
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
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("Line 1\nLine 2\nLine 3");

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
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
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("Hi 👋 there");

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
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
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("Hello 世界");

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
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
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("A 😀 世");

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
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
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
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
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
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
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("");

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
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
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .unicode);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
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
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .unicode);
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
        true,
    );
    defer cli_renderer.destroy();

    var opt_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        24,
        .{ .pool = pool, .width_method = .unicode },
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

    var tb = try TextBuffer.init(std.testing.allocator, limited_pool, link.initGlobalLinkPool(std.testing.allocator), .unicode);
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
        true,
    );
    defer cli_renderer.destroy();

    var frame_buffer = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        24,
        .{ .pool = limited_pool, .width_method = .unicode, .respectAlpha = false },
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

test "renderer - unchanged grapheme should not churn IDs across frames" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        4,
        1,
        pool,
        true,
    );
    defer cli_renderer.destroy();

    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };
    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };

    const first_next_buffer = cli_renderer.getNextBuffer();
    try first_next_buffer.drawText("👋", 0, 0, fg, bg, 0);
    cli_renderer.render(false);

    const first_output = cli_renderer.getLastOutputForTest();
    try std.testing.expect(std.mem.indexOf(u8, first_output, "👋") != null);

    const current_buffer = cli_renderer.getCurrentBuffer();
    const first_cell = current_buffer.get(0, 0);
    try std.testing.expect(first_cell != null);
    try std.testing.expect(gp.isGraphemeChar(first_cell.?.char));
    const first_gid = gp.graphemeIdFromChar(first_cell.?.char);

    const second_next_buffer = cli_renderer.getNextBuffer();
    try second_next_buffer.drawText("👋", 0, 0, fg, bg, 0);

    const second_cell = second_next_buffer.get(0, 0);
    try std.testing.expect(second_cell != null);
    try std.testing.expect(gp.isGraphemeChar(second_cell.?.char));
    const second_gid = gp.graphemeIdFromChar(second_cell.?.char);

    // Same grapheme content in consecutive frames should keep a stable ID,
    // otherwise diff/write treats unchanged cells as modified every frame.
    try std.testing.expectEqual(first_gid, second_gid);

    cli_renderer.render(false);

    const second_output = cli_renderer.getLastOutputForTest();
    try std.testing.expect(std.mem.indexOf(u8, second_output, "👋") == null);
}

test "renderer - hyperlinks enabled with OSC 8 output" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const local_link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
        true,
    );
    defer cli_renderer.destroy();

    // Enable hyperlinks capability
    cli_renderer.terminal.caps.hyperlinks = true;

    // Allocate a link
    const link_id = try local_link_pool.alloc("https://example.com");
    const attributes = ansi.TextAttributes.setLinkId(ansi.TextAttributes.BOLD, link_id);

    const next_buffer = cli_renderer.getNextBuffer();

    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };
    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try next_buffer.drawText("Click here", 0, 0, fg, bg, attributes);

    cli_renderer.render(false);

    const output = cli_renderer.getLastOutputForTest();

    // Verify OSC 8 contains id parameter
    try std.testing.expect(std.mem.indexOf(u8, output, "\x1b]8;id=") != null);
    // Verify OSC 8 contains the URL
    try std.testing.expect(std.mem.indexOf(u8, output, ";https://example.com\x1b\\") != null);

    // Verify output contains OSC 8 end sequence
    const end_seq = "\x1b]8;;\x1b\\";
    var count: usize = 0;
    var pos: usize = 0;
    while (std.mem.indexOf(u8, output[pos..], end_seq)) |found| {
        count += 1;
        pos += found + end_seq.len;
    }
    try std.testing.expect(count >= 1);
}

test "renderer - hyperlinks disabled no OSC 8 output" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const local_link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
        true,
    );
    defer cli_renderer.destroy();

    // Hyperlinks disabled by default
    cli_renderer.terminal.caps.hyperlinks = false;

    // Allocate a link
    const link_id = try local_link_pool.alloc("https://example.com");
    const attributes = ansi.TextAttributes.setLinkId(0, link_id);

    const next_buffer = cli_renderer.getNextBuffer();

    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };
    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try next_buffer.drawText("Click here", 0, 0, fg, bg, attributes);

    cli_renderer.render(false);

    const output = cli_renderer.getLastOutputForTest();

    // Verify output does NOT contain OSC 8 sequences
    try std.testing.expect(std.mem.indexOf(u8, output, "]8;;") == null);
    try std.testing.expect(std.mem.indexOf(u8, output, "]8;id=") == null);
}

test "renderer - link transition mid-line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const local_link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
        true,
    );
    defer cli_renderer.destroy();

    // Enable hyperlinks
    cli_renderer.terminal.caps.hyperlinks = true;

    const next_buffer = cli_renderer.getNextBuffer();

    // Allocate two different links
    const link_id1 = try local_link_pool.alloc("https://first.com");
    const link_id2 = try local_link_pool.alloc("https://second.com");

    const attr1 = ansi.TextAttributes.setLinkId(0, link_id1);
    const attr2 = ansi.TextAttributes.setLinkId(0, link_id2);

    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };
    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };

    // Draw first link
    try next_buffer.drawText("First", 0, 0, fg, bg, attr1);
    // Draw second link
    try next_buffer.drawText("Second", 6, 0, fg, bg, attr2);
    // Draw no link
    try next_buffer.drawText("Normal", 13, 0, fg, bg, 0);

    cli_renderer.render(false);

    const output = cli_renderer.getLastOutputForTest();

    // Should contain both URLs
    try std.testing.expect(std.mem.indexOf(u8, output, "https://first.com") != null);
    try std.testing.expect(std.mem.indexOf(u8, output, "https://second.com") != null);

    // Should have multiple OSC 8 end sequences (at least 2 transitions)
    const end_seq = "\x1b]8;;\x1b\\";
    var count: usize = 0;
    var pos: usize = 0;
    while (std.mem.indexOf(u8, output[pos..], end_seq)) |found| {
        count += 1;
        pos += found + end_seq.len;
    }
    try std.testing.expect(count >= 2);
}

test "renderer - hyperlink spanning multiple rows uses same id" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
        true,
    );
    defer cli_renderer.destroy();

    // Enable hyperlinks
    cli_renderer.terminal.caps.hyperlinks = true;

    const next_buffer = cli_renderer.getNextBuffer();

    // Allocate a single link
    const link_id = try link_pool.alloc("https://example.com/long-url");
    const attributes = ansi.TextAttributes.setLinkId(0, link_id);

    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };
    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };

    // Fill entire row 0 with linked text so link is never interrupted by empty cells
    try next_buffer.drawText("01234567890123456789012345678901234567890123456789012345678901234567890123456789", 0, 0, fg, bg, attributes);
    // Continue the same link on row 1
    try next_buffer.drawText("Here", 0, 1, fg, bg, attributes);

    cli_renderer.render(false);

    const output = cli_renderer.getLastOutputForTest();

    // Build expected OSC 8 open sequence with the link id
    var buf: [256]u8 = undefined;
    const expected_open = std.fmt.bufPrint(&buf, "\x1b]8;id={d};https://example.com/long-url\x1b\\", .{link_id}) catch unreachable;
    var count: usize = 0;
    var pos: usize = 0;
    while (std.mem.indexOf(u8, output[pos..], expected_open)) |found| {
        count += 1;
        pos += found + expected_open.len;
    }
    // Should appear exactly once: the link stays open across rows without
    // close/reopen at row boundaries, so terminals treat it as one contiguous link.
    try std.testing.expectEqual(@as(usize, 1), count);
}

// ============================================================================
// GRAPHEME CURSOR POSITIONING TESTS
// ============================================================================

test "renderer - explicit_cursor_positioning emits cursor move after wide graphemes" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("👋X");

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
        true,
    );
    defer cli_renderer.destroy();

    cli_renderer.terminal.caps.explicit_cursor_positioning = true;
    cli_renderer.terminal.caps.explicit_width = false;

    const next_buffer = cli_renderer.getNextBuffer();
    try next_buffer.drawTextBuffer(view, 0, 0);

    cli_renderer.render(false);

    const output = cli_renderer.getLastOutputForTest();

    try std.testing.expect(std.mem.indexOf(u8, output, "\x1b[1;3H") != null);
}

test "renderer - explicit_cursor_positioning produces more cursor moves" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .unicode);
    defer tb.deinit();
    try tb.setText("👋🎉🚀");

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var cli_renderer1 = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
        true,
    );
    defer cli_renderer1.destroy();

    cli_renderer1.terminal.caps.explicit_cursor_positioning = false;
    cli_renderer1.terminal.caps.explicit_width = false;

    const next_buffer1 = cli_renderer1.getNextBuffer();
    try next_buffer1.drawTextBuffer(view, 0, 0);
    cli_renderer1.render(false);
    const output_without = cli_renderer1.getLastOutputForTest();

    var cli_renderer2 = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
        true,
    );
    defer cli_renderer2.destroy();

    cli_renderer2.terminal.caps.explicit_cursor_positioning = true;
    cli_renderer2.terminal.caps.explicit_width = false;

    const next_buffer2 = cli_renderer2.getNextBuffer();
    try next_buffer2.drawTextBuffer(view, 0, 0);
    cli_renderer2.render(false);
    const output_with = cli_renderer2.getLastOutputForTest();

    var count_without: usize = 0;
    var count_with: usize = 0;

    var i: usize = 0;
    while (i + 3 < output_without.len) : (i += 1) {
        if (output_without[i] == '\x1b' and output_without[i + 1] == '[') {
            var j = i + 2;
            while (j < output_without.len and ((output_without[j] >= '0' and output_without[j] <= '9') or output_without[j] == ';')) : (j += 1) {}
            if (j < output_without.len and output_without[j] == 'H') {
                count_without += 1;
            }
        }
    }

    i = 0;
    while (i + 3 < output_with.len) : (i += 1) {
        if (output_with[i] == '\x1b' and output_with[i + 1] == '[') {
            var j = i + 2;
            while (j < output_with.len and ((output_with[j] >= '0' and output_with[j] <= '9') or output_with[j] == ';')) : (j += 1) {}
            if (j < output_with.len and output_with[j] == 'H') {
                count_with += 1;
            }
        }
    }

    try std.testing.expect(count_with > count_without);
}

test "renderer - explicit_cursor_positioning with CJK characters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("世X");

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var cli_renderer = try CliRenderer.create(
        std.testing.allocator,
        80,
        24,
        pool,
        true,
    );
    defer cli_renderer.destroy();

    cli_renderer.terminal.caps.explicit_cursor_positioning = true;
    cli_renderer.terminal.caps.explicit_width = false;

    const next_buffer = cli_renderer.getNextBuffer();
    try next_buffer.drawTextBuffer(view, 0, 0);

    cli_renderer.render(false);

    const output = cli_renderer.getLastOutputForTest();

    try std.testing.expect(std.mem.indexOf(u8, output, "\x1b[1;3H") != null);
}
