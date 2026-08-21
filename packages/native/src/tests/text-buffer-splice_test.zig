const std = @import("std");
const text_buffer = @import("../text-buffer.zig");
const edit_buffer = @import("../edit-buffer.zig");
const gp = @import("../grapheme.zig");
const link = @import("../link.zig");

const TextBuffer = text_buffer.UnifiedTextBuffer;
const DisplayPoint = text_buffer.DisplayPoint;

fn expectText(tb: *const TextBuffer, expected: []const u8) !void {
    const output = try std.testing.allocator.alloc(u8, tb.getByteSize());
    defer std.testing.allocator.free(output);
    const written = tb.getPlainTextIntoBuffer(output);
    try std.testing.expectEqualStrings(expected, output[0..written]);
}

test "TextBuffer normalized byte coordinates cover UTF-8, tabs, and line endings" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    try tb.setText("ab\r\n界\tz\re\n");

    try expectText(tb, "ab\n界\tz\ne\n");
    try std.testing.expectEqual(@as(u32, 11), tb.getByteSize());

    const cases = [_]struct { byte: u32, weight: u32, point: DisplayPoint }{
        .{ .byte = 0, .weight = 0, .point = .{ .row = 0, .col = 0 } },
        .{ .byte = 2, .weight = 2, .point = .{ .row = 0, .col = 2 } },
        .{ .byte = 3, .weight = 3, .point = .{ .row = 1, .col = 0 } },
        .{ .byte = 6, .weight = 5, .point = .{ .row = 1, .col = 2 } },
        .{ .byte = 7, .weight = 7, .point = .{ .row = 1, .col = 4 } },
        .{ .byte = 8, .weight = 8, .point = .{ .row = 1, .col = 5 } },
        .{ .byte = 9, .weight = 9, .point = .{ .row = 2, .col = 0 } },
        .{ .byte = 11, .weight = 11, .point = .{ .row = 3, .col = 0 } },
    };

    for (cases) |case| {
        try std.testing.expectEqual(case.weight, try tb.normalizedByteOffsetToRopeWeight(case.byte));
        try std.testing.expectEqual(case.byte, try tb.ropeWeightToNormalizedByteOffset(case.weight));
        try std.testing.expectEqual(case.point, try tb.normalizedByteOffsetToDisplayPoint(case.byte));
        try std.testing.expectEqual(case.byte, try tb.displayPointToNormalizedByteOffset(case.point));
    }

    try std.testing.expectError(error.InvalidByteOffset, tb.normalizedByteOffsetToRopeWeight(4));
    try std.testing.expectError(error.InvalidByteOffset, tb.normalizedByteOffsetToRopeWeight(12));
    try std.testing.expectError(error.InvalidDisplayColumn, tb.ropeWeightToNormalizedByteOffset(4));
    try std.testing.expectError(error.InvalidDisplayColumn, tb.displayPointToNormalizedByteOffset(.{ .row = 1, .col = 1 }));
    try std.testing.expectError(error.InvalidDisplayColumn, tb.displayPointToNormalizedByteOffset(.{ .row = 1, .col = 3 }));
    try std.testing.expectError(error.InvalidDisplayColumn, tb.displayPointToNormalizedByteOffset(.{ .row = 8, .col = 0 }));
}

test "TextBuffer normalized byte coordinates preserve combining and ZWJ boundaries" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("Ae\u{301}B");
    try std.testing.expectEqual(@as(u32, 1), try tb.normalizedByteOffsetToRopeWeight(1));
    try std.testing.expectEqual(@as(u32, 2), try tb.normalizedByteOffsetToRopeWeight(2));
    try std.testing.expectError(error.InvalidByteOffset, tb.normalizedByteOffsetToRopeWeight(3));
    try std.testing.expectEqual(@as(u32, 2), try tb.normalizedByteOffsetToRopeWeight(4));

    try tb.setText("X👩‍💻Y");
    try std.testing.expectEqual(@as(u32, 1), try tb.normalizedByteOffsetToRopeWeight(1));
    try std.testing.expectEqual(@as(u32, 3), try tb.normalizedByteOffsetToRopeWeight(5));
    try std.testing.expectEqual(@as(u32, 3), try tb.normalizedByteOffsetToRopeWeight(8));
    try std.testing.expectEqual(@as(u32, 3), try tb.normalizedByteOffsetToRopeWeight(12));

    try tb.replaceNormalizedBytes(5, 8, "");
    try expectText(tb, "X👩💻Y");

    try tb.setText("Ae\u{301}B");
    try tb.replaceNormalizedBytes(2, 4, "");
    try expectText(tb, "AeB");
}

test "TextBuffer replaceNormalizedBytes handles multiline, empty, and EOF edits atomically" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    const view_id = try tb.registerView();
    defer tb.unregisterView(view_id);

    try tb.setText("alpha\r\nbeta\nomega");
    tb.clearViewDirty(view_id);
    var epoch = tb.getContentEpoch();

    try tb.replaceNormalizedBytes(6, 10, "中\r\n🙂");
    try expectText(tb, "alpha\n中\n🙂\nomega");
    try std.testing.expectEqual(epoch + 1, tb.getContentEpoch());
    try std.testing.expect(tb.isViewDirty(view_id));

    tb.clearViewDirty(view_id);
    epoch = tb.getContentEpoch();
    const eof = tb.getByteSize();
    try tb.replaceNormalizedBytes(eof, eof, "!");
    try expectText(tb, "alpha\n中\n🙂\nomega!");
    try std.testing.expectEqual(epoch + 1, tb.getContentEpoch());
    try std.testing.expect(tb.isViewDirty(view_id));

    tb.clearViewDirty(view_id);
    epoch = tb.getContentEpoch();
    try tb.replaceNormalizedBytes(0, tb.getByteSize(), "");
    try expectText(tb, "");
    try std.testing.expectEqual(@as(u32, 0), tb.getByteSize());
    try std.testing.expectEqual(epoch + 1, tb.getContentEpoch());

    tb.clearViewDirty(view_id);
    epoch = tb.getContentEpoch();
    try tb.replaceNormalizedBytes(0, 0, "");
    try std.testing.expectEqual(epoch, tb.getContentEpoch());
    try std.testing.expect(!tb.isViewDirty(view_id));

    try tb.replaceNormalizedBytes(0, 0, "first");
    try expectText(tb, "first");

    try tb.setText("a\n\nb");
    try tb.replaceNormalizedBytes(2, 2, "middle");
    try expectText(tb, "a\nmiddle\nb");
}

test "TextBuffer replaceNormalizedBytes leaves content unchanged on invalid input" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    try tb.setText("A界e\u{301}Z");
    const epoch = tb.getContentEpoch();

    try std.testing.expectError(error.InvalidByteOffset, tb.replaceNormalizedBytes(2, 4, "x"));
    try std.testing.expectError(error.InvalidByteOffset, tb.replaceNormalizedBytes(4, 3, "x"));
    try std.testing.expectError(error.InvalidByteOffset, tb.replaceNormalizedBytes(0, 99, "x"));
    try std.testing.expectError(error.InvalidUtf8, tb.replaceNormalizedBytes(0, 1, "\xff"));

    try expectText(tb, "A界e\u{301}Z");
    try std.testing.expectEqual(epoch, tb.getContentEpoch());
}

test "TextBuffer repeated replacements retain undo roots without exhausting registry" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    try tb.setText("seed");

    var expected: [32]u8 = undefined;
    var expected_text: []const u8 = "seed";
    var i: usize = 0;
    while (i < 300) : (i += 1) {
        try tb.rope().store_undo("");
        expected_text = try std.fmt.bufPrint(&expected, "value-{d}-界", .{i});
        try tb.replaceNormalizedBytes(0, tb.getByteSize(), expected_text);
    }

    try expectText(tb, expected_text);
    try std.testing.expectEqual(@as(usize, 2), tb.memRegistry().getUsedSlots());

    _ = try tb.rope().undo("");
    try expectText(tb, "value-298-界");
}

test "TextBuffer replaceNormalizedBytes keeps state on allocation failure" {
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    const allocator = failing.allocator();
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const tb = try TextBuffer.init(allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    try tb.setText("stable");
    const epoch = tb.getContentEpoch();

    failing.fail_index = failing.alloc_index;
    try std.testing.expectError(error.OutOfMemory, tb.replaceNormalizedBytes(0, 6, "replacement"));
    try expectText(tb, "stable");
    try std.testing.expectEqual(epoch, tb.getContentEpoch());
}

test "EditBuffer shared segment splitter preserves history behavior" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const eb = try edit_buffer.EditBuffer.init(std.testing.allocator, pool, link_pool, .unicode, null);
    defer eb.deinit();
    try eb.setText("A界\nC");
    try eb.setCursor(0, 1);
    try eb.insertText("🙂\r\nB");
    try expectText(eb.getTextBuffer(), "A🙂\nB界\nC");

    _ = try eb.undo();
    try expectText(eb.getTextBuffer(), "A界\nC");
    _ = try eb.redo();
    try expectText(eb.getTextBuffer(), "A🙂\nB界\nC");
}
