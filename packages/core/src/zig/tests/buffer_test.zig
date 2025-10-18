const std = @import("std");
const buffer_mod = @import("../buffer.zig");
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const gp = @import("../grapheme.zig");

const OptimizedBuffer = buffer_mod.OptimizedBuffer;
const TextBuffer = text_buffer.UnifiedTextBuffer;
const TextBufferView = text_buffer_view.UnifiedTextBufferView;
const RGBA = buffer_mod.RGBA;

test "OptimizedBuffer - init and deinit" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        10,
        .{ .pool = pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer buf.deinit();

    try std.testing.expectEqual(@as(u32, 10), buf.getWidth());
    try std.testing.expectEqual(@as(u32, 10), buf.getHeight());
}

test "OptimizedBuffer - clear fills with default char" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        5,
        5,
        .{ .pool = pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    // Check that all cells are cleared
    var y: u32 = 0;
    while (y < 5) : (y += 1) {
        var x: u32 = 0;
        while (x < 5) : (x += 1) {
            const cell = buf.get(x, y).?;
            try std.testing.expectEqual(@as(u32, 32), cell.char); // space
        }
    }
}

test "OptimizedBuffer - drawText with ASCII" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };
    try buf.drawText("Hello", 0, 0, fg, bg, 0);

    // Verify text was drawn
    const cell_h = buf.get(0, 0).?;
    try std.testing.expectEqual(@as(u32, 'H'), cell_h.char);

    const cell_e = buf.get(1, 0).?;
    try std.testing.expectEqual(@as(u32, 'e'), cell_e.char);
}

test "OptimizedBuffer - repeated emoji rendering should not exhaust pool" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("Hello 🌟 World\n测试 🎨 Test\n🚀 Rocket");

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        40,
        5,
        .{ .pool = pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var text_builder = std.ArrayList(u8).init(std.testing.allocator);
    defer text_builder.deinit();

    var line: u32 = 0;
    while (line < 20) : (line += 1) {
        try text_builder.appendSlice("Line ");
        try std.fmt.format(text_builder.writer(), "{d}", .{line});
        try text_builder.appendSlice(": 🌟 测试 🎨 Test 🚀\n");
    }

    try tb.setText(text_builder.items);

    view.setWrapMode(.char);
    view.setWrapWidth(40);

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        50,
        .{ .pool = pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("🌟🎨🚀");

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("• • • •");

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
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

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var text_builder = std.ArrayList(u8).init(std.testing.allocator);
    defer text_builder.deinit();

    var line: u32 = 0;
    while (line < 10) : (line += 1) {
        try text_builder.appendSlice("🌟🎨🚀🍕🍔🍟🌈🎭🎪🎨🎬🎤🎧🎼🎹🎺🎸🎻\n");
    }

    try tb.setText(text_builder.items);

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    var i: u32 = 0;
    while (i < 1000) : (i += 1) {
        try buf.drawTextBuffer(view, 0, 0);
    }

    const count = buf.grapheme_tracker.getGraphemeCount();
    std.debug.print("\nGrapheme tracker count after 1000 renders of many emojis: {d}\n", .{count});
}

test "OptimizedBuffer - pool slot exhaustion test" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("• • • • • • • • • •");

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
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

    std.debug.print("\nCompleted 10000 renders successfully\n", .{});
}

test "OptimizedBuffer - many unique graphemes with small pool" {
    const tiny_slots = [_]u32{ 4, 4, 4, 4, 4 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, &local_pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = &local_pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };

    var render_count: u32 = 0;
    var success_count: u32 = 0;
    var failure_count: u32 = 0;

    while (render_count < 1000) : (render_count += 1) {
        var text_builder = std.ArrayList(u8).init(std.testing.allocator);
        defer text_builder.deinit();

        const base_codepoint: u21 = 0x2600 + @as(u21, @intCast(render_count % 500));
        const char_bytes = [_]u8{
            @intCast(0xE0 | (base_codepoint >> 12)),
            @intCast(0x80 | ((base_codepoint >> 6) & 0x3F)),
            @intCast(0x80 | (base_codepoint & 0x3F)),
        };
        try text_builder.appendSlice(&char_bytes);
        try text_builder.appendSlice(" ");
        try text_builder.appendSlice(&char_bytes);

        tb.setText(text_builder.items) catch |err| {
            failure_count += 1;
            if (failure_count == 1) {
                std.debug.print("\nsetText failure at iteration {d}: {}\n", .{ render_count, err });
            }
            continue;
        };

        if (render_count % 50 == 0) {
            try buf.clear(bg, null);
        }

        buf.drawTextBuffer(view, 0, 0) catch |err| {
            failure_count += 1;
            if (failure_count == 1) {
                std.debug.print("\ndrawTextBuffer failure at iteration {d}: {}\n", .{ render_count, err });
                std.debug.print("Grapheme tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});
            }
            continue;
        };

        success_count += 1;
    }

    std.debug.print("\nRender attempts: {d}, Success: {d}\n", .{ render_count, success_count });
    std.debug.print("Final grapheme tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});

    try std.testing.expect(failure_count == 0);
}

test "OptimizedBuffer - continuous rendering without buffer recreation" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("• Hello World •\n• Test Line •\n• Another Line •");

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer buf.deinit();

    var failure_count: u32 = 0;

    var i: u32 = 0;
    while (i < 50000) : (i += 1) {
        buf.drawTextBuffer(view, 0, 0) catch |err| {
            failure_count += 1;
            if (failure_count == 1) {
                std.debug.print("\nTest failed at iteration {d}: {} ***\n", .{ i, err });
                std.debug.print("Grapheme tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});
                return error.PoolExhausted;
            }
            break;
        };
    }

    try std.testing.expectEqual(@as(u32, 0), failure_count);
}

test "OptimizedBuffer - multiple buffers rendering same TextBuffer" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("🌟 • 测试 • 🎨");

    var buf1 = try OptimizedBuffer.init(
        std.testing.allocator,
        40,
        10,
        .{ .pool = pool, .id = "buffer-1" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer buf1.deinit();

    var buf2 = try OptimizedBuffer.init(
        std.testing.allocator,
        40,
        10,
        .{ .pool = pool, .id = "buffer-2" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer buf2.deinit();

    var buf3 = try OptimizedBuffer.init(
        std.testing.allocator,
        40,
        10,
        .{ .pool = pool, .id = "buffer-3" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer buf3.deinit();

    var failure_count: u32 = 0;

    var i: u32 = 0;
    while (i < 5000) : (i += 1) {
        buf1.drawTextBuffer(view, 0, 0) catch |err| {
            failure_count += 1;
            if (failure_count == 1) {
                std.debug.print("\nTest failed in buf1 at iteration {d}: {} ***\n", .{ i, err });
            }
        };
        buf2.drawTextBuffer(view, 0, 0) catch |err| {
            failure_count += 1;
            if (failure_count == 1) {
                std.debug.print("\nTest failed in buf2 at iteration {d}: {} ***\n", .{ i, err });
            }
        };
        buf3.drawTextBuffer(view, 0, 0) catch |err| {
            failure_count += 1;
            if (failure_count == 1) {
                std.debug.print("\nTest failed in buf3 at iteration {d}: {} ***\n", .{ i, err });
            }
        };
    }

    if (failure_count > 0) {
        return error.PoolExhausted;
    }
}

test "OptimizedBuffer - continuous render without clear with small pool" {
    const tiny_slots = [_]u32{ 2, 2, 2, 2, 2 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, &local_pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("• Test •");

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = &local_pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    var failure_count: u32 = 0;

    var i: u32 = 0;
    while (i < 100) : (i += 1) {
        buf.drawTextBuffer(view, 0, 0) catch |err| {
            failure_count += 1;
            if (failure_count == 1) {
                std.debug.print("\nTest failed at iteration {d}: {} ***\n", .{ i, err });
                std.debug.print("Buffer grapheme tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});
                std.debug.print("This reproduces the reported grapheme pool exhaustion!\n", .{});
                return error.PoolExhausted;
            }
            break;
        };
    }

    try std.testing.expectEqual(@as(u32, 0), failure_count);
}

test "OptimizedBuffer - graphemes with scissor clipping and small pool" {
    const tiny_slots = [_]u32{ 3, 3, 3, 3, 3 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, &local_pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("• • • • •");

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = &local_pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    try buf.pushScissorRect(0, 0, 5, 5);

    var failure_count: u32 = 0;

    var i: u32 = 0;
    while (i < 100) : (i += 1) {
        buf.drawTextBuffer(view, 20, 20) catch |err| {
            failure_count += 1;
            if (failure_count == 1) {
                std.debug.print("\nTest failed at iteration {d}: {} ***\n", .{ i, err });
                std.debug.print("Buffer grapheme tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});
                std.debug.print("Graphemes allocated but clipped by scissor leaked!\n", .{});
                return error.PoolExhausted;
            }
            break;
        };
    }

    if (failure_count > 0) {
        std.debug.print("\nVerified: Scissor clipping causes grapheme leak! ***\n", .{});
        return error.PoolExhausted;
    }
}

test "OptimizedBuffer - drawText with alpha blending and scissor" {
    const tiny_slots = [_]u32{ 3, 3, 3, 3, 3 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = &local_pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };
    const bg_alpha = RGBA{ 0.0, 0.0, 0.0, 0.5 };

    try buf.clear(bg, null);

    try buf.pushScissorRect(0, 0, 10, 10);

    var failure_count: u32 = 0;

    var i: u32 = 0;
    while (i < 200) : (i += 1) {
        buf.drawText("• • • •", 50, 0, fg, bg_alpha, 0) catch |err| {
            failure_count += 1;
            if (failure_count == 1) {
                std.debug.print("\nTest failed at iteration {d}: {} ***\n", .{ i, err });
                std.debug.print("Tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});
                return error.PoolExhausted;
            }
            break;
        };
    }

    if (failure_count > 0) {
        return error.PoolExhausted;
    }
}

test "OptimizedBuffer - many unique graphemes with alpha and small pool" {
    const tiny_slots = [_]u32{ 2, 2, 2, 2, 2 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = &local_pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };
    const bg_alpha = RGBA{ 0.0, 0.0, 0.0, 0.5 };

    try buf.clear(bg, null);

    var failure_count: u32 = 0;

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

        buf.drawText(&text, @intCast(i % 70), @intCast(i / 70), fg, bg_alpha, 0) catch |err| {
            failure_count += 1;
            if (failure_count == 1) {
                std.debug.print("\nTest failed at iteration {d}: {} ***\n", .{ i, err });
                std.debug.print("Tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});
                std.debug.print("Allocating unique graphemes without proper cleanup!\n", .{});
                return error.PoolExhausted;
            }
            break;
        };
    }

    if (failure_count > 0) {
        return error.PoolExhausted;
    }
}

test "OptimizedBuffer - fill buffer with many unique graphemes" {
    const tiny_slots = [_]u32{ 2, 2, 2, 2, 2 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        40,
        20,
        .{ .pool = &local_pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };

    try buf.clear(bg, null);

    var failure_count: u32 = 0;
    var success_count: u32 = 0;

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

            buf.drawText(&char_bytes, x, y, fg, bg, 0) catch |err| {
                failure_count += 1;
                if (failure_count == 1) {
                    std.debug.print("\nTest failed after {d} unique graphemes: {} ***\n", .{ success_count, err });
                    std.debug.print("Tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});
                    std.debug.print("Pool exhausted when many unique graphemes held simultaneously!\n", .{});
                    return error.PoolExhausted;
                }
            };

            if (failure_count == 0) {
                success_count += 1;
            } else {
                break;
            }

            char_idx += 1;
        }
        if (failure_count > 0) break;
    }

    if (failure_count > 0) {
        return error.PoolExhausted;
    }
}

test "OptimizedBuffer - verify pool growth works correctly" {
    const one_slot = [_]u32{ 1, 1, 1, 1, 1 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = one_slot,
    });
    defer local_pool.deinit();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = &local_pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };

    try buf.clear(bg, null);

    var success_count: u32 = 0;
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

        buf.drawText(&char_bytes, x, y, fg, bg, 0) catch |err| {
            std.debug.print("\n*** Pool growth failed at {d} graphemes: {} ***\n", .{ success_count, err });
            std.debug.print("This could indicate a SLOT_MASK limit or memory exhaustion\n", .{});
            break;
        };

        success_count += 1;
    }

    try std.testing.expect(success_count >= 100);
}

test "OptimizedBuffer - repeated overwriting of same grapheme" {
    const tiny_slots = [_]u32{ 3, 3, 3, 3, 3 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = &local_pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };

    try buf.drawText("•", 0, 0, fg, bg, 0);

    var i: u32 = 0;
    var alloc_failed = false;
    while (i < 500) : (i += 1) {
        buf.drawText("•", 0, 0, fg, bg, 0) catch |err| {
            std.debug.print("\nTest failed at iteration {d}: {} ***\n", .{ i + 1, err });
            std.debug.print("Tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});
            std.debug.print("\nAnalysis CONFIRMED:\n", .{});
            std.debug.print("  1. pool.alloc() creates grapheme with refcount=1\n", .{});
            std.debug.print("  2. set() calls tracker.add() which increfs to refcount=2\n", .{});
            std.debug.print("  3. We never decref our initial ownership!\n", .{});
            std.debug.print("  4. When overwriting, tracker.remove() decrefs to refcount=1\n", .{});
            std.debug.print("  5. Grapheme never freed -> slot never returned to free_list\n", .{});
            std.debug.print("  6. Pool exhaustion after ~{d} overwrites\n", .{i});
            alloc_failed = true;
            break;
        };
    }

    if (!alloc_failed) {
        if (buf.grapheme_tracker.getGraphemeCount() > 2) {
            std.debug.print("\nTracker count issue: Tracker count should be 1, but is {d} ***\n", .{buf.grapheme_tracker.getGraphemeCount()});
            return error.RefcountLeak;
        }
    } else {
        return error.RefcountLeak;
    }
}

test "OptimizedBuffer - two-buffer pattern should not leak" {
    const tiny_slots = [_]u32{ 4, 4, 4, 4, 4 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var nextBuffer = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = &local_pool, .id = "next-buffer" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer nextBuffer.deinit();

    var currentBuffer = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = &local_pool, .id = "current-buffer" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer currentBuffer.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };

    var frame: u32 = 0;
    var alloc_failed = false;

    while (frame < 100) : (frame += 1) {
        nextBuffer.drawText("• Test •", 0, 0, fg, bg, 0) catch |err| {
            std.debug.print("\nTest failed at frame {d}: {} ***\n", .{ frame, err });
            std.debug.print("Next buffer tracker: {d}\n", .{nextBuffer.grapheme_tracker.getGraphemeCount()});
            std.debug.print("Current buffer tracker: {d}\n", .{currentBuffer.grapheme_tracker.getGraphemeCount()});
            std.debug.print("\nBUG CONFIRMED:\n", .{});
            std.debug.print("  Line 624 in renderer.zig uses setRaw() which does NOT track graphemes!\n", .{});
            std.debug.print("  Graphemes allocated in nextBuffer leak when copied to currentBuffer\n", .{});
            alloc_failed = true;
            break;
        };

        const cell = nextBuffer.get(0, 0).?;
        currentBuffer.setRaw(0, 0, cell);

        try nextBuffer.clear(bg, null);
    }

    if (alloc_failed) {
        std.debug.print("\n\n", .{});
        return error.SetRawLeak;
    }
}

test "OptimizedBuffer - set and clear cycle should not leak" {
    const tiny_slots = [_]u32{ 3, 3, 3, 3, 3 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = &local_pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };

    var frame: u32 = 0;
    var alloc_failed = false;

    while (frame < 200) : (frame += 1) {
        buf.drawText("•", 0, 0, fg, bg, 0) catch |err| {
            std.debug.print("\nTest failed at frame {d}: {} ***\n", .{ frame, err });
            std.debug.print("Tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});
            std.debug.print("\nShows graphemes leak via alloc()->set()->clear() cycle!\n", .{});
            alloc_failed = true;
            break;
        };

        try buf.clear(bg, null);
    }

    if (alloc_failed) {
        std.debug.print("\n\n", .{});
        return error.AllocSetClearLeak;
    }
}

test "OptimizedBuffer - repeated drawTextBuffer without clear should not leak" {
    const tiny_slots = [_]u32{ 2, 2, 2, 2, 2 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, &local_pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("• Hello • World •");

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = &local_pool, .id = "render-buffer" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    var frame: u32 = 0;
    var alloc_failed = false;

    while (frame < 500) : (frame += 1) {
        buf.drawTextBuffer(view, 0, 0) catch |err| {
            std.debug.print("\n\n", .{ frame, err });
            std.debug.print("Buffer tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});
            std.debug.print("\nAnalysis:\n", .{});
            std.debug.print("  Every call to drawTextBuffer() does pool.alloc() for each grapheme\n", .{});
            std.debug.print("  The new grapheme ID is passed to set() which tracker.add()s it\n", .{});
            std.debug.print("  But the PREVIOUS grapheme at that position is tracker.remove()d\n", .{});
            std.debug.print("  HOWEVER: We never decref the NEWLY allocated grapheme after tracker.add()!\n", .{});
            std.debug.print("  Result: Each frame leaks +1 refcount per grapheme\n", .{});
            alloc_failed = true;
            break;
        };
    }

    if (alloc_failed) {
        std.debug.print("\n\n", .{});
        return error.DrawTextBufferLeak;
    }
}

test "OptimizedBuffer - renderer two-buffer swap pattern should not leak" {
    const tiny_slots = [_]u32{ 3, 3, 3, 3, 3 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, &local_pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("• • •");

    var current = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = &local_pool, .id = "current" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer current.deinit();

    var next = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = &local_pool, .id = "next" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer next.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try current.clear(bg, null);

    var frame: u32 = 0;
    var alloc_failed = false;

    while (frame < 300) : (frame += 1) {
        next.drawTextBuffer(view, 0, 0) catch |err| {
            std.debug.print("\n\n", .{ frame, err });
            std.debug.print("Next tracker: {d}, Current tracker: {d}\n", .{ next.grapheme_tracker.getGraphemeCount(), current.grapheme_tracker.getGraphemeCount() });
            std.debug.print("\nThe bug is in drawTextBuffer + set/setRaw pattern!\n", .{});
            alloc_failed = true;
            break;
        };

        var x: u32 = 0;
        while (x < 10) : (x += 1) {
            if (next.get(x, 0)) |cell| {
                current.setRaw(x, 0, cell);
            }
        }

        try next.clear(bg, null);
    }

    if (alloc_failed) {
        std.debug.print("\n\n", .{});
        return error.RendererPatternLeak;
    }
}

test "OptimizedBuffer - sustained rendering should not leak" {
    const tiny_slots = [_]u32{ 2, 2, 2, 2, 2 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, &local_pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    try tb.setText("  • Type any text to insert\n  • Arrow keys to move cursor\n  • Backspace/Delete to remove text");

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = &local_pool, .id = "render-buffer" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    var frame: u32 = 0;
    var alloc_failed = false;

    while (frame < 3000) : (frame += 1) {
        buf.drawTextBuffer(view, 0, 0) catch |err| {
            std.debug.print("\n\n", .{ frame, @as(f32, @floatFromInt(frame)) / 60.0 });
            std.debug.print("Error: {}\n", .{err});
            std.debug.print("Tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});
            alloc_failed = true;
            break;
        };
    }

    if (alloc_failed) {
        return error.SustainedRenderingLeak;
    }
}

test "OptimizedBuffer - rendering with changing content should not leak" {
    const tiny_slots = [_]u32{ 2, 2, 2, 2, 2 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb = try TextBuffer.init(std.testing.allocator, &local_pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = &local_pool, .id = "render-buffer" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    var frame: u32 = 0;
    var alloc_failed = false;

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

        buf.drawTextBuffer(view, 0, 0) catch |err| {
            std.debug.print("\n\n", .{frame});
            std.debug.print("Error: {}\n", .{err});
            std.debug.print("Tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});
            std.debug.print("\nCause: pool.alloc() returns refcount=1, tracker.add() increfs to 2,\n", .{});
            std.debug.print("but we never decref the initial allocation!\n", .{});
            alloc_failed = true;
            break;
        };
    }

    if (alloc_failed) {
        return error.ChangingContentLeak;
    }
}

test "OptimizedBuffer - multiple TextBuffers rendering simultaneously should not leak" {
    const one_slot = [_]u32{ 1, 1, 1, 1, 1 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = one_slot,
    });
    defer local_pool.deinit();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var tb1 = try TextBuffer.init(std.testing.allocator, &local_pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb1.deinit();
    var view1 = try TextBufferView.init(std.testing.allocator, tb1);
    defer view1.deinit();

    var tb2 = try TextBuffer.init(std.testing.allocator, &local_pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb2.deinit();
    var view2 = try TextBufferView.init(std.testing.allocator, tb2);
    defer view2.deinit();

    var tb3 = try TextBuffer.init(std.testing.allocator, &local_pool, .wcwidth, graphemes_ptr, display_width_ptr);
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
        graphemes_ptr,
        display_width_ptr,
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    try buf.clear(bg, null);

    var frame: u32 = 0;
    var alloc_failed = false;

    while (frame < 500) : (frame += 1) {
        buf.drawTextBuffer(view1, 0, 0) catch |err| {
            std.debug.print("\n✓ BUG REPRODUCED in view1 at frame {d}: {} ✓\n", .{ frame, err });
            alloc_failed = true;
            break;
        };
        buf.drawTextBuffer(view2, 0, 10) catch |err| {
            std.debug.print("\n✓ BUG REPRODUCED in view2 at frame {d}: {} ✓\n", .{ frame, err });
            alloc_failed = true;
            break;
        };
        buf.drawTextBuffer(view3, 0, 20) catch |err| {
            std.debug.print("\n✓ BUG REPRODUCED in view3 at frame {d}: {} ✓\n", .{ frame, err });
            alloc_failed = true;
            break;
        };
    }

    if (alloc_failed) {
        std.debug.print("Tracker: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});
        return error.MultipleTextBuffersLeak;
    }
}

test "OptimizedBuffer - grapheme refcount management" {
    const two_slots = [_]u32{ 2, 2, 2, 2, 2 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = two_slots,
    });
    defer local_pool.deinit();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        5,
        1,
        .{ .pool = &local_pool, .id = "test-buffer" },
        graphemes_ptr,
        display_width_ptr,
    );
    defer buf.deinit();

    const bg = RGBA{ 0.0, 0.0, 0.0, 1.0 };
    const fg = RGBA{ 1.0, 1.0, 1.0, 1.0 };

    try buf.drawText("•", 0, 0, fg, bg, 0);
    const cell0 = buf.get(0, 0).?;
    const id0 = gp.graphemeIdFromChar(cell0.char);
    const rc0 = local_pool.getRefcount(id0) catch 0;

    try std.testing.expectEqual(@as(u32, 1), rc0);

    var i: u32 = 0;
    while (i < 100) : (i += 1) {
        try buf.drawText("•", 0, 0, fg, bg, 0);

        const cell = buf.get(0, 0).?;
        const id = gp.graphemeIdFromChar(cell.char);
        const rc = local_pool.getRefcount(id) catch 999;
        const slot = id & 0xFFFF;

        try std.testing.expectEqual(@as(u32, 1), rc);
        // With 2 slots, we should cycle between slot 0 and slot 1
        // since we alloc before we free the old one
        try std.testing.expect(slot == 0 or slot == 1);
    }
}
