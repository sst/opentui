const std = @import("std");
const buffer_mod = @import("../buffer.zig");
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const gp = @import("../grapheme.zig");
const link = @import("../link.zig");
const ansi = @import("../ansi.zig");

const OptimizedBuffer = buffer_mod.OptimizedBuffer;
const TextBuffer = text_buffer.UnifiedTextBuffer;
const TextBufferView = text_buffer_view.UnifiedTextBufferView;
const RGBA = buffer_mod.RGBA;

test "OptimizedBuffer - init and deinit" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        10,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    try std.testing.expectEqual(@as(u32, 10), buf.getWidth());
    try std.testing.expectEqual(@as(u32, 10), buf.getHeight());
}

test "OptimizedBuffer - clear fills with default char" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        5,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    var y: u32 = 0;
    while (y < 5) : (y += 1) {
        var x: u32 = 0;
        while (x < 5) : (x += 1) {
            const cell = buf.get(x, y).?;
            try std.testing.expectEqual(@as(u32, 32), cell.char);
        }
    }
}

test "OptimizedBuffer - drawText with ASCII" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };
    try buf.drawText("Hello", 0, 0, fg, bg, 0);

    const cell_h = buf.get(0, 0).?;
    try std.testing.expectEqual(@as(u32, 'H'), cell_h.char);

    const cell_e = buf.get(1, 0).?;
    try std.testing.expectEqual(@as(u32, 'e'), cell_e.char);
}

test "OptimizedBuffer - repeated emoji rendering should not exhaust pool" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };

    var i: u32 = 0;
    while (i < 1000) : (i += 1) {
        try buf.clear(bg, null);
        try buf.drawText("🌟🎨🚀", 0, 0, fg, bg, 0);
    }

    const cell = buf.get(0, 0).?;
    try std.testing.expect(gp.isGraphemeChar(cell.char));
}

test "OptimizedBuffer - repeated CJK rendering should not exhaust pool" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };

    var i: u32 = 0;
    while (i < 1000) : (i += 1) {
        try buf.clear(bg, null);
        try buf.drawText("测试文字", 0, 0, fg, bg, 0);
    }

    const cell = buf.get(0, 0).?;
    try std.testing.expect(gp.isGraphemeChar(cell.char));
}

test "OptimizedBuffer - drawTextBuffer repeatedly should not exhaust pool" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello 🌟 World\n测试 🎨 Test\n🚀 Rocket");

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };

    var i: u32 = 0;
    while (i < 1000) : (i += 1) {
        try buf.clear(bg, null);
        try buf.drawTextBuffer(view, 0, 0);
    }
}

test "OptimizedBuffer - mixed ASCII and emoji repeated rendering" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        40,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };

    var i: u32 = 0;
    while (i < 500) : (i += 1) {
        try buf.clear(bg, null);
        try buf.drawText("A🌟B🎨C🚀D", 0, 0, fg, bg, 0);
        try buf.drawText("测试文字处理", 0, 1, fg, bg, 0);
        try buf.drawText("Hello World!", 0, 2, fg, bg, 0);
    }

    const cell = buf.get(0, 0).?;
    try std.testing.expectEqual(@as(u32, 'A'), cell.char);
}

test "OptimizedBuffer - overwriting graphemes repeatedly" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };

    var i: u32 = 0;
    while (i < 1000) : (i += 1) {
        try buf.drawText("🌟", 0, 0, fg, bg, 0);
        try buf.drawText("🎨", 0, 0, fg, bg, 0);
        try buf.drawText("🚀", 0, 0, fg, bg, 0);
    }

    const cell = buf.get(0, 0).?;
    try std.testing.expect(gp.isGraphemeChar(cell.char));
}

test "OptimizedBuffer - rendering to different positions" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };

    var i: u32 = 0;
    while (i < 100) : (i += 1) {
        try buf.clear(bg, null);

        var y: u32 = 0;
        while (y < 20) : (y += 1) {
            var x: u32 = 0;
            while (x < 60) : (x += 10) {
                try buf.drawText("🌟", x, y, fg, bg, 0);
            }
        }
    }

    const cell = buf.get(0, 0).?;
    try std.testing.expect(gp.isGraphemeChar(cell.char));
}

test "OptimizedBuffer - large text buffer with wrapping repeated render" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var text_builder: std.ArrayListUnmanaged(u8) = .{};
    defer text_builder.deinit(std.testing.allocator);

    var line: u32 = 0;
    while (line < 20) : (line += 1) {
        try text_builder.appendSlice(std.testing.allocator, "Line ");
        try text_builder.writer(std.testing.allocator).print("{d}", .{line});
        try text_builder.appendSlice(std.testing.allocator, ": 🌟 测试 🎨 Test 🚀\n");
    }

    try tb.setText(text_builder.items);

    view.setWrapMode(.char);
    view.setWrapWidth(40);

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        50,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };

    var i: u32 = 0;
    while (i < 200) : (i += 1) {
        try buf.clear(bg, null);
        try buf.drawTextBuffer(view, 0, 0);
    }
}

test "OptimizedBuffer - grapheme tracker counts" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };

    try buf.drawText("🌟🎨🚀", 0, 0, fg, bg, 0);

    const count_after_draw = buf.grapheme_tracker.getGraphemeCount();
    try std.testing.expect(count_after_draw > 0);
    try std.testing.expect(count_after_draw <= 10);

    var i: u32 = 0;
    while (i < 100) : (i += 1) {
        try buf.clear(bg, null);
        try buf.drawText("🌟🎨🚀", 0, 0, fg, bg, 0);
    }

    const count_after_repeated = buf.grapheme_tracker.getGraphemeCount();
    try std.testing.expect(count_after_repeated <= 20);
}

test "OptimizedBuffer - alternating emojis should not leak" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };

    var i: u32 = 0;
    while (i < 500) : (i += 1) {
        if (i % 2 == 0) {
            try buf.drawText("🌟🎨🚀", 0, 0, fg, bg, 0);
        } else {
            try buf.drawText("🍕🍔🍟", 0, 0, fg, bg, 0);
        }
    }

    const count = buf.grapheme_tracker.getGraphemeCount();
    try std.testing.expect(count <= 20);
}

test "OptimizedBuffer - drawTextBuffer without clear should not exhaust pool" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("🌟🎨🚀");

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    var i: u32 = 0;
    while (i < 2000) : (i += 1) {
        try buf.drawTextBuffer(view, 0, 0);
    }

    const count = buf.grapheme_tracker.getGraphemeCount();
    try std.testing.expect(count < 100);
}

test "OptimizedBuffer - many small graphemes without clear" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("• • • •");

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    var i: u32 = 0;
    while (i < 5000) : (i += 1) {
        try buf.drawTextBuffer(view, 0, 0);
    }

    const count = buf.grapheme_tracker.getGraphemeCount();
    try std.testing.expect(count < 200);
}

test "OptimizedBuffer - stress test with many graphemes" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var text_builder: std.ArrayListUnmanaged(u8) = .{};
    defer text_builder.deinit(std.testing.allocator);

    var line: u32 = 0;
    while (line < 10) : (line += 1) {
        try text_builder.appendSlice(std.testing.allocator, "🌟🎨🚀🍕🍔🍟🌈🎭🎪🎨🎬🎤🎧🎼🎹🎺🎸🎻\n");
    }

    try tb.setText(text_builder.items);

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    var i: u32 = 0;
    while (i < 1000) : (i += 1) {
        try buf.drawTextBuffer(view, 0, 0);
    }

    const count = buf.grapheme_tracker.getGraphemeCount();
    try std.testing.expect(count > 0);
    try std.testing.expect(count < 1000);

    const first_cell = buf.get(0, 0).?;
    try std.testing.expect(gp.isGraphemeChar(first_cell.char));
}

test "OptimizedBuffer - pool slot exhaustion test" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("• • • • • • • • • •");

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };

    var i: u32 = 0;
    while (i < 10000) : (i += 1) {
        if (i % 100 == 0) {
            try buf.clear(bg, null);
        }
        try buf.drawTextBuffer(view, 0, 0);
    }

    const cell = buf.get(0, 0).?;
    try std.testing.expect(gp.isGraphemeChar(cell.char));

    const count = buf.grapheme_tracker.getGraphemeCount();
    try std.testing.expect(count > 0);
    try std.testing.expect(count < 500);
}

test "OptimizedBuffer - many unique graphemes with small pool" {
    const tiny_slots = [_]u32{ 4, 4, 4, 4, 4 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, &local_pool, .wcwidth);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = &local_pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };

    var render_count: u32 = 0;
    var failure_count: u32 = 0;

    while (render_count < 1000) : (render_count += 1) {
        var text_builder: std.ArrayListUnmanaged(u8) = .{};
        defer text_builder.deinit(std.testing.allocator);

        const base_codepoint: u21 = 0x2600 + @as(u21, @intCast(render_count % 500));
        const char_bytes = [_]u8{
            @intCast(0xE0 | (base_codepoint >> 12)),
            @intCast(0x80 | ((base_codepoint >> 6) & 0x3F)),
            @intCast(0x80 | (base_codepoint & 0x3F)),
        };
        try text_builder.appendSlice(std.testing.allocator, &char_bytes);
        try text_builder.appendSlice(std.testing.allocator, " ");
        try text_builder.appendSlice(std.testing.allocator, &char_bytes);

        tb.setText(text_builder.items) catch {
            failure_count += 1;
            continue;
        };

        if (render_count % 50 == 0) {
            try buf.clear(bg, null);
            tb.reset();
        }

        buf.drawTextBuffer(view, 0, 0) catch {
            failure_count += 1;
            continue;
        };
    }

    try std.testing.expect(failure_count == 0);
}

test "OptimizedBuffer - continuous rendering without buffer recreation" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("• Hello World •\n• Test Line •\n• Another Line •");

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    var i: u32 = 0;
    while (i < 50000) : (i += 1) {
        try buf.drawTextBuffer(view, 0, 0);
    }
}

test "OptimizedBuffer - multiple buffers rendering same TextBuffer" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("🌟 • 测试 • 🎨");

    var buf1 = try OptimizedBuffer.init(
        std.testing.allocator,
        40,
        10,
        .{ .pool = pool, .id = "buffer-1" },
    );
    defer buf1.deinit();

    var buf2 = try OptimizedBuffer.init(
        std.testing.allocator,
        40,
        10,
        .{ .pool = pool, .id = "buffer-2" },
    );
    defer buf2.deinit();

    var buf3 = try OptimizedBuffer.init(
        std.testing.allocator,
        40,
        10,
        .{ .pool = pool, .id = "buffer-3" },
    );
    defer buf3.deinit();

    var i: u32 = 0;
    while (i < 5000) : (i += 1) {
        try buf1.drawTextBuffer(view, 0, 0);
        try buf2.drawTextBuffer(view, 0, 0);
        try buf3.drawTextBuffer(view, 0, 0);
    }
}

test "OptimizedBuffer - continuous render without clear with small pool" {
    const tiny_slots = [_]u32{ 2, 2, 2, 2, 2 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, &local_pool, .wcwidth);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("• Test •");

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = &local_pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    var i: u32 = 0;
    while (i < 100) : (i += 1) {
        try buf.drawTextBuffer(view, 0, 0);
    }
}

test "OptimizedBuffer - graphemes with scissor clipping and small pool" {
    const tiny_slots = [_]u32{ 3, 3, 3, 3, 3 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, &local_pool, .wcwidth);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("• • • • •");

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = &local_pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    try buf.pushScissorRect(0, 0, 5, 5);

    var i: u32 = 0;
    while (i < 100) : (i += 1) {
        try buf.drawTextBuffer(view, 20, 20);
    }
}

test "OptimizedBuffer - drawText with alpha blending and scissor" {
    const tiny_slots = [_]u32{ 3, 3, 3, 3, 3 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = &local_pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };
    const bg_alpha = RGBA{ 0.0, 0.0, 0.0, 0.5 };

    try buf.clear(bg, null);

    try buf.pushScissorRect(0, 0, 10, 10);

    var i: u32 = 0;
    while (i < 200) : (i += 1) {
        try buf.drawText("• • • •", 50, 0, fg, bg_alpha, 0);
    }
}

test "OptimizedBuffer - many unique graphemes with alpha and small pool" {
    const tiny_slots = [_]u32{ 2, 2, 2, 2, 2 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = &local_pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };
    const bg_alpha = RGBA{ 0.0, 0.0, 0.0, 0.5 };

    try buf.clear(bg, null);

    var i: u32 = 0;
    while (i < 50) : (i += 1) {
        const base_codepoint: u21 = 0x2600 + @as(u21, @intCast(i));
        const char_bytes = [_]u8{
            @intCast(0xE0 | (base_codepoint >> 12)),
            @intCast(0x80 | ((base_codepoint >> 6) & 0x3F)),
            @intCast(0x80 | (base_codepoint & 0x3F)),
        };

        var text: [4]u8 = undefined;
        @memcpy(text[0..3], &char_bytes);
        text[3] = ' ';

        try buf.drawText(&text, @intCast(i % 70), @intCast(i / 70), fg, bg_alpha, 0);
    }
}

test "OptimizedBuffer - fill buffer with many unique graphemes" {
    const tiny_slots = [_]u32{ 2, 2, 2, 2, 2 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        40,
        20,
        .{ .pool = &local_pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };

    try buf.clear(bg, null);

    var char_idx: u32 = 0;
    var y: u32 = 0;
    while (y < 15) : (y += 1) {
        var x: u32 = 0;
        while (x < 35) : (x += 2) {
            const base_codepoint: u21 = 0x2600 + @as(u21, @intCast(char_idx % 200));
            const char_bytes = [_]u8{
                @intCast(0xE0 | (base_codepoint >> 12)),
                @intCast(0x80 | ((base_codepoint >> 6) & 0x3F)),
                @intCast(0x80 | (base_codepoint & 0x3F)),
            };

            try buf.drawText(&char_bytes, x, y, fg, bg, 0);

            char_idx += 1;
        }
    }
}

test "OptimizedBuffer - verify pool growth works correctly" {
    const one_slot = [_]u32{ 1, 1, 1, 1, 1 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = one_slot,
    });
    defer local_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = &local_pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };

    try buf.clear(bg, null);

    var char_idx: u32 = 0;
    while (char_idx < 150) : (char_idx += 1) {
        const base_codepoint: u21 = 0x2600 + @as(u21, @intCast(char_idx));
        const char_bytes = [_]u8{
            @intCast(0xE0 | (base_codepoint >> 12)),
            @intCast(0x80 | ((base_codepoint >> 6) & 0x3F)),
            @intCast(0x80 | (base_codepoint & 0x3F)),
        };

        const x = @as(u32, @intCast((char_idx * 2) % 70));
        const y = @as(u32, @intCast((char_idx * 2) / 70));

        try buf.drawText(&char_bytes, x, y, fg, bg, 0);
    }
}

test "OptimizedBuffer - repeated overwriting of same grapheme" {
    const tiny_slots = [_]u32{ 3, 3, 3, 3, 3 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = &local_pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };

    try buf.drawText("•", 0, 0, fg, bg, 0);

    var i: u32 = 0;
    while (i < 500) : (i += 1) {
        try buf.drawText("•", 0, 0, fg, bg, 0);
    }

    try std.testing.expect(buf.grapheme_tracker.getGraphemeCount() <= 2);
}

test "OptimizedBuffer - two-buffer pattern should not leak" {
    const tiny_slots = [_]u32{ 4, 4, 4, 4, 4 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    var nextBuffer = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = &local_pool, .id = "next-buffer" },
    );
    defer nextBuffer.deinit();

    var currentBuffer = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = &local_pool, .id = "current-buffer" },
    );
    defer currentBuffer.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };

    var frame: u32 = 0;
    while (frame < 100) : (frame += 1) {
        try nextBuffer.drawText("• Test •", 0, 0, fg, bg, 0);

        const cell = nextBuffer.get(0, 0).?;
        currentBuffer.setRaw(0, 0, cell);

        try nextBuffer.clear(bg, null);
    }
}

test "OptimizedBuffer - set and clear cycle should not leak" {
    const tiny_slots = [_]u32{ 3, 3, 3, 3, 3 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = &local_pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };

    var frame: u32 = 0;
    while (frame < 200) : (frame += 1) {
        try buf.drawText("•", 0, 0, fg, bg, 0);
        try buf.clear(bg, null);
    }
}

test "OptimizedBuffer - repeated drawTextBuffer without clear should not leak" {
    const tiny_slots = [_]u32{ 2, 2, 2, 2, 2 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, &local_pool, .wcwidth);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("• Hello • World •");

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = &local_pool, .id = "render-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    var frame: u32 = 0;
    while (frame < 500) : (frame += 1) {
        try buf.drawTextBuffer(view, 0, 0);
    }
}

test "OptimizedBuffer - renderer two-buffer swap pattern should not leak" {
    const tiny_slots = [_]u32{ 3, 3, 3, 3, 3 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, &local_pool, .wcwidth);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("• • •");

    var current = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = &local_pool, .id = "current" },
    );
    defer current.deinit();

    var next = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = &local_pool, .id = "next" },
    );
    defer next.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try current.clear(bg, null);

    var frame: u32 = 0;
    while (frame < 300) : (frame += 1) {
        try next.drawTextBuffer(view, 0, 0);

        var x: u32 = 0;
        while (x < 10) : (x += 1) {
            if (next.get(x, 0)) |cell| {
                current.setRaw(x, 0, cell);
            }
        }

        try next.clear(bg, null);
    }
}

test "OptimizedBuffer - sustained rendering should not leak" {
    const tiny_slots = [_]u32{ 2, 2, 2, 2, 2 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, &local_pool, .wcwidth);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("  • Type any text to insert\n  • Arrow keys to move cursor\n  • Backspace/Delete to remove text");

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = &local_pool, .id = "render-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    var frame: u32 = 0;
    while (frame < 3000) : (frame += 1) {
        try buf.drawTextBuffer(view, 0, 0);
    }
}

test "OptimizedBuffer - rendering with changing content should not leak" {
    const tiny_slots = [_]u32{ 2, 2, 2, 2, 2 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, &local_pool, .wcwidth);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = &local_pool, .id = "render-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    var frame: u32 = 0;
    while (frame < 100) : (frame += 1) {
        const char_idx = frame % 10;
        const base_codepoint: u21 = 0x2600 + @as(u21, @intCast(char_idx));
        const char_bytes = [_]u8{
            @intCast(0xE0 | (base_codepoint >> 12)),
            @intCast(0x80 | ((base_codepoint >> 6) & 0x3F)),
            @intCast(0x80 | (base_codepoint & 0x3F)),
        };

        var text: [11]u8 = undefined;
        @memcpy(text[0..3], &char_bytes);
        text[3] = ' ';
        @memcpy(text[4..7], &char_bytes);
        text[7] = ' ';
        @memcpy(text[8..11], &char_bytes);

        tb.setText(&text) catch continue;

        try buf.drawTextBuffer(view, 0, 0);
    }
}

test "OptimizedBuffer - multiple TextBuffers rendering simultaneously should not leak" {
    const one_slot = [_]u32{ 1, 1, 1, 1, 1 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = one_slot,
    });
    defer local_pool.deinit();

    var tb1 = try TextBuffer.init(std.testing.allocator, &local_pool, .wcwidth);
    defer tb1.deinit();
    var view1 = try TextBufferView.init(std.testing.allocator, tb1);
    defer view1.deinit();

    var tb2 = try TextBuffer.init(std.testing.allocator, &local_pool, .wcwidth);
    defer tb2.deinit();
    var view2 = try TextBufferView.init(std.testing.allocator, tb2);
    defer view2.deinit();

    var tb3 = try TextBuffer.init(std.testing.allocator, &local_pool, .wcwidth);
    defer tb3.deinit();
    var view3 = try TextBufferView.init(std.testing.allocator, tb3);
    defer view3.deinit();

    try tb1.setText("• First •");
    try tb2.setText("• Second •");
    try tb3.setText("• Third •");

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        30,
        .{ .pool = &local_pool, .id = "main-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    var frame: u32 = 0;
    while (frame < 500) : (frame += 1) {
        try buf.drawTextBuffer(view1, 0, 0);
        try buf.drawTextBuffer(view2, 0, 10);
        try buf.drawTextBuffer(view3, 0, 20);
    }
}

test "OptimizedBuffer - grapheme refcount management" {
    const two_slots = [_]u32{ 2, 2, 2, 2, 2 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = two_slots,
    });
    defer local_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        5,
        1,
        .{ .pool = &local_pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };

    try buf.drawText("•", 0, 0, fg, bg, 0);
    const initial_cell = buf.get(0, 0).?;
    const initial_id = gp.graphemeIdFromChar(initial_cell.char);
    const initial_refcount = local_pool.getRefcount(initial_id) catch 0;

    try std.testing.expectEqual(@as(u32, 1), initial_refcount);

    var i: u32 = 0;
    while (i < 100) : (i += 1) {
        try buf.drawText("•", 0, 0, fg, bg, 0);

        const cell = buf.get(0, 0).?;
        const id = gp.graphemeIdFromChar(cell.char);
        const rc = local_pool.getRefcount(id) catch 999;
        const slot = id & 0xFFFF;

        try std.testing.expectEqual(@as(u32, 1), rc);
        try std.testing.expect(slot == 0 or slot == 1);
    }
}

test "OptimizedBuffer - drawTextBuffer with graphemes then clear removes all pool references" {
    const small_slots = [_]u32{ 4, 4, 4, 4, 4 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = small_slots,
    });
    defer local_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, &local_pool, .wcwidth);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("• Test • 🌟 • 🎨 •");

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = &local_pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };

    try buf.drawTextBuffer(view, 0, 0);

    const count_after_draw = buf.grapheme_tracker.getGraphemeCount();
    try std.testing.expect(count_after_draw > 0);

    var total_allocated_slots: u32 = 0;
    var total_free_slots: u32 = 0;
    for (local_pool.classes) |class| {
        total_allocated_slots += class.num_slots;
        total_free_slots += @intCast(class.free_list.items.len);
    }
    const slots_in_use_after_draw = total_allocated_slots - total_free_slots;
    try std.testing.expect(slots_in_use_after_draw > 0);

    try buf.clear(bg, null);

    const count_after_clear = buf.grapheme_tracker.getGraphemeCount();
    try std.testing.expectEqual(@as(u32, 0), count_after_clear);

    var total_allocated_after_clear: u32 = 0;
    var total_free_after_clear: u32 = 0;
    for (local_pool.classes) |class| {
        total_allocated_after_clear += class.num_slots;
        total_free_after_clear += @intCast(class.free_list.items.len);
    }
    try std.testing.expectEqual(total_allocated_after_clear, total_free_after_clear);

    var y: u32 = 0;
    while (y < 5) : (y += 1) {
        var x: u32 = 0;
        while (x < 20) : (x += 1) {
            const cell = buf.get(x, y).?;
            try std.testing.expectEqual(@as(u32, 32), cell.char);
            try std.testing.expect(!gp.isGraphemeChar(cell.char));
            try std.testing.expect(!gp.isContinuationChar(cell.char));
        }
    }

    try buf.drawTextBuffer(view, 0, 0);
    const count_after_redraw = buf.grapheme_tracker.getGraphemeCount();
    try std.testing.expect(count_after_redraw > 0);

    var allocated_after_redraw: u32 = 0;
    var free_after_redraw: u32 = 0;
    for (local_pool.classes) |class| {
        allocated_after_redraw += class.num_slots;
        free_after_redraw += @intCast(class.free_list.items.len);
    }
    const slots_in_use_after_redraw = allocated_after_redraw - free_after_redraw;
    try std.testing.expect(slots_in_use_after_redraw > 0);

    try buf.clear(bg, null);
    const count_after_second_clear = buf.grapheme_tracker.getGraphemeCount();
    try std.testing.expectEqual(@as(u32, 0), count_after_second_clear);

    var allocated_after_second_clear: u32 = 0;
    var free_after_second_clear: u32 = 0;
    for (local_pool.classes) |class| {
        allocated_after_second_clear += class.num_slots;
        free_after_second_clear += @intCast(class.free_list.items.len);
    }
    try std.testing.expectEqual(allocated_after_second_clear, free_after_second_clear);
}

test "OptimizedBuffer - drawTextBuffer with negative y coordinate should not panic" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Line 1\nLine 2\nLine 3\nLine 4\nLine 5");

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    // Draw text buffer at negative y coordinate (-2)
    // This simulates a scenario where content is scrolled partially off-screen
    // The first 2 lines should be clipped, and lines 3, 4, 5 should be visible
    try buf.drawTextBuffer(view, 0, -2);

    // Verify that content is properly clipped when drawn at negative y
    // Lines that are off-screen (negative y) should be skipped
    // Line 3 should appear at y=0, Line 4 at y=1, Line 5 at y=2

    // Check that Line 3 is rendered at y=0
    const cell_y0 = buf.get(0, 0).?;
    try std.testing.expectEqual(@as(u32, 'L'), cell_y0.char);

    // Check that Line 4 is rendered at y=1
    const cell_y1 = buf.get(0, 1).?;
    try std.testing.expectEqual(@as(u32, 'L'), cell_y1.char);

    // Check that Line 5 is rendered at y=2
    const cell_y2 = buf.get(0, 2).?;
    try std.testing.expectEqual(@as(u32, 'L'), cell_y2.char);

    // Verify the full content of the first visible line (Line 3)
    try std.testing.expectEqual(@as(u32, 'L'), buf.get(0, 0).?.char);
    try std.testing.expectEqual(@as(u32, 'i'), buf.get(1, 0).?.char);
    try std.testing.expectEqual(@as(u32, 'n'), buf.get(2, 0).?.char);
    try std.testing.expectEqual(@as(u32, 'e'), buf.get(3, 0).?.char);
    try std.testing.expectEqual(@as(u32, ' '), buf.get(4, 0).?.char);
    try std.testing.expectEqual(@as(u32, '3'), buf.get(5, 0).?.char);
}

test "OptimizedBuffer - cells are initialized after resize grow" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        10,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    try buf.resize(20, 20);

    // Verify new cells have default values (space = 32), not garbage
    const cell = buf.get(15, 15);
    try std.testing.expect(cell != null);
    try std.testing.expectEqual(@as(u32, 32), cell.?.char);
}

test "OptimizedBuffer - link encoding round-trip" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .id = "test-buffer", .link_pool = &local_link_pool },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };
    try buf.clear(bg, null);

    // Allocate a link
    const link_id = try local_link_pool.alloc("https://example.com");
    const attributes = ansi.TextAttributes.setLinkId(ansi.TextAttributes.BOLD, link_id);

    // Draw text with link
    try buf.drawText("Click", 0, 0, fg, bg, attributes);

    // Verify cell has correct char and attributes
    const cell = buf.get(0, 0).?;
    try std.testing.expectEqual(@as(u32, 'C'), cell.char);
    try std.testing.expectEqual(ansi.TextAttributes.BOLD, ansi.TextAttributes.getBaseAttributes(cell.attributes));
    try std.testing.expectEqual(link_id, ansi.TextAttributes.getLinkId(cell.attributes));

    // Verify link tracker has the link
    try std.testing.expect(buf.link_tracker.hasAny());
    try std.testing.expectEqual(@as(u32, 1), buf.link_tracker.getLinkCount());
}

test "OptimizedBuffer - link tracker per-cell counting" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .id = "test-buffer", .link_pool = &local_link_pool },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };
    try buf.clear(bg, null);

    // Allocate a link
    const link_id = try local_link_pool.alloc("https://example.com");
    const attributes = ansi.TextAttributes.setLinkId(0, link_id);

    // Draw text covering 3 cells
    try buf.drawText("ABC", 0, 0, fg, bg, attributes);

    // Verify link tracker has 1 unique link
    // Pool refcount is 1 (tracker owns one ref, tracks 3 cells internally)
    try std.testing.expectEqual(@as(u32, 1), buf.link_tracker.getLinkCount());
    const pool_refcount = try local_link_pool.getRefcount(link_id);
    try std.testing.expectEqual(@as(u32, 1), pool_refcount);

    // Verify tracker knows about 3 cells
    const cell_count = buf.link_tracker.used_ids.get(link_id).?;
    try std.testing.expectEqual(@as(u32, 3), cell_count);

    // Overwrite one cell without link
    try buf.drawText("X", 0, 0, fg, bg, 0);

    // Tracker cell count should drop to 2, pool refcount stays 1
    const cell_count2 = buf.link_tracker.used_ids.get(link_id).?;
    try std.testing.expectEqual(@as(u32, 2), cell_count2);
    const pool_refcount2 = try local_link_pool.getRefcount(link_id);
    try std.testing.expectEqual(@as(u32, 1), pool_refcount2);

    // Clear all - refcount should be 0 and link freed
    try buf.clear(bg, null);
    try std.testing.expectEqual(@as(u32, 0), buf.link_tracker.getLinkCount());
}

test "OptimizedBuffer - fillRect removes links" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .id = "test-buffer", .link_pool = &local_link_pool },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };
    try buf.clear(bg, null);

    // Allocate a link
    const link_id = try local_link_pool.alloc("https://example.com");
    const attributes = ansi.TextAttributes.setLinkId(0, link_id);

    // Draw linked text
    try buf.drawText("Linked", 0, 0, fg, bg, attributes);
    try buf.drawText("Text", 10, 0, fg, bg, attributes);

    // Verify links exist
    try std.testing.expect(ansi.TextAttributes.hasLink(buf.get(0, 0).?.attributes));
    try std.testing.expect(ansi.TextAttributes.hasLink(buf.get(10, 0).?.attributes));

    // Fill rect over first link
    try buf.fillRect(0, 0, 6, 1, bg);

    // Cells in rect should have no link
    try std.testing.expect(!ansi.TextAttributes.hasLink(buf.get(0, 0).?.attributes));
    try std.testing.expect(!ansi.TextAttributes.hasLink(buf.get(5, 0).?.attributes));

    // Cells outside rect should preserve link
    try std.testing.expect(ansi.TextAttributes.hasLink(buf.get(10, 0).?.attributes));
}

test "OptimizedBuffer - link reuse after free" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .id = "test-buffer", .link_pool = &local_link_pool },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };

    // Allocate first link
    const link_id1 = try local_link_pool.alloc("https://first.com");
    const attr1 = ansi.TextAttributes.setLinkId(0, link_id1);
    try buf.drawText("A", 0, 0, fg, bg, attr1);

    // Clear - should free the link
    try buf.clear(bg, null);

    // Allocate second link - should reuse same slot but different generation
    const link_id2 = try local_link_pool.alloc("https://second.com");
    try std.testing.expect(link_id1 != link_id2); // Different due to generation

    const attr2 = ansi.TextAttributes.setLinkId(0, link_id2);
    try buf.drawText("B", 0, 0, fg, bg, attr2);

    const url = try local_link_pool.get(link_id2);
    try std.testing.expect(std.mem.eql(u8, url, "https://second.com"));
}

test "OptimizedBuffer - alpha blending preserves overlay link not dest link" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .id = "test-buffer", .link_pool = &local_link_pool },
    );
    defer buf.deinit();

    const bg_opaque = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const bg_alpha = RGBA{ 0.5, 0.5, 0.5, 0.5 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };
    try buf.clear(bg_opaque, null);

    // Draw underlying text with link A
    const link_id_a = try local_link_pool.alloc("https://underlying.com");
    const attr_a = ansi.TextAttributes.setLinkId(ansi.TextAttributes.BOLD, link_id_a);
    try buf.drawText("X", 5, 0, fg, bg_opaque, attr_a);

    // Verify dest cell has link A
    const dest_cell = buf.get(5, 0).?;
    try std.testing.expectEqual(link_id_a, ansi.TextAttributes.getLinkId(dest_cell.attributes));
    try std.testing.expectEqual(@as(u32, 'X'), dest_cell.char);

    // Draw space with alpha and link B over it (will preserve 'X' but blend colors)
    const link_id_b = try local_link_pool.alloc("https://overlay.com");
    const attr_b = ansi.TextAttributes.setLinkId(0, link_id_b);
    try buf.drawText(" ", 5, 0, fg, bg_alpha, attr_b);

    // Result: char should be preserved 'X', but link should be from overlay (B), not dest (A)
    const result_cell = buf.get(5, 0).?;
    try std.testing.expectEqual(@as(u32, 'X'), result_cell.char);
    try std.testing.expectEqual(link_id_b, ansi.TextAttributes.getLinkId(result_cell.attributes));
    try std.testing.expect(ansi.TextAttributes.getLinkId(result_cell.attributes) != link_id_a);
}

test "OptimizedBuffer - alpha blending with no link clears underlying link" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .id = "test-buffer", .link_pool = &local_link_pool },
    );
    defer buf.deinit();

    const bg_opaque = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const bg_alpha = RGBA{ 0.5, 0.5, 0.5, 0.5 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };
    try buf.clear(bg_opaque, null);

    // Draw underlying text with link
    const link_id = try local_link_pool.alloc("https://underlying.com");
    const attr_link = ansi.TextAttributes.setLinkId(ansi.TextAttributes.BOLD, link_id);
    try buf.drawText("X", 5, 0, fg, bg_opaque, attr_link);

    // Verify dest cell has link
    const dest_cell = buf.get(5, 0).?;
    try std.testing.expectEqual(link_id, ansi.TextAttributes.getLinkId(dest_cell.attributes));

    // Draw space with alpha but NO link over it (will preserve 'X')
    try buf.drawText(" ", 5, 0, fg, bg_alpha, 0);

    // Result: char 'X' preserved, but link should be CLEARED (0), not preserved
    const result_cell = buf.get(5, 0).?;
    try std.testing.expectEqual(@as(u32, 'X'), result_cell.char);
    try std.testing.expectEqual(@as(u32, 0), ansi.TextAttributes.getLinkId(result_cell.attributes));

    // Link should no longer be tracked
    try std.testing.expect(!ansi.TextAttributes.hasLink(result_cell.attributes));
}

test "OptimizedBuffer - drawGrayscaleBuffer basic rendering" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    // Create a 3x3 intensity buffer with varying values
    const intensities = [_]f32{
        0.0, 0.5, 1.0, // Row 0: black, mid-gray, white
        0.25, 0.75, 0.0, // Row 1: dark gray, light gray, transparent
        1.0, 0.0, 0.5, // Row 2: white, transparent, mid-gray
    };

    // Draw at position (2, 1) with default fg (null = white)
    buf.drawGrayscaleBuffer(2, 1, &intensities, 3, 3, null, bg);

    // Verify cell at (2, 1) - intensity 0.0, should be skipped (unchanged)
    const cell_0_0 = buf.get(2, 1).?;
    try std.testing.expectEqual(@as(u32, 32), cell_0_0.char); // Space (unchanged)

    // Verify cell at (3, 1) - intensity 0.5, should have mid-gray character
    // With intensity as alpha, fg is white blended at 50% over black bg
    const cell_1_0 = buf.get(3, 1).?;
    try std.testing.expect(cell_1_0.char != 32); // Should not be space
    // Fg is white (1,1,1) blended at 50% alpha over bg - result depends on blending
    try std.testing.expect(cell_1_0.fg[0] > 0.3); // Has some white from blending

    // Verify cell at (4, 1) - intensity 1.0, should have bright character
    // With intensity 1.0, fg is white at full alpha
    const cell_2_0 = buf.get(4, 1).?;
    try std.testing.expect(cell_2_0.char != 32); // Should not be space
    try std.testing.expect(cell_2_0.fg[0] > 0.9); // Near white fg (full intensity)
}

test "OptimizedBuffer - drawGrayscaleBuffer negative position clipping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    // Create a 4x4 intensity buffer
    const intensities = [_]f32{
        0.5, 0.5, 0.5, 0.5, // Row 0: clipped (y=-1)
        0.5, 0.5, 0.5, 0.5, // Row 1: visible at y=0
        0.5, 0.5, 0.5, 0.5, // Row 2: visible at y=1
        0.5, 0.5, 0.5, 0.5, // Row 3: visible at y=2
    };

    // Draw at position (-1, -1) - should clip the first row and column
    buf.drawGrayscaleBuffer(-1, -1, &intensities, 4, 4, null, bg);

    // Cell at (0, 0) should have content from intensity[1][1] (intensity 0.5)
    const cell_0_0 = buf.get(0, 0).?;
    try std.testing.expect(cell_0_0.char != 32); // Should have been drawn

    // Cell at (2, 0) should have content from intensity[1][3]
    const cell_2_0 = buf.get(2, 0).?;
    try std.testing.expect(cell_2_0.char != 32);
}

test "OptimizedBuffer - drawGrayscaleBuffer negative position fully clipped" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        6,
        3,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    const intensities = [_]f32{
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
    };

    // Fully clipped: startX/startY exceed source dimensions
    buf.drawGrayscaleBuffer(-10, -10, &intensities, 4, 4, null, bg);

    const cell = buf.get(0, 0).?;
    try std.testing.expectEqual(@as(u32, 32), cell.char);
}

test "OptimizedBuffer - drawGrayscaleBuffer respects scissor rect" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    // Push scissor rect that only allows drawing in top-left corner
    try buf.pushScissorRect(0, 0, 2, 2);

    // Create intensity buffer
    const intensities = [_]f32{
        1.0, 1.0, 1.0, 1.0, // Row 0
        1.0, 1.0, 1.0, 1.0, // Row 1
        1.0, 1.0, 1.0, 1.0, // Row 2
        1.0, 1.0, 1.0, 1.0, // Row 3
    };

    buf.drawGrayscaleBuffer(0, 0, &intensities, 4, 4, null, bg);

    // Cells inside scissor (0,0) and (1,1) should be drawn
    const cell_0_0 = buf.get(0, 0).?;
    const cell_1_1 = buf.get(1, 1).?;
    try std.testing.expect(cell_0_0.char != 32);
    try std.testing.expect(cell_1_1.char != 32);

    // Cells outside scissor should be unchanged (space)
    const cell_3_3 = buf.get(3, 3).?;
    try std.testing.expectEqual(@as(u32, 32), cell_3_3.char);

    buf.popScissorRect();
}

test "OptimizedBuffer - drawGrayscaleBuffer intensity to character mapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    // Test specific intensity values
    const intensities = [_]f32{
        0.005, // Below threshold, should be skipped
        0.02, // Just above threshold, should be drawn
        0.5, // Mid-range
        1.0, // Maximum
    };

    buf.drawGrayscaleBuffer(0, 0, &intensities, 4, 1, null, bg);

    // intensity < 0.01 should be skipped
    const cell_0 = buf.get(0, 0).?;
    try std.testing.expectEqual(@as(u32, 32), cell_0.char);

    // intensity >= 0.01 should be drawn
    const cell_1 = buf.get(1, 0).?;
    try std.testing.expect(cell_1.char != 32);

    // Verify fg color at full intensity (1.0) - white fg blended at full alpha
    const cell_3 = buf.get(3, 0).?;
    try std.testing.expect(cell_3.fg[0] > 0.9); // R channel near 1.0 (white at full intensity)
    try std.testing.expect(cell_3.fg[1] > 0.9); // G channel near 1.0
    try std.testing.expect(cell_3.fg[2] > 0.9); // B channel near 1.0
}

test "OptimizedBuffer - drawGrayscaleBuffer alpha blending preserves underlying bg" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    // Fill buffer with red background
    const red_bg = RGBA{ 1.0, 0.0, 0.0, 1.0 };
    try buf.clear(red_bg, null);

    // Verify initial state is red
    const initial_cell = buf.get(1, 1).?;
    try std.testing.expectEqual(@as(f32, 1.0), initial_cell.bg[0]); // R
    try std.testing.expectEqual(@as(f32, 0.0), initial_cell.bg[1]); // G
    try std.testing.expectEqual(@as(f32, 0.0), initial_cell.bg[2]); // B

    // Draw grayscale with semi-transparent background (alpha = 0.5)
    const semi_transparent_bg = RGBA{ 0.0, 0.0, 1.0, 0.5 }; // Blue with 50% alpha
    const intensities = [_]f32{
        1.0, 1.0, 1.0,
        1.0, 1.0, 1.0,
        1.0, 1.0, 1.0,
    };

    buf.drawGrayscaleBuffer(0, 0, &intensities, 3, 3, null, semi_transparent_bg);

    // Verify cell at (1, 1) has blended background (not pure blue)
    const cell = buf.get(1, 1).?;
    // With alpha blending, the blue (0,0,1) at 0.5 alpha over red (1,0,0) should blend
    // The red channel should be reduced but not zero
    try std.testing.expect(cell.bg[0] > 0.1); // Some red from original bg
    try std.testing.expect(cell.bg[2] > 0.1); // Some blue from overlay

    // The foreground (grayscale) should still be white-ish
    try std.testing.expect(cell.fg[0] > 0.9);
    try std.testing.expect(cell.fg[1] > 0.9);
    try std.testing.expect(cell.fg[2] > 0.9);
}

test "OptimizedBuffer - drawGrayscaleBuffer fully transparent bg preserves underlying" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    // Fill buffer with green background
    const green_bg = RGBA{ 0.0, 1.0, 0.0, 1.0 };
    try buf.clear(green_bg, null);

    // Draw grayscale with fully transparent background
    const transparent_bg = RGBA{ 0.0, 0.0, 1.0, 0.0 }; // Transparent
    const intensities = [_]f32{
        1.0, 1.0, 1.0,
        1.0, 1.0, 1.0,
        1.0, 1.0, 1.0,
    };

    buf.drawGrayscaleBuffer(0, 0, &intensities, 3, 3, null, transparent_bg);

    // Verify cell at (1, 1) preserves the original green background
    const cell = buf.get(1, 1).?;
    // Background should still be green (original)
    try std.testing.expectEqual(@as(f32, 0.0), cell.bg[0]); // R
    try std.testing.expectEqual(@as(f32, 1.0), cell.bg[1]); // G
    try std.testing.expectEqual(@as(f32, 0.0), cell.bg[2]); // B

    // The foreground should have grayscale values
    try std.testing.expect(cell.fg[0] > 0.9);
}

test "OptimizedBuffer - drawGrayscaleBuffer opaque bg overwrites underlying" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    // Fill buffer with red background
    const red_bg = RGBA{ 1.0, 0.0, 0.0, 1.0 };
    try buf.clear(red_bg, null);

    // Draw grayscale with opaque blue background
    const blue_bg = RGBA{ 0.0, 0.0, 1.0, 1.0 };
    const intensities = [_]f32{
        1.0, 1.0, 1.0,
        1.0, 1.0, 1.0,
        1.0, 1.0, 1.0,
    };

    buf.drawGrayscaleBuffer(0, 0, &intensities, 3, 3, null, blue_bg);

    // Verify cell at (1, 1) has blended fg over bg (intensity as alpha)
    const cell = buf.get(1, 1).?;
    try std.testing.expectEqual(@as(f32, 0.0), cell.bg[0]); // R = 0
    try std.testing.expectEqual(@as(f32, 0.0), cell.bg[1]); // G = 0
    try std.testing.expectEqual(@as(f32, 1.0), cell.bg[2]); // B = 1
}

test "OptimizedBuffer - drawGrayscaleBuffer with opacity stack" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    // Fill buffer with red background
    const red_bg = RGBA{ 1.0, 0.0, 0.0, 1.0 };
    try buf.clear(red_bg, null);

    // Push 50% opacity
    try buf.pushOpacity(0.5);

    // Draw grayscale with opaque blue background (but effective opacity is 50%)
    const blue_bg = RGBA{ 0.0, 0.0, 1.0, 1.0 };
    const intensities = [_]f32{
        1.0, 1.0, 1.0,
        1.0, 1.0, 1.0,
        1.0, 1.0, 1.0,
    };

    buf.drawGrayscaleBuffer(0, 0, &intensities, 3, 3, null, blue_bg);

    buf.popOpacity();

    // Verify cell at (1, 1) has blended due to opacity stack
    const cell = buf.get(1, 1).?;
    // With 50% opacity, blue over red should blend
    try std.testing.expect(cell.bg[0] > 0.1); // Some red from original
    try std.testing.expect(cell.bg[2] > 0.1); // Some blue from overlay
}

test "OptimizedBuffer - drawGrayscaleBufferSupersampled alpha blending" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    // Fill buffer with red background
    const red_bg = RGBA{ 1.0, 0.0, 0.0, 1.0 };
    try buf.clear(red_bg, null);

    // Create 4x4 supersampled intensities (maps to 2x2 terminal cells)
    const intensities = [_]f32{
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
    };

    // Draw with semi-transparent background
    const semi_transparent_bg = RGBA{ 0.0, 0.0, 1.0, 0.5 };
    buf.drawGrayscaleBufferSupersampled(0, 0, &intensities, 4, 4, null, semi_transparent_bg);

    // Verify cell at (0, 0) has blended background
    const cell = buf.get(0, 0).?;
    // Background should be blended (not pure blue or pure red)
    try std.testing.expect(cell.bg[0] > 0.1); // Some red from original
    try std.testing.expect(cell.bg[2] > 0.1); // Some blue from overlay
}

test "OptimizedBuffer - drawGrayscaleBufferSupersampled fully transparent preserves bg" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    // Fill buffer with green background
    const green_bg = RGBA{ 0.0, 1.0, 0.0, 1.0 };
    try buf.clear(green_bg, null);

    // Create 4x4 supersampled intensities (maps to 2x2 terminal cells)
    const intensities = [_]f32{
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
    };

    // Draw with fully transparent background
    const transparent_bg = RGBA{ 0.0, 0.0, 1.0, 0.0 };
    buf.drawGrayscaleBufferSupersampled(0, 0, &intensities, 4, 4, null, transparent_bg);

    // Verify cell at (0, 0) preserves original green background
    const cell = buf.get(0, 0).?;
    try std.testing.expectEqual(@as(f32, 0.0), cell.bg[0]); // R = 0
    try std.testing.expectEqual(@as(f32, 1.0), cell.bg[1]); // G = 1
    try std.testing.expectEqual(@as(f32, 0.0), cell.bg[2]); // B = 0
}

test "OptimizedBuffer - drawGrayscaleBufferSupersampled respects scissor" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        6,
        4,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    try buf.pushScissorRect(0, 0, 1, 1);

    const intensities = [_]f32{
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
    };

    buf.drawGrayscaleBufferSupersampled(0, 0, &intensities, 4, 4, null, bg);

    const inCell = buf.get(0, 0).?;
    const outCell = buf.get(2, 2).?;
    try std.testing.expect(inCell.char != 32);
    try std.testing.expectEqual(@as(u32, 32), outCell.char);

    buf.popScissorRect();
}

test "OptimizedBuffer - drawGrayscaleBufferSupersampled with opacity stack" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    // Fill buffer with red background
    const red_bg = RGBA{ 1.0, 0.0, 0.0, 1.0 };
    try buf.clear(red_bg, null);

    // Push 50% opacity
    try buf.pushOpacity(0.5);

    // Create 4x4 supersampled intensities
    const intensities = [_]f32{
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
    };

    // Draw with opaque blue background (but effective opacity is 50%)
    const blue_bg = RGBA{ 0.0, 0.0, 1.0, 1.0 };
    buf.drawGrayscaleBufferSupersampled(0, 0, &intensities, 4, 4, null, blue_bg);

    buf.popOpacity();

    // Verify cell at (0, 0) has blended due to opacity stack
    const cell = buf.get(0, 0).?;
    try std.testing.expect(cell.bg[0] > 0.1); // Some red from original
    try std.testing.expect(cell.bg[2] > 0.1); // Some blue from overlay
}

test "OptimizedBuffer - blendColors with transparent destination" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        2,
        2,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const transparent_bg = RGBA{ 0.0, 0.0, 0.0, 0.0 };
    try buf.clear(transparent_bg, null);

    const semi_white = RGBA{ 1.0, 1.0, 1.0, 0.5 };
    const transparent_fg = RGBA{ 0.0, 0.0, 0.0, 0.0 };
    try buf.setCellWithAlphaBlending(0, 0, 'X', semi_white, transparent_fg, 0);

    const cell = buf.get(0, 0).?;
    try std.testing.expect(cell.fg[0] > 0.45);
    try std.testing.expect(cell.fg[0] < 0.55);
    try std.testing.expectEqual(@as(f32, 0.5), cell.fg[3]);
}

test "OptimizedBuffer - drawGrayscaleBuffer with custom fg color" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    // Fill buffer with black background
    const black_bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(black_bg, null);

    // Create intensity buffer with full intensity
    const intensities = [_]f32{
        1.0, 1.0, 1.0,
        1.0, 1.0, 1.0,
        1.0, 1.0, 1.0,
    };

    // Draw with red foreground color
    const red_fg = RGBA{ 1.0, 0.0, 0.0, 1.0 };
    buf.drawGrayscaleBuffer(0, 0, &intensities, 3, 3, red_fg, black_bg);

    // Verify cell at (1, 1) has red fg (since intensity is 1.0, alpha is full)
    const cell = buf.get(1, 1).?;
    try std.testing.expect(cell.fg[0] > 0.9); // R channel high (red)
    try std.testing.expect(cell.fg[1] < 0.1); // G channel low
    try std.testing.expect(cell.fg[2] < 0.1); // B channel low
}

test "OptimizedBuffer - drawGrayscaleBuffer custom fg with partial intensity" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    // Fill buffer with blue background
    const blue_bg = RGBA{ 0.0, 0.0, 1.0, 1.0 };
    try buf.clear(blue_bg, null);

    // Create intensity buffer with 50% intensity
    const intensities = [_]f32{
        0.5, 0.5, 0.5,
        0.5, 0.5, 0.5,
        0.5, 0.5, 0.5,
    };

    // Draw with green foreground color at 50% intensity (alpha)
    const green_fg = RGBA{ 0.0, 1.0, 0.0, 1.0 };
    const transparent_bg = RGBA{ 0.0, 0.0, 0.0, 0.0 }; // Transparent bg to preserve underlying
    buf.drawGrayscaleBuffer(0, 0, &intensities, 3, 3, green_fg, transparent_bg);

    // Verify cell at (1, 1) has blended fg (green at 50% over blue bg)
    const cell = buf.get(1, 1).?;
    // With 50% intensity alpha blending, green over blue should produce some of both
    try std.testing.expect(cell.fg[1] > 0.2); // Some green
    try std.testing.expect(cell.fg[2] > 0.2); // Some blue from bg
}

test "OptimizedBuffer - drawGrayscaleBufferSupersampled with custom fg color" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    // Fill buffer with black background
    const black_bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(black_bg, null);

    // Create 4x4 supersampled intensities (maps to 2x2 terminal cells)
    const intensities = [_]f32{
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
    };

    // Draw with cyan foreground color
    const cyan_fg = RGBA{ 0.0, 1.0, 1.0, 1.0 };
    buf.drawGrayscaleBufferSupersampled(0, 0, &intensities, 4, 4, cyan_fg, black_bg);

    // Verify cell at (0, 0) has cyan fg
    const cell = buf.get(0, 0).?;
    try std.testing.expect(cell.fg[0] < 0.1); // R channel low
    try std.testing.expect(cell.fg[1] > 0.9); // G channel high (cyan)
    try std.testing.expect(cell.fg[2] > 0.9); // B channel high (cyan)
}
