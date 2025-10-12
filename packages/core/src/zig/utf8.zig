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

pub fn findWrapBreaksSIMD16(text: []const u8, result: *BreakResult) !void {
    result.reset();
    const vector_len = 16;

    var pos: usize = 0;
    while (pos + vector_len <= text.len) {
        const chunk: @Vector(vector_len, u8) = text[pos..][0..vector_len].*;
        const ascii_threshold: @Vector(vector_len, u8) = @splat(0x80);
        const is_non_ascii = chunk >= ascii_threshold;

        // Fast path: all ASCII
        if (!@reduce(.Or, is_non_ascii)) {
            // Use SIMD to find break characters
            var match_mask: @Vector(vector_len, bool) = @splat(false);

            // Check whitespace
            match_mask = @select(bool, chunk == @as(@Vector(vector_len, u8), @splat(' ')), @as(@Vector(vector_len, bool), @splat(true)), match_mask);
            match_mask = @select(bool, chunk == @as(@Vector(vector_len, u8), @splat('\t')), @as(@Vector(vector_len, bool), @splat(true)), match_mask);

            // Check dashes and slashes
            match_mask = @select(bool, chunk == @as(@Vector(vector_len, u8), @splat('-')), @as(@Vector(vector_len, bool), @splat(true)), match_mask);
            match_mask = @select(bool, chunk == @as(@Vector(vector_len, u8), @splat('/')), @as(@Vector(vector_len, bool), @splat(true)), match_mask);
            match_mask = @select(bool, chunk == @as(@Vector(vector_len, u8), @splat('\\')), @as(@Vector(vector_len, bool), @splat(true)), match_mask);

            // Check punctuation
            match_mask = @select(bool, chunk == @as(@Vector(vector_len, u8), @splat('.')), @as(@Vector(vector_len, bool), @splat(true)), match_mask);
            match_mask = @select(bool, chunk == @as(@Vector(vector_len, u8), @splat(',')), @as(@Vector(vector_len, bool), @splat(true)), match_mask);
            match_mask = @select(bool, chunk == @as(@Vector(vector_len, u8), @splat(';')), @as(@Vector(vector_len, bool), @splat(true)), match_mask);
            match_mask = @select(bool, chunk == @as(@Vector(vector_len, u8), @splat(':')), @as(@Vector(vector_len, bool), @splat(true)), match_mask);
            match_mask = @select(bool, chunk == @as(@Vector(vector_len, u8), @splat('!')), @as(@Vector(vector_len, bool), @splat(true)), match_mask);
            match_mask = @select(bool, chunk == @as(@Vector(vector_len, u8), @splat('?')), @as(@Vector(vector_len, bool), @splat(true)), match_mask);

            // Check brackets
            match_mask = @select(bool, chunk == @as(@Vector(vector_len, u8), @splat('(')), @as(@Vector(vector_len, bool), @splat(true)), match_mask);
            match_mask = @select(bool, chunk == @as(@Vector(vector_len, u8), @splat(')')), @as(@Vector(vector_len, bool), @splat(true)), match_mask);
            match_mask = @select(bool, chunk == @as(@Vector(vector_len, u8), @splat('[')), @as(@Vector(vector_len, bool), @splat(true)), match_mask);
            match_mask = @select(bool, chunk == @as(@Vector(vector_len, u8), @splat(']')), @as(@Vector(vector_len, bool), @splat(true)), match_mask);
            match_mask = @select(bool, chunk == @as(@Vector(vector_len, u8), @splat('{')), @as(@Vector(vector_len, bool), @splat(true)), match_mask);
            match_mask = @select(bool, chunk == @as(@Vector(vector_len, u8), @splat('}')), @as(@Vector(vector_len, bool), @splat(true)), match_mask);

            // Convert boolean mask to integer bitmask for faster iteration
            var bitmask: u16 = 0;
            inline for (0..vector_len) |i| {
                if (match_mask[i]) {
                    bitmask |= @as(u16, 1) << @intCast(i);
                }
            }

            // Use bit manipulation to extract positions
            while (bitmask != 0) {
                const bit_pos = @ctz(bitmask);
                try result.breaks.append(pos + bit_pos);
                bitmask &= bitmask - 1; // Clear lowest set bit
            }

            pos += vector_len;
            continue;
        }

        // Slow path: mixed ASCII/non-ASCII
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

pub fn findLineBreaksSIMD16(text: []const u8, result: *BreakResult) !void {
    result.reset();
    const vector_len = 16; // Use 16-byte vectors (SSE2/NEON compatible)
    const Vec = @Vector(vector_len, u8);

    // Prepare vector constants for '\n' and '\r'
    const vNL: Vec = @splat('\n');
    const vCR: Vec = @splat('\r');

    var pos: usize = 0;
    var prev_was_cr = false; // Track if previous chunk ended with \r

    // Process full vector chunks
    while (pos + vector_len <= text.len) {
        const chunk: Vec = text[pos..][0..vector_len].*;
        const cmp_nl = chunk == vNL;
        const cmp_cr = chunk == vCR;

        // Check if any newline or CR found
        if (@reduce(.Or, cmp_nl) or @reduce(.Or, cmp_cr)) {
            // Found a match, process this chunk
            var i: usize = 0;
            while (i < vector_len) : (i += 1) {
                const absolute_index = pos + i;
                const b = text[absolute_index];
                if (b == '\n') {
                    // Skip if this is the \n part of a CRLF split across chunks
                    if (i == 0 and prev_was_cr) {
                        prev_was_cr = false;
                        continue;
                    }
                    try result.breaks.append(absolute_index);
                } else if (b == '\r') {
                    // Check for CRLF
                    if (absolute_index + 1 < text.len and text[absolute_index + 1] == '\n') {
                        try result.breaks.append(absolute_index + 1);
                        i += 1; // Skip the \n in next iteration
                    } else {
                        try result.breaks.append(absolute_index);
                    }
                }
            }
            // Update prev_was_cr for next chunk
            prev_was_cr = (text[pos + vector_len - 1] == '\r');
        } else {
            prev_was_cr = false;
        }
        pos += vector_len;
    }

    // Handle remaining bytes with scalar code
    while (pos < text.len) : (pos += 1) {
        const b = text[pos];
        if (b == '\n') {
            // Handle CRLF split at chunk boundary
            if (pos > 0 and text[pos - 1] == '\r') {
                // Already recorded at pos - 1 or will be skipped
                if (prev_was_cr) {
                    prev_was_cr = false;
                    continue;
                }
            }
            try result.breaks.append(pos);
        } else if (b == '\r') {
            if (pos + 1 < text.len and text[pos + 1] == '\n') {
                try result.breaks.append(pos + 1);
                pos += 1;
            } else {
                try result.breaks.append(pos);
            }
        }
        prev_was_cr = false;
    }
}
