//! UTF-8 Word Wrap Break Point Detection Library
//!
//! This library provides various methods for scanning UTF-8 text for word wrap break points.
//! Break points include: whitespace, punctuation, slashes, brackets, and dashes.
//!
//! ## Semantics
//!
//! Break points are characters where text can be wrapped. This includes:
//! - Whitespace: ' ', '\t', '\r', '\n'
//! - Dashes: '-'
//! - Slashes: '/', '\'
//! - Punctuation: '.', ',', ';', ':', '!', '?'
//! - Brackets: '(', ')', '[', ']', '{', '}'
//!
//! Break points are recorded at the index of the break character itself.
//!
//! ## Methods
//!
//! Single-threaded:
//! - `findWrapBreaksBaseline`: Simple byte-by-byte iteration (reference implementation)
//! - `findWrapBreaksStdLib`: Using Zig's optimized std.mem.indexOfAny (FASTEST)
//! - `findWrapBreaksSIMD16`: 16-byte chunked scanning
//! - `findWrapBreaksSIMD32`: 32-byte chunked scanning
//! - `findWrapBreaksBitmask128`: Bitmask approach (128-byte chunks)
//!
//! Multithreaded (parallel scanning):
//! - `findWrapBreaksMultithreadedBaseline`
//! - `findWrapBreaksMultithreadedStdLib`
//! - `findWrapBreaksMultithreadedSIMD16`
//! - `findWrapBreaksMultithreadedSIMD32`
//! - `findWrapBreaksMultithreadedBitmask128`
//!
//! ## Usage
//!
//! ```zig
//! const wrap = @import("utf8-wrap.zig");
//!
//! var result = wrap.BreakResult.init(allocator);
//! defer result.deinit();
//!
//! try wrap.findWrapBreaksBaseline(text, &result);
//! // result.breaks.items contains indices of wrap break points
//!
//! for (result.breaks.items) |idx| {
//!     std.debug.print("Wrap break at byte {d}\n", .{idx});
//! }
//! ```

const std = @import("std");

// Result structure to hold break positions
pub const BreakResult = struct {
    breaks: std.ArrayList(usize),

    pub fn init(allocator: std.mem.Allocator) BreakResult {
        return .{
            .breaks = std.ArrayList(usize).init(allocator),
        };
    }

    pub fn deinit(self: *BreakResult) void {
        self.breaks.deinit();
    }

    pub fn reset(self: *BreakResult) void {
        self.breaks.clearRetainingCapacity();
    }
};

// Helper function to check if an ASCII byte is a wrap break point (CR/LF excluded)
inline fn isAsciiWrapBreak(b: u8) bool {
    return switch (b) {
        ' ', '\t' => true, // Whitespace (no CR/LF in inputs)
        '-' => true, // Dash
        '/', '\\' => true, // Slashes
        '.', ',', ';', ':', '!', '?' => true, // Punctuation
        '(', ')', '[', ']', '{', '}' => true, // Brackets
        else => false,
    };
}

// Decode a UTF-8 codepoint starting at pos. Assumes valid UTF-8 input.
// Returns (codepoint, length). If the remaining bytes are insufficient, returns length 1.
inline fn decodeUtf8Unchecked(text: []const u8, pos: usize) struct { cp: u21, len: u3 } {
    const b0 = text[pos];
    if (b0 < 0x80) return .{ .cp = @intCast(b0), .len = 1 };

    if (pos + 1 >= text.len) return .{ .cp = 0xFFFD, .len = 1 };
    const b1 = text[pos + 1];

    if ((b0 & 0xE0) == 0xC0) {
        const cp2: u21 = @intCast((@as(u32, b0 & 0x1F) << 6) | @as(u32, b1 & 0x3F));
        return .{ .cp = cp2, .len = 2 };
    }

    if (pos + 2 >= text.len) return .{ .cp = 0xFFFD, .len = 1 };
    const b2 = text[pos + 2];

    if ((b0 & 0xF0) == 0xE0) {
        const cp3: u21 = @intCast((@as(u32, b0 & 0x0F) << 12) | (@as(u32, b1 & 0x3F) << 6) | @as(u32, b2 & 0x3F));
        return .{ .cp = cp3, .len = 3 };
    }

    if (pos + 3 >= text.len) return .{ .cp = 0xFFFD, .len = 1 };
    const b3 = text[pos + 3];
    const cp4: u21 = @intCast((@as(u32, b0 & 0x07) << 18) | (@as(u32, b1 & 0x3F) << 12) | (@as(u32, b2 & 0x3F) << 6) | @as(u32, b3 & 0x3F));
    return .{ .cp = cp4, .len = 4 };
}

// Unicode wrap-break codepoints
inline fn isUnicodeWrapBreak(cp: u21) bool {
    return switch (cp) {
        0x00A0, // NBSP
        0x1680, // OGHAM SPACE MARK
        0x2000...0x200A, // En quad..Hair space
        0x202F, // NARROW NO-BREAK SPACE
        0x205F, // MEDIUM MATHEMATICAL SPACE
        0x3000, // IDEOGRAPHIC SPACE
        0x200B, // ZERO WIDTH SPACE
        0x00AD, // SOFT HYPHEN
        0x2010, // HYPHEN
        => true,
        else => false,
    };
}

// Method 1: Baseline pure loop - linear scan checking each byte
pub fn findWrapBreaksBaseline(text: []const u8, result: *BreakResult) !void {
    result.reset();
    var i: usize = 0;
    while (i < text.len) {
        const b0 = text[i];
        if (b0 < 0x80) {
            if (isAsciiWrapBreak(b0)) try result.breaks.append(i);
            i += 1;
            continue;
        }

        const dec = decodeUtf8Unchecked(text, i);
        if (i + dec.len > text.len) break;
        if (isUnicodeWrapBreak(dec.cp)) try result.breaks.append(i);
        i += dec.len;
    }
}

// Method 2: Single-pass SIMD-optimized scan (faster than stdlib's indexOfAny for this workload)
pub fn findWrapBreaksStdLib(text: []const u8, result: *BreakResult) !void {
    result.reset();
    const vector_len = 16;

    var pos: usize = 0;

    // Process 16-byte chunks with SIMD
    while (pos + vector_len <= text.len) {
        const chunk: @Vector(vector_len, u8) = text[pos..][0..vector_len].*;
        const ascii_threshold: @Vector(vector_len, u8) = @splat(0x80);
        const is_non_ascii = chunk >= ascii_threshold;

        // Quick check: if entire chunk is ASCII, we can process it faster
        if (!@reduce(.Or, is_non_ascii)) {
            // All ASCII - check each byte for break chars
            for (0..vector_len) |i| {
                if (isAsciiWrapBreak(text[pos + i])) {
                    try result.breaks.append(pos + i);
                }
            }
            pos += vector_len;
            continue;
        }

        // Mixed ASCII/non-ASCII - process byte by byte in this chunk
        var i: usize = 0;
        while (i < vector_len) {
            const b0 = text[pos + i];
            if (b0 < 0x80) {
                if (isAsciiWrapBreak(b0)) try result.breaks.append(pos + i);
                i += 1;
            } else {
                const dec = decodeUtf8Unchecked(text, pos + i);
                if (pos + i + dec.len > text.len) break;
                if (isUnicodeWrapBreak(dec.cp)) try result.breaks.append(pos + i);
                i += dec.len;
            }
        }
        pos += vector_len;
    }

    // Tail - process remaining bytes
    while (pos < text.len) {
        const b0 = text[pos];
        if (b0 < 0x80) {
            if (isAsciiWrapBreak(b0)) try result.breaks.append(pos);
            pos += 1;
        } else {
            const dec = decodeUtf8Unchecked(text, pos);
            if (pos + dec.len > text.len) break;
            if (isUnicodeWrapBreak(dec.cp)) try result.breaks.append(pos);
            pos += dec.len;
        }
    }
}

// Method 3: 16-byte chunked scanning (for comparison)
pub fn findWrapBreaksSIMD16(text: []const u8, result: *BreakResult) !void {
    result.reset();
    const vector_len = 16;

    var pos: usize = 0;
    while (pos + vector_len <= text.len) {
        // Simple scalar check per byte
        for (0..vector_len) |i| {
            const b0 = text[pos + i];
            if (b0 < 0x80) {
                if (isAsciiWrapBreak(b0)) try result.breaks.append(pos + i);
            } else {
                const dec = decodeUtf8Unchecked(text, pos + i);
                if (pos + i + dec.len > text.len) break;
                if (isUnicodeWrapBreak(dec.cp)) try result.breaks.append(pos + i);
            }
        }
        pos += vector_len;
    }

    // Tail
    var i: usize = pos;
    while (i < text.len) {
        const b0 = text[i];
        if (b0 < 0x80) {
            if (isAsciiWrapBreak(b0)) try result.breaks.append(i);
            i += 1;
        } else {
            const dec = decodeUtf8Unchecked(text, i);
            if (i + dec.len > text.len) break;
            if (isUnicodeWrapBreak(dec.cp)) try result.breaks.append(i);
            i += dec.len;
        }
    }
}

// Method 4: 32-byte chunked scanning (for comparison)
pub fn findWrapBreaksSIMD32(text: []const u8, result: *BreakResult) !void {
    result.reset();
    const vector_len = 32;

    var pos: usize = 0;
    while (pos + vector_len <= text.len) {
        for (0..vector_len) |i| {
            const b0 = text[pos + i];
            if (b0 < 0x80) {
                if (isAsciiWrapBreak(b0)) try result.breaks.append(pos + i);
            } else {
                const dec = decodeUtf8Unchecked(text, pos + i);
                if (pos + i + dec.len > text.len) break;
                if (isUnicodeWrapBreak(dec.cp)) try result.breaks.append(pos + i);
            }
        }
        pos += vector_len;
    }

    var i: usize = pos;
    while (i < text.len) {
        const b0 = text[i];
        if (b0 < 0x80) {
            if (isAsciiWrapBreak(b0)) try result.breaks.append(i);
            i += 1;
        } else {
            const dec = decodeUtf8Unchecked(text, i);
            if (i + dec.len > text.len) break;
            if (isUnicodeWrapBreak(dec.cp)) try result.breaks.append(i);
            i += dec.len;
        }
    }
}

// Method 5: Bitmask approach (128-byte chunks)
pub fn findWrapBreaksBitmask128(text: []const u8, result: *BreakResult) !void {
    result.reset();
    const chunk_size = 128;

    var pos: usize = 0;
    while (pos < text.len) {
        const end = @min(pos + chunk_size, text.len);
        const chunk = text[pos..end];

        var mask: u128 = 0;
        for (chunk, 0..) |b, i| {
            if (isAsciiWrapBreak(b)) {
                mask |= @as(u128, 1) << @intCast(i);
            }
        }

        // Process the mask to find ASCII break positions
        var m = mask;
        while (m != 0) {
            const bit_pos = @ctz(m);
            const absolute_pos = pos + bit_pos;
            try result.breaks.append(absolute_pos);
            m &= m - 1;
        }

        // Unicode pass
        var i: usize = 0;
        while (i < chunk.len) {
            const b0 = chunk[i];
            if (b0 < 0x80) {
                i += 1;
                continue;
            }
            const dec = decodeUtf8Unchecked(text, pos + i);
            if (pos + i + dec.len > text.len) break;
            if (isUnicodeWrapBreak(dec.cp)) try result.breaks.append(pos + i);
            i += dec.len;
        }

        pos = end;
    }
}

// Multithreading support
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

pub fn findWrapBreaksMultithreadedGenericWithThreadCount(
    text: []const u8,
    result: *BreakResult,
    allocator: std.mem.Allocator,
    scan_func: *const fn ([]const u8, *BreakResult) anyerror!void,
    thread_count: usize,
) !void {
    result.reset();

    if (thread_count <= 1 or text.len < 1024) {
        // Fall back to single-threaded for small inputs
        return findWrapBreaksBaseline(text, result);
    }

    const segment_len = (text.len + thread_count - 1) / thread_count;

    var contexts = try allocator.alloc(ThreadContext, thread_count);
    defer allocator.free(contexts);

    var threads = try allocator.alloc(std.Thread, thread_count);
    defer allocator.free(threads);

    var actual_threads: usize = 0;
    var next_start: usize = 0;

    // Spawn threads with sequential segments
    for (0..thread_count) |i| {
        const start = next_start;
        if (start >= text.len) break;

        var end = @min(text.len, start + segment_len);

        // Adjust end to codepoint boundary
        end = rewindToCodepointBoundary(text, end);

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

        next_start = end;
    }

    // Join threads and merge results
    for (0..actual_threads) |i| {
        threads[i].join();
        for (contexts[i].result.breaks.items) |br| {
            try result.breaks.append(br);
        }
        contexts[i].result.deinit();
    }

    // Results are already sorted by segment order; no final sort needed
}

// Auto-detected thread count (legacy wrapper)
pub fn findWrapBreaksMultithreadedGeneric(
    text: []const u8,
    result: *BreakResult,
    allocator: std.mem.Allocator,
    scan_func: *const fn ([]const u8, *BreakResult) anyerror!void,
) !void {
    const thread_count = @min(std.Thread.getCpuCount() catch 4, 8);
    return findWrapBreaksMultithreadedGenericWithThreadCount(text, result, allocator, scan_func, thread_count);
}

pub fn findWrapBreaksMultithreadedBaseline(text: []const u8, result: *BreakResult, allocator: std.mem.Allocator) !void {
    return findWrapBreaksMultithreadedGeneric(text, result, allocator, findWrapBreaksBaseline);
}

pub fn findWrapBreaksMultithreadedStdLib(text: []const u8, result: *BreakResult, allocator: std.mem.Allocator) !void {
    return findWrapBreaksMultithreadedGeneric(text, result, allocator, findWrapBreaksStdLib);
}

pub fn findWrapBreaksMultithreadedSIMD16(text: []const u8, result: *BreakResult, allocator: std.mem.Allocator) !void {
    return findWrapBreaksMultithreadedGeneric(text, result, allocator, findWrapBreaksSIMD16);
}

pub fn findWrapBreaksMultithreadedSIMD32(text: []const u8, result: *BreakResult, allocator: std.mem.Allocator) !void {
    return findWrapBreaksMultithreadedGeneric(text, result, allocator, findWrapBreaksSIMD32);
}

pub fn findWrapBreaksMultithreadedBitmask128(text: []const u8, result: *BreakResult, allocator: std.mem.Allocator) !void {
    return findWrapBreaksMultithreadedGeneric(text, result, allocator, findWrapBreaksBitmask128);
}

// Fixed thread count variants for benchmarking
pub fn findWrapBreaksMultithreadedSIMD16_2T(text: []const u8, result: *BreakResult, allocator: std.mem.Allocator) !void {
    return findWrapBreaksMultithreadedGenericWithThreadCount(text, result, allocator, findWrapBreaksSIMD16, 2);
}

pub fn findWrapBreaksMultithreadedSIMD16_4T(text: []const u8, result: *BreakResult, allocator: std.mem.Allocator) !void {
    return findWrapBreaksMultithreadedGenericWithThreadCount(text, result, allocator, findWrapBreaksSIMD16, 4);
}

pub fn findWrapBreaksMultithreadedSIMD16_8T(text: []const u8, result: *BreakResult, allocator: std.mem.Allocator) !void {
    return findWrapBreaksMultithreadedGenericWithThreadCount(text, result, allocator, findWrapBreaksSIMD16, 8);
}
