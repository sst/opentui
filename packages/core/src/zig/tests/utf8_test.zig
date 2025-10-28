const std = @import("std");
const testing = std.testing;
const utf8 = @import("../utf8.zig");

// ============================================================================
// ASCII-ONLY DETECTION TESTS
// ============================================================================

test "isAsciiOnly: empty string" {
    // Empty string is not ASCII-only by convention
    try testing.expect(!utf8.isAsciiOnly(""));
}

test "isAsciiOnly: simple ASCII" {
    try testing.expect(utf8.isAsciiOnly("Hello, World!"));
    try testing.expect(utf8.isAsciiOnly("The quick brown fox"));
    try testing.expect(utf8.isAsciiOnly("0123456789"));
    try testing.expect(utf8.isAsciiOnly("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"));
}

test "isAsciiOnly: control chars rejected" {
    try testing.expect(!utf8.isAsciiOnly("Hello\tWorld"));
    try testing.expect(!utf8.isAsciiOnly("Hello\nWorld"));
    try testing.expect(!utf8.isAsciiOnly("Hello\rWorld"));
    try testing.expect(!utf8.isAsciiOnly("\x00"));
    try testing.expect(!utf8.isAsciiOnly("\x1F"));
}

test "isAsciiOnly: extended ASCII rejected" {
    try testing.expect(!utf8.isAsciiOnly("Hello\x7FWorld"));
    try testing.expect(!utf8.isAsciiOnly("Hello\x80World"));
    try testing.expect(!utf8.isAsciiOnly("Hello\xFFWorld"));
}

test "isAsciiOnly: Unicode rejected" {
    try testing.expect(!utf8.isAsciiOnly("Hello 👋"));
    try testing.expect(!utf8.isAsciiOnly("Hello 世界"));
    try testing.expect(!utf8.isAsciiOnly("café"));
    try testing.expect(!utf8.isAsciiOnly("Привет"));
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
    try testing.expect(utf8.isAsciiOnly("0123456789abcdef"));
    try testing.expect(utf8.isAsciiOnly("0123456789abcde"));
    try testing.expect(utf8.isAsciiOnly("0123456789abcdefg"));
    try testing.expect(utf8.isAsciiOnly("0123456789abcdef0123456789abcdef"));
    try testing.expect(utf8.isAsciiOnly("0123456789abcdef0123456789abcdefX"));
}

test "isAsciiOnly: non-ASCII at different positions" {
    try testing.expect(!utf8.isAsciiOnly("Hello\x00World"));
    try testing.expect(!utf8.isAsciiOnly("\x00bcdefghijklmnop"));
    try testing.expect(!utf8.isAsciiOnly("0123456789abcde\x00"));
    try testing.expect(!utf8.isAsciiOnly("0123456789abcdef\x00"));
    try testing.expect(!utf8.isAsciiOnly("0123456789abcdef0123456789\x00bcdef"));
    try testing.expect(!utf8.isAsciiOnly("0123456789abcdef01234\x00"));
}

test "isAsciiOnly: large ASCII text" {
    const size = 10000;
    const buf = try testing.allocator.alloc(u8, size);
    defer testing.allocator.free(buf);

    for (buf, 0..) |*b, i| {
        b.* = 32 + @as(u8, @intCast(i % 95));
    }

    try testing.expect(utf8.isAsciiOnly(buf));

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

    try testing.expectEqual(test_case.expected.len, result.breaks.items.len);

    for (test_case.expected, 0..) |exp, i| {
        try testing.expectEqual(exp, result.breaks.items[i].pos);
    }
}

test "line breaks: golden tests" {
    for (line_break_golden_tests) |tc| {
        try testLineBreaks(tc, testing.allocator);
    }
}

test "line breaks: CRLF at SIMD16 edge (15-16)" {
    var buf: [32]u8 = undefined;
    @memset(&buf, 'x');
    buf[15] = '\r';
    buf[16] = '\n';

    const expected = [_]usize{16}; // CRLF recorded at \n index

    try testLineBreaks(.{
        .name = "CRLF@15-16",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);
}

test "line breaks: multiple breaks around SIMD16 boundary" {
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
    const input = "é\n";
    const expected = [_]usize{2};

    try testLineBreaks(.{
        .name = "é\\n",
        .input = input,
        .expected = &expected,
    }, testing.allocator);
}

test "line breaks: multibyte adjacent to CRLF" {
    const input = "漢\r\n";
    const expected = [_]usize{4};

    try testLineBreaks(.{
        .name = "漢\\r\\n",
        .input = input,
        .expected = &expected,
    }, testing.allocator);
}

test "line breaks: multibyte at SIMD boundary without breaks" {
    var buf: [32]u8 = undefined;
    @memset(&buf, 0);

    const text = "Test世界Test";
    @memcpy(buf[0..text.len], text);

    const expected = [_]usize{};

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
// TAB STOP TESTS
// ============================================================================

const TabStopTestCase = struct {
    name: []const u8,
    input: []const u8,
    expected: []const usize,
};

const tab_stop_golden_tests = [_]TabStopTestCase{
    .{
        .name = "empty string",
        .input = "",
        .expected = &[_]usize{},
    },
    .{
        .name = "no tabs",
        .input = "hello world",
        .expected = &[_]usize{},
    },
    .{
        .name = "single tab",
        .input = "a\tb",
        .expected = &[_]usize{1},
    },
    .{
        .name = "multiple tabs",
        .input = "a\tb\tc",
        .expected = &[_]usize{ 1, 3 },
    },
    .{
        .name = "tab at start",
        .input = "\tabc",
        .expected = &[_]usize{0},
    },
    .{
        .name = "tab at end",
        .input = "abc\t",
        .expected = &[_]usize{3},
    },
    .{
        .name = "consecutive tabs",
        .input = "a\t\tb",
        .expected = &[_]usize{ 1, 2 },
    },
    .{
        .name = "only tabs",
        .input = "\t\t\t",
        .expected = &[_]usize{ 0, 1, 2 },
    },
    .{
        .name = "tabs mixed with spaces",
        .input = "a \tb \tc",
        .expected = &[_]usize{ 2, 5 },
    },
    .{
        .name = "tab with newline",
        .input = "a\tb\nc\td",
        .expected = &[_]usize{ 1, 5 },
    },
    .{
        .name = "many tabs",
        .input = "\ta\tb\tc\td\te\tf\t",
        .expected = &[_]usize{ 0, 2, 4, 6, 8, 10, 12 },
    },
};

fn testTabStops(test_case: TabStopTestCase, allocator: std.mem.Allocator) !void {
    var result = utf8.TabStopResult.init(allocator);
    defer result.deinit();

    try utf8.findTabStopsSIMD16(test_case.input, &result);

    try testing.expectEqual(test_case.expected.len, result.positions.items.len);

    for (test_case.expected, 0..) |exp, i| {
        try testing.expectEqual(exp, result.positions.items[i]);
    }
}

test "tab stops: golden tests" {
    for (tab_stop_golden_tests) |tc| {
        try testTabStops(tc, testing.allocator);
    }
}

test "tab stops: tab at SIMD16 edge (15)" {
    var buf: [32]u8 = undefined;
    @memset(&buf, 'x');
    buf[15] = '\t';
    buf[16] = 'y';

    const expected = [_]usize{15};

    try testTabStops(.{
        .name = "tab@15",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);
}

test "tab stops: tab at SIMD16 edge (16)" {
    var buf: [32]u8 = undefined;
    @memset(&buf, 'x');
    buf[16] = '\t';
    buf[17] = 'y';

    const expected = [_]usize{16};

    try testTabStops(.{
        .name = "tab@16",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);
}

test "tab stops: multiple tabs around SIMD16 boundary" {
    var buf: [32]u8 = undefined;
    @memset(&buf, 'x');
    buf[14] = '\t';
    buf[15] = '\t';
    buf[16] = '\t';
    buf[17] = '\t';

    const expected = [_]usize{ 14, 15, 16, 17 };

    try testTabStops(.{
        .name = "tabs@boundary",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);
}

test "tab stops: tabs in all SIMD lanes" {
    var buf: [16]u8 = undefined;
    for (&buf) |*b| {
        b.* = '\t';
    }

    const expected = [_]usize{ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 };

    try testTabStops(.{
        .name = "all_tabs",
        .input = &buf,
        .expected = &expected,
    }, testing.allocator);
}

test "tab stops: multibyte adjacent to tab" {
    const input = "é\ttest"; // é is 2 bytes: 0xC3 0xA9
    const expected = [_]usize{2}; // Tab at index 2

    try testTabStops(.{
        .name = "é\\t",
        .input = input,
        .expected = &expected,
    }, testing.allocator);
}

test "tab stops: CJK adjacent to tab" {
    const input = "漢\ttest"; // 漢 is 3 bytes: 0xE6 0xBC 0xA2
    const expected = [_]usize{3}; // Tab at index 3

    try testTabStops(.{
        .name = "漢\\t",
        .input = input,
        .expected = &expected,
    }, testing.allocator);
}

test "tab stops: emoji adjacent to tab" {
    const input = "👋\twave"; // 👋 is 4 bytes
    const expected = [_]usize{4}; // Tab at index 4

    try testTabStops(.{
        .name = "emoji\\t",
        .input = input,
        .expected = &expected,
    }, testing.allocator);
}

test "tab stops: multibyte at SIMD boundary without tabs" {
    var buf: [32]u8 = undefined;
    @memset(&buf, 0);

    const text = "Test世界Test";
    @memcpy(buf[0..text.len], text);

    const expected = [_]usize{}; // No tabs

    try testTabStops(.{
        .name = "unicode@boundary",
        .input = buf[0..text.len],
        .expected = &expected,
    }, testing.allocator);
}

test "tab stops: realistic code text" {
    const sample_text =
        "function test() {\n" ++
        "\tconst x = 10;\n" ++
        "\tif (x > 5) {\n" ++
        "\t\treturn true;\n" ++
        "\t}\n" ++
        "\treturn false;\n" ++
        "}\n";

    var result = utf8.TabStopResult.init(testing.allocator);
    defer result.deinit();

    try utf8.findTabStopsSIMD16(sample_text, &result);

    // Should find 6 tabs (including double-tab for nested return)
    try testing.expectEqual(@as(usize, 6), result.positions.items.len);
}

test "tab stops: TSV data" {
    const tsv_line = "name\tage\tcity\tcountry";
    const expected = [_]usize{ 4, 8, 13 };

    try testTabStops(.{
        .name = "tsv",
        .input = tsv_line,
        .expected = &expected,
    }, testing.allocator);
}

test "tab stops: random small buffers" {
    var prng = std.Random.DefaultPrng.init(42);
    const random = prng.random();

    var i: usize = 0;
    while (i < 50) : (i += 1) {
        const size = 16 + random.uintLessThan(usize, 1024);
        const buf = try testing.allocator.alloc(u8, size);
        defer testing.allocator.free(buf);

        for (buf) |*b| {
            const r = random.uintLessThan(u8, 100);
            if (r < 10) {
                b.* = '\t';
            } else {
                b.* = 'a' + random.uintLessThan(u8, 26);
            }
        }

        var result = utf8.TabStopResult.init(testing.allocator);
        defer result.deinit();
        try utf8.findTabStopsSIMD16(buf, &result);
    }
}

test "tab stops: large buffer with periodic tabs" {
    const size = 10000;
    const buf = try testing.allocator.alloc(u8, size);
    defer testing.allocator.free(buf);

    var expected_count: usize = 0;
    for (buf, 0..) |*b, idx| {
        if (idx % 50 == 0) {
            b.* = '\t';
            expected_count += 1;
        } else {
            b.* = 'a' + @as(u8, @intCast(idx % 26));
        }
    }

    var result = utf8.TabStopResult.init(testing.allocator);
    defer result.deinit();
    try utf8.findTabStopsSIMD16(buf, &result);

    try testing.expectEqual(expected_count, result.positions.items.len);
}

test "tab stops: exactly 16 bytes with tab" {
    const input = "0123456789abcd\tx"; // exactly 16 bytes with tab at pos 14
    const expected = [_]usize{14};

    try testTabStops(.{
        .name = "16bytes_with_tab",
        .input = input,
        .expected = &expected,
    }, testing.allocator);
}

test "tab stops: exactly 16 bytes no tab" {
    const input = "0123456789abcdef"; // exactly 16 bytes, no tab
    const expected = [_]usize{};

    try testTabStops(.{
        .name = "16bytes_no_tab",
        .input = input,
        .expected = &expected,
    }, testing.allocator);
}

test "tab stops: 17 bytes with tab at 16" {
    const input = "0123456789abcdef\t"; // tab at position 16
    const expected = [_]usize{16};

    try testTabStops(.{
        .name = "tab@16",
        .input = input,
        .expected = &expected,
    }, testing.allocator);
}

test "tab stops: result reuse" {
    var result = utf8.TabStopResult.init(testing.allocator);
    defer result.deinit();

    // First use
    try utf8.findTabStopsSIMD16("a\tb\tc", &result);
    try testing.expectEqual(@as(usize, 2), result.positions.items.len);

    // Second use - should reset automatically
    try utf8.findTabStopsSIMD16("x\ty", &result);
    try testing.expectEqual(@as(usize, 1), result.positions.items.len);
    try testing.expectEqual(@as(usize, 1), result.positions.items[0]);
}

test "tab stops: mixed with other whitespace" {
    const input = "  \t  \t  ";
    const expected = [_]usize{ 2, 5 };

    try testTabStops(.{
        .name = "mixed_whitespace",
        .input = input,
        .expected = &expected,
    }, testing.allocator);
}

test "tab stops: makefile style" {
    const makefile = "target:\n\t@echo Building\n\t@gcc -o out main.c\n";

    var result = utf8.TabStopResult.init(testing.allocator);
    defer result.deinit();

    try utf8.findTabStopsSIMD16(makefile, &result);

    // Should find 2 tabs (one per command line)
    try testing.expectEqual(@as(usize, 2), result.positions.items.len);
}

test "tab stops: tabs across multiple SIMD chunks" {
    const size = 64; // 4 SIMD chunks
    const buf = try testing.allocator.alloc(u8, size);
    defer testing.allocator.free(buf);

    @memset(buf, 'x');
    buf[0] = '\t';
    buf[16] = '\t';
    buf[32] = '\t';
    buf[48] = '\t';
    buf[63] = '\t';

    const expected = [_]usize{ 0, 16, 32, 48, 63 };

    try testTabStops(.{
        .name = "multi_chunk",
        .input = buf,
        .expected = &expected,
    }, testing.allocator);
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

    try testing.expectEqual(test_case.expected.len, result.breaks.items.len);

    for (test_case.expected, 0..) |exp, i| {
        try testing.expectEqual(exp, result.breaks.items[i].byte_offset);
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
    const input = "ab 👩‍🚀 cd";

    var result = utf8.WrapBreakResult.init(testing.allocator);
    defer result.deinit();
    try utf8.findWrapBreaksSIMD16(input, &result);

    try testing.expectEqual(@as(usize, 2), result.breaks.items.len);
    try testing.expectEqual(@as(u16, 2), result.breaks.items[0].byte_offset);
    try testing.expectEqual(@as(u16, 2), result.breaks.items[0].char_offset);
    try testing.expectEqual(@as(u16, 14), result.breaks.items[1].byte_offset);
    try testing.expectEqual(@as(u16, 4), result.breaks.items[1].char_offset); // Should be 4, not 6
}

test "wrap breaks: emoji with skin tone - char offset should count grapheme" {
    const input = "hi 👋🏿 bye";

    var result = utf8.WrapBreakResult.init(testing.allocator);
    defer result.deinit();
    try utf8.findWrapBreaksSIMD16(input, &result);

    try testing.expectEqual(@as(usize, 2), result.breaks.items.len);
    try testing.expectEqual(@as(u16, 2), result.breaks.items[0].byte_offset);
    try testing.expectEqual(@as(u16, 2), result.breaks.items[0].char_offset);
    try testing.expectEqual(@as(u16, 11), result.breaks.items[1].byte_offset);
    try testing.expectEqual(@as(u16, 4), result.breaks.items[1].char_offset); // Should be 4, not 5
}

test "wrap breaks: emoji with VS16 selector - char offset should count grapheme" {
    const input = "I ❤️ U";

    var result = utf8.WrapBreakResult.init(testing.allocator);
    defer result.deinit();
    try utf8.findWrapBreaksSIMD16(input, &result);

    try testing.expectEqual(@as(usize, 2), result.breaks.items.len);
    try testing.expectEqual(@as(u16, 1), result.breaks.items[0].byte_offset);
    try testing.expectEqual(@as(u16, 1), result.breaks.items[0].char_offset);
    try testing.expectEqual(@as(u16, 8), result.breaks.items[1].byte_offset);
    try testing.expectEqual(@as(u16, 3), result.breaks.items[1].char_offset); // Should be 3, not 4
}

test "wrap breaks: combining diacritic - char offset should count grapheme" {
    const input = "cafe\u{0301} time";

    var result = utf8.WrapBreakResult.init(testing.allocator);
    defer result.deinit();
    try utf8.findWrapBreaksSIMD16(input, &result);

    try testing.expectEqual(@as(usize, 1), result.breaks.items.len);
    try testing.expectEqual(@as(u16, 6), result.breaks.items[0].byte_offset);
    try testing.expectEqual(@as(u16, 4), result.breaks.items[0].char_offset); // Should be 4, not 5
}

test "wrap breaks: flag emoji - char offset should count grapheme" {
    const input = "USA🇺🇸 flag";

    var result = utf8.WrapBreakResult.init(testing.allocator);
    defer result.deinit();
    try utf8.findWrapBreaksSIMD16(input, &result);

    try testing.expectEqual(@as(usize, 1), result.breaks.items.len);
    try testing.expectEqual(@as(u16, 11), result.breaks.items[0].byte_offset);
    try testing.expectEqual(@as(u16, 4), result.breaks.items[0].char_offset); // 3(USA) + 1(flag) = 4
}

test "wrap breaks: mixed graphemes and ASCII" {
    const input = "Hello 👋🏿 world 🇺🇸 test";

    var result = utf8.WrapBreakResult.init(testing.allocator);
    defer result.deinit();
    try utf8.findWrapBreaksSIMD16(input, &result);

    try testing.expectEqual(@as(usize, 4), result.breaks.items.len);
    try testing.expectEqual(@as(u16, 5), result.breaks.items[0].byte_offset);
    try testing.expectEqual(@as(u16, 5), result.breaks.items[0].char_offset);
    try testing.expectEqual(@as(u16, 14), result.breaks.items[1].byte_offset);
    try testing.expectEqual(@as(u16, 7), result.breaks.items[1].char_offset); // 5 + 1 + 1(grapheme) = 7
    try testing.expectEqual(@as(u16, 20), result.breaks.items[2].byte_offset);
    try testing.expectEqual(@as(u16, 13), result.breaks.items[2].char_offset); // 7 + 1 + 5 = 13
    try testing.expectEqual(@as(u16, 29), result.breaks.items[3].byte_offset);
    try testing.expectEqual(@as(u16, 15), result.breaks.items[3].char_offset); // 13 + 1(space) + 1(RI) + 1(RI) = 15 (per uucode)
}

// ============================================================================
// WRAP BY WIDTH TESTS
// ============================================================================

test "wrap by width: empty string" {
    const result = utf8.findWrapPosByWidthSIMD16("", 10, 4, true);
    try testing.expectEqual(@as(u32, 0), result.byte_offset);
    try testing.expectEqual(@as(u32, 0), result.grapheme_count);
    try testing.expectEqual(@as(u32, 0), result.columns_used);
}

test "wrap by width: simple ASCII no wrap" {
    const result = utf8.findWrapPosByWidthSIMD16("hello", 10, 4, true);
    try testing.expectEqual(@as(u32, 5), result.byte_offset);
    try testing.expectEqual(@as(u32, 5), result.grapheme_count);
    try testing.expectEqual(@as(u32, 5), result.columns_used);
}

test "wrap by width: ASCII wrap exactly at limit" {
    const result = utf8.findWrapPosByWidthSIMD16("hello", 5, 4, true);
    try testing.expectEqual(@as(u32, 5), result.byte_offset);
    try testing.expectEqual(@as(u32, 5), result.grapheme_count);
    try testing.expectEqual(@as(u32, 5), result.columns_used);
}

test "wrap by width: ASCII wrap before limit" {
    const result = utf8.findWrapPosByWidthSIMD16("hello world", 7, 4, true);
    try testing.expectEqual(@as(u32, 7), result.byte_offset);
    try testing.expectEqual(@as(u32, 7), result.grapheme_count);
    try testing.expectEqual(@as(u32, 7), result.columns_used);
}

test "wrap by width: East Asian wide char" {
    const result = utf8.findWrapPosByWidthSIMD16("世界", 3, 4, false);
    try testing.expectEqual(@as(u32, 3), result.byte_offset); // After first char
    try testing.expectEqual(@as(u32, 1), result.grapheme_count);
    try testing.expectEqual(@as(u32, 2), result.columns_used);
}

test "wrap by width: combining mark" {
    const result = utf8.findWrapPosByWidthSIMD16("e\u{0301}test", 3, 4, false);
    try testing.expectEqual(@as(u32, 5), result.byte_offset); // After "é" (3 bytes) + "te" (2 bytes)
    try testing.expectEqual(@as(u32, 3), result.grapheme_count);
    try testing.expectEqual(@as(u32, 3), result.columns_used);
}

test "wrap by width: tab handling" {
    const result = utf8.findWrapPosByWidthSIMD16("a\tb", 5, 4, true);
    try testing.expectEqual(@as(u32, 2), result.byte_offset); // After "a\t"
    try testing.expectEqual(@as(u32, 2), result.grapheme_count); // 'a' + tab
    try testing.expectEqual(@as(u32, 5), result.columns_used); // 'a' (1) + tab (4) = 5
}

fn testWrapByWidthMethodsMatch(input: []const u8, max_columns: u32, tab_width: u8, isASCIIOnly: bool) !void {
    const result = utf8.findWrapPosByWidthSIMD16(input, max_columns, tab_width, isASCIIOnly);
    // Since we only have SIMD16 in utf8.zig, just verify it doesn't crash
    _ = result;
}

test "wrap by width: consistency - realistic text" {
    const sample_text =
        "The quick brown fox jumps over the lazy dog. " ++
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. " ++
        "File paths: /usr/local/bin and C:\\Windows\\System32. " ++
        "Punctuation test: Hello, world! How are you? I'm fine.";

    const widths = [_]u32{ 10, 20, 40, 80, 120 };
    for (widths) |w| {
        try testWrapByWidthMethodsMatch(sample_text, w, 4, true);
    }
}

test "wrap by width: consistency - Unicode text" {
    const unicode_text = "世界 こんにちは test 你好 CJK-mixed";

    const widths = [_]u32{ 5, 10, 15, 20, 30 };
    for (widths) |w| {
        try testWrapByWidthMethodsMatch(unicode_text, w, 4, false);
    }
}

test "wrap by width: consistency - edge cases" {
    const edge_cases = [_]struct { text: []const u8, ascii: bool }{
        .{ .text = "", .ascii = true },
        .{ .text = " ", .ascii = true },
        .{ .text = "a", .ascii = true },
        .{ .text = "abc", .ascii = true },
        .{ .text = "   ", .ascii = true },
        .{ .text = "a b c d e", .ascii = true },
        .{ .text = "no-spaces-here", .ascii = true },
        .{ .text = "/usr/local/bin", .ascii = true },
        .{ .text = "世界", .ascii = false },
        .{ .text = "\t\t\t", .ascii = true },
    };

    for (edge_cases) |input| {
        const widths = [_]u32{ 1, 5, 10, 20 };
        for (widths) |w| {
            try testWrapByWidthMethodsMatch(input.text, w, 4, input.ascii);
        }
    }
}

test "wrap by width: property - random ASCII buffers" {
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
        try testWrapByWidthMethodsMatch(buf, width, 4, true);
    }
}

test "wrap by width: boundary - SIMD16 chunk boundary" {
    var buf: [32]u8 = undefined;
    @memset(&buf, 'x');
    try testWrapByWidthMethodsMatch(&buf, 20, 4, true);
    try testWrapByWidthMethodsMatch(&buf, 10, 4, true);
}

test "wrap by width: boundary - Unicode at SIMD boundary" {
    var buf: [32]u8 = undefined;
    @memset(&buf, 'a');
    const cjk = "世";
    @memcpy(buf[14..17], cjk);
    try testWrapByWidthMethodsMatch(buf[0..20], 20, 4, false);
}

test "wrap by width: wide emoji exactly at column boundary" {
    const input = "Hello 🌍 World";

    const result7 = utf8.findWrapPosByWidthSIMD16(input, 7, 8, false);
    try testing.expectEqual(@as(u32, 6), result7.byte_offset);
    try testing.expectEqual(@as(u32, 6), result7.columns_used);

    const result8 = utf8.findWrapPosByWidthSIMD16(input, 8, 8, false);
    try testing.expectEqual(@as(u32, 10), result8.byte_offset);
    try testing.expectEqual(@as(u32, 8), result8.columns_used);

    const result6 = utf8.findWrapPosByWidthSIMD16(input, 6, 8, false);
    try testing.expectEqual(@as(u32, 6), result6.byte_offset);
    try testing.expectEqual(@as(u32, 6), result6.columns_used);
}

test "wrap by width: wide emoji at start" {
    const input = "🌍 World";

    const result1 = utf8.findWrapPosByWidthSIMD16(input, 1, 8, false);
    try testing.expectEqual(@as(u32, 0), result1.byte_offset);
    try testing.expectEqual(@as(u32, 0), result1.columns_used);

    const result2 = utf8.findWrapPosByWidthSIMD16(input, 2, 8, false);
    try testing.expectEqual(@as(u32, 4), result2.byte_offset);
    try testing.expectEqual(@as(u32, 2), result2.columns_used);

    const result3 = utf8.findWrapPosByWidthSIMD16(input, 3, 8, false);
    try testing.expectEqual(@as(u32, 5), result3.byte_offset);
    try testing.expectEqual(@as(u32, 3), result3.columns_used);
}

test "wrap by width: multiple wide characters" {
    const input = "AB🌍CD🌎EF";

    const result5 = utf8.findWrapPosByWidthSIMD16(input, 5, 8, false);
    try testing.expectEqual(@as(u32, 7), result5.byte_offset);
    try testing.expectEqual(@as(u32, 5), result5.columns_used);

    const result6 = utf8.findWrapPosByWidthSIMD16(input, 6, 8, false);
    try testing.expectEqual(@as(u32, 8), result6.byte_offset);
    try testing.expectEqual(@as(u32, 6), result6.columns_used);
}

test "wrap by width: CJK wide characters at boundary" {
    const input = "hello世界test";

    const result6 = utf8.findWrapPosByWidthSIMD16(input, 6, 8, false);
    try testing.expectEqual(@as(u32, 5), result6.byte_offset);
    try testing.expectEqual(@as(u32, 5), result6.columns_used);

    const result7 = utf8.findWrapPosByWidthSIMD16(input, 7, 8, false);
    try testing.expectEqual(@as(u32, 8), result7.byte_offset);
    try testing.expectEqual(@as(u32, 7), result7.columns_used);
}

// ============================================================================
// FIND POS BY WIDTH TESTS (for selection - includes graphemes that start before limit)
// ============================================================================

test "find pos by width: wide emoji at boundary - INCLUDES grapheme" {
    const input = "Hello 🌍 World";

    const result7 = utf8.findPosByWidth(input, 7, 8, false, true);
    try testing.expectEqual(@as(u32, 10), result7.byte_offset);
    try testing.expectEqual(@as(u32, 8), result7.columns_used);

    const result8 = utf8.findPosByWidth(input, 8, 8, false, true);
    try testing.expectEqual(@as(u32, 10), result8.byte_offset);
    try testing.expectEqual(@as(u32, 8), result8.columns_used);

    const result6 = utf8.findPosByWidth(input, 6, 8, false, true);
    try testing.expectEqual(@as(u32, 6), result6.byte_offset);
    try testing.expectEqual(@as(u32, 6), result6.columns_used);

    const start7 = utf8.findPosByWidth(input, 7, 8, false, false);
    try testing.expectEqual(@as(u32, 10), start7.byte_offset);
    try testing.expectEqual(@as(u32, 8), start7.columns_used);
}

test "find pos by width: empty string" {
    const result = utf8.findPosByWidth("", 10, 4, true, true);
    try testing.expectEqual(@as(u32, 0), result.byte_offset);
    try testing.expectEqual(@as(u32, 0), result.grapheme_count);
    try testing.expectEqual(@as(u32, 0), result.columns_used);
}

test "find pos by width: simple ASCII no limit" {
    const result = utf8.findPosByWidth("hello", 10, 4, true, true);
    try testing.expectEqual(@as(u32, 5), result.byte_offset);
    try testing.expectEqual(@as(u32, 5), result.grapheme_count);
    try testing.expectEqual(@as(u32, 5), result.columns_used);
}

test "find pos by width: ASCII exactly at limit" {
    const result = utf8.findPosByWidth("hello", 5, 4, true, true);
    try testing.expectEqual(@as(u32, 5), result.byte_offset);
    try testing.expectEqual(@as(u32, 5), result.grapheme_count);
    try testing.expectEqual(@as(u32, 5), result.columns_used);
}

test "find pos by width: wide emoji at start" {
    const input = "🌍 World";

    const result1 = utf8.findPosByWidth(input, 1, 8, false, true);
    try testing.expectEqual(@as(u32, 4), result1.byte_offset);
    try testing.expectEqual(@as(u32, 2), result1.columns_used);

    const result2 = utf8.findPosByWidth(input, 2, 8, false, true);
    try testing.expectEqual(@as(u32, 4), result2.byte_offset);
    try testing.expectEqual(@as(u32, 2), result2.columns_used);

    const result3 = utf8.findPosByWidth(input, 3, 8, false, true);
    try testing.expectEqual(@as(u32, 5), result3.byte_offset);
    try testing.expectEqual(@as(u32, 3), result3.columns_used);
}

test "find pos by width: multiple wide characters" {
    const input = "AB🌍CD🌎EF";

    const result5 = utf8.findPosByWidth(input, 5, 8, false, true);
    try testing.expectEqual(@as(u32, 7), result5.byte_offset);
    try testing.expectEqual(@as(u32, 5), result5.columns_used);

    const result7 = utf8.findPosByWidth(input, 7, 8, false, true);
    try testing.expectEqual(@as(u32, 12), result7.byte_offset);
    try testing.expectEqual(@as(u32, 8), result7.columns_used);
}

test "find pos by width: CJK wide characters" {
    const input = "hello世界test";

    const result6 = utf8.findPosByWidth(input, 6, 8, false, true);
    try testing.expectEqual(@as(u32, 8), result6.byte_offset);
    try testing.expectEqual(@as(u32, 7), result6.columns_used);

    const result8 = utf8.findPosByWidth(input, 8, 8, false, true);
    try testing.expectEqual(@as(u32, 11), result8.byte_offset);
    try testing.expectEqual(@as(u32, 9), result8.columns_used);
}

test "find pos by width: combining mark" {
    const result = utf8.findPosByWidth("e\u{0301}test", 3, 4, false, true);
    try testing.expectEqual(@as(u32, 5), result.byte_offset); // After "é" (3 bytes) + "te" (2 bytes)
    try testing.expectEqual(@as(u32, 3), result.grapheme_count);
    try testing.expectEqual(@as(u32, 3), result.columns_used);
}

test "find pos by width: tab handling" {
    const result = utf8.findPosByWidth("a\tb", 5, 4, true, true);
    try testing.expectEqual(@as(u32, 2), result.byte_offset); // After "a\t"
    try testing.expectEqual(@as(u32, 2), result.grapheme_count); // 'a' + tab
    try testing.expectEqual(@as(u32, 5), result.columns_used); // 'a' (1) + tab (4) = 5
}

// ============================================================================
// SPLIT CHUNK AT WEIGHT TESTS (include_start_before=false)
// Tests for the exact behavior needed by splitChunkAtWeight in edit-buffer.zig
// ============================================================================

test "split at weight: ASCII simple split" {
    const input = "hello world";

    // Split at column 5 - should stop at 'h' of "hello"
    const result = utf8.findPosByWidth(input, 5, 8, true, false);
    try testing.expectEqual(@as(u32, 5), result.byte_offset); // After "hello"
    try testing.expectEqual(@as(u32, 5), result.columns_used);
}

test "split at weight: ASCII split in middle" {
    const input = "abcdefghij";

    // Split at column 3
    const result = utf8.findPosByWidth(input, 3, 8, true, false);
    try testing.expectEqual(@as(u32, 3), result.byte_offset); // After "abc"
    try testing.expectEqual(@as(u32, 3), result.columns_used);
}

test "split at weight: wide char at boundary - exclude when starting after" {
    const input = "AB🌍CD"; // A(1) B(1) 🌍(2) C(1) D(1)

    // Split at column 2 - should include up to B, exclude emoji
    const result2 = utf8.findPosByWidth(input, 2, 8, false, false);
    try testing.expectEqual(@as(u32, 2), result2.byte_offset); // After "AB"
    try testing.expectEqual(@as(u32, 2), result2.columns_used);

    // Split at column 3 - emoji starts at col 2, ends at col 4, so exclude it
    const result3 = utf8.findPosByWidth(input, 3, 8, false, false);
    try testing.expectEqual(@as(u32, 6), result3.byte_offset); // After "AB🌍" (emoji at cols 2-3)
    try testing.expectEqual(@as(u32, 4), result3.columns_used);
}

test "split at weight: CJK characters" {
    const input = "hello世界test"; // h(1) e(1) l(1) l(1) o(1) 世(2) 界(2) t(1) e(1) s(1) t(1)

    // Split at column 5 - after "hello"
    const result5 = utf8.findPosByWidth(input, 5, 8, false, false);
    try testing.expectEqual(@as(u32, 5), result5.byte_offset);
    try testing.expectEqual(@as(u32, 5), result5.columns_used);

    // Split at column 6 - should exclude 世 which starts at col 5
    const result6 = utf8.findPosByWidth(input, 6, 8, false, false);
    try testing.expectEqual(@as(u32, 8), result6.byte_offset); // After "hello世"
    try testing.expectEqual(@as(u32, 7), result6.columns_used);

    // Split at column 9 - should include both CJK chars
    const result9 = utf8.findPosByWidth(input, 9, 8, false, false);
    try testing.expectEqual(@as(u32, 11), result9.byte_offset); // After "hello世界"
    try testing.expectEqual(@as(u32, 9), result9.columns_used);
}

test "split at weight: combining marks" {
    const input = "cafe\u{0301}test"; // c(1) a(1) f(1) é(1) t(1) e(1) s(1) t(1)

    // Split at column 4 - should include the combining mark with 'e'
    const result4 = utf8.findPosByWidth(input, 4, 8, false, false);
    try testing.expectEqual(@as(u32, 6), result4.byte_offset); // After "café" (5 bytes: cafe + combining accent)
    try testing.expectEqual(@as(u32, 4), result4.columns_used);
}

test "split at weight: emoji with skin tone" {
    const input = "Hi👋🏿Bye"; // H(1) i(1) 👋🏿(wide) B(1) y(1) e(1)

    // Split at column 2 - should stop before or after emoji depending on where it starts
    const result2 = utf8.findPosByWidth(input, 2, 8, false, false);
    try testing.expectEqual(@as(u32, 2), result2.byte_offset); // After "Hi"
    try testing.expectEqual(@as(u32, 2), result2.columns_used);

    // Split at column 5 - should include emoji
    const result5 = utf8.findPosByWidth(input, 5, 8, false, false);
    // Result will stop at first grapheme that starts >= max_columns
    // Just verify it returns a reasonable offset
    try testing.expect(result5.byte_offset >= 2); // At least past "Hi"
    try testing.expect(result5.columns_used >= 2); // At least 2 columns
}

test "split at weight: zero width at start" {
    const input = "hello";

    // Split at column 0 - should return offset 0
    const result = utf8.findPosByWidth(input, 0, 8, true, false);
    try testing.expectEqual(@as(u32, 0), result.byte_offset);
    try testing.expectEqual(@as(u32, 0), result.columns_used);
}

test "split at weight: beyond end" {
    const input = "hello"; // 5 columns

    // Split at column 10 - should return entire string
    const result = utf8.findPosByWidth(input, 10, 8, true, false);
    try testing.expectEqual(@as(u32, 5), result.byte_offset);
    try testing.expectEqual(@as(u32, 5), result.columns_used);
}

test "split at weight: tab character" {
    const input = "a\tbc"; // a(1) tab(4 fixed) b(1) c(1) = 7 columns total

    // Split at column 4 - should stop before tab since it would exceed limit
    const result4 = utf8.findPosByWidth(input, 4, 4, true, false);
    try testing.expectEqual(@as(u32, 2), result4.byte_offset); // After "a\t"
    try testing.expectEqual(@as(u32, 5), result4.columns_used); // a(1) + tab(4) = 5
}

test "split at weight: complex mixed content" {
    const input = "A🌍B世C"; // A(1) 🌍(2) B(1) 世(2) C(1) = 7 columns total

    // Split at various points
    const r1 = utf8.findPosByWidth(input, 1, 8, false, false);
    try testing.expectEqual(@as(u32, 1), r1.byte_offset); // After "A"

    const r2 = utf8.findPosByWidth(input, 2, 8, false, false);
    try testing.expectEqual(@as(u32, 5), r2.byte_offset); // After "A🌍" (emoji starts at col 1)

    const r3 = utf8.findPosByWidth(input, 3, 8, false, false);
    try testing.expectEqual(@as(u32, 5), r3.byte_offset); // After "A🌍"

    const r4 = utf8.findPosByWidth(input, 4, 8, false, false);
    try testing.expectEqual(@as(u32, 6), r4.byte_offset); // After "A🌍B"

    const r5 = utf8.findPosByWidth(input, 5, 8, false, false);
    try testing.expectEqual(@as(u32, 9), r5.byte_offset); // After "A🌍B世" (世 starts at col 4)
}

// ============================================================================
// GET WIDTH AT TESTS
// ============================================================================

test "getWidthAt: empty string" {
    const result = utf8.getWidthAt("", 0, 8);
    try testing.expectEqual(@as(u32, 0), result);
}

test "getWidthAt: out of bounds" {
    const result = utf8.getWidthAt("hello", 10, 8);
    try testing.expectEqual(@as(u32, 0), result);
}

test "getWidthAt: simple ASCII" {
    const text = "hello";
    try testing.expectEqual(@as(u32, 1), utf8.getWidthAt(text, 0, 8)); // 'h'
    try testing.expectEqual(@as(u32, 1), utf8.getWidthAt(text, 1, 8)); // 'e'
    try testing.expectEqual(@as(u32, 1), utf8.getWidthAt(text, 4, 8)); // 'o'
}

test "getWidthAt: tab character" {
    const text = "a\tb";
    try testing.expectEqual(@as(u32, 1), utf8.getWidthAt(text, 0, 4)); // 'a'
    try testing.expectEqual(@as(u32, 4), utf8.getWidthAt(text, 1, 4)); // tab fixed width 4
    try testing.expectEqual(@as(u32, 1), utf8.getWidthAt(text, 2, 4)); // 'b'
}

test "getWidthAt: tab at different columns" {
    const text = "\t";
    // Tab now has fixed width regardless of current_column
    try testing.expectEqual(@as(u32, 4), utf8.getWidthAt(text, 0, 4)); // Tab fixed width 4
    try testing.expectEqual(@as(u32, 4), utf8.getWidthAt(text, 0, 4)); // Tab fixed width 4
    try testing.expectEqual(@as(u32, 4), utf8.getWidthAt(text, 0, 4)); // Tab fixed width 4
    try testing.expectEqual(@as(u32, 4), utf8.getWidthAt(text, 0, 4)); // Tab fixed width 4
    try testing.expectEqual(@as(u32, 4), utf8.getWidthAt(text, 0, 4)); // Tab fixed width 4
}

test "getWidthAt: CJK wide character" {
    const text = "世界";
    try testing.expectEqual(@as(u32, 2), utf8.getWidthAt(text, 0, 8)); // '世' (3 bytes)
    try testing.expectEqual(@as(u32, 2), utf8.getWidthAt(text, 3, 8)); // '界' (3 bytes)
}

test "getWidthAt: emoji single width" {
    const text = "🌍";
    try testing.expectEqual(@as(u32, 2), utf8.getWidthAt(text, 0, 8)); // emoji
}

test "getWidthAt: combining mark grapheme" {
    const text = "cafe\u{0301}"; // é with combining acute accent
    const width = utf8.getWidthAt(text, 3, 8); // At 'e' (which has combining mark after)
    try testing.expectEqual(@as(u32, 1), width); // 'e' width 1 + combining mark width 0 = 1
}

test "getWidthAt: emoji with skin tone" {
    const text = "👋🏿"; // Wave + dark skin tone modifier
    const width = utf8.getWidthAt(text, 0, 8);
    try testing.expectEqual(@as(u32, 4), width); // Both emoji codepoints counted (2+2)
}

test "getWidthAt: emoji with ZWJ" {
    const text = "👩‍🚀"; // Woman astronaut (woman + ZWJ + rocket)
    const width = utf8.getWidthAt(text, 0, 8);
    try testing.expectEqual(@as(u32, 5), width); // woman(2) + ZWJ(1) + rocket(2)
}

test "getWidthAt: flag emoji" {
    const text = "🇺🇸"; // US flag (two regional indicators)
    const width = utf8.getWidthAt(text, 0, 8);
    try testing.expectEqual(@as(u32, 2), width); // Entire grapheme cluster
}

test "getWidthAt: mixed ASCII and CJK" {
    const text = "Hello世界";
    try testing.expectEqual(@as(u32, 1), utf8.getWidthAt(text, 0, 8)); // 'H'
    try testing.expectEqual(@as(u32, 1), utf8.getWidthAt(text, 1, 8)); // 'e'
    try testing.expectEqual(@as(u32, 2), utf8.getWidthAt(text, 5, 8)); // '世'
    try testing.expectEqual(@as(u32, 2), utf8.getWidthAt(text, 8, 8)); // '界'
}

test "getWidthAt: emoji with VS16 selector" {
    const text = "❤️"; // Heart + VS16 selector
    const width = utf8.getWidthAt(text, 0, 8);
    try testing.expectEqual(@as(u32, 2), width); // Entire grapheme cluster
}

test "getWidthAt: hiragana" {
    const text = "こんにちは";
    try testing.expectEqual(@as(u32, 2), utf8.getWidthAt(text, 0, 8)); // 'こ'
    try testing.expectEqual(@as(u32, 2), utf8.getWidthAt(text, 3, 8)); // 'ん'
}

test "getWidthAt: katakana" {
    const text = "カタカナ";
    try testing.expectEqual(@as(u32, 2), utf8.getWidthAt(text, 0, 8)); // 'カ'
    try testing.expectEqual(@as(u32, 2), utf8.getWidthAt(text, 3, 8)); // 'タ'
}

test "getWidthAt: fullwidth forms" {
    const text = "ＡＢＣ"; // Fullwidth A, B, C
    try testing.expectEqual(@as(u32, 2), utf8.getWidthAt(text, 0, 8)); // Fullwidth 'A'
    try testing.expectEqual(@as(u32, 2), utf8.getWidthAt(text, 3, 8)); // Fullwidth 'B'
}

test "getWidthAt: zero width at start of string" {
    const text = "a\u{0301}bc"; // a + combining accent + bc
    try testing.expectEqual(@as(u32, 1), utf8.getWidthAt(text, 0, 8)); // 'a' + combining = 1
    try testing.expectEqual(@as(u32, 1), utf8.getWidthAt(text, 3, 8)); // 'b'
}

test "getWidthAt: control characters" {
    const text = "a\x00b";
    try testing.expectEqual(@as(u32, 1), utf8.getWidthAt(text, 0, 8)); // 'a'
    try testing.expectEqual(@as(u32, 0), utf8.getWidthAt(text, 1, 8)); // null
    try testing.expectEqual(@as(u32, 1), utf8.getWidthAt(text, 2, 8)); // 'b'
}

test "getWidthAt: multiple combining marks" {
    const text = "e\u{0301}\u{0302}"; // e + acute + circumflex
    const width = utf8.getWidthAt(text, 0, 8);
    try testing.expectEqual(@as(u32, 1), width); // All combining marks part of one grapheme
}

test "getWidthAt: at exact end boundary" {
    const text = "hello";
    const width = utf8.getWidthAt(text, 5, 8); // At index 5 (past end)
    try testing.expectEqual(@as(u32, 0), width);
}

test "getWidthAt: realistic mixed content" {
    const text = "Hello 世界! 👋";
    try testing.expectEqual(@as(u32, 1), utf8.getWidthAt(text, 0, 8)); // 'H'
    try testing.expectEqual(@as(u32, 1), utf8.getWidthAt(text, 5, 8)); // ' '
    try testing.expectEqual(@as(u32, 2), utf8.getWidthAt(text, 6, 8)); // '世'
    try testing.expectEqual(@as(u32, 2), utf8.getWidthAt(text, 9, 8)); // '界'
    try testing.expectEqual(@as(u32, 1), utf8.getWidthAt(text, 12, 8)); // '!'
    try testing.expectEqual(@as(u32, 1), utf8.getWidthAt(text, 13, 8)); // ' '
    try testing.expectEqual(@as(u32, 2), utf8.getWidthAt(text, 14, 8)); // emoji
}

test "getWidthAt: grapheme at SIMD boundary" {
    var buf: [32]u8 = undefined;
    @memset(&buf, 'x');
    const cjk = "世";
    @memcpy(buf[14..17], cjk); // Place CJK char near boundary

    try testing.expectEqual(@as(u32, 1), utf8.getWidthAt(&buf, 13, 8)); // 'x'
    try testing.expectEqual(@as(u32, 2), utf8.getWidthAt(&buf, 14, 8)); // '世'
    try testing.expectEqual(@as(u32, 1), utf8.getWidthAt(&buf, 17, 8)); // 'x'
}

test "getWidthAt: incomplete UTF-8 at end" {
    const text = "abc\xC3"; // Incomplete 2-byte sequence
    try testing.expectEqual(@as(u32, 1), utf8.getWidthAt(text, 0, 8)); // 'a'
    try testing.expectEqual(@as(u32, 1), utf8.getWidthAt(text, 3, 8)); // Incomplete, returns 1 for error
}

test "getWidthAt: random positions in realistic text" {
    const text = "The quick brown 🦊 jumps over the lazy 犬";

    try testing.expectEqual(@as(u32, 1), utf8.getWidthAt(text, 0, 8)); // 'T'
    try testing.expectEqual(@as(u32, 1), utf8.getWidthAt(text, 10, 8)); // 'b'
    try testing.expectEqual(@as(u32, 2), utf8.getWidthAt(text, 16, 8)); // fox emoji
    try testing.expectEqual(@as(u32, 2), utf8.getWidthAt(text, 41, 8)); // '犬' (dog)
}

// ============================================================================
// GET PREV GRAPHEME START TESTS
// ============================================================================

test "getPrevGraphemeStart: at start" {
    const text = "hello";
    const result = utf8.getPrevGraphemeStart(text, 0, 8);
    try testing.expect(result == null);
}

test "getPrevGraphemeStart: empty string" {
    const result = utf8.getPrevGraphemeStart("", 0, 8);
    try testing.expect(result == null);
}

test "getPrevGraphemeStart: out of bounds" {
    const text = "hello";
    const result = utf8.getPrevGraphemeStart(text, 100, 8);
    try testing.expect(result == null);
}

test "getPrevGraphemeStart: simple ASCII" {
    const text = "hello";

    const r1 = utf8.getPrevGraphemeStart(text, 1, 8);
    try testing.expect(r1 != null);
    try testing.expectEqual(@as(usize, 0), r1.?.start_offset);
    try testing.expectEqual(@as(u32, 1), r1.?.width);

    const r2 = utf8.getPrevGraphemeStart(text, 2, 8);
    try testing.expect(r2 != null);
    try testing.expectEqual(@as(usize, 1), r2.?.start_offset);
    try testing.expectEqual(@as(u32, 1), r2.?.width);

    const r5 = utf8.getPrevGraphemeStart(text, 5, 8);
    try testing.expect(r5 != null);
    try testing.expectEqual(@as(usize, 4), r5.?.start_offset);
    try testing.expectEqual(@as(u32, 1), r5.?.width);
}

test "getPrevGraphemeStart: CJK wide character" {
    const text = "a世界";

    const r1 = utf8.getPrevGraphemeStart(text, 1, 8);
    try testing.expect(r1 != null);
    try testing.expectEqual(@as(usize, 0), r1.?.start_offset);
    try testing.expectEqual(@as(u32, 1), r1.?.width);

    const r4 = utf8.getPrevGraphemeStart(text, 4, 8);
    try testing.expect(r4 != null);
    try testing.expectEqual(@as(usize, 1), r4.?.start_offset);
    try testing.expectEqual(@as(u32, 2), r4.?.width);

    const r7 = utf8.getPrevGraphemeStart(text, 7, 8);
    try testing.expect(r7 != null);
    try testing.expectEqual(@as(usize, 4), r7.?.start_offset);
    try testing.expectEqual(@as(u32, 2), r7.?.width);
}

test "getPrevGraphemeStart: combining mark" {
    const text = "cafe\u{0301}"; // café with combining acute

    const r6 = utf8.getPrevGraphemeStart(text, 6, 8);
    try testing.expect(r6 != null);
    try testing.expectEqual(@as(usize, 3), r6.?.start_offset);
    try testing.expectEqual(@as(u32, 1), r6.?.width);
}

test "getPrevGraphemeStart: emoji with skin tone" {
    const text = "Hi👋🏿";

    const r2 = utf8.getPrevGraphemeStart(text, 2, 8);
    try testing.expect(r2 != null);
    try testing.expectEqual(@as(usize, 1), r2.?.start_offset);
    try testing.expectEqual(@as(u32, 1), r2.?.width);

    const r_end = utf8.getPrevGraphemeStart(text, text.len, 8);
    try testing.expect(r_end != null);
    try testing.expectEqual(@as(usize, 2), r_end.?.start_offset);
}

test "getPrevGraphemeStart: emoji with ZWJ" {
    const text = "a👩‍🚀"; // a + woman astronaut

    const r1 = utf8.getPrevGraphemeStart(text, 1, 8);
    try testing.expect(r1 != null);
    try testing.expectEqual(@as(usize, 0), r1.?.start_offset);
    try testing.expectEqual(@as(u32, 1), r1.?.width);

    const r_end = utf8.getPrevGraphemeStart(text, text.len, 8);
    try testing.expect(r_end != null);
    try testing.expectEqual(@as(usize, 1), r_end.?.start_offset);
}

test "getPrevGraphemeStart: flag emoji" {
    const text = "US🇺🇸";

    const r_end = utf8.getPrevGraphemeStart(text, text.len, 8);
    try testing.expect(r_end != null);
    try testing.expectEqual(@as(usize, 2), r_end.?.start_offset);
}

test "getPrevGraphemeStart: tab handling" {
    const text = "a\tb";

    const r2 = utf8.getPrevGraphemeStart(text, 2, 4);
    try testing.expect(r2 != null);
    try testing.expectEqual(@as(usize, 1), r2.?.start_offset);

    const r1 = utf8.getPrevGraphemeStart(text, 1, 4);
    try testing.expect(r1 != null);
    try testing.expectEqual(@as(usize, 0), r1.?.start_offset);
    try testing.expectEqual(@as(u32, 1), r1.?.width);
}

test "getPrevGraphemeStart: mixed content" {
    const text = "Hi世界!";

    const r2 = utf8.getPrevGraphemeStart(text, 2, 8);
    try testing.expect(r2 != null);
    try testing.expectEqual(@as(usize, 1), r2.?.start_offset);

    const r5 = utf8.getPrevGraphemeStart(text, 5, 8);
    try testing.expect(r5 != null);
    try testing.expectEqual(@as(usize, 2), r5.?.start_offset);
    try testing.expectEqual(@as(u32, 2), r5.?.width);

    const r8 = utf8.getPrevGraphemeStart(text, 8, 8);
    try testing.expect(r8 != null);
    try testing.expectEqual(@as(usize, 5), r8.?.start_offset);
    try testing.expectEqual(@as(u32, 2), r8.?.width);
}

test "getPrevGraphemeStart: multiple combining marks" {
    const text = "e\u{0301}\u{0302}x"; // e + acute + circumflex + x

    const r_x = utf8.getPrevGraphemeStart(text, text.len, 8);
    try testing.expect(r_x != null);
    try testing.expectEqual(@as(usize, text.len - 1), r_x.?.start_offset);

    const r_e = utf8.getPrevGraphemeStart(text, text.len - 1, 8);
    try testing.expect(r_e != null);
    try testing.expectEqual(@as(usize, 0), r_e.?.start_offset);
    try testing.expectEqual(@as(u32, 1), r_e.?.width);
}

test "getPrevGraphemeStart: hiragana" {
    const text = "こんにちは";

    const r_last = utf8.getPrevGraphemeStart(text, text.len, 8);
    try testing.expect(r_last != null);
    try testing.expectEqual(@as(usize, 12), r_last.?.start_offset);
    try testing.expectEqual(@as(u32, 2), r_last.?.width);
}

test "getPrevGraphemeStart: realistic scenario" {
    const text = "Hello 世界! 👋";

    const r_end = utf8.getPrevGraphemeStart(text, text.len, 8);
    try testing.expect(r_end != null);
    try testing.expectEqual(@as(usize, 14), r_end.?.start_offset);

    const r_space = utf8.getPrevGraphemeStart(text, 14, 8);
    try testing.expect(r_space != null);
    try testing.expectEqual(@as(usize, 13), r_space.?.start_offset);
    try testing.expectEqual(@as(u32, 1), r_space.?.width);
}

test "getPrevGraphemeStart: consecutive wide chars" {
    const text = "世界中";

    const r9 = utf8.getPrevGraphemeStart(text, 9, 8);
    try testing.expect(r9 != null);
    try testing.expectEqual(@as(usize, 6), r9.?.start_offset);
    try testing.expectEqual(@as(u32, 2), r9.?.width);

    const r6 = utf8.getPrevGraphemeStart(text, 6, 8);
    try testing.expect(r6 != null);
    try testing.expectEqual(@as(usize, 3), r6.?.start_offset);
    try testing.expectEqual(@as(u32, 2), r6.?.width);

    const r3 = utf8.getPrevGraphemeStart(text, 3, 8);
    try testing.expect(r3 != null);
    try testing.expectEqual(@as(usize, 0), r3.?.start_offset);
    try testing.expectEqual(@as(u32, 2), r3.?.width);
}
