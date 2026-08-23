const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const MarkTree = @import("../mark-tree.zig").MarkTree;

pub const benchName = "MarkTree Range Index";

const iterations: usize = 8;

fn initTree(allocator: std.mem.Allocator, seed: u64) MarkTree {
    return MarkTree.initWithSeed(allocator, seed);
}

fn addResult(results: *std.ArrayList(bench_utils.BenchResult), allocator: std.mem.Allocator, name: []const u8, stats: bench_utils.BenchStats) !void {
    try results.append(allocator, .{
        .name = name,
        .min_ns = stats.min_ns,
        .avg_ns = stats.avg(),
        .max_ns = stats.max_ns,
        .total_ns = stats.total_ns,
        .iterations = stats.count,
        .stddev_ns = stats.standardDeviation(),
        .rme_95 = stats.relativeMarginOfError95(),
        .mem_stats = null,
    });
}

fn checksumTree(tree: *MarkTree) !u64 {
    var checksum: u64 = 0;
    var iterator = tree.iterator();
    while (try iterator.next()) |mark| {
        checksum +%= mark.id();
        switch (mark) {
            .range => |range| checksum +%= range.start_byte +% range.end_byte,
            .point => |point| checksum +%= point.byte,
        }
    }
    try tree.validateIntegrity();
    return checksum;
}

const OverlapCounter = struct {
    count: usize = 0,

    fn visit(self: *OverlapCounter, _: MarkTree.Range) !void {
        self.count += 1;
    }
};

pub fn run(
    io: std.Io,
    allocator: std.mem.Allocator,
    show_mem: bool,
    bench_filter: ?[]const u8,
) ![]bench_utils.BenchResult {
    var results: std.ArrayList(bench_utils.BenchResult) = .empty;
    errdefer results.deinit(allocator);

    const clone_cases = [_]struct { name: []const u8, count: usize }{
        .{ .name = "clone: 1k ranges", .count = 1_000 },
        .{ .name = "clone: 10k ranges", .count = 10_000 },
        .{ .name = "clone: 100k ranges", .count = 100_000 },
    };
    for (clone_cases) |case| {
        if (bench_utils.matchesBenchFilter(case.name, bench_filter)) {
            var tree = initTree(allocator, 0x636c6f6e65 + case.count);
            defer tree.deinit();
            for (0..case.count) |index| {
                const start_byte: u32 = @intCast(index * 4);
                _ = try tree.addRange(.{ .start_byte = start_byte, .end_byte = start_byte + 3 });
            }
            try tree.splice(0, 0, 1);

            var stats: bench_utils.BenchStats = .{};
            for (0..iterations) |_| {
                const timer = bench_utils.BenchTimer.start(io);
                var clone = try tree.clone(allocator);
                stats.record(timer.read());
                std.mem.doNotOptimizeAway(clone.root);
                clone.deinit();
            }
            const mem_stats: ?[]const bench_utils.MemStat = if (show_mem) blk: {
                var measured_allocator: std.heap.DebugAllocator(.{ .enable_memory_limit = true }) = .init;
                var clone = try tree.clone(measured_allocator.allocator());
                const requested_bytes = measured_allocator.total_requested_bytes;
                clone.deinit();
                std.debug.assert(measured_allocator.deinit() == .ok);
                const values = try allocator.alloc(bench_utils.MemStat, 1);
                values[0] = .{ .name = "clone requested (2 allocs)", .bytes = requested_bytes };
                break :blk values;
            } else null;
            try results.append(allocator, .{
                .name = case.name,
                .min_ns = stats.min_ns,
                .avg_ns = stats.avg(),
                .max_ns = stats.max_ns,
                .total_ns = stats.total_ns,
                .iterations = stats.count,
                .stddev_ns = stats.standardDeviation(),
                .rme_95 = stats.relativeMarginOfError95(),
                .mem_stats = mem_stats,
            });
        }
    }

    {
        const name = "suffix: 10k splices with 100k ranges";
        if (bench_utils.matchesBenchFilter(name, bench_filter)) {
            var stats: bench_utils.BenchStats = .{};
            for (0..iterations) |iteration| {
                var tree = initTree(allocator, 0x1000 + iteration);
                defer tree.deinit();
                for (0..100_000) |index| {
                    const start_byte: u32 = @intCast(index * 8);
                    _ = try tree.addRange(.{ .start_byte = start_byte, .end_byte = start_byte + 4 });
                }
                const timer = bench_utils.BenchTimer.start(io);
                for (0..5_000) |_| {
                    try tree.splice(1, 0, 1);
                    try tree.splice(1, 1, 0);
                }
                stats.record(timer.read());
                std.mem.doNotOptimizeAway(try checksumTree(&tree));
            }
            try addResult(&results, allocator, name, stats);
        }
    }

    {
        const name = "affected-range: deletion report across 50k ranges";
        if (bench_utils.matchesBenchFilter(name, bench_filter)) {
            var stats: bench_utils.BenchStats = .{};
            for (0..iterations) |iteration| {
                var tree = initTree(allocator, 0x2000 + iteration);
                defer tree.deinit();
                for (0..50_000) |index| {
                    const start_byte: u32 = @intCast(index * 2);
                    _ = try tree.addRange(.{ .start_byte = start_byte, .end_byte = start_byte + 40 });
                }
                const affected = try allocator.alloc(u64, tree.count());
                defer allocator.free(affected);
                const covered = try allocator.alloc(u64, tree.count());
                defer allocator.free(covered);
                const timer = bench_utils.BenchTimer.start(io);
                const report = try tree.spliceWithReport(40_000, 10_000, 10_000, affected, covered);
                stats.record(timer.read());
                std.mem.doNotOptimizeAway(report.affected_ids.len + report.covered_range_ids.len);
                std.mem.doNotOptimizeAway(try checksumTree(&tree));
            }
            try addResult(&results, allocator, name, stats);
        }
    }

    {
        const name = "overlap: 2k queries across 100k ranges";
        if (bench_utils.matchesBenchFilter(name, bench_filter)) {
            var stats: bench_utils.BenchStats = .{};
            for (0..iterations) |iteration| {
                var tree = initTree(allocator, 0x3000 + iteration);
                defer tree.deinit();
                for (0..100_000) |index| {
                    const start_byte: u32 = @intCast(index * 8);
                    _ = try tree.addRange(.{ .start_byte = start_byte, .end_byte = start_byte + 24 });
                }
                var counter: OverlapCounter = .{};
                const timer = bench_utils.BenchTimer.start(io);
                for (0..2_000) |query| {
                    const start_byte: u32 = @intCast((query * 397) % 790_000);
                    try tree.visitOverlapping(start_byte, start_byte + 80, &counter, OverlapCounter.visit);
                }
                stats.record(timer.read());
                std.mem.doNotOptimizeAway(counter.count);
                std.mem.doNotOptimizeAway(try checksumTree(&tree));
            }
            try addResult(&results, allocator, name, stats);
        }
    }

    {
        const name = "dense crossing: 20 replacements across 50k ranges";
        if (bench_utils.matchesBenchFilter(name, bench_filter)) {
            var stats: bench_utils.BenchStats = .{};
            for (0..iterations) |iteration| {
                var tree = initTree(allocator, 0x4000 + iteration);
                defer tree.deinit();
                for (0..50_000) |index| {
                    const inset: u32 = @intCast(index % 10_000);
                    _ = try tree.addRange(.{ .start_byte = inset, .end_byte = 100_000 - inset });
                }
                const timer = bench_utils.BenchTimer.start(io);
                for (0..20) |_| try tree.splice(49_000, 2_000, 2_000);
                stats.record(timer.read());
                std.mem.doNotOptimizeAway(try checksumTree(&tree));
            }
            try addResult(&results, allocator, name, stats);
        }
    }

    {
        const name = "random edit: 2k splices with 50k ranges";
        if (bench_utils.matchesBenchFilter(name, bench_filter)) {
            const Edit = struct { start: u32, old_len: u32, new_len: u32 };
            var stats: bench_utils.BenchStats = .{};
            for (0..iterations) |iteration| {
                var tree = initTree(allocator, 0x5000 + iteration);
                defer tree.deinit();
                for (0..50_000) |index| {
                    const start_byte: u32 = @intCast(index * 8);
                    _ = try tree.addRange(.{ .start_byte = start_byte, .end_byte = start_byte + 4 });
                }
                var edits: [2_000]Edit = undefined;
                var prng = std.Random.DefaultPrng.init(0x72616e646f6d + iteration);
                const random = prng.random();
                var document_len: u32 = 400_000;
                for (&edits) |*edit| {
                    const start = random.intRangeAtMost(u32, 0, document_len);
                    const old_len = random.intRangeAtMost(u32, 0, @min(document_len - start, 12));
                    const new_len = random.intRangeAtMost(u32, 0, 12);
                    edit.* = .{ .start = start, .old_len = old_len, .new_len = new_len };
                    document_len = document_len - old_len + new_len;
                }
                const timer = bench_utils.BenchTimer.start(io);
                for (edits) |edit| try tree.splice(edit.start, edit.old_len, edit.new_len);
                stats.record(timer.read());
                std.mem.doNotOptimizeAway(try checksumTree(&tree));
            }
            try addResult(&results, allocator, name, stats);
        }
    }

    {
        const name = "move: 100 regions with 20k mixed marks";
        if (bench_utils.matchesBenchFilter(name, bench_filter)) {
            var stats: bench_utils.BenchStats = .{};
            for (0..iterations) |iteration| {
                var tree = initTree(allocator, 0x6000 + iteration);
                defer tree.deinit();
                for (0..10_000) |index| {
                    const start_byte: u32 = @intCast(index * 16);
                    _ = try tree.addRange(.{ .start_byte = start_byte, .end_byte = start_byte + 12 });
                    _ = try tree.addPoint(.{ .byte = start_byte + 4 });
                }
                const timer = bench_utils.BenchTimer.start(io);
                for (0..100) |move| {
                    const start_byte: u32 = @intCast((move * 997) % 140_000);
                    const destination_byte: u32 = @intCast((move * 1543) % 140_000);
                    try tree.moveRegion(start_byte, 2_000, destination_byte);
                }
                stats.record(timer.read());
                std.mem.doNotOptimizeAway(try checksumTree(&tree));
            }
            try addResult(&results, allocator, name, stats);
        }
    }

    const move_scaling_cases = [_]struct { name: []const u8, distance: u32 }{
        .{ .name = "move locality: 100 moves across 16 bytes with 20k marks", .distance = 16 },
        .{ .name = "move locality: 100 moves across 160 bytes with 20k marks", .distance = 160 },
        .{ .name = "move locality: 100 moves across 1.6k bytes with 20k marks", .distance = 1_600 },
        .{ .name = "move locality: 100 moves across 16k bytes with 20k marks", .distance = 16_000 },
        .{ .name = "move locality: 100 moves across 80k bytes with 20k marks", .distance = 80_000 },
    };
    for (move_scaling_cases) |case| {
        if (bench_utils.matchesBenchFilter(case.name, bench_filter)) {
            var stats: bench_utils.BenchStats = .{};
            for (0..iterations) |iteration| {
                var tree = initTree(allocator, 0x7000 + iteration);
                defer tree.deinit();
                for (0..10_000) |index| {
                    const start_byte: u32 = @intCast(index * 16);
                    _ = try tree.addRange(.{ .start_byte = start_byte, .end_byte = start_byte + 12 });
                    _ = try tree.addPoint(.{ .byte = start_byte + 4 });
                }
                const start_byte: u32 = 40_000;
                const destination_byte = start_byte + case.distance;
                const timer = bench_utils.BenchTimer.start(io);
                for (0..50) |_| {
                    try tree.moveRegion(start_byte, 16, destination_byte);
                    try tree.moveRegion(destination_byte, 16, start_byte);
                }
                stats.record(timer.read());
                std.mem.doNotOptimizeAway(try checksumTree(&tree));
            }
            try addResult(&results, allocator, case.name, stats);
        }
    }

    if (bench_utils.matchesBenchFilter("move phases: 100 regions with 20k mixed marks", bench_filter)) {
        var prepare_stats: bench_utils.BenchStats = .{};
        var commit_stats: bench_utils.BenchStats = .{};
        var release_stats: bench_utils.BenchStats = .{};
        for (0..iterations) |iteration| {
            var tree = initTree(allocator, 0x8000 + iteration);
            defer tree.deinit();
            for (0..10_000) |index| {
                const start_byte: u32 = @intCast(index * 16);
                _ = try tree.addRange(.{ .start_byte = start_byte, .end_byte = start_byte + 12 });
                _ = try tree.addPoint(.{ .byte = start_byte + 4 });
            }
            var prepare_ns: u64 = 0;
            var commit_ns: u64 = 0;
            var release_ns: u64 = 0;
            for (0..100) |move| {
                const start_byte: u32 = @intCast((move * 997) % 140_000);
                const destination_byte: u32 = @intCast((move * 1543) % 140_000);
                var timer = bench_utils.BenchTimer.start(io);
                var prepared = try tree.prepareMoveRegion(start_byte, 2_000, destination_byte);
                prepare_ns += timer.read();
                timer = bench_utils.BenchTimer.start(io);
                tree.commitPreparedMove(&prepared);
                commit_ns += timer.read();
                timer = bench_utils.BenchTimer.start(io);
                prepared.deinit();
                release_ns += timer.read();
            }
            prepare_stats.record(prepare_ns);
            commit_stats.record(commit_ns);
            release_stats.record(release_ns);
            std.mem.doNotOptimizeAway(try checksumTree(&tree));
        }
        try addResult(&results, allocator, "move phases: prepare affected IDs", prepare_stats);
        try addResult(&results, allocator, "move phases: commit reindex", commit_stats);
        try addResult(&results, allocator, "move phases: release IDs", release_stats);
    }

    return results.toOwnedSlice(allocator);
}
