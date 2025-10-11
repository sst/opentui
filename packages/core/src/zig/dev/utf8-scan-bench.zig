//! UTF-8 Text Scanning Benchmark
//!
//! This program implements and benchmarks various methods for scanning UTF-8 text
//! for line breaks (\n, \r, \r\n) as described in "Efficient UTF-8 Text Scanning in Zig".
//!
//! Methods implemented:
//! 1. Baseline Pure Loop - Simple byte-by-byte iteration
//! 2. Stdlib indexOfAny - Using Zig's optimized standard library functions
//! 3. SIMD 16-byte - Manual vectorization with 16-byte SIMD vectors
//! 4. SIMD 32-byte - Manual vectorization with 32-byte SIMD vectors
//! 5. Bitmask 128-byte - Zed editor-inspired bitmask approach
//! 6. Multithreaded - Parallel scanning across multiple CPU cores
//!
//! Usage:
//!   zig build-exe utf8-scan-bench.zig -O ReleaseFast
//!   ./utf8-scan-bench <file_path>           # Benchmark a specific file
//!   ./utf8-scan-bench --generate-tests      # Generate test files
//!   ./utf8-scan-bench --bench-all           # Run benchmarks on all test files
//!
//! The program loads the specified file once and runs each method 100 times,
//! collecting performance metrics and displaying a comparison table.

const std = @import("std");
const builtin = @import("builtin");

// Result structure to hold break positions
const BreakResult = struct {
    breaks: std.ArrayList(usize),

    fn init(allocator: std.mem.Allocator) BreakResult {
        return .{
            .breaks = std.ArrayList(usize).init(allocator),
        };
    }

    fn deinit(self: *BreakResult) void {
        self.breaks.deinit();
    }

    fn reset(self: *BreakResult) void {
        self.breaks.clearRetainingCapacity();
    }
};

// Method 1: Baseline pure loop - linear scan checking each byte
fn findLineBreaksBaseline(text: []const u8, result: *BreakResult) !void {
    result.reset();
    var i: usize = 0;
    while (i < text.len) : (i += 1) {
        const b = text[i];
        if (b == '\n') {
            try result.breaks.append(i);
        } else if (b == '\r') {
            // Handle CRLF (\r\n) as a single break
            if (i + 1 < text.len and text[i + 1] == '\n') {
                try result.breaks.append(i + 1);
                i += 1; // skip the '\n' part of CRLF
            } else {
                try result.breaks.append(i);
            }
        }
    }
}

// Method 2: Using std.mem.indexOfAny (optimized stdlib)
fn findLineBreaksStdLib(text: []const u8, result: *BreakResult) !void {
    result.reset();
    var pos: usize = 0;
    while (pos < text.len) {
        if (std.mem.indexOfAny(u8, text[pos..], &[_]u8{ '\r', '\n' })) |offset| {
            const idx = pos + offset;
            const b = text[idx];
            if (b == '\r') {
                // Check for CRLF
                if (idx + 1 < text.len and text[idx + 1] == '\n') {
                    try result.breaks.append(idx + 1);
                    pos = idx + 2;
                } else {
                    try result.breaks.append(idx);
                    pos = idx + 1;
                }
            } else {
                try result.breaks.append(idx);
                pos = idx + 1;
            }
        } else {
            break;
        }
    }
}

// Method 3: Manual SIMD vectorization
fn findLineBreaksSIMD(text: []const u8, result: *BreakResult) !void {
    result.reset();
    const vector_len = 16; // Use 16-byte vectors (SSE2/NEON compatible)
    const Vec = @Vector(vector_len, u8);

    // Prepare vector constants for '\n' and '\r'
    const vNL: Vec = @splat('\n');
    const vCR: Vec = @splat('\r');

    var pos: usize = 0;

    // Process full vector chunks
    while (pos + vector_len <= text.len) {
        const chunk: Vec = text[pos..][0..vector_len].*;
        const cmp_nl = chunk == vNL;
        const cmp_cr = chunk == vCR;

        // Check if any newline or CR found
        if (@reduce(.Or, cmp_nl) or @reduce(.Or, cmp_cr)) {
            // Found a match, scan this chunk byte-by-byte
            for (0..vector_len) |i| {
                const absolute_index = pos + i;
                const b = text[absolute_index];
                if (b == '\n') {
                    try result.breaks.append(absolute_index);
                } else if (b == '\r') {
                    // Check for CRLF
                    if (absolute_index + 1 < text.len and text[absolute_index + 1] == '\n') {
                        try result.breaks.append(absolute_index + 1);
                        if (i + 1 < vector_len) {
                            // Skip the \n in next iteration
                            pos = absolute_index + 2;
                            continue;
                        }
                    } else {
                        try result.breaks.append(absolute_index);
                    }
                }
            }
            pos += vector_len;
        } else {
            pos += vector_len;
        }
    }

    // Handle remaining bytes with scalar code
    while (pos < text.len) : (pos += 1) {
        const b = text[pos];
        if (b == '\n') {
            try result.breaks.append(pos);
        } else if (b == '\r') {
            if (pos + 1 < text.len and text[pos + 1] == '\n') {
                try result.breaks.append(pos + 1);
                pos += 1;
            } else {
                try result.breaks.append(pos);
            }
        }
    }
}

// Method 4: SIMD with wider vectors (32-byte for AVX2)
fn findLineBreaksSIMD32(text: []const u8, result: *BreakResult) !void {
    result.reset();
    const vector_len = 32; // Use 32-byte vectors (AVX2 compatible)
    const Vec = @Vector(vector_len, u8);

    const vNL: Vec = @splat('\n');
    const vCR: Vec = @splat('\r');

    var pos: usize = 0;

    while (pos + vector_len <= text.len) {
        const chunk: Vec = text[pos..][0..vector_len].*;
        const cmp_nl = chunk == vNL;
        const cmp_cr = chunk == vCR;

        // Check if any newline or CR found
        if (@reduce(.Or, cmp_nl) or @reduce(.Or, cmp_cr)) {
            // Found a match, scan this chunk byte-by-byte
            for (0..vector_len) |i| {
                const absolute_index = pos + i;
                const b = text[absolute_index];
                if (b == '\n') {
                    try result.breaks.append(absolute_index);
                } else if (b == '\r') {
                    // Check for CRLF
                    if (absolute_index + 1 < text.len and text[absolute_index + 1] == '\n') {
                        try result.breaks.append(absolute_index + 1);
                        if (i + 1 < vector_len) {
                            pos = absolute_index + 2;
                            continue;
                        }
                    } else {
                        try result.breaks.append(absolute_index);
                    }
                }
            }
            pos += vector_len;
        } else {
            pos += vector_len;
        }
    }

    // Handle tail
    while (pos < text.len) : (pos += 1) {
        const b = text[pos];
        if (b == '\n') {
            try result.breaks.append(pos);
        } else if (b == '\r') {
            if (pos + 1 < text.len and text[pos + 1] == '\n') {
                try result.breaks.append(pos + 1);
                pos += 1;
            } else {
                try result.breaks.append(pos);
            }
        }
    }
}

// Method 5: Multithreaded scanning (reusing existing methods)
const ThreadContext = struct {
    text: []const u8,
    start: usize,
    end: usize,
    result: BreakResult,
    allocator: std.mem.Allocator,
    scan_func: *const fn ([]const u8, *BreakResult) anyerror!void,
};

fn findBreaksInRangeGeneric(ctx: *ThreadContext) void {
    ctx.result = BreakResult.init(ctx.allocator);
    const segment = ctx.text[ctx.start..ctx.end];

    // Use the provided scan function on this segment
    ctx.scan_func(segment, &ctx.result) catch return;

    // Adjust all indices to absolute positions
    for (ctx.result.breaks.items) |*br| {
        br.* += ctx.start;
    }
}

fn rewindToCodepointBoundary(text: []const u8, pos: usize) usize {
    if (pos >= text.len) return text.len;
    var p = pos;
    // Rewind if we're in the middle of a UTF-8 sequence
    while (p > 0 and (text[p] & 0xC0) == 0x80) {
        p -= 1;
    }
    return p;
}

fn findLineBreaksMultithreadedGeneric(
    text: []const u8,
    result: *BreakResult,
    allocator: std.mem.Allocator,
    scan_func: *const fn ([]const u8, *BreakResult) anyerror!void,
) !void {
    result.reset();

    const thread_count = @min(std.Thread.getCpuCount() catch 4, 8);
    if (thread_count <= 1 or text.len < 1024) {
        // Fall back to single-threaded for small inputs
        return findLineBreaksBaseline(text, result);
    }

    const segment_len = (text.len + thread_count - 1) / thread_count;

    var contexts = try allocator.alloc(ThreadContext, thread_count);
    defer allocator.free(contexts);

    var threads = try allocator.alloc(std.Thread, thread_count);
    defer allocator.free(threads);

    var actual_threads: usize = 0;

    // Spawn threads
    for (0..thread_count) |i| {
        const start = i * segment_len;
        if (start >= text.len) break;

        var end = @min(text.len, start + segment_len);

        // Adjust end to codepoint boundary
        end = rewindToCodepointBoundary(text, end);

        // Handle CRLF split
        if (end < text.len and end > 0) {
            if (text[end] == '\n' and text[end - 1] == '\r') {
                end -= 1;
            }
        }

        contexts[i] = .{
            .text = text,
            .start = start,
            .end = end,
            .result = undefined,
            .allocator = allocator,
            .scan_func = scan_func,
        };

        threads[actual_threads] = try std.Thread.spawn(.{}, findBreaksInRangeGeneric, .{&contexts[i]});
        actual_threads += 1;
    }

    // Join threads and merge results
    for (0..actual_threads) |i| {
        threads[i].join();
        for (contexts[i].result.breaks.items) |br| {
            try result.breaks.append(br);
        }
        contexts[i].result.deinit();
    }

    // Sort results since they may be out of order
    std.mem.sort(usize, result.breaks.items, {}, std.sort.asc(usize));
}

fn findLineBreaksMultithreadedBaseline(text: []const u8, result: *BreakResult, allocator: std.mem.Allocator) !void {
    return findLineBreaksMultithreadedGeneric(text, result, allocator, findLineBreaksBaseline);
}

fn findLineBreaksMultithreadedStdLib(text: []const u8, result: *BreakResult, allocator: std.mem.Allocator) !void {
    return findLineBreaksMultithreadedGeneric(text, result, allocator, findLineBreaksStdLib);
}

fn findLineBreaksMultithreadedSIMD16(text: []const u8, result: *BreakResult, allocator: std.mem.Allocator) !void {
    return findLineBreaksMultithreadedGeneric(text, result, allocator, findLineBreaksSIMD);
}

fn findLineBreaksMultithreadedSIMD32(text: []const u8, result: *BreakResult, allocator: std.mem.Allocator) !void {
    return findLineBreaksMultithreadedGeneric(text, result, allocator, findLineBreaksSIMD32);
}

fn findLineBreaksMultithreadedBitmask(text: []const u8, result: *BreakResult, allocator: std.mem.Allocator) !void {
    return findLineBreaksMultithreadedGeneric(text, result, allocator, findLineBreaksBitmask);
}

// Method 6: Bitmask approach (inspired by Zed editor)
fn findLineBreaksBitmask(text: []const u8, result: *BreakResult) !void {
    result.reset();
    const chunk_size = 128;

    var pos: usize = 0;
    while (pos < text.len) {
        const end = @min(pos + chunk_size, text.len);
        const chunk = text[pos..end];

        var mask: u128 = 0;
        for (chunk, 0..) |b, i| {
            if (b == '\n' or b == '\r') {
                mask |= @as(u128, 1) << @intCast(i);
            }
        }

        // Process the mask to find break positions
        while (mask != 0) {
            const bit_pos = @ctz(mask);
            const absolute_pos = pos + bit_pos;

            const b = text[absolute_pos];
            if (b == '\r') {
                if (absolute_pos + 1 < text.len and text[absolute_pos + 1] == '\n') {
                    try result.breaks.append(absolute_pos + 1);
                    // Clear both the \r and \n bits if \n is in this chunk
                    if (absolute_pos + 1 < end) {
                        mask &= ~(@as(u128, 1) << @intCast(bit_pos + 1));
                    }
                } else {
                    try result.breaks.append(absolute_pos);
                }
            } else {
                try result.breaks.append(absolute_pos);
            }

            mask &= ~(@as(u128, 1) << @intCast(bit_pos));
        }

        pos = end;
    }
}

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

// Common benchmark runner for all methods
fn runAllBenchmarks(
    text: []const u8,
    iterations: usize,
    allocator: std.mem.Allocator,
    comptime include_all_mt: bool,
) !std.ArrayList(BenchmarkResult) {
    var results = std.ArrayList(BenchmarkResult).init(allocator);
    errdefer results.deinit();

    try results.append(try runBenchmark("Baseline Pure Loop", text, iterations, allocator, findLineBreaksBaseline));
    try results.append(try runBenchmark("Stdlib indexOfAny", text, iterations, allocator, findLineBreaksStdLib));
    try results.append(try runBenchmark("SIMD 16-byte", text, iterations, allocator, findLineBreaksSIMD));
    try results.append(try runBenchmark("SIMD 32-byte", text, iterations, allocator, findLineBreaksSIMD32));
    try results.append(try runBenchmark("Bitmask 128-byte", text, iterations, allocator, findLineBreaksBitmask));

    if (include_all_mt) {
        try results.append(try runBenchmarkWithAllocator("MT + Baseline", text, iterations, allocator, findLineBreaksMultithreadedBaseline));
        try results.append(try runBenchmarkWithAllocator("MT + StdLib", text, iterations, allocator, findLineBreaksMultithreadedStdLib));
        try results.append(try runBenchmarkWithAllocator("MT + SIMD16", text, iterations, allocator, findLineBreaksMultithreadedSIMD16));
        try results.append(try runBenchmarkWithAllocator("MT + SIMD32", text, iterations, allocator, findLineBreaksMultithreadedSIMD32));
        try results.append(try runBenchmarkWithAllocator("MT + Bitmask", text, iterations, allocator, findLineBreaksMultithreadedBitmask));
    } else {
        // For batch benchmarks, only include the best single-threaded and best multithreaded
        try results.append(try runBenchmarkWithAllocator("MT + SIMD16", text, iterations, allocator, findLineBreaksMultithreadedSIMD16));
    }

    return results;
}

// Test file generation
fn generateTestFiles() !void {
    const stdout = std.io.getStdOut().writer();

    // Create test directory
    const test_dir = "utf8-bench-tests";
    std.fs.cwd().makeDir(test_dir) catch |err| {
        if (err != error.PathAlreadyExists) return err;
    };

    try stdout.print("Generating test files in '{s}/'...\n\n", .{test_dir});

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
    // Starting from 1 KB up to 1 GB
    const file_count = 16;
    const min_size: usize = 1024; // 1 KB
    const max_size: usize = 1024 * 1024 * 1024; // 1 GB

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
        try stderr.print("  {s} <file_path>        - Benchmark a specific file\n", .{args[0]});
        try stderr.print("  {s} --generate-tests   - Generate test files\n", .{args[0]});
        try stderr.print("  {s} --bench-all        - Benchmark all test files\n", .{args[0]});
        std.process.exit(1);
    }

    const command = args[1];

    // Handle special commands
    if (std.mem.eql(u8, command, "--generate-tests")) {
        try generateTestFiles();
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
