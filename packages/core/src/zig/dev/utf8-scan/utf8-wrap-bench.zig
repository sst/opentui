//! UTF-8 Word Wrap Break Point Detection Benchmark
//!
//! This program benchmarks various methods for scanning UTF-8 text
//! for word wrap break points as described in "Efficient UTF-8 Text Scanning in Zig".
//!
//! Methods benchmarked:
//! 1. Baseline Pure Loop - Simple byte-by-byte iteration
//! 2. Stdlib indexOfAny - Using Zig's optimized standard library functions
//! 3. SIMD 16-byte - Manual vectorization with 16-byte SIMD vectors
//! 4. SIMD 32-byte - Manual vectorization with 32-byte SIMD vectors
//! 5. Bitmask 128-byte - Bitmask approach
//! 6. Multithreaded - Parallel scanning with 2, 4, and 8 threads
//!
//! Usage:
//!   Build:
//!     zig build-exe utf8-wrap-bench.zig -O ReleaseFast
//!
//!   Benchmark a file:
//!     ./utf8-wrap-bench <file_path>
//!
//!   Generate test files:
//!     ./utf8-wrap-bench --generate-tests [max_size]
//!
//!     By default, generates 16 files from 1KB to 1GB in exponential steps.
//!     Optional max_size parameter allows customizing the range:
//!       ./utf8-wrap-bench --generate-tests 10M    # 1KB to 10MB
//!       ./utf8-wrap-bench --generate-tests 100M   # 1KB to 100MB
//!       ./utf8-wrap-bench --generate-tests 5MB    # 1KB to 5MB
//!
//!     Supported size suffixes: K/KB, M/MB, G/GB (case-insensitive)
//!
//!   Benchmark all generated files:
//!     ./utf8-wrap-bench --bench-all
//!

const std = @import("std");
const builtin = @import("builtin");
const wrap = @import("utf8-wrap.zig");
const testgen = @import("test-file-generator.zig");

// Re-export for convenience
const BreakResult = wrap.BreakResult;

// Benchmark runner
const BenchmarkResult = struct {
    name: []const u8,
    total_time_ns: u64,
    avg_time_ns: u64,
    iterations: usize,
    breaks_found: usize,
};

fn runBenchmark(
    comptime name: []const u8,
    text: []const u8,
    iterations: usize,
    allocator: std.mem.Allocator,
    comptime func: anytype,
) !BenchmarkResult {
    var result = BreakResult.init(allocator);
    defer result.deinit();

    var timer = try std.time.Timer.start();
    const start = timer.read();

    for (0..iterations) |_| {
        try func(text, &result);
    }

    const end = timer.read();
    const total_time = end - start;

    return BenchmarkResult{
        .name = name,
        .total_time_ns = total_time,
        .avg_time_ns = total_time / iterations,
        .iterations = iterations,
        .breaks_found = result.breaks.items.len,
    };
}

fn runBenchmarkWithAllocator(
    comptime name: []const u8,
    text: []const u8,
    iterations: usize,
    allocator: std.mem.Allocator,
    comptime func: anytype,
) !BenchmarkResult {
    var result = BreakResult.init(allocator);
    defer result.deinit();

    var timer = try std.time.Timer.start();
    const start = timer.read();

    for (0..iterations) |_| {
        try func(text, &result, allocator);
    }

    const end = timer.read();
    const total_time = end - start;

    return BenchmarkResult{
        .name = name,
        .total_time_ns = total_time,
        .avg_time_ns = total_time / iterations,
        .iterations = iterations,
        .breaks_found = result.breaks.items.len,
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

// Common benchmark runner for all methods
fn runAllBenchmarks(
    text: []const u8,
    iterations: usize,
    allocator: std.mem.Allocator,
    comptime include_all_mt: bool,
) !std.ArrayList(BenchmarkResult) {
    var results = std.ArrayList(BenchmarkResult).init(allocator);
    errdefer results.deinit();

    try results.append(try runBenchmark("Baseline Pure Loop", text, iterations, allocator, wrap.findWrapBreaksBaseline));
    try results.append(try runBenchmark("Stdlib indexOfAny", text, iterations, allocator, wrap.findWrapBreaksStdLib));
    try results.append(try runBenchmark("SIMD 16-byte", text, iterations, allocator, wrap.findWrapBreaksSIMD16));
    try results.append(try runBenchmark("SIMD 32-byte", text, iterations, allocator, wrap.findWrapBreaksSIMD32));
    try results.append(try runBenchmark("Bitmask 128-byte", text, iterations, allocator, wrap.findWrapBreaksBitmask128));

    if (include_all_mt) {
        try results.append(try runBenchmarkWithAllocator("MT + Baseline", text, iterations, allocator, wrap.findWrapBreaksMultithreadedBaseline));
        try results.append(try runBenchmarkWithAllocator("MT + StdLib", text, iterations, allocator, wrap.findWrapBreaksMultithreadedStdLib));
        try results.append(try runBenchmarkWithAllocator("MT + SIMD16", text, iterations, allocator, wrap.findWrapBreaksMultithreadedSIMD16));
        try results.append(try runBenchmarkWithAllocator("MT + SIMD32", text, iterations, allocator, wrap.findWrapBreaksMultithreadedSIMD32));
        try results.append(try runBenchmarkWithAllocator("MT + Bitmask", text, iterations, allocator, wrap.findWrapBreaksMultithreadedBitmask128));

        // Fixed thread count variants (SIMD16 with 2, 4, 8 threads)
        const cpu_count = std.Thread.getCpuCount() catch 2;
        if (cpu_count >= 2) {
            try results.append(try runBenchmarkWithAllocator("MT + SIMD16 (2T)", text, iterations, allocator, wrap.findWrapBreaksMultithreadedSIMD16_2T));
        }
        if (cpu_count >= 4) {
            try results.append(try runBenchmarkWithAllocator("MT + SIMD16 (4T)", text, iterations, allocator, wrap.findWrapBreaksMultithreadedSIMD16_4T));
        }
        if (cpu_count >= 8) {
            try results.append(try runBenchmarkWithAllocator("MT + SIMD16 (8T)", text, iterations, allocator, wrap.findWrapBreaksMultithreadedSIMD16_8T));
        }
    } else {
        // For batch benchmarks, show thread scaling
        const cpu_count = std.Thread.getCpuCount() catch 2;
        if (cpu_count >= 2) {
            try results.append(try runBenchmarkWithAllocator("MT + SIMD16 (2T)", text, iterations, allocator, wrap.findWrapBreaksMultithreadedSIMD16_2T));
        }
        if (cpu_count >= 4) {
            try results.append(try runBenchmarkWithAllocator("MT + SIMD16 (4T)", text, iterations, allocator, wrap.findWrapBreaksMultithreadedSIMD16_4T));
        }
        if (cpu_count >= 8) {
            try results.append(try runBenchmarkWithAllocator("MT + SIMD16 (8T)", text, iterations, allocator, wrap.findWrapBreaksMultithreadedSIMD16_8T));
        }
    }

    return results;
}

// Test file generation (using shared test directory)
const test_dir = "utf8-bench-tests";

fn benchmarkAllTestFiles(allocator: std.mem.Allocator) !void {
    const stdout = std.io.getStdOut().writer();

    try stdout.writeAll("\n");
    try stdout.writeAll("=" ** 80);
    try stdout.writeAll("\n");
    try stdout.writeAll("BENCHMARKING ALL TEST FILES\n");
    try stdout.writeAll("=" ** 80);
    try stdout.writeAll("\n\n");

    var i: usize = 0;
    while (i < 16) : (i += 1) {
        var filename_buf: [256]u8 = undefined;
        const filename = try std.fmt.bufPrint(&filename_buf, "{s}/test_{d:0>2}.txt", .{ test_dir, i });

        // Check if file exists
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

        // Adjust iterations based on file size
        const iterations: usize = if (file_size < 1024 * 1024) // < 1 MB
            100
        else if (file_size < 10 * 1024 * 1024) // < 10 MB
            50
        else if (file_size < 100 * 1024 * 1024) // < 100 MB
            10
        else
            5; // >= 100 MB

        try stdout.print("Running {d} iterations per method...\n\n", .{iterations});

        // Run benchmarks (compact mode - only best methods)
        var results = try runAllBenchmarks(text, iterations, allocator, false);
        defer results.deinit();

        // Find fastest
        var fastest_time = results.items[0].avg_time_ns;
        var fastest_idx: usize = 0;
        for (results.items, 0..) |r, idx| {
            if (r.avg_time_ns < fastest_time) {
                fastest_time = r.avg_time_ns;
                fastest_idx = idx;
            }
        }

        // Print compact results
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

        const throughput = (@as(f64, @floatFromInt(file_size)) / (1024.0 * 1024.0)) / (@as(f64, @floatFromInt(fastest_time)) / 1_000_000_000.0);
        try stdout.print("\nPeak throughput: {d:.2} MB/s\n\n", .{throughput});
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
        try stderr.print("  {s} <file_path>                    - Benchmark a specific file\n", .{args[0]});
        try stderr.print("  {s} --generate-tests [max_size]   - Generate test files (default: 1GB max)\n", .{args[0]});
        try stderr.print("  {s} --bench-all                    - Benchmark all test files\n", .{args[0]});
        try stderr.print("\nExamples:\n", .{});
        try stderr.print("  {s} --generate-tests               - Generate files from 1KB to 1GB\n", .{args[0]});
        try stderr.print("  {s} --generate-tests 10M           - Generate files from 1KB to 10MB\n", .{args[0]});
        try stderr.print("  {s} --generate-tests 100M          - Generate files from 1KB to 100MB\n", .{args[0]});
        std.process.exit(1);
    }

    const command = args[1];

    // Handle special commands
    if (std.mem.eql(u8, command, "--generate-tests")) {
        var max_size: ?usize = null;

        // Parse optional max size argument
        if (args.len >= 3) {
            max_size = try parseSizeString(args[2]);
        }

        try testgen.generateTestFiles(test_dir, max_size);
        return;
    }

    if (std.mem.eql(u8, command, "--bench-all")) {
        try benchmarkAllTestFiles(allocator);
        return;
    }

    const file_path = command;
    const stdout = std.io.getStdOut().writer();

    // Load file
    try stdout.print("Loading file: {s}\n", .{file_path});
    const file = try std.fs.cwd().openFile(file_path, .{});
    defer file.close();

    const file_size = (try file.stat()).size;
    const text = try file.readToEndAlloc(allocator, std.math.maxInt(usize));
    defer allocator.free(text);

    try stdout.print("File size: ", .{});
    try formatBytes(file_size, stdout);
    try stdout.print("\n\n", .{});

    const iterations = 100;
    try stdout.print("Running each method {d} times...\n\n", .{iterations});

    // Run all benchmarks (verbose mode - all methods)
    var results = try runAllBenchmarks(text, iterations, allocator, true);
    defer results.deinit();

    // Print results
    try stdout.writeAll("\n");
    try stdout.writeAll("=" ** 80);
    try stdout.writeAll("\n");
    try stdout.writeAll("BENCHMARK RESULTS\n");
    try stdout.writeAll("=" ** 80);
    try stdout.writeAll("\n\n");

    // Find fastest for comparison
    var fastest_time = results.items[0].avg_time_ns;
    for (results.items) |r| {
        if (r.avg_time_ns < fastest_time) {
            fastest_time = r.avg_time_ns;
        }
    }

    try stdout.print("{s:<25} {s:>15} {s:>15} {s:>12} {s:>10}\n", .{ "Method", "Total Time", "Avg Time", "Breaks", "Speedup" });
    try stdout.writeAll("-" ** 80);
    try stdout.writeAll("\n");

    for (results.items) |r| {
        try stdout.print("{s:<25} ", .{r.name});

        var buf1: [32]u8 = undefined;
        var stream1 = std.io.fixedBufferStream(&buf1);
        try formatNanoseconds(r.total_time_ns, stream1.writer());
        try stdout.print("{s:>15} ", .{stream1.getWritten()});

        var buf2: [32]u8 = undefined;
        var stream2 = std.io.fixedBufferStream(&buf2);
        try formatNanoseconds(r.avg_time_ns, stream2.writer());
        try stdout.print("{s:>15} ", .{stream2.getWritten()});

        try stdout.print("{d:>12} ", .{r.breaks_found});

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

    // Calculate throughput for fastest
    const fastest_mb_per_sec = (@as(f64, @floatFromInt(file_size)) / (1024.0 * 1024.0)) / (@as(f64, @floatFromInt(fastest_time)) / 1_000_000_000.0);
    try stdout.print("Peak throughput: {d:.2} MB/s\n", .{fastest_mb_per_sec});

    // System info
    try stdout.writeAll("\nSystem Information:\n");
    try stdout.print("  CPU cores: {d}\n", .{try std.Thread.getCpuCount()});
    try stdout.print("  Zig version: {s}\n", .{builtin.zig_version_string});
    try stdout.print("  Optimize mode: {s}\n", .{@tagName(builtin.mode)});
}
