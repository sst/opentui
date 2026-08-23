const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const EditBuffer = @import("../edit-buffer.zig").EditBuffer;
const gp = @import("../grapheme.zig");
const link = @import("../link.zig");
const TextAnnotations = @import("../text-annotations.zig").TextAnnotations;
const text_buffer = @import("../text-buffer.zig");

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

    const pool = gp.initGlobalPool(allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(allocator);
    defer link.deinitGlobalLinkPool();

    {
        const name = "10k edit annotations: setup";
        if (bench_utils.matchesBenchFilter(name, bench_filter)) {
            var stats: bench_utils.BenchStats = .{};
            for (0..iterations) |_| {
                const eb = try EditBuffer.init(allocator, pool, link_pool, .wcwidth, null);
                defer eb.deinit();
                const text = try allocator.alloc(u8, 40_001);
                defer allocator.free(text);
                @memset(text, 'a');
                try eb.setText(text);
                const timer = bench_utils.BenchTimer.start(io);
                for (0..10_000) |index| {
                    const start: u32 = @intCast(index * 4);
                    _ = try eb.getTextBuffer().textAnnotations().addRange(.{ .start_byte = start, .end_byte = start + 2 }, .{
                        .namespace = 1,
                        .kind_flags = text_buffer.annotation_kind_virtual,
                    });
                }
                stats.record(timer.read());
            }
            try addResult(&results, allocator, name, stats);
        }
    }

    {
        const name = "10k edit annotations: local edit";
        if (bench_utils.matchesBenchFilter(name, bench_filter)) {
            var stats: bench_utils.BenchStats = .{};
            for (0..iterations) |_| {
                const eb = try EditBuffer.init(allocator, pool, link_pool, .wcwidth, null);
                defer eb.deinit();
                const text = try allocator.alloc(u8, 40_001);
                defer allocator.free(text);
                @memset(text, 'a');
                try eb.setText(text);
                for (0..10_000) |index| {
                    const start: u32 = @intCast(index * 4);
                    _ = try eb.getTextBuffer().textAnnotations().addRange(.{ .start_byte = start, .end_byte = start + 2 }, .{
                        .namespace = 1,
                        .kind_flags = text_buffer.annotation_kind_virtual,
                    });
                }
                try eb.setCursorByOffset(20_000);
                const timer = bench_utils.BenchTimer.start(io);
                try eb.insertText("X");
                stats.record(timer.read());
            }
            try addResult(&results, allocator, name, stats);
        }
    }

    const scaling_cases = [_]struct { name: []const u8, count: usize }{
        .{ .name = "history local insert: 0 distant annotations", .count = 0 },
        .{ .name = "history local insert: 100 distant annotations", .count = 100 },
        .{ .name = "history local insert: 1k distant annotations", .count = 1_000 },
        .{ .name = "history local insert: 10k distant annotations", .count = 10_000 },
        .{ .name = "history local insert: 100k distant annotations", .count = 100_000 },
    };
    for (scaling_cases) |case| {
        if (bench_utils.matchesBenchFilter(case.name, bench_filter)) {
            var stats: bench_utils.BenchStats = .{};
            for (0..iterations) |_| {
                const eb = try EditBuffer.init(allocator, pool, link_pool, .wcwidth, null);
                defer eb.deinit();
                try eb.setText("local edit");
                for (0..case.count) |index| {
                    const start: u32 = @intCast(1_000 + index * 2);
                    _ = try eb.getTextBuffer().textAnnotations().addRange(.{ .start_byte = start, .end_byte = start + 1 }, .{
                        .namespace = 1,
                        .splice_policy = .delete_when_covered,
                    });
                }
                const timer = bench_utils.BenchTimer.start(io);
                try eb.insertText("X");
                stats.record(timer.read());
            }
            try addResult(&results, allocator, case.name, stats);
        }
    }

    {
        const name = "10k edit annotations: 10k local queries";
        if (bench_utils.matchesBenchFilter(name, bench_filter)) {
            var stats: bench_utils.BenchStats = .{};
            for (0..iterations) |iteration| {
                var annotations = TextAnnotations.initWithSeed(allocator, 0x7400 + iteration);
                defer annotations.deinit();
                for (0..10_000) |index| {
                    const start: u32 = @intCast(index * 4);
                    _ = try annotations.addRange(.{ .start_byte = start, .end_byte = start + 2 }, .{
                        .namespace = 1,
                        .kind_flags = text_buffer.annotation_kind_virtual,
                    });
                }
                var total: u64 = 0;
                const timer = bench_utils.BenchTimer.start(io);
                for (0..10_000) |query| {
                    const byte: u32 = @intCast((query * 397) % 40_000);
                    if (annotations.findOverlappingKind(byte, byte + 1, text_buffer.annotation_kind_virtual)) |annotation| {
                        total +%= annotation.id();
                    }
                }
                stats.record(timer.read());
                std.mem.doNotOptimizeAway(total);
            }
            try addResult(&results, allocator, name, stats);
        }
    }

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
