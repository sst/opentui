const std = @import("std");
const bench_utils = @import("bench-utils.zig");

// Import all benchmark modules
const text_buffer_view_bench = @import("bench/text-buffer-view_bench.zig");
const text_buffer_unified_bench = @import("bench/text-buffer-unified_bench.zig");
const edit_buffer_bench = @import("bench/edit-buffer_bench.zig");
const rope_bench = @import("bench/rope_bench.zig");

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);

    var show_mem = false;
    for (args[1..]) |arg| {
        if (std.mem.eql(u8, arg, "--mem")) {
            show_mem = true;
        }
    }

    const stdout = std.io.getStdOut().writer();

    // Run all benchmarks
    try stdout.print("\n=== TextBufferView Wrapping Benchmarks ===\n\n", .{});
    const text_buffer_view_results = try text_buffer_view_bench.run(allocator, show_mem);
    defer allocator.free(text_buffer_view_results);
    try bench_utils.printResults(stdout, text_buffer_view_results);

    try stdout.print("\n=== UnifiedTextBuffer Benchmarks ===\n\n", .{});
    const text_buffer_unified_results = try text_buffer_unified_bench.run(allocator, show_mem);
    defer allocator.free(text_buffer_unified_results);
    try bench_utils.printResults(stdout, text_buffer_unified_results);

    try stdout.print("\n=== EditBuffer Operations Benchmarks ===\n\n", .{});
    const edit_buffer_results = try edit_buffer_bench.run(allocator, show_mem);
    defer allocator.free(edit_buffer_results);
    try bench_utils.printResults(stdout, edit_buffer_results);

    try stdout.print("\n=== Rope Data Structure Benchmarks ===\n\n", .{});
    const rope_results = try rope_bench.run(allocator, show_mem);
    defer allocator.free(rope_results);
    try bench_utils.printResults(stdout, rope_results);

    try stdout.print("\n✓ Benchmarks complete\n", .{});
}
