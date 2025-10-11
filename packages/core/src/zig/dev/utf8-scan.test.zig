//! UTF-8 Text Scanning Correctness Test Suite
//!
//! This test suite validates all scanning methods produce identical results.
//!
//! Run with:
//!   cd packages/core/src/zig/dev
//!   zig test utf8-scan.test.zig -O ReleaseFast
//!
//! Test coverage:
//! - Golden tests: Basic CR/LF/CRLF patterns with known expected outputs
//! - Boundary tests: CRLF split across 16/32/128-byte chunk boundaries
//! - Unicode tests: Multi-byte UTF-8 sequences adjacent to line breaks
//! - Consistency tests: All methods produce identical results on real text
//! - Property tests: Randomized inputs to catch edge cases

const std = @import("std");
const testing = std.testing;
const scan = @import("utf8-scan.zig");

// Test case structure
const TestCase = struct {
    name: []const u8,
    input: []const u8,
    expected: []const usize,
};

// Golden test cases
const golden_tests = [_]TestCase{
    .{
        .name = "empty string",
        .input = "",
        .expected = &[_]usize{},
    },
    .{
        .name = "only LF",
        .input = "a\nb",
        .expected = &[_]usize{1},
    },
    .{
        .name = "only CR",
        .input = "a\rb",
        .expected = &[_]usize{1},
    },
    .{
        .name = "CRLF",
        .input = "a\r\nb",
        .expected = &[_]usize{2}, // CRLF recorded at \n index
    },
    .{
        .name = "ending with CR",
        .input = "a\r",
        .expected = &[_]usize{1},
    },
    .{
        .name = "ending with LF",
        .input = "a\n",
        .expected = &[_]usize{1},
    },
    .{
        .name = "ending with CRLF",
        .input = "a\r\n",
        .expected = &[_]usize{2},
    },
    .{
        .name = "consecutive LF",
        .input = "\n\n",
        .expected = &[_]usize{ 0, 1 },
    },
    .{
        .name = "consecutive CRLF",
        .input = "\r\n\r\n",
        .expected = &[_]usize{ 1, 3 },
    },
    .{
        .name = "mixed breaks",
        .input = "\n\r\n\r",
        .expected = &[_]usize{ 0, 2, 3 },
    },
    .{
        .name = "CR LF separate",
        .input = "\r\r\n",
        .expected = &[_]usize{ 0, 2 },
    },
    .{
        .name = "very long line no breaks",
        .input = "a" ** 1000,
        .expected = &[_]usize{},
    },
    .{
        .name = "multiple LF",
        .input = "line1\nline2\nline3\n",
        .expected = &[_]usize{ 5, 11, 17 },
    },
    .{
        .name = "multiple CRLF",
        .input = "line1\r\nline2\r\nline3\r\n",
        .expected = &[_]usize{ 6, 13, 20 },
    },
    .{
        .name = "mixed line endings",
        .input = "unix\nmac\rwin\r\n",
        .expected = &[_]usize{ 4, 8, 13 },
    },
};

// Helper to run a single test case against a 2-arg method
fn testMethod(
    comptime method_name: []const u8,
    method_fn: *const fn ([]const u8, *scan.BreakResult) anyerror!void,
    test_case: TestCase,
    allocator: std.mem.Allocator,
) !void {
    var result = scan.BreakResult.init(allocator);
    defer result.deinit();

    try method_fn(test_case.input, &result);

    // Verify results
    if (result.breaks.items.len != test_case.expected.len) {
        std.debug.print("\n{s} FAILED on '{s}':\n", .{ method_name, test_case.name });
        std.debug.print("  Expected {d} breaks, got {d}\n", .{ test_case.expected.len, result.breaks.items.len });
        std.debug.print("  Expected: {any}\n", .{test_case.expected});
        std.debug.print("  Got:      {any}\n", .{result.breaks.items});
        return error.TestFailed;
    }

    for (test_case.expected, 0..) |exp, i| {
        if (result.breaks.items[i] != exp) {
            std.debug.print("\n{s} FAILED on '{s}':\n", .{ method_name, test_case.name });
            std.debug.print("  Break {d}: expected {d}, got {d}\n", .{ i, exp, result.breaks.items[i] });
            std.debug.print("  Expected: {any}\n", .{test_case.expected});
            std.debug.print("  Got:      {any}\n", .{result.breaks.items});
            return error.TestFailed;
        }
    }
}

// Helper to run a single test case against a 3-arg method (multithreaded)
fn testMethodMT(
    comptime method_name: []const u8,
    method_fn: *const fn ([]const u8, *scan.BreakResult, std.mem.Allocator) anyerror!void,
    test_case: TestCase,
    allocator: std.mem.Allocator,
) !void {
    var result = scan.BreakResult.init(allocator);
    defer result.deinit();

    try method_fn(test_case.input, &result, allocator);

    // Verify results
    if (result.breaks.items.len != test_case.expected.len) {
        std.debug.print("\n{s} FAILED on '{s}':\n", .{ method_name, test_case.name });
        std.debug.print("  Expected {d} breaks, got {d}\n", .{ test_case.expected.len, result.breaks.items.len });
        std.debug.print("  Expected: {any}\n", .{test_case.expected});
        std.debug.print("  Got:      {any}\n", .{result.breaks.items});
        return error.TestFailed;
    }

    for (test_case.expected, 0..) |exp, i| {
        if (result.breaks.items[i] != exp) {
            std.debug.print("\n{s} FAILED on '{s}':\n", .{ method_name, test_case.name });
            std.debug.print("  Break {d}: expected {d}, got {d}\n", .{ i, exp, result.breaks.items[i] });
            std.debug.print("  Expected: {any}\n", .{test_case.expected});
            std.debug.print("  Got:      {any}\n", .{result.breaks.items});
            return error.TestFailed;
        }
    }
}

// Test all golden cases for a single 2-arg method
fn testAllGolden(
    comptime method_name: []const u8,
    method_fn: *const fn ([]const u8, *scan.BreakResult) anyerror!void,
    allocator: std.mem.Allocator,
) !void {
    for (golden_tests) |tc| {
        try testMethod(method_name, method_fn, tc, allocator);
    }
}

// Test all golden cases for a single 3-arg method
fn testAllGoldenMT(
    comptime method_name: []const u8,
    method_fn: *const fn ([]const u8, *scan.BreakResult, std.mem.Allocator) anyerror!void,
    allocator: std.mem.Allocator,
) !void {
    for (golden_tests) |tc| {
        try testMethodMT(method_name, method_fn, tc, allocator);
    }
}

test "golden: baseline" {
    try testAllGolden("Baseline", scan.findLineBreaksBaseline, testing.allocator);
}

test "golden: stdlib" {
    try testAllGolden("StdLib", scan.findLineBreaksStdLib, testing.allocator);
}

test "golden: simd16" {
    try testAllGolden("SIMD16", scan.findLineBreaksSIMD16, testing.allocator);
}

test "golden: simd32" {
    try testAllGolden("SIMD32", scan.findLineBreaksSIMD32, testing.allocator);
}

test "golden: bitmask128" {
    try testAllGolden("Bitmask128", scan.findLineBreaksBitmask128, testing.allocator);
}

test "golden: mt_baseline" {
    try testAllGoldenMT("MT+Baseline", scan.findLineBreaksMultithreadedBaseline, testing.allocator);
}

test "golden: mt_stdlib" {
    try testAllGoldenMT("MT+StdLib", scan.findLineBreaksMultithreadedStdLib, testing.allocator);
}

test "golden: mt_simd16" {
    try testAllGoldenMT("MT+SIMD16", scan.findLineBreaksMultithreadedSIMD16, testing.allocator);
}

test "golden: mt_simd32" {
    try testAllGoldenMT("MT+SIMD32", scan.findLineBreaksMultithreadedSIMD32, testing.allocator);
}

test "golden: mt_bitmask128" {
    try testAllGoldenMT("MT+Bitmask128", scan.findLineBreaksMultithreadedBitmask128, testing.allocator);
}

// Boundary tests - CRLF split across chunk boundaries
test "boundary: CRLF at SIMD16 edge (15-16)" {
    // Place \r at index 15, \n at 16
    var buf: [32]u8 = undefined;
    @memset(&buf, 'x');
    buf[15] = '\r';
    buf[16] = '\n';

    const expected = [_]usize{16}; // CRLF should be at \n index

    try testMethod("Baseline", scan.findLineBreaksBaseline, .{
        .name = "CRLF@15-16",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);

    try testMethod("SIMD16", scan.findLineBreaksSIMD16, .{
        .name = "CRLF@15-16",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);

    try testMethod("SIMD32", scan.findLineBreaksSIMD32, .{
        .name = "CRLF@15-16",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);
}

test "boundary: CRLF at SIMD32 edge (31-32)" {
    // Place \r at index 31, \n at 32
    var buf: [64]u8 = undefined;
    @memset(&buf, 'x');
    buf[31] = '\r';
    buf[32] = '\n';

    const expected = [_]usize{32}; // CRLF should be at \n index

    try testMethod("Baseline", scan.findLineBreaksBaseline, .{
        .name = "CRLF@31-32",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);

    try testMethod("SIMD32", scan.findLineBreaksSIMD32, .{
        .name = "CRLF@31-32",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);
}

test "boundary: CRLF at bitmask128 edge (127-128)" {
    // Place \r at index 127, \n at 128
    var buf: [256]u8 = undefined;
    @memset(&buf, 'x');
    buf[127] = '\r';
    buf[128] = '\n';

    const expected = [_]usize{128}; // CRLF should be at \n index

    try testMethod("Baseline", scan.findLineBreaksBaseline, .{
        .name = "CRLF@127-128",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);

    try testMethod("Bitmask128", scan.findLineBreaksBitmask128, .{
        .name = "CRLF@127-128",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);
}

test "boundary: multiple breaks around SIMD16 boundary" {
    // Place breaks near boundary to test edge handling
    var buf: [32]u8 = undefined;
    @memset(&buf, 'x');
    buf[14] = '\n';
    buf[15] = '\r';
    buf[16] = '\n';
    buf[17] = '\n';

    const expected = [_]usize{ 14, 16, 17 }; // 15-16 is CRLF

    try testMethod("Baseline", scan.findLineBreaksBaseline, .{
        .name = "multi@boundary",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);

    try testMethod("SIMD16", scan.findLineBreaksSIMD16, .{
        .name = "multi@boundary",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);
}

// Unicode-adjacent tests
test "unicode: multibyte adjacent to LF" {
    const input = "é\n"; // é is 2 bytes: 0xC3 0xA9
    const expected = [_]usize{2}; // LF at index 2

    try testMethod("Baseline", scan.findLineBreaksBaseline, .{
        .name = "é\\n",
        .input = input,
        .expected = &expected,
    }, testing.allocator);

    try testMethod("SIMD16", scan.findLineBreaksSIMD16, .{
        .name = "é\\n",
        .input = input,
        .expected = &expected,
    }, testing.allocator);
}

test "unicode: multibyte adjacent to CRLF" {
    const input = "漢\r\n"; // 漢 is 3 bytes: 0xE6 0xBC 0xA2
    const expected = [_]usize{4}; // \n at index 4

    try testMethod("Baseline", scan.findLineBreaksBaseline, .{
        .name = "漢\\r\\n",
        .input = input,
        .expected = &expected,
    }, testing.allocator);

    try testMethod("SIMD16", scan.findLineBreaksSIMD16, .{
        .name = "漢\\r\\n",
        .input = input,
        .expected = &expected,
    }, testing.allocator);
}

test "unicode: multibyte at SIMD boundary without breaks" {
    // Ensure no spurious matches in multibyte sequences
    var buf: [32]u8 = undefined;
    @memset(&buf, 0);

    // Place UTF-8 sequences around boundary (position 14-17)
    // "Test" (4 bytes) + "世界" (6 bytes, each char is 3) + "Test" (4 bytes)
    const text = "Test世界Test";
    @memcpy(buf[0..text.len], text);

    const expected = [_]usize{}; // No breaks

    try testMethod("Baseline", scan.findLineBreaksBaseline, .{
        .name = "unicode@boundary",
        .input = buf[0..text.len],
        .expected = &expected,
    }, testing.allocator);

    try testMethod("SIMD16", scan.findLineBreaksSIMD16, .{
        .name = "unicode@boundary",
        .input = buf[0..text.len],
        .expected = &expected,
    }, testing.allocator);
}

// Consistency test: all methods produce identical results
fn testAllMethodsMatch(input: []const u8, allocator: std.mem.Allocator) !void {
    var baseline_result = scan.BreakResult.init(allocator);
    defer baseline_result.deinit();
    try scan.findLineBreaksBaseline(input, &baseline_result);

    const methods = .{
        .{ "StdLib", scan.findLineBreaksStdLib },
        .{ "SIMD16", scan.findLineBreaksSIMD16 },
        .{ "SIMD32", scan.findLineBreaksSIMD32 },
        .{ "Bitmask128", scan.findLineBreaksBitmask128 },
    };

    inline for (methods) |method| {
        var result = scan.BreakResult.init(allocator);
        defer result.deinit();
        try method[1](input, &result);

        if (result.breaks.items.len != baseline_result.breaks.items.len) {
            std.debug.print("\n{s} disagrees with Baseline:\n", .{method[0]});
            std.debug.print("  Input length: {d}\n", .{input.len});
            std.debug.print("  Baseline: {any}\n", .{baseline_result.breaks.items});
            std.debug.print("  {s}: {any}\n", .{ method[0], result.breaks.items });
            return error.MethodMismatch;
        }

        for (baseline_result.breaks.items, 0..) |exp, i| {
            if (result.breaks.items[i] != exp) {
                std.debug.print("\n{s} disagrees with Baseline at position {d}:\n", .{ method[0], i });
                std.debug.print("  Expected {d}, got {d}\n", .{ exp, result.breaks.items[i] });
                return error.MethodMismatch;
            }
        }
    }
}

test "consistency: all methods match on realistic text" {
    const sample_text =
        "The quick brown fox jumps over the lazy dog.\n" ++
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n" ++
        "Windows uses CRLF line endings.\r\n" ++
        "Unix uses LF line endings.\n" ++
        "Classic Mac used CR line endings.\r" ++
        "UTF-8 text: 世界 こんにちは\n" ++
        "Multiple\n\nEmpty\n\n\nLines\n" ++
        "Mixed\r\nendings\nhere\r";

    try testAllMethodsMatch(sample_text, testing.allocator);
}

test "consistency: all methods match on edge cases" {
    const edge_cases = [_][]const u8{
        "",
        "\n",
        "\r",
        "\r\n",
        "\n\n\n",
        "\r\r\r",
        "\r\n\r\n\r\n",
        "a",
        "a" ** 100,
        "a" ** 1000,
    };

    for (edge_cases) |input| {
        try testAllMethodsMatch(input, testing.allocator);
    }
}

// Randomized property test
test "property: random small buffers" {
    var prng = std.Random.DefaultPrng.init(42);
    const random = prng.random();

    var i: usize = 0;
    while (i < 100) : (i += 1) {
        // Generate random buffer 16 to 8192 bytes
        const size = 16 + random.uintLessThan(usize, 8192 - 16);
        const buf = try testing.allocator.alloc(u8, size);
        defer testing.allocator.free(buf);

        // Fill with ASCII letters and randomly insert breaks
        for (buf) |*b| {
            const r = random.uintLessThan(u8, 100);
            if (r < 5) {
                b.* = '\n';
            } else if (r < 10) {
                b.* = '\r';
            } else {
                b.* = 'a' + random.uintLessThan(u8, 26);
            }
        }

        try testAllMethodsMatch(buf, testing.allocator);
    }
}

// Large file test (uses generated test files from benchmark)
test "real-world: large file consistency" {
    // Try to load one of the generated test files
    const test_file_path = "utf8-bench-tests/test_05.txt";
    const file = std.fs.cwd().openFile(test_file_path, .{}) catch |err| {
        if (err == error.FileNotFound) {
            std.debug.print("\nSkipping large file test (test files not found)\n", .{});
            std.debug.print("Generate test files with: zig build-exe utf8-scan-bench.zig -O ReleaseFast && ./utf8-scan-bench --generate-tests\n", .{});
            return;
        }
        return err;
    };
    defer file.close();

    // Limit read to first 1 MB to keep test reasonable
    const max_size = 1024 * 1024;
    const text = try file.readToEndAlloc(testing.allocator, max_size);
    defer testing.allocator.free(text);

    std.debug.print("\nTesting on {d} bytes from {s}...\n", .{ text.len, test_file_path });
    try testAllMethodsMatch(text, testing.allocator);
}
