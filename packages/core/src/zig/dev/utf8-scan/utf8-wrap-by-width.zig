//! UTF-8 Width-Aware Word Wrap Position Finding
//!
//! Find the optimal byte position to wrap UTF-8 text based on visual display width,
//! respecting grapheme cluster boundaries.

const std = @import("std");
const uucode = @import("uucode");

pub const WrapByWidthResult = struct {
    byte_offset: u32,
    grapheme_count: u32,
    columns_used: u32,
};

// Decode a UTF-8 codepoint starting at pos. Assumes valid UTF-8 input.
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

pub fn findWrapPosByWidthBaseline(
    text: []const u8,
    max_columns: u32,
    tab_width: u8,
) WrapByWidthResult {
    if (text.len == 0 or max_columns == 0) {
        return .{ .byte_offset = 0, .grapheme_count = 0, .columns_used = 0 };
    }

    var pos: usize = 0;
    var grapheme_count: u32 = 0;
    var columns_used: u32 = 0;
    var prev_cp: ?u21 = null;
    var break_state: uucode.grapheme.BreakState = .default;
    var cluster_width: u32 = 0;
    var cluster_start: usize = 0;

    while (pos < text.len) {
        const b0 = text[pos];
        const curr_cp: u21 = if (b0 < 0x80) b0 else decodeUtf8Unchecked(text, pos).cp;
        const cp_len: usize = if (b0 < 0x80) 1 else decodeUtf8Unchecked(text, pos).len;

        const is_break = if (curr_cp == 0xFFFD or curr_cp > 0x10FFFF)
            true
        else if (prev_cp) |p|
            if (p == 0xFFFD or p > 0x10FFFF) true else uucode.grapheme.isBreak(p, curr_cp, &break_state)
        else
            true;

        if (is_break and prev_cp != null) {
            // Would adding this cluster exceed the limit?
            if (columns_used + cluster_width > max_columns) {
                return .{ .byte_offset = @intCast(cluster_start), .grapheme_count = grapheme_count, .columns_used = columns_used };
            }
            columns_used += cluster_width;
            grapheme_count += 1;
            cluster_width = 0;
            cluster_start = pos;
        }

        // Add width to current cluster
        if (b0 == '\t') {
            cluster_width += tab_width - (columns_used % tab_width);
        } else if (b0 < 0x80 and b0 >= 32 and b0 <= 126) {
            cluster_width += 1;
        } else if (b0 >= 0x80) {
            cluster_width += eastAsianWidth(curr_cp);
        }

        prev_cp = curr_cp;
        pos += cp_len;
    }

    // Final cluster
    if (prev_cp != null and cluster_width > 0) {
        if (columns_used + cluster_width > max_columns) {
            return .{ .byte_offset = @intCast(cluster_start), .grapheme_count = grapheme_count, .columns_used = columns_used };
        }
        columns_used += cluster_width;
        grapheme_count += 1;
    }

    return .{ .byte_offset = @intCast(text.len), .grapheme_count = grapheme_count, .columns_used = columns_used };
}

pub fn findWrapPosByWidthSIMD16(
    text: []const u8,
    max_columns: u32,
    tab_width: u8,
) WrapByWidthResult {
    if (text.len == 0 or max_columns == 0) {
        return .{ .byte_offset = 0, .grapheme_count = 0, .columns_used = 0 };
    }

    const vector_len = 16;
    var pos: usize = 0;
    var grapheme_count: u32 = 0;
    var columns_used: u32 = 0;
    var prev_cp: ?u21 = null;
    var break_state: uucode.grapheme.BreakState = .default;
    var cluster_width: u32 = 0;
    var cluster_start: usize = 0;

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
                const is_break = if (prev_cp) |p| uucode.grapheme.isBreak(p, curr_cp, &break_state) else true;

                if (is_break) {
                    if (prev_cp != null) {
                        if (columns_used + cluster_width > max_columns) {
                            return .{ .byte_offset = @intCast(cluster_start), .grapheme_count = grapheme_count, .columns_used = columns_used };
                        }
                        columns_used += cluster_width;
                        grapheme_count += 1;
                    }
                    cluster_width = 0;
                    cluster_start = pos + i;
                }

                if (b == '\t') {
                    cluster_width += tab_width - (columns_used % tab_width);
                } else if (b >= 32 and b <= 126) {
                    cluster_width += 1;
                }

                prev_cp = curr_cp;
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

            const is_break = if (curr_cp == 0xFFFD or curr_cp > 0x10FFFF)
                true
            else if (prev_cp) |p|
                if (p == 0xFFFD or p > 0x10FFFF) true else uucode.grapheme.isBreak(p, curr_cp, &break_state)
            else
                true;

            if (is_break) {
                if (prev_cp != null) {
                    if (columns_used + cluster_width > max_columns) {
                        return .{ .byte_offset = @intCast(cluster_start), .grapheme_count = grapheme_count, .columns_used = columns_used };
                    }
                    columns_used += cluster_width;
                    grapheme_count += 1;
                }
                cluster_width = 0;
                cluster_start = pos + i;
            }

            if (b0 == '\t') {
                cluster_width += tab_width - (columns_used % tab_width);
            } else if (b0 < 0x80 and b0 >= 32 and b0 <= 126) {
                cluster_width += 1;
            } else if (b0 >= 0x80) {
                cluster_width += eastAsianWidth(curr_cp);
            }

            prev_cp = curr_cp;
            i += cp_len;
        }
        pos += i; // Advance by how much we actually processed
    }

    // Tail
    while (pos < text.len) {
        const b0 = text[pos];
        const curr_cp: u21 = if (b0 < 0x80) b0 else decodeUtf8Unchecked(text, pos).cp;
        const cp_len: usize = if (b0 < 0x80) 1 else decodeUtf8Unchecked(text, pos).len;

        const is_break = if (curr_cp == 0xFFFD or curr_cp > 0x10FFFF)
            true
        else if (prev_cp) |p|
            if (p == 0xFFFD or p > 0x10FFFF) true else uucode.grapheme.isBreak(p, curr_cp, &break_state)
        else
            true;

        if (is_break) {
            if (prev_cp != null) {
                if (columns_used + cluster_width > max_columns) {
                    return .{ .byte_offset = @intCast(cluster_start), .grapheme_count = grapheme_count, .columns_used = columns_used };
                }
                columns_used += cluster_width;
                grapheme_count += 1;
            }
            cluster_width = 0;
            cluster_start = pos;
        }

        if (b0 == '\t') {
            cluster_width += tab_width - (columns_used % tab_width);
        } else if (b0 < 0x80 and b0 >= 32 and b0 <= 126) {
            cluster_width += 1;
        } else if (b0 >= 0x80) {
            cluster_width += eastAsianWidth(curr_cp);
        }

        prev_cp = curr_cp;
        pos += cp_len;
    }

    // Final cluster
    if (prev_cp != null and cluster_width > 0) {
        if (columns_used + cluster_width > max_columns) {
            return .{ .byte_offset = @intCast(cluster_start), .grapheme_count = grapheme_count, .columns_used = columns_used };
        }
        columns_used += cluster_width;
        grapheme_count += 1;
    }

    return .{ .byte_offset = @intCast(text.len), .grapheme_count = grapheme_count, .columns_used = columns_used };
}

pub fn findWrapPosByWidthStdLib(text: []const u8, max_columns: u32, tab_width: u8) WrapByWidthResult {
    return findWrapPosByWidthBaseline(text, max_columns, tab_width);
}

pub fn findWrapPosByWidthBitmask128(text: []const u8, max_columns: u32, tab_width: u8) WrapByWidthResult {
    return findWrapPosByWidthBaseline(text, max_columns, tab_width);
}
