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
//! - `findWrapBreaksStdLib`: Using Zig's optimized std.mem.indexOfAny
//! - `findWrapBreaksSIMD16`: Manual SIMD vectorization with 16-byte vectors (SSE2/NEON)
//! - `findWrapBreaksSIMD32`: Manual SIMD vectorization with 32-byte vectors (AVX2)
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

// Helper function to check if a byte is a wrap break point
inline fn isWrapBreak(b: u8) bool {
    return switch (b) {
        ' ', '\t', '\r', '\n' => true, // Whitespace
        '-' => true, // Dash
        '/', '\\' => true, // Slashes
        '.', ',', ';', ':', '!', '?' => true, // Punctuation
        '(', ')', '[', ']', '{', '}' => true, // Brackets
        else => false,
    };
}

// Method 1: Baseline pure loop - linear scan checking each byte
pub fn findWrapBreaksBaseline(text: []const u8, result: *BreakResult) !void {
    result.reset();
    for (text, 0..) |b, i| {
        if (isWrapBreak(b)) {
            try result.breaks.append(i);
        }
    }
}

// Method 2: Using std.mem.indexOfAny (optimized stdlib)
pub fn findWrapBreaksStdLib(text: []const u8, result: *BreakResult) !void {
    result.reset();
    const break_chars = " \t\r\n-/\\.,:;!?()[]{}";
    var pos: usize = 0;
    while (pos < text.len) {
        if (std.mem.indexOfAny(u8, text[pos..], break_chars)) |offset| {
            const idx = pos + offset;
            try result.breaks.append(idx);
            pos = idx + 1;
        } else {
            break;
        }
    }
}

// Method 3: Manual SIMD vectorization (16-byte)
pub fn findWrapBreaksSIMD16(text: []const u8, result: *BreakResult) !void {
    result.reset();
    const vector_len = 16;
    const Vec = @Vector(vector_len, u8);

    // We'll check for common break characters using SIMD
    // Note: We check for the most common characters to optimize the fast path
    const vSpace: Vec = @splat(' ');
    const vTab: Vec = @splat('\t');
    const vNewline: Vec = @splat('\n');
    const vReturn: Vec = @splat('\r');
    const vDash: Vec = @splat('-');
    const vSlash: Vec = @splat('/');
    const vBackslash: Vec = @splat('\\');

    var pos: usize = 0;

    // Process full vector chunks
    while (pos + vector_len <= text.len) {
        const chunk: Vec = text[pos..][0..vector_len].*;

        // Compare against common break characters
        const cmp_space = chunk == vSpace;
        const cmp_tab = chunk == vTab;
        const cmp_newline = chunk == vNewline;
        const cmp_return = chunk == vReturn;
        const cmp_dash = chunk == vDash;
        const cmp_slash = chunk == vSlash;
        const cmp_backslash = chunk == vBackslash;

        // Check if any common match found
        const has_common = @reduce(.Or, cmp_space) or @reduce(.Or, cmp_tab) or @reduce(.Or, cmp_newline) or
            @reduce(.Or, cmp_return) or @reduce(.Or, cmp_dash) or @reduce(.Or, cmp_slash) or
            @reduce(.Or, cmp_backslash);

        // Always check all bytes in chunk since we can't SIMD-check all punctuation/brackets efficiently
        for (0..vector_len) |i| {
            if (isWrapBreak(text[pos + i])) {
                try result.breaks.append(pos + i);
            }
        }

        // Could optimize to skip chunk if has_common is false and chunk has no ASCII punctuation/brackets,
        // but for correctness we check all bytes
        _ = has_common;

        pos += vector_len;
    }

    // Handle remaining bytes with scalar code
    while (pos < text.len) : (pos += 1) {
        if (isWrapBreak(text[pos])) {
            try result.breaks.append(pos);
        }
    }
}

// Method 4: SIMD with wider vectors (32-byte for AVX2)
pub fn findWrapBreaksSIMD32(text: []const u8, result: *BreakResult) !void {
    result.reset();
    const vector_len = 32;
    const Vec = @Vector(vector_len, u8);

    const vSpace: Vec = @splat(' ');
    const vTab: Vec = @splat('\t');
    const vNewline: Vec = @splat('\n');
    const vReturn: Vec = @splat('\r');
    const vDash: Vec = @splat('-');
    const vSlash: Vec = @splat('/');
    const vBackslash: Vec = @splat('\\');

    var pos: usize = 0;

    while (pos + vector_len <= text.len) {
        const chunk: Vec = text[pos..][0..vector_len].*;

        const cmp_space = chunk == vSpace;
        const cmp_tab = chunk == vTab;
        const cmp_newline = chunk == vNewline;
        const cmp_return = chunk == vReturn;
        const cmp_dash = chunk == vDash;
        const cmp_slash = chunk == vSlash;
        const cmp_backslash = chunk == vBackslash;

        const has_common = @reduce(.Or, cmp_space) or @reduce(.Or, cmp_tab) or @reduce(.Or, cmp_newline) or
            @reduce(.Or, cmp_return) or @reduce(.Or, cmp_dash) or @reduce(.Or, cmp_slash) or
            @reduce(.Or, cmp_backslash);

        // Always check all bytes in chunk since we can't SIMD-check all punctuation/brackets efficiently
        for (0..vector_len) |i| {
            if (isWrapBreak(text[pos + i])) {
                try result.breaks.append(pos + i);
            }
        }

        _ = has_common;
        pos += vector_len;
    }

    // Handle tail
    while (pos < text.len) : (pos += 1) {
        if (isWrapBreak(text[pos])) {
            try result.breaks.append(pos);
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
            if (isWrapBreak(b)) {
                mask |= @as(u128, 1) << @intCast(i);
            }
        }

        // Process the mask to find break positions
        while (mask != 0) {
            const bit_pos = @ctz(mask);
            const absolute_pos = pos + bit_pos;
            try result.breaks.append(absolute_pos);
            mask &= ~(@as(u128, 1) << @intCast(bit_pos));
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

    // Results should already be sorted
    std.mem.sort(usize, result.breaks.items, {}, std.sort.asc(usize));
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
