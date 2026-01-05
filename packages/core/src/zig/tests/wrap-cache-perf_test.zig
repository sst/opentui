const std = @import("std");
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const gp = @import("../grapheme.zig");

const TextBuffer = text_buffer.UnifiedTextBuffer;
const TextBufferView = text_buffer_view.UnifiedTextBufferView;

// Helper to measure median time of multiple runs
fn measureMedianViewUpdate(view: *TextBufferView, width: u32, iterations: usize) u64 {
    var times: [16]u64 = undefined;
    const actual_iterations = @min(iterations, 16);

    for (0..actual_iterations) |i| {
        var timer = std.time.Timer.start() catch unreachable;
        view.setWrapWidth(width);
        _ = view.getVirtualLineCount();
        times[i] = timer.read();
    }

    // Sort and return median
    std.mem.sort(u64, times[0..actual_iterations], {}, std.sort.asc(u64));
    return times[actual_iterations / 2];
}

// Tests that word wrap has O(n) complexity for text WITHOUT word breaks.
// This was previously O(n²) due to findPosByWidth being called from the start
// of each chunk for every virtual line.
//
// We verify O(n) by checking that doubling the input size roughly doubles the time.
// For O(n²), doubling input would quadruple the time (ratio ~4).
test "word wrap complexity - O(n) for text without word breaks" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const small_size: usize = 50_000;
    const large_size: usize = 100_000; // 2x small

    // Create text WITHOUT word breaks - this triggers the fallback path
    const small_text = try std.testing.allocator.alloc(u8, small_size);
    defer std.testing.allocator.free(small_text);
    @memset(small_text, 'x');

    const large_text = try std.testing.allocator.alloc(u8, large_size);
    defer std.testing.allocator.free(large_text);
    @memset(large_text, 'x');

    // Setup small buffer
    var small_tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer small_tb.deinit();
    try small_tb.setText(small_text);

    var small_view = try TextBufferView.init(std.testing.allocator, small_tb);
    defer small_view.deinit();
    small_view.setWrapMode(.word);
    small_view.setWrapWidth(80);

    // Setup large buffer
    var large_tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer large_tb.deinit();
    try large_tb.setText(large_text);

    var large_view = try TextBufferView.init(std.testing.allocator, large_tb);
    defer large_view.deinit();
    large_view.setWrapMode(.word);
    large_view.setWrapWidth(80);

    // Warm up - populate caches
    _ = small_view.getVirtualLineCount();
    _ = large_view.getVirtualLineCount();

    // Measure with median of 5 runs
    const small_time = measureMedianViewUpdate(small_view, 81, 5);
    const large_time = measureMedianViewUpdate(large_view, 81, 5);

    // Calculate ratio
    const ratio = @as(f64, @floatFromInt(large_time)) / @as(f64, @floatFromInt(small_time));
    const input_ratio: f64 = @as(f64, @floatFromInt(large_size)) / @as(f64, @floatFromInt(small_size)); // 2.0

    std.debug.print("\nComplexity test (no word breaks):\n", .{});
    std.debug.print("  Small ({} bytes): {}ms\n", .{ small_size, small_time / 1_000_000 });
    std.debug.print("  Large ({} bytes): {}ms\n", .{ large_size, large_time / 1_000_000 });
    std.debug.print("  Time ratio: {d:.2} (input ratio: {d:.1})\n", .{ ratio, input_ratio });

    // For O(n): ratio should be ~2 when input doubles
    // For O(n²): ratio would be ~4
    // Allow 50% variance: ratio should be < input_ratio * 1.5 = 3.0
    try std.testing.expect(ratio < input_ratio * 1.5);
}

// Tests that word wrap has O(n) complexity for text WITH word breaks.
test "word wrap complexity - O(n) for text with word breaks" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const small_size: usize = 50_000;
    const large_size: usize = 100_000;

    // Create text WITH word breaks (spaces every 10 chars)
    const small_text = try std.testing.allocator.alloc(u8, small_size);
    defer std.testing.allocator.free(small_text);
    for (small_text, 0..) |*c, i| {
        c.* = if (i % 11 == 10) ' ' else 'x';
    }

    const large_text = try std.testing.allocator.alloc(u8, large_size);
    defer std.testing.allocator.free(large_text);
    for (large_text, 0..) |*c, i| {
        c.* = if (i % 11 == 10) ' ' else 'x';
    }

    var small_tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer small_tb.deinit();
    try small_tb.setText(small_text);

    var small_view = try TextBufferView.init(std.testing.allocator, small_tb);
    defer small_view.deinit();
    small_view.setWrapMode(.word);
    small_view.setWrapWidth(80);

    var large_tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer large_tb.deinit();
    try large_tb.setText(large_text);

    var large_view = try TextBufferView.init(std.testing.allocator, large_tb);
    defer large_view.deinit();
    large_view.setWrapMode(.word);
    large_view.setWrapWidth(80);

    // Warm up
    _ = small_view.getVirtualLineCount();
    _ = large_view.getVirtualLineCount();

    const small_time = measureMedianViewUpdate(small_view, 81, 5);
    const large_time = measureMedianViewUpdate(large_view, 81, 5);

    const ratio = @as(f64, @floatFromInt(large_time)) / @as(f64, @floatFromInt(small_time));
    const input_ratio: f64 = @as(f64, @floatFromInt(large_size)) / @as(f64, @floatFromInt(small_size));

    std.debug.print("\nComplexity test (with word breaks):\n", .{});
    std.debug.print("  Small ({} bytes): {}ms\n", .{ small_size, small_time / 1_000_000 });
    std.debug.print("  Large ({} bytes): {}ms\n", .{ large_size, large_time / 1_000_000 });
    std.debug.print("  Time ratio: {d:.2} (input ratio: {d:.1})\n", .{ ratio, input_ratio });

    try std.testing.expect(ratio < input_ratio * 1.5);
}

// Tests that wrap width changes scale linearly with text size, not quadratically.
test "word wrap complexity - width changes are O(n)" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const size: usize = 100_000;

    // Text without word breaks
    const text = try std.testing.allocator.alloc(u8, size);
    defer std.testing.allocator.free(text);
    @memset(text, 'x');

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer tb.deinit();
    try tb.setText(text);

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();
    view.setWrapMode(.word);

    // Measure time for multiple width changes
    const widths = [_]u32{ 60, 70, 80, 90, 100 };
    var times: [widths.len]u64 = undefined;

    // Warm up
    view.setWrapWidth(widths[0]);
    _ = view.getVirtualLineCount();

    for (widths, 0..) |width, i| {
        times[i] = measureMedianViewUpdate(&view, width, 3);
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

// Tests that virtual line counts are correct and consistent.
test "word wrap - virtual line count correctness" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    // Test with a known pattern
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

    // Test different widths
    view.setWrapWidth(80);
    const count_80 = view.getVirtualLineCount();

    view.setWrapWidth(100);
    const count_100 = view.getVirtualLineCount();

    view.setWrapWidth(60);
    const count_60 = view.getVirtualLineCount();

    view.setWrapWidth(80);
    const count_80_again = view.getVirtualLineCount();

    // Verify relationships
    try std.testing.expect(count_80 > 100); // Should have reasonable number of lines
    try std.testing.expectEqual(count_80, count_80_again); // Same width = same count
    try std.testing.expect(count_100 < count_80); // Wider = fewer lines
    try std.testing.expect(count_60 > count_80); // Narrower = more lines
}
