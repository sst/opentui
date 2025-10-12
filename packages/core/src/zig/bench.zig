const std = @import("std");
const bench_utils = @import("bench-utils.zig");

// Import all benchmark modules
const text_buffer_view_bench = @import("bench/text-buffer-view_bench.zig");
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
    const text_buffer_view_results = try text_buffer_view_bench.run(allocator, show_mem);
    defer allocator.free(text_buffer_view_results);
    try bench_utils.printResults(stdout, text_buffer_view_results);

    const rope_results = try rope_bench.run(allocator, show_mem);
    defer allocator.free(rope_results);
    try bench_utils.printResults(stdout, rope_results);

    try stdout.print("\n=== Benchmarks complete ===\n", .{});
}
