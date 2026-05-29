const std = @import("std");
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const gp = @import("../grapheme.zig");
const link = @import("../link.zig");

const TextBuffer = text_buffer.UnifiedTextBuffer;
const TextBufferView = text_buffer_view.UnifiedTextBufferView;

fn measureWrapRebuildBatch(size: usize, width: u32, rebuild_count: usize) !u64 {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const text = try std.testing.allocator.alloc(u8, size);
    defer std.testing.allocator.free(text);
    @memset(text, 'x');

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth);
    defer tb.deinit();
    try tb.setText(text);

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();
    view.setWrapMode(.word);

    var timer = std.time.Timer.start() catch unreachable;
    for (0..rebuild_count) |_| {
        view.setWrapWidth(width + 1);
        _ = view.getVirtualLineCount();

        view.setWrapWidth(width);
        _ = view.getVirtualLineCount();
    }

    return timer.read();
}

test "word wrap complexity - width changes are O(n)" {
    const small_size: usize = 100_000;
    const large_size: usize = 1_000_000;
    const width: u32 = 80;
    const rebuild_count = 10;

    const small_ns = try measureWrapRebuildBatch(small_size, width, rebuild_count);
    const large_ns = try measureWrapRebuildBatch(large_size, width, rebuild_count);

    try std.testing.expect(small_ns > 0);
    try std.testing.expect(large_ns > 0);

    const input_ratio = @as(f64, @floatFromInt(large_size)) / @as(f64, @floatFromInt(small_size));
    const time_ratio = @as(f64, @floatFromInt(large_ns)) / @as(f64, @floatFromInt(small_ns));

    // A linear rebuild should scale near input size. The multiplier keeps the
    // assertion stable under VM/QEMU scheduling while still catching O(n^2)
    // growth, which would be about input_ratio * input_ratio here.
    try std.testing.expect(time_ratio < input_ratio * 5.0);
}

test "word wrap - virtual line count correctness" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    const pattern = "var abc=123;function foo(){return bar+baz;}if(x>0){y=z*2;}else{y=0;}";
    const size = 10_000;
    var text = try std.testing.allocator.alloc(u8, size);
    defer std.testing.allocator.free(text);

    var i: usize = 0;
    while (i < size) {
        const remaining = size - i;
        const copy_len = @min(pattern.len, remaining);
        @memcpy(text[i .. i + copy_len], pattern[0..copy_len]);
        i += copy_len;
    }

    try tb.setText(text);
    view.setWrapMode(.word);

    view.setWrapWidth(80);
    const count_80 = view.getVirtualLineCount();

    view.setWrapWidth(100);
    const count_100 = view.getVirtualLineCount();

    view.setWrapWidth(60);
    const count_60 = view.getVirtualLineCount();

    view.setWrapWidth(80);
    const count_80_again = view.getVirtualLineCount();

    try std.testing.expect(count_80 > 100);
    try std.testing.expectEqual(count_80, count_80_again);
    try std.testing.expect(count_100 < count_80);
    try std.testing.expect(count_60 > count_80);
}
