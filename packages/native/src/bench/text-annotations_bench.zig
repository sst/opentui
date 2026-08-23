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
    var results: std.ArrayList(bench_utils.BenchResult) = .empty;
    errdefer results.deinit(allocator);

    const pool = gp.initGlobalPool(allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(allocator);
    defer link.deinitGlobalLinkPool();

    const clone_cases = [_]struct { name: []const u8, count: usize }{
        .{ .name = "clone: 1k annotations", .count = 1_000 },
        .{ .name = "clone: 10k annotations", .count = 10_000 },
        .{ .name = "clone: 100k annotations", .count = 100_000 },
    };
    for (clone_cases) |case| {
        if (bench_utils.matchesBenchFilter(case.name, bench_filter)) {
            var annotations = TextAnnotations.initWithSeed(allocator, 0x616e6e636c6f6e65 + case.count);
            defer annotations.deinit();
            for (0..case.count) |index| {
                const start: u32 = @intCast(index * 4);
                _ = try annotations.addRange(.{ .start_byte = start, .end_byte = start + 3 }, .{
                    .namespace = @intCast(index % 8),
                    .style_id = @intCast(index),
                    .priority = @intCast(index % 16),
                });
            }
            try annotations.splice(0, 0, 1);

            var stats: bench_utils.BenchStats = .{};
            for (0..iterations) |_| {
                const timer = bench_utils.BenchTimer.start(io);
                var clone = try annotations.clone(allocator);
                stats.record(timer.read());
                std.mem.doNotOptimizeAway(clone.count());
                clone.deinit();
            }
            const mem_stats: ?[]const bench_utils.MemStat = if (show_mem) blk: {
                var measured_allocator: std.heap.DebugAllocator(.{ .enable_memory_limit = true }) = .init;
                var clone = try annotations.clone(measured_allocator.allocator());
                const requested_bytes = measured_allocator.total_requested_bytes;
                clone.deinit();
                std.debug.assert(measured_allocator.deinit() == .ok);
                const values = try allocator.alloc(bench_utils.MemStat, 1);
                values[0] = .{ .name = "clone requested (3 allocs)", .bytes = requested_bytes };
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
                    _ = try eb.addAnnotationRange(.{ .start_byte = start, .end_byte = start + 2 }, .{
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
                    _ = try eb.addAnnotationRange(.{ .start_byte = start, .end_byte = start + 2 }, .{
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
                const text = try allocator.alloc(u8, 202_000);
                defer allocator.free(text);
                @memset(text, 'a');
                try eb.setText(text);
                for (0..case.count) |index| {
                    const start: u32 = @intCast(1_000 + index * 2);
                    _ = try eb.addAnnotationRange(.{ .start_byte = start, .end_byte = start + 1 }, .{
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

    const delete_scaling_cases = [_]struct { name: []const u8, count: usize }{
        .{ .name = "history local delete: 0 distant annotations", .count = 0 },
        .{ .name = "history local delete: 1k distant annotations", .count = 1_000 },
        .{ .name = "history local delete: 10k distant annotations", .count = 10_000 },
        .{ .name = "history local delete: 100k distant annotations", .count = 100_000 },
    };
    for (delete_scaling_cases) |case| {
        if (bench_utils.matchesBenchFilter(case.name, bench_filter)) {
            var stats: bench_utils.BenchStats = .{};
            for (0..iterations) |_| {
                const eb = try EditBuffer.init(allocator, pool, link_pool, .wcwidth, null);
                defer eb.deinit();
                const text = try allocator.alloc(u8, 202_000);
                defer allocator.free(text);
                @memset(text, 'a');
                try eb.setText(text);
                for (0..case.count) |index| {
                    const start: u32 = @intCast(1_000 + index * 2);
                    _ = try eb.addAnnotationRange(.{ .start_byte = start, .end_byte = start + 1 }, .{
                        .namespace = 1,
                        .splice_policy = .delete_when_covered,
                    });
                }
                const timer = bench_utils.BenchTimer.start(io);
                try eb.deleteRange(.{ .row = 0, .col = 0 }, .{ .row = 0, .col = 1 });
                stats.record(timer.read());
            }
            try addResult(&results, allocator, case.name, stats);
        }
    }

    {
        const name = "history delete: 50k affected annotations";
        if (bench_utils.matchesBenchFilter(name, bench_filter)) {
            var stats: bench_utils.BenchStats = .{};
            for (0..iterations) |_| {
                const eb = try EditBuffer.init(allocator, pool, link_pool, .wcwidth, null);
                defer eb.deinit();
                try eb.setText("ab");
                for (0..50_000) |_| {
                    _ = try eb.addAnnotationRange(.{ .start_byte = 0, .end_byte = 1 }, .{
                        .namespace = 1,
                        .splice_policy = .invalidate,
                    });
                }
                const timer = bench_utils.BenchTimer.start(io);
                try eb.deleteRange(.{ .row = 0, .col = 0 }, .{ .row = 0, .col = 1 });
                stats.record(timer.read());
            }
            try addResult(&results, allocator, name, stats);
        }
    }

    {
        const name = "history traversal: 100 edits undo redo";
        if (bench_utils.matchesBenchFilter(name, bench_filter)) {
            var stats: bench_utils.BenchStats = .{};
            for (0..iterations) |_| {
                const eb = try EditBuffer.init(allocator, pool, link_pool, .wcwidth, null);
                defer eb.deinit();
                try eb.setText("history");
                const timer = bench_utils.BenchTimer.start(io);
                for (0..100) |_| try eb.insertText("x");
                for (0..100) |_| _ = try eb.undo();
                for (0..100) |_| _ = try eb.redo();
                stats.record(timer.read());
            }
            try addResult(&results, allocator, name, stats);
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

    const move_cases = [_]struct { name: []const u8, distance: u32 }{
        .{ .name = "adaptive move batch: 20k marks, 100 moves, affected 6", .distance = 16 },
        .{ .name = "adaptive move batch: 20k marks, 100 moves, affected 24", .distance = 160 },
        .{ .name = "adaptive move batch: 20k marks, 100 moves, affected 204", .distance = 1_600 },
        .{ .name = "adaptive move batch: 20k marks, 100 moves, affected 2004", .distance = 16_000 },
        .{ .name = "adaptive move batch: 20k marks, 100 moves, affected 10004", .distance = 80_000 },
    };
    for (move_cases) |case| {
        if (bench_utils.matchesBenchFilter(case.name, bench_filter)) {
            var stats: bench_utils.BenchStats = .{};
            for (0..iterations) |iteration| {
                var annotations = TextAnnotations.initWithSeed(allocator, 0x7500 + iteration);
                defer annotations.deinit();
                for (0..10_000) |index| {
                    const start_byte: u32 = @intCast(index * 16);
                    _ = try annotations.addRange(.{ .start_byte = start_byte, .end_byte = start_byte + 12 }, .{ .namespace = 1 });
                    _ = try annotations.addPoint(.{ .byte = start_byte + 4 }, .{ .namespace = 1 });
                }
                var moves: [100]TextAnnotations.Move = undefined;
                const first: u32 = 40_000;
                const second = first + case.distance;
                for (&moves, 0..) |*move, index| move.* = .{
                    .target_id = 0,
                    .start_byte = if (index % 2 == 0) first else second,
                    .len = 16,
                    .destination_byte = if (index % 2 == 0) second else first,
                };
                const timer = bench_utils.BenchTimer.start(io);
                const strategy = try annotations.prepareMoveBatch(&moves);
                stats.record(timer.read());
                std.mem.doNotOptimizeAway(strategy);
                try annotations.validateIntegrity();
            }
            try addResult(&results, allocator, case.name, stats);
        }
    }

    return results.toOwnedSlice(allocator);
}
