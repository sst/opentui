const std = @import("std");
const split_scrollback = @import("../split-scrollback.zig");

test "split scrollback starts empty" {
    var scrollback = split_scrollback.SplitScrollback{};

    try std.testing.expectEqual(@as(u32, 0), scrollback.published_rows);
    try std.testing.expectEqual(@as(u32, 0), scrollback.tail_column);
    try std.testing.expectEqual(@as(u32, 0), scrollback.renderOffset(6));
}

test "split scrollback reset seeds pinned rows" {
    var scrollback = split_scrollback.SplitScrollback{};

    scrollback.reset(6);
    try std.testing.expectEqual(@as(u32, 6), scrollback.published_rows);
    try std.testing.expectEqual(@as(u32, 0), scrollback.tail_column);
    try std.testing.expectEqual(@as(u32, 6), scrollback.renderOffset(6));

    scrollback.publishSnapshotRows(1, 1, 40, false);
    try std.testing.expectEqual(@as(u32, 6), scrollback.renderOffset(6));
    try std.testing.expectEqual(@as(u32, 1), scrollback.tail_column);
}

test "split scrollback snapshot rows start at line boundary" {
    var scrollback = split_scrollback.SplitScrollback{};

    scrollback.publishSnapshotRows(1, 4, 20, false);
    try std.testing.expectEqual(@as(u32, 1), scrollback.published_rows);
    try std.testing.expectEqual(@as(u32, 4), scrollback.tail_column);

    scrollback.noteNewline();
    scrollback.publishSnapshotRows(2, 8, 20, true);

    try std.testing.expectEqual(@as(u32, 4), scrollback.published_rows);
    try std.testing.expectEqual(@as(u32, 0), scrollback.tail_column);
}

test "split scrollback snapshot rows wrap visible columns against terminal width" {
    var scrollback = split_scrollback.SplitScrollback{};

    scrollback.publishSnapshotRows(1, 6, 4, true);

    try std.testing.expectEqual(@as(u32, 3), scrollback.published_rows);
    try std.testing.expectEqual(@as(u32, 0), scrollback.tail_column);
}

test "split scrollback snapshot rows can omit trailing newline" {
    var scrollback = split_scrollback.SplitScrollback{};

    scrollback.publishSnapshotRows(1, 6, 4, false);

    try std.testing.expectEqual(@as(u32, 2), scrollback.published_rows);
    try std.testing.expectEqual(@as(u32, 2), scrollback.tail_column);
}
