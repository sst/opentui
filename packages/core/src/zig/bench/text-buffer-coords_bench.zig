const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const seg_mod = @import("../text-buffer-segment.zig");
const iter_mod = @import("../text-buffer-iterators.zig");

const BenchResult = bench_utils.BenchResult;
const BenchStats = bench_utils.BenchStats;
const Segment = seg_mod.Segment;
const TextChunk = seg_mod.TextChunk;
const UnifiedRope = seg_mod.UnifiedRope;

pub const benchName = "TextBuffer Coordinate Conversion";

/// Create a text buffer with N lines for testing
fn createTestBuffer(allocator: std.mem.Allocator, line_count: u32, chars_per_line: u32) !UnifiedRope {
    var segments: std.ArrayListUnmanaged(Segment) = .{};
    defer segments.deinit(allocator);

    for (0..line_count) |i| {
        // Add text segment
        try segments.append(allocator, Segment{
            .text = TextChunk{
                .mem_id = 0,
                .byte_start = 0,
                .byte_end = chars_per_line,
                .width = @intCast(chars_per_line),
                .flags = TextChunk.Flags.ASCII_ONLY,
            },
        });
        // Add line break (except for last line)
        if (i < line_count - 1) {
            try segments.append(allocator, Segment{ .brk = {} });
        }
    }

    return try UnifiedRope.from_slice(allocator, segments.items);
}

fn benchCoordsToOffsetCurrent(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(allocator);

    // Small buffer - 100 lines
    {
        var stats = BenchStats{};

        for (0..iterations) |_| {
            var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
            defer arena.deinit();

            var rope = try createTestBuffer(arena.allocator(), 100, 50);

            var timer = try std.time.Timer.start();
            // Access lines throughout the buffer
            for (0..100) |i| {
                const line: u32 = @intCast(i % 100);
                _ = iter_mod.coordsToOffset(&rope, line, 25);
            }
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = "[CURRENT] coordsToOffset: 100 calls, 100 lines",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Medium buffer - 1k lines
    {
        var stats = BenchStats{};

        for (0..iterations) |_| {
            var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
            defer arena.deinit();

            var rope = try createTestBuffer(arena.allocator(), 1000, 50);

            var timer = try std.time.Timer.start();
            for (0..100) |i| {
                const line: u32 = @intCast((i * 10) % 1000);
                _ = iter_mod.coordsToOffset(&rope, line, 25);
            }
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = "[CURRENT] coordsToOffset: 100 calls, 1k lines",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Large buffer - 10k lines
    {
        var stats = BenchStats{};

        for (0..iterations) |_| {
            var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
            defer arena.deinit();

            var rope = try createTestBuffer(arena.allocator(), 10000, 50);

            var timer = try std.time.Timer.start();
            for (0..100) |i| {
                const line: u32 = @intCast((i * 100) % 10000);
                _ = iter_mod.coordsToOffset(&rope, line, 25);
            }
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = "[CURRENT] coordsToOffset: 100 calls, 10k lines",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Worst case: access last line repeatedly
    {
        var stats = BenchStats{};

        for (0..iterations) |_| {
            var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
            defer arena.deinit();

            var rope = try createTestBuffer(arena.allocator(), 1000, 50);

            var timer = try std.time.Timer.start();
            for (0..100) |_| {
                _ = iter_mod.coordsToOffset(&rope, 999, 25); // Last line
            }
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = "[CURRENT] coordsToOffset: 100 calls to LAST line, 1k lines (worst case)",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return try results.toOwnedSlice(allocator);
}

fn benchOffsetToCoordsCurrent(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(allocator);

    // Small buffer
    {
        var stats = BenchStats{};

        for (0..iterations) |_| {
            var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
            defer arena.deinit();

            var rope = try createTestBuffer(arena.allocator(), 100, 50);
            const total_width = iter_mod.getTotalWidth(&rope);

            var prng = std.Random.DefaultPrng.init(42);
            const random = prng.random();

            var timer = try std.time.Timer.start();
            for (0..100) |_| {
                const offset = random.intRangeAtMost(u32, 0, total_width);
                _ = iter_mod.offsetToCoords(&rope, offset);
            }
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = "[CURRENT] offsetToCoords: 100 calls, 100 lines",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Medium buffer
    {
        var stats = BenchStats{};

        for (0..iterations) |_| {
            var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
            defer arena.deinit();

            var rope = try createTestBuffer(arena.allocator(), 1000, 50);
            const total_width = iter_mod.getTotalWidth(&rope);

            var prng = std.Random.DefaultPrng.init(42);
            const random = prng.random();

            var timer = try std.time.Timer.start();
            for (0..100) |_| {
                const offset = random.intRangeAtMost(u32, 0, total_width);
                _ = iter_mod.offsetToCoords(&rope, offset);
            }
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = "[CURRENT] offsetToCoords: 100 calls, 1k lines",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Large buffer
    {
        var stats = BenchStats{};

        for (0..iterations) |_| {
            var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
            defer arena.deinit();

            var rope = try createTestBuffer(arena.allocator(), 10000, 50);
            const total_width = iter_mod.getTotalWidth(&rope);

            var prng = std.Random.DefaultPrng.init(42);
            const random = prng.random();

            var timer = try std.time.Timer.start();
            for (0..100) |_| {
                const offset = random.intRangeAtMost(u32, 0, total_width);
                _ = iter_mod.offsetToCoords(&rope, offset);
            }
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = "[CURRENT] offsetToCoords: 100 calls, 10k lines",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return try results.toOwnedSlice(allocator);
}

fn benchGetLineCount(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(allocator);

    // getLineCount is already optimized with metrics
    {
        var stats = BenchStats{};

        for (0..iterations) |_| {
            var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
            defer arena.deinit();

            var rope = try createTestBuffer(arena.allocator(), 10000, 50);

            var timer = try std.time.Timer.start();
            for (0..100000) |_| {
                _ = iter_mod.getLineCount(&rope);
            }
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = "getLineCount: 100k calls (already O(1) via metrics)",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return try results.toOwnedSlice(allocator);
}

pub fn run(
    allocator: std.mem.Allocator,
    show_mem: bool,
) ![]BenchResult {
    _ = show_mem;

    var all_results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer all_results.deinit(allocator);

    const iterations: usize = 10;

    // Current implementation benchmarks
    const coords_results = try benchCoordsToOffsetCurrent(allocator, iterations);
    try all_results.appendSlice(allocator, coords_results);

    const offset_results = try benchOffsetToCoordsCurrent(allocator, iterations);
    try all_results.appendSlice(allocator, offset_results);

    const count_results = try benchGetLineCount(allocator, iterations);
    try all_results.appendSlice(allocator, count_results);

    return try all_results.toOwnedSlice(allocator);
}
