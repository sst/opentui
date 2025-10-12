//! UTF-8 Text Scanning Benchmark
//!
//! This program benchmarks various methods for scanning UTF-8 text
//! for line breaks (\n, \r, \r\n) as described in "Efficient UTF-8 Text Scanning in Zig".
//!
//! Methods benchmarked:
//! 1. Baseline Pure Loop - Simple byte-by-byte iteration
//! 2. Stdlib indexOfAny - Using Zig's optimized standard library functions
//! 3. SIMD 16-byte - Manual vectorization with 16-byte SIMD vectors
//! 4. SIMD 32-byte - Manual vectorization with 32-byte SIMD vectors
//! 5. Bitmask 128-byte - Zed editor-inspired bitmask approach
//! 6. Multithreaded - Parallel scanning with 2, 4, and 8 threads
//!
//! Usage:
//!   Build:
//!     zig build-exe utf8-scan-bench.zig -O ReleaseFast
//!
//!   Benchmark a file:
//!     ./utf8-scan-bench <file_path>
//!
//!   Generate test files:
//!     ./utf8-scan-bench --generate-tests [max_size]
//!
//!     By default, generates 16 files from 1KB to 1GB in exponential steps.
//!     Optional max_size parameter allows customizing the range:
//!       ./utf8-scan-bench --generate-tests 10M    # 1KB to 10MB
//!       ./utf8-scan-bench --generate-tests 100M   # 1KB to 100MB
//!       ./utf8-scan-bench --generate-tests 5MB    # 1KB to 5MB
//!
//!     Supported size suffixes: K/KB, M/MB, G/GB (case-insensitive)
//!
//!   Benchmark all generated files:
//!     ./utf8-scan-bench --bench-all
//!

const std = @import("std");
const builtin = @import("builtin");
const scan = @import("utf8-scan.zig");

// Re-export for convenience
const BreakResult = scan.BreakResult;

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

fn formatBytes(bytes: usize, writer: anytype) !void {
    if (bytes < 1024) {
        try writer.print("{d} B", .{bytes});
    } else if (bytes < 1024 * 1024) {
        try writer.print("{d:.2} KB", .{@as(f64, @floatFromInt(bytes)) / 1024.0});
    } else if (bytes < 1024 * 1024 * 1024) {
        try writer.print("{d:.2} MB", .{@as(f64, @floatFromInt(bytes)) / (1024.0 * 1024.0)});
    } else {
        try writer.print("{d:.2} GB", .{@as(f64, @floatFromInt(bytes)) / (1024.0 * 1024.0 * 1024.0)});
    }
}

fn parseSizeString(size_str: []const u8) !usize {
    if (size_str.len == 0) return error.InvalidSize;

    // Find where the number ends and suffix begins
    var num_end: usize = 0;
    while (num_end < size_str.len) : (num_end += 1) {
        const c = size_str[num_end];
        if (!std.ascii.isDigit(c) and c != '.') break;
    }

    if (num_end == 0) return error.InvalidSize;

    const num_str = size_str[0..num_end];
    const suffix = if (num_end < size_str.len) size_str[num_end..] else "";

    // Parse the number (support both integer and float)
    const base_value = if (std.mem.indexOfScalar(u8, num_str, '.')) |_|
        try std.fmt.parseFloat(f64, num_str)
    else
        @as(f64, @floatFromInt(try std.fmt.parseInt(usize, num_str, 10)));

    // Apply multiplier based on suffix
    const multiplier: f64 = if (suffix.len == 0)
        1.0
    else if (std.ascii.eqlIgnoreCase(suffix, "K") or std.ascii.eqlIgnoreCase(suffix, "KB"))
        1024.0
    else if (std.ascii.eqlIgnoreCase(suffix, "M") or std.ascii.eqlIgnoreCase(suffix, "MB"))
        1024.0 * 1024.0
    else if (std.ascii.eqlIgnoreCase(suffix, "G") or std.ascii.eqlIgnoreCase(suffix, "GB"))
        1024.0 * 1024.0 * 1024.0
    else
        return error.InvalidSizeSuffix;

    return @intFromFloat(base_value * multiplier);
}

// Common benchmark runner for all methods
fn runAllBenchmarks(
    text: []const u8,
    iterations: usize,
    allocator: std.mem.Allocator,
    comptime include_all_mt: bool,
) !std.ArrayList(BenchmarkResult) {
    var results = std.ArrayList(BenchmarkResult).init(allocator);
    errdefer results.deinit();

    try results.append(try runBenchmark("Baseline Pure Loop", text, iterations, allocator, scan.findLineBreaksBaseline));
    try results.append(try runBenchmark("Stdlib indexOfAny", text, iterations, allocator, scan.findLineBreaksStdLib));
    try results.append(try runBenchmark("SIMD 16-byte", text, iterations, allocator, scan.findLineBreaksSIMD16));
    try results.append(try runBenchmark("SIMD 32-byte", text, iterations, allocator, scan.findLineBreaksSIMD32));
    try results.append(try runBenchmark("Bitmask 128-byte", text, iterations, allocator, scan.findLineBreaksBitmask128));

    if (include_all_mt) {
        try results.append(try runBenchmarkWithAllocator("MT + Baseline", text, iterations, allocator, scan.findLineBreaksMultithreadedBaseline));
        try results.append(try runBenchmarkWithAllocator("MT + StdLib", text, iterations, allocator, scan.findLineBreaksMultithreadedStdLib));
        try results.append(try runBenchmarkWithAllocator("MT + SIMD16", text, iterations, allocator, scan.findLineBreaksMultithreadedSIMD16));
        try results.append(try runBenchmarkWithAllocator("MT + SIMD32", text, iterations, allocator, scan.findLineBreaksMultithreadedSIMD32));
        try results.append(try runBenchmarkWithAllocator("MT + Bitmask", text, iterations, allocator, scan.findLineBreaksMultithreadedBitmask128));

        // Fixed thread count variants (SIMD16 with 2, 4, 8 threads)
        const cpu_count = std.Thread.getCpuCount() catch 2;
        if (cpu_count >= 2) {
            try results.append(try runBenchmarkWithAllocator("MT + SIMD16 (2T)", text, iterations, allocator, scan.findLineBreaksMultithreadedSIMD16_2T));
        }
        if (cpu_count >= 4) {
            try results.append(try runBenchmarkWithAllocator("MT + SIMD16 (4T)", text, iterations, allocator, scan.findLineBreaksMultithreadedSIMD16_4T));
        }
        if (cpu_count >= 8) {
            try results.append(try runBenchmarkWithAllocator("MT + SIMD16 (8T)", text, iterations, allocator, scan.findLineBreaksMultithreadedSIMD16_8T));
        }
    } else {
        // For batch benchmarks, show thread scaling
        const cpu_count = std.Thread.getCpuCount() catch 2;
        if (cpu_count >= 2) {
            try results.append(try runBenchmarkWithAllocator("MT + SIMD16 (2T)", text, iterations, allocator, scan.findLineBreaksMultithreadedSIMD16_2T));
        }
        if (cpu_count >= 4) {
            try results.append(try runBenchmarkWithAllocator("MT + SIMD16 (4T)", text, iterations, allocator, scan.findLineBreaksMultithreadedSIMD16_4T));
        }
        if (cpu_count >= 8) {
            try results.append(try runBenchmarkWithAllocator("MT + SIMD16 (8T)", text, iterations, allocator, scan.findLineBreaksMultithreadedSIMD16_8T));
        }
    }

    return results;
}

// Test file generation
fn generateTestFiles(max_size_arg: ?usize) !void {
    const stdout = std.io.getStdOut().writer();

    // Create test directory
    const test_dir = "utf8-bench-tests";
    std.fs.cwd().makeDir(test_dir) catch |err| {
        if (err != error.PathAlreadyExists) return err;
    };

    // Sample text with various line break patterns
    const sample_text =
        "The quick brown fox jumps over the lazy dog.\n" ++
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n" ++
        "Windows uses CRLF line endings.\r\n" ++
        "Unix uses LF line endings.\n" ++
        "Classic Mac used CR line endings.\r" ++
        "UTF-8 text with various whitespace: tabs\tspaces  mixed.\n" ++
        "This is a longer line that simulates typical source code with multiple statements and expressions that might wrap.\n" ++
        "Short line\n" ++
        "\n" ++
        "Empty line above. Here's some more text to make the sample more realistic.\n";

    // Generate 16 files with exponentially increasing sizes
    const file_count = 16;
    const min_size: usize = 1024; // 1 KB
    const max_size: usize = max_size_arg orelse (1024 * 1024 * 1024); // Default 1 GB

    try stdout.print("Generating test files in '{s}/' (1 KB to ", .{test_dir});
    try formatBytes(max_size, stdout);
    try stdout.writeAll(")...\n\n");

    // Calculate growth factor: max_size = min_size * factor^(file_count-1)
    const growth_factor = std.math.pow(f64, @as(f64, @floatFromInt(max_size)) / @as(f64, @floatFromInt(min_size)), 1.0 / @as(f64, @floatFromInt(file_count - 1)));

    var i: usize = 0;
    while (i < file_count) : (i += 1) {
        const target_size = @as(usize, @intFromFloat(@as(f64, @floatFromInt(min_size)) * std.math.pow(f64, growth_factor, @as(f64, @floatFromInt(i)))));

        var filename_buf: [256]u8 = undefined;
        const filename = try std.fmt.bufPrint(&filename_buf, "{s}/test_{d:0>2}.txt", .{ test_dir, i });

        try stdout.print("Creating {s} (target: ", .{filename});
        try formatBytes(target_size, stdout);
        try stdout.writeAll(")...\n");

        const file = try std.fs.cwd().createFile(filename, .{});
        defer file.close();

        var buffered = std.io.bufferedWriter(file.writer());
        const writer = buffered.writer();

        var written: usize = 0;
        while (written < target_size) {
            const to_write = @min(sample_text.len, target_size - written);
            try writer.writeAll(sample_text[0..to_write]);
            written += to_write;
        }

        try buffered.flush();

        const actual_size = (try file.stat()).size;
        try stdout.writeAll("  Actual: ");
        try formatBytes(actual_size, stdout);
        try stdout.writeAll("\n");
    }

    try stdout.writeAll("\n✓ Test files generated successfully!\n");
}

fn benchmarkAllTestFiles(allocator: std.mem.Allocator) !void {
    const stdout = std.io.getStdOut().writer();
    const test_dir = "utf8-bench-tests";

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

        try generateTestFiles(max_size);
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
