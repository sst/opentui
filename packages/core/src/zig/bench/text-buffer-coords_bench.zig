const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const seg_mod = @import("../text-buffer-segment.zig");
const iter_mod = @import("../text-buffer-iterators.zig");

const BenchResult = bench_utils.BenchResult;
const Segment = seg_mod.Segment;
const TextChunk = seg_mod.TextChunk;
const UnifiedRope = seg_mod.UnifiedRope;

/// Create a text buffer with N lines for testing
fn createTestBuffer(allocator: std.mem.Allocator, line_count: u32, chars_per_line: u32) !UnifiedRope {
    var segments = std.ArrayList(Segment).init(allocator);
    defer segments.deinit();

    var i: u32 = 0;
    while (i < line_count) : (i += 1) {
        // Add text segment
        try segments.append(Segment{
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
            try segments.append(Segment{ .brk = {} });
        }
    }

    return try UnifiedRope.from_slice(allocator, segments.items);
}

fn benchCoordsToOffsetCurrent(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    // Small buffer - 100 lines
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            const rope = try createTestBuffer(arena.allocator(), 100, 50);

            var timer = try std.time.Timer.start();
            // Access lines throughout the buffer
            var i: u32 = 0;
            while (i < 100) : (i += 1) {
                const line = i % 100;
                _ = iter_mod.coordsToOffset(&rope, line, 25);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "[CURRENT] coordsToOffset: 100 calls, 100 lines", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Medium buffer - 1k lines
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            const rope = try createTestBuffer(arena.allocator(), 1000, 50);

            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 100) : (i += 1) {
                const line = (i * 10) % 1000;
                _ = iter_mod.coordsToOffset(&rope, line, 25);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "[CURRENT] coordsToOffset: 100 calls, 1k lines", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Large buffer - 10k lines
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            const rope = try createTestBuffer(arena.allocator(), 10000, 50);

            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 100) : (i += 1) {
                const line = (i * 100) % 10000;
                _ = iter_mod.coordsToOffset(&rope, line, 25);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "[CURRENT] coordsToOffset: 100 calls, 10k lines", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Worst case: access last line repeatedly
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            const rope = try createTestBuffer(arena.allocator(), 1000, 50);

            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 100) : (i += 1) {
                _ = iter_mod.coordsToOffset(&rope, 999, 25); // Last line
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "[CURRENT] coordsToOffset: 100 calls to LAST line, 1k lines (worst case)", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return try results.toOwnedSlice();
}

fn benchOffsetToCoordsCurrent(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    // Small buffer
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            const rope = try createTestBuffer(arena.allocator(), 100, 50);
            const total_width = iter_mod.getTotalWidth(&rope);

            var prng = std.Random.DefaultPrng.init(42);
            const random = prng.random();

            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 100) : (i += 1) {
                const offset = random.intRangeAtMost(u32, 0, total_width);
                _ = iter_mod.offsetToCoords(&rope, offset);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "[CURRENT] offsetToCoords: 100 calls, 100 lines", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Medium buffer
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            const rope = try createTestBuffer(arena.allocator(), 1000, 50);
            const total_width = iter_mod.getTotalWidth(&rope);

            var prng = std.Random.DefaultPrng.init(42);
            const random = prng.random();

            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 100) : (i += 1) {
                const offset = random.intRangeAtMost(u32, 0, total_width);
                _ = iter_mod.offsetToCoords(&rope, offset);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "[CURRENT] offsetToCoords: 100 calls, 1k lines", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Large buffer
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            const rope = try createTestBuffer(arena.allocator(), 10000, 50);
            const total_width = iter_mod.getTotalWidth(&rope);

            var prng = std.Random.DefaultPrng.init(42);
            const random = prng.random();

            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 100) : (i += 1) {
                const offset = random.intRangeAtMost(u32, 0, total_width);
                _ = iter_mod.offsetToCoords(&rope, offset);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "[CURRENT] offsetToCoords: 100 calls, 10k lines", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return try results.toOwnedSlice();
}

fn benchGetLineCount(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    // getLineCount is already optimized with metrics
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            const rope = try createTestBuffer(arena.allocator(), 10000, 50);

            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 100000) : (i += 1) {
                _ = iter_mod.getLineCount(&rope);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "getLineCount: 100k calls (already O(1) via metrics)", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return try results.toOwnedSlice();
}

fn benchCoordsToOffsetFast(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    // Small buffer - 100 lines
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try createTestBuffer(arena.allocator(), 100, 50);
            try rope.rebuildMarkerIndex();

            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 100) : (i += 1) {
                const line = i % 100;
                _ = iter_mod.coordsToOffsetFast(&rope, line, 25);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "[FAST] coordsToOffset: 100 calls, 100 lines", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Medium buffer - 1k lines
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try createTestBuffer(arena.allocator(), 1000, 50);
            try rope.rebuildMarkerIndex();

            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 100) : (i += 1) {
                const line = (i * 10) % 1000;
                _ = iter_mod.coordsToOffsetFast(&rope, line, 25);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "[FAST] coordsToOffset: 100 calls, 1k lines", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Large buffer - 10k lines
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try createTestBuffer(arena.allocator(), 10000, 50);
            try rope.rebuildMarkerIndex();

            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 100) : (i += 1) {
                const line = (i * 100) % 10000;
                _ = iter_mod.coordsToOffsetFast(&rope, line, 25);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "[FAST] coordsToOffset: 100 calls, 10k lines", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Worst case: access last line repeatedly
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try createTestBuffer(arena.allocator(), 1000, 50);
            try rope.rebuildMarkerIndex();

            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 100) : (i += 1) {
                _ = iter_mod.coordsToOffsetFast(&rope, 999, 25); // Last line
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "[FAST] coordsToOffset: 100 calls to LAST line, 1k lines (was worst case!)", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return try results.toOwnedSlice();
}

fn benchOffsetToCoordsFast(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    // Small buffer
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try createTestBuffer(arena.allocator(), 100, 50);
            try rope.rebuildMarkerIndex();
            const total_width = iter_mod.getTotalWidth(&rope);

            var prng = std.Random.DefaultPrng.init(42);
            const random = prng.random();

            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 100) : (i += 1) {
                const off = random.intRangeAtMost(u32, 0, total_width);
                _ = iter_mod.offsetToCoordsFast(&rope, off);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "[FAST] offsetToCoords: 100 calls, 100 lines", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Medium buffer
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try createTestBuffer(arena.allocator(), 1000, 50);
            try rope.rebuildMarkerIndex();
            const total_width = iter_mod.getTotalWidth(&rope);

            var prng = std.Random.DefaultPrng.init(42);
            const random = prng.random();

            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 100) : (i += 1) {
                const off = random.intRangeAtMost(u32, 0, total_width);
                _ = iter_mod.offsetToCoordsFast(&rope, off);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "[FAST] offsetToCoords: 100 calls, 1k lines", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Large buffer
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try createTestBuffer(arena.allocator(), 10000, 50);
            try rope.rebuildMarkerIndex();
            const total_width = iter_mod.getTotalWidth(&rope);

            var prng = std.Random.DefaultPrng.init(42);
            const random = prng.random();

            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 100) : (i += 1) {
                const off = random.intRangeAtMost(u32, 0, total_width);
                _ = iter_mod.offsetToCoordsFast(&rope, off);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "[FAST] offsetToCoords: 100 calls, 10k lines", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return try results.toOwnedSlice();
}

pub fn run(
    allocator: std.mem.Allocator,
    show_mem: bool,
) ![]BenchResult {
    _ = show_mem;

    var all_results = std.ArrayList(BenchResult).init(allocator);

    const iterations: usize = 10;

    // Current implementation benchmarks
    const coords_results = try benchCoordsToOffsetCurrent(allocator, iterations);
    defer allocator.free(coords_results);
    try all_results.appendSlice(coords_results);

    const offset_results = try benchOffsetToCoordsCurrent(allocator, iterations);
    defer allocator.free(offset_results);
    try all_results.appendSlice(offset_results);

    // Fast (marker-optimized) benchmarks
    const coords_fast_results = try benchCoordsToOffsetFast(allocator, iterations);
    defer allocator.free(coords_fast_results);
    try all_results.appendSlice(coords_fast_results);

    const offset_fast_results = try benchOffsetToCoordsFast(allocator, iterations);
    defer allocator.free(offset_fast_results);
    try all_results.appendSlice(offset_fast_results);

    const count_results = try benchGetLineCount(allocator, iterations);
    defer allocator.free(count_results);
    try all_results.appendSlice(count_results);

    return try all_results.toOwnedSlice();
}
