//! UTF-8 Width-Aware Word Wrap Position Finding Benchmark
//!
//! This program benchmarks various methods for finding the optimal wrap position
//! in UTF-8 text based on visual display width, respecting grapheme boundaries.
//!
//! Methods benchmarked:
//! 1. Baseline - Reference implementation (correctness oracle)
//! 2. StdLib - StdLib-accelerated ASCII fast path
//! 3. SIMD16 - 16-byte SIMD chunked scanning (FASTEST expected)
//! 4. Bitmask128 - 128-byte bitmask approach
//!
//! Usage:
//!   Build:
//!     zig build-exe utf8-wrap-by-width-bench.zig -O ReleaseFast
//!
//!   Benchmark a file:
//!     ./utf8-wrap-by-width-bench <file_path> <width>
//!
//!   Generate test files:
//!     ./utf8-wrap-by-width-bench --generate-tests [max_size]
//!
//!   Benchmark all generated files:
//!     ./utf8-wrap-by-width-bench --bench-all <width>

const std = @import("std");
const builtin = @import("builtin");
const wrap = @import("utf8-wrap-by-width.zig");
const testgen = @import("test-file-generator.zig");

const BenchmarkResult = struct {
    name: []const u8,
    total_time_ns: u64,
    avg_time_ns: u64,
    iterations: usize,
    result: wrap.WrapByWidthResult,
};

fn runBenchmark(
    comptime name: []const u8,
    text: []const u8,
    max_columns: u32,
    tab_width: u8,
    iterations: usize,
    comptime func: anytype,
) !BenchmarkResult {
    var timer = try std.time.Timer.start();
    const start = timer.read();

    var last_result: wrap.WrapByWidthResult = undefined;
    for (0..iterations) |_| {
        last_result = func(text, max_columns, tab_width);
    }

    const end = timer.read();
    const total_time = end - start;

    return BenchmarkResult{
        .name = name,
        .total_time_ns = total_time,
        .avg_time_ns = total_time / iterations,
        .iterations = iterations,
        .result = last_result,
    };
}

fn formatNanoseconds(ns: u64, writer: anytype) !void {
    if (ns < 1_000) {
        try writer.print("{d} ns", .{ns});
    } else if (ns < 1_000_000) {
        try writer.print("{d:.2} µs", .{@as(f64, @floatFromInt(ns)) / 1_000.0});
    } else if (ns < 1_000_000_000) {
        try writer.print("{d:.2} ms", .{@as(f64, @floatFromInt(ns)) / 1_000_000.0});
    } else {
        try writer.print("{d:.2} s", .{@as(f64, @floatFromInt(ns)) / 1_000_000_000.0});
    }
}

const formatBytes = testgen.formatBytes;
const parseSizeString = testgen.parseSizeString;

fn runAllBenchmarks(
    text: []const u8,
    max_columns: u32,
    tab_width: u8,
    iterations: usize,
    allocator: std.mem.Allocator,
) !std.ArrayList(BenchmarkResult) {
    var results = std.ArrayList(BenchmarkResult).init(allocator);
    errdefer results.deinit();

    try results.append(try runBenchmark("Baseline", text, max_columns, tab_width, iterations, wrap.findWrapPosByWidthBaseline));
    try results.append(try runBenchmark("StdLib", text, max_columns, tab_width, iterations, wrap.findWrapPosByWidthStdLib));
    try results.append(try runBenchmark("SIMD16", text, max_columns, tab_width, iterations, wrap.findWrapPosByWidthSIMD16));
    try results.append(try runBenchmark("Bitmask128", text, max_columns, tab_width, iterations, wrap.findWrapPosByWidthBitmask128));

    return results;
}

const test_dir = "utf8-bench-tests";

fn benchmarkAllTestFiles(allocator: std.mem.Allocator, max_columns: u32) !void {
    const stdout = std.io.getStdOut().writer();

    try stdout.writeAll("\n");
    try stdout.writeAll("=" ** 80);
    try stdout.writeAll("\n");
    try stdout.print("BENCHMARKING ALL TEST FILES (width={d})\n", .{max_columns});
    try stdout.writeAll("=" ** 80);
    try stdout.writeAll("\n\n");

    var i: usize = 0;
    while (i < 16) : (i += 1) {
        var filename_buf: [256]u8 = undefined;
        const filename = try std.fmt.bufPrint(&filename_buf, "{s}/test_{d:0>2}.txt", .{ test_dir, i });

        const file = std.fs.cwd().openFile(filename, .{}) catch |err| {
            if (err == error.FileNotFound) {
                try stdout.print("⚠ Skipping {s} (not found)\n\n", .{filename});
                continue;
            }
            return err;
        };
        defer file.close();

        const file_size = (try file.stat()).size;
        const text = try file.readToEndAlloc(allocator, std.math.maxInt(usize));
        defer allocator.free(text);

        try stdout.print("📊 File: {s} (", .{filename});
        try formatBytes(file_size, stdout);
        try stdout.writeAll(")\n");
        try stdout.writeAll("-" ** 80);
        try stdout.writeAll("\n");

        // Since we only scan until first wrap (~80 bytes), increase iterations dramatically
        const iterations: usize = if (file_size < 1024 * 1024) // < 1 MB
            100_000
        else if (file_size < 10 * 1024 * 1024) // < 10 MB
            100_000
        else if (file_size < 100 * 1024 * 1024) // < 100 MB
            50_000
        else
            10_000;

        try stdout.print("Running {d} iterations per method...\n\n", .{iterations});

        var results = try runAllBenchmarks(text, max_columns, 4, iterations, allocator);
        defer results.deinit();

        // Verify all methods agree
        const baseline_result = results.items[0].result;
        for (results.items[1..]) |r| {
            if (r.result.byte_offset != baseline_result.byte_offset or
                r.result.grapheme_count != baseline_result.grapheme_count or
                r.result.columns_used != baseline_result.columns_used)
            {
                try stdout.print("⚠ WARNING: {s} disagrees with Baseline!\n", .{r.name});
                try stdout.print("  Baseline: byte={d} graphemes={d} cols={d}\n", .{
                    baseline_result.byte_offset,
                    baseline_result.grapheme_count,
                    baseline_result.columns_used,
                });
                try stdout.print("  {s}: byte={d} graphemes={d} cols={d}\n", .{
                    r.name,
                    r.result.byte_offset,
                    r.result.grapheme_count,
                    r.result.columns_used,
                });
            }
        }

        // Find fastest
        var fastest_time = results.items[0].avg_time_ns;
        var fastest_idx: usize = 0;
        for (results.items, 0..) |r, idx| {
            if (r.avg_time_ns < fastest_time) {
                fastest_time = r.avg_time_ns;
                fastest_idx = idx;
            }
        }

        try stdout.print("{s:<20} {s:>12} {s:>12}\n", .{ "Method", "Avg Time", "Speedup" });
        for (results.items, 0..) |r, idx| {
            var buf: [32]u8 = undefined;
            var stream = std.io.fixedBufferStream(&buf);
            try formatNanoseconds(r.avg_time_ns, stream.writer());

            const speedup = @as(f64, @floatFromInt(fastest_time)) / @as(f64, @floatFromInt(r.avg_time_ns));
            try stdout.print("{s:<20} {s:>12} {d:>11.2}x", .{ r.name, stream.getWritten(), speedup });

            if (idx == fastest_idx) {
                try stdout.writeAll(" ⚡");
            }
            try stdout.writeAll("\n");
        }

        const calls_per_sec = @as(f64, 1_000_000_000.0) / @as(f64, @floatFromInt(fastest_time));
        try stdout.print("\nPeak rate: {d:.2} calls/sec\n", .{calls_per_sec});
        try stdout.print("Result: byte={d} graphemes={d} cols={d}\n\n", .{
            baseline_result.byte_offset,
            baseline_result.grapheme_count,
            baseline_result.columns_used,
        });
    }

    try stdout.writeAll("=" ** 80);
    try stdout.writeAll("\n");
    try stdout.writeAll("✓ All benchmarks complete!\n");
}

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);

    if (args.len < 2) {
        const stderr = std.io.getStdErr().writer();
        try stderr.print("Usage:\n", .{});
        try stderr.print("  {s} <file_path> <width>\n", .{args[0]});
        try stderr.print("  {s} --generate-tests [max_size]   - Generate test files\n", .{args[0]});
        try stderr.print("  {s} --bench-all <width>\n", .{args[0]});
        try stderr.print("\nExamples:\n", .{});
        try stderr.print("  {s} sample.txt 80\n", .{args[0]});
        try stderr.print("  {s} --bench-all 80\n", .{args[0]});
        try stderr.print("  {s} --generate-tests 10M\n", .{args[0]});
        std.process.exit(1);
    }

    const command = args[1];

    if (std.mem.eql(u8, command, "--generate-tests")) {
        var max_size: ?usize = null;
        if (args.len >= 3) {
            max_size = try parseSizeString(args[2]);
        }
        try testgen.generateTestFiles(test_dir, max_size);
        return;
    }

    if (std.mem.eql(u8, command, "--bench-all")) {
        if (args.len < 3) {
            const stderr = std.io.getStdErr().writer();
            try stderr.print("Error: --bench-all requires width argument\n", .{});
            std.process.exit(1);
        }
        const width = try std.fmt.parseInt(u32, args[2], 10);
        try benchmarkAllTestFiles(allocator, width);
        return;
    }

    // Single file benchmark
    const file_path = command;
    if (args.len < 3) {
        const stderr = std.io.getStdErr().writer();
        try stderr.print("Error: width argument required\n", .{});
        std.process.exit(1);
    }

    const width = try std.fmt.parseInt(u32, args[2], 10);
    const stdout = std.io.getStdOut().writer();

    try stdout.print("Loading file: {s}\n", .{file_path});
    const file = try std.fs.cwd().openFile(file_path, .{});
    defer file.close();

    const file_size = (try file.stat()).size;
    const text = try file.readToEndAlloc(allocator, std.math.maxInt(usize));
    defer allocator.free(text);

    try stdout.print("File size: ", .{});
    try formatBytes(file_size, stdout);
    try stdout.print("\n", .{});
    try stdout.print("Width: {d}\n\n", .{width});

    const iterations = 100_000;
    try stdout.print("Running each method {d} times...\n\n", .{iterations});

    var results = try runAllBenchmarks(text, width, 4, iterations, allocator);
    defer results.deinit();

    // Verify all methods agree
    try stdout.writeAll("Correctness check: ");
    const baseline_result = results.items[0].result;
    var all_match = true;
    for (results.items[1..]) |r| {
        if (r.result.byte_offset != baseline_result.byte_offset or
            r.result.grapheme_count != baseline_result.grapheme_count or
            r.result.columns_used != baseline_result.columns_used)
        {
            all_match = false;
            try stdout.print("\n⚠ {s} disagrees with Baseline!\n", .{r.name});
        }
    }
    if (all_match) {
        try stdout.writeAll("✓ All methods agree\n\n");
    }

    try stdout.writeAll("\n");
    try stdout.writeAll("=" ** 80);
    try stdout.writeAll("\n");
    try stdout.writeAll("BENCHMARK RESULTS\n");
    try stdout.writeAll("=" ** 80);
    try stdout.writeAll("\n\n");

    // Find fastest
    var fastest_time = results.items[0].avg_time_ns;
    for (results.items) |r| {
        if (r.avg_time_ns < fastest_time) {
            fastest_time = r.avg_time_ns;
        }
    }

    try stdout.print("{s:<20} {s:>15} {s:>15} {s:>10}\n", .{ "Method", "Total Time", "Avg Time", "Speedup" });
    try stdout.writeAll("-" ** 80);
    try stdout.writeAll("\n");

    for (results.items) |r| {
        try stdout.print("{s:<20} ", .{r.name});

        var buf1: [32]u8 = undefined;
        var stream1 = std.io.fixedBufferStream(&buf1);
        try formatNanoseconds(r.total_time_ns, stream1.writer());
        try stdout.print("{s:>15} ", .{stream1.getWritten()});

        var buf2: [32]u8 = undefined;
        var stream2 = std.io.fixedBufferStream(&buf2);
        try formatNanoseconds(r.avg_time_ns, stream2.writer());
        try stdout.print("{s:>15} ", .{stream2.getWritten()});

        const speedup = @as(f64, @floatFromInt(fastest_time)) / @as(f64, @floatFromInt(r.avg_time_ns));
        try stdout.print("{d:>10.2}x", .{speedup});

        if (r.avg_time_ns == fastest_time) {
            try stdout.writeAll(" ⚡ FASTEST");
        }

        try stdout.writeAll("\n");
    }

    try stdout.writeAll("\n");
    try stdout.writeAll("=" ** 80);
    try stdout.writeAll("\n\n");

    const calls_per_sec = @as(f64, 1_000_000_000.0) / @as(f64, @floatFromInt(fastest_time));
    try stdout.print("Peak rate: {d:.2} calls/sec\n", .{calls_per_sec});

    try stdout.print("\nResult: byte={d} graphemes={d} cols={d}\n", .{
        baseline_result.byte_offset,
        baseline_result.grapheme_count,
        baseline_result.columns_used,
    });

    try stdout.writeAll("\nSystem Information:\n");
    try stdout.print("  Zig version: {s}\n", .{builtin.zig_version_string});
    try stdout.print("  Optimize mode: {s}\n", .{@tagName(builtin.mode)});
}
