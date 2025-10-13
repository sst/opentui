//! UTF-8 Text Scanning Test Suite
//!
//! Tests both line break and word wrap break detection using SIMD16 methods.

const std = @import("std");
const testing = std.testing;
const utf8 = @import("../utf8.zig");

// ============================================================================
// ASCII-ONLY DETECTION TESTS
// ============================================================================

test "isAsciiOnly: empty string" {
    try testing.expect(!utf8.isAsciiOnly(""));
}

test "isAsciiOnly: simple ASCII" {
    try testing.expect(utf8.isAsciiOnly("Hello, World!"));
    try testing.expect(utf8.isAsciiOnly("The quick brown fox"));
    try testing.expect(utf8.isAsciiOnly("0123456789"));
    try testing.expect(utf8.isAsciiOnly("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"));
}

test "isAsciiOnly: control chars rejected" {
    try testing.expect(!utf8.isAsciiOnly("Hello\tWorld")); // Tab
    try testing.expect(!utf8.isAsciiOnly("Hello\nWorld")); // Newline
    try testing.expect(!utf8.isAsciiOnly("Hello\rWorld")); // CR
    try testing.expect(!utf8.isAsciiOnly("\x00")); // Null
    try testing.expect(!utf8.isAsciiOnly("\x1F")); // Unit separator
}

test "isAsciiOnly: extended ASCII rejected" {
    try testing.expect(!utf8.isAsciiOnly("Hello\x7FWorld")); // DEL
    try testing.expect(!utf8.isAsciiOnly("Hello\x80World")); // Extended ASCII
    try testing.expect(!utf8.isAsciiOnly("Hello\xFFWorld")); // Extended ASCII
}

test "isAsciiOnly: Unicode rejected" {
    try testing.expect(!utf8.isAsciiOnly("Hello 👋")); // Emoji
    try testing.expect(!utf8.isAsciiOnly("Hello 世界")); // CJK
    try testing.expect(!utf8.isAsciiOnly("café")); // Latin with accent
    try testing.expect(!utf8.isAsciiOnly("Привет")); // Cyrillic
}

test "isAsciiOnly: space character accepted" {
    try testing.expect(utf8.isAsciiOnly(" "));
    try testing.expect(utf8.isAsciiOnly("   "));
    try testing.expect(utf8.isAsciiOnly("Hello World"));
}

test "isAsciiOnly: all printable ASCII chars" {
    const all_printable = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";
    try testing.expect(utf8.isAsciiOnly(all_printable));
}

test "isAsciiOnly: SIMD boundary tests" {
    // Exactly 16 bytes
    try testing.expect(utf8.isAsciiOnly("0123456789abcdef"));

    // 15 bytes (just under boundary)
    try testing.expect(utf8.isAsciiOnly("0123456789abcde"));

    // 17 bytes (just over boundary)
    try testing.expect(utf8.isAsciiOnly("0123456789abcdefg"));

    // 32 bytes (two full vectors)
    try testing.expect(utf8.isAsciiOnly("0123456789abcdef0123456789abcdef"));

    // 33 bytes (two vectors + 1)
    try testing.expect(utf8.isAsciiOnly("0123456789abcdef0123456789abcdefX"));
}

test "isAsciiOnly: non-ASCII at different positions" {
    // Non-ASCII in first vector
    try testing.expect(!utf8.isAsciiOnly("Hello\x00World"));
    try testing.expect(!utf8.isAsciiOnly("\x00bcdefghijklmnop"));

    // Non-ASCII at boundary (position 15)
    try testing.expect(!utf8.isAsciiOnly("0123456789abcde\x00"));

    // Non-ASCII at boundary (position 16)
    try testing.expect(!utf8.isAsciiOnly("0123456789abcdef\x00"));

    // Non-ASCII in second vector
    try testing.expect(!utf8.isAsciiOnly("0123456789abcdef0123456789\x00bcdef"));

    // Non-ASCII in tail
    try testing.expect(!utf8.isAsciiOnly("0123456789abcdef01234\x00"));
}

test "isAsciiOnly: large ASCII text" {
    const size = 10000;
    const buf = try testing.allocator.alloc(u8, size);
    defer testing.allocator.free(buf);

    // Fill with ASCII
    for (buf, 0..) |*b, i| {
        b.* = 32 + @as(u8, @intCast(i % 95));
    }

    try testing.expect(utf8.isAsciiOnly(buf));

    // Corrupt one byte in the middle
    buf[5000] = 0x80;
    try testing.expect(!utf8.isAsciiOnly(buf));
}

// ============================================================================
// LINE BREAK TESTS
// ============================================================================

const LineBreakTestCase = struct {
    name: []const u8,
    input: []const u8,
    expected: []const usize,
};

const line_break_golden_tests = [_]LineBreakTestCase{
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

fn testLineBreaks(test_case: LineBreakTestCase, allocator: std.mem.Allocator) !void {
    var result = utf8.LineBreakResult.init(allocator);
    defer result.deinit();

    try utf8.findLineBreaksSIMD16(test_case.input, &result);

    // Verify results
    if (result.breaks.items.len != test_case.expected.len) {
        std.debug.print("\nLine break test FAILED on '{s}':\n", .{test_case.name});
        std.debug.print("  Expected {d} breaks, got {d}\n", .{ test_case.expected.len, result.breaks.items.len });
        std.debug.print("  Expected: {any}\n", .{test_case.expected});
        std.debug.print("  Got:      {any}\n", .{result.breaks.items});
        return error.TestFailed;
    }

    for (test_case.expected, 0..) |exp, i| {
        if (result.breaks.items[i].pos != exp) {
            std.debug.print("\nLine break test FAILED on '{s}':\n", .{test_case.name});
            std.debug.print("  Break {d}: expected {d}, got {d}\n", .{ i, exp, result.breaks.items[i].pos });
            std.debug.print("  Expected: {any}\n", .{test_case.expected});
            // Print positions only for comparison
            std.debug.print("  Got:      ", .{});
            for (result.breaks.items) |brk| {
                std.debug.print("{d} ", .{brk.pos});
            }
            std.debug.print("\n", .{});
            return error.TestFailed;
        }
    }
}

test "line breaks: golden tests" {
    for (line_break_golden_tests) |tc| {
        try testLineBreaks(tc, testing.allocator);
    }
}

test "line breaks: CRLF at SIMD16 edge (15-16)" {
    // Place \r at index 15, \n at 16
    var buf: [32]u8 = undefined;
    @memset(&buf, 'x');
    buf[15] = '\r';
    buf[16] = '\n';

    const expected = [_]usize{16}; // CRLF should be at \n index

    try testLineBreaks(.{
        .name = "CRLF@15-16",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);
}

test "line breaks: multiple breaks around SIMD16 boundary" {
    // Place breaks near boundary to test edge handling
    var buf: [32]u8 = undefined;
    @memset(&buf, 'x');
    buf[14] = '\n';
    buf[15] = '\r';
    buf[16] = '\n';
    buf[17] = '\n';

    const expected = [_]usize{ 14, 16, 17 }; // 15-16 is CRLF

    try testLineBreaks(.{
        .name = "multi@boundary",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);
}

test "line breaks: multibyte adjacent to LF" {
    const input = "é\n"; // é is 2 bytes: 0xC3 0xA9
    const expected = [_]usize{2}; // LF at index 2

    try testLineBreaks(.{
        .name = "é\\n",
        .input = input,
        .expected = &expected,
    }, testing.allocator);
}

test "line breaks: multibyte adjacent to CRLF" {
    const input = "漢\r\n"; // 漢 is 3 bytes: 0xE6 0xBC 0xA2
    const expected = [_]usize{4}; // \n at index 4

    try testLineBreaks(.{
        .name = "漢\\r\\n",
        .input = input,
        .expected = &expected,
    }, testing.allocator);
}

test "line breaks: multibyte at SIMD boundary without breaks" {
    // Ensure no spurious matches in multibyte sequences
    var buf: [32]u8 = undefined;
    @memset(&buf, 0);

    // Place UTF-8 sequences around boundary
    const text = "Test世界Test";
    @memcpy(buf[0..text.len], text);

    const expected = [_]usize{}; // No breaks

    try testLineBreaks(.{
        .name = "unicode@boundary",
        .input = buf[0..text.len],
        .expected = &expected,
    }, testing.allocator);
}

test "line breaks: realistic text" {
    const sample_text =
        "The quick brown fox jumps over the lazy dog.\n" ++
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n" ++
        "Windows uses CRLF line endings.\r\n" ++
        "Unix uses LF line endings.\n" ++
        "Classic Mac used CR line endings.\r" ++
        "UTF-8 text: 世界 こんにちは\n" ++
        "Multiple\n\nEmpty\n\n\nLines\n" ++
        "Mixed\r\nendings\nhere\r";

    var result = utf8.LineBreakResult.init(testing.allocator);
    defer result.deinit();

    try utf8.findLineBreaksSIMD16(sample_text, &result);

    // Verify we found some breaks
    try testing.expect(result.breaks.items.len > 0);
}

test "line breaks: random small buffers" {
    var prng = std.Random.DefaultPrng.init(42);
    const random = prng.random();

    var i: usize = 0;
    while (i < 50) : (i += 1) {
        const size = 16 + random.uintLessThan(usize, 1024);
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

        var result = utf8.LineBreakResult.init(testing.allocator);
        defer result.deinit();
        try utf8.findLineBreaksSIMD16(buf, &result);
    }
}

// ============================================================================
// WORD WRAP BREAK TESTS
// ============================================================================

const WrapBreakTestCase = struct {
    name: []const u8,
    input: []const u8,
    expected: []const usize,
};

const wrap_break_golden_tests = [_]WrapBreakTestCase{
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
        .expected = &[_]usize{},
    },
    .{
        .name = "carriage return",
        .input = "a\rb",
        .expected = &[_]usize{},
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
        .input = " \t-/\\.,:;!?()[]{}",
        .expected = &[_]usize{ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 },
    },
    // Unicode spaces and hyphens
    .{
        .name = "nbsp",
        .input = "a\u{00A0}b",
        .expected = &[_]usize{1},
    },
    .{
        .name = "em space",
        .input = "a\u{2003}b",
        .expected = &[_]usize{1},
    },
    .{
        .name = "ideo space",
        .input = "a\u{3000}b",
        .expected = &[_]usize{1},
    },
    .{
        .name = "soft hyphen",
        .input = "pre\u{00AD}post",
        .expected = &[_]usize{3},
    },
    .{
        .name = "unicode hyphen",
        .input = "pre\u{2010}post",
        .expected = &[_]usize{3},
    },
    .{
        .name = "zero width space",
        .input = "a\u{200B}b",
        .expected = &[_]usize{1},
    },
};

fn testWrapBreaks(test_case: WrapBreakTestCase, allocator: std.mem.Allocator) !void {
    var result = utf8.WrapBreakResult.init(allocator);
    defer result.deinit();

    try utf8.findWrapBreaksSIMD16(test_case.input, &result);

    // Verify results
    if (result.breaks.items.len != test_case.expected.len) {
        std.debug.print("\nWrap break test FAILED on '{s}':\n", .{test_case.name});
        std.debug.print("  Input: \"{s}\"\n", .{test_case.input});
        std.debug.print("  Expected {d} breaks, got {d}\n", .{ test_case.expected.len, result.breaks.items.len });
        std.debug.print("  Expected: {any}\n", .{test_case.expected});
        std.debug.print("  Got:      {any}\n", .{result.breaks.items});
        return error.TestFailed;
    }

    for (test_case.expected, 0..) |exp, i| {
        if (result.breaks.items[i].byte_offset != exp) {
            std.debug.print("\nWrap break test FAILED on '{s}':\n", .{test_case.name});
            std.debug.print("  Input: \"{s}\"\n", .{test_case.input});
            std.debug.print("  Break {d}: expected {d}, got {d}\n", .{ i, exp, result.breaks.items[i].byte_offset });
            std.debug.print("  Expected: {any}\n", .{test_case.expected});
            std.debug.print("  Got byte_offsets: ", .{});
            for (result.breaks.items) |brk| {
                std.debug.print("{d} ", .{brk.byte_offset});
            }
            std.debug.print("\n", .{});
            return error.TestFailed;
        }
    }
}

test "wrap breaks: golden tests" {
    for (wrap_break_golden_tests) |tc| {
        try testWrapBreaks(tc, testing.allocator);
    }
}

test "wrap breaks: space at SIMD16 edge (15)" {
    var buf: [32]u8 = undefined;
    @memset(&buf, 'x');
    buf[15] = ' ';
    buf[16] = 'y';

    const expected = [_]usize{15};

    try testWrapBreaks(.{
        .name = "space@15",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);
}

test "wrap breaks: unicode NBSP at SIMD16 edge (15)" {
    var buf: [32]u8 = undefined;
    @memset(&buf, 'x');
    // NBSP U+00A0 = 0xC2 0xA0
    buf[15] = 0xC2;
    buf[16] = 0xA0;

    const expected = [_]usize{15};

    try testWrapBreaks(.{
        .name = "nbsp@15",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);
}

test "wrap breaks: multiple breaks around SIMD16 boundary" {
    var buf: [32]u8 = undefined;
    @memset(&buf, 'x');
    buf[14] = ' ';
    buf[15] = '-';
    buf[16] = '/';
    buf[17] = '.';

    const expected = [_]usize{ 14, 15, 16, 17 };

    try testWrapBreaks(.{
        .name = "multi@boundary",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);
}

test "wrap breaks: multibyte adjacent to space" {
    const input = "é test"; // é is 2 bytes: 0xC3 0xA9
    const expected = [_]usize{2}; // Space at index 2

    try testWrapBreaks(.{
        .name = "é space",
        .input = input,
        .expected = &expected,
    }, testing.allocator);
}

test "wrap breaks: multibyte adjacent to dash" {
    const input = "漢-test"; // 漢 is 3 bytes: 0xE6 0xBC 0xA2
    const expected = [_]usize{3}; // Dash at index 3

    try testWrapBreaks(.{
        .name = "漢-",
        .input = input,
        .expected = &expected,
    }, testing.allocator);
}

test "wrap breaks: multibyte at SIMD boundary without breaks" {
    var buf: [32]u8 = undefined;
    @memset(&buf, 0);

    // Place UTF-8 sequences around boundary
    const text = "Test世界Test";
    @memcpy(buf[0..text.len], text);

    const expected = [_]usize{}; // No breaks

    try testWrapBreaks(.{
        .name = "unicode@boundary",
        .input = buf[0..text.len],
        .expected = &expected,
    }, testing.allocator);
}

test "wrap breaks: realistic text" {
    const sample_text =
        "The quick brown fox jumps over the lazy dog.\n" ++
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n" ++
        "File paths: /usr/local/bin and C:\\Windows\\System32\n" ++
        "Punctuation test: Hello, world! How are you? I'm fine.\n" ++
        "Brackets test: (parentheses) [square] {curly}\n" ++
        "Dashes test: pre-dash post-dash multi-word-expression\n" ++
        "Mixed: Hello, /path/to-file.txt [done]!\n";

    var result = utf8.WrapBreakResult.init(testing.allocator);
    defer result.deinit();

    try utf8.findWrapBreaksSIMD16(sample_text, &result);

    // Verify we found many breaks
    try testing.expect(result.breaks.items.len > 0);
}

test "wrap breaks: random small buffers" {
    var prng = std.Random.DefaultPrng.init(42);
    const random = prng.random();

    const break_chars = " \t-/\\.,:;!?()[]{}";

    var i: usize = 0;
    while (i < 50) : (i += 1) {
        const size = 16 + random.uintLessThan(usize, 1024);
        const buf = try testing.allocator.alloc(u8, size);
        defer testing.allocator.free(buf);

        // Fill with ASCII letters and randomly insert breaks
        for (buf) |*b| {
            const r = random.uintLessThan(u8, 100);
            if (r < 20) {
                const break_idx = random.uintLessThan(usize, break_chars.len);
                b.* = break_chars[break_idx];
            } else {
                b.* = 'a' + random.uintLessThan(u8, 26);
            }
        }

        var result = utf8.WrapBreakResult.init(testing.allocator);
        defer result.deinit();
        try utf8.findWrapBreaksSIMD16(buf, &result);
    }
}

test "wrap breaks: large buffer" {
    const size = 10000;
    const buf = try testing.allocator.alloc(u8, size);
    defer testing.allocator.free(buf);

    // Create realistic text with periodic breaks
    for (buf, 0..) |*b, idx| {
        if (idx % 50 == 0) {
            b.* = ' ';
        } else if (idx % 75 == 0) {
            b.* = '-';
        } else {
            b.* = 'a' + @as(u8, @intCast(idx % 26));
        }
    }

    var result = utf8.WrapBreakResult.init(testing.allocator);
    defer result.deinit();
    try utf8.findWrapBreaksSIMD16(buf, &result);

    try testing.expect(result.breaks.items.len > 0);
}

// ============================================================================
// EDGE CASES AND INTEGRATION TESTS
// ============================================================================

test "edge case: result reuse" {
    var line_result = utf8.LineBreakResult.init(testing.allocator);
    defer line_result.deinit();

    // First use - line breaks
    try utf8.findLineBreaksSIMD16("a\nb\nc", &line_result);
    try testing.expectEqual(@as(usize, 2), line_result.breaks.items.len);

    // Second use - should reset automatically
    try utf8.findLineBreaksSIMD16("x\ny", &line_result);
    try testing.expectEqual(@as(usize, 1), line_result.breaks.items.len);
    try testing.expectEqual(@as(usize, 1), line_result.breaks.items[0].pos);

    // Third use - wrap breaks (different result type)
    var wrap_result = utf8.WrapBreakResult.init(testing.allocator);
    defer wrap_result.deinit();
    try utf8.findWrapBreaksSIMD16("a b c", &wrap_result);
    try testing.expectEqual(@as(usize, 2), wrap_result.breaks.items.len);
}

test "edge case: empty input" {
    var line_result = utf8.LineBreakResult.init(testing.allocator);
    defer line_result.deinit();

    try utf8.findLineBreaksSIMD16("", &line_result);
    try testing.expectEqual(@as(usize, 0), line_result.breaks.items.len);

    var wrap_result = utf8.WrapBreakResult.init(testing.allocator);
    defer wrap_result.deinit();
    try utf8.findWrapBreaksSIMD16("", &wrap_result);
    try testing.expectEqual(@as(usize, 0), wrap_result.breaks.items.len);
}

test "edge case: exactly 16 bytes" {
    var line_result = utf8.LineBreakResult.init(testing.allocator);
    defer line_result.deinit();

    const input = "0123456789abcdef"; // exactly 16 bytes
    try utf8.findLineBreaksSIMD16(input, &line_result);
    try testing.expectEqual(@as(usize, 0), line_result.breaks.items.len);

    var wrap_result = utf8.WrapBreakResult.init(testing.allocator);
    defer wrap_result.deinit();
    try utf8.findWrapBreaksSIMD16(input, &wrap_result);
    try testing.expectEqual(@as(usize, 0), wrap_result.breaks.items.len);
}

test "edge case: 17 bytes with break at 16" {
    var line_result = utf8.LineBreakResult.init(testing.allocator);
    defer line_result.deinit();

    const input = "0123456789abcde\nx"; // break at position 15
    try utf8.findLineBreaksSIMD16(input, &line_result);
    try testing.expectEqual(@as(usize, 1), line_result.breaks.items.len);
    try testing.expectEqual(@as(usize, 15), line_result.breaks.items[0].pos);

    var wrap_result = utf8.WrapBreakResult.init(testing.allocator);
    defer wrap_result.deinit();
    const input2 = "0123456789abcde x"; // space at position 15
    try utf8.findWrapBreaksSIMD16(input2, &wrap_result);
    try testing.expectEqual(@as(usize, 1), wrap_result.breaks.items.len);
    try testing.expectEqual(@as(u16, 15), wrap_result.breaks.items[0].byte_offset);
    try testing.expectEqual(@as(u16, 15), wrap_result.breaks.items[0].char_offset);
}

// ============================================================================
// GRAPHEME CLUSTER TESTS
// ============================================================================

test "wrap breaks: emoji with ZWJ - char offset should count grapheme not codepoints" {
    // "👩‍🚀" is Woman Astronaut = 3 codepoints but 1 grapheme
    // U+1F469 (woman) + U+200D (ZWJ) + U+1F680 (rocket)
    // Should be counted as 1 character, not 3
    const input = "ab 👩‍🚀 cd"; // space after "ab", space after emoji

    var result = utf8.WrapBreakResult.init(testing.allocator);
    defer result.deinit();
    try utf8.findWrapBreaksSIMD16(input, &result);

    // Currently FAILS: char_offset at second space would be 5 (counting 3 codepoints)
    // Should be: char_offset = 3 (a, b, space) + 1 (grapheme) = 4
    // Byte offsets: space@2, space@(2+1+4+3+4=14)
    try testing.expectEqual(@as(usize, 2), result.breaks.items.len);
    try testing.expectEqual(@as(u16, 2), result.breaks.items[0].byte_offset);
    try testing.expectEqual(@as(u16, 2), result.breaks.items[0].char_offset);
    // This will fail with current implementation:
    try testing.expectEqual(@as(u16, 14), result.breaks.items[1].byte_offset);
    try testing.expectEqual(@as(u16, 4), result.breaks.items[1].char_offset); // Should be 4, not 6
}

test "wrap breaks: emoji with skin tone - char offset should count grapheme" {
    // "👋🏿" is Waving Hand with Dark Skin Tone = 2 codepoints but 1 grapheme
    // U+1F44B + U+1F3FF
    const input = "hi 👋🏿 bye"; // space after "hi", space after emoji

    var result = utf8.WrapBreakResult.init(testing.allocator);
    defer result.deinit();
    try utf8.findWrapBreaksSIMD16(input, &result);

    try testing.expectEqual(@as(usize, 2), result.breaks.items.len);
    try testing.expectEqual(@as(u16, 2), result.breaks.items[0].byte_offset);
    try testing.expectEqual(@as(u16, 2), result.breaks.items[0].char_offset);
    // Byte offset: 2(hi) + 1(space) + 4(wave) + 4(tone) = 11
    try testing.expectEqual(@as(u16, 11), result.breaks.items[1].byte_offset);
    try testing.expectEqual(@as(u16, 4), result.breaks.items[1].char_offset); // Should be 4, not 5
}

test "wrap breaks: emoji with VS16 selector - char offset should count grapheme" {
    // "❤️" = U+2764 + U+FE0F (VS16) = 2 codepoints but 1 grapheme
    const input = "I ❤️ U"; // spaces around heart

    var result = utf8.WrapBreakResult.init(testing.allocator);
    defer result.deinit();
    try utf8.findWrapBreaksSIMD16(input, &result);

    try testing.expectEqual(@as(usize, 2), result.breaks.items.len);
    try testing.expectEqual(@as(u16, 1), result.breaks.items[0].byte_offset);
    try testing.expectEqual(@as(u16, 1), result.breaks.items[0].char_offset);
    // Byte offset: 1(I) + 1(space) + 3(heart) + 3(VS16) = 8
    try testing.expectEqual(@as(u16, 8), result.breaks.items[1].byte_offset);
    try testing.expectEqual(@as(u16, 3), result.breaks.items[1].char_offset); // Should be 3, not 4
}

test "wrap breaks: combining diacritic - char offset should count grapheme" {
    // "é" as e + combining acute = U+0065 + U+0301 = 2 codepoints but 1 grapheme
    const input = "cafe\u{0301} time"; // café with combining accent

    var result = utf8.WrapBreakResult.init(testing.allocator);
    defer result.deinit();
    try utf8.findWrapBreaksSIMD16(input, &result);

    try testing.expectEqual(@as(usize, 1), result.breaks.items.len);
    // Byte offset: 4(cafe) + 2(combining) = 6
    try testing.expectEqual(@as(u16, 6), result.breaks.items[0].byte_offset);
    try testing.expectEqual(@as(u16, 4), result.breaks.items[0].char_offset); // Should be 4, not 5
}

test "wrap breaks: flag emoji - char offset should count grapheme" {
    // "🇺🇸" = U+1F1FA + U+1F1F8 (Regional Indicators) = 2 codepoints, 1 grapheme per uucode
    const input = "USA🇺🇸 flag"; // space after flag

    var result = utf8.WrapBreakResult.init(testing.allocator);
    defer result.deinit();
    try utf8.findWrapBreaksSIMD16(input, &result);

    try testing.expectEqual(@as(usize, 1), result.breaks.items.len);
    // Space after flag: Byte offset: 3(USA) + 4(U) + 4(S) = 11
    try testing.expectEqual(@as(u16, 11), result.breaks.items[0].byte_offset);
    try testing.expectEqual(@as(u16, 4), result.breaks.items[0].char_offset); // 3(USA) + 1(flag) = 4
}

test "wrap breaks: mixed graphemes and ASCII" {
    // Test mixed content with multiple grapheme types
    const input = "Hello 👋🏿 world 🇺🇸 test"; // Multiple spaces and graphemes

    var result = utf8.WrapBreakResult.init(testing.allocator);
    defer result.deinit();
    try utf8.findWrapBreaksSIMD16(input, &result);

    try testing.expectEqual(@as(usize, 4), result.breaks.items.len);
    // First space after "Hello"
    try testing.expectEqual(@as(u16, 5), result.breaks.items[0].byte_offset);
    try testing.expectEqual(@as(u16, 5), result.breaks.items[0].char_offset);
    // Second space: 5(Hello) + 1(space) + 8(emoji with tone) = 14
    try testing.expectEqual(@as(u16, 14), result.breaks.items[1].byte_offset);
    try testing.expectEqual(@as(u16, 7), result.breaks.items[1].char_offset); // 5 + 1 + 1(grapheme) = 7
    // Third space: 14 + 1(space) + 5(world) = 20
    try testing.expectEqual(@as(u16, 20), result.breaks.items[2].byte_offset);
    try testing.expectEqual(@as(u16, 13), result.breaks.items[2].char_offset); // 7 + 1 + 5 = 13
    // Fourth space: 20 + 1(space) + 8(flag emoji) = 29
    // Note: Flag emojis like 🇺🇸 are counted by uucode as 2 graphemes (one per regional indicator)
    try testing.expectEqual(@as(u16, 29), result.breaks.items[3].byte_offset);
    try testing.expectEqual(@as(u16, 15), result.breaks.items[3].char_offset); // 13 + 1(space) + 1(RI) + 1(RI) = 15 (per uucode)
}
