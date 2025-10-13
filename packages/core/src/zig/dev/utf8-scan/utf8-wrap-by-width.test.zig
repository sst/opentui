//! UTF-8 Width-Aware Word Wrap Position Finding Test Suite

const std = @import("std");
const testing = std.testing;
const wrap = @import("utf8-wrap-by-width.zig");

const TestCase = struct {
    name: []const u8,
    input: []const u8,
    max_columns: u32,
    tab_width: u8,
    expected_byte_offset: u32,
    expected_grapheme_count: u32,
    expected_columns_used: u32,
};

fn testMethod(
    comptime method_name: []const u8,
    method_fn: *const fn ([]const u8, u32, u8) wrap.WrapByWidthResult,
    test_case: TestCase,
) !void {
    const result = method_fn(test_case.input, test_case.max_columns, test_case.tab_width);

    if (result.byte_offset != test_case.expected_byte_offset or
        result.grapheme_count != test_case.expected_grapheme_count or
        result.columns_used != test_case.expected_columns_used)
    {
        std.debug.print("\n{s} FAILED on '{s}':\n", .{ method_name, test_case.name });
        std.debug.print("  Input: \"{s}\"\n", .{test_case.input});
        std.debug.print("  Max columns: {d}\n", .{test_case.max_columns});
        std.debug.print("  Expected: byte={d} graphemes={d} cols={d}\n", .{
            test_case.expected_byte_offset,
            test_case.expected_grapheme_count,
            test_case.expected_columns_used,
        });
        std.debug.print("  Got:      byte={d} graphemes={d} cols={d}\n", .{
            result.byte_offset,
            result.grapheme_count,
            result.columns_used,
        });
        return error.TestFailed;
    }
}

test "golden: empty string" {
    const tc = TestCase{
        .name = "empty",
        .input = "",
        .max_columns = 10,
        .tab_width = 4,
        .expected_byte_offset = 0,
        .expected_grapheme_count = 0,
        .expected_columns_used = 0,
    };
    try testMethod("Baseline", wrap.findWrapPosByWidthBaseline, tc);
    try testMethod("SIMD16", wrap.findWrapPosByWidthSIMD16, tc);
}

test "golden: simple ASCII no wrap" {
    const tc = TestCase{
        .name = "fits",
        .input = "hello",
        .max_columns = 10,
        .tab_width = 4,
        .expected_byte_offset = 5,
        .expected_grapheme_count = 5,
        .expected_columns_used = 5,
    };
    try testMethod("Baseline", wrap.findWrapPosByWidthBaseline, tc);
    try testMethod("SIMD16", wrap.findWrapPosByWidthSIMD16, tc);
}

test "golden: ASCII wrap exactly at limit" {
    const tc = TestCase{
        .name = "exact",
        .input = "hello",
        .max_columns = 5,
        .tab_width = 4,
        .expected_byte_offset = 5,
        .expected_grapheme_count = 5,
        .expected_columns_used = 5,
    };
    try testMethod("Baseline", wrap.findWrapPosByWidthBaseline, tc);
    try testMethod("SIMD16", wrap.findWrapPosByWidthSIMD16, tc);
}

test "golden: ASCII wrap before limit" {
    const tc = TestCase{
        .name = "wrap",
        .input = "hello world",
        .max_columns = 7,
        .tab_width = 4,
        .expected_byte_offset = 7,
        .expected_grapheme_count = 7,
        .expected_columns_used = 7,
    };
    try testMethod("Baseline", wrap.findWrapPosByWidthBaseline, tc);
    try testMethod("SIMD16", wrap.findWrapPosByWidthSIMD16, tc);
}

test "golden: East Asian wide char" {
    const tc = TestCase{
        .name = "CJK",
        .input = "世界",
        .max_columns = 3,
        .tab_width = 4,
        .expected_byte_offset = 3, // After first char
        .expected_grapheme_count = 1,
        .expected_columns_used = 2,
    };
    try testMethod("Baseline", wrap.findWrapPosByWidthBaseline, tc);
    try testMethod("SIMD16", wrap.findWrapPosByWidthSIMD16, tc);
}

test "golden: combining mark" {
    const tc = TestCase{
        .name = "combining",
        .input = "e\u{0301}test",
        .max_columns = 3,
        .tab_width = 4,
        .expected_byte_offset = 5, // After "é" (3 bytes) + "te" (2 bytes)
        .expected_grapheme_count = 3,
        .expected_columns_used = 3,
    };
    try testMethod("Baseline", wrap.findWrapPosByWidthBaseline, tc);
    try testMethod("SIMD16", wrap.findWrapPosByWidthSIMD16, tc);
}

test "golden: tab handling" {
    const tc = TestCase{
        .name = "tab",
        .input = "a\tb",
        .max_columns = 5,
        .tab_width = 4,
        .expected_byte_offset = 3,
        .expected_grapheme_count = 3,
        .expected_columns_used = 5, // 'a' (1) + tab to 4 (3) + 'b' (1) = 5
    };
    try testMethod("Baseline", wrap.findWrapPosByWidthBaseline, tc);
    try testMethod("SIMD16", wrap.findWrapPosByWidthSIMD16, tc);
}

fn testAllMethodsMatch(input: []const u8, max_columns: u32, tab_width: u8) !void {
    const baseline = wrap.findWrapPosByWidthBaseline(input, max_columns, tab_width);
    const simd16 = wrap.findWrapPosByWidthSIMD16(input, max_columns, tab_width);

    if (baseline.byte_offset != simd16.byte_offset or
        baseline.grapheme_count != simd16.grapheme_count or
        baseline.columns_used != simd16.columns_used)
    {
        std.debug.print("\nMethod mismatch:\n", .{});
        std.debug.print("  Input: \"{s}\"\n", .{input});
        std.debug.print("  Max columns: {d}\n", .{max_columns});
        std.debug.print("  Baseline: byte={d} graphemes={d} cols={d}\n", .{
            baseline.byte_offset,
            baseline.grapheme_count,
            baseline.columns_used,
        });
        std.debug.print("  SIMD16:   byte={d} graphemes={d} cols={d}\n", .{
            simd16.byte_offset,
            simd16.grapheme_count,
            simd16.columns_used,
        });
        return error.MethodMismatch;
    }
}

test "consistency: realistic text" {
    const sample_text =
        "The quick brown fox jumps over the lazy dog. " ++
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. " ++
        "File paths: /usr/local/bin and C:\\Windows\\System32. " ++
        "Punctuation test: Hello, world! How are you? I'm fine.";

    const widths = [_]u32{ 10, 20, 40, 80, 120 };
    for (widths) |w| {
        try testAllMethodsMatch(sample_text, w, 4);
    }
}

test "consistency: Unicode text" {
    const unicode_text = "世界 こんにちは test 你好 CJK-mixed";

    const widths = [_]u32{ 5, 10, 15, 20, 30 };
    for (widths) |w| {
        try testAllMethodsMatch(unicode_text, w, 4);
    }
}

test "consistency: edge cases" {
    const edge_cases = [_][]const u8{
        "",
        " ",
        "a",
        "abc",
        "   ",
        "a b c d e",
        "no-spaces-here",
        "/usr/local/bin",
        "世界",
        "\t\t\t",
    };

    for (edge_cases) |input| {
        const widths = [_]u32{ 1, 5, 10, 20 };
        for (widths) |w| {
            try testAllMethodsMatch(input, w, 4);
        }
    }
}

test "property: random ASCII buffers" {
    var prng = std.Random.DefaultPrng.init(42);
    const random = prng.random();

    var i: usize = 0;
    while (i < 50) : (i += 1) {
        const size = 16 + random.uintLessThan(usize, 256);
        const buf = try testing.allocator.alloc(u8, size);
        defer testing.allocator.free(buf);

        for (buf) |*b| {
            b.* = 'a' + random.uintLessThan(u8, 26);
        }

        const width = 10 + random.uintLessThan(u32, 70);
        try testAllMethodsMatch(buf, width, 4);
    }
}

test "boundary: SIMD16 chunk boundary" {
    var buf: [32]u8 = undefined;
    @memset(&buf, 'x');
    try testAllMethodsMatch(&buf, 20, 4);
    try testAllMethodsMatch(&buf, 10, 4);
}

test "boundary: Unicode at SIMD boundary" {
    var buf: [32]u8 = undefined;
    @memset(&buf, 'a');
    const cjk = "世";
    @memcpy(buf[14..17], cjk);
    try testAllMethodsMatch(buf[0..20], 20, 4);
}
