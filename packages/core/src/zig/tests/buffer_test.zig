const std = @import("std");
const buffer_mod = @import("../buffer.zig");
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const gp = @import("../grapheme.zig");

const OptimizedBuffer = buffer_mod.OptimizedBuffer;
const TextBuffer = text_buffer.TextBufferArray;
const TextBufferView = text_buffer_view.TextBufferViewArray;
const RGBA = buffer_mod.RGBA;

// ===== Basic Buffer Tests =====

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

// ===== Grapheme Pool Exhaustion Tests =====

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

    // Render the same emoji text 1000 times to the same position
    var i: u32 = 0;
    while (i < 1000) : (i += 1) {
        try buf.clear(bg, null);
        try buf.drawText("🌟🎨🚀", 0, 0, fg, bg, 0);
    }

    // If we get here without OutOfMemory, the test passes
    // Verify the emoji is still rendered correctly
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

    // Render the same CJK text 1000 times to the same position
    var i: u32 = 0;
    while (i < 1000) : (i += 1) {
        try buf.clear(bg, null);
        try buf.drawText("测试文字", 0, 0, fg, bg, 0);
    }

    // Verify the text is still rendered correctly
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

    // Set text with emojis and unicode
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

    // Render the text buffer 1000 times to the same buffer
    var i: u32 = 0;
    while (i < 1000) : (i += 1) {
        try buf.clear(bg, null);
        try buf.drawTextBuffer(view, 0, 0, null);
    }

    // If we get here without OutOfMemory, the test passes
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

    // Render mixed content 500 times
    var i: u32 = 0;
    while (i < 500) : (i += 1) {
        try buf.clear(bg, null);
        try buf.drawText("A🌟B🎨C🚀D", 0, 0, fg, bg, 0);
        try buf.drawText("测试文字处理", 0, 1, fg, bg, 0);
        try buf.drawText("Hello World!", 0, 2, fg, bg, 0);
    }

    // Verify content is still correct
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

    // Draw and overwrite different emojis at same position many times
    var i: u32 = 0;
    while (i < 1000) : (i += 1) {
        try buf.drawText("🌟", 0, 0, fg, bg, 0);
        try buf.drawText("🎨", 0, 0, fg, bg, 0);
        try buf.drawText("🚀", 0, 0, fg, bg, 0);
    }

    // Verify last emoji is rendered
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

    // Render to many different positions
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

    // Verify some cells are rendered
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

    // Create a longer text with many graphemes
    var text_builder = std.ArrayList(u8).init(std.testing.allocator);
    defer text_builder.deinit();

    var line: u32 = 0;
    while (line < 20) : (line += 1) {
        try text_builder.appendSlice("Line ");
        try std.fmt.format(text_builder.writer(), "{d}", .{line});
        try text_builder.appendSlice(": 🌟 测试 🎨 Test 🚀\n");
    }

    try tb.setText(text_builder.items);

    // Enable wrapping
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

    // Render the text buffer 200 times
    var i: u32 = 0;
    while (i < 200) : (i += 1) {
        try buf.clear(bg, null);
        try buf.drawTextBuffer(view, 0, 0, null);
    }

    // If we get here without OutOfMemory, the test passes
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

    // Draw some emojis
    try buf.drawText("🌟🎨🚀", 0, 0, fg, bg, 0);

    // Check grapheme count is reasonable (should be 3 for 3 emojis)
    const count_after_draw = buf.grapheme_tracker.getGraphemeCount();
    try std.testing.expect(count_after_draw > 0);
    try std.testing.expect(count_after_draw <= 10); // Should be small

    // Clear and redraw many times
    var i: u32 = 0;
    while (i < 100) : (i += 1) {
        try buf.clear(bg, null);
        try buf.drawText("🌟🎨🚀", 0, 0, fg, bg, 0);
    }

    // Check grapheme count hasn't grown unbounded
    const count_after_repeated = buf.grapheme_tracker.getGraphemeCount();
    try std.testing.expect(count_after_repeated <= 20); // Should stay small
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

    // Alternate between two different emoji strings
    var i: u32 = 0;
    while (i < 500) : (i += 1) {
        if (i % 2 == 0) {
            try buf.drawText("🌟🎨🚀", 0, 0, fg, bg, 0);
        } else {
            try buf.drawText("🍕🍔🍟", 0, 0, fg, bg, 0);
        }
    }

    // Check grapheme count hasn't grown unbounded
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

    // Set text with emojis
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

    // Render WITHOUT clearing between renders (this might trigger the leak)
    var i: u32 = 0;
    while (i < 2000) : (i += 1) {
        try buf.drawTextBuffer(view, 0, 0, null);
    }

    // Check tracker count
    const count = buf.grapheme_tracker.getGraphemeCount();
    std.debug.print("\nGrapheme tracker count after 2000 renders: {d}\n", .{count});
    try std.testing.expect(count < 100); // Should not grow unbounded
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

    // Character that shows up in the error: bytes={ 226, 128, 162 } is U+2022 (bullet point •)
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

    // Render many times without clearing
    var i: u32 = 0;
    while (i < 5000) : (i += 1) {
        try buf.drawTextBuffer(view, 0, 0, null);
    }

    const count = buf.grapheme_tracker.getGraphemeCount();
    std.debug.print("\nGrapheme tracker count after 5000 renders of bullet points: {d}\n", .{count});
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

    // Fill with many different graphemes
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

    // Render many times
    var i: u32 = 0;
    while (i < 1000) : (i += 1) {
        try buf.drawTextBuffer(view, 0, 0, null);
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

    // Use the exact character from the error log
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

    // Render 10000 times - this should definitely trigger pool exhaustion if there's a leak
    var i: u32 = 0;
    while (i < 10000) : (i += 1) {
        if (i % 100 == 0) {
            try buf.clear(bg, null);
        }
        try buf.drawTextBuffer(view, 0, 0, null);
    }

    std.debug.print("\nCompleted 10000 renders successfully\n", .{});
}

test "OptimizedBuffer - extreme pool exhaustion with unique graphemes (SMALL POOL)" {
    // Create a TINY pool to actually trigger exhaustion
    const tiny_slots = [_]u32{ 4, 4, 4, 4, 4 }; // Only 4 slots per page
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

    // Try to actually exhaust the pool by rendering many unique graphemes
    // With only 4 slots per page and 3-byte chars, we should hit limits quickly

    var render_count: u32 = 0;
    var success_count: u32 = 0;
    var failure_count: u32 = 0;

    while (render_count < 1000) : (render_count += 1) {
        // Create text with different unicode characters each iteration
        var text_builder = std.ArrayList(u8).init(std.testing.allocator);
        defer text_builder.deinit();

        // Use a range of unicode characters to create many unique graphemes
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
                std.debug.print("\nFirst setText failure at iteration {d}: {}\n", .{ render_count, err });
            }
            continue;
        };

        // Only clear occasionally to stress the pool
        if (render_count % 50 == 0) {
            try buf.clear(bg, null);
        }

        buf.drawTextBuffer(view, 0, 0, null) catch |err| {
            failure_count += 1;
            if (failure_count == 1) {
                std.debug.print("\n*** ISSUE REPRODUCED at iteration {d}: {} ***\n", .{ render_count, err });
                std.debug.print("Grapheme tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});
                std.debug.print("This confirms grapheme pool exhaustion occurs!\n", .{});
            }
            continue;
        };

        success_count += 1;
    }

    std.debug.print("\nRender attempts: {d}, Success: {d}, Failures: {d}\n", .{ render_count, success_count, failure_count });
    std.debug.print("Final grapheme tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});

    // If we got failures, that reproduces the issue
    if (failure_count > 0) {
        std.debug.print("\n*** Pool exhaustion confirmed - test successfully reproduced the issue! ***\n", .{});
        return error.TestExpectedPoolExhaustion; // Expected failure
    }
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

    // Set text once with bullet points (the character from the error log)
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

    // Simulate continuous rendering like a terminal application would do
    // NO clearing - just keep rendering the same content
    var i: u32 = 0;
    while (i < 50000) : (i += 1) {
        buf.drawTextBuffer(view, 0, 0, null) catch |err| {
            failure_count += 1;
            if (failure_count == 1) {
                std.debug.print("\n*** ISSUE REPRODUCED at iteration {d}: {} ***\n", .{ i, err });
                std.debug.print("Grapheme tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});
                return error.PoolExhausted;
            }
            break;
        };
    }

    std.debug.print("\nCompleted 50000 continuous renders without clearing\n", .{});
    std.debug.print("Final grapheme tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});
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

    // Create multiple buffers (like multiple terminal panels)
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

    // Render to all buffers many times
    var i: u32 = 0;
    while (i < 5000) : (i += 1) {
        buf1.drawTextBuffer(view, 0, 0, null) catch |err| {
            failure_count += 1;
            if (failure_count == 1) {
                std.debug.print("\n*** ISSUE REPRODUCED in buf1 at iteration {d}: {} ***\n", .{ i, err });
            }
        };
        buf2.drawTextBuffer(view, 0, 0, null) catch |err| {
            failure_count += 1;
            if (failure_count == 1) {
                std.debug.print("\n*** ISSUE REPRODUCED in buf2 at iteration {d}: {} ***\n", .{ i, err });
            }
        };
        buf3.drawTextBuffer(view, 0, 0, null) catch |err| {
            failure_count += 1;
            if (failure_count == 1) {
                std.debug.print("\n*** ISSUE REPRODUCED in buf3 at iteration {d}: {} ***\n", .{ i, err });
            }
        };
    }

    std.debug.print("\nCompleted 5000 renders across 3 buffers (15000 total renders)\n", .{});
    std.debug.print("Buf1 tracker count: {d}\n", .{buf1.grapheme_tracker.getGraphemeCount()});
    std.debug.print("Buf2 tracker count: {d}\n", .{buf2.grapheme_tracker.getGraphemeCount()});
    std.debug.print("Buf3 tracker count: {d}\n", .{buf3.grapheme_tracker.getGraphemeCount()});
    std.debug.print("Failures: {d}\n", .{failure_count});

    if (failure_count > 0) {
        return error.PoolExhausted;
    }
}

test "OptimizedBuffer - REPRODUCE ISSUE: continuous render without clear (TINY POOL)" {
    // Create an extremely small pool
    const tiny_slots = [_]u32{ 2, 2, 2, 2, 2 }; // Only 2 slots per page
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

    // Set text with bullet point (the character from error log)
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

    // Render continuously WITHOUT clearing - this should trigger the leak if it exists
    var i: u32 = 0;
    while (i < 100) : (i += 1) {
        buf.drawTextBuffer(view, 0, 0, null) catch |err| {
            failure_count += 1;
            if (failure_count == 1) {
                std.debug.print("\n*** ISSUE REPRODUCED at iteration {d}: {} ***\n", .{ i, err });
                std.debug.print("Buffer grapheme tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});
                std.debug.print("This reproduces the reported grapheme pool exhaustion!\n", .{});
                return error.PoolExhaustedAsExpected;
            }
            break;
        };
    }

    std.debug.print("\nCompleted {d} renders, Failures: {d}\n", .{ i, failure_count });
    std.debug.print("Final tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});

    if (failure_count == 0) {
        std.debug.print("Pool did not exhaust - graphemes are being properly freed\n", .{});
    }
}

test "OptimizedBuffer - LEAK: graphemes allocated but clipped by scissor (TINY POOL)" {
    // Create an extremely small pool to trigger exhaustion quickly
    const tiny_slots = [_]u32{ 3, 3, 3, 3, 3 }; // Only 3 slots per page
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

    // Set text with bullet points
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

    // Set a scissor rect that clips most of the content
    try buf.pushScissorRect(0, 0, 5, 5);

    var failure_count: u32 = 0;

    // Render many times - graphemes will be allocated in drawTextBuffer
    // but setCellWithAlphaBlending will return early due to scissor clipping
    // This should leak the allocated graphemes!
    var i: u32 = 0;
    while (i < 100) : (i += 1) {
        // Render to position outside scissor rect
        buf.drawTextBuffer(view, 20, 20, null) catch |err| {
            failure_count += 1;
            if (failure_count == 1) {
                std.debug.print("\n*** ISSUE REPRODUCED at iteration {d}: {} ***\n", .{ i, err });
                std.debug.print("Buffer grapheme tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});
                std.debug.print("Graphemes allocated but clipped by scissor leaked!\n", .{});
                return error.PoolExhaustedAsExpected;
            }
            break;
        };
    }

    std.debug.print("\nCompleted {d} renders with scissor clipping, Failures: {d}\n", .{ i, failure_count });
    std.debug.print("Final tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});

    if (failure_count > 0) {
        std.debug.print("\n*** CONFIRMED: Scissor clipping causes grapheme leak! ***\n", .{});
        return error.PoolExhaustedAsExpected;
    }
}

test "OptimizedBuffer - LEAK: drawText with alpha blending and clipping (TINY POOL)" {
    // Create an extremely small pool
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
    const bg_alpha = RGBA{ 0.0, 0.0, 0.0, 0.5 }; // Alpha background

    try buf.clear(bg, null);

    // Set scissor rect
    try buf.pushScissorRect(0, 0, 10, 10);

    var failure_count: u32 = 0;

    // Draw text outside scissor rect repeatedly
    // This might allocate graphemes but then not track them if clipped
    var i: u32 = 0;
    while (i < 200) : (i += 1) {
        buf.drawText("• • • •", 50, 0, fg, bg_alpha, 0) catch |err| {
            failure_count += 1;
            if (failure_count == 1) {
                std.debug.print("\n*** ISSUE REPRODUCED at iteration {d}: {} ***\n", .{ i, err });
                std.debug.print("Tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});
                return error.PoolExhaustedAsExpected;
            }
            break;
        };
    }

    std.debug.print("\nCompleted {d} drawText calls with clipping, Failures: {d}\n", .{ i, failure_count });
    std.debug.print("Final tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});

    if (failure_count > 0) {
        return error.PoolExhaustedAsExpected;
    }
}

test "OptimizedBuffer - LEAK: many unique graphemes with alpha (TINY POOL)" {
    // Create very small pool
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
    const bg_alpha = RGBA{ 0.0, 0.0, 0.0, 0.5 }; // Alpha background triggers setCellWithAlphaBlending

    try buf.clear(bg, null);

    var failure_count: u32 = 0;

    // Draw many different unicode characters with alpha blending
    // This forces pool allocation for each unique character
    var i: u32 = 0;
    while (i < 50) : (i += 1) {
        // Create unique unicode character
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
                std.debug.print("\n*** ISSUE REPRODUCED at iteration {d}: {} ***\n", .{ i, err });
                std.debug.print("Tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});
                std.debug.print("Allocating unique graphemes without proper cleanup!\n", .{});
                return error.PoolExhaustedAsExpected;
            }
            break;
        };
    }

    std.debug.print("\nCompleted {d} unique grapheme draws, Failures: {d}\n", .{ i, failure_count });
    std.debug.print("Final tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});

    if (failure_count > 0) {
        return error.PoolExhaustedAsExpected;
    }
}

test "OptimizedBuffer - LEAK: fill buffer with unique graphemes (VERY TINY POOL)" {
    // Create an EXTREMELY small pool that cannot grow enough
    const tiny_slots = [_]u32{ 2, 2, 2, 2, 2 }; // Only 2 slots per page
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

    // Try to fill the buffer with many unique graphemes
    // Each one needs a pool slot, and we never overwrite (each goes to different position)
    var char_idx: u32 = 0;
    var y: u32 = 0;
    while (y < 15) : (y += 1) {
        var x: u32 = 0;
        while (x < 35) : (x += 2) { // Step by 2 for wide chars
            const base_codepoint: u21 = 0x2600 + @as(u21, @intCast(char_idx % 200));
            const char_bytes = [_]u8{
                @intCast(0xE0 | (base_codepoint >> 12)),
                @intCast(0x80 | ((base_codepoint >> 6) & 0x3F)),
                @intCast(0x80 | (base_codepoint & 0x3F)),
            };

            buf.drawText(&char_bytes, x, y, fg, bg, 0) catch |err| {
                failure_count += 1;
                if (failure_count == 1) {
                    std.debug.print("\n*** ISSUE REPRODUCED after {d} unique graphemes: {} ***\n", .{ success_count, err });
                    std.debug.print("Tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});
                    std.debug.print("Pool exhausted when many unique graphemes held simultaneously!\n", .{});
                    return error.PoolExhaustedAsExpected;
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

    std.debug.print("\nPlaced {d} unique graphemes, Failures: {d}\n", .{ success_count, failure_count });
    std.debug.print("Final tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});

    if (failure_count > 0) {
        return error.PoolExhaustedAsExpected;
    }
}

test "OptimizedBuffer - verify pool growth works correctly" {
    // Create pool with 1 slot per page to test growth mechanism
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

    // Place many unique graphemes to force pool growth
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

    std.debug.print("\nSuccessfully placed {d} unique graphemes with pool growing from 1 slot/page\n", .{success_count});
    std.debug.print("Final tracker count: {d}\n", .{buf.grapheme_tracker.getGraphemeCount()});
    std.debug.print("This proves pool growth mechanism works correctly\n", .{});

    try std.testing.expect(success_count >= 100);
}
