//! UTF-8 Text Scanning Library
//!
//! This library provides various methods for scanning UTF-8 text for line breaks.
//! All methods detect: LF (\n), CR (\r), and CRLF (\r\n).
//!
//! Semantics: CRLF is recorded at the \n index (i+1), standalone CR or LF at their own indices.
//!
//! Methods:
//! - Baseline: Simple byte-by-byte iteration
//! - StdLib: Using Zig's optimized std.mem.indexOfAny
//! - SIMD16/32: Manual SIMD vectorization (16-byte and 32-byte vectors)
//! - Bitmask128: Zed editor-inspired bitmask approach (128-byte chunks)
//! - Multithreaded variants: Parallel scanning using any of the above methods
//!
//! Usage:
//!   const scan = @import("utf8-scan.zig");
//!   var result = scan.BreakResult.init(allocator);
//!   defer result.deinit();
//!   try scan.findLineBreaksBaseline(text, &result);
//!   // result.breaks.items contains indices of line breaks

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

// Method enum for easy parametrization
pub const Method = enum {
    baseline,
    stdlib,
    simd16,
    simd32,
    bitmask128,
    mt_baseline,
    mt_stdlib,
    mt_simd16,
    mt_simd32,
    mt_bitmask128,
};

// Method 1: Baseline pure loop - linear scan checking each byte
pub fn findLineBreaksBaseline(text: []const u8, result: *BreakResult) !void {
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
pub fn findLineBreaksStdLib(text: []const u8, result: *BreakResult) !void {
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

// Method 3: Manual SIMD vectorization (16-byte)
pub fn findLineBreaksSIMD16(text: []const u8, result: *BreakResult) !void {
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
pub fn findLineBreaksSIMD32(text: []const u8, result: *BreakResult) !void {
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

// Method 5: Bitmask approach (inspired by Zed editor)
pub fn findLineBreaksBitmask128(text: []const u8, result: *BreakResult) !void {
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

pub fn findLineBreaksMultithreadedGeneric(
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

pub fn findLineBreaksMultithreadedBaseline(text: []const u8, result: *BreakResult, allocator: std.mem.Allocator) !void {
    return findLineBreaksMultithreadedGeneric(text, result, allocator, findLineBreaksBaseline);
}

pub fn findLineBreaksMultithreadedStdLib(text: []const u8, result: *BreakResult, allocator: std.mem.Allocator) !void {
    return findLineBreaksMultithreadedGeneric(text, result, allocator, findLineBreaksStdLib);
}

pub fn findLineBreaksMultithreadedSIMD16(text: []const u8, result: *BreakResult, allocator: std.mem.Allocator) !void {
    return findLineBreaksMultithreadedGeneric(text, result, allocator, findLineBreaksSIMD16);
}

pub fn findLineBreaksMultithreadedSIMD32(text: []const u8, result: *BreakResult, allocator: std.mem.Allocator) !void {
    return findLineBreaksMultithreadedGeneric(text, result, allocator, findLineBreaksSIMD32);
}

pub fn findLineBreaksMultithreadedBitmask128(text: []const u8, result: *BreakResult, allocator: std.mem.Allocator) !void {
    return findLineBreaksMultithreadedGeneric(text, result, allocator, findLineBreaksBitmask128);
}
