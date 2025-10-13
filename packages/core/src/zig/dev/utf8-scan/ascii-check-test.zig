//! ASCII-Only Detection Test Suite
//!
//! Validates that all implementations produce correct and consistent results.
//!
//! Run with:
//!   cd packages/core/src/zig/dev/utf8-scan
//!   zig test ascii-check-test.zig -O ReleaseFast

const std = @import("std");
const testing = std.testing;
const ascii = @import("ascii-check.zig");

const TestCase = struct {
    input: []const u8,
    expected: bool,
    description: []const u8,
};

const test_cases = [_]TestCase{
    .{ .input = "", .expected = false, .description = "Empty string" },
    .{ .input = "Hello, World!", .expected = true, .description = "Simple ASCII" },
    .{ .input = "The quick brown fox", .expected = true, .description = "English sentence" },
    .{ .input = " !\"#$%&'()*+,-./0123456789:;<=>?", .expected = true, .description = "Printable ASCII symbols 1" },
    .{ .input = "@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_", .expected = true, .description = "Printable ASCII symbols 2" },
    .{ .input = "`abcdefghijklmnopqrstuvwxyz{|}~", .expected = true, .description = "Printable ASCII symbols 3" },
    .{ .input = "Hello\nWorld", .expected = false, .description = "Contains newline (LF)" },
    .{ .input = "Hello\rWorld", .expected = false, .description = "Contains carriage return (CR)" },
    .{ .input = "Hello\tWorld", .expected = false, .description = "Contains tab" },
    .{ .input = "Hello\x00World", .expected = false, .description = "Contains null byte" },
    .{ .input = "Hello\x1FWorld", .expected = false, .description = "Contains control char (0x1F)" },
    .{ .input = "Hello\x7FWorld", .expected = false, .description = "Contains DEL (0x7F)" },
    .{ .input = "Hello\x80World", .expected = false, .description = "Contains high bit (0x80)" },
    .{ .input = "Hello\xFFWorld", .expected = false, .description = "Contains 0xFF" },
    .{ .input = "Hello 世界", .expected = false, .description = "Contains UTF-8 (Chinese)" },
    .{ .input = "Café", .expected = false, .description = "Contains UTF-8 (accented)" },
    .{ .input = "こんにちは", .expected = false, .description = "Contains UTF-8 (Japanese)" },
    .{ .input = "🎉", .expected = false, .description = "Contains UTF-8 (emoji)" },
    .{ .input = " ", .expected = true, .description = "Single space (ASCII 32)" },
    .{ .input = "~", .expected = true, .description = "Single tilde (ASCII 126)" },
    .{ .input = " " ** 100, .expected = true, .description = "Many spaces" },
    .{ .input = "a" ** 1000, .expected = true, .description = "1000 'a' characters" },
    .{ .input = "123abc!@# XYZ", .expected = true, .description = "Mixed printable ASCII" },
};

fn testImplementation(comptime func: anytype) !void {
    for (test_cases) |tc| {
        const result = func(tc.input);
        if (result != tc.expected) {
            std.debug.print("\nFAILED: {s}\n", .{tc.description});
            std.debug.print("  Expected: {}, Got: {}\n", .{ tc.expected, result });
            std.debug.print("  Input: \"{s}\"\n", .{tc.input});
            return error.TestFailed;
        }
    }
}

test "golden: baseline" {
    try testImplementation(ascii.isAsciiOnlyBaseline);
}

test "golden: simd16" {
    try testImplementation(ascii.isAsciiOnlySIMD16);
}

test "golden: simd32" {
    try testImplementation(ascii.isAsciiOnlySIMD32);
}

test "golden: simd64" {
    try testImplementation(ascii.isAsciiOnlySIMD64);
}

test "golden: bitmask" {
    try testImplementation(ascii.isAsciiOnlyBitmask);
}

test "golden: bitwise_or" {
    try testImplementation(ascii.isAsciiOnlyBitwiseOr);
}

test "golden: simd16_single_cmp" {
    try testImplementation(ascii.isAsciiOnlySIMD16SingleCmp);
}

test "golden: simd32_single_cmp" {
    try testImplementation(ascii.isAsciiOnlySIMD32SingleCmp);
}

test "golden: simd16_unrolled" {
    try testImplementation(ascii.isAsciiOnlySIMD16Unrolled);
}

// Consistency test: all methods produce identical results
fn testAllMethodsMatch(input: []const u8) !void {
    const baseline_result = ascii.isAsciiOnlyBaseline(input);

    const methods = .{
        ascii.isAsciiOnlySIMD16,
        ascii.isAsciiOnlySIMD32,
        ascii.isAsciiOnlySIMD64,
        ascii.isAsciiOnlyBitmask,
        ascii.isAsciiOnlyBitwiseOr,
        ascii.isAsciiOnlySIMD16SingleCmp,
        ascii.isAsciiOnlySIMD32SingleCmp,
        ascii.isAsciiOnlySIMD16Unrolled,
    };

    inline for (methods) |method| {
        const result = method(input);
        if (result != baseline_result) {
            std.debug.print("\nMethod disagrees with Baseline:\n", .{});
            std.debug.print("  Input length: {d}\n", .{input.len});
            std.debug.print("  Baseline: {}\n", .{baseline_result});
            std.debug.print("  Method: {}\n", .{result});
            return error.MethodMismatch;
        }
    }
}

test "consistency: all methods match on realistic text" {
    const sample_text =
        "The quick brown fox jumps over the lazy dog.\n" ++
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n" ++
        "File paths: /usr/local/bin and C:\\Windows\\System32\n" ++
        "Printable ASCII: !@#$%^&*()_+-=[]{}|;:',.<>?/~`\n";

    try testAllMethodsMatch(sample_text);
}

test "consistency: all methods match on edge cases" {
    const edge_cases = [_][]const u8{
        "",
        " ",
        "~",
        "a",
        "a" ** 100,
        "a" ** 1000,
        " " ** 100,
        "~" ** 100,
        "The quick brown fox jumps over the lazy dog",
    };

    for (edge_cases) |input| {
        try testAllMethodsMatch(input);
    }
}

// Boundary tests - ensure proper handling at SIMD boundaries
test "boundary: 15 bytes (just under SIMD16)" {
    const input = "a" ** 15;
    try testAllMethodsMatch(input);
    try testing.expect(ascii.isAsciiOnlyBaseline(input));
}

test "boundary: 16 bytes (exactly SIMD16)" {
    const input = "a" ** 16;
    try testAllMethodsMatch(input);
    try testing.expect(ascii.isAsciiOnlyBaseline(input));
}

test "boundary: 17 bytes (just over SIMD16)" {
    const input = "a" ** 17;
    try testAllMethodsMatch(input);
    try testing.expect(ascii.isAsciiOnlyBaseline(input));
}

test "boundary: 31 bytes (just under SIMD32)" {
    const input = "a" ** 31;
    try testAllMethodsMatch(input);
    try testing.expect(ascii.isAsciiOnlyBaseline(input));
}

test "boundary: 32 bytes (exactly SIMD32)" {
    const input = "a" ** 32;
    try testAllMethodsMatch(input);
    try testing.expect(ascii.isAsciiOnlyBaseline(input));
}

test "boundary: 33 bytes (just over SIMD32)" {
    const input = "a" ** 33;
    try testAllMethodsMatch(input);
    try testing.expect(ascii.isAsciiOnlyBaseline(input));
}

test "boundary: 63 bytes (just under SIMD64)" {
    const input = "a" ** 63;
    try testAllMethodsMatch(input);
    try testing.expect(ascii.isAsciiOnlyBaseline(input));
}

test "boundary: 64 bytes (exactly SIMD64)" {
    const input = "a" ** 64;
    try testAllMethodsMatch(input);
    try testing.expect(ascii.isAsciiOnlyBaseline(input));
}

test "boundary: 65 bytes (just over SIMD64)" {
    const input = "a" ** 65;
    try testAllMethodsMatch(input);
    try testing.expect(ascii.isAsciiOnlyBaseline(input));
}

test "boundary: invalid byte at position 15 (SIMD16 edge)" {
    var buf: [32]u8 = undefined;
    @memset(&buf, 'x');
    buf[15] = 0xFF;
    try testAllMethodsMatch(&buf);
    try testing.expect(!ascii.isAsciiOnlyBaseline(&buf));
}

test "boundary: invalid byte at position 31 (SIMD32 edge)" {
    var buf: [64]u8 = undefined;
    @memset(&buf, 'x');
    buf[31] = 0xFF;
    try testAllMethodsMatch(&buf);
    try testing.expect(!ascii.isAsciiOnlyBaseline(&buf));
}

test "boundary: invalid byte at position 63 (SIMD64 edge)" {
    var buf: [128]u8 = undefined;
    @memset(&buf, 'x');
    buf[63] = 0xFF;
    try testAllMethodsMatch(&buf);
    try testing.expect(!ascii.isAsciiOnlyBaseline(&buf));
}

// Property test: randomized inputs
test "property: random buffers" {
    var prng = std.Random.DefaultPrng.init(42);
    const random = prng.random();

    var i: usize = 0;
    while (i < 50) : (i += 1) {
        const size = 1 + random.uintLessThan(usize, 1024);
        const buf = try testing.allocator.alloc(u8, size);
        defer testing.allocator.free(buf);

        // Fill with random bytes
        for (buf) |*b| {
            b.* = random.int(u8);
        }

        try testAllMethodsMatch(buf);
    }
}
