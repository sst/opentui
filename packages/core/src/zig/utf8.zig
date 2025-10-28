const std = @import("std");
const uucode = @import("uucode");

/// Check if a byte slice contains only printable ASCII (32..126)
/// Uses SIMD16 for fast checking
pub fn isAsciiOnly(text: []const u8) bool {
    if (text.len == 0) return false;

    const vector_len = 16;
    const Vec = @Vector(vector_len, u8);

    const min_printable: Vec = @splat(32);
    const max_printable: Vec = @splat(126);

    var pos: usize = 0;

    // Process full 16-byte vectors
    while (pos + vector_len <= text.len) {
        const chunk: Vec = text[pos..][0..vector_len].*;

        // Check if all bytes are in [32, 126]
        const too_low = chunk < min_printable;
        const too_high = chunk > max_printable;

        // Check if any byte is out of range
        if (@reduce(.Or, too_low) or @reduce(.Or, too_high)) {
            return false;
        }

        pos += vector_len;
    }

    // Handle remaining bytes with scalar code
    while (pos < text.len) : (pos += 1) {
        const b = text[pos];
        if (b < 32 or b > 126) {
            return false;
        }
    }

    return true;
}

pub const LineBreakKind = enum {
    LF, // \n (Unix/Linux)
    CR, // \r (Old Mac)
    CRLF, // \r\n (Windows)
};

pub const LineBreak = struct {
    pos: usize,
    kind: LineBreakKind,
};

pub const LineBreakResult = struct {
    breaks: std.ArrayList(LineBreak),

    pub fn init(allocator: std.mem.Allocator) LineBreakResult {
        return .{
            .breaks = std.ArrayList(LineBreak).init(allocator),
        };
    }

    pub fn deinit(self: *LineBreakResult) void {
        self.breaks.deinit();
    }

    pub fn reset(self: *LineBreakResult) void {
        self.breaks.clearRetainingCapacity();
    }
};

pub const TabStopResult = struct {
    positions: std.ArrayList(usize),

    pub fn init(allocator: std.mem.Allocator) TabStopResult {
        return .{
            .positions = std.ArrayList(usize).init(allocator),
        };
    }

    pub fn deinit(self: *TabStopResult) void {
        self.positions.deinit();
    }

    pub fn reset(self: *TabStopResult) void {
        self.positions.clearRetainingCapacity();
    }
};

pub const WrapBreak = struct {
    byte_offset: u16,
    char_offset: u16,
};

pub const WrapBreakResult = struct {
    breaks: std.ArrayList(WrapBreak),

    pub fn init(allocator: std.mem.Allocator) WrapBreakResult {
        return .{
            .breaks = std.ArrayList(WrapBreak).init(allocator),
        };
    }

    pub fn deinit(self: *WrapBreakResult) void {
        self.breaks.deinit();
    }

    pub fn reset(self: *WrapBreakResult) void {
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
pub inline fn decodeUtf8Unchecked(text: []const u8, pos: usize) struct { cp: u21, len: u3 } {
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

// Nothing needed here - using uucode.grapheme.isBreak directly

pub fn findWrapBreaksSIMD16(text: []const u8, result: *WrapBreakResult) !void {
    result.reset();
    const vector_len = 16;

    var pos: usize = 0;
    var char_offset: u16 = 0;
    var prev_cp: ?u21 = null; // Track previous codepoint for grapheme detection
    var break_state: uucode.grapheme.BreakState = .default;

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
                try result.breaks.append(.{
                    .byte_offset = @intCast(pos + bit_pos),
                    .char_offset = char_offset + @as(u16, @intCast(bit_pos)),
                });
                bitmask &= bitmask - 1;
            }

            pos += vector_len;
            char_offset += vector_len;
            prev_cp = text[pos - 1]; // Last ASCII char
            continue;
        }

        // Slow path: mixed ASCII/non-ASCII - need grapheme-aware counting
        var i: usize = 0;
        while (i < vector_len) {
            const b0 = text[pos + i];
            if (b0 < 0x80) {
                const curr_cp: u21 = b0;

                // Check if this starts a new grapheme cluster
                // Skip invalid/replacement codepoints or codepoints that might be outside the grapheme table range
                const is_break = if (curr_cp == 0xFFFD or curr_cp > 0x10FFFF) true else if (prev_cp) |p| blk: {
                    if (p == 0xFFFD or p > 0x10FFFF) break :blk true;
                    break :blk uucode.grapheme.isBreak(p, curr_cp, &break_state);
                } else true;

                if (isAsciiWrapBreak(b0)) {
                    try result.breaks.append(.{
                        .byte_offset = @intCast(pos + i),
                        .char_offset = char_offset,
                    });
                }
                i += 1;
                if (is_break) {
                    char_offset += 1;
                }
                prev_cp = curr_cp;
            } else {
                const dec = decodeUtf8Unchecked(text, pos + i);
                if (pos + i + dec.len > text.len) break;

                // Check if this starts a new grapheme cluster
                // Skip invalid/replacement codepoints or codepoints that might be outside the grapheme table range
                const is_break = if (dec.cp == 0xFFFD or dec.cp > 0x10FFFF) true else if (prev_cp) |p| blk: {
                    if (p == 0xFFFD or p > 0x10FFFF) break :blk true;
                    break :blk uucode.grapheme.isBreak(p, dec.cp, &break_state);
                } else true;

                if (isUnicodeWrapBreak(dec.cp)) {
                    try result.breaks.append(.{
                        .byte_offset = @intCast(pos + i),
                        .char_offset = char_offset,
                    });
                }
                i += dec.len;
                if (is_break) {
                    char_offset += 1;
                }
                prev_cp = dec.cp;
            }
        }
        pos += vector_len;
    }

    // Tail
    var i: usize = pos;
    while (i < text.len) {
        const b0 = text[i];
        if (b0 < 0x80) {
            const curr_cp: u21 = b0;
            const is_break = if (prev_cp) |p| blk: {
                if (p == 0xFFFD or p > 0x10FFFF) break :blk true;
                break :blk uucode.grapheme.isBreak(p, curr_cp, &break_state);
            } else true;

            if (isAsciiWrapBreak(b0)) {
                try result.breaks.append(.{
                    .byte_offset = @intCast(i),
                    .char_offset = char_offset,
                });
            }
            i += 1;
            if (is_break) {
                char_offset += 1;
            }
            prev_cp = curr_cp;
        } else {
            const dec = decodeUtf8Unchecked(text, i);
            if (i + dec.len > text.len) break;

            const is_break = if (dec.cp == 0xFFFD or dec.cp > 0x10FFFF) true else if (prev_cp) |p| blk: {
                if (p == 0xFFFD or p > 0x10FFFF) break :blk true;
                break :blk uucode.grapheme.isBreak(p, dec.cp, &break_state);
            } else true;

            if (isUnicodeWrapBreak(dec.cp)) {
                try result.breaks.append(.{
                    .byte_offset = @intCast(i),
                    .char_offset = char_offset,
                });
            }
            i += dec.len;
            if (is_break) {
                char_offset += 1;
            }
            prev_cp = dec.cp;
        }
    }
}

pub fn findTabStopsSIMD16(text: []const u8, result: *TabStopResult) !void {
    result.reset();
    const vector_len = 16;
    const Vec = @Vector(vector_len, u8);

    const vTab: Vec = @splat('\t');

    var pos: usize = 0;

    while (pos + vector_len <= text.len) {
        const chunk: Vec = text[pos..][0..vector_len].*;
        const cmp_tab = chunk == vTab;

        if (@reduce(.Or, cmp_tab)) {
            var i: usize = 0;
            while (i < vector_len) : (i += 1) {
                if (text[pos + i] == '\t') {
                    try result.positions.append(pos + i);
                }
            }
        }
        pos += vector_len;
    }

    while (pos < text.len) : (pos += 1) {
        if (text[pos] == '\t') {
            try result.positions.append(pos);
        }
    }
}

pub fn findLineBreaksSIMD16(text: []const u8, result: *LineBreakResult) !void {
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
                    // Check if this is part of CRLF
                    const kind: LineBreakKind = if (absolute_index > 0 and text[absolute_index - 1] == '\r') .CRLF else .LF;
                    try result.breaks.append(.{ .pos = absolute_index, .kind = kind });
                } else if (b == '\r') {
                    // Check for CRLF
                    if (absolute_index + 1 < text.len and text[absolute_index + 1] == '\n') {
                        try result.breaks.append(.{ .pos = absolute_index + 1, .kind = .CRLF });
                        i += 1; // Skip the \n in next iteration
                    } else {
                        try result.breaks.append(.{ .pos = absolute_index, .kind = .CR });
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
            const kind: LineBreakKind = if (pos > 0 and text[pos - 1] == '\r') .CRLF else .LF;
            try result.breaks.append(.{ .pos = pos, .kind = kind });
        } else if (b == '\r') {
            if (pos + 1 < text.len and text[pos + 1] == '\n') {
                try result.breaks.append(.{ .pos = pos + 1, .kind = .CRLF });
                pos += 1;
            } else {
                try result.breaks.append(.{ .pos = pos, .kind = .CR });
            }
        }
        prev_was_cr = false;
    }
}

pub const WrapByWidthResult = struct {
    byte_offset: u32,
    grapheme_count: u32,
    columns_used: u32,
};

pub const PosByWidthResult = struct {
    byte_offset: u32,
    grapheme_count: u32,
    columns_used: u32,
};

// Simple East Asian Width detection
inline fn eastAsianWidth(cp: u21) u32 {
    return switch (cp) {
        0x4E00...0x9FFF => 2, // CJK Unified Ideographs
        0xAC00...0xD7AF => 2, // Hangul Syllables
        0x3040...0x309F => 2, // Hiragana
        0x30A0...0x30FF => 2, // Katakana
        0xFF01...0xFF60 => 2, // Fullwidth Forms
        0xF900...0xFAFF => 2, // CJK Compatibility Ideographs
        0x1F300...0x1F9FF => 2, // Emoji and symbols
        0x0300...0x036F, 0x1AB0...0x1AFF, 0x1DC0...0x1DFF, 0x20D0...0x20FF, 0xFE20...0xFE2F => 0, // Combining marks
        else => 1,
    };
}

/// Calculate the display width of a byte in columns
/// Used for ASCII-only fast paths
inline fn asciiCharWidth(byte: u8, tab_width: u8, current_column: u32) u32 {
    if (byte == '\t') {
        return tab_width - (current_column % tab_width);
    } else if (byte >= 32 and byte <= 126) {
        return 1;
    }
    return 0;
}

/// Calculate the display width of a character (byte or codepoint) in columns
inline fn charWidth(byte: u8, codepoint: u21, tab_width: u8, current_column: u32) u32 {
    if (byte == '\t') {
        return tab_width - (current_column % tab_width);
    } else if (byte < 0x80 and byte >= 32 and byte <= 126) {
        return 1;
    } else if (byte >= 0x80) {
        return eastAsianWidth(codepoint);
    }
    return 0;
}

/// Check if a codepoint is valid for grapheme break detection
inline fn isValidCodepoint(cp: u21) bool {
    return cp != 0xFFFD and cp <= 0x10FFFF;
}

/// Check if there's a grapheme break between two codepoints
inline fn isGraphemeBreak(prev_cp: ?u21, curr_cp: u21, break_state: *uucode.grapheme.BreakState) bool {
    if (!isValidCodepoint(curr_cp)) return true;
    if (prev_cp) |p| {
        if (!isValidCodepoint(p)) return true;
        return uucode.grapheme.isBreak(p, curr_cp, break_state);
    }
    return true;
}

const ClusterState = struct {
    columns_used: u32,
    grapheme_count: u32,
    cluster_width: u32,
    cluster_start: usize,
    prev_cp: ?u21,
    break_state: uucode.grapheme.BreakState,

    fn init() ClusterState {
        return .{
            .columns_used = 0,
            .grapheme_count = 0,
            .cluster_width = 0,
            .cluster_start = 0,
            .prev_cp = null,
            .break_state = .default,
        };
    }
};

/// Handle grapheme cluster boundary when wrapping by width (stops BEFORE exceeding limit)
/// Returns true if we should stop (limit exceeded)
inline fn handleClusterForWrap(
    state: *ClusterState,
    is_break: bool,
    new_cluster_start: usize,
    max_columns: u32,
) bool {
    if (is_break) {
        if (state.prev_cp != null) {
            if (state.columns_used + state.cluster_width > max_columns) {
                return true; // Signal to stop
            }
            state.columns_used += state.cluster_width;
            state.grapheme_count += 1;
        }
        state.cluster_width = 0;
        state.cluster_start = new_cluster_start;
    }
    return false;
}

/// Handle grapheme cluster boundary when finding position (stops AT/AFTER limit)
/// Returns true if we should stop (at or after limit)
inline fn handleClusterForPos(
    state: *ClusterState,
    is_break: bool,
    new_cluster_start: usize,
    max_columns: u32,
    include_start_before: bool,
) bool {
    if (is_break) {
        if (state.prev_cp != null) {
            if (state.columns_used >= max_columns) {
                return true; // Signal to stop
            }
            state.columns_used += state.cluster_width;
            if (include_start_before) {
                state.grapheme_count += 1;
            }
        }
        state.cluster_width = 0;
        state.cluster_start = new_cluster_start;
    }
    return false;
}

pub fn findWrapPosByWidthSIMD16(
    text: []const u8,
    max_columns: u32,
    tab_width: u8,
    isASCIIOnly: bool,
) WrapByWidthResult {
    if (text.len == 0 or max_columns == 0) {
        return .{ .byte_offset = 0, .grapheme_count = 0, .columns_used = 0 };
    }

    // ASCII-only fast path
    if (isASCIIOnly) {
        const vector_len = 16;
        var pos: usize = 0;
        var columns_used: u32 = 0;

        while (pos + vector_len <= text.len) {
            var i: usize = 0;
            while (i < vector_len) : (i += 1) {
                const b = text[pos + i];
                const width = asciiCharWidth(b, tab_width, columns_used);
                columns_used += width;

                if (columns_used > max_columns) {
                    return .{ .byte_offset = @intCast(pos + i), .grapheme_count = @intCast(pos + i), .columns_used = columns_used - width };
                }
            }
            pos += vector_len;
        }

        // Tail
        while (pos < text.len) {
            const b = text[pos];
            const width = asciiCharWidth(b, tab_width, columns_used);
            columns_used += width;

            if (columns_used > max_columns) {
                return .{ .byte_offset = @intCast(pos), .grapheme_count = @intCast(pos), .columns_used = columns_used - width };
            }
            pos += 1;
        }

        return .{ .byte_offset = @intCast(text.len), .grapheme_count = @intCast(text.len), .columns_used = columns_used };
    }

    const vector_len = 16;
    var pos: usize = 0;
    var state = ClusterState.init();

    while (pos + vector_len <= text.len) {
        const chunk: @Vector(vector_len, u8) = text[pos..][0..vector_len].*;
        const ascii_threshold: @Vector(vector_len, u8) = @splat(0x80);
        const is_non_ascii = chunk >= ascii_threshold;

        if (!@reduce(.Or, is_non_ascii)) {
            // All ASCII
            var i: usize = 0;
            while (i < vector_len) : (i += 1) {
                const b = text[pos + i];
                const curr_cp: u21 = b;
                const is_break = isGraphemeBreak(state.prev_cp, curr_cp, &state.break_state);

                if (handleClusterForWrap(&state, is_break, pos + i, max_columns)) {
                    return .{ .byte_offset = @intCast(state.cluster_start), .grapheme_count = state.grapheme_count, .columns_used = state.columns_used };
                }

                state.cluster_width += asciiCharWidth(b, tab_width, state.columns_used + state.cluster_width);
                state.prev_cp = curr_cp;
            }
            pos += vector_len;
            continue;
        }

        // Mixed ASCII/non-ASCII - process rest of chunk
        var i: usize = 0;
        while (i < vector_len and pos + i < text.len) {
            const b0 = text[pos + i];
            const curr_cp: u21 = if (b0 < 0x80) b0 else decodeUtf8Unchecked(text, pos + i).cp;
            const cp_len: usize = if (b0 < 0x80) 1 else decodeUtf8Unchecked(text, pos + i).len;

            if (pos + i + cp_len > text.len) break;

            const is_break = isGraphemeBreak(state.prev_cp, curr_cp, &state.break_state);

            if (handleClusterForWrap(&state, is_break, pos + i, max_columns)) {
                return .{ .byte_offset = @intCast(state.cluster_start), .grapheme_count = state.grapheme_count, .columns_used = state.columns_used };
            }

            state.cluster_width += charWidth(b0, curr_cp, tab_width, state.columns_used + state.cluster_width);
            state.prev_cp = curr_cp;
            i += cp_len;
        }
        pos += i; // Advance by how much we actually processed
    }

    // Tail
    while (pos < text.len) {
        const b0 = text[pos];
        const curr_cp: u21 = if (b0 < 0x80) b0 else decodeUtf8Unchecked(text, pos).cp;
        const cp_len: usize = if (b0 < 0x80) 1 else decodeUtf8Unchecked(text, pos).len;

        const is_break = isGraphemeBreak(state.prev_cp, curr_cp, &state.break_state);

        if (handleClusterForWrap(&state, is_break, pos, max_columns)) {
            return .{ .byte_offset = @intCast(state.cluster_start), .grapheme_count = state.grapheme_count, .columns_used = state.columns_used };
        }

        state.cluster_width += charWidth(b0, curr_cp, tab_width, state.columns_used + state.cluster_width);
        state.prev_cp = curr_cp;
        pos += cp_len;
    }

    // Final cluster
    if (state.prev_cp != null and state.cluster_width > 0) {
        if (state.columns_used + state.cluster_width > max_columns) {
            return .{ .byte_offset = @intCast(state.cluster_start), .grapheme_count = state.grapheme_count, .columns_used = state.columns_used };
        }
        state.columns_used += state.cluster_width;
        state.grapheme_count += 1;
    }

    return .{ .byte_offset = @intCast(text.len), .grapheme_count = state.grapheme_count, .columns_used = state.columns_used };
}

/// Find position by column width, with control over boundary behavior
/// - If include_start_before: include graphemes that START before max_columns (for selection end)
/// - If !include_start_before: exclude graphemes that START before max_columns (for selection start)
pub fn findPosByWidth(
    text: []const u8,
    max_columns: u32,
    tab_width: u8,
    isASCIIOnly: bool,
    include_start_before: bool,
) PosByWidthResult {
    if (text.len == 0 or max_columns == 0) {
        return .{ .byte_offset = 0, .grapheme_count = 0, .columns_used = 0 };
    }

    // ASCII-only fast path
    if (isASCIIOnly) {
        const vector_len = 16;
        var pos: usize = 0;
        var columns_used: u32 = 0;

        while (pos + vector_len <= text.len) {
            var i: usize = 0;
            while (i < vector_len) : (i += 1) {
                const b = text[pos + i];
                const prev_columns = columns_used;

                columns_used += asciiCharWidth(b, tab_width, columns_used);

                // Check if this character starts at or after max_columns
                if (prev_columns >= max_columns) {
                    return .{ .byte_offset = @intCast(pos + i), .grapheme_count = @intCast(pos + i), .columns_used = prev_columns };
                }
            }
            pos += vector_len;
        }

        // Tail
        while (pos < text.len) {
            const b = text[pos];
            const prev_columns = columns_used;

            columns_used += asciiCharWidth(b, tab_width, columns_used);

            if (prev_columns >= max_columns) {
                return .{ .byte_offset = @intCast(pos), .grapheme_count = @intCast(pos), .columns_used = prev_columns };
            }
            pos += 1;
        }

        return .{ .byte_offset = @intCast(text.len), .grapheme_count = @intCast(text.len), .columns_used = columns_used };
    }

    const vector_len = 16;
    var pos: usize = 0;
    var state = ClusterState.init();

    while (pos + vector_len <= text.len) {
        const chunk: @Vector(vector_len, u8) = text[pos..][0..vector_len].*;
        const ascii_threshold: @Vector(vector_len, u8) = @splat(0x80);
        const is_non_ascii = chunk >= ascii_threshold;

        if (!@reduce(.Or, is_non_ascii)) {
            // All ASCII
            var i: usize = 0;
            while (i < vector_len) : (i += 1) {
                const b = text[pos + i];
                const curr_cp: u21 = b;
                const is_break = isGraphemeBreak(state.prev_cp, curr_cp, &state.break_state);

                if (handleClusterForPos(&state, is_break, pos + i, max_columns, include_start_before)) {
                    return .{ .byte_offset = @intCast(state.cluster_start), .grapheme_count = state.grapheme_count, .columns_used = state.columns_used };
                }

                state.cluster_width += asciiCharWidth(b, tab_width, state.columns_used + state.cluster_width);
                state.prev_cp = curr_cp;
            }
            pos += vector_len;
            continue;
        }

        // Mixed ASCII/non-ASCII - process rest of chunk
        var i: usize = 0;
        while (i < vector_len and pos + i < text.len) {
            const b0 = text[pos + i];
            const curr_cp: u21 = if (b0 < 0x80) b0 else decodeUtf8Unchecked(text, pos + i).cp;
            const cp_len: usize = if (b0 < 0x80) 1 else decodeUtf8Unchecked(text, pos + i).len;

            if (pos + i + cp_len > text.len) break;

            const is_break = isGraphemeBreak(state.prev_cp, curr_cp, &state.break_state);

            if (handleClusterForPos(&state, is_break, pos + i, max_columns, include_start_before)) {
                return .{ .byte_offset = @intCast(state.cluster_start), .grapheme_count = state.grapheme_count, .columns_used = state.columns_used };
            }

            state.cluster_width += charWidth(b0, curr_cp, tab_width, state.columns_used + state.cluster_width);
            state.prev_cp = curr_cp;
            i += cp_len;
        }
        pos += i; // Advance by how much we actually processed
    }

    // Tail
    while (pos < text.len) {
        const b0 = text[pos];
        const curr_cp: u21 = if (b0 < 0x80) b0 else decodeUtf8Unchecked(text, pos).cp;
        const cp_len: usize = if (b0 < 0x80) 1 else decodeUtf8Unchecked(text, pos).len;

        const is_break = isGraphemeBreak(state.prev_cp, curr_cp, &state.break_state);

        if (handleClusterForPos(&state, is_break, pos, max_columns, include_start_before)) {
            return .{ .byte_offset = @intCast(state.cluster_start), .grapheme_count = state.grapheme_count, .columns_used = state.columns_used };
        }

        state.cluster_width += charWidth(b0, curr_cp, tab_width, state.columns_used + state.cluster_width);
        state.prev_cp = curr_cp;
        pos += cp_len;
    }

    // Final cluster
    if (state.prev_cp != null and state.cluster_width > 0) {
        if (state.columns_used >= max_columns) {
            return .{ .byte_offset = @intCast(state.cluster_start), .grapheme_count = state.grapheme_count, .columns_used = state.columns_used };
        }
        state.columns_used += state.cluster_width;
        if (include_start_before) {
            state.grapheme_count += 1;
        }
    }

    return .{ .byte_offset = @intCast(text.len), .grapheme_count = state.grapheme_count, .columns_used = state.columns_used };
}

pub fn getWidthAt(text: []const u8, byte_offset: usize, tab_width: u8, current_column: u32) u32 {
    if (byte_offset >= text.len) return 0;

    const b0 = text[byte_offset];

    const first_cp: u21 = if (b0 < 0x80) b0 else blk: {
        const dec = decodeUtf8Unchecked(text, byte_offset);
        if (byte_offset + dec.len > text.len) return 1;
        break :blk dec.cp;
    };

    const first_len: usize = if (b0 < 0x80) 1 else decodeUtf8Unchecked(text, byte_offset).len;

    var break_state: uucode.grapheme.BreakState = .default;
    var prev_cp: ?u21 = first_cp;
    var cluster_width: u32 = charWidth(b0, first_cp, tab_width, current_column);

    var pos = byte_offset + first_len;

    while (pos < text.len) {
        const b = text[pos];
        const curr_cp: u21 = if (b < 0x80) b else decodeUtf8Unchecked(text, pos).cp;
        const cp_len: usize = if (b < 0x80) 1 else decodeUtf8Unchecked(text, pos).len;

        if (pos + cp_len > text.len) break;

        const is_break = isGraphemeBreak(prev_cp, curr_cp, &break_state);
        if (is_break) break;

        cluster_width += charWidth(b, curr_cp, tab_width, current_column + cluster_width);
        prev_cp = curr_cp;
        pos += cp_len;
    }

    return cluster_width;
}

pub const PrevGraphemeResult = struct {
    start_offset: usize,
    width: u32,
};

pub fn getPrevGraphemeStart(text: []const u8, byte_offset: usize, tab_width: u8, current_column: u32) ?PrevGraphemeResult {
    if (byte_offset == 0 or text.len == 0) return null;
    if (byte_offset > text.len) return null;

    var break_state: uucode.grapheme.BreakState = .default;
    var pos: usize = 0;
    var prev_cp: ?u21 = null;
    var prev_grapheme_start: usize = 0;
    var second_to_last_grapheme_start: usize = 0;

    while (pos < byte_offset) {
        const b = text[pos];
        const curr_cp: u21 = if (b < 0x80) b else blk: {
            const dec = decodeUtf8Unchecked(text, pos);
            if (pos + dec.len > text.len) break :blk 0xFFFD;
            break :blk dec.cp;
        };

        const cp_len: usize = if (b < 0x80) 1 else decodeUtf8Unchecked(text, pos).len;

        if (isValidCodepoint(curr_cp)) {
            const is_break = if (prev_cp) |p| blk: {
                if (!isValidCodepoint(p)) break :blk true;
                break :blk uucode.grapheme.isBreak(p, curr_cp, &break_state);
            } else true;

            if (is_break) {
                second_to_last_grapheme_start = prev_grapheme_start;
                prev_grapheme_start = pos;
            }

            prev_cp = curr_cp;
        }

        pos += cp_len;
    }

    if (prev_grapheme_start == 0 and byte_offset == 0) {
        return null;
    }

    const start_offset = if (prev_grapheme_start < byte_offset) prev_grapheme_start else second_to_last_grapheme_start;
    const byte_diff: u32 = @intCast(byte_offset - start_offset);
    const grapheme_col = if (current_column >= byte_diff) current_column - byte_diff else 0;
    const width = getWidthAt(text, start_offset, tab_width, grapheme_col);

    return .{
        .start_offset = start_offset,
        .width = width,
    };
}
