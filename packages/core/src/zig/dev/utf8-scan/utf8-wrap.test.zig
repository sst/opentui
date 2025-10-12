//! UTF-8 Word Wrap Break Point Detection Test Suite
//!
//! This test suite validates all scanning methods produce identical results.
//!
//! Run with:
//!   cd packages/core/src/zig/dev/linebreak-scan
//!   zig test utf8-wrap.test.zig -O ReleaseFast
//!
//! Test coverage:
//! - Golden tests: Basic wrap point patterns with known expected outputs
//! - Boundary tests: Break points at 16/32/128-byte chunk boundaries
//! - Unicode tests: Multi-byte UTF-8 sequences adjacent to break points
//! - Consistency tests: All methods produce identical results on real text
//! - Property tests: Randomized inputs to catch edge cases

const std = @import("std");
const testing = std.testing;
const wrap = @import("utf8-wrap.zig");

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
        .name = "no breaks",
        .input = "abcdef",
        .expected = &[_]usize{},
    },
    .{
        .name = "single space",
        .input = "a b",
        .expected = &[_]usize{1},
    },
    .{
        .name = "multiple spaces",
        .input = "a b c",
        .expected = &[_]usize{ 1, 3 },
    },
    .{
        .name = "tab character",
        .input = "a\tb",
        .expected = &[_]usize{1},
    },
    .{
        .name = "newline",
        .input = "a\nb",
        .expected = &[_]usize{1},
    },
    .{
        .name = "carriage return",
        .input = "a\rb",
        .expected = &[_]usize{1},
    },
    .{
        .name = "dash",
        .input = "pre-post",
        .expected = &[_]usize{3},
    },
    .{
        .name = "forward slash",
        .input = "path/to/file",
        .expected = &[_]usize{ 4, 7 },
    },
    .{
        .name = "backslash",
        .input = "path\\to\\file",
        .expected = &[_]usize{ 4, 7 },
    },
    .{
        .name = "punctuation",
        .input = "Hello, world! How are you? Fine.",
        .expected = &[_]usize{ 5, 6, 12, 13, 17, 21, 25, 26, 31 },
    },
    .{
        .name = "brackets",
        .input = "(a)[b]{c}",
        .expected = &[_]usize{ 0, 2, 3, 5, 6, 8 },
    },
    .{
        .name = "mixed breaks",
        .input = "Hello, world! -path/file.",
        .expected = &[_]usize{ 5, 6, 12, 13, 14, 19, 24 },
    },
    .{
        .name = "consecutive spaces",
        .input = "a  b",
        .expected = &[_]usize{ 1, 2 },
    },
    .{
        .name = "only spaces",
        .input = "   ",
        .expected = &[_]usize{ 0, 1, 2 },
    },
    .{
        .name = "all break types",
        .input = " \t\r\n-/\\.,:;!?()[]{}",
        .expected = &[_]usize{ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18 },
    },
};

// Helper to run a single test case against a 2-arg method
fn testMethod(
    comptime method_name: []const u8,
    method_fn: *const fn ([]const u8, *wrap.BreakResult) anyerror!void,
    test_case: TestCase,
    allocator: std.mem.Allocator,
) !void {
    var result = wrap.BreakResult.init(allocator);
    defer result.deinit();

    try method_fn(test_case.input, &result);

    // Verify results
    if (result.breaks.items.len != test_case.expected.len) {
        std.debug.print("\n{s} FAILED on '{s}':\n", .{ method_name, test_case.name });
        std.debug.print("  Input: \"{s}\"\n", .{test_case.input});
        std.debug.print("  Expected {d} breaks, got {d}\n", .{ test_case.expected.len, result.breaks.items.len });
        std.debug.print("  Expected: {any}\n", .{test_case.expected});
        std.debug.print("  Got:      {any}\n", .{result.breaks.items});
        return error.TestFailed;
    }

    for (test_case.expected, 0..) |exp, i| {
        if (result.breaks.items[i] != exp) {
            std.debug.print("\n{s} FAILED on '{s}':\n", .{ method_name, test_case.name });
            std.debug.print("  Input: \"{s}\"\n", .{test_case.input});
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
    method_fn: *const fn ([]const u8, *wrap.BreakResult, std.mem.Allocator) anyerror!void,
    test_case: TestCase,
    allocator: std.mem.Allocator,
) !void {
    var result = wrap.BreakResult.init(allocator);
    defer result.deinit();

    try method_fn(test_case.input, &result, allocator);

    // Verify results
    if (result.breaks.items.len != test_case.expected.len) {
        std.debug.print("\n{s} FAILED on '{s}':\n", .{ method_name, test_case.name });
        std.debug.print("  Input: \"{s}\"\n", .{test_case.input});
        std.debug.print("  Expected {d} breaks, got {d}\n", .{ test_case.expected.len, result.breaks.items.len });
        std.debug.print("  Expected: {any}\n", .{test_case.expected});
        std.debug.print("  Got:      {any}\n", .{result.breaks.items});
        return error.TestFailed;
    }

    for (test_case.expected, 0..) |exp, i| {
        if (result.breaks.items[i] != exp) {
            std.debug.print("\n{s} FAILED on '{s}':\n", .{ method_name, test_case.name });
            std.debug.print("  Input: \"{s}\"\n", .{test_case.input});
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
    method_fn: *const fn ([]const u8, *wrap.BreakResult) anyerror!void,
    allocator: std.mem.Allocator,
) !void {
    for (golden_tests) |tc| {
        try testMethod(method_name, method_fn, tc, allocator);
    }
}

// Test all golden cases for a single 3-arg method
fn testAllGoldenMT(
    comptime method_name: []const u8,
    method_fn: *const fn ([]const u8, *wrap.BreakResult, std.mem.Allocator) anyerror!void,
    allocator: std.mem.Allocator,
) !void {
    for (golden_tests) |tc| {
        try testMethodMT(method_name, method_fn, tc, allocator);
    }
}

test "golden: baseline" {
    try testAllGolden("Baseline", wrap.findWrapBreaksBaseline, testing.allocator);
}

test "golden: stdlib" {
    try testAllGolden("StdLib", wrap.findWrapBreaksStdLib, testing.allocator);
}

test "golden: simd16" {
    try testAllGolden("SIMD16", wrap.findWrapBreaksSIMD16, testing.allocator);
}

test "golden: simd32" {
    try testAllGolden("SIMD32", wrap.findWrapBreaksSIMD32, testing.allocator);
}

test "golden: bitmask128" {
    try testAllGolden("Bitmask128", wrap.findWrapBreaksBitmask128, testing.allocator);
}

test "golden: mt_baseline" {
    try testAllGoldenMT("MT+Baseline", wrap.findWrapBreaksMultithreadedBaseline, testing.allocator);
}

test "golden: mt_stdlib" {
    try testAllGoldenMT("MT+StdLib", wrap.findWrapBreaksMultithreadedStdLib, testing.allocator);
}

test "golden: mt_simd16" {
    try testAllGoldenMT("MT+SIMD16", wrap.findWrapBreaksMultithreadedSIMD16, testing.allocator);
}

test "golden: mt_simd32" {
    try testAllGoldenMT("MT+SIMD32", wrap.findWrapBreaksMultithreadedSIMD32, testing.allocator);
}

test "golden: mt_bitmask128" {
    try testAllGoldenMT("MT+Bitmask128", wrap.findWrapBreaksMultithreadedBitmask128, testing.allocator);
}

// Boundary tests - break points at chunk boundaries
test "boundary: space at SIMD16 edge (15-16)" {
    var buf: [32]u8 = undefined;
    @memset(&buf, 'x');
    buf[15] = ' ';
    buf[16] = 'y';

    const expected = [_]usize{15};

    try testMethod("Baseline", wrap.findWrapBreaksBaseline, .{
        .name = "space@15",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);

    try testMethod("SIMD16", wrap.findWrapBreaksSIMD16, .{
        .name = "space@15",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);
}

test "boundary: dash at SIMD32 edge (31)" {
    var buf: [64]u8 = undefined;
    @memset(&buf, 'x');
    buf[31] = '-';

    const expected = [_]usize{31};

    try testMethod("Baseline", wrap.findWrapBreaksBaseline, .{
        .name = "dash@31",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);

    try testMethod("SIMD32", wrap.findWrapBreaksSIMD32, .{
        .name = "dash@31",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);
}

test "boundary: multiple breaks around SIMD16 boundary" {
    var buf: [32]u8 = undefined;
    @memset(&buf, 'x');
    buf[14] = ' ';
    buf[15] = '-';
    buf[16] = '/';
    buf[17] = '.';

    const expected = [_]usize{ 14, 15, 16, 17 };

    try testMethod("Baseline", wrap.findWrapBreaksBaseline, .{
        .name = "multi@boundary",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);

    try testMethod("SIMD16", wrap.findWrapBreaksSIMD16, .{
        .name = "multi@boundary",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);
}

test "boundary: breaks at bitmask128 edge (127-128)" {
    var buf: [256]u8 = undefined;
    @memset(&buf, 'x');
    buf[127] = ' ';
    buf[128] = '-';

    const expected = [_]usize{ 127, 128 };

    try testMethod("Baseline", wrap.findWrapBreaksBaseline, .{
        .name = "breaks@127-128",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);

    try testMethod("Bitmask128", wrap.findWrapBreaksBitmask128, .{
        .name = "breaks@127-128",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);
}

// Unicode-adjacent tests
test "unicode: multibyte adjacent to space" {
    const input = "é test"; // é is 2 bytes: 0xC3 0xA9
    const expected = [_]usize{2}; // Space at index 2

    try testMethod("Baseline", wrap.findWrapBreaksBaseline, .{
        .name = "é space",
        .input = input,
        .expected = &expected,
    }, testing.allocator);

    try testMethod("SIMD16", wrap.findWrapBreaksSIMD16, .{
        .name = "é space",
        .input = input,
        .expected = &expected,
    }, testing.allocator);
}

test "unicode: multibyte adjacent to dash" {
    const input = "漢-test"; // 漢 is 3 bytes: 0xE6 0xBC 0xA2
    const expected = [_]usize{3}; // Dash at index 3

    try testMethod("Baseline", wrap.findWrapBreaksBaseline, .{
        .name = "漢-",
        .input = input,
        .expected = &expected,
    }, testing.allocator);

    try testMethod("SIMD16", wrap.findWrapBreaksSIMD16, .{
        .name = "漢-",
        .input = input,
        .expected = &expected,
    }, testing.allocator);
}

test "unicode: multibyte at SIMD boundary without breaks" {
    var buf: [32]u8 = undefined;
    @memset(&buf, 0);

    // Place UTF-8 sequences around boundary
    const text = "Test世界Test";
    @memcpy(buf[0..text.len], text);

    const expected = [_]usize{}; // No breaks

    try testMethod("Baseline", wrap.findWrapBreaksBaseline, .{
        .name = "unicode@boundary",
        .input = buf[0..text.len],
        .expected = &expected,
    }, testing.allocator);

    try testMethod("SIMD16", wrap.findWrapBreaksSIMD16, .{
        .name = "unicode@boundary",
        .input = buf[0..text.len],
        .expected = &expected,
    }, testing.allocator);
}

// Consistency test: all methods produce identical results
fn testAllMethodsMatch(input: []const u8, allocator: std.mem.Allocator) !void {
    var baseline_result = wrap.BreakResult.init(allocator);
    defer baseline_result.deinit();
    try wrap.findWrapBreaksBaseline(input, &baseline_result);

    const methods = .{
        .{ "StdLib", wrap.findWrapBreaksStdLib },
        .{ "SIMD16", wrap.findWrapBreaksSIMD16 },
        .{ "SIMD32", wrap.findWrapBreaksSIMD32 },
        .{ "Bitmask128", wrap.findWrapBreaksBitmask128 },
    };

    inline for (methods) |method| {
        var result = wrap.BreakResult.init(allocator);
        defer result.deinit();
        try method[1](input, &result);

        if (result.breaks.items.len != baseline_result.breaks.items.len) {
            std.debug.print("\n{s} disagrees with Baseline:\n", .{method[0]});
            std.debug.print("  Input length: {d}\n", .{input.len});
            std.debug.print("  Input: \"{s}\"\n", .{input});
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
        "File paths: /usr/local/bin and C:\\Windows\\System32\n" ++
        "Punctuation test: Hello, world! How are you? I'm fine.\n" ++
        "Brackets test: (parentheses) [square] {curly}\n" ++
        "Dashes test: pre-dash post-dash multi-word-expression\n" ++
        "Mixed: Hello, /path/to-file.txt [done]!\n";

    try testAllMethodsMatch(sample_text, testing.allocator);
}

test "consistency: all methods match on edge cases" {
    const edge_cases = [_][]const u8{
        "",
        " ",
        "-",
        "/",
        "\\",
        ".",
        "(",
        ")",
        "   ",
        "---",
        "...",
        "a",
        "a" ** 100,
        "a" ** 1000,
        " " ** 100,
        "-" ** 100,
    };

    for (edge_cases) |input| {
        try testAllMethodsMatch(input, testing.allocator);
    }
}

// Randomized property test
test "property: random small buffers" {
    var prng = std.Random.DefaultPrng.init(42);
    const random = prng.random();

    const break_chars = " \t\r\n-/\\.,:;!?()[]{}";

    var i: usize = 0;
    while (i < 100) : (i += 1) {
        // Generate random buffer 16 to 2048 bytes
        const size = 16 + random.uintLessThan(usize, 2048 - 16);
        const buf = try testing.allocator.alloc(u8, size);
        defer testing.allocator.free(buf);

        // Fill with ASCII letters and randomly insert breaks
        for (buf) |*b| {
            const r = random.uintLessThan(u8, 100);
            if (r < 20) {
                // 20% chance of break character
                const break_idx = random.uintLessThan(usize, break_chars.len);
                b.* = break_chars[break_idx];
            } else {
                // 80% chance of regular letter
                b.* = 'a' + random.uintLessThan(u8, 26);
            }
        }

        try testAllMethodsMatch(buf, testing.allocator);
    }
}

// Large input test
test "consistency: large buffer" {
    const size = 10000;
    const buf = try testing.allocator.alloc(u8, size);
    defer testing.allocator.free(buf);

    // Create realistic text with periodic breaks
    for (buf, 0..) |*b, idx| {
        if (idx % 50 == 0) {
            b.* = ' ';
        } else if (idx % 100 == 0) {
            b.* = '\n';
        } else if (idx % 75 == 0) {
            b.* = '-';
        } else {
            b.* = 'a' + @as(u8, @intCast(idx % 26));
        }
    }

    try testAllMethodsMatch(buf, testing.allocator);
}
