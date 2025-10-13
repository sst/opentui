//! ASCII-Only Detection Benchmark
//!
//! This program benchmarks various methods for checking if text contains
//! only printable ASCII characters (32..126).
//!
//! Methods benchmarked:
//! 1. Baseline Pure Loop - Simple byte-by-byte iteration
//! 2. SIMD 16-byte - Manual vectorization with 16-byte SIMD vectors
//! 3. SIMD 32-byte - Manual vectorization with 32-byte SIMD vectors
//! 4. SIMD 64-byte - Manual vectorization with 64-byte SIMD vectors
//! 5. Bitmask - Bitmask-based range checking
//! 6. Bitwise OR - Bitwise OR accumulation approach
//! 7. SIMD16 Single Cmp - Optimized single comparison SIMD16
//! 8. SIMD32 Single Cmp - Optimized single comparison SIMD32
//! 9. SIMD16 Unrolled - Unrolled SIMD16 (2 vectors per iteration)
//!
//! Usage:
//!   Build:
//!     zig build-exe ascii-check-bench.zig -O ReleaseFast
//!
//!   Benchmark a file:
//!     ./ascii-check-bench <file_path>
//!
//!   Generate test files:
//!     ./ascii-check-bench --generate-tests [max_size]
//!
//!   Benchmark all generated files:
//!     ./ascii-check-bench --bench-all
//!

const std = @import("std");
const builtin = @import("builtin");
const ascii = @import("ascii-check.zig");
const testgen = @import("test-file-generator.zig");

// Benchmark runner
const BenchmarkResult = struct {
    name: []const u8,
    total_time_ns: u64,
    avg_time_ns: u64,
    iterations: usize,
    result: bool,
};

fn runBenchmark(
    comptime name: []const u8,
    text: []const u8,
    iterations: usize,
    comptime func: anytype,
) !BenchmarkResult {
    var result: bool = undefined;
    var timer = try std.time.Timer.start();
    const start = timer.read();

    for (0..iterations) |_| {
        result = func(text);
    }

    const end = timer.read();
    const total_time = end - start;

    return BenchmarkResult{
        .name = name,
        .total_time_ns = total_time,
        .avg_time_ns = total_time / iterations,
        .iterations = iterations,
        .result = result,
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
) !std.ArrayList(BenchmarkResult) {
    var results = std.ArrayList(BenchmarkResult).init(allocator);
    errdefer results.deinit();

    try results.append(try runBenchmark("Baseline", text, iterations, ascii.isAsciiOnlyBaseline));
    try results.append(try runBenchmark("SIMD16", text, iterations, ascii.isAsciiOnlySIMD16));
    try results.append(try runBenchmark("SIMD32", text, iterations, ascii.isAsciiOnlySIMD32));
    try results.append(try runBenchmark("SIMD64", text, iterations, ascii.isAsciiOnlySIMD64));
    try results.append(try runBenchmark("Bitmask", text, iterations, ascii.isAsciiOnlyBitmask));
    try results.append(try runBenchmark("Bitwise OR", text, iterations, ascii.isAsciiOnlyBitwiseOr));
    try results.append(try runBenchmark("SIMD16 Single", text, iterations, ascii.isAsciiOnlySIMD16SingleCmp));
    try results.append(try runBenchmark("SIMD32 Single", text, iterations, ascii.isAsciiOnlySIMD32SingleCmp));
    try results.append(try runBenchmark("SIMD16 Unrolled", text, iterations, ascii.isAsciiOnlySIMD16Unrolled));

    return results;
}

// Test file generation
const test_dir = "ascii-bench-tests";

fn generateAsciiTestFile(filename: []const u8, size: usize) !void {
    const file = try std.fs.cwd().createFile(filename, .{});
    defer file.close();

    var prng = std.Random.DefaultPrng.init(@intCast(std.time.timestamp()));
    const random = prng.random();

    var buf: [4096]u8 = undefined;
    var written: usize = 0;

    while (written < size) {
        const to_write = @min(buf.len, size - written);

        // Generate printable ASCII (32..126)
        for (buf[0..to_write]) |*b| {
            b.* = 32 + random.uintLessThan(u8, 95); // 32 + [0..95) = [32..126]
        }

        try file.writeAll(buf[0..to_write]);
        written += to_write;
    }
}

fn generateMixedTestFile(filename: []const u8, size: usize, ascii_percent: usize) !void {
    const file = try std.fs.cwd().createFile(filename, .{});
    defer file.close();

    var prng = std.Random.DefaultPrng.init(@intCast(std.time.timestamp()));
    const random = prng.random();

    var buf: [4096]u8 = undefined;
    var written: usize = 0;

    while (written < size) {
        const to_write = @min(buf.len, size - written);

        for (buf[0..to_write]) |*b| {
            if (random.uintLessThan(usize, 100) < ascii_percent) {
                // Printable ASCII
                b.* = 32 + random.uintLessThan(u8, 95);
            } else {
                // Non-printable or UTF-8
                const choice = random.uintLessThan(u8, 3);
                if (choice == 0) {
                    b.* = random.uintLessThan(u8, 32); // Control chars
                } else if (choice == 1) {
                    b.* = 127 + random.uintLessThan(u8, 129); // High bit set
                } else {
                    b.* = 127; // DEL
                }
            }
        }

        try file.writeAll(buf[0..to_write]);
        written += to_write;
    }
}

fn generateTestFiles(dir: []const u8, max_size_opt: ?usize) !void {
    const stdout = std.io.getStdOut().writer();

    // Create directory if it doesn't exist
    std.fs.cwd().makeDir(dir) catch |err| {
        if (err != error.PathAlreadyExists) return err;
    };

    const max_size = max_size_opt orelse (1024 * 1024 * 1024); // Default: 1GB
    const min_size: usize = 1024; // 1KB

    try stdout.print("Generating ASCII detection test files in '{s}/'\n", .{dir});
    try stdout.print("Size range: 1 KB to ", .{});
    try formatBytes(max_size, stdout);
    try stdout.writeAll("\n\n");

    // Generate files with exponential size growth
    var size = min_size;
    var count: usize = 0;

    while (size <= max_size and count < 16) : (count += 1) {
        var filename_buf: [256]u8 = undefined;

        // Pure ASCII file
        const filename_ascii = try std.fmt.bufPrint(&filename_buf, "{s}/ascii_100pct_{d:0>2}.txt", .{ dir, count });
        try stdout.print("  [{d:>2}] ", .{count});
        try formatBytes(size, stdout);
        try stdout.print(" - {s} (100% ASCII)...", .{filename_ascii});
        try generateAsciiTestFile(filename_ascii, size);
        try stdout.writeAll(" ✓\n");

        // Mixed 95% ASCII (fast rejection)
        const filename_mixed = try std.fmt.bufPrint(&filename_buf, "{s}/ascii_095pct_{d:0>2}.txt", .{ dir, count });
        try stdout.print("  [{d:>2}] ", .{count});
        try formatBytes(size, stdout);
        try stdout.print(" - {s} (95% ASCII)...", .{filename_mixed});
        try generateMixedTestFile(filename_mixed, size, 95);
        try stdout.writeAll(" ✓\n");

        // Grow exponentially
        if (size < 1024) {
            size *= 2;
        } else if (size < 1024 * 1024) {
            size *= 4;
        } else {
            size *= 2;
        }
    }

    try stdout.writeAll("\n✓ Test file generation complete!\n");
}

fn benchmarkAllTestFiles(allocator: std.mem.Allocator) !void {
    const stdout = std.io.getStdOut().writer();

    try stdout.writeAll("\n");
    try stdout.writeAll("=" ** 80);
    try stdout.writeAll("\n");
    try stdout.writeAll("BENCHMARKING ALL ASCII DETECTION TEST FILES\n");
    try stdout.writeAll("=" ** 80);
    try stdout.writeAll("\n\n");

    // Test both 100% and 95% ASCII files
    const variants = [_][]const u8{ "100pct", "095pct" };

    for (variants) |variant| {
        try stdout.print("\n>>> Testing {s} ASCII files\n\n", .{variant});

        var i: usize = 0;
        while (i < 16) : (i += 1) {
            var filename_buf: [256]u8 = undefined;
            const filename = try std.fmt.bufPrint(&filename_buf, "{s}/ascii_{s}_{d:0>2}.txt", .{ test_dir, variant, i });

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
                1000
            else if (file_size < 10 * 1024 * 1024) // < 10 MB
                100
            else if (file_size < 100 * 1024 * 1024) // < 100 MB
                20
            else
                5; // >= 100 MB

            try stdout.print("Running {d} iterations per method...\n\n", .{iterations});

            // Run benchmarks
            var results = try runAllBenchmarks(text, iterations, allocator);
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
            try stdout.print("{s:<20} {s:>12} {s:>12} {s:>8}\n", .{ "Method", "Avg Time", "Speedup", "Result" });
            for (results.items, 0..) |r, idx| {
                var buf: [32]u8 = undefined;
                var stream = std.io.fixedBufferStream(&buf);
                try formatNanoseconds(r.avg_time_ns, stream.writer());

                const speedup = @as(f64, @floatFromInt(fastest_time)) / @as(f64, @floatFromInt(r.avg_time_ns));
                try stdout.print("{s:<20} {s:>12} {d:>11.2}x {s:>8}", .{
                    r.name,
                    stream.getWritten(),
                    speedup,
                    if (r.result) "true" else "false",
                });

                if (idx == fastest_idx) {
                    try stdout.writeAll(" ⚡");
                }
                try stdout.writeAll("\n");
            }

            const throughput = (@as(f64, @floatFromInt(file_size)) / (1024.0 * 1024.0)) / (@as(f64, @floatFromInt(fastest_time)) / 1_000_000_000.0);
            try stdout.print("\nPeak throughput: {d:.2} MB/s\n\n", .{throughput});
        }
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
        try stderr.print("  {s} myfile.txt                     - Benchmark myfile.txt\n", .{args[0]});
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

        try generateTestFiles(test_dir, max_size);
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

    const iterations = 1000;
    try stdout.print("Running each method {d} times...\n\n", .{iterations});

    // Run all benchmarks
    var results = try runAllBenchmarks(text, iterations, allocator);
    defer results.deinit();

    // Print results
    try stdout.writeAll("\n");
    try stdout.writeAll("=" ** 80);
    try stdout.writeAll("\n");
    try stdout.writeAll("ASCII DETECTION BENCHMARK RESULTS\n");
    try stdout.writeAll("=" ** 80);
    try stdout.writeAll("\n\n");

    // Find fastest for comparison
    var fastest_time = results.items[0].avg_time_ns;
    for (results.items) |r| {
        if (r.avg_time_ns < fastest_time) {
            fastest_time = r.avg_time_ns;
        }
    }

    try stdout.print("{s:<20} {s:>15} {s:>15} {s:>12}\n", .{ "Method", "Total Time", "Avg Time", "Speedup" });
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
        try stdout.print("{d:>12.2}x", .{speedup});

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

    // Show result consistency
    try stdout.writeAll("\nResult Consistency Check:\n");
    const first_result = results.items[0].result;
    var all_match = true;
    for (results.items) |r| {
        if (r.result != first_result) {
            all_match = false;
            try stdout.print("  ⚠ {s}: {}\n", .{ r.name, r.result });
        }
    }
    if (all_match) {
        try stdout.print("  ✓ All methods agree: {}\n", .{first_result});
    }
}
