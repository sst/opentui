const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const utf8 = @import("../utf8.zig");

const BenchResult = bench_utils.BenchResult;
const BenchStats = bench_utils.BenchStats;

pub const benchName = "UTF-8 Operations";

// Test data generators
fn generateAsciiText(allocator: std.mem.Allocator, length: usize) ![]const u8 {
    const text = try allocator.alloc(u8, length);
    for (text, 0..) |*c, i| {
        // Generate printable ASCII (32-126)
        c.* = @as(u8, @intCast(32 + (i % 95)));
    }
    return text;
}

fn generateMixedText(allocator: std.mem.Allocator, length: usize) ![]const u8 {
    var text: std.ArrayListUnmanaged(u8) = .{};
    errdefer text.deinit(allocator);
    var i: usize = 0;
    while (text.items.len < length) : (i += 1) {
        if (i % 4 == 0) {
            try text.appendSlice(allocator, "世");
        } else if (i % 4 == 1) {
            try text.appendSlice(allocator, "😀");
        } else {
            try text.append(allocator, @as(u8, @intCast(32 + (i % 95))));
        }
    }
    return text.toOwnedSlice(allocator);
}

fn generateUnicodeHeavyText(allocator: std.mem.Allocator, length: usize) ![]const u8 {
    var text: std.ArrayListUnmanaged(u8) = .{};
    errdefer text.deinit(allocator);
    var i: usize = 0;
    while (text.items.len < length) : (i += 1) {
        if (i % 3 == 0) {
            try text.appendSlice(allocator, "世界");
        } else if (i % 3 == 1) {
            try text.appendSlice(allocator, "😀🎉");
        } else {
            try text.appendSlice(allocator, "Ñoño");
        }
    }
    return text.toOwnedSlice(allocator);
}

// Benchmark isAsciiOnly
fn benchIsAsciiOnly(results_alloc: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(results_alloc);

    // Small ASCII text (1KB)
    {
        var temp = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer temp.deinit();
        const text = try generateAsciiText(temp.allocator(), 1024);

        var stats = BenchStats{};
        for (0..iterations) |_| {
            var timer = try std.time.Timer.start();
            _ = utf8.isAsciiOnly(text);
            stats.record(timer.read());
        }

        try results.append(results_alloc, BenchResult{
            .name = "isAsciiOnly: ASCII text (1KB)",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Large ASCII text (100KB)
    {
        var temp = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer temp.deinit();
        const text = try generateAsciiText(temp.allocator(), 100 * 1024);

        var stats = BenchStats{};
        for (0..iterations) |_| {
            var timer = try std.time.Timer.start();
            _ = utf8.isAsciiOnly(text);
            stats.record(timer.read());
        }

        try results.append(results_alloc, BenchResult{
            .name = "isAsciiOnly: ASCII text (100KB)",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Very large ASCII text (1MB)
    {
        var temp = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer temp.deinit();
        const text = try generateAsciiText(temp.allocator(), 1024 * 1024);

        var stats = BenchStats{};
        for (0..iterations) |_| {
            var timer = try std.time.Timer.start();
            _ = utf8.isAsciiOnly(text);
            stats.record(timer.read());
        }

        try results.append(results_alloc, BenchResult{
            .name = "isAsciiOnly: ASCII text (1MB)",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Mixed text (10KB)
    {
        var temp = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer temp.deinit();
        const text = try generateMixedText(temp.allocator(), 10 * 1024);

        var stats = BenchStats{};
        for (0..iterations) |_| {
            var timer = try std.time.Timer.start();
            _ = utf8.isAsciiOnly(text);
            stats.record(timer.read());
        }

        try results.append(results_alloc, BenchResult{
            .name = "isAsciiOnly: Mixed text (10KB)",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return results.toOwnedSlice(results_alloc);
}

// Benchmark findLineBreaks
fn benchFindLineBreaks(results_alloc: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(results_alloc);

    // Text with LF breaks
    {
        var temp = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer temp.deinit();
        const alloc = temp.allocator();

        var text: std.ArrayListUnmanaged(u8) = .{};
        for (0..100) |_| {
            try text.appendSlice(alloc, "This is a line of text that ends with a newline character.\n");
        }
        const test_text = text.items;

        var line_result = utf8.LineBreakResult.init(alloc);
        defer line_result.deinit();

        var stats = BenchStats{};
        for (0..iterations) |_| {
            var timer = try std.time.Timer.start();
            try utf8.findLineBreaks(test_text, &line_result);
            stats.record(timer.read());
        }

        try results.append(results_alloc, BenchResult{
            .name = "findLineBreaks: 100 LF lines",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Text with CRLF breaks
    {
        var temp = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer temp.deinit();
        const alloc = temp.allocator();

        var text: std.ArrayListUnmanaged(u8) = .{};
        for (0..100) |_| {
            try text.appendSlice(alloc, "This is a line of text that ends with CRLF.\r\n");
        }
        const test_text = text.items;

        var line_result = utf8.LineBreakResult.init(alloc);
        defer line_result.deinit();

        var stats = BenchStats{};
        for (0..iterations) |_| {
            var timer = try std.time.Timer.start();
            try utf8.findLineBreaks(test_text, &line_result);
            stats.record(timer.read());
        }

        try results.append(results_alloc, BenchResult{
            .name = "findLineBreaks: 100 CRLF lines",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Large text with many lines
    {
        var temp = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer temp.deinit();
        const alloc = temp.allocator();

        var text: std.ArrayListUnmanaged(u8) = .{};
        for (0..1000) |_| {
            try text.appendSlice(alloc, "Short line\n");
        }
        const test_text = text.items;

        var line_result = utf8.LineBreakResult.init(alloc);
        defer line_result.deinit();

        var stats = BenchStats{};
        for (0..iterations) |_| {
            var timer = try std.time.Timer.start();
            try utf8.findLineBreaks(test_text, &line_result);
            stats.record(timer.read());
        }

        try results.append(results_alloc, BenchResult{
            .name = "findLineBreaks: 1000 short lines",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return results.toOwnedSlice(results_alloc);
}

// Benchmark findWrapBreaks
fn benchFindWrapBreaks(results_alloc: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(results_alloc);

    // ASCII text
    {
        var temp = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer temp.deinit();
        const alloc = temp.allocator();
        const text = try generateAsciiText(alloc, 10 * 1024);

        var wrap_result = utf8.WrapBreakResult.init(alloc);
        defer wrap_result.deinit();

        var stats = BenchStats{};
        for (0..iterations) |_| {
            var timer = try std.time.Timer.start();
            try utf8.findWrapBreaks(text, &wrap_result, .unicode);
            stats.record(timer.read());
        }

        try results.append(results_alloc, BenchResult{
            .name = "findWrapBreaks: ASCII (10KB)",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Mixed text
    {
        var temp = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer temp.deinit();
        const alloc = temp.allocator();
        const text = try generateMixedText(alloc, 10 * 1024);

        var wrap_result = utf8.WrapBreakResult.init(alloc);
        defer wrap_result.deinit();

        var stats = BenchStats{};
        for (0..iterations) |_| {
            var timer = try std.time.Timer.start();
            try utf8.findWrapBreaks(text, &wrap_result, .unicode);
            stats.record(timer.read());
        }

        try results.append(results_alloc, BenchResult{
            .name = "findWrapBreaks: Mixed (10KB)",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return results.toOwnedSlice(results_alloc);
}

// Benchmark findWrapPosByWidth
fn benchFindWrapPosByWidth(results_alloc: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(results_alloc);

    // ASCII text, narrow width
    {
        var temp = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer temp.deinit();
        const text = try generateAsciiText(temp.allocator(), 1024);

        var stats = BenchStats{};
        for (0..iterations) |_| {
            var timer = try std.time.Timer.start();
            _ = utf8.findWrapPosByWidth(text, 40, 4, true, .unicode);
            stats.record(timer.read());
        }

        try results.append(results_alloc, BenchResult{
            .name = "findWrapPosByWidth: ASCII 1KB, width=40",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // ASCII text, wide width
    {
        var temp = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer temp.deinit();
        const text = try generateAsciiText(temp.allocator(), 1024);

        var stats = BenchStats{};
        for (0..iterations) |_| {
            var timer = try std.time.Timer.start();
            _ = utf8.findWrapPosByWidth(text, 120, 4, true, .unicode);
            stats.record(timer.read());
        }

        try results.append(results_alloc, BenchResult{
            .name = "findWrapPosByWidth: ASCII 1KB, width=120",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Mixed text
    {
        var temp = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer temp.deinit();
        const text = try generateMixedText(temp.allocator(), 1024);

        var stats = BenchStats{};
        for (0..iterations) |_| {
            var timer = try std.time.Timer.start();
            _ = utf8.findWrapPosByWidth(text, 80, 4, false, .unicode);
            stats.record(timer.read());
        }

        try results.append(results_alloc, BenchResult{
            .name = "findWrapPosByWidth: Mixed 1KB, width=80",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Unicode heavy text
    {
        var temp = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer temp.deinit();
        const text = try generateUnicodeHeavyText(temp.allocator(), 1024);

        var stats = BenchStats{};
        for (0..iterations) |_| {
            var timer = try std.time.Timer.start();
            _ = utf8.findWrapPosByWidth(text, 80, 4, false, .unicode);
            stats.record(timer.read());
        }

        try results.append(results_alloc, BenchResult{
            .name = "findWrapPosByWidth: Unicode 1KB, width=80",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return results.toOwnedSlice(results_alloc);
}

// Benchmark findPosByWidth
fn benchFindPosByWidth(results_alloc: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(results_alloc);

    // ASCII text, find middle
    {
        var temp = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer temp.deinit();
        const text = try generateAsciiText(temp.allocator(), 1024);

        var stats = BenchStats{};
        for (0..iterations) |_| {
            var timer = try std.time.Timer.start();
            _ = utf8.findPosByWidth(text, 500, 4, true, true, .unicode);
            stats.record(timer.read());
        }

        try results.append(results_alloc, BenchResult{
            .name = "findPosByWidth: ASCII 1KB, target=500",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Large ASCII text, find near end
    {
        var temp = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer temp.deinit();
        const text = try generateAsciiText(temp.allocator(), 100 * 1024);

        var stats = BenchStats{};
        for (0..iterations) |_| {
            var timer = try std.time.Timer.start();
            _ = utf8.findPosByWidth(text, 90000, 4, true, true, .unicode);
            stats.record(timer.read());
        }

        try results.append(results_alloc, BenchResult{
            .name = "findPosByWidth: ASCII 100KB, target=90000",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Mixed text
    {
        var temp = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer temp.deinit();
        const text = try generateMixedText(temp.allocator(), 10 * 1024);

        var stats = BenchStats{};
        for (0..iterations) |_| {
            var timer = try std.time.Timer.start();
            _ = utf8.findPosByWidth(text, 5000, 4, false, true, .unicode);
            stats.record(timer.read());
        }

        try results.append(results_alloc, BenchResult{
            .name = "findPosByWidth: Mixed 10KB, target=5000",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return results.toOwnedSlice(results_alloc);
}

// Benchmark calculateTextWidth
fn benchCalculateTextWidth(results_alloc: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(results_alloc);

    // Small ASCII text (1KB)
    {
        var temp = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer temp.deinit();
        const text = try generateAsciiText(temp.allocator(), 1024);

        var stats = BenchStats{};
        for (0..iterations) |_| {
            var timer = try std.time.Timer.start();
            _ = utf8.calculateTextWidth(text, 4, true, .unicode);
            stats.record(timer.read());
        }

        try results.append(results_alloc, BenchResult{
            .name = "calculateTextWidth: ASCII (1KB)",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Large ASCII text (100KB)
    {
        var temp = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer temp.deinit();
        const text = try generateAsciiText(temp.allocator(), 100 * 1024);

        var stats = BenchStats{};
        for (0..iterations) |_| {
            var timer = try std.time.Timer.start();
            _ = utf8.calculateTextWidth(text, 4, true, .unicode);
            stats.record(timer.read());
        }

        try results.append(results_alloc, BenchResult{
            .name = "calculateTextWidth: ASCII (100KB)",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Very large ASCII text (1MB)
    {
        var temp = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer temp.deinit();
        const text = try generateAsciiText(temp.allocator(), 1024 * 1024);

        var stats = BenchStats{};
        for (0..iterations) |_| {
            var timer = try std.time.Timer.start();
            _ = utf8.calculateTextWidth(text, 4, true, .unicode);
            stats.record(timer.read());
        }

        try results.append(results_alloc, BenchResult{
            .name = "calculateTextWidth: ASCII (1MB)",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // ASCII with tabs
    {
        var temp = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer temp.deinit();
        const alloc = temp.allocator();

        var text: std.ArrayListUnmanaged(u8) = .{};
        for (0..10 * 1024) |i| {
            if (i % 20 == 0) {
                try text.append(alloc, '\t');
            } else {
                try text.append(alloc, @as(u8, @intCast(32 + (i % 95))));
            }
        }

        var stats = BenchStats{};
        for (0..iterations) |_| {
            var timer = try std.time.Timer.start();
            _ = utf8.calculateTextWidth(text.items, 4, false, .unicode);
            stats.record(timer.read());
        }

        try results.append(results_alloc, BenchResult{
            .name = "calculateTextWidth: ASCII with tabs (10KB)",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Mixed text
    {
        var temp = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer temp.deinit();
        const text = try generateMixedText(temp.allocator(), 10 * 1024);

        var stats = BenchStats{};
        for (0..iterations) |_| {
            var timer = try std.time.Timer.start();
            _ = utf8.calculateTextWidth(text, 4, false, .unicode);
            stats.record(timer.read());
        }

        try results.append(results_alloc, BenchResult{
            .name = "calculateTextWidth: Mixed (10KB)",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Unicode heavy text
    {
        var temp = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer temp.deinit();
        const text = try generateUnicodeHeavyText(temp.allocator(), 10 * 1024);

        var stats = BenchStats{};
        for (0..iterations) |_| {
            var timer = try std.time.Timer.start();
            _ = utf8.calculateTextWidth(text, 4, false, .unicode);
            stats.record(timer.read());
        }

        try results.append(results_alloc, BenchResult{
            .name = "calculateTextWidth: Unicode heavy (10KB)",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return results.toOwnedSlice(results_alloc);
}

pub fn run(
    allocator: std.mem.Allocator,
    show_mem: bool,
) ![]BenchResult {
    _ = show_mem;

    var all_results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer all_results.deinit(allocator);

    const iterations: usize = 1000;

    // isAsciiOnly benchmarks
    const ascii_only_results = try benchIsAsciiOnly(allocator, iterations);
    try all_results.appendSlice(allocator, ascii_only_results);

    // findLineBreaks benchmarks
    const line_breaks_results = try benchFindLineBreaks(allocator, iterations);
    try all_results.appendSlice(allocator, line_breaks_results);

    // findWrapBreaks benchmarks
    const wrap_breaks_results = try benchFindWrapBreaks(allocator, iterations);
    try all_results.appendSlice(allocator, wrap_breaks_results);

    // findWrapPosByWidth benchmarks
    const wrap_pos_results = try benchFindWrapPosByWidth(allocator, iterations);
    try all_results.appendSlice(allocator, wrap_pos_results);

    // findPosByWidth benchmarks
    const pos_width_results = try benchFindPosByWidth(allocator, iterations);
    try all_results.appendSlice(allocator, pos_width_results);

    // calculateTextWidth benchmarks
    const text_width_results = try benchCalculateTextWidth(allocator, iterations);
    try all_results.appendSlice(allocator, text_width_results);

    return all_results.toOwnedSlice(allocator);
}
