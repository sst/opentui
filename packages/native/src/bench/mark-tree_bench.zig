const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const MarkTree = @import("../mark-tree.zig").MarkTree;

pub const benchName = "MarkTree Range Index";

pub fn run(
    io: std.Io,
    allocator: std.mem.Allocator,
    show_mem: bool,
    bench_filter: ?[]const u8,
) ![]bench_utils.BenchResult {
    _ = show_mem;
    var results: std.ArrayList(bench_utils.BenchResult) = .empty;
    errdefer results.deinit(allocator);

    const name = "10k suffix splices with 100k ranges";
    if (bench_utils.matchesBenchFilter(name, bench_filter)) {
        const iterations: usize = 5;
        var stats: bench_utils.BenchStats = .{};
        for (0..iterations) |_| {
            var tree = MarkTree.init(allocator);
            defer tree.deinit();
            var last_id: u64 = 0;
            for (0..100_000) |index| {
                const start_byte: u32 = @intCast(index * 8);
                last_id = try tree.add(.{ .start_byte = start_byte, .end_byte = start_byte + 4 });
            }

            const timer = bench_utils.BenchTimer.start(io);
            for (0..5_000) |_| {
                try tree.splice(1, 0, 1);
                try tree.splice(1, 1, 0);
            }
            stats.record(timer.read());
            std.mem.doNotOptimizeAway(tree.get(last_id));
        }

        try results.append(allocator, .{
            .name = name,
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return results.toOwnedSlice(allocator);
}
