const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const TextAnnotations = @import("../text-annotations.zig").TextAnnotations;

pub const benchName = "TextAnnotations Ownership";

const iterations: usize = 10;

fn addResult(
    results: *std.ArrayList(bench_utils.BenchResult),
    allocator: std.mem.Allocator,
    name: []const u8,
    stats: bench_utils.BenchStats,
) !void {
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

const Counter = struct {
    count: usize = 0,

    fn visit(self: *Counter, annotation: TextAnnotations.Annotation) !void {
        self.count +%= annotation.payload.style_id +% 1;
    }
};

pub fn run(
    io: std.Io,
    allocator: std.mem.Allocator,
    show_mem: bool,
    bench_filter: ?[]const u8,
) ![]bench_utils.BenchResult {
    _ = show_mem;
    var results: std.ArrayList(bench_utils.BenchResult) = .empty;
    errdefer results.deinit(allocator);

    {
        const name = "overlap precedence: 2k queries across 50k payloads";
        if (bench_utils.matchesBenchFilter(name, bench_filter)) {
            var stats: bench_utils.BenchStats = .{};
            for (0..iterations) |iteration| {
                var annotations = TextAnnotations.initWithSeed(allocator, 0x7100 + iteration);
                defer annotations.deinit();
                for (0..50_000) |index| {
                    const start: u32 = @intCast(index * 8);
                    _ = try annotations.addRange(.{ .start_byte = start, .end_byte = start + 24 }, .{
                        .namespace = @intCast(index % 8),
                        .style_id = @intCast(index),
                        .priority = @intCast(index % 16),
                    });
                }
                try annotations.validateIntegrity();
                var counter: Counter = .{};
                for (0..100) |query| {
                    const start: u32 = @intCast((query * 397) % 390_000);
                    try annotations.visitOverlapping(start, start + 80, &counter, Counter.visit);
                }
                counter = .{};
                const timer = bench_utils.BenchTimer.start(io);
                for (0..2_000) |query| {
                    const start: u32 = @intCast((query * 397) % 390_000);
                    try annotations.visitOverlapping(start, start + 80, &counter, Counter.visit);
                }
                stats.record(timer.read());
                try annotations.validateIntegrity();
                std.mem.doNotOptimizeAway(counter.count);
            }
            try addResult(&results, allocator, name, stats);
        }
    }

    {
        const name = "policy splice: delete through 50k payloads";
        if (bench_utils.matchesBenchFilter(name, bench_filter)) {
            var stats: bench_utils.BenchStats = .{};
            for (0..iterations) |iteration| {
                var annotations = TextAnnotations.initWithSeed(allocator, 0x7200 + iteration);
                defer annotations.deinit();
                for (0..50_000) |index| {
                    const start: u32 = @intCast(index * 2);
                    _ = try annotations.addRange(.{ .start_byte = start, .end_byte = start + 20 }, .{
                        .namespace = 1,
                        .splice_policy = if (index % 3 == 0) .invalidate else .delete_when_covered,
                    });
                }
                try annotations.validateIntegrity();
                const timer = bench_utils.BenchTimer.start(io);
                try annotations.splice(20_000, 40_000, 2_000);
                stats.record(timer.read());
                try annotations.validateIntegrity();
                std.mem.doNotOptimizeAway(annotations.count());
            }
            try addResult(&results, allocator, name, stats);
        }
    }

    {
        const name = "warm policy splice: 200 replacements across 50k payloads";
        if (bench_utils.matchesBenchFilter(name, bench_filter)) {
            var stats: bench_utils.BenchStats = .{};
            for (0..iterations) |iteration| {
                var annotations = TextAnnotations.initWithSeed(allocator, 0x7300 + iteration);
                defer annotations.deinit();
                for (0..50_000) |index| {
                    const start: u32 = @intCast(index * 2);
                    _ = try annotations.addRange(.{ .start_byte = start, .end_byte = start + 20 }, .{
                        .namespace = 1,
                        .splice_policy = .retain,
                    });
                }
                for (0..20) |_| try annotations.splice(40_000, 2_000, 2_000);
                try annotations.validateIntegrity();
                const timer = bench_utils.BenchTimer.start(io);
                for (0..200) |_| try annotations.splice(40_000, 2_000, 2_000);
                stats.record(timer.read());
                try annotations.validateIntegrity();
                std.mem.doNotOptimizeAway(annotations.positionGeneration());
            }
            try addResult(&results, allocator, name, stats);
        }
    }

    return results.toOwnedSlice(allocator);
}
