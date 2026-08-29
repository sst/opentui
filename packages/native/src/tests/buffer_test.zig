const std = @import("std");
const buffer_mod = @import("../buffer.zig");
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const gp = @import("../grapheme.zig");
const link = @import("../link.zig");
const ansi = @import("../ansi.zig");
const test_renderer_mod = @import("test-renderer.zig");
const image = @import("../image.zig");

const OptimizedBuffer = buffer_mod.OptimizedBuffer;
const TextBuffer = text_buffer.UnifiedTextBuffer;
const TextBufferView = text_buffer_view.UnifiedTextBufferView;
const RGBA = buffer_mod.RGBA;
const TestRenderer = test_renderer_mod.TestRenderer;

test "paint grid retains ordered outside-layout inputs and inherited backgrounds" {
    const a = std.testing.allocator;
    var pool = gp.GraphemePool.init(a);
    defer pool.deinit();
    var links = link.LinkPool.init(a);
    defer links.deinit();
    const target = try OptimizedBuffer.init(a, 12, 4, .{ .pool = &pool, .link_pool = &links });
    defer target.deinit();
    const control = try OptimizedBuffer.init(a, 12, 4, .{ .pool = &pool, .link_pool = &links });
    defer control.deinit();
    const white = ansi.rgbColor(255, 255, 255, 255);
    const blue = ansi.rgbColor(0, 0, 255, 255);
    const red = ansi.rgbColor(255, 0, 0, 128);
    for (0..5) |frame| {
        control.clear(blue, null);
        try target.beginPaint(blue, false);
        const grid = target.paint_grid.?;
        const lower_dirty = frame != 1;
        const x: u32 = if (frame < 3) 4 else 6;
        const text: []const u8 = if (frame < 2) "lower" else "other";
        const record_lower = try grid.push(1, 0, 0, 1, 1, lower_dirty);
        try std.testing.expectEqual(lower_dirty, record_lower);
        if (record_lower) try target.drawText(text, x, 2, white, blue, 0);
        grid.pop();
        try control.drawText(text, x, 2, white, blue, 0);
        if (frame < 4) {
            const record_upper = try grid.push(2, 0, 0, 1, 1, false);
            try std.testing.expectEqual(frame == 0, record_upper);
            if (record_upper) {
                target.fillRect(4, 2, 5, 1, red);
                try target.drawText("!", 6, 2, white, null, 0);
                target.fillRect(6, 2, 1, 1, red);
            }
            grid.pop();
            control.fillRect(4, 2, 5, 1, red);
            try control.drawText("!", 6, 2, white, null, 0);
            control.fillRect(6, 2, 1, 1, red);
        }
        try grid.finish();
        try std.testing.expectEqualSlices(u32, control.buffer.char, target.buffer.char);
        try std.testing.expectEqualSlices(RGBA, control.buffer.fg, target.buffer.fg);
        try std.testing.expectEqualSlices(RGBA, control.buffer.bg, target.buffer.bg);
        if (frame == 1) try std.testing.expectEqual(@as(u32, 0), grid.recomposed);
        if (frame == 2) try std.testing.expectEqual(@as(u32, 3), grid.recomposed);
    }
}

test "paint grid owns covered linked wide glyphs and repairs removed spans" {
    const a = std.testing.allocator;
    var pool = gp.GraphemePool.init(a);
    defer pool.deinit();
    var links = link.LinkPool.init(a);
    defer links.deinit();
    const target = try OptimizedBuffer.init(a, 8, 2, .{ .pool = &pool, .link_pool = &links });
    defer target.deinit();
    const white = ansi.rgbColor(255, 255, 255, 255);
    const black = ansi.rgbColor(0, 0, 0, 255);
    const id = try links.alloc("https://example.com/retained");
    try target.beginPaint(black, false);
    const grid = target.paint_grid.?;
    _ = try grid.push(1, 0, 0, 1, 1, false);
    try target.drawText("界", 4, 0, white, black, ansi.TextAttributes.setLinkId(0, id));
    grid.pop();
    _ = try grid.push(2, 0, 0, 1, 1, false);
    try target.drawText("X", 5, 0, white, black, 0);
    grid.pop();
    try grid.finish();
    try std.testing.expectEqual(@as(u32, ' '), target.get(4, 0).?.char);
    try target.beginPaint(black, false);
    try std.testing.expect(!try grid.push(1, 0, 0, 1, 1, false));
    grid.pop();
    try grid.finish();
    try std.testing.expect(gp.isGraphemeChar(target.get(4, 0).?.char));
    try std.testing.expect(gp.isContinuationChar(target.get(5, 0).?.char));
    try std.testing.expectEqual(id, ansi.TextAttributes.getLinkId(target.get(5, 0).?.attributes));
    try target.beginPaint(black, false);
    try grid.finish();
    try std.testing.expect(!target.grapheme_tracker.hasAny());
    try std.testing.expect(!target.link_tracker.hasAny());
}

test "paint grid planned full paint retains ownership but rerecords before skipping" {
    var tracking = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    const a = tracking.allocator();
    var pool = gp.GraphemePool.init(a);
    defer pool.deinit();
    var links = link.LinkPool.init(a);
    defer links.deinit();
    const target = try OptimizedBuffer.init(a, 8, 2, .{ .pool = &pool, .link_pool = &links });
    defer target.deinit();
    const white = ansi.rgbColor(255, 255, 255, 255);
    const black = ansi.rgbColor(0, 0, 0, 255);
    const id = try links.alloc("https://example.com/planned-full");
    try target.beginPaint(black, false);
    const grid = target.paint_grid.?;
    _ = try grid.push(1, 0, 0, 1, 1, false);
    try target.drawText("界", 4, 0, white, black, ansi.TextAttributes.setLinkId(0, id));
    grid.pop();
    try grid.finish();
    const capacity = grid.retainedBytes();
    try target.beginPaint(black, true);
    try target.drawText("Z", 4, 0, white, black, 0);
    try grid.finish();
    try std.testing.expect(!grid.valid);
    try std.testing.expectEqual(capacity, grid.retainedBytes());
    target.clear(black, null);
    const allocations = tracking.alloc_index;
    try target.beginPaint(black, false);
    try std.testing.expect(try grid.push(1, 0, 0, 1, 1, false));
    try target.drawText("Z", 4, 0, white, black, 0);
    grid.pop();
    try grid.finish();
    try std.testing.expectEqual(allocations, tracking.alloc_index);
    try std.testing.expectEqual(@as(u32, 'Z'), target.get(4, 0).?.char);
    try std.testing.expectEqual(@as(u32, ' '), target.get(5, 0).?.char);
    try std.testing.expect(!target.grapheme_tracker.hasAny());
    try std.testing.expect(!target.link_tracker.hasAny());
    try target.beginPaint(black, false);
    try std.testing.expect(!try grid.push(1, 0, 0, 1, 1, false));
    grid.pop();
    try grid.finish();
    try target.beginPaint(black, true);
    target.paintFallback();
    try grid.finish();
    try std.testing.expectEqual(@as(usize, 0), grid.commands.items[0].ops.ops.items.len);
    try std.testing.expect(!grid.valid);
}

test "paint grid nested context cleanup and late raw fallback materialize prefix once" {
    const a = std.testing.allocator;
    var pool = gp.GraphemePool.init(a);
    defer pool.deinit();
    var links = link.LinkPool.init(a);
    defer links.deinit();
    const target = try OptimizedBuffer.init(a, 8, 2, .{ .pool = &pool, .link_pool = &links });
    defer target.deinit();
    const white = ansi.rgbColor(255, 255, 255, 255);
    try target.beginPaint(white, false);
    const grid = target.paint_grid.?;
    _ = try grid.push(1, 0, 0, 1, 1, false);
    try target.drawText("A", 0, 0, white, white, 0);
    _ = try grid.push(2, 0, 0, 1, 1, false);
    try target.pushScissorRect(1, 0, 1, 1);
    try target.pushOpacity(0.5);
    try target.drawText("B", 1, 0, white, white, 0);
    grid.pop();
    try std.testing.expectEqual(@as(usize, 0), target.scissor_stack.items.len);
    try std.testing.expectEqual(@as(f32, 1), target.getCurrentOpacity());
    try target.drawText("C", 2, 0, white, white, 0);
    try std.testing.expectEqual(@as(u32, 1), grid.commands.items[0].context.owner);
    try std.testing.expect(grid.commands.items[0].rerecord);
    const raw = target.getCharPtr();
    try std.testing.expectEqualSlices(u32, &.{ 'A', 'B', 'C' }, raw[0..3]);
    raw[3] = 'D';
    grid.pop();
    try grid.finish();
    try std.testing.expect(grid.fallback);
    try std.testing.expectEqual(@as(u32, 'D'), target.get(3, 0).?.char);
    try std.testing.expectEqual(@as(usize, 0), grid.commands.items[0].pending.ops.items.len);
    try std.testing.expectEqual(@as(usize, 0), grid.commands.items[0].ops.ops.items.len);
    try target.beginPaint(white, false);
    try std.testing.expect(grid.fallback);
    grid.abort();
    try std.testing.expect(!grid.valid);
}

test "paint grid direct draw paths match full control under clipping and opacity" {
    const a = std.testing.allocator;
    var pool = gp.GraphemePool.init(a);
    defer pool.deinit();
    var links = link.LinkPool.init(a);
    defer links.deinit();
    const target = try OptimizedBuffer.init(a, 20, 8, .{ .pool = &pool, .link_pool = &links });
    defer target.deinit();
    const control = try OptimizedBuffer.init(a, 20, 8, .{ .pool = &pool, .link_pool = &links });
    defer control.deinit();
    const source = try OptimizedBuffer.init(a, 3, 1, .{ .pool = &pool, .link_pool = &links });
    defer source.deinit();
    const white = ansi.rgbColor(255, 255, 255, 255);
    const blue = ansi.rgbColor(0, 0, 255, 255);
    const transparent = ansi.rgbColor(0, 0, 0, 0);
    const border = [_]u32{ 0x250c, 0x2510, 0x2514, 0x2518, 0x2500, 0x2502, 0x252c, 0x2534, 0x251c, 0x2524, 0x253c };
    source.clear(ansi.rgbColor(255, 0, 0, 128), 'X');
    for ([_]f32{ 1, 0.5 }) |opacity| {
        for ([_]bool{ false, true }) |wide| {
            control.clear(blue, null);
            try target.beginPaint(blue, false);
            const grid = target.paint_grid.?;
            _ = try grid.push(1, 0, 0, 1, 1, true);
            for ([_]*OptimizedBuffer{ control, target }) |out| {
                if (wide) try out.drawText("界", 0, 7, white, blue, 0);
                try out.pushOpacity(opacity);
                try out.pushScissorRect(2, 0, 14, 8);
                out.fillRect(0, 0, 18, 1, ansi.rgbColor(255, 0, 0, 128));
                try out.drawBox(1, 1, 8, 4, &border, .{ .top = true, .bottom = true, .left = true, .right = true }, white, transparent, white, false, "title", 0, null, 0);
                out.drawGrid(&border, white, blue, &.{ 10, 13, 18 }, 2, &.{ 0, 3, 5 }, 2, true, true);
                out.drawFrameBuffer(10, 6, source, null, null, null, null);
                out.drawGrayscaleBuffer(3, 6, &.{ 0.2, 0.4, 0.8, 1 }, 4, 1, white, transparent);
                out.popScissorRect();
                out.popOpacity();
            }
            grid.pop();
            try grid.finish();
            try std.testing.expectEqualSlices(u32, control.buffer.char, target.buffer.char);
            try std.testing.expectEqualSlices(RGBA, control.buffer.fg, target.buffer.fg);
            try std.testing.expectEqualSlices(RGBA, control.buffer.bg, target.buffer.bg);
            try std.testing.expectEqualSlices(u32, control.buffer.attributes, target.buffer.attributes);
        }
    }
}

test "paint grid inherited tabs sample the original cluster background once" {
    const a = std.testing.allocator;
    var pool = gp.GraphemePool.init(a);
    defer pool.deinit();
    var links = link.LinkPool.init(a);
    defer links.deinit();
    const target = try OptimizedBuffer.init(a, 4, 1, .{ .pool = &pool, .link_pool = &links });
    defer target.deinit();
    const control = try OptimizedBuffer.init(a, 4, 1, .{ .pool = &pool, .link_pool = &links });
    defer control.deinit();
    const white = ansi.rgbColor(255, 255, 255, 128);
    const background = ansi.rgbColor(0, 0, 255, 128);
    control.clear(background, null);
    try target.beginPaint(background, false);
    const grid = target.paint_grid.?;
    _ = try grid.push(1, 0, 0, 1, 1, false);
    for ([_]*OptimizedBuffer{ control, target }) |out| {
        try out.pushOpacity(0.5);
        try out.drawText("\t", 0, 0, white, null, 0);
        out.popOpacity();
    }
    grid.pop();
    try grid.finish();
    try std.testing.expectEqualSlices(RGBA, control.buffer.bg, target.buffer.bg);
}

test "paint grid allocation failure discards metadata without leaking ownership" {
    const a = std.testing.allocator;
    for (0..20) |fail_index| {
        var pool = gp.GraphemePool.init(a);
        defer pool.deinit();
        var links = link.LinkPool.init(a);
        defer links.deinit();
        var failing = std.testing.FailingAllocator.init(a, .{ .fail_index = fail_index });
        const target = OptimizedBuffer.init(failing.allocator(), 4, 1, .{ .pool = &pool, .link_pool = &links }) catch continue;
        const white = ansi.rgbColor(255, 255, 255, 255);
        if (target.beginPaint(white, false)) {
            const grid = target.paint_grid.?;
            if (grid.push(1, 0, 0, 1, 1, true)) |_| {
                target.set(0, 0, .{ .char = 'X', .fg = white, .bg = white, .attributes = 0 });
                grid.pop();
                grid.finish() catch grid.abort();
            } else |_| grid.abort();
        } else |_| {}
        target.deinit();
        try std.testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
    }
}

test "paint grid raw grid overwrite releases removed wide and link references" {
    const a = std.testing.allocator;
    var pool = gp.GraphemePool.init(a);
    defer pool.deinit();
    var links = link.LinkPool.init(a);
    defer links.deinit();
    const target = try OptimizedBuffer.init(a, 8, 2, .{ .pool = &pool, .link_pool = &links });
    defer target.deinit();
    const white = ansi.rgbColor(255, 255, 255, 255);
    const id = try links.alloc("https://example.com/grid");
    try target.beginPaint(white, false);
    const grid = target.paint_grid.?;
    _ = try grid.push(1, 0, 0, 1, 1, true);
    try target.drawText("界", 1, 0, white, white, ansi.TextAttributes.setLinkId(0, id));
    grid.pop();
    _ = try grid.push(2, 0, 0, 1, 1, true);
    target.drawGrid(&([_]u32{'+'} ** 11), white, white, &.{ 0, 4 }, 1, &.{ 0, 1 }, 1, true, true);
    grid.pop();
    try grid.finish();
    try target.beginPaint(white, false);
    try grid.finish();
    try std.testing.expect(!target.grapheme_tracker.hasAny());
    try std.testing.expect(!target.link_tracker.hasAny());
}

test "paint grid scalar finish needs no index allocation and abort releases recordings" {
    const a = std.testing.allocator;
    var pool = gp.GraphemePool.init(a);
    defer pool.deinit();
    var links = link.LinkPool.init(a);
    defer links.deinit();
    var failing = std.testing.FailingAllocator.init(a, .{});
    {
        const target = try OptimizedBuffer.init(failing.allocator(), 80, 2, .{ .pool = &pool, .link_pool = &links });
        defer target.deinit();
        const white = ansi.rgbColor(255, 255, 255, 255);
        const id = try links.alloc("https://example.com/retry");
        try links.incref(id);
        defer links.decref(id) catch {};
        try target.beginPaint(white, false);
        const grid = target.paint_grid.?;
        _ = try grid.push(1, 0, 0, 1, 1, true);
        for (0..20) |i| try target.drawText("x", @intCast(i * 2), 0, white, white, 0);
        grid.pop();
        failing.fail_index = failing.alloc_index;
        const allocations = failing.alloc_index;
        try grid.finish();
        try std.testing.expectEqual(allocations, failing.alloc_index);
        grid.abort();
        try std.testing.expect(!grid.valid);
        try std.testing.expectEqual(@as(usize, 0), grid.commands.items[0].ops.ops.capacity);
        grid.abort();
        failing.fail_index = std.math.maxInt(usize);
        try target.beginPaint(white, false);
        try std.testing.expect(try grid.push(1, 0, 0, 1, 1, false));
        try target.drawText("界", 4, 0, white, white, ansi.TextAttributes.setLinkId(0, id));
        grid.pop();
        try grid.finish();
        try std.testing.expect(gp.isGraphemeChar(target.buffer.char[4]));
        try std.testing.expect(gp.isContinuationChar(target.buffer.char[5]));
        try std.testing.expectEqual(id, ansi.TextAttributes.getLinkId(target.buffer.attributes[5]));
    }
    try std.testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
}

test "paint grid owned text span finishes drawing after glyph payload growth failure" {
    const a = std.testing.allocator;
    var tracking = std.testing.FailingAllocator.init(a, .{});
    var pool = gp.GraphemePool.init(a);
    defer pool.deinit();
    var links = link.LinkPool.init(a);
    defer links.deinit();
    const target = try OptimizedBuffer.init(tracking.allocator(), 200, 1, .{ .pool = &pool, .link_pool = &links });
    defer target.deinit();
    const control = try OptimizedBuffer.init(a, 200, 1, .{ .pool = &pool, .link_pool = &links });
    defer control.deinit();
    var text = try TextBuffer.init(a, &pool, &links, .unicode);
    defer text.deinit();
    var view = try TextBufferView.init(a, text);
    defer view.deinit();
    const black = ansi.rgbColor(0, 0, 0, 255);
    control.clear(black, null);
    try target.beginPaint(black, false);
    const grid = target.paint_grid.?;
    _ = try grid.push(1, 0, 0, 1, 1, true);
    const allocations = tracking.alloc_index;
    var content: [200]u8 = undefined;
    for (&content, 0..) |*char, i| char.* = @intCast('a' + i % 26);
    try text.setText(content[0..96]);
    target.drawTextBuffer(view, 0, 0);
    control.drawTextBuffer(view, 0, 0);
    try std.testing.expect(tracking.alloc_index > allocations);
    try std.testing.expectEqual(@as(usize, 1), grid.commands.items[0].pending.ops.items.len);
    try std.testing.expectEqual(@as(u32, 96), grid.commands.items[0].pending.ops.items[0].count);
    tracking.fail_index = tracking.alloc_index;
    tracking.resize_fail_index = tracking.resize_index;
    try text.setText(&content);
    // A shared payload arena may satisfy growth from existing capacity. Exhaust
    // that capacity before asserting the backing allocator failure fallback.
    for (0..16) |_| {
        target.drawTextBuffer(view, 0, 0);
        control.drawTextBuffer(view, 0, 0);
        if (grid.fallback) break;
    }
    try std.testing.expect(grid.fallback);
    grid.pop();
    try grid.finish();
    try std.testing.expectEqualSlices(u32, control.buffer.char, target.buffer.char);
    try std.testing.expectEqualSlices(RGBA, control.buffer.fg, target.buffer.fg);
    try std.testing.expectEqualSlices(RGBA, control.buffer.bg, target.buffer.bg);
    try std.testing.expectEqualSlices(u32, control.buffer.attributes, target.buffer.attributes);
    tracking.fail_index = std.math.maxInt(usize);
    tracking.resize_fail_index = std.math.maxInt(usize);
    try target.beginPaint(black, false);
    try std.testing.expect(try grid.push(1, 0, 0, 1, 1, false));
    target.drawTextBuffer(view, 0, 0);
    grid.pop();
    try grid.finish();
    try target.beginPaint(black, false);
    try std.testing.expect(!try grid.push(1, 0, 0, 1, 1, false));
    grid.pop();
    try grid.finish();
    try std.testing.expectEqualSlices(u32, control.buffer.char, target.buffer.char);
}

test "paint grid empty planned full preserves fresh target but clears retained background" {
    const a = std.testing.allocator;
    var pool = gp.GraphemePool.init(a);
    defer pool.deinit();
    var links = link.LinkPool.init(a);
    defer links.deinit();
    const target = try OptimizedBuffer.init(a, 8, 2, .{ .pool = &pool, .link_pool = &links });
    defer target.deinit();
    const black = ansi.rgbColor(0, 0, 0, 255);
    const white = ansi.rgbColor(255, 255, 255, 255);
    target.clear(black, null);
    try target.drawText("external", 0, 0, white, black, 0);
    try target.beginPaint(black, false);
    const grid = target.paint_grid.?;
    grid.materialize();
    try grid.finish();
    try std.testing.expectEqual(@as(u32, 'e'), target.buffer.char[0]);
    try target.beginPaint(black, false);
    _ = try grid.push(1, 0, 0, 1, 1, false);
    try target.drawText("cached", 0, 0, white, black, 0);
    grid.pop();
    try grid.finish();
    try target.beginPaint(white, false);
    grid.materialize();
    try grid.finish();
    for (target.buffer.char) |char| try std.testing.expectEqual(@as(u32, ' '), char);
    for (target.buffer.bg) |bg| try std.testing.expectEqual(white, bg);
}

test "paint grid forced startup allocates cell storage only on an eligible update" {
    const a = std.testing.allocator;
    var tracking = std.testing.FailingAllocator.init(a, .{});
    var pool = gp.GraphemePool.init(a);
    defer pool.deinit();
    var links = link.LinkPool.init(a);
    defer links.deinit();
    const target = try OptimizedBuffer.init(tracking.allocator(), 40, 2, .{ .pool = &pool, .link_pool = &links });
    defer target.deinit();
    const black = ansi.rgbColor(0, 0, 0, 255);
    const white = ansi.rgbColor(255, 255, 255, 255);
    const allocations = tracking.alloc_index;
    for (0..4) |_| {
        target.clear(black, null);
        try target.beginPaint(black, true);
        try target.drawText("full", 7, 1, white, black, 0);
        try target.paint_grid.?.finish();
        try std.testing.expectEqual(@as(usize, 0), target.paint_grid.?.dirty.len);
        try std.testing.expectEqual(@as(u32, 'f'), target.get(7, 1).?.char);
    }
    try std.testing.expectEqual(allocations + 1, tracking.alloc_index);
    try target.beginPaint(black, false);
    tracking.fail_index = tracking.alloc_index + 1;
    try std.testing.expectError(error.OutOfMemory, target.paint_grid.?.push(1, 0, 0, 1, 1, false));
    target.paint_grid.?.abort();
    tracking.fail_index = std.math.maxInt(usize);
    try target.beginPaint(black, false);
    const grid = target.paint_grid.?;
    try std.testing.expect(try grid.push(1, 0, 0, 1, 1, false));
    try target.drawText("kept", 7, 1, white, black, 0);
    grid.pop();
    try grid.finish();
    try target.beginPaint(black, false);
    try std.testing.expect(!try grid.push(1, 0, 0, 1, 1, false));
    grid.pop();
    try grid.finish();
    try std.testing.expectEqual(@as(u32, 'k'), target.get(7, 1).?.char);
}

test "paint grid differing glyph spans own text and preserve precise damage" {
    const a = std.testing.allocator;
    var pool = gp.GraphemePool.init(a);
    defer pool.deinit();
    var links = link.LinkPool.init(a);
    defer links.deinit();
    const target = try OptimizedBuffer.init(a, 40, 2, .{ .pool = &pool, .link_pool = &links });
    defer target.deinit();
    const black = ansi.rgbColor(0, 0, 0, 255);
    const white = ansi.rgbColor(255, 255, 255, 255);
    for (0..3) |frame| {
        try target.beginPaint(black, false);
        const grid = target.paint_grid.?;
        const paint = try grid.push(1, 0, 0, 1, 1, frame == 1);
        if (paint) {
            var source: [12]u8 = "abcdefghijkl".*;
            if (frame == 1) source[5] = 'X';
            try target.drawText(&source, 7, 1, white, black, 0);
            @memset(&source, '!');
            try std.testing.expectEqual(@as(usize, 1), grid.commands.items[0].pending.ops.items.len);
        }
        grid.pop();
        try grid.finish();
        const expected: []const u8 = if (frame == 0) "abcdefghijkl" else "abcdeXghijkl";
        for (expected, 7..) |char, x| try std.testing.expectEqual(@as(u32, char), target.get(@intCast(x), 1).?.char);
        if (frame == 1) try std.testing.expectEqual(@as(u32, 1), grid.recomposed);
        if (frame == 2) try std.testing.expectEqual(@as(u32, 0), grid.recomposed);
    }
}

test "paint grid closes transitive covered wide dependencies without a cell index" {
    const a = std.testing.allocator;
    var pool = gp.GraphemePool.init(a);
    defer pool.deinit();
    var links = link.LinkPool.init(a);
    defer links.deinit();
    const target = try OptimizedBuffer.init(a, 24, 2, .{ .pool = &pool, .link_pool = &links });
    defer target.deinit();
    const control = try OptimizedBuffer.init(a, 24, 2, .{ .pool = &pool, .link_pool = &links });
    defer control.deinit();
    const black = ansi.rgbColor(0, 0, 0, 255);
    const white = ansi.rgbColor(255, 255, 255, 255);
    for (0..4) |frame| {
        control.clear(black, null);
        try target.beginPaint(black, false);
        const grid = target.paint_grid.?;
        for (0..3) |i| {
            const x: u32 = @intCast(4 + i);
            if (try grid.push(@intCast(i + 1), 0, 0, 1, 1, false)) try target.drawText("界", x, 0, white, black, 0);
            grid.pop();
            try control.drawText("界", x, 0, white, black, 0);
        }
        if (frame < 3) {
            const text: []const u8 = if (frame == 0) "abcd" else "abcX";
            if (try grid.push(4, 0, 0, 1, 1, frame == 1)) try target.drawText(text, 4, 0, white, black, 0);
            grid.pop();
            try control.drawText(text, 4, 0, white, black, 0);
        }
        try grid.finish();
        try std.testing.expectEqualSlices(u32, control.buffer.char, target.buffer.char);
        try std.testing.expectEqualSlices(RGBA, control.buffer.fg, target.buffer.fg);
        try std.testing.expectEqualSlices(RGBA, control.buffer.bg, target.buffer.bg);
        try std.testing.expectEqualSlices(u32, control.buffer.attributes, target.buffer.attributes);
        if (frame == 1) try std.testing.expectEqual(@as(u32, 4), grid.recomposed);
    }
}

test "paint grid bulk inherited text samples each background cell independently" {
    const a = std.testing.allocator;
    var pool = gp.GraphemePool.init(a);
    defer pool.deinit();
    var links = link.LinkPool.init(a);
    defer links.deinit();
    const target = try OptimizedBuffer.init(a, 16, 2, .{ .pool = &pool, .link_pool = &links });
    defer target.deinit();
    const control = try OptimizedBuffer.init(a, 16, 2, .{ .pool = &pool, .link_pool = &links });
    defer control.deinit();
    const black = ansi.rgbColor(0, 0, 0, 255);
    const white = ansi.rgbColor(255, 255, 255, 255);
    for (0..4) |frame| {
        control.clear(black, null);
        try target.beginPaint(black, false);
        const grid = target.paint_grid.?;
        const lower = try grid.push(1, 0, 0, 1, 1, frame == 1);
        for (0..8) |i| {
            const bg = ansi.rgbColor(@intCast(if (i == 3 and frame != 0) 200 else i * 20), 30, 80, 255);
            if (lower) target.fillRect(@intCast(i + 2), 0, 1, 1, bg);
            control.fillRect(@intCast(i + 2), 0, 1, 1, bg);
        }
        grid.pop();
        if (frame < 3) {
            try target.pushOpacity(0.5);
            const upper = try grid.push(2, 0, 0, 1, 1, false);
            if (upper) {
                var text = "a bc def".*;
                try target.drawText(&text, 2, 0, white, null, 0);
                @memset(&text, '!');
            }
            grid.pop();
            target.popOpacity();
            try control.pushOpacity(0.5);
            try control.drawText("a bc def", 2, 0, white, null, 0);
            control.popOpacity();
        }
        try grid.finish();
        try std.testing.expectEqualSlices(u32, control.buffer.char, target.buffer.char);
        try std.testing.expectEqualSlices(RGBA, control.buffer.fg, target.buffer.fg);
        try std.testing.expectEqualSlices(RGBA, control.buffer.bg, target.buffer.bg);
        try std.testing.expectEqualSlices(u32, control.buffer.attributes, target.buffer.attributes);
        if (frame == 1) try std.testing.expectEqual(@as(u32, 1), grid.recomposed);
    }
}

test "paint grid independent inherited layers do not exhaust the rescan budget" {
    const a = std.testing.allocator;
    var pool = gp.GraphemePool.init(a);
    defer pool.deinit();
    var links = link.LinkPool.init(a);
    defer links.deinit();
    const target = try OptimizedBuffer.init(a, 40, 2, .{ .pool = &pool, .link_pool = &links });
    defer target.deinit();
    const black = ansi.rgbColor(0, 0, 0, 255);
    const white = ansi.rgbColor(255, 255, 255, 255);
    for (0..3) |frame| {
        try target.beginPaint(black, false);
        const grid = target.paint_grid.?;
        for (0..8) |i| {
            if (try grid.push(@intCast(i + 1), 0, 0, 1, 1, i == 7 and frame == 1)) {
                try target.drawText(if (i == 7 and frame != 0) "abcXefghijklmnopqrstuvwxyz\t" else "abcdefghijklmnopqrstuvwxyz\t", 0, 0, white, null, 0);
            }
            grid.pop();
        }
        try grid.finish();
        if (frame == 1) try std.testing.expectEqual(@as(u32, 1), grid.recomposed);
        if (frame == 2) try std.testing.expectEqual(@as(u32, 0), grid.recomposed);
    }
}

test "paint grid TextBuffer style runs own inputs and match scalar clipping and opacity" {
    const a = std.testing.allocator;
    var pool = gp.GraphemePool.init(a);
    defer pool.deinit();
    var links = link.LinkPool.init(a);
    defer links.deinit();
    const id = try links.alloc("https://example.com/text-run");
    try links.incref(id);
    defer links.decref(id) catch {};
    const target = try OptimizedBuffer.init(a, 40, 2, .{ .pool = &pool, .link_pool = &links });
    defer target.deinit();
    const control = try OptimizedBuffer.init(a, 40, 2, .{ .pool = &pool, .link_pool = &links });
    defer control.deinit();
    const black = ansi.rgbColor(0, 0, 0, 255);
    const white = ansi.rgbColor(255, 255, 255, 255);
    for ([_]f32{ 1.0, 0.5 }) |opacity| for ([_]u8{ 0, 120, 255 }) |alpha| {
        if (target.paint_grid) |grid| grid.abort();
        for (0..4) |frame| {
            control.clear(black, null);
            try target.beginPaint(black, false);
            const grid = target.paint_grid.?;
            try target.pushScissorRect(2, 0, 28, 2);
            try control.pushScissorRect(2, 0, 28, 2);
            try target.pushOpacity(opacity);
            try control.pushOpacity(opacity);
            const paint = try grid.push(1, 0, 0, 1, 1, frame == 1);
            {
                var text = try TextBuffer.init(a, &pool, &links, .unicode);
                defer text.deinit();
                var view = try TextBufferView.init(a, text);
                defer view.deinit();
                text.setDefaultFg(white);
                text.setDefaultBg(ansi.rgbColor(20, 40, 90, alpha));
                text.setDefaultAttributes(ansi.TextAttributes.setLinkId(0, id));
                try text.setText(if (frame == 0) "abcdefghijklmnopqrstuvwxyz0123456789" else "abcdefghXjklmnopqrstuvwxyz0123456789");
                if (paint) target.drawTextBuffer(view, -3, 0);
                // An out-of-range selection leaves pixels unchanged but exercises
                // the scalar style/selection path as an independent control.
                view.setSelection(1000, 1001, null, null);
                control.drawTextBuffer(view, -3, 0);
            }
            grid.pop();
            target.popOpacity();
            control.popOpacity();
            target.popScissorRect();
            control.popScissorRect();
            try grid.finish();
            try std.testing.expectEqualSlices(u32, control.buffer.char, target.buffer.char);
            try std.testing.expectEqualSlices(RGBA, control.buffer.fg, target.buffer.fg);
            try std.testing.expectEqualSlices(RGBA, control.buffer.bg, target.buffer.bg);
            try std.testing.expectEqualSlices(u32, control.buffer.attributes, target.buffer.attributes);
            if (frame == 1 and !grid.fallback) try std.testing.expectEqual(@as(u32, 1), grid.recomposed);
        }
    };
}

test "paint grid bounded reverse wide-chain stress matches full painting" {
    const a = std.testing.allocator;
    const Timer = @import("../bench-utils.zig").BenchTimer;
    for ([_]u32{ 120, 240, 960 }) |width| {
        var pool = gp.GraphemePool.init(a);
        defer pool.deinit();
        var links = link.LinkPool.init(a);
        defer links.deinit();
        const target = try OptimizedBuffer.init(a, width, 2, .{ .pool = &pool, .link_pool = &links });
        defer target.deinit();
        const control = try OptimizedBuffer.init(a, width, 2, .{ .pool = &pool, .link_pool = &links });
        defer control.deinit();
        const text = try a.alloc(u8, width);
        defer a.free(text);
        @memset(text, 'a');
        const black = ansi.rgbColor(0, 0, 0, 255);
        const white = ansi.rgbColor(255, 255, 255, 255);
        var finish_ns: u64 = 0;
        const gid = try pool.alloc("界");
        try pool.incref(gid);
        defer pool.decref(gid) catch {};
        const wide = gp.packGraphemeStart(gid, 2);
        var retained_ns: u64 = 0;
        var full_ns: u64 = 0;
        for (0..31) |frame| {
            text[width - 1] = if (frame % 2 == 0) 'X' else 'Y';
            const retained_timer = Timer.start(std.testing.io);
            try target.beginPaint(black, false);
            const grid = target.paint_grid.?;
            if (try grid.push(1, 0, 0, 1, 1, false)) {
                for (0..width - 1) |x| target.drawChar(wide, @intCast(x), 0, white, black, 0);
            }
            grid.pop();
            if (try grid.push(2, 0, 0, 1, 1, true)) try target.drawText(text, 0, 0, white, black, 0);
            grid.pop();
            const finish_timer = Timer.start(std.testing.io);
            try grid.finish();
            const finish_elapsed = finish_timer.read();
            const retained_elapsed = retained_timer.read();
            const full_timer = Timer.start(std.testing.io);
            control.clear(black, null);
            for (0..width - 1) |x| control.drawChar(wide, @intCast(x), 0, white, black, 0);
            try control.drawText(text, 0, 0, white, black, 0);
            const full_elapsed = full_timer.read();
            try std.testing.expectEqualSlices(u32, control.buffer.char, target.buffer.char);
            try std.testing.expectEqualSlices(RGBA, control.buffer.fg, target.buffer.fg);
            try std.testing.expectEqualSlices(RGBA, control.buffer.bg, target.buffer.bg);
            try std.testing.expectEqualSlices(u32, control.buffer.attributes, target.buffer.attributes);
            if (frame != 0) {
                finish_ns += finish_elapsed;
                retained_ns += retained_elapsed;
                full_ns += full_elapsed;
            }
        }
        if (@import("builtin").mode == .ReleaseFast) std.debug.print("wide-chain width={} finish_ns={} retained_ns={} full_ns={}\n", .{ width, finish_ns / 30, retained_ns / 30, full_ns / 30 });
    }
}

test "paint grid payload arena releases references before repeated reset" {
    const a = std.testing.allocator;
    var tracking = std.testing.FailingAllocator.init(a, .{});
    var pool = gp.GraphemePool.init(a);
    defer pool.deinit();
    var links = link.LinkPool.init(a);
    defer links.deinit();
    const id = try links.alloc("https://example.com/arena-reset");
    try links.incref(id);
    defer links.decref(id) catch {};
    {
        const target = try OptimizedBuffer.init(tracking.allocator(), 120, 2, .{ .pool = &pool, .link_pool = &links });
        defer target.deinit();
        const white = ansi.rgbColor(255, 255, 255, 255);
        for (0..20) |_| {
            try target.beginPaint(white, false);
            const grid = target.paint_grid.?;
            for (0..10) |i| {
                _ = try grid.push(@intCast(i + 1), 0, 0, 1, 1, true);
                try target.drawText("owned glyph payload", @intCast(i), 0, white, white, ansi.TextAttributes.setLinkId(0, id));
                try target.drawText("界", @intCast(i * 2), 1, white, white, 0);
                grid.pop();
            }
            try grid.finish();
            grid.abort();
            target.clear(white, null);
            try std.testing.expect(!target.grapheme_tracker.hasAny());
            try std.testing.expect(!target.link_tracker.hasAny());
            try std.testing.expectEqual(@as(u32, 1), try links.getRefcount(id));
            try std.testing.expectEqual(@as(usize, 0), grid.payload.queryCapacity());
        }
    }
    try std.testing.expectEqual(tracking.allocated_bytes, tracking.freed_bytes);
}

test "paint grid allocation traffic measurement" {
    const a = std.testing.allocator;
    for ([_]bool{ false, true }) |enabled| {
        var tracking = std.testing.FailingAllocator.init(a, .{});
        var pool = gp.GraphemePool.init(tracking.allocator());
        defer pool.deinit();
        var links = link.LinkPool.init(tracking.allocator());
        defer links.deinit();
        const target = try OptimizedBuffer.init(tracking.allocator(), 120, 40, .{ .pool = &pool, .link_pool = &links });
        defer target.deinit();
        const white = ansi.rgbColor(255, 255, 255, 255);
        const blue = ansi.rgbColor(0, 0, 255, 255);
        const text = "row 00 | retained cells and normal text rendering";
        const start_bytes = tracking.allocated_bytes;
        const start_count = tracking.alloc_index;
        var cold_bytes: usize = 0;
        var cold_count: usize = 0;
        for (0..24) |frame| {
            if (enabled) try target.beginPaint(blue, false) else target.clear(blue, null);
            for (0..80) |i| {
                const x: u32 = @intCast(i / 40 * 60);
                const y: u32 = @intCast(i % 40);
                const paint = if (enabled) try target.paint_grid.?.push(@intCast(i + 1), @intCast(x), @intCast(y), 1, 1, i == 0) else true;
                if (paint) {
                    try target.drawText(text, x, y, white, blue, 0);
                    if (i == 0) target.drawChar(@intCast('0' + frame % 10), x, y, white, blue, 0);
                }
                if (enabled) target.paint_grid.?.pop();
            }
            if (enabled) try target.paint_grid.?.finish();
            if (frame == 0) {
                cold_bytes = tracking.allocated_bytes - start_bytes;
                cold_count = tracking.alloc_index - start_count;
            }
        }
        std.debug.print("paint-grid-alloc enabled={} cold_allocs={} cold_requested={} warm_allocs={} warm_requested={} retained={} op_stride={}\n", .{
            enabled,                                                 cold_count,                                         cold_bytes, tracking.alloc_index - start_count - cold_count, tracking.allocated_bytes - start_bytes - cold_bytes,
            if (enabled) target.paint_grid.?.retainedBytes() else 0, @sizeOf(@import("../paint-grid.zig").PaintGrid.Op),
        });
    }
}

test "OptimizedBuffer draws image reservation markers" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const target = try OptimizedBuffer.init(std.testing.allocator, 2, 2, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();
    const source = try image.createFromRgba(std.testing.allocator, &[_]u8{
        255, 0, 0,   255, 0,   255, 0,   255,
        0,   0, 255, 255, 255, 255, 255, 255,
    }, 2, 2, 8);
    defer source.deinit();
    const before = target.get(0, 0).?;
    try std.testing.expect(try target.drawImage(source, 1, 0, 0, 1, 1, 0, 0, 0, 0, 2, 2, .auto));
    const marker = target.get(0, 0).?;
    try std.testing.expect(gp.isImageChar(marker.char));
    try std.testing.expectEqual(@as(u4, 0), gp.imageFallbackFromChar(marker.char));
    try std.testing.expect(buffer_mod.rgbaEqual(before.fg, marker.fg));
    try std.testing.expect(buffer_mod.rgbaEqual(before.bg, marker.bg));
}

test "OptimizedBuffer materializes block fallback on demand" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const target = try OptimizedBuffer.init(std.testing.allocator, 1, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();
    const source = try image.createFromRgba(std.testing.allocator, &[_]u8{
        255, 0, 0,   255, 0,   255, 0,   255,
        0,   0, 255, 255, 255, 255, 255, 255,
    }, 2, 2, 8);
    defer source.deinit();

    try std.testing.expect(try target.drawImage(source, 1, 0, 0, 1, 1, 0, 0, 0, 0, 2, 2, .auto));
    try target.materializeImageFallback(1);
    const cell = target.get(0, 0).?;
    try std.testing.expect(gp.isImageChar(cell.char));
    try std.testing.expect(gp.imageFallbackFromChar(cell.char) != 0);
}

test "OptimizedBuffer flattens image placements into owned block cells" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const target = try OptimizedBuffer.init(std.testing.allocator, 1, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();
    const source = try image.createFromRgba(std.testing.allocator, &[_]u8{
        255, 0, 0,   255, 0,   255, 0,   255,
        0,   0, 255, 255, 255, 255, 255, 255,
    }, 2, 2, 8);
    defer source.deinit();

    try std.testing.expect(try target.drawImage(source, 1, 0, 0, 1, 1, 0, 0, 0, 0, 2, 2, .kitty));
    try std.testing.expectEqual(@as(u32, 2), source.ref_count);

    try target.materializeImageFallbacks();

    const cell = target.get(0, 0).?;
    try std.testing.expect(!gp.isImageChar(cell.char));
    try std.testing.expect(std.mem.findScalar(u32, &buffer_mod.quadrantChars, cell.char) != null);
    try std.testing.expectEqual(@as(usize, 0), target.image_placements.items.len);
    try std.testing.expectEqual(@as(u32, 1), source.ref_count);
}

test "OptimizedBuffer clips image placements and source crop to scissor" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const target = try OptimizedBuffer.init(std.testing.allocator, 4, 2, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();
    const source = try image.createFromRgba(std.testing.allocator, &([_]u8{ 255, 0, 0, 255 } ** 16), 4, 4, 16);
    defer source.deinit();
    try target.pushScissorRect(1, 0, 2, 2);
    try std.testing.expect(try target.drawImage(source, 1, -1, 0, 4, 2, 40, 20, 0, 0, 4, 4, .auto));
    const placement = target.image_placements.items[0];
    try std.testing.expectEqual(@as(i32, 1), placement.x);
    try std.testing.expectEqual(@as(u32, 2), placement.width);
    try std.testing.expectEqual(@as(u32, 2), placement.source_x);
    try std.testing.expectEqual(@as(u32, 2), placement.source_width);
    try std.testing.expectEqual(@as(u32, 20), placement.pixel_width);
}

test "OptimizedBuffer retains image data for deferred protocol rendering" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const target = try OptimizedBuffer.init(std.testing.allocator, 1, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();
    const source = try image.createFromRgba(std.testing.allocator, &[_]u8{ 7, 8, 9, 255 }, 1, 1, 4);
    try std.testing.expect(try target.drawImage(source, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, .auto));
    source.deinit();
    try std.testing.expectEqual(@as(u8, 7), target.image_placements.items[0].image.pixels[0]);
}

test "OptimizedBuffer blocks fallback composites transparent images over lower placements" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const target = try OptimizedBuffer.init(std.testing.allocator, 1, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();
    const lower = try image.createFromRgba(std.testing.allocator, &[_]u8{ 0, 0, 255, 255 }, 1, 1, 4);
    defer lower.deinit();
    const upper = try image.createFromRgba(std.testing.allocator, &[_]u8{ 255, 0, 0, 0 }, 1, 1, 4);
    defer upper.deinit();
    try std.testing.expect(try target.drawImage(lower, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, .blocks));
    try std.testing.expect(try target.drawImage(upper, 2, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, .blocks));

    try target.materializeImageFallback(1);
    try target.materializeImageFallback(2);

    const cell = target.get(0, 0).?;
    try std.testing.expectEqual(@as(u32, 2), gp.imageIdFromChar(cell.char));
    try std.testing.expectEqual(ansi.rgbColor(0, 0, 255, 255), cell.fg);
    try std.testing.expectEqual(ansi.rgbColor(0, 0, 255, 255), cell.bg);
}

test "OptimizedBuffer copies transparent image reservation markers from frame buffers" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const source_buffer = try OptimizedBuffer.init(std.testing.allocator, 1, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer source_buffer.deinit();
    const target = try OptimizedBuffer.init(std.testing.allocator, 1, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();
    const source = try image.createFromRgba(std.testing.allocator, &[_]u8{ 7, 8, 9, 255 }, 1, 1, 4);
    defer source.deinit();

    try std.testing.expect(try source_buffer.drawImage(source, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, .auto));
    target.drawFrameBuffer(0, 0, source_buffer, null, null, null, null);
    try std.testing.expect(gp.isImageChar(target.get(0, 0).?.char));
    try std.testing.expectEqual(@as(usize, 1), target.image_placements.items.len);
}

test "OptimizedBuffer flattening a framebuffer copy preserves source image ownership" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const source_buffer = try OptimizedBuffer.init(std.testing.allocator, 1, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer source_buffer.deinit();
    const target = try OptimizedBuffer.init(std.testing.allocator, 1, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();
    const value = try image.createFromRgba(std.testing.allocator, &[_]u8{ 7, 8, 9, 255 }, 1, 1, 4);
    defer value.deinit();

    try std.testing.expect(try source_buffer.drawImage(value, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, .auto));
    target.drawFrameBuffer(0, 0, source_buffer, null, null, null, null);
    try std.testing.expectEqual(@as(u32, 3), value.ref_count);

    try target.materializeImageFallbacks();

    try std.testing.expect(!gp.isImageChar(target.get(0, 0).?.char));
    try std.testing.expectEqual(@as(usize, 0), target.image_placements.items.len);
    try std.testing.expect(gp.isImageChar(source_buffer.get(0, 0).?.char));
    try std.testing.expectEqual(@as(usize, 1), source_buffer.image_placements.items.len);
    try std.testing.expectEqual(@as(u32, 2), value.ref_count);
}

test "OptimizedBuffer copies malformed image markers as fallback cells" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const source_buffer = try OptimizedBuffer.init(std.testing.allocator, 2, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer source_buffer.deinit();
    const target = try OptimizedBuffer.init(std.testing.allocator, 2, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();
    const source = try image.createFromRgba(std.testing.allocator, &[_]u8{ 7, 8, 9, 255 }, 1, 1, 4);
    defer source.deinit();
    try std.testing.expect(try source_buffer.drawImage(source, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, .auto));
    source_buffer.setRaw(1, 0, .{
        .char = gp.packImageCell(100, 15),
        .fg = ansi.rgbColor(1, 2, 3, 255),
        .bg = ansi.rgbColor(4, 5, 6, 255),
        .attributes = 0,
    });

    target.drawFrameBuffer(0, 0, source_buffer, null, null, null, null);

    try std.testing.expect(gp.isImageChar(target.get(0, 0).?.char));
    try std.testing.expectEqual(@as(u32, 0x2588), target.get(1, 0).?.char);
}

test "OptimizedBuffer copies ordinary cells when image bookkeeping allocation fails" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const source_buffer = try OptimizedBuffer.init(std.testing.allocator, 2, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer source_buffer.deinit();
    const target = try OptimizedBuffer.init(std.testing.allocator, 2, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();
    const source = try image.createFromRgba(std.testing.allocator, &[_]u8{ 7, 8, 9, 255 }, 1, 1, 4);
    defer source.deinit();
    try std.testing.expect(try source_buffer.drawImage(source, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, .auto));
    source_buffer.setRaw(1, 0, .{
        .char = 'X',
        .fg = ansi.rgbColor(1, 2, 3, 255),
        .bg = ansi.rgbColor(4, 5, 6, 255),
        .attributes = 0,
    });

    for (0..2) |fail_index| {
        target.clear(ansi.rgbColor(0, 0, 0, 255), null);
        var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = fail_index });
        target.allocator = failing.allocator();
        target.drawFrameBuffer(0, 0, source_buffer, null, null, null, null);
        target.allocator = std.testing.allocator;

        try std.testing.expect(failing.has_induced_failure);
        try std.testing.expectEqual(@as(u32, 'X'), target.get(1, 0).?.char);
        try std.testing.expect(!gp.isImageChar(target.get(0, 0).?.char));
        try std.testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
    }
}

test "OptimizedBuffer clips image geometry without signed overflow" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const target = try OptimizedBuffer.init(std.testing.allocator, 2, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();
    const source = try image.createFromRgba(std.testing.allocator, &[_]u8{ 7, 8, 9, 255 }, 1, 1, 4);
    defer source.deinit();

    try std.testing.expect(!try target.drawImage(
        source,
        1,
        std.math.maxInt(i32),
        std.math.maxInt(i32),
        std.math.maxInt(u32),
        std.math.maxInt(u32),
        0,
        0,
        0,
        0,
        1,
        1,
        .auto,
    ));
}

test "OptimizedBuffer plane fills ignore color alpha over image markers" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const source = try image.createFromRgba(std.testing.allocator, &[_]u8{ 7, 8, 9, 255 }, 1, 1, 4);
    defer source.deinit();

    for ([_]u8{ 0, 128, 255 }) |alpha| {
        const target = try OptimizedBuffer.init(std.testing.allocator, 2, 1, .{ .pool = &pool, .link_pool = &link_pool });
        defer target.deinit();
        try std.testing.expect(try target.drawImage(source, 1, 0, 0, 2, 1, 0, 0, 0, 0, 1, 1, .auto));

        target.fillRect(0, 0, 1, 1, ansi.rgbColor(10, 20, 30, alpha));

        const covered = target.get(0, 0).?;
        try std.testing.expectEqual(@as(u32, ' '), covered.char);
        try std.testing.expectEqual(ansi.rgbColor(10, 20, 30, 255), covered.bg);
        try std.testing.expect(gp.isImageChar(target.get(1, 0).?.char));
        try std.testing.expectEqual(@as(usize, 1), target.image_placements.items.len);
    }
}

test "OptimizedBuffer transparent drawChar only writes over an image marker" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const target = try OptimizedBuffer.init(std.testing.allocator, 2, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();
    const source = try image.createFromRgba(std.testing.allocator, &[_]u8{ 7, 8, 9, 255 }, 1, 1, 4);
    defer source.deinit();
    target.setRaw(1, 0, .{
        .char = 'B',
        .fg = ansi.rgbColor(1, 2, 3, 255),
        .bg = ansi.rgbColor(4, 5, 6, 255),
        .attributes = 0,
    });
    try std.testing.expect(try target.drawImage(source, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, .auto));

    target.drawChar('X', 0, 0, ansi.rgbColor(40, 50, 60, 0), ansi.rgbColor(10, 20, 30, 0), 0);
    target.drawChar('X', 1, 0, ansi.rgbColor(40, 50, 60, 0), ansi.rgbColor(10, 20, 30, 0), 0);

    const covered = target.get(0, 0).?;
    try std.testing.expectEqual(@as(u32, 'X'), covered.char);
    try std.testing.expectEqual(@as(u8, 255), ansi.alpha(covered.fg));
    try std.testing.expectEqual(@as(u8, 255), ansi.alpha(covered.bg));
    try std.testing.expectEqual(@as(u32, 'B'), target.get(1, 0).?.char);
}

test "OptimizedBuffer transparent text space covers an image marker" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const target = try OptimizedBuffer.init(std.testing.allocator, 1, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();
    const source = try image.createFromRgba(std.testing.allocator, &[_]u8{ 7, 8, 9, 255 }, 1, 1, 4);
    defer source.deinit();
    try std.testing.expect(try target.drawImage(source, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, .auto));

    try target.drawText(" ", 0, 0, ansi.rgbColor(40, 50, 60, 64), ansi.rgbColor(10, 20, 30, 0), 0);

    const cell = target.get(0, 0).?;
    try std.testing.expectEqual(@as(u32, ' '), cell.char);
    try std.testing.expectEqual(ansi.rgbColor(10, 20, 30, 255), cell.bg);
    try std.testing.expectEqual(ansi.rgbColor(40, 50, 60, 255), cell.fg);
}

test "OptimizedBuffer text ignores foreground alpha over an image marker" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const target = try OptimizedBuffer.init(std.testing.allocator, 1, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();
    const source = try image.createFromRgba(std.testing.allocator, &[_]u8{ 7, 8, 9, 255 }, 1, 1, 4);
    defer source.deinit();
    try std.testing.expect(try target.drawImage(source, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, .auto));

    try target.drawText("X", 0, 0, ansi.rgbColor(40, 50, 60, 64), ansi.rgbColor(10, 20, 30, 255), 0);

    const cell = target.get(0, 0).?;
    try std.testing.expectEqual(@as(u32, 'X'), cell.char);
    try std.testing.expectEqual(ansi.rgbColor(10, 20, 30, 255), cell.bg);
    try std.testing.expectEqual(ansi.rgbColor(40, 50, 60, 255), cell.fg);
}

test "OptimizedBuffer transparent tab covers only clipped image markers" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const target = try OptimizedBuffer.init(std.testing.allocator, 2, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();
    const source = try image.createFromRgba(std.testing.allocator, &[_]u8{ 7, 8, 9, 255 }, 1, 1, 4);
    defer source.deinit();
    try std.testing.expect(try target.drawImage(source, 1, 0, 0, 2, 1, 0, 0, 0, 0, 1, 1, .auto));
    try target.pushScissorRect(0, 0, 1, 1);

    try target.drawText("\t", 0, 0, ansi.rgbColor(40, 50, 60, 0), ansi.rgbColor(10, 20, 30, 0), 0);

    try std.testing.expectEqual(@as(u32, ' '), target.get(0, 0).?.char);
    try std.testing.expectEqual(ansi.rgbColor(10, 20, 30, 255), target.get(0, 0).?.bg);
    try std.testing.expect(gp.isImageChar(target.get(1, 0).?.char));
}

test "OptimizedBuffer transparent tab covers image markers after its clipped start" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const target = try OptimizedBuffer.init(std.testing.allocator, 2, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();
    const source = try image.createFromRgba(std.testing.allocator, &[_]u8{ 7, 8, 9, 255 }, 1, 1, 4);
    defer source.deinit();
    try std.testing.expect(try target.drawImage(source, 1, 0, 0, 2, 1, 0, 0, 0, 0, 1, 1, .auto));
    try target.pushScissorRect(1, 0, 1, 1);

    try target.drawText("\t", 0, 0, ansi.rgbColor(40, 50, 60, 0), ansi.rgbColor(10, 20, 30, 0), 0);

    try std.testing.expect(gp.isImageChar(target.get(0, 0).?.char));
    try std.testing.expectEqual(@as(u32, ' '), target.get(1, 0).?.char);
    try std.testing.expectEqual(ansi.rgbColor(10, 20, 30, 255), target.get(1, 0).?.bg);
}

test "OptimizedBuffer transparent box border covers only clipped image markers" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const target = try OptimizedBuffer.init(std.testing.allocator, 2, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();
    const source = try image.createFromRgba(std.testing.allocator, &[_]u8{ 7, 8, 9, 255 }, 1, 1, 4);
    defer source.deinit();
    try std.testing.expect(try target.drawImage(source, 1, 0, 0, 2, 1, 0, 0, 0, 0, 1, 1, .auto));
    try target.pushScissorRect(0, 0, 1, 1);
    const border_chars = [_]u32{ '┌', '┐', '└', '┘', '─', '│', '┬', '┴', '├', '┤', '┼' };

    try target.drawBox(0, 0, 2, 1, &border_chars, .{ .top = true }, ansi.rgbColor(40, 50, 60, 0), ansi.rgbColor(10, 20, 30, 0), ansi.rgbColor(40, 50, 60, 0), false, null, 0, null, 0);

    try std.testing.expect(!gp.isImageChar(target.get(0, 0).?.char));
    try std.testing.expectEqual(ansi.rgbColor(10, 20, 30, 255), target.get(0, 0).?.bg);
    try std.testing.expectEqual(ansi.rgbColor(40, 50, 60, 255), target.get(0, 0).?.fg);
    try std.testing.expect(gp.isImageChar(target.get(1, 0).?.char));
}

test "OptimizedBuffer clipped wide text does not cover image markers" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const target = try OptimizedBuffer.init(std.testing.allocator, 2, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();
    const source = try image.createFromRgba(std.testing.allocator, &[_]u8{ 7, 8, 9, 255 }, 1, 1, 4);
    defer source.deinit();
    try std.testing.expect(try target.drawImage(source, 1, 0, 0, 2, 1, 0, 0, 0, 0, 1, 1, .auto));
    try target.pushScissorRect(0, 0, 1, 1);

    try target.drawText("界", 0, 0, ansi.rgbColor(40, 50, 60, 0), ansi.rgbColor(10, 20, 30, 0), 0);

    try std.testing.expect(gp.isImageChar(target.get(0, 0).?.char));
    try std.testing.expect(gp.isImageChar(target.get(1, 0).?.char));
}

test "OptimizedBuffer wide text is opaque when its continuation covers an image marker" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const target = try OptimizedBuffer.init(std.testing.allocator, 2, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();
    const source = try image.createFromRgba(std.testing.allocator, &[_]u8{ 7, 8, 9, 255 }, 1, 1, 4);
    defer source.deinit();
    try std.testing.expect(try target.drawImage(source, 1, 1, 0, 1, 1, 0, 0, 0, 0, 1, 1, .auto));

    try target.drawText("界", 0, 0, ansi.rgbColor(40, 50, 60, 64), ansi.rgbColor(10, 20, 30, 0), 0);

    try std.testing.expect(gp.isGraphemeChar(target.get(0, 0).?.char));
    try std.testing.expect(gp.isContinuationChar(target.get(1, 0).?.char));
    try std.testing.expectEqual(@as(u8, 255), ansi.alpha(target.get(0, 0).?.fg));
    try std.testing.expectEqual(@as(u8, 255), ansi.alpha(target.get(0, 0).?.bg));
}

test "OptimizedBuffer clipped wide text buffer does not cover image markers" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();
    var text = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .unicode);
    defer text.deinit();
    try text.setText("界");
    var view = try TextBufferView.init(std.testing.allocator, text);
    defer view.deinit();

    const target = try OptimizedBuffer.init(std.testing.allocator, 2, 1, .{ .pool = pool, .id = "clipped-wide-text-buffer" });
    defer target.deinit();
    const source = try image.createFromRgba(std.testing.allocator, &[_]u8{ 7, 8, 9, 255 }, 1, 1, 4);
    defer source.deinit();
    try std.testing.expect(try target.drawImage(source, 1, 0, 0, 2, 1, 0, 0, 0, 0, 1, 1, .auto));
    try target.pushScissorRect(0, 0, 1, 1);

    target.drawTextBuffer(view, 0, 0);

    try std.testing.expect(gp.isImageChar(target.get(0, 0).?.char));
    try std.testing.expect(gp.isImageChar(target.get(1, 0).?.char));
}

test "OptimizedBuffer text buffer does not draw a wide grapheme past its viewport" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();
    var text = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .unicode);
    defer text.deinit();
    try text.setText("界");
    var view = try TextBufferView.init(std.testing.allocator, text);
    defer view.deinit();
    view.setViewport(.{ .x = 0, .y = 0, .width = 1, .height = 1 });

    const target = try OptimizedBuffer.init(std.testing.allocator, 2, 1, .{ .pool = pool, .id = "wide-text-buffer-viewport" });
    defer target.deinit();
    const source = try image.createFromRgba(std.testing.allocator, &[_]u8{ 7, 8, 9, 255 }, 1, 1, 4);
    defer source.deinit();
    try std.testing.expect(try target.drawImage(source, 1, 0, 0, 2, 1, 0, 0, 0, 0, 1, 1, .auto));

    target.drawTextBuffer(view, 0, 0);

    try std.testing.expect(gp.isImageChar(target.get(0, 0).?.char));
    try std.testing.expect(gp.isImageChar(target.get(1, 0).?.char));
}

test "OptimizedBuffer text buffer tab covers image markers after its clipped start" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();
    var text = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .unicode);
    defer text.deinit();
    try text.setText("\t");
    var view = try TextBufferView.init(std.testing.allocator, text);
    defer view.deinit();

    const target = try OptimizedBuffer.init(std.testing.allocator, 2, 1, .{ .pool = pool, .id = "clipped-text-buffer-tab" });
    defer target.deinit();
    const source = try image.createFromRgba(std.testing.allocator, &[_]u8{ 7, 8, 9, 255 }, 1, 1, 4);
    defer source.deinit();
    try std.testing.expect(try target.drawImage(source, 1, 0, 0, 2, 1, 0, 0, 0, 0, 1, 1, .auto));
    try target.pushScissorRect(1, 0, 1, 1);

    target.drawTextBuffer(view, 0, 0);

    try std.testing.expect(gp.isImageChar(target.get(0, 0).?.char));
    try std.testing.expectEqual(@as(u32, ' '), target.get(1, 0).?.char);
}

test "OptimizedBuffer text buffer tab clips a negative draw origin" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();
    var text = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .unicode);
    defer text.deinit();
    try text.setText("\t");
    var view = try TextBufferView.init(std.testing.allocator, text);
    defer view.deinit();

    const target = try OptimizedBuffer.init(std.testing.allocator, 1, 1, .{ .pool = pool, .id = "negative-text-buffer-tab" });
    defer target.deinit();
    const source = try image.createFromRgba(std.testing.allocator, &[_]u8{ 7, 8, 9, 255 }, 1, 1, 4);
    defer source.deinit();
    try std.testing.expect(try target.drawImage(source, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, .auto));

    target.drawTextBuffer(view, -1, 0);

    try std.testing.expectEqual(@as(u32, ' '), target.get(0, 0).?.char);
}

test "OptimizedBuffer text buffer clips width-1 text at a negative draw origin" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();
    var text = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .unicode);
    defer text.deinit();
    try text.setText("AB");
    var view = try TextBufferView.init(std.testing.allocator, text);
    defer view.deinit();

    const target = try OptimizedBuffer.init(std.testing.allocator, 1, 1, .{ .pool = pool, .id = "negative-width1-text" });
    defer target.deinit();

    target.drawTextBuffer(view, -1, 0);

    try std.testing.expectEqual(@as(u32, 'B'), target.get(0, 0).?.char);
}

test "OptimizedBuffer image-free frame buffer copy does not allocate" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const source = try OptimizedBuffer.init(std.testing.allocator, 1, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer source.deinit();
    const target = try OptimizedBuffer.init(std.testing.allocator, 1, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();

    source.set(0, 0, .{
        .char = 'X',
        .fg = ansi.rgbColor(1, 2, 3, 255),
        .bg = ansi.rgbColor(4, 5, 6, 255),
        .attributes = 7,
    });
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = 0 });
    target.allocator = failing.allocator();
    target.drawFrameBuffer(0, 0, source, null, null, null, null);
    target.allocator = std.testing.allocator;

    try std.testing.expect(!failing.has_induced_failure);
    try std.testing.expectEqual(@as(u32, 'X'), target.get(0, 0).?.char);
}

test "OptimizedBuffer image-free alpha frame buffer copy does not allocate" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const source = try OptimizedBuffer.init(std.testing.allocator, 1, 1, .{
        .pool = &pool,
        .link_pool = &link_pool,
        .respectAlpha = true,
    });
    defer source.deinit();
    const target = try OptimizedBuffer.init(std.testing.allocator, 1, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();

    source.set(0, 0, .{
        .char = 'X',
        .fg = ansi.rgbColor(1, 2, 3, 255),
        .bg = ansi.rgbColor(4, 5, 6, 255),
        .attributes = 7,
    });
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = 0 });
    target.allocator = failing.allocator();
    target.drawFrameBuffer(0, 0, source, null, null, null, null);
    target.allocator = std.testing.allocator;

    try std.testing.expect(!failing.has_induced_failure);
    try std.testing.expectEqual(@as(u32, 'X'), target.get(0, 0).?.char);
}

fn initBufferForOomRegression(allocator: std.mem.Allocator) !void {
    var local_pool = gp.GraphemePool.initWithOptions(allocator, .{});
    defer local_pool.deinit();

    var local_link_pool = link.LinkPool.init(allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        allocator,
        1,
        1,
        .{ .pool = &local_pool, .id = "oom-regression", .link_pool = &local_link_pool },
    );
    defer buf.deinit();
}

test "OptimizedBuffer - init frees allocations on OOM" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, initBufferForOomRegression, .{});
}

test "OptimizedBuffer - init and deinit" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

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
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        5,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    buf.clear(bg, null);

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
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    buf.clear(bg, null);

    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);
    try buf.drawText("Hello", 0, 0, fg, bg, 0);

    const cell_h = buf.get(0, 0).?;
    try std.testing.expectEqual(@as(u32, 'H'), cell_h.char);

    const cell_e = buf.get(1, 0).?;
    try std.testing.expectEqual(@as(u32, 'e'), cell_e.char);
}

test "OptimizedBuffer - drawGrapheme preserves authoritative width" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(std.testing.allocator, 4, 1, .{ .pool = pool, .id = "grapheme-width-buffer" });
    defer buf.deinit();
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);
    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);

    try buf.drawGrapheme("A", 2, 0, 0, fg, bg, 0);
    try std.testing.expect(gp.isGraphemeChar(buf.get(0, 0).?.char));
    try std.testing.expect(gp.isContinuationChar(buf.get(1, 0).?.char));
}

test "OptimizedBuffer - alpha blending downgrades blended metadata to rgb" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        4,
        1,
        .{ .pool = pool, .id = "tag-blend-buffer" },
    );
    defer buf.deinit();

    const base_bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    buf.clear(base_bg, null);

    buf.setCellWithAlphaBlending(
        0,
        0,
        'B',
        ansi.packRGBA8(255, 0, 0, 128, ansi.packMeta(.indexed, 3)),
        base_bg,
        0,
    );

    const fg_blended_cell = buf.get(0, 0).?;
    try std.testing.expectEqual(ansi.ColorIntent.rgb, ansi.intent(fg_blended_cell.fg));
    try std.testing.expectEqual(ansi.ColorIntent.rgb, ansi.intent(fg_blended_cell.bg));

    // Establish a destination foreground, then blend background alpha over it.
    buf.set(0, 0, .{
        .char = 'A',
        .fg = ansi.indexedColor(1, 255, 255, 255),
        .bg = ansi.indexedColor(2, 0, 0, 0),
        .attributes = 0,
    });

    buf.setCellWithAlphaBlending(
        0,
        0,
        'C',
        ansi.indexedColor(5, 255, 0, 0),
        ansi.packRGBA8(0, 255, 0, 128, ansi.packMeta(.indexed, 6)),
        0,
    );

    const bg_blended_cell = buf.get(0, 0).?;
    try std.testing.expectEqual(ansi.ColorIntent.indexed, ansi.intent(bg_blended_cell.fg));
    try std.testing.expectEqual(@as(u8, 5), ansi.slot(bg_blended_cell.fg));
    try std.testing.expectEqual(ansi.ColorIntent.rgb, ansi.intent(bg_blended_cell.bg));
}

test "OptimizedBuffer - transparent framebuffer cell background stays transparent over backdrop" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var src = try OptimizedBuffer.init(
        std.testing.allocator,
        1,
        1,
        .{ .pool = pool, .respectAlpha = true, .id = "transparent-src-buffer" },
    );
    defer src.deinit();

    var dst = try OptimizedBuffer.init(
        std.testing.allocator,
        1,
        1,
        .{ .pool = pool, .id = "transparent-dst-buffer" },
    );
    defer dst.deinit();

    const transparent_bg = ansi.rgbColor(0, 0, 0, 0);
    src.clear(transparent_bg, null);
    dst.clear(transparent_bg, null);
    dst.setBlendBackdropColor(ansi.rgbColor(0, 0, 0, 255));

    src.set(0, 0, .{
        .char = 'X',
        .fg = ansi.rgbColor(255, 255, 255, 255),
        .bg = transparent_bg,
        .attributes = 0,
    });

    dst.drawFrameBuffer(0, 0, src, null, null, null, null);

    const cell = dst.get(0, 0).?;
    try std.testing.expectEqual(@as(u32, 'X'), cell.char);
    try std.testing.expectEqual(@as(u8, 0), ansi.alpha(cell.bg));
}

test "OptimizedBuffer - drawFrameBuffer modes are independent of disjoint trackers" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var links = link.LinkPool.init(std.testing.allocator);
    defer links.deinit();
    const white = ansi.defaultColor(255, 255, 255, 255);
    const blue = ansi.rgbColor(0, 0, 255, 255);
    for ([_]bool{ false, true }) |respect_alpha| {
        for ([_]f32{ 0.0, 0.5, 1.0 }) |opacity| {
            for ([_]u8{ 0, 128, 255 }) |alpha| {
                for (0..5) |tracker| {
                    const src = try OptimizedBuffer.init(std.testing.allocator, 6, 2, .{ .pool = &pool, .link_pool = &links, .respectAlpha = respect_alpha });
                    defer src.deinit();
                    const dst = try OptimizedBuffer.init(std.testing.allocator, 6, 2, .{ .pool = &pool, .link_pool = &links });
                    defer dst.deinit();
                    dst.clear(blue, null);
                    const cell = buffer_mod.Cell{
                        .char = 'X',
                        .fg = if (alpha == 0) ansi.rgbColor(255, 255, 255, 0) else white,
                        .bg = ansi.packRGBA8(255, 0, 0, alpha, ansi.packMeta(.indexed, 3)),
                        .attributes = ansi.TextAttributes.BOLD,
                    };
                    src.set(0, 0, cell);
                    if (tracker == 1 or tracker == 2) {
                        const tracked = if (tracker == 1) dst else src;
                        try tracked.drawGrapheme("\xe7\x95\x8c", 2, 0, 1, white, blue, 0);
                    } else if (tracker == 3 or tracker == 4) {
                        const tracked = if (tracker == 3) dst else src;
                        const id = try links.alloc("https://example.com/disjoint");
                        tracked.set(0, 1, .{ .char = 'L', .fg = white, .bg = blue, .attributes = ansi.TextAttributes.setLinkId(0, id) });
                    }
                    try dst.pushOpacity(opacity);
                    try dst.pushScissorRect(3, 0, 1, 1);
                    dst.drawFrameBuffer(3, 0, src, 0, 0, 1, 1);
                    const copied = dst.get(3, 0).?;
                    if (opacity == 0.0 or (respect_alpha and alpha == 0) or (opacity < 1.0 and alpha == 0)) {
                        try std.testing.expectEqual(@as(u32, ' '), copied.char);
                        try std.testing.expectEqual(blue, copied.bg);
                    } else if (opacity == 1.0 and (!respect_alpha or alpha == 255)) {
                        try std.testing.expectEqualDeep(cell, copied);
                    } else {
                        const effective_alpha: u8 = if (opacity == 0.5) (if (alpha == 255) 128 else 64) else alpha;
                        try std.testing.expectEqual(@as(u32, 'X'), copied.char);
                        try std.testing.expectEqual(ansi.rgbColor(effective_alpha, 0, 255 - effective_alpha, 255), copied.bg);
                        try std.testing.expectEqual(cell.attributes, copied.attributes);
                    }
                    try std.testing.expectEqual(@as(u32, ' '), dst.get(4, 0).?.char);
                }
            }
        }
    }
}

test "OptimizedBuffer - drawFrameBuffer replacement retains linked graphemes and repairs spans" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var links = link.LinkPool.init(std.testing.allocator);
    defer links.deinit();
    const src = try OptimizedBuffer.init(std.testing.allocator, 2, 1, .{ .pool = &pool, .link_pool = &links });
    defer src.deinit();
    const dst = try OptimizedBuffer.init(std.testing.allocator, 4, 1, .{ .pool = &pool, .link_pool = &links });
    defer dst.deinit();
    const transparent = ansi.rgbColor(1, 2, 3, 0);
    const id = try links.alloc("https://example.com/copied");
    try src.drawGrapheme("\xe7\x95\x8c", 2, 0, 0, ansi.rgbColor(255, 255, 255, 255), transparent, ansi.TextAttributes.setLinkId(0, id));
    const original = src.get(0, 0).?;
    dst.drawFrameBuffer(1, 0, src, null, null, null, null);
    try std.testing.expectEqualDeep(original, dst.get(1, 0).?);
    try std.testing.expect(gp.isContinuationChar(dst.get(2, 0).?.char));
    src.clear(transparent, null);
    try std.testing.expectEqualStrings("\xe7\x95\x8c", try pool.get(gp.graphemeIdFromChar(original.char)));
    try std.testing.expectEqualStrings("https://example.com/copied", try links.get(id));

    // A cropped continuation becomes a space, not an orphaned wide-cell tail.
    src.drawFrameBuffer(0, 0, dst, 2, 0, 1, 1);
    try std.testing.expectEqual(@as(u32, ' '), src.get(0, 0).?.char);
    try std.testing.expectEqual(transparent, src.get(0, 0).?.bg);
    src.clear(transparent, null);
    src.set(0, 0, .{ .char = 'X', .fg = transparent, .bg = transparent, .attributes = 0 });
    dst.drawFrameBuffer(2, 0, src, 0, 0, 1, 1);
    try std.testing.expectEqual(@as(u32, ' '), dst.get(1, 0).?.char);
    try std.testing.expectEqualDeep(src.get(0, 0).?, dst.get(2, 0).?);
    try std.testing.expect(!dst.grapheme_tracker.hasAny());
    try std.testing.expect(!dst.link_tracker.hasAny());
}

test "OptimizedBuffer - drawFrameBuffer preserves packed metadata on opaque copy" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var src = try OptimizedBuffer.init(
        std.testing.allocator,
        2,
        1,
        .{ .pool = pool, .id = "src-tag-copy-buffer" },
    );
    defer src.deinit();

    var dst = try OptimizedBuffer.init(
        std.testing.allocator,
        2,
        1,
        .{ .pool = pool, .id = "dst-tag-copy-buffer" },
    );
    defer dst.deinit();

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    src.clear(bg, null);
    dst.clear(bg, null);

    src.set(0, 0, .{
        .char = 'X',
        .fg = ansi.defaultColor(255, 255, 255, 255),
        .bg = ansi.indexedColor(6, 0, 128, 128),
        .attributes = 0,
    });

    dst.drawFrameBuffer(0, 0, src, null, null, null, null);

    const copied = dst.get(0, 0).?;
    try std.testing.expectEqual(ansi.ColorIntent.default, ansi.intent(copied.fg));
    try std.testing.expectEqual(ansi.ColorIntent.indexed, ansi.intent(copied.bg));
    try std.testing.expectEqual(@as(u8, 6), ansi.slot(copied.bg));
}

test "OptimizedBuffer - drawTextBuffer transparent fast path preserves destination background metadata" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .unicode);
    defer tb.deinit();
    try tb.setText("A");
    tb.setDefaultFg(ansi.defaultColor(255, 255, 255, 255));
    tb.setDefaultBg(ansi.defaultColor(0, 0, 0, 0));

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        1,
        1,
        .{ .pool = pool, .id = "transparent-text-fast-tags" },
    );
    defer buf.deinit();

    const stale_bg = ansi.indexedColor(6, 0, 0, 255);
    buf.set(0, 0, .{
        .char = 'Z',
        .fg = ansi.indexedColor(1, 255, 0, 0),
        .bg = stale_bg,
        .attributes = ansi.TextAttributes.BOLD,
    });

    buf.drawTextBuffer(view, 0, 0);

    const cell = buf.get(0, 0).?;
    try std.testing.expectEqual(@as(u32, 'A'), cell.char);
    try std.testing.expectEqual(ansi.ColorIntent.default, ansi.intent(cell.fg));
    try std.testing.expectEqual(ansi.ColorIntent.indexed, ansi.intent(cell.bg));
    try std.testing.expectEqual(@as(u8, 6), ansi.slot(cell.bg));
    try std.testing.expectEqual(stale_bg, cell.bg);
}

test "OptimizedBuffer - drawTextBuffer transparent non-ascii preserves destination background metadata" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .unicode);
    defer tb.deinit();
    try tb.setText("·");
    tb.setDefaultFg(ansi.defaultColor(255, 255, 255, 255));
    tb.setDefaultBg(ansi.defaultColor(0, 0, 0, 0));

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        1,
        1,
        .{ .pool = pool, .id = "transparent-text-non-ascii-tags" },
    );
    defer buf.deinit();

    const stale_bg = ansi.indexedColor(6, 0, 0, 255);
    buf.set(0, 0, .{
        .char = 'Z',
        .fg = ansi.indexedColor(1, 255, 0, 0),
        .bg = stale_bg,
        .attributes = ansi.TextAttributes.BOLD,
    });

    buf.drawTextBuffer(view, 0, 0);

    const cell = buf.get(0, 0).?;
    try std.testing.expect(gp.isGraphemeChar(cell.char));
    try std.testing.expectEqual(ansi.ColorIntent.default, ansi.intent(cell.fg));
    try std.testing.expectEqual(ansi.ColorIntent.indexed, ansi.intent(cell.bg));
    try std.testing.expectEqual(@as(u8, 6), ansi.slot(cell.bg));
    try std.testing.expectEqual(stale_bg, cell.bg);
}

test "OptimizedBuffer - repeated emoji rendering should not exhaust pool" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);

    var i: u32 = 0;
    while (i < 1000) : (i += 1) {
        buf.clear(bg, null);
        try buf.drawText("🌟🎨🚀", 0, 0, fg, bg, 0);
    }

    const cell = buf.get(0, 0).?;
    try std.testing.expect(gp.isGraphemeChar(cell.char));
}

test "OptimizedBuffer - repeated CJK rendering should not exhaust pool" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);

    var i: u32 = 0;
    while (i < 1000) : (i += 1) {
        buf.clear(bg, null);
        try buf.drawText("测试文字", 0, 0, fg, bg, 0);
    }

    const cell = buf.get(0, 0).?;
    try std.testing.expect(gp.isGraphemeChar(cell.char));
}

test "OptimizedBuffer - drawTextBuffer repeatedly should not exhaust pool" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .wcwidth);
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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);

    var i: u32 = 0;
    while (i < 1000) : (i += 1) {
        buf.clear(bg, null);
        buf.drawTextBuffer(view, 0, 0);
    }
}

test "OptimizedBuffer - mixed ASCII and emoji repeated rendering" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        40,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);

    var i: u32 = 0;
    while (i < 500) : (i += 1) {
        buf.clear(bg, null);
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
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);

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
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        25,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);

    var i: u32 = 0;
    while (i < 100) : (i += 1) {
        buf.clear(bg, null);

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
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .wcwidth);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var text_builder: std.Io.Writer.Allocating = .init(std.testing.allocator);
    defer text_builder.deinit();

    var line: u32 = 0;
    while (line < 20) : (line += 1) {
        try text_builder.writer.writeAll("Line ");
        try text_builder.writer.print("{d}", .{line});
        try text_builder.writer.writeAll(": 🌟 测试 🎨 Test 🚀\n");
    }

    try tb.setText(text_builder.written());

    view.setWrapMode(.char);
    view.setWrapWidth(40);

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        80,
        50,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);

    var i: u32 = 0;
    while (i < 200) : (i += 1) {
        buf.clear(bg, null);
        buf.drawTextBuffer(view, 0, 0);
    }
}

test "OptimizedBuffer - grapheme tracker counts" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);

    try buf.drawText("🌟🎨🚀", 0, 0, fg, bg, 0);

    const count_after_draw = buf.grapheme_tracker.getGraphemeCount();
    try std.testing.expect(count_after_draw > 0);
    try std.testing.expect(count_after_draw <= 10);

    var i: u32 = 0;
    while (i < 100) : (i += 1) {
        buf.clear(bg, null);
        try buf.drawText("🌟🎨🚀", 0, 0, fg, bg, 0);
    }

    const count_after_repeated = buf.grapheme_tracker.getGraphemeCount();
    try std.testing.expect(count_after_repeated <= 20);
}

test "OptimizedBuffer - alternating emojis should not leak" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        20,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);

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
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .wcwidth);
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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    buf.clear(bg, null);

    var i: u32 = 0;
    while (i < 2000) : (i += 1) {
        buf.drawTextBuffer(view, 0, 0);
    }

    const count = buf.grapheme_tracker.getGraphemeCount();
    try std.testing.expect(count < 100);
}

test "OptimizedBuffer - many small graphemes without clear" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .wcwidth);
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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    buf.clear(bg, null);

    var i: u32 = 0;
    while (i < 5000) : (i += 1) {
        buf.drawTextBuffer(view, 0, 0);
    }

    const count = buf.grapheme_tracker.getGraphemeCount();
    try std.testing.expect(count < 200);
}

test "OptimizedBuffer - stress test with many graphemes" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .wcwidth);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    var text_builder: std.ArrayListUnmanaged(u8) = .empty;
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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    buf.clear(bg, null);

    var i: u32 = 0;
    while (i < 1000) : (i += 1) {
        buf.drawTextBuffer(view, 0, 0);
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
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .wcwidth);
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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);

    var i: u32 = 0;
    while (i < 10000) : (i += 1) {
        if (i % 100 == 0) {
            buf.clear(bg, null);
        }
        buf.drawTextBuffer(view, 0, 0);
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

    var tb = try TextBuffer.init(std.testing.allocator, &local_pool, link.initGlobalLinkPool(std.testing.allocator), .wcwidth);
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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);

    var render_count: u32 = 0;
    var failure_count: u32 = 0;

    while (render_count < 1000) : (render_count += 1) {
        var text_builder: std.ArrayListUnmanaged(u8) = .empty;
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
            buf.clear(bg, null);
            tb.reset();
        }

        buf.drawTextBuffer(view, 0, 0);
    }

    try std.testing.expect(failure_count == 0);
}

test "OptimizedBuffer - continuous rendering without buffer recreation" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .wcwidth);
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
        buf.drawTextBuffer(view, 0, 0);
    }
}

test "OptimizedBuffer - multiple buffers rendering same TextBuffer" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .wcwidth);
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
        buf1.drawTextBuffer(view, 0, 0);
        buf2.drawTextBuffer(view, 0, 0);
        buf3.drawTextBuffer(view, 0, 0);
    }
}

test "OptimizedBuffer - continuous render without clear with small pool" {
    const tiny_slots = [_]u32{ 2, 2, 2, 2, 2 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, &local_pool, link.initGlobalLinkPool(std.testing.allocator), .wcwidth);
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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    buf.clear(bg, null);

    var i: u32 = 0;
    while (i < 100) : (i += 1) {
        buf.drawTextBuffer(view, 0, 0);
    }
}

test "OptimizedBuffer - graphemes with scissor clipping and small pool" {
    const tiny_slots = [_]u32{ 3, 3, 3, 3, 3 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, &local_pool, link.initGlobalLinkPool(std.testing.allocator), .wcwidth);
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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    buf.clear(bg, null);

    try buf.pushScissorRect(0, 0, 5, 5);

    var i: u32 = 0;
    while (i < 100) : (i += 1) {
        buf.drawTextBuffer(view, 20, 20);
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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);
    const bg_alpha = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 0.5);

    buf.clear(bg, null);

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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);
    const bg_alpha = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 0.5);

    buf.clear(bg, null);

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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);

    buf.clear(bg, null);

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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);

    buf.clear(bg, null);

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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);

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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);

    var frame: u32 = 0;
    while (frame < 100) : (frame += 1) {
        try nextBuffer.drawText("• Test •", 0, 0, fg, bg, 0);

        const cell = nextBuffer.get(0, 0).?;
        currentBuffer.setRaw(0, 0, cell);

        nextBuffer.clear(bg, null);
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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);

    var frame: u32 = 0;
    while (frame < 200) : (frame += 1) {
        try buf.drawText("•", 0, 0, fg, bg, 0);
        buf.clear(bg, null);
    }
}

test "OptimizedBuffer - repeated drawTextBuffer without clear should not leak" {
    const tiny_slots = [_]u32{ 2, 2, 2, 2, 2 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, &local_pool, link.initGlobalLinkPool(std.testing.allocator), .wcwidth);
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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    buf.clear(bg, null);

    var frame: u32 = 0;
    while (frame < 500) : (frame += 1) {
        buf.drawTextBuffer(view, 0, 0);
    }
}

test "OptimizedBuffer - renderer two-buffer swap pattern should not leak" {
    const tiny_slots = [_]u32{ 3, 3, 3, 3, 3 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, &local_pool, link.initGlobalLinkPool(std.testing.allocator), .wcwidth);
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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    current.clear(bg, null);

    var frame: u32 = 0;
    while (frame < 300) : (frame += 1) {
        next.drawTextBuffer(view, 0, 0);

        var x: u32 = 0;
        while (x < 10) : (x += 1) {
            if (next.get(x, 0)) |cell| {
                current.setRaw(x, 0, cell);
            }
        }

        next.clear(bg, null);
    }
}

test "OptimizedBuffer - set should not clear newly written adjacent grapheme continuation" {
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{});
    defer local_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        8,
        1,
        .{ .pool = &local_pool, .id = "set-adjacent-grapheme" },
    );
    defer buf.deinit();

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);
    buf.clear(bg, null);

    const old_gid = try local_pool.alloc("🌟");
    const old_start = gp.packGraphemeStart(old_gid & gp.GRAPHEME_ID_MASK, 2);
    buf.set(3, 0, .{ .char = old_start, .fg = fg, .bg = bg, .attributes = 0 });

    const new_gid = try local_pool.alloc("🔥");
    const new_start = gp.packGraphemeStart(new_gid & gp.GRAPHEME_ID_MASK, 2);

    // Simulate renderer's left-to-right in-place update:
    // - x=2 writes a new grapheme (which writes continuation at x=3)
    // - x=3 would be skipped by char-equality
    // - x=4 overwrites an old continuation from the previous frame
    // The overwrite at x=4 must not clear the new continuation at x=3.
    buf.set(2, 0, .{ .char = new_start, .fg = fg, .bg = bg, .attributes = 0 });
    buf.set(4, 0, .{ .char = ' ', .fg = fg, .bg = bg, .attributes = 0 });

    const c2 = buf.get(2, 0).?;
    const c3 = buf.get(3, 0).?;
    const c4 = buf.get(4, 0).?;

    try std.testing.expect(gp.isGraphemeChar(c2.char));
    try std.testing.expect(gp.graphemeIdFromChar(c2.char) == (new_gid & gp.GRAPHEME_ID_MASK));

    try std.testing.expect(gp.isContinuationChar(c3.char));
    try std.testing.expect(gp.graphemeIdFromChar(c3.char) == (new_gid & gp.GRAPHEME_ID_MASK));

    try std.testing.expect(c4.char == ' ');
}

test "OptimizedBuffer - set span cleanup keeps shared link refcounts consistent" {
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{});
    defer local_pool.deinit();

    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        1,
        .{ .pool = &local_pool, .id = "set-span-link-refcount", .link_pool = &local_link_pool },
    );
    defer buf.deinit();

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);
    buf.clear(bg, null);

    const link_id = try local_link_pool.alloc("https://example.com");
    const linked_attr = ansi.TextAttributes.setLinkId(0, link_id);

    const gid = try local_pool.alloc("你");
    const start = gp.packGraphemeStart(gid & gp.GRAPHEME_ID_MASK, 2);

    // Create three linked cells total:
    // - a 2-cell grapheme span at x=2..3
    // - one additional linked cell at x=6
    buf.set(2, 0, .{ .char = start, .fg = fg, .bg = bg, .attributes = linked_attr });
    buf.set(6, 0, .{ .char = 'X', .fg = fg, .bg = bg, .attributes = linked_attr });

    try std.testing.expectEqual(@as(u32, 3), buf.link_tracker.used_ids.get(link_id).?);
    try std.testing.expectEqual(@as(u32, 1), try local_link_pool.getRefcount(link_id));

    // Overwrite the continuation cell at x=3 with a non-grapheme char.
    // set() will run span cleanup and clear x=2..3. The independent linked
    // cell at x=6 must remain tracked.
    buf.set(3, 0, .{ .char = ' ', .fg = fg, .bg = bg, .attributes = 0 });

    try std.testing.expectEqual(@as(u32, 1), buf.link_tracker.getLinkCount());
    try std.testing.expectEqual(@as(u32, 1), buf.link_tracker.used_ids.get(link_id).?);
    try std.testing.expectEqual(@as(u32, 1), try local_link_pool.getRefcount(link_id));
}

test "OptimizedBuffer - syncCell updates grapheme tracker for start transitions" {
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{});
    defer local_pool.deinit();

    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        1,
        .{ .pool = &local_pool, .id = "sync-cell-grapheme-tracker", .link_pool = &local_link_pool },
    );
    defer buf.deinit();

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);
    buf.clear(bg, null);

    const gid_old = try local_pool.alloc("你");
    const gid_new = try local_pool.alloc("好");
    const old_id = gid_old & gp.GRAPHEME_ID_MASK;
    const new_id = gid_new & gp.GRAPHEME_ID_MASK;
    const start_old = gp.packGraphemeStart(old_id, 2);
    const start_new = gp.packGraphemeStart(new_id, 2);

    buf.syncCell(1, 0, .{ .char = start_old, .fg = fg, .bg = bg, .attributes = 0 });
    try std.testing.expectEqual(@as(u32, 1), buf.grapheme_tracker.getGraphemeCount());
    try std.testing.expect(buf.grapheme_tracker.contains(old_id));

    buf.syncCell(1, 0, .{ .char = start_new, .fg = fg, .bg = bg, .attributes = 0 });
    try std.testing.expectEqual(@as(u32, 1), buf.grapheme_tracker.getGraphemeCount());
    try std.testing.expect(!buf.grapheme_tracker.contains(old_id));
    try std.testing.expect(buf.grapheme_tracker.contains(new_id));

    buf.syncCell(1, 0, .{ .char = ' ', .fg = fg, .bg = bg, .attributes = 0 });
    try std.testing.expectEqual(@as(u32, 0), buf.grapheme_tracker.getGraphemeCount());
    try std.testing.expect(!buf.grapheme_tracker.contains(new_id));
}

test "OptimizedBuffer - sustained rendering should not leak" {
    const tiny_slots = [_]u32{ 2, 2, 2, 2, 2 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, &local_pool, link.initGlobalLinkPool(std.testing.allocator), .wcwidth);
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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    buf.clear(bg, null);

    var frame: u32 = 0;
    while (frame < 3000) : (frame += 1) {
        buf.drawTextBuffer(view, 0, 0);
    }
}

test "OptimizedBuffer - rendering with changing content should not leak" {
    const tiny_slots = [_]u32{ 2, 2, 2, 2, 2 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = tiny_slots,
    });
    defer local_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, &local_pool, link.initGlobalLinkPool(std.testing.allocator), .wcwidth);
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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    buf.clear(bg, null);

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

        buf.drawTextBuffer(view, 0, 0);
    }
}

test "OptimizedBuffer - multiple TextBuffers rendering simultaneously should not leak" {
    const one_slot = [_]u32{ 1, 1, 1, 1, 1 };
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = one_slot,
    });
    defer local_pool.deinit();

    var tb1 = try TextBuffer.init(std.testing.allocator, &local_pool, link.initGlobalLinkPool(std.testing.allocator), .wcwidth);
    defer tb1.deinit();
    var view1 = try TextBufferView.init(std.testing.allocator, tb1);
    defer view1.deinit();

    var tb2 = try TextBuffer.init(std.testing.allocator, &local_pool, link.initGlobalLinkPool(std.testing.allocator), .wcwidth);
    defer tb2.deinit();
    var view2 = try TextBufferView.init(std.testing.allocator, tb2);
    defer view2.deinit();

    var tb3 = try TextBuffer.init(std.testing.allocator, &local_pool, link.initGlobalLinkPool(std.testing.allocator), .wcwidth);
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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    buf.clear(bg, null);

    var frame: u32 = 0;
    while (frame < 500) : (frame += 1) {
        buf.drawTextBuffer(view1, 0, 0);
        buf.drawTextBuffer(view2, 0, 10);
        buf.drawTextBuffer(view3, 0, 20);
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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);

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

    var tb = try TextBuffer.init(std.testing.allocator, &local_pool, link.initGlobalLinkPool(std.testing.allocator), .wcwidth);
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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);

    buf.drawTextBuffer(view, 0, 0);

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

    buf.clear(bg, null);

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

    buf.drawTextBuffer(view, 0, 0);
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

    buf.clear(bg, null);
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
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var tb = try TextBuffer.init(std.testing.allocator, pool, &local_link_pool, .wcwidth);
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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    buf.clear(bg, null);

    // Draw text buffer at negative y coordinate (-2)
    // This simulates a scenario where content is scrolled partially off-screen
    // The first 2 lines should be clipped, and lines 3, 4, 5 should be visible
    buf.drawTextBuffer(view, 0, -2);

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
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);
    buf.clear(bg, null);

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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);
    buf.clear(bg, null);

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
    buf.clear(bg, null);
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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);
    buf.clear(bg, null);

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
    buf.fillRect(0, 0, 6, 1, bg);

    // Cells in rect should have no link
    try std.testing.expect(!ansi.TextAttributes.hasLink(buf.get(0, 0).?.attributes));
    try std.testing.expect(!ansi.TextAttributes.hasLink(buf.get(5, 0).?.attributes));

    // Cells outside rect should preserve link
    try std.testing.expect(ansi.TextAttributes.hasLink(buf.get(10, 0).?.attributes));
}

test "OptimizedBuffer - fillRect alpha path preserves underlying text without trackers" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        6,
        3,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);
    buf.clear(bg, null);
    try buf.drawText("X", 1, 1, fg, bg, 0);

    try std.testing.expect(!buf.grapheme_tracker.hasAny());
    try std.testing.expect(!buf.link_tracker.hasAny());

    const overlay_bg = ansi.rgbaFromFloats(0.0, 0.0, 1.0, 0.5);
    buf.fillRect(0, 0, 3, 3, overlay_bg);

    const preserved = buf.get(1, 1).?;
    try std.testing.expectEqual(@as(u32, 'X'), preserved.char);
    try std.testing.expect(ansi.blueF(preserved.bg) > 0.1);
    try std.testing.expect(ansi.blueF(preserved.fg) > 0.5);

    const filled = buf.get(0, 0).?;
    try std.testing.expectEqual(@as(u32, buffer_mod.DEFAULT_SPACE_CHAR), filled.char);
    try std.testing.expect(ansi.blueF(filled.bg) > 0.1);
    try std.testing.expect(ansi.redF(filled.fg) > 0.9);
}

test "OptimizedBuffer - fillRect transparent path is a no-op without trackers" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        6,
        3,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const red_bg = ansi.rgbaFromFloats(1.0, 0.0, 0.0, 1.0);
    const yellow_fg = ansi.rgbaFromFloats(1.0, 1.0, 0.0, 1.0);
    const green_fg = ansi.rgbaFromFloats(0.0, 1.0, 0.0, 1.0);
    const blue_bg = ansi.rgbaFromFloats(0.0, 0.0, 1.0, 1.0);
    buf.clear(red_bg, null);
    try buf.drawText("X", 1, 1, yellow_fg, red_bg, ansi.TextAttributes.BOLD);
    try buf.drawText(" ", 0, 1, green_fg, blue_bg, ansi.TextAttributes.UNDERLINE);

    try std.testing.expect(!buf.grapheme_tracker.hasAny());
    try std.testing.expect(!buf.link_tracker.hasAny());

    const transparent_bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 0.0);
    buf.fillRect(0, 0, 3, 3, transparent_bg);

    const preserved = buf.get(1, 1).?;
    try std.testing.expectEqual(@as(u32, 'X'), preserved.char);
    try std.testing.expectEqual(ansi.redF(yellow_fg), ansi.redF(preserved.fg));
    try std.testing.expectEqual(ansi.greenF(yellow_fg), ansi.greenF(preserved.fg));
    try std.testing.expectEqual(ansi.blueF(yellow_fg), ansi.blueF(preserved.fg));
    try std.testing.expectEqual(ansi.redF(red_bg), ansi.redF(preserved.bg));
    try std.testing.expectEqual(ansi.greenF(red_bg), ansi.greenF(preserved.bg));
    try std.testing.expectEqual(ansi.blueF(red_bg), ansi.blueF(preserved.bg));
    try std.testing.expectEqual(ansi.TextAttributes.BOLD, preserved.attributes);

    const unchangedSpace = buf.get(0, 1).?;
    try std.testing.expectEqual(@as(u32, buffer_mod.DEFAULT_SPACE_CHAR), unchangedSpace.char);
    try std.testing.expectEqual(ansi.redF(green_fg), ansi.redF(unchangedSpace.fg));
    try std.testing.expectEqual(ansi.greenF(green_fg), ansi.greenF(unchangedSpace.fg));
    try std.testing.expectEqual(ansi.blueF(green_fg), ansi.blueF(unchangedSpace.fg));
    try std.testing.expectEqual(ansi.redF(blue_bg), ansi.redF(unchangedSpace.bg));
    try std.testing.expectEqual(ansi.greenF(blue_bg), ansi.greenF(unchangedSpace.bg));
    try std.testing.expectEqual(ansi.blueF(blue_bg), ansi.blueF(unchangedSpace.bg));
    try std.testing.expectEqual(ansi.TextAttributes.UNDERLINE, unchangedSpace.attributes);
}

test "OptimizedBuffer - drawBox transparent border preserves destination background metadata without trackers" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        4,
        4,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const red_bg = ansi.indexedColor(6, 255, 0, 0);
    const yellow_fg = ansi.defaultColor(255, 255, 0, 255);
    const green_fg = ansi.indexedColor(4, 0, 255, 0);
    const transparent_bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 0.0);
    buf.clear(red_bg, null);
    buf.set(0, 1, .{
        .char = 'A',
        .fg = yellow_fg,
        .bg = red_bg,
        .attributes = ansi.TextAttributes.BOLD,
    });

    try std.testing.expect(!buf.grapheme_tracker.hasAny());
    try std.testing.expect(!buf.link_tracker.hasAny());

    const border_chars = [_]u32{ 0x250c, 0x2510, 0x2514, 0x2518, 0x2500, 0x2502, 0, 0, 0, 0, 0 };
    try buf.drawBox(0, 0, 4, 4, &border_chars, .{ .left = true }, green_fg, transparent_bg, green_fg, false, null, 0, null, 0);

    const cell = buf.get(0, 1).?;
    try std.testing.expectEqual(@as(u32, 0x2502), cell.char);
    try std.testing.expectEqual(ansi.redF(green_fg), ansi.redF(cell.fg));
    try std.testing.expectEqual(ansi.greenF(green_fg), ansi.greenF(cell.fg));
    try std.testing.expectEqual(ansi.blueF(green_fg), ansi.blueF(cell.fg));
    try std.testing.expectEqual(ansi.ColorIntent.indexed, ansi.intent(cell.fg));
    try std.testing.expectEqual(@as(u8, 4), ansi.slot(cell.fg));
    try std.testing.expectEqual(ansi.redF(red_bg), ansi.redF(cell.bg));
    try std.testing.expectEqual(ansi.greenF(red_bg), ansi.greenF(cell.bg));
    try std.testing.expectEqual(ansi.blueF(red_bg), ansi.blueF(cell.bg));
    try std.testing.expectEqual(ansi.ColorIntent.indexed, ansi.intent(cell.bg));
    try std.testing.expectEqual(@as(u8, 6), ansi.slot(cell.bg));
    try std.testing.expectEqual(@as(u32, 0), cell.attributes);
}

test "OptimizedBuffer - drawBox transparent borders obey scissor independently of trackers" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var links = link.LinkPool.init(std.testing.allocator);
    defer links.deinit();
    const border_chars = [_]u32{ 0x250c, 0x2510, 0x2514, 0x2518, 0x2500, 0x2502, 0, 0, 0, 0, 0 };
    const white = ansi.rgbColor(255, 255, 255, 255);
    const blue = ansi.indexedColor(4, 0, 0, 255);
    const transparent = ansi.rgbColor(0, 0, 0, 0);
    const clips = [_][3]u32{ .{ 3, 1, 0x2500 }, .{ 3, 4, 0x2500 }, .{ 2, 2, 0x2502 }, .{ 5, 2, 0x2502 } };
    for ([_]bool{ false, true }) |wide| {
        for (clips) |clip| {
            const dst = try OptimizedBuffer.init(std.testing.allocator, 8, 6, .{ .pool = &pool, .link_pool = &links });
            defer dst.deinit();
            dst.clear(blue, null);
            if (wide) try dst.drawGrapheme("\xe7\x95\x8c", 2, 0, 5, white, blue, 0);
            try dst.pushScissorRect(@intCast(clip[0]), @intCast(clip[1]), 1, 1);
            try dst.drawBox(2, 1, 4, 4, &border_chars, .{ .top = true, .bottom = true, .left = true, .right = true }, white, transparent, white, false, null, 0, null, 0);
            for (0..5) |y| {
                for (0..8) |x| {
                    const cell = dst.get(@intCast(x), @intCast(y)).?;
                    try std.testing.expectEqual(if (x == clip[0] and y == clip[1]) clip[2] else @as(u32, ' '), cell.char);
                    try std.testing.expectEqual(blue, cell.bg);
                }
            }
        }
    }
}

test "OptimizedBuffer - drawBox transparent border foreground blends against box background" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        4,
        4,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const transparent = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 0.0);
    const panel = ansi.rgbColor(0x12, 0x34, 0x56, 255);
    buf.clear(transparent, null);

    const border_chars = [_]u32{ 0x250c, 0x2510, 0x2514, 0x2518, 0x2500, 0x2502, 0, 0, 0, 0, 0 };
    try buf.drawBox(0, 0, 4, 4, &border_chars, .{ .left = true }, transparent, panel, transparent, true, null, 0, null, 0);

    const cell = buf.get(0, 1).?;
    try std.testing.expectEqual(@as(u32, 0x2502), cell.char);
    try std.testing.expectEqual(ansi.red(panel), ansi.red(cell.fg));
    try std.testing.expectEqual(ansi.green(panel), ansi.green(cell.fg));
    try std.testing.expectEqual(ansi.blue(panel), ansi.blue(cell.fg));
    try std.testing.expectEqual(ansi.alpha(panel), ansi.alpha(cell.fg));
    try std.testing.expectEqual(ansi.red(panel), ansi.red(cell.bg));
    try std.testing.expectEqual(ansi.green(panel), ansi.green(cell.bg));
    try std.testing.expectEqual(ansi.blue(panel), ansi.blue(cell.bg));
    try std.testing.expectEqual(ansi.alpha(panel), ansi.alpha(cell.bg));
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

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);

    // Allocate first link
    const link_id1 = try local_link_pool.alloc("https://first.com");
    const attr1 = ansi.TextAttributes.setLinkId(0, link_id1);
    try buf.drawText("A", 0, 0, fg, bg, attr1);

    // Clear - should free the link
    buf.clear(bg, null);

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

    const bg_opaque = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const bg_alpha = ansi.rgbaFromFloats(0.5, 0.5, 0.5, 0.5);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);
    buf.clear(bg_opaque, null);

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

    const bg_opaque = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    const bg_alpha = ansi.rgbaFromFloats(0.5, 0.5, 0.5, 0.5);
    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);
    buf.clear(bg_opaque, null);

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
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    buf.clear(bg, null);

    // Create a 3x3 intensity buffer with varying values
    const intensities = [_]f32{
        0.0,  0.5,  1.0,
        0.25, 0.75, 0.0,
        1.0,  0.0,  0.5,
    };

    buf.drawGrayscaleBuffer(2, 1, &intensities, 3, 3, null, bg);

    const cell_0_0 = buf.get(2, 1).?;
    try std.testing.expectEqual(@as(u32, 32), cell_0_0.char);

    const cell_1_0 = buf.get(3, 1).?;
    try std.testing.expect(cell_1_0.char != 32);
    try std.testing.expect(ansi.redF(cell_1_0.fg) > 0.3);

    const cell_2_0 = buf.get(4, 1).?;
    try std.testing.expect(cell_2_0.char != 32);
    try std.testing.expect(ansi.redF(cell_2_0.fg) > 0.9);
}

test "OptimizedBuffer - drawGrayscaleBuffer negative position clipping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    buf.clear(bg, null);

    // Create a 4x4 intensity buffer
    const intensities = [_]f32{
        0.5, 0.5, 0.5, 0.5,
        0.5, 0.5, 0.5, 0.5,
        0.5, 0.5, 0.5, 0.5,
        0.5, 0.5, 0.5, 0.5,
    };

    buf.drawGrayscaleBuffer(-1, -1, &intensities, 4, 4, null, bg);

    const cell_0_0 = buf.get(0, 0).?;
    try std.testing.expect(cell_0_0.char != 32);

    const cell_2_0 = buf.get(2, 0).?;
    try std.testing.expect(cell_2_0.char != 32);
}

test "OptimizedBuffer - drawGrayscaleBuffer negative position fully clipped" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        6,
        3,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    buf.clear(bg, null);

    const intensities = [_]f32{
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
    };

    buf.drawGrayscaleBuffer(-10, -10, &intensities, 4, 4, null, bg);

    const cell = buf.get(0, 0).?;
    try std.testing.expectEqual(@as(u32, 32), cell.char);
}

test "OptimizedBuffer - drawGrayscaleBuffer respects scissor rect" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    buf.clear(bg, null);

    try buf.pushScissorRect(0, 0, 2, 2);

    const intensities = [_]f32{
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
    };

    buf.drawGrayscaleBuffer(0, 0, &intensities, 4, 4, null, bg);

    const cell_0_0 = buf.get(0, 0).?;
    const cell_1_1 = buf.get(1, 1).?;
    try std.testing.expect(cell_0_0.char != 32);
    try std.testing.expect(cell_1_1.char != 32);

    const cell_3_3 = buf.get(3, 3).?;
    try std.testing.expectEqual(@as(u32, 32), cell_3_3.char);

    buf.popScissorRect();
}

test "OptimizedBuffer - drawGrayscaleBuffer intensity to character mapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    buf.clear(bg, null);

    const intensities = [_]f32{
        0.005,
        0.02,
        0.5,
        1.0,
    };

    buf.drawGrayscaleBuffer(0, 0, &intensities, 4, 1, null, bg);

    const cell_0 = buf.get(0, 0).?;
    try std.testing.expectEqual(@as(u32, 32), cell_0.char);

    const cell_1 = buf.get(1, 0).?;
    try std.testing.expect(cell_1.char != 32);

    const cell_3 = buf.get(3, 0).?;
    try std.testing.expect(ansi.redF(cell_3.fg) > 0.9);
    try std.testing.expect(ansi.greenF(cell_3.fg) > 0.9);
    try std.testing.expect(ansi.blueF(cell_3.fg) > 0.9);
}

test "OptimizedBuffer - drawGrayscaleBuffer alpha blending preserves underlying bg" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const red_bg = ansi.rgbaFromFloats(1.0, 0.0, 0.0, 1.0);
    buf.clear(red_bg, null);

    const initial_cell = buf.get(1, 1).?;
    try std.testing.expectEqual(@as(u8, 255), ansi.red(initial_cell.bg));
    try std.testing.expectEqual(@as(u8, 0), ansi.green(initial_cell.bg));
    try std.testing.expectEqual(@as(u8, 0), ansi.blue(initial_cell.bg));

    const semi_transparent_bg = ansi.rgbaFromFloats(0.0, 0.0, 1.0, 0.5);
    const intensities = [_]f32{
        1.0, 1.0, 1.0,
        1.0, 1.0, 1.0,
        1.0, 1.0, 1.0,
    };

    buf.drawGrayscaleBuffer(0, 0, &intensities, 3, 3, null, semi_transparent_bg);

    const cell = buf.get(1, 1).?;
    try std.testing.expect(ansi.redF(cell.bg) > 0.1);
    try std.testing.expect(ansi.blueF(cell.bg) > 0.1);

    try std.testing.expect(ansi.redF(cell.fg) > 0.9);
    try std.testing.expect(ansi.greenF(cell.fg) > 0.9);
    try std.testing.expect(ansi.blueF(cell.fg) > 0.9);
}

test "OptimizedBuffer - drawGrayscaleBuffer fully transparent bg preserves underlying" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const green_bg = ansi.rgbaFromFloats(0.0, 1.0, 0.0, 1.0);
    buf.clear(green_bg, null);

    const transparent_bg = ansi.rgbaFromFloats(0.0, 0.0, 1.0, 0.0);
    const intensities = [_]f32{
        1.0, 1.0, 1.0,
        1.0, 1.0, 1.0,
        1.0, 1.0, 1.0,
    };

    buf.drawGrayscaleBuffer(0, 0, &intensities, 3, 3, null, transparent_bg);

    const cell = buf.get(1, 1).?;
    try std.testing.expectEqual(@as(u8, 0), ansi.red(cell.bg));
    try std.testing.expectEqual(@as(u8, 255), ansi.green(cell.bg));
    try std.testing.expectEqual(@as(u8, 0), ansi.blue(cell.bg));

    try std.testing.expect(ansi.redF(cell.fg) > 0.9);
}

test "OptimizedBuffer - drawGrayscaleBuffer opaque bg overwrites underlying" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const red_bg = ansi.rgbaFromFloats(1.0, 0.0, 0.0, 1.0);
    buf.clear(red_bg, null);

    const blue_bg = ansi.rgbaFromFloats(0.0, 0.0, 1.0, 1.0);
    const intensities = [_]f32{
        1.0, 1.0, 1.0,
        1.0, 1.0, 1.0,
        1.0, 1.0, 1.0,
    };

    buf.drawGrayscaleBuffer(0, 0, &intensities, 3, 3, null, blue_bg);

    const cell = buf.get(1, 1).?;
    try std.testing.expectEqual(@as(u8, 0), ansi.red(cell.bg));
    try std.testing.expectEqual(@as(u8, 0), ansi.green(cell.bg));
    try std.testing.expectEqual(@as(u8, 255), ansi.blue(cell.bg));
}

test "OptimizedBuffer - drawGrayscaleBuffer with opacity stack" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const red_bg = ansi.rgbaFromFloats(1.0, 0.0, 0.0, 1.0);
    buf.clear(red_bg, null);

    try buf.pushOpacity(0.5);

    const blue_bg = ansi.rgbaFromFloats(0.0, 0.0, 1.0, 1.0);
    const intensities = [_]f32{
        1.0, 1.0, 1.0,
        1.0, 1.0, 1.0,
        1.0, 1.0, 1.0,
    };

    buf.drawGrayscaleBuffer(0, 0, &intensities, 3, 3, null, blue_bg);

    buf.popOpacity();

    const cell = buf.get(1, 1).?;
    try std.testing.expect(ansi.redF(cell.bg) > 0.1);
    try std.testing.expect(ansi.blueF(cell.bg) > 0.1);
}

test "OptimizedBuffer - drawGrayscaleBufferSupersampled alpha blending" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const red_bg = ansi.rgbaFromFloats(1.0, 0.0, 0.0, 1.0);
    buf.clear(red_bg, null);

    const intensities = [_]f32{
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
    };

    const semi_transparent_bg = ansi.rgbaFromFloats(0.0, 0.0, 1.0, 0.5);
    buf.drawGrayscaleBufferSupersampled(0, 0, &intensities, 4, 4, null, semi_transparent_bg);

    const cell = buf.get(0, 0).?;
    try std.testing.expect(ansi.redF(cell.bg) > 0.1);
    try std.testing.expect(ansi.blueF(cell.bg) > 0.1);
}

test "OptimizedBuffer - drawGrayscaleBufferSupersampled fully transparent preserves bg" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const green_bg = ansi.rgbaFromFloats(0.0, 1.0, 0.0, 1.0);
    buf.clear(green_bg, null);

    const intensities = [_]f32{
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
    };

    const transparent_bg = ansi.rgbaFromFloats(0.0, 0.0, 1.0, 0.0);
    buf.drawGrayscaleBufferSupersampled(0, 0, &intensities, 4, 4, null, transparent_bg);

    const cell = buf.get(0, 0).?;
    try std.testing.expectEqual(@as(u8, 0), ansi.red(cell.bg));
    try std.testing.expectEqual(@as(u8, 255), ansi.green(cell.bg));
    try std.testing.expectEqual(@as(u8, 0), ansi.blue(cell.bg));
}

test "OptimizedBuffer - drawGrayscaleBufferSupersampled respects scissor" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        6,
        4,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    buf.clear(bg, null);

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
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const red_bg = ansi.rgbaFromFloats(1.0, 0.0, 0.0, 1.0);
    buf.clear(red_bg, null);

    try buf.pushOpacity(0.5);

    const intensities = [_]f32{
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
    };

    const blue_bg = ansi.rgbaFromFloats(0.0, 0.0, 1.0, 1.0);
    buf.drawGrayscaleBufferSupersampled(0, 0, &intensities, 4, 4, null, blue_bg);

    buf.popOpacity();

    const cell = buf.get(0, 0).?;
    try std.testing.expect(ansi.redF(cell.bg) > 0.1);
    try std.testing.expect(ansi.blueF(cell.bg) > 0.1);
}

test "OptimizedBuffer - blendColors with transparent destination" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        2,
        2,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const transparent_bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 0.0);
    buf.clear(transparent_bg, null);

    const semi_white = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 0.5);
    const transparent_fg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 0.0);
    buf.setCellWithAlphaBlending(0, 0, 'X', semi_white, transparent_fg, 0);

    const cell = buf.get(0, 0).?;
    try std.testing.expectEqual(@as(u8, 255), ansi.red(cell.fg));
    try std.testing.expectEqual(@as(u8, 255), ansi.green(cell.fg));
    try std.testing.expectEqual(@as(u8, 255), ansi.blue(cell.fg));
    try std.testing.expectEqual(@as(u8, 128), ansi.alpha(cell.fg));
}

test "OptimizedBuffer - blend backdrop flattens transparent destination" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        2,
        2,
        .{ .pool = pool, .id = "test-buffer", .blendBackdropColor = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0) },
    );
    defer buf.deinit();

    const transparent_bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 0.0);
    buf.clear(transparent_bg, null);

    const opaque_fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);
    const semi_black_bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 0.5);
    buf.setCellWithAlphaBlending(0, 0, buffer_mod.DEFAULT_SPACE_CHAR, opaque_fg, semi_black_bg, 0);

    const cell = buf.get(0, 0).?;
    try std.testing.expectEqual(@as(u8, 127), ansi.red(cell.bg));
    try std.testing.expectEqual(@as(u8, 127), ansi.green(cell.bg));
    try std.testing.expectEqual(@as(u8, 127), ansi.blue(cell.bg));
    try std.testing.expectEqual(@as(u8, 255), ansi.alpha(cell.bg));
}

test "OptimizedBuffer - drawGrayscaleBuffer with custom fg color" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const black_bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    buf.clear(black_bg, null);

    const intensities = [_]f32{
        1.0, 1.0, 1.0,
        1.0, 1.0, 1.0,
        1.0, 1.0, 1.0,
    };

    const red_fg = ansi.rgbaFromFloats(1.0, 0.0, 0.0, 1.0);
    buf.drawGrayscaleBuffer(0, 0, &intensities, 3, 3, red_fg, black_bg);

    const cell = buf.get(1, 1).?;
    try std.testing.expect(ansi.redF(cell.fg) > 0.9);
    try std.testing.expect(ansi.greenF(cell.fg) < 0.1);
    try std.testing.expect(ansi.blueF(cell.fg) < 0.1);
}

test "OptimizedBuffer - drawGrayscaleBuffer custom fg with partial intensity" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const blue_bg = ansi.rgbaFromFloats(0.0, 0.0, 1.0, 1.0);
    buf.clear(blue_bg, null);

    const intensities = [_]f32{
        0.5, 0.5, 0.5,
        0.5, 0.5, 0.5,
        0.5, 0.5, 0.5,
    };

    const green_fg = ansi.rgbaFromFloats(0.0, 1.0, 0.0, 1.0);
    const transparent_bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 0.0);
    buf.drawGrayscaleBuffer(0, 0, &intensities, 3, 3, green_fg, transparent_bg);

    const cell = buf.get(1, 1).?;
    try std.testing.expect(ansi.greenF(cell.fg) > 0.2);
    try std.testing.expect(ansi.blueF(cell.fg) > 0.2);
}

test "OptimizedBuffer - drawGrayscaleBufferSupersampled with custom fg color" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(
        std.testing.allocator,
        10,
        5,
        .{ .pool = pool, .id = "test-buffer" },
    );
    defer buf.deinit();

    const black_bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);
    buf.clear(black_bg, null);

    const intensities = [_]f32{
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
    };

    const cyan_fg = ansi.rgbaFromFloats(0.0, 1.0, 1.0, 1.0);
    buf.drawGrayscaleBufferSupersampled(0, 0, &intensities, 4, 4, cyan_fg, black_bg);

    const cell = buf.get(0, 0).?;
    try std.testing.expect(ansi.redF(cell.fg) < 0.1);
    try std.testing.expect(ansi.greenF(cell.fg) > 0.9);
    try std.testing.expect(ansi.blueF(cell.fg) > 0.9);
}

// Overwriting a grapheme cell with the same ID but different extent bits must
// not free the pool slot (which would allow reuse and generation bump).
test "buffer - set same grapheme ID with different extents keeps slot alive" {
    var local_pool = gp.GraphemePool.initWithOptions(std.testing.allocator, .{
        .slots_per_page = .{ 1, 1, 1, 1, 1 },
    });
    defer local_pool.deinit();

    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var buf = try OptimizedBuffer.init(std.testing.allocator, 10, 2, .{
        .pool = &local_pool,
        .link_pool = &local_link_pool,
        .width_method = .unicode,
    });
    defer buf.deinit();

    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);
    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);

    const emoji = "👋";

    const gid = local_pool.alloc(emoji) catch @panic("alloc failed");
    const packed_w2 = gp.packGraphemeStart(gid & gp.GRAPHEME_ID_MASK, 2);
    buf.set(0, 0, .{ .char = packed_w2, .fg = fg, .bg = bg, .attributes = 0 });

    const id_from_char = gp.graphemeIdFromChar(packed_w2);
    try std.testing.expect(buf.grapheme_tracker.contains(id_from_char));

    // Same grapheme ID, different width → different packed char
    const packed_w1 = gp.packGraphemeStart(gid & gp.GRAPHEME_ID_MASK, 1);
    buf.set(0, 0, .{ .char = packed_w1, .fg = fg, .bg = bg, .attributes = 0 });

    try std.testing.expect(buf.grapheme_tracker.contains(id_from_char));

    const bytes = local_pool.get(gid) catch @panic("get failed - slot was freed");
    try std.testing.expectEqualSlices(u8, emoji, bytes);
}

// Exercises grapheme pool slot reuse across multiple render frames with
// alternating dialog/form content to stress the alloc→set→render cycle.
test "renderer - grapheme WrongGeneration repro with pool slot reuse" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var test_renderer = try TestRenderer.create(
        std.testing.allocator,
        40,
        5,
        pool,
    );
    defer test_renderer.deinit();
    const cli_renderer = test_renderer.renderer;

    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);
    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);

    {
        const next = cli_renderer.getNextBuffer();
        try next.drawText("╭────────────────────────────────────╮", 0, 0, fg, bg, 0);
        try next.drawText("│ ◇ Select Files                    │", 0, 1, fg, bg, 0);
        try next.drawText("│ ▫ src/    ▪ file.ts                │", 0, 2, fg, bg, 0);
        try next.drawText("│ ↑↓ navigate  ⏎ select  esc close   │", 0, 3, fg, bg, 0);
        try next.drawText("╰────────────────────────────────────╯", 0, 4, fg, bg, 0);
        _ = cli_renderer.render(false);
    }

    {
        const next = cli_renderer.getNextBuffer();
        try next.drawText("  Your Name                              ", 0, 0, fg, bg, 0);
        try next.drawText("  John Doe                               ", 0, 1, fg, bg, 0);
        try next.drawText("                                         ", 0, 2, fg, bg, 0);
        try next.drawText("  Select Files                           ", 0, 3, fg, bg, 0);
        try next.drawText("  Enter file path...                     ", 0, 4, fg, bg, 0);
        _ = cli_renderer.render(false);
    }

    {
        const next = cli_renderer.getNextBuffer();
        try next.drawText("╭────────────────────────────────────╮", 0, 0, fg, bg, 0);
        try next.drawText("│ ◇ Select Files                    │", 0, 1, fg, bg, 0);
        try next.drawText("│ ▫ src/    ▪ file.ts                │", 0, 2, fg, bg, 0);
        try next.drawText("│ ↑↓ navigate  ⏎ select  esc close   │", 0, 3, fg, bg, 0);
        try next.drawText("╰────────────────────────────────────╯", 0, 4, fg, bg, 0);
        _ = cli_renderer.render(false);
    }

    {
        const next = cli_renderer.getNextBuffer();
        try next.drawText("  Your Name                              ", 0, 0, fg, bg, 0);
        try next.drawText("  John Doe                               ", 0, 1, fg, bg, 0);
        try next.drawText("                                         ", 0, 2, fg, bg, 0);
        try next.drawText("  Select Files                           ", 0, 3, fg, bg, 0);
        try next.drawText("  Enter file path...                     ", 0, 4, fg, bg, 0);
        _ = cli_renderer.render(false);
    }

    {
        const next = cli_renderer.getNextBuffer();
        try next.drawText("╭────────────────────────────────────╮", 0, 0, fg, bg, 0);
        try next.drawText("│ Filter: s                          │", 0, 1, fg, bg, 0);
        try next.drawText("│ ▫ src/                             │", 0, 2, fg, bg, 0);
        try next.drawText("│ ↑↓ navigate  ⏎/tab select          │", 0, 3, fg, bg, 0);
        try next.drawText("╰────────────────────────────────────╯", 0, 4, fg, bg, 0);
        _ = cli_renderer.render(false);
    }
}

// Issue #723: CJK grapheme continuation cells are destroyed when graphemes
// shift left (e.g. after backspace). The renderer's diff loop calls
// currentRenderBuffer.set() left-to-right, and set()'s span cleanup at
// position N+2 destroys the continuation cell at N+1 that was just written
// by set() at position N, because both share the same stable grapheme pool ID.
test "renderer - CJK graphemes shifting left must preserve continuation cells (#723)" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();

    var test_renderer = try TestRenderer.create(
        std.testing.allocator,
        20,
        1,
        pool,
    );
    defer test_renderer.deinit();
    const cli_renderer = test_renderer.renderer;

    const fg = ansi.rgbaFromFloats(1.0, 1.0, 1.0, 1.0);
    const bg = ansi.rgbaFromFloats(0.0, 0.0, 0.0, 1.0);

    // Frame 1: "abcd你好世" — CJK chars start at column 4
    // Layout: a(0) b(1) c(2) d(3) 你(4,5) 好(6,7) 世(8,9) spaces(10..19)
    {
        const next = cli_renderer.getNextBuffer();
        try next.drawText("abcd你好世          ", 0, 0, fg, bg, 0);
        _ = cli_renderer.render(false);
    }

    // Frame 2: "abc你好世" — backspace deleted 'd', CJK chars shift left by 1
    // Layout: a(0) b(1) c(2) 你(3,4) 好(5,6) 世(7,8) spaces(9..19)
    {
        const next = cli_renderer.getNextBuffer();
        try next.drawText("abc你好世           ", 0, 0, fg, bg, 0);
        _ = cli_renderer.render(false);
    }

    // After frame 2, currentRenderBuffer should match the frame 2 layout exactly.
    // The bug: span cleanup in set() destroys continuation cells (positions 4, 6, 8)
    // leaving spaces instead of proper continuation chars.
    const current = cli_renderer.getCurrentBuffer();

    // Check that position 3 is a grapheme start (你)
    const cell3 = current.get(3, 0).?;
    try std.testing.expect(gp.isGraphemeChar(cell3.char));
    try std.testing.expectEqual(@as(u32, 1), gp.charRightExtent(cell3.char));

    // Check that position 4 is a continuation cell for the same grapheme (你)
    const cell4 = current.get(4, 0).?;
    try std.testing.expect(gp.isContinuationChar(cell4.char));
    const id3 = gp.graphemeIdFromChar(cell3.char);
    const id4 = gp.graphemeIdFromChar(cell4.char);
    try std.testing.expectEqual(id3, id4);

    // Check that position 5 is a grapheme start (好)
    const cell5 = current.get(5, 0).?;
    try std.testing.expect(gp.isGraphemeChar(cell5.char));

    // Check that position 6 is a continuation cell for the same grapheme (好)
    const cell6 = current.get(6, 0).?;
    try std.testing.expect(gp.isContinuationChar(cell6.char));
    const id5 = gp.graphemeIdFromChar(cell5.char);
    const id6 = gp.graphemeIdFromChar(cell6.char);
    try std.testing.expectEqual(id5, id6);

    // Check that position 7 is a grapheme start (世)
    const cell7 = current.get(7, 0).?;
    try std.testing.expect(gp.isGraphemeChar(cell7.char));

    // Check that position 8 is a continuation cell for the same grapheme (世)
    const cell8 = current.get(8, 0).?;
    try std.testing.expect(gp.isContinuationChar(cell8.char));
    const id7 = gp.graphemeIdFromChar(cell7.char);
    const id8 = gp.graphemeIdFromChar(cell8.char);
    try std.testing.expectEqual(id7, id8);
}

test "OptimizedBuffer merges frame buffer placements with clipping scissor and opacity" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const source_buffer = try OptimizedBuffer.init(std.testing.allocator, 6, 4, .{ .pool = &pool, .link_pool = &link_pool });
    defer source_buffer.deinit();
    const target = try OptimizedBuffer.init(std.testing.allocator, 4, 4, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();

    const wide = try image.createFromRgba(std.testing.allocator, &([_]u8{ 10, 20, 30, 255 } ** 32), 8, 4, 32);
    defer wide.deinit();
    const dot = try image.createFromRgba(std.testing.allocator, &[_]u8{ 1, 2, 3, 255 }, 1, 1, 4);
    defer dot.deinit();

    // Placement A covers cells (1,1)-(4,2) of the frame buffer; placement B
    // sits at (5,3) and will fall entirely outside the destination clip.
    try std.testing.expect(try source_buffer.drawImage(wide, 41, 1, 1, 4, 2, 8, 4, 0, 0, 8, 4, .auto));
    try std.testing.expect(try source_buffer.drawImage(dot, 42, 5, 3, 1, 1, 1, 1, 0, 0, 1, 1, .auto));

    // The target already owns a direct placement, so merged ids must shift.
    try std.testing.expect(try target.drawImage(dot, 43, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, .auto));

    try target.pushScissorRect(0, 0, 4, 2);
    try target.pushOpacity(0.5);
    target.drawFrameBuffer(2, 0, source_buffer, null, null, null, null);
    target.popOpacity();
    target.popScissorRect();

    try std.testing.expectEqual(@as(usize, 2), target.image_placements.items.len);
    const direct = target.image_placements.items[0];
    try std.testing.expectEqual(@as(u32, 1), direct.placement_id);
    try std.testing.expectEqual(@as(u32, 43), direct.image_handle);

    const merged = target.image_placements.items[1];
    try std.testing.expectEqual(@as(u32, 2), merged.placement_id);
    try std.testing.expectEqual(@as(u32, 41), merged.image_handle);
    try std.testing.expectEqual(@as(i32, 3), merged.x);
    try std.testing.expectEqual(@as(i32, 1), merged.y);
    try std.testing.expectEqual(@as(u32, 1), merged.width);
    try std.testing.expectEqual(@as(u32, 1), merged.height);
    try std.testing.expectEqual(@as(u32, 2), merged.pixel_width);
    try std.testing.expectEqual(@as(u32, 2), merged.pixel_height);
    try std.testing.expectEqual(@as(u32, 0), merged.source_x);
    try std.testing.expectEqual(@as(u32, 0), merged.source_y);
    try std.testing.expectEqual(@as(u32, 2), merged.source_width);
    try std.testing.expectEqual(@as(u32, 2), merged.source_height);
    try std.testing.expectEqual(@as(u8, 128), merged.opacity);

    // Cells: the direct placement keeps id 1, the merged visible cell maps to
    // id 2, and cells outside the scissor were not copied.
    try std.testing.expectEqual(@as(u32, 1), gp.imageIdFromChar(target.get(0, 0).?.char));
    try std.testing.expectEqual(@as(u32, 2), gp.imageIdFromChar(target.get(3, 1).?.char));
    try std.testing.expect(!gp.isImageChar(target.get(3, 2).?.char));

    // Placement B was clipped away entirely.
    for (target.image_placements.items) |placement| {
        try std.testing.expect(placement.image_handle != 42);
    }
}

test "OptimizedBuffer frame buffer merge multiplies nested placement opacity" {
    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const source_buffer = try OptimizedBuffer.init(std.testing.allocator, 2, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer source_buffer.deinit();
    const target = try OptimizedBuffer.init(std.testing.allocator, 2, 1, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();
    const dot = try image.createFromRgba(std.testing.allocator, &[_]u8{ 1, 2, 3, 255 }, 1, 1, 4);
    defer dot.deinit();

    try source_buffer.pushOpacity(0.5);
    try std.testing.expect(try source_buffer.drawImage(dot, 44, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, .auto));
    source_buffer.popOpacity();
    try std.testing.expectEqual(@as(u8, 128), source_buffer.image_placements.items[0].opacity);

    try target.pushOpacity(0.5);
    target.drawFrameBuffer(0, 0, source_buffer, null, null, null, null);
    target.popOpacity();
    try std.testing.expectEqual(@as(usize, 1), target.image_placements.items.len);
    // 0.5 * 0.5 = 0.25 -> 64 of 255.
    try std.testing.expect(@abs(@as(i16, target.image_placements.items[0].opacity) - 64) <= 1);
}
