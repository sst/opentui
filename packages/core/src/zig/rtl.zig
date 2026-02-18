const std = @import("std");

pub const Direction = enum(u2) {
    ltr,
    rtl,
    neutral,
};

pub fn classifyGraphemeBytes(bytes: []const u8) Direction {
    if (bytes.len == 0) return .neutral;

    const seq_len = std.unicode.utf8ByteSequenceLength(bytes[0]) catch return .neutral;
    if (seq_len > bytes.len) return .neutral;

    const cp = std.unicode.utf8Decode(bytes[0..seq_len]) catch return .neutral;
    return classifyCodepoint(cp);
}

pub fn classifyCodepoint(cp: u21) Direction {
    if (isRtlCodepoint(cp)) return .rtl;

    if (cp <= 0x7F) {
        if (isAsciiStrongLtr(cp)) return .ltr;
        return .neutral;
    }

    if (isCommonNeutralCodepoint(cp)) return .neutral;

    return .ltr;
}

pub fn resolveNeutralDirections(directions: []Direction) void {
    if (directions.len == 0) return;

    // Terminal rendering in opentui is LTR-first. Using LTR as base direction
    // for mixed boundaries keeps spaces/punctuation between RTL and LTR runs
    // on the LTR side, which preserves expected visual spacing.
    const base_dir: Direction = .ltr;

    var i: usize = 0;
    while (i < directions.len) {
        if (directions[i] != .neutral) {
            i += 1;
            continue;
        }

        const start = i;
        while (i < directions.len and directions[i] == .neutral) : (i += 1) {}
        const end = i;

        const left = nearestStrongLeft(directions, start);
        const right = nearestStrongRight(directions, end);

        const resolved: Direction = if (left != null and right != null)
            if (left.? == right.?) left.? else base_dir
        else if (left != null)
            left.?
        else if (right != null)
            right.?
        else
            base_dir;

        for (start..end) |idx| {
            directions[idx] = resolved;
        }
    }
}

pub fn reorderRtlRuns(comptime T: type, items: []T, directions: []const Direction) void {
    std.debug.assert(items.len == directions.len);

    var i: usize = 0;
    while (i < directions.len) {
        if (directions[i] != .rtl) {
            i += 1;
            continue;
        }

        const run_start = i;
        while (i < directions.len and directions[i] == .rtl) : (i += 1) {}

        std.mem.reverse(T, items[run_start..i]);
    }
}

fn nearestStrongLeft(directions: []const Direction, start: usize) ?Direction {
    var i = start;
    while (i > 0) {
        i -= 1;
        const dir = directions[i];
        if (dir != .neutral) return dir;
    }
    return null;
}

fn nearestStrongRight(directions: []const Direction, start: usize) ?Direction {
    var i = start;
    while (i < directions.len) : (i += 1) {
        const dir = directions[i];
        if (dir != .neutral) return dir;
    }
    return null;
}

fn isAsciiStrongLtr(cp: u21) bool {
    return (cp >= 'a' and cp <= 'z') or
        (cp >= 'A' and cp <= 'Z') or
        (cp >= '0' and cp <= '9');
}

fn isCommonNeutralCodepoint(cp: u21) bool {
    return switch (cp) {
        ' ', '\t', '\n', '\r' => true,
        '!', '"', '#', '$', '%', '&', '\'', '(', ')', '*', '+', ',', '-', '.', '/', ':', ';', '<', '=', '>', '?', '@', '[', '\\', ']', '^', '_', '`', '{', '|', '}', '~' => true,
        0x00AB, // <<
        0x00BB, // >>
        0x2010...0x2015, // dashes
        0x2018...0x201F, // quotes
        0x2026, // ellipsis
        0x2039, // single left quote
        0x203A, // single right quote
        0x3000...0x303F, // CJK punctuation block
        => true,
        else => false,
    };
}

fn isRtlCodepoint(cp: u21) bool {
    return (cp >= 0x0590 and cp <= 0x05FF) or // Hebrew
        (cp >= 0x0600 and cp <= 0x06FF) or // Arabic
        (cp >= 0x0700 and cp <= 0x074F) or // Syriac
        (cp >= 0x0750 and cp <= 0x077F) or // Arabic Supplement
        (cp >= 0x0780 and cp <= 0x07BF) or // Thaana
        (cp >= 0x07C0 and cp <= 0x07FF) or // NKo
        (cp >= 0x0800 and cp <= 0x083F) or // Samaritan
        (cp >= 0x0840 and cp <= 0x085F) or // Mandaic
        (cp >= 0x08A0 and cp <= 0x08FF) or // Arabic Extended-A
        (cp >= 0xFB1D and cp <= 0xFB4F) or // Hebrew presentation forms
        (cp >= 0xFB50 and cp <= 0xFDFF) or // Arabic presentation forms-A
        (cp >= 0xFE70 and cp <= 0xFEFF) or // Arabic presentation forms-B
        (cp >= 0x1EE00 and cp <= 0x1EEFF); // Arabic Mathematical Alphabetic Symbols
}

test "resolveNeutralDirections keeps separator neutral on LTR side between RTL and LTR" {
    var dirs = [_]Direction{ .ltr, .neutral, .rtl, .neutral, .ltr };

    resolveNeutralDirections(dirs[0..]);

    try std.testing.expectEqual(Direction.ltr, dirs[1]);
    try std.testing.expectEqual(Direction.ltr, dirs[3]);
}

test "resolveNeutralDirections keeps internal RTL separators in RTL runs" {
    var dirs = [_]Direction{ .rtl, .neutral, .rtl };

    resolveNeutralDirections(dirs[0..]);

    try std.testing.expectEqual(Direction.rtl, dirs[1]);
}
