const std = @import("std");
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const gp = @import("../grapheme.zig");

const TextBuffer = text_buffer.UnifiedTextBuffer;
const TextBufferView = text_buffer_view.UnifiedTextBufferView;

test "wrap break cache - large single line performance" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer tb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, tb);
    defer view.deinit();

    // Create a large single-line string simulating minified JS
    // Using 1MB for testing to better simulate the issue
    const size = 1_000_000;
    var large_text = try std.testing.allocator.alloc(u8, size);
    defer std.testing.allocator.free(large_text);

    // Fill with pattern simulating minified JS: "var a=1;var b=2;function foo(){...}"
    // Words of varying length separated by operators and punctuation
    const pattern = "var abc=123;function foo(){return bar+baz;}if(x>0){y=z*2;}else{y=0;}";
    const pattern_len = pattern.len;
    var i: usize = 0;
    while (i < size) {
        const remaining = size - i;
        const copy_len = @min(pattern_len, remaining);
        @memcpy(large_text[i .. i + copy_len], pattern[0..copy_len]);
        i += copy_len;
    }

    try tb.setText(large_text);

    std.debug.print("\nText size: {} bytes\n", .{size});

    view.setWrapMode(.word);

    // First render - populate the cache
    std.debug.print("\n=== First render (width=80) - populating cache ===\n", .{});
    var timer = try std.time.Timer.start();
    view.setWrapWidth(80);
    const count1 = view.getVirtualLineCount();
    const first_render_ns = timer.read();
    std.debug.print("First render: {} virtual lines in {}ms\n", .{ count1, first_render_ns / 1_000_000 });

    // Second render - same width, should be instant (no-op due to dirty flag)
    std.debug.print("\n=== Second render (same width=80) - should be no-op ===\n", .{});
    timer.reset();
    const count2 = view.getVirtualLineCount();
    const second_render_ns = timer.read();
    std.debug.print("Second render: {} virtual lines in {}ms\n", .{ count2, second_render_ns / 1_000_000 });

    // Third render - different width, should reuse wrap break cache
    std.debug.print("\n=== Third render (width=100) - should reuse wrap break cache ===\n", .{});
    timer.reset();
    view.setWrapWidth(100);
    const count3 = view.getVirtualLineCount();
    const third_render_ns = timer.read();
    std.debug.print("Third render: {} virtual lines in {}ms\n", .{ count3, third_render_ns / 1_000_000 });

    // Fourth render - another width change
    std.debug.print("\n=== Fourth render (width=60) - should reuse wrap break cache ===\n", .{});
    timer.reset();
    view.setWrapWidth(60);
    const count4 = view.getVirtualLineCount();
    const fourth_render_ns = timer.read();
    std.debug.print("Fourth render: {} virtual lines in {}ms\n", .{ count4, fourth_render_ns / 1_000_000 });

    // Fifth render - back to original width
    std.debug.print("\n=== Fifth render (width=80 again) - should reuse wrap break cache ===\n", .{});
    timer.reset();
    view.setWrapWidth(80);
    const count5 = view.getVirtualLineCount();
    const fifth_render_ns = timer.read();
    std.debug.print("Fifth render: {} virtual lines in {}ms\n", .{ count5, fifth_render_ns / 1_000_000 });

    // Verify counts are reasonable
    // Note: Due to u16 chunk width limits and word wrapping behavior,
    // the actual line count may be less than size/width
    std.debug.print("Expected ~{} virtual lines at width 80 (but chunks limit this)\n", .{size / 80});
    try std.testing.expect(count1 > 100); // Should have reasonable number of virtual lines
    try std.testing.expectEqual(count1, count2); // Same width = same count
    try std.testing.expectEqual(count1, count5); // Same width = same count
    try std.testing.expect(count3 < count1); // Wider = fewer lines
    try std.testing.expect(count4 > count1); // Narrower = more lines

    // Performance assertions:
    // After first render, subsequent renders with different widths should be
    // significantly faster because wrap break cache is already populated
    std.debug.print("\n=== Performance summary ===\n", .{});
    std.debug.print("First render (cache miss): {}ms\n", .{first_render_ns / 1_000_000});
    std.debug.print("Third render (cache hit, width change): {}ms\n", .{third_render_ns / 1_000_000});
    std.debug.print("Fourth render (cache hit, width change): {}ms\n", .{fourth_render_ns / 1_000_000});
    std.debug.print("Fifth render (cache hit, width change): {}ms\n", .{fifth_render_ns / 1_000_000});

    // The third/fourth/fifth renders should be reasonably fast (< 500ms for 1MB)
    // If they're slow, the cache isn't being reused properly
    const max_cached_render_time_ns: u64 = 500_000_000; // 500ms
    try std.testing.expect(third_render_ns < max_cached_render_time_ns);
    try std.testing.expect(fourth_render_ns < max_cached_render_time_ns);
    try std.testing.expect(fifth_render_ns < max_cached_render_time_ns);
}
