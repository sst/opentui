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

// East Asian Width detection based on Unicode 15.1.0
// Returns the display width in columns (0, 1, or 2)
inline fn eastAsianWidth(cp: u21) u32 {
    // Zero-width characters: combining marks and format characters
    if ((cp >= 0x0300 and cp <= 0x036F) or // Combining Diacritical Marks
        (cp >= 0x1AB0 and cp <= 0x1AFF) or // Combining Diacritical Marks Extended
        (cp >= 0x1DC0 and cp <= 0x1DFF) or // Combining Diacritical Marks Supplement
        (cp >= 0x20D0 and cp <= 0x20FF) or // Combining Diacritical Marks for Symbols
        (cp >= 0xFE20 and cp <= 0xFE2F) or // Combining Half Marks
        // Format characters (Cf category) - zero width
        cp == 0x00AD or // Soft Hyphen
        (cp >= 0x0600 and cp <= 0x0605) or // Arabic format characters
        cp == 0x061C or // Arabic Letter Mark
        cp == 0x06DD or // Arabic End of Ayah
        cp == 0x070F or // Syriac Abbreviation Mark
        cp == 0x180E or // Mongolian Vowel Separator
        (cp >= 0x200B and cp <= 0x200F) or // ZWSP, ZWNJ, ZWJ, LRM, RLM
        (cp >= 0x2028 and cp <= 0x202E) or // Line/Para separators, directional formatting
        (cp >= 0x2060 and cp <= 0x2064) or // Word Joiner, invisible operators
        (cp >= 0x2066 and cp <= 0x206F) or // Directional formatting
        cp == 0xFEFF or // Zero Width No-Break Space (BOM)
        (cp >= 0xFFF9 and cp <= 0xFFFB) or // Interlinear Annotation
        cp == 0x110BD or // Kaithi Number Sign
        (cp >= 0x1BCA0 and cp <= 0x1BCA3) or // Shorthand Format
        (cp >= 0x1D173 and cp <= 0x1D17A) or // Musical formatting
        cp == 0xE0001 or // Language Tag
        (cp >= 0xE0020 and cp <= 0xE007F)) // Tag characters
    {
        return 0;
    }

    // Wide and Fullwidth characters (width 2)
    if ((cp >= 0x1100 and cp <= 0x115F) or // Hangul Jamo
        (cp >= 0x231A and cp <= 0x231B) or // Watch, Hourglass
        (cp >= 0x2329 and cp <= 0x232A) or // Left/Right-Pointing Angle Bracket
        (cp >= 0x23E9 and cp <= 0x23EC) or // Fast Forward, etc
        (cp >= 0x23F0 and cp <= 0x23F0) or // Alarm Clock
        (cp >= 0x23F3 and cp <= 0x23F3) or // Hourglass
        (cp >= 0x25FD and cp <= 0x25FE) or // White/Black Medium Small Square
        (cp >= 0x2600 and cp <= 0x27BF) or // Miscellaneous Symbols, Dingbats (includes checkmark U+2705, heart U+2764, etc.)
        (cp >= 0x2B1B and cp <= 0x2B1C) or // Black/White Large Square
        (cp >= 0x2B50 and cp <= 0x2B50) or // White Medium Star
        (cp >= 0x2B55 and cp <= 0x2B55) or // Heavy Large Circle
        (cp >= 0x2E80 and cp <= 0x2EFF) or // CJK Radicals Supplement
        (cp >= 0x2F00 and cp <= 0x2FDF) or // Kangxi Radicals
        (cp >= 0x2FF0 and cp <= 0x2FFF) or // Ideographic Description Characters
        (cp >= 0x3000 and cp <= 0x303E) or // CJK Symbols and Punctuation
        (cp >= 0x3040 and cp <= 0x309F) or // Hiragana
        (cp >= 0x30A0 and cp <= 0x30FF) or // Katakana
        (cp >= 0x3100 and cp <= 0x312F) or // Bopomofo
        (cp >= 0x3131 and cp <= 0x318E) or // Hangul Compatibility Jamo
        (cp >= 0x3190 and cp <= 0x31BA) or // Kanbun, Bopomofo Extended
        (cp >= 0x31C0 and cp <= 0x31E3) or // CJK Strokes
        (cp >= 0x31F0 and cp <= 0x31FF) or // Katakana Phonetic Extensions
        (cp >= 0x3200 and cp <= 0x32FF) or // Enclosed CJK Letters and Months
        (cp >= 0x3300 and cp <= 0x33FF) or // CJK Compatibility
        (cp >= 0x3400 and cp <= 0x4DBF) or // CJK Unified Ideographs Extension A
        (cp >= 0x4DC0 and cp <= 0x4DFF) or // Yijing Hexagram Symbols
        (cp >= 0x4E00 and cp <= 0x9FFF) or // CJK Unified Ideographs
        (cp >= 0xA000 and cp <= 0xA48F) or // Yi Syllables
        (cp >= 0xA490 and cp <= 0xA4CF) or // Yi Radicals
        (cp >= 0xAC00 and cp <= 0xD7A3) or // Hangul Syllables
        (cp >= 0xF900 and cp <= 0xFAFF) or // CJK Compatibility Ideographs
        (cp >= 0xFE10 and cp <= 0xFE19) or // Vertical Forms
        (cp >= 0xFE30 and cp <= 0xFE6F) or // CJK Compatibility Forms
        (cp >= 0xFF01 and cp <= 0xFF60) or // Fullwidth Forms
        (cp >= 0xFFE0 and cp <= 0xFFE6) or // Fullwidth symbols
        (cp >= 0x1F000 and cp <= 0x1F02B) or // Mahjong Tiles, Domino Tiles
        (cp >= 0x1F030 and cp <= 0x1F093) or // Domino Tiles
        (cp >= 0x1F0A0 and cp <= 0x1F0AE) or // Playing Cards
        (cp >= 0x1F0B1 and cp <= 0x1F0BF) or // Playing Cards
        (cp >= 0x1F0C1 and cp <= 0x1F0CF) or // Playing Cards
        (cp >= 0x1F0D1 and cp <= 0x1F0F5) or // Playing Cards
        (cp >= 0x1F100 and cp <= 0x1F10C) or // Enclosed Alphanumeric Supplement
        (cp >= 0x1F110 and cp <= 0x1F16C) or // Enclosed Alphanumeric Supplement
        (cp >= 0x1F170 and cp <= 0x1F1AC) or // Enclosed Alphanumeric Supplement
        // NOTE: Regional Indicators (0x1F1E6-0x1F1FF) are handled specially - width 1 each, but pairs = width 2
        (cp >= 0x1F200 and cp <= 0x1F202) or // Enclosed Ideographic Supplement
        (cp >= 0x1F210 and cp <= 0x1F23B) or // Enclosed Ideographic Supplement
        (cp >= 0x1F240 and cp <= 0x1F248) or // Enclosed Ideographic Supplement
        (cp >= 0x1F250 and cp <= 0x1F251) or // Enclosed Ideographic Supplement
        (cp >= 0x1F260 and cp <= 0x1F265) or // Enclosed Ideographic Supplement
        (cp >= 0x1F300 and cp <= 0x1F6FF) or // Miscellaneous Symbols and Pictographs, Transport and Map Symbols
        (cp >= 0x1F700 and cp <= 0x1F773) or // Alchemical Symbols
        (cp >= 0x1F780 and cp <= 0x1F7D8) or // Geometric Shapes Extended
        (cp >= 0x1F7E0 and cp <= 0x1F7EB) or // Geometric Shapes Extended
        (cp >= 0x1F800 and cp <= 0x1F80B) or // Supplemental Arrows-C
        (cp >= 0x1F810 and cp <= 0x1F847) or // Supplemental Arrows-C
        (cp >= 0x1F850 and cp <= 0x1F859) or // Supplemental Arrows-C
        (cp >= 0x1F860 and cp <= 0x1F887) or // Supplemental Arrows-C
        (cp >= 0x1F890 and cp <= 0x1F8AD) or // Supplemental Arrows-C
        (cp >= 0x1F8B0 and cp <= 0x1F8B1) or // Supplemental Arrows-C
        (cp >= 0x1F900 and cp <= 0x1FA53) or // Supplemental Symbols and Pictographs
        (cp >= 0x1FA60 and cp <= 0x1FA6D) or // Supplemental Symbols and Pictographs
        (cp >= 0x1FA70 and cp <= 0x1FA74) or // Supplemental Symbols and Pictographs
        (cp >= 0x1FA78 and cp <= 0x1FA7C) or // Supplemental Symbols and Pictographs
        (cp >= 0x1FA80 and cp <= 0x1FA86) or // Supplemental Symbols and Pictographs
        (cp >= 0x1FA90 and cp <= 0x1FAAC) or // Supplemental Symbols and Pictographs
        (cp >= 0x1FAB0 and cp <= 0x1FABA) or // Supplemental Symbols and Pictographs
        (cp >= 0x1FAC0 and cp <= 0x1FAC5) or // Supplemental Symbols and Pictographs
        (cp >= 0x1FAD0 and cp <= 0x1FAD9) or // Supplemental Symbols and Pictographs
        (cp >= 0x1FAE0 and cp <= 0x1FAE7) or // Supplemental Symbols and Pictographs
        (cp >= 0x1FAF0 and cp <= 0x1FAF8) or // Supplemental Symbols and Pictographs
        (cp >= 0x20000 and cp <= 0x2FFFD) or // CJK Unified Ideographs Extension B-F
        (cp >= 0x30000 and cp <= 0x3FFFD)) // CJK Unified Ideographs Extension G
    {
        return 2;
    }

    // Default to width 1
    return 1;
}

/// Calculate the display width of a byte in columns
/// Used for ASCII-only fast paths
inline fn asciiCharWidth(byte: u8, tab_width: u8) u32 {
    if (byte == '\t') {
        return tab_width;
    } else if (byte >= 32 and byte <= 126) {
        return 1;
    }
    return 0;
}

/// Calculate the display width of a character (byte or codepoint) in columns
inline fn charWidth(byte: u8, codepoint: u21, tab_width: u8) u32 {
    if (byte == '\t') {
        return tab_width;
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
                const width = asciiCharWidth(b, tab_width);
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
            const width = asciiCharWidth(b, tab_width);
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

                state.cluster_width += asciiCharWidth(b, tab_width);
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

            state.cluster_width += charWidth(b0, curr_cp, tab_width);
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

        state.cluster_width += charWidth(b0, curr_cp, tab_width);
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

                columns_used += asciiCharWidth(b, tab_width);

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

            columns_used += asciiCharWidth(b, tab_width);

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

                state.cluster_width += asciiCharWidth(b, tab_width);
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

            state.cluster_width += charWidth(b0, curr_cp, tab_width);
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

        state.cluster_width += charWidth(b0, curr_cp, tab_width);
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

pub fn getWidthAt(text: []const u8, byte_offset: usize, tab_width: u8) u32 {
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
    var cluster_width: u32 = charWidth(b0, first_cp, tab_width);

    var pos = byte_offset + first_len;

    while (pos < text.len) {
        const b = text[pos];
        const curr_cp: u21 = if (b < 0x80) b else decodeUtf8Unchecked(text, pos).cp;
        const cp_len: usize = if (b < 0x80) 1 else decodeUtf8Unchecked(text, pos).len;

        if (pos + cp_len > text.len) break;

        const is_break = isGraphemeBreak(prev_cp, curr_cp, &break_state);
        if (is_break) break;

        cluster_width += charWidth(b, curr_cp, tab_width);
        prev_cp = curr_cp;
        pos += cp_len;
    }

    return cluster_width;
}

pub const PrevGraphemeResult = struct {
    start_offset: usize,
    width: u32,
};

pub fn getPrevGraphemeStart(text: []const u8, byte_offset: usize, tab_width: u8) ?PrevGraphemeResult {
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
    const width = getWidthAt(text, start_offset, tab_width);

    return .{
        .start_offset = start_offset,
        .width = width,
    };
}

/// Calculate the display width of text including tab characters with static tab_width
/// This is a high-performance function for measuring text with tabs
/// Tabs are always tab_width columns regardless of position
/// IMPORTANT: Properly handles grapheme clusters (e.g., emoji with modifiers, ZWJ sequences)
/// For grapheme clusters, uses the width of the first non-zero-width codepoint
pub fn calculateTextWidth(text: []const u8, tab_width: u8, isASCIIOnly: bool) u32 {
    if (text.len == 0) return 0;

    // ASCII-only fast path
    if (isASCIIOnly) {
        var width: u32 = 0;
        for (text) |b| {
            width += asciiCharWidth(b, tab_width);
        }
        return width;
    }

    // General case with Unicode support and grapheme cluster handling
    var total_width: u32 = 0;
    var pos: usize = 0;
    var prev_cp: ?u21 = null;
    var break_state: uucode.grapheme.BreakState = .default;
    var cluster_width: u32 = 0; // Width of the current grapheme cluster
    var cluster_has_width: bool = false; // Track if we've found a non-zero width codepoint
    var is_regional_indicator_pair: bool = false; // Track if we're in an RI pair (flag emoji)

    while (pos < text.len) {
        const b0 = text[pos];

        // Decode the codepoint
        const curr_cp: u21 = if (b0 < 0x80) b0 else blk: {
            const dec = decodeUtf8Unchecked(text, pos);
            if (pos + dec.len > text.len) break :blk 0xFFFD;
            break :blk dec.cp;
        };

        const cp_len: usize = if (b0 < 0x80) 1 else decodeUtf8Unchecked(text, pos).len;

        // Check if this is a Regional Indicator (flag emoji component)
        const is_ri = (curr_cp >= 0x1F1E6 and curr_cp <= 0x1F1FF);

        // Check if this is a grapheme break
        const is_break = isGraphemeBreak(prev_cp, curr_cp, &break_state);

        if (is_break) {
            // Commit the previous cluster's width
            if (prev_cp != null) {
                total_width += cluster_width;
            }
            // Start a new cluster
            const cp_width = charWidth(b0, curr_cp, tab_width);
            cluster_width = cp_width;
            cluster_has_width = (cp_width > 0);
            is_regional_indicator_pair = is_ri; // Track if first codepoint is RI
        } else {
            // Continuing a cluster
            const cp_width = charWidth(b0, curr_cp, tab_width);

            // Special case: Regional Indicator pairs (flag emojis)
            // Both RIs contribute to width (typically 1+1=2)
            if (is_regional_indicator_pair and is_ri) {
                cluster_width += cp_width;
                cluster_has_width = true;
            } else if (!cluster_has_width and cp_width > 0) {
                // Normal case: use first non-zero width codepoint
                cluster_width = cp_width;
                cluster_has_width = true;
            }
            // Otherwise, ignore width of modifiers, ZWJ, etc.
        }

        prev_cp = curr_cp;
        pos += cp_len;
    }

    // Don't forget the last cluster
    if (prev_cp != null) {
        total_width += cluster_width;
    }

    return total_width;
}
