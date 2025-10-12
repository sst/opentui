const std = @import("std");

// Import all benchmark modules
const text_buffer_view_bench = @import("bench/text-buffer-view_bench.zig");

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

    // Run all benchmarks
    try text_buffer_view_bench.run(allocator, show_mem);

    const stdout = std.io.getStdOut().writer();
    try stdout.print("\n=== Benchmarks complete ===\n", .{});
}
