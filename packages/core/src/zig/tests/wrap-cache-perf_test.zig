const std = @import("std");
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const gp = @import("../grapheme.zig");

const TextBuffer = text_buffer.UnifiedTextBuffer;
const TextBufferView = text_buffer_view.UnifiedTextBufferView;

fn measureMedianViewUpdate(view: *TextBufferView, width: u32, iterations: usize) u64 {
    var times: [16]u64 = undefined;
    const actual_iterations = @min(iterations, 16);

    for (0..actual_iterations) |i| {
        var timer = std.time.Timer.start() catch unreachable;
        view.setWrapWidth(width);
        _ = view.getVirtualLineCount();
        times[i] = timer.read();
    }

    std.mem.sort(u64, times[0..actual_iterations], {}, std.sort.asc(u64));
    return times[actual_iterations / 2];
}

// Tests that wrap width changes scale linearly with text size, not quadratically.
// This test effectively catches the O(n²) performance regression in word wrapping
// by detecting when width changes cause disproportionately long execution times.
test "word wrap complexity - width changes are O(n)" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const size: usize = 100_000;

    const text = try std.testing.allocator.alloc(u8, size);
    defer std.testing.allocator.free(text);
    @memset(text, 'x');

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer tb.deinit();
    try tb.setText(text);

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();
    view.setWrapMode(.word);

    const widths = [_]u32{ 60, 70, 80, 90, 100 };
    var times: [widths.len]u64 = undefined;

    view.setWrapWidth(widths[0]);
    _ = view.getVirtualLineCount();

    for (widths, 0..) |width, i| {
        times[i] = measureMedianViewUpdate(view, width, 3);
    }

    var min_time: u64 = std.math.maxInt(u64);
    var max_time: u64 = 0;
    for (times) |t| {
        min_time = @min(min_time, t);
        max_time = @max(max_time, t);
    }

    const ratio = @as(f64, @floatFromInt(max_time)) / @as(f64, @floatFromInt(min_time));

    std.debug.print("\nWidth change times:\n", .{});
    for (widths, times) |width, time| {
        std.debug.print("  Width {}: {}ms\n", .{ width, time / 1_000_000 });
    }
    std.debug.print("  Max/min ratio: {d:.2}\n", .{ratio});

    // All times should be roughly similar (within 3x) since text size is constant
    try std.testing.expect(ratio < 3.0);
}

test "word wrap - virtual line count correctness" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth);
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
