const std = @import("std");
const unified_tb = @import("text-buffer-unified.zig");
const unified_view = @import("text-buffer-view-unified.zig");
const gp = @import("grapheme.zig");

const UnifiedTextBuffer = unified_tb.UnifiedTextBuffer;
const UnifiedTextBufferView = unified_view.UnifiedTextBufferView;

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const pool = gp.initGlobalPool(allocator);
    defer gp.deinitGlobalPool();

    const unicode_data = gp.initGlobalUnicodeData(allocator);
    defer gp.deinitGlobalUnicodeData(allocator);
    const graphemes_ptr, const display_width_ptr = unicode_data;

    std.debug.print("Creating UnifiedTextBuffer...\n", .{});
    var tb = try UnifiedTextBuffer.init(allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    std.debug.print("Setting text...\n", .{});
    try tb.setText("Hello, world!\nSecond line\nThird line");
    std.debug.print("Text set, line count: {d}\n", .{tb.getLineCount()});

    std.debug.print("Creating UnifiedTextBufferView...\n", .{});
    var view = try UnifiedTextBufferView.init(allocator, tb);
    defer view.deinit();

    std.debug.print("Calling getVirtualLineCount...\n", .{});
    const count = view.getVirtualLineCount();
    std.debug.print("Virtual line count: {d}\n", .{count});

    std.debug.print("\n✓ Test complete\n", .{});
}
