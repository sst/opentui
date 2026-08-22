const std = @import("std");
const text_buffer = @import("../text-buffer.zig");
const edit_buffer = @import("../edit-buffer.zig");
const syntax_style = @import("../syntax-style.zig");
const rope_mod = @import("../rope.zig");
const gp = @import("../grapheme.zig");
const link = @import("../link.zig");
const TextAnnotations = @import("../text-annotations.zig").TextAnnotations;

const TextBuffer = text_buffer.UnifiedTextBuffer;
const DisplayPoint = text_buffer.DisplayPoint;

const MetricTestItem = union(enum) {
    text: u32,
    marker: void,

    pub const Metrics = struct {
        bytes: u32 = 0,

        pub fn add(self: *Metrics, other: Metrics) void {
            self.bytes +|= other.bytes;
        }

        pub fn weight(self: *const Metrics) u32 {
            return self.bytes;
        }
    };

    pub const BoundaryAction = struct {
        delete_left: bool = false,
        delete_right: bool = false,
        insert_between: []const MetricTestItem = &.{},
    };

    pub fn measure(self: *const MetricTestItem) Metrics {
        return switch (self.*) {
            .text => |bytes| .{ .bytes = bytes },
            .marker => .{},
        };
    }

    pub fn empty() MetricTestItem {
        return .{ .text = 0 };
    }

    pub fn is_empty(self: *const MetricTestItem) bool {
        return switch (self.*) {
            .text => |bytes| bytes == 0,
            .marker => false,
        };
    }

    pub fn rewriteBoundary(_: std.mem.Allocator, _: ?*const MetricTestItem, _: ?*const MetricTestItem) !BoundaryAction {
        return .{};
    }

    pub fn rewriteEnds(_: std.mem.Allocator, first: ?*const MetricTestItem, _: ?*const MetricTestItem) !BoundaryAction {
        if (first == null or first.?.* != .marker) {
            return .{ .insert_between = &.{MetricTestItem{ .marker = {} }} };
        }
        return .{};
    }
};

const MetricTestRope = rope_mod.Rope(MetricTestItem);

fn metricTestValue(metrics: MetricTestRope.Metrics) u32 {
    return metrics.custom.bytes;
}

fn splitMetricTestItem(
    _: std.mem.Allocator,
    _: ?*anyopaque,
    item: *const MetricTestItem,
    offset: u32,
) error{ OutOfBounds, OutOfMemory }!MetricTestRope.Node.LeafSplitResult {
    const bytes = switch (item.*) {
        .text => |value| value,
        .marker => return error.OutOfBounds,
    };
    if (offset == 0 or offset >= bytes) return error.OutOfBounds;
    return .{ .left = .{ .text = offset }, .right = .{ .text = bytes - offset } };
}

fn expectText(tb: *const TextBuffer, expected: []const u8) !void {
    const output = try std.testing.allocator.alloc(u8, tb.getByteSize());
    defer std.testing.allocator.free(output);
    const written = tb.getPlainTextIntoBuffer(output);
    try std.testing.expectEqualStrings(expected, output[0..written]);
}

fn expectMarkerInvariants(tb: *TextBuffer) !void {
    const lines = tb.getLineCount();
    try std.testing.expectEqual(lines, tb.rope().markerCount(.linestart));
    try std.testing.expectEqual(lines -| 1, tb.rope().markerCount(.brk));
    try std.testing.expect(tb.rope().get(0).?.isLineStart());
}

test "normalized byte locations and display mapping keep coordinate spaces separate" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    try tb.setText("ab\r\n界\tz\re\n");

    try expectText(tb, "ab\n界\tz\ne\n");
    try std.testing.expectEqual(@as(u32, 11), tb.getByteSize());
    try std.testing.expectEqual(text_buffer.NormalizedByteLocation{ .row = 1, .byte_in_line = 3 }, try tb.normalizedByteOffsetToLocation(6));
    try std.testing.expectEqual(DisplayPoint{ .row = 1, .col = 2 }, try tb.normalizedByteOffsetToDisplayPointStrict(6));
    try std.testing.expectEqual(@as(u32, 6), try tb.displayPointToNormalizedByteOffset(.{ .row = 1, .col = 2 }, .before));
    try std.testing.expectError(error.InvalidByteOffset, tb.normalizedByteOffsetToLocation(4));
    try std.testing.expectError(error.InvalidByteOffset, tb.normalizedByteOffsetToLocation(12));
    try std.testing.expectError(error.InvalidDisplayColumn, tb.displayPointToNormalizedByteOffset(.{ .row = 8, .col = 0 }, .before));
}

test "byte to display snapping covers variation selectors keycaps combining and ZWJ" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    const cases = [_]struct {
        text: []const u8,
        interior: u32,
        cluster_end: u32,
    }{
        .{ .text = "A\u{fe0f}B", .interior = 1, .cluster_end = 4 },
        .{ .text = "1\u{fe0f}\u{20e3}X", .interior = 1, .cluster_end = 7 },
        .{ .text = "e\u{301}X", .interior = 1, .cluster_end = 3 },
        .{ .text = "👩‍💻X", .interior = 4, .cluster_end = 11 },
    };

    for (cases) |case| {
        try tb.setText(case.text);
        const before = try tb.normalizedByteOffsetToDisplayPoint(case.interior, .before);
        const after = try tb.normalizedByteOffsetToDisplayPoint(case.interior, .after);
        try std.testing.expect(!before.exact);
        try std.testing.expect(!after.exact);
        try std.testing.expectEqual(@as(u32, 0), before.point.col);
        try std.testing.expect(after.point.col > before.point.col);
        try std.testing.expectError(error.InvalidDisplayColumn, tb.normalizedByteOffsetToDisplayPointStrict(case.interior));
        try std.testing.expectEqual(@as(u32, 0), try tb.displayPointToNormalizedByteOffset(before.point, .before));
        try std.testing.expectEqual(case.cluster_end, try tb.displayPointToNormalizedByteOffset(after.point, .after));
        try std.testing.expectEqual(after.point.col, (try tb.normalizedByteOffsetToDisplayPointStrict(case.cluster_end)).col);
    }
}

test "normalized splice edits zero-width-only text and lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    try tb.setText("\u{301}\n\u{fe0f}\n");
    try std.testing.expectEqual(@as(u32, 0), tb.lineWidthAt(0));
    try std.testing.expectEqual(@as(u32, 0), tb.lineWidthAt(1));

    const first = try tb.replaceNormalizedBytes(0, 2, "x");
    try expectText(tb, "x\n\u{fe0f}\n");
    try std.testing.expectEqual(@as(u32, 1), first.inserted_len);
    try std.testing.expectEqual(@as(u32, 1), first.new_end);

    _ = try tb.replaceNormalizedBytes(2, 5, "");
    try expectText(tb, "x\n\n");
    try expectMarkerInvariants(tb);

    _ = try tb.replaceNormalizedBytes(2, 2, "\u{301}");
    try expectText(tb, "x\n\u{301}\n");
    try std.testing.expectEqual(@as(u32, 0), tb.lineWidthAt(1));
    try expectMarkerInvariants(tb);
}

test "normalized splice edits codepoint boundaries inside width-changing graphemes" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("A\u{fe0f}B");
    _ = try tb.replaceNormalizedBytes(1, 4, "");
    try expectText(tb, "AB");

    try tb.setText("1\u{fe0f}\u{20e3}X");
    _ = try tb.replaceNormalizedBytes(4, 7, "");
    try expectText(tb, "1\u{fe0f}X");

    try tb.setText("Ae\u{301}B");
    _ = try tb.replaceNormalizedBytes(2, 4, "");
    try expectText(tb, "AeB");

    try tb.setText("X👩‍💻Y");
    _ = try tb.replaceNormalizedBytes(5, 8, "");
    try expectText(tb, "X👩💻Y");
}

test "invalid normalized byte boundaries leave root version epoch and text unchanged" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    try tb.setText("A界e\u{301}Z");
    const root = tb.rope().root;
    const version = tb.rope().version;
    const epoch = tb.getContentEpoch();

    try std.testing.expectError(error.InvalidByteOffset, tb.replaceNormalizedBytes(2, 4, "x"));
    try std.testing.expectError(error.InvalidByteOffset, tb.replaceNormalizedBytes(4, 3, "x"));
    try std.testing.expectError(error.InvalidByteOffset, tb.replaceNormalizedBytes(0, 99, "x"));
    try std.testing.expectError(error.InvalidUtf8, tb.replaceNormalizedBytes(0, 1, "\xff"));
    try std.testing.expect(tb.rope().root == root);
    try std.testing.expectEqual(version, tb.rope().version);
    try std.testing.expectEqual(epoch, tb.getContentEpoch());
    try expectText(tb, "A界e\u{301}Z");
}

test "splice result reports normalized extents for mixed line endings" {
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
    const epoch = tb.getContentEpoch();

    const result = try tb.replaceNormalizedBytes(6, 10, "中\r\n🙂\rZ");
    try expectText(tb, "alpha\n中\n🙂\nZ\nomega");
    try std.testing.expectEqual(text_buffer.NormalizedByteRange{ .start = 6, .end = 10 }, result.old_range);
    try std.testing.expectEqual(@as(u32, 10), result.inserted_len);
    try std.testing.expectEqual(@as(u32, 16), result.new_end);
    try std.testing.expectEqual(@as(u32, 0), result.old_extent.rows);
    try std.testing.expectEqual(@as(u32, 2), result.new_extent.rows);
    try std.testing.expectEqual(epoch + 1, tb.getContentEpoch());
    try std.testing.expect(tb.isViewDirty(view_id));
    try expectMarkerInvariants(tb);
}

test "splice preserves trailing-newline marker affinity at BOF line starts and EOF" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    try tb.setText("a\n\nb\n");

    _ = try tb.replaceNormalizedBytes(0, 0, "start\n");
    _ = try tb.replaceNormalizedBytes(8, 8, "middle");
    _ = try tb.replaceNormalizedBytes(tb.getByteSize(), tb.getByteSize(), "tail");
    try expectText(tb, "start\na\nmiddle\nb\ntail");
    try expectMarkerInvariants(tb);

    _ = try tb.replaceNormalizedBytes(0, tb.getByteSize(), "");
    try expectText(tb, "");
    try std.testing.expectEqual(@as(u32, 1), tb.getLineCount());
    try expectMarkerInvariants(tb);
}

test "TextChunk width and splice coordinates exceed 65535 columns" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    const long_line = try std.testing.allocator.alloc(u8, 70000);
    defer std.testing.allocator.free(long_line);
    @memset(long_line, 'a');
    try tb.setText(long_line);

    try std.testing.expectEqual(@as(u32, 70000), tb.lineWidthAt(0));
    try std.testing.expectEqual(DisplayPoint{ .row = 0, .col = 69999 }, try tb.normalizedByteOffsetToDisplayPointStrict(69999));
    try std.testing.expectEqual(@as(u32, 69999), try tb.displayPointToNormalizedByteOffset(.{ .row = 0, .col = 69999 }, .before));
    _ = try tb.replaceNormalizedBytes(69999, 70000, "界");
    try std.testing.expectEqual(@as(u32, 70001), tb.lineWidthAt(0));
    try std.testing.expectEqual(@as(u32, 70002), tb.getByteSize());
}

test "splice moves internal styles and leaves external highlights caller-owned" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    const style = try syntax_style.SyntaxStyle.init(std.testing.allocator);
    defer style.deinit();
    tb.setSyntaxStyle(style);

    const styled = "styled";
    const chunks = [_]text_buffer.StyledChunk{.{
        .text_ptr = styled.ptr,
        .text_len = styled.len,
        .fg_ptr = null,
        .bg_ptr = null,
        .attributes = 1,
    }};
    try tb.setStyledText(&chunks);
    try tb.addHighlight(0, 1, 3, 99, 2, 77);
    try std.testing.expectEqual(@as(u32, 2), tb.getHighlightCount());

    _ = try tb.replaceNormalizedBytes(0, 1, "S");
    try std.testing.expectEqual(@as(u32, 2), tb.getHighlightCount());
    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(u16, 77), highlights[0].hl_ref);
    try std.testing.expect(highlights[1].internal);
}

test "annotation-only edits preserve layout epoch and project requested Unicode lines lazily" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    try tb.setText("aa\n界🙂\nzero");
    const content_epoch = tb.getContentEpoch();
    const annotation_epoch = tb.getAnnotationEpoch();

    const id = try tb.createStyleRange(41, 3, 10, 77, 3);
    try std.testing.expectEqual(content_epoch, tb.getContentEpoch());
    try std.testing.expect(tb.getAnnotationEpoch() > annotation_epoch);
    try std.testing.expectEqual(@as(usize, 0), tb.line_projection_epochs.items.len);

    const highlights = tb.getLineHighlights(1);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
    try std.testing.expectEqual(@as(u32, 0), highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 4), highlights[0].col_end);
    try std.testing.expectEqual(@as(u64, 0), tb.line_projection_epochs.items[0]);
    try std.testing.expectEqual(tb.projection_epoch, tb.line_projection_epochs.items[1]);

    _ = try tb.replaceNormalizedBytes(0, 0, "X");
    const moved = tb.textAnnotations().get(id).?.mark.range;
    try std.testing.expectEqual(@as(u32, 4), moved.start_byte);
    try std.testing.expectEqual(@as(u32, 11), moved.end_byte);
}

test "splice no-op is stable and EditBuffer cursor remains caller-owned" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const eb = try edit_buffer.EditBuffer.init(std.testing.allocator, pool, link_pool, .unicode, null);
    defer eb.deinit();
    try eb.setText("abcd");
    try eb.setCursor(0, 3);

    const tb = eb.getTextBuffer();
    const root = tb.rope().root;
    const version = tb.rope().version;
    const epoch = tb.getContentEpoch();
    const no_op = try tb.replaceNormalizedBytes(2, 2, "");
    try std.testing.expectEqual(@as(u32, 2), no_op.new_end);
    try std.testing.expect(tb.rope().root == root);
    try std.testing.expectEqual(version, tb.rope().version);
    try std.testing.expectEqual(epoch, tb.getContentEpoch());

    _ = try tb.replaceNormalizedBytes(0, 0, "XX");
    try expectText(tb, "XXabcd");
    try std.testing.expectEqual(@as(u32, 3), eb.getPrimaryCursor().col);
}

test "clearMemRegistry invalidates current and undo roots before freeing IDs" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    try tb.setText("seed");
    try tb.rope().store_undo("seed");
    _ = try tb.replaceNormalizedBytes(0, 4, "changed");
    try tb.rope().store_undo("changed");

    tb.clearMemRegistry();
    try expectText(tb, "");
    try std.testing.expectEqual(@as(usize, 0), tb.memRegistry().getUsedSlots());
    try std.testing.expect(!tb.rope().can_undo());
    try std.testing.expect(!tb.rope().can_redo());
    try expectMarkerInvariants(tb);

    try tb.setText("reused");
    _ = try tb.replaceNormalizedBytes(6, 6, "!");
    try expectText(tb, "reused!");
}

test "setStyledText releases splice backing and history before arena reset" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    try tb.setText("old");
    _ = try tb.replaceNormalizedBytes(3, 3, " splice");
    try tb.rope().store_undo("old");
    try std.testing.expectEqual(@as(usize, 1), tb.memRegistry().getUsedSlots());

    const replacement = "styled";
    const chunks = [_]text_buffer.StyledChunk{.{
        .text_ptr = replacement.ptr,
        .text_len = replacement.len,
        .fg_ptr = null,
        .bg_ptr = null,
        .attributes = 0,
    }};
    try tb.setStyledText(&chunks);
    try expectText(tb, "styled");
    try std.testing.expect(!tb.rope().can_undo());
    try std.testing.expectEqual(@as(usize, 1), tb.memRegistry().getUsedSlots());

    _ = try tb.replaceNormalizedBytes(6, 6, " again");
    try expectText(tb, "styled again");
    try std.testing.expectEqual(@as(usize, 1), tb.memRegistry().getUsedSlots());
}

test "document replacement creates stable normalized ranges and structural moves preserve IDs" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    const texts = [_][]const u8{ "A\r", "\n界", "Z" };
    var chunks: [texts.len]text_buffer.StyledChunk = undefined;
    for (texts, 0..) |text, index| chunks[index] = .{
        .text_ptr = text.ptr,
        .text_len = text.len,
        .fg_ptr = null,
        .bg_ptr = null,
        .attributes = 0,
    };
    const empty_style: text_buffer.StyledChunk = .{
        .text_ptr = "".ptr,
        .text_len = 0,
        .fg_ptr = null,
        .bg_ptr = null,
        .attributes = 0,
    };
    const ranges = [_]text_buffer.DocumentRangeInput{
        .{ .start_chunk = 0, .end_chunk = 3, .style = empty_style, .styled = true, .priority = 1 },
        .{ .start_chunk = 0, .end_chunk = 1, .style = empty_style, .styled = false, .priority = 0 },
        .{ .start_chunk = 1, .end_chunk = 2, .style = empty_style, .styled = true, .priority = 2 },
        .{ .start_chunk = 2, .end_chunk = 3, .style = empty_style, .styled = true, .priority = 2 },
    };
    var ids: [ranges.len]u64 = undefined;
    _ = try tb.replaceDocumentRange(null, .replace, 0, 0, &chunks, 77, &ranges, &ids);
    try expectText(tb, "A\n\n界Z");
    try std.testing.expectEqual(@as(u32, 2), tb.getDocumentRange(ids[2]).?.start_byte);
    try std.testing.expectEqual(@as(u32, 6), tb.getDocumentRange(ids[2]).?.end_byte);

    const before_edit_epoch = tb.getContentEpoch();
    const replacement = [_]text_buffer.StyledChunk{.{
        .text_ptr = "🙂".ptr,
        .text_len = "🙂".len,
        .fg_ptr = null,
        .bg_ptr = null,
        .attributes = 0,
    }};
    var no_ids: [0]u64 = .{};
    _ = try tb.replaceDocumentRange(ids[2], .replace, 0, 0, &replacement, 77, &.{}, &no_ids);
    try expectText(tb, "A\n🙂Z");
    try std.testing.expectEqual(ids[2], tb.getDocumentRange(ids[2]).?.id);
    try std.testing.expect(tb.getContentEpoch() > before_edit_epoch);

    try std.testing.expect(try tb.moveDocumentRange(ids[3], ids[1], true));
    try expectText(tb, "ZA\n🙂");
    try std.testing.expectEqual(@as(u32, 0), tb.getDocumentRange(ids[3]).?.start_byte);
    try std.testing.expectEqual(ids[2], tb.getDocumentRange(ids[2]).?.id);
}

fn exerciseDocumentRangeTransactionFailure(fail_offset: ?usize) !usize {
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    const allocator = failing.allocator();
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const tb = try TextBuffer.init(allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    const syntax = try syntax_style.SyntaxStyle.init(allocator);
    defer syntax.deinit();
    tb.setSyntaxStyle(syntax);

    const empty_style: text_buffer.StyledChunk = .{
        .text_ptr = "".ptr,
        .text_len = 0,
        .fg_ptr = null,
        .bg_ptr = null,
        .attributes = 0,
    };
    const initial_text = "left middle right";
    const initial_chunks = [_]text_buffer.StyledChunk{.{
        .text_ptr = initial_text.ptr,
        .text_len = initial_text.len,
        .fg_ptr = null,
        .bg_ptr = null,
        .attributes = 0,
    }};
    const initial_ranges = [_]text_buffer.DocumentRangeInput{
        .{ .start_chunk = 0, .end_chunk = 1, .style = empty_style, .styled = true, .priority = 1 },
        .{ .start_chunk = 0, .end_chunk = 1, .style = empty_style, .styled = true, .priority = 2 },
    };
    var ids: [2]u64 = undefined;
    _ = try tb.replaceDocumentRange(null, .replace, 0, 0, &initial_chunks, 91, &initial_ranges, &ids);

    const replacement_text = "中🙂";
    const replacement = [_]text_buffer.StyledChunk{.{
        .text_ptr = replacement_text.ptr,
        .text_len = replacement_text.len,
        .fg_ptr = null,
        .bg_ptr = null,
        .attributes = 4,
    }};
    const replacement_ranges = [_]text_buffer.DocumentRangeInput{.{
        .id = ids[1],
        .start_chunk = 0,
        .end_chunk = 1,
        .style = replacement[0],
        .styled = true,
        .priority = 2,
    }};
    const second_text = "final";
    const second_url = "https://second.test";
    const second = [_]text_buffer.StyledChunk{.{
        .text_ptr = second_text.ptr,
        .text_len = second_text.len,
        .fg_ptr = null,
        .bg_ptr = null,
        .attributes = 8,
        .link_ptr = second_url.ptr,
        .link_len = second_url.len,
    }};
    const second_ranges = [_]text_buffer.DocumentRangeInput{.{
        .id = ids[1],
        .start_chunk = 0,
        .end_chunk = 1,
        .style = second[0],
        .styled = true,
        .priority = 2,
    }};
    const final_url = "https://final.test";
    const final_style: text_buffer.StyledChunk = .{
        .text_ptr = "".ptr,
        .text_len = 0,
        .fg_ptr = null,
        .bg_ptr = null,
        .attributes = 16,
        .link_ptr = final_url.ptr,
        .link_len = final_url.len,
    };
    var output_ids: [2]u64 = undefined;
    const before_root = tb.rope().root;
    const before_epoch = tb.getContentEpoch();
    const before_annotation_epoch = tb.getAnnotationEpoch();
    const before_count = tb.textAnnotations().count();
    const before_root_range = tb.getDocumentRange(ids[0]).?;
    const before_child_range = tb.getDocumentRange(ids[1]).?;
    const before_splice_len = tb.splice_len;
    const before_arenas = tb.rope_transaction_arenas.items.len;
    const before_registry_slots = tb.memRegistry().getUsedSlots();
    const before_internal_slots = tb.internal_style_slots.items.len;
    var before_refs: u32 = 0;
    for (tb.internal_style_slots.items) |slot| before_refs += slot.refs;
    _ = tb.getLineHighlights(0);
    const before_anonymous = syntax.getAnonymousStyleCount();
    const before_links = link_pool.getLiveSlotCount();
    const before_alloc = failing.alloc_index;
    if (fail_offset) |offset| failing.fail_index = before_alloc + offset;

    const operations = [_]text_buffer.DocumentOperation{
        .{
            .kind = .replace,
            .target_id = ids[1],
            .owner = 91,
            .chunks = &replacement,
            .ranges = &replacement_ranges,
        },
        .{
            .kind = .replace,
            .target_id = ids[1],
            .owner = 91,
            .chunks = &second,
            .ranges = &second_ranges,
        },
        .{ .kind = .update_style, .target_id = ids[1], .owner = 91, .style = final_style },
    };
    const transaction = tb.applyDocumentOperations(&operations, &output_ids);
    if (fail_offset != null) {
        try std.testing.expectError(error.OutOfMemory, transaction);
        try std.testing.expect(tb.rope().root == before_root);
        try std.testing.expectEqual(before_epoch, tb.getContentEpoch());
        try std.testing.expectEqual(before_annotation_epoch, tb.getAnnotationEpoch());
        try std.testing.expectEqual(before_count, tb.textAnnotations().count());
        try std.testing.expectEqualDeep(before_root_range, tb.getDocumentRange(ids[0]).?);
        try std.testing.expectEqualDeep(before_child_range, tb.getDocumentRange(ids[1]).?);
        try std.testing.expectEqual(before_splice_len, tb.splice_len);
        try std.testing.expectEqual(before_arenas, tb.rope_transaction_arenas.items.len);
        try std.testing.expectEqual(before_registry_slots, tb.memRegistry().getUsedSlots());
        try std.testing.expectEqual(before_internal_slots, tb.internal_style_slots.items.len);
        var after_refs: u32 = 0;
        for (tb.internal_style_slots.items) |slot| after_refs += slot.refs;
        try std.testing.expectEqual(before_refs, after_refs);
        try std.testing.expectEqual(before_anonymous, syntax.getAnonymousStyleCount());
        try std.testing.expectEqual(before_links, link_pool.getLiveSlotCount());
        try expectText(tb, initial_text);
    } else {
        _ = try transaction;
        try expectText(tb, second_text);
        try std.testing.expectEqualSlices(u64, &.{ ids[1], ids[1] }, &output_ids);
    }
    return failing.alloc_index - before_alloc;
}

test "document operation batch resolves shifted stable IDs and publishes once" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    const empty_style: text_buffer.StyledChunk = .{
        .text_ptr = "".ptr,
        .text_len = 0,
        .fg_ptr = null,
        .bg_ptr = null,
        .attributes = 0,
    };
    const initial = [_]text_buffer.StyledChunk{
        .{ .text_ptr = "one".ptr, .text_len = 3, .fg_ptr = null, .bg_ptr = null, .attributes = 0 },
        .{ .text_ptr = "two".ptr, .text_len = 3, .fg_ptr = null, .bg_ptr = null, .attributes = 0 },
    };
    const initial_ranges = [_]text_buffer.DocumentRangeInput{
        .{ .start_chunk = 0, .end_chunk = 2, .style = empty_style, .styled = true, .priority = 1 },
        .{ .start_chunk = 0, .end_chunk = 1, .style = empty_style, .styled = false, .priority = 1 },
        .{ .start_chunk = 1, .end_chunk = 2, .style = empty_style, .styled = false, .priority = 1 },
    };
    var ids: [3]u64 = undefined;
    try tb.applyDocumentOperations(&.{.{
        .kind = .replace,
        .use_target = false,
        .owner = 44,
        .chunks = &initial,
        .ranges = &initial_ranges,
    }}, &ids);

    const before_content_epoch = tb.getContentEpoch();
    const before_annotation_epoch = tb.getAnnotationEpoch();
    const first = [_]text_buffer.StyledChunk{.{ .text_ptr = "FIRST".ptr, .text_len = 5, .fg_ptr = null, .bg_ptr = null, .attributes = 0 }};
    const second = [_]text_buffer.StyledChunk{.{ .text_ptr = "SECOND".ptr, .text_len = 6, .fg_ptr = null, .bg_ptr = null, .attributes = 0 }};
    const operations = [_]text_buffer.DocumentOperation{
        .{ .kind = .replace, .target_id = ids[1], .owner = 44, .chunks = &first },
        .{ .kind = .replace, .target_id = ids[2], .owner = 44, .chunks = &second },
    };
    var no_ids: [0]u64 = .{};
    try tb.applyDocumentOperations(&operations, &no_ids);

    try expectText(tb, "FIRSTSECOND");
    try std.testing.expectEqual(before_content_epoch +% 1, tb.getContentEpoch());
    try std.testing.expectEqual(before_annotation_epoch +% 1, tb.getAnnotationEpoch());
    try std.testing.expectEqual(@as(u32, 0), tb.getDocumentRange(ids[1]).?.start_byte);
    try std.testing.expectEqual(@as(u32, 5), tb.getDocumentRange(ids[1]).?.end_byte);
    try std.testing.expectEqual(@as(u32, 5), tb.getDocumentRange(ids[2]).?.start_byte);
    try std.testing.expectEqual(@as(u32, 11), tb.getDocumentRange(ids[2]).?.end_byte);
}

test "document transactions compact Rope generations while preserving stable ranges" {
    var tracked = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const tb = try TextBuffer.init(tracked.allocator(), pool, link_pool, .unicode);
    var tb_owned = true;
    defer if (tb_owned) tb.deinit();
    const view_id = try tb.registerView();

    const initial_chunks = [_]text_buffer.StyledChunk{
        .{ .text_ptr = "L".ptr, .text_len = 1, .fg_ptr = null, .bg_ptr = null, .attributes = 0 },
        .{ .text_ptr = "alpha\r\n🙂".ptr, .text_len = "alpha\r\n🙂".len, .fg_ptr = null, .bg_ptr = null, .attributes = 0 },
        .{ .text_ptr = "R".ptr, .text_len = 1, .fg_ptr = null, .bg_ptr = null, .attributes = 0 },
    };
    const empty_style: text_buffer.StyledChunk = .{
        .text_ptr = "".ptr,
        .text_len = 0,
        .fg_ptr = null,
        .bg_ptr = null,
        .attributes = 0,
    };
    const initial_ranges = [_]text_buffer.DocumentRangeInput{
        .{ .start_chunk = 0, .end_chunk = 1, .style = empty_style, .styled = false, .priority = 0 },
        .{ .start_chunk = 1, .end_chunk = 2, .style = empty_style, .styled = true, .priority = 2 },
        .{ .start_chunk = 2, .end_chunk = 3, .style = empty_style, .styled = false, .priority = 0 },
    };
    var ids: [3]u64 = undefined;
    try tb.applyDocumentOperations(&.{.{
        .kind = .replace,
        .use_target = false,
        .owner = 70,
        .chunks = &initial_chunks,
        .ranges = &initial_ranges,
    }}, &ids);
    const initial_epoch = tb.getContentEpoch();
    const initial_annotation_epoch = tb.getAnnotationEpoch();
    const initial_active_allocations = tracked.allocations - tracked.deallocations;
    const replacements = [_][]const u8{ "alpha\r\n🙂", "中", "é\rZ", "wide界🙂" };
    const normalized = [_][]const u8{ "alpha\n🙂", "中", "é\nZ", "wide界🙂" };

    for (0..4000) |index| {
        const replacement = replacements[index % replacements.len];
        const chunk = text_buffer.StyledChunk{
            .text_ptr = replacement.ptr,
            .text_len = replacement.len,
            .fg_ptr = null,
            .bg_ptr = null,
            .attributes = @intCast(index & 3),
        };
        var operations = [_]text_buffer.DocumentOperation{
            .{ .kind = .replace, .target_id = ids[1], .owner = 70, .chunks = &.{chunk} },
            .{ .kind = .update_style, .target_id = ids[1], .owner = 70, .style = chunk },
            .{ .kind = .move, .target_id = ids[1], .anchor_id = if ((index / 50) % 2 == 0) ids[0] else ids[2], .owner = 70, .before = (index / 50) % 2 == 0 },
        };
        const operation_count: usize = if (index % 50 == 0) operations.len else operations.len - 1;
        try tb.applyDocumentOperations(operations[0..operation_count], &.{});
        try std.testing.expect(tb.getRopeTransactionArenaCount() <= TextBuffer.rope_compaction_arena_limit);
        try std.testing.expect(tb.getRopeTransactionArenaBytes() < TextBuffer.rope_compaction_byte_limit);
        try std.testing.expect(tracked.allocations - tracked.deallocations <= initial_active_allocations + 256);
        if (index % 97 == 0) {
            try std.testing.expect(tb.isViewDirty(view_id));
            tb.clearViewDirty(view_id);
            try std.testing.expectEqual(ids[1], tb.getDocumentRange(ids[1]).?.id);
            const target = tb.getDocumentRange(ids[1]).?;
            const output = try std.testing.allocator.alloc(u8, target.end_byte - target.start_byte);
            defer std.testing.allocator.free(output);
            const written = tb.getDocumentRangeText(ids[1], output).?;
            try std.testing.expectEqualStrings(normalized[index % normalized.len], output[0..written]);
            try expectMarkerInvariants(tb);
        }
    }
    try std.testing.expectEqual(initial_epoch + 4000, tb.getContentEpoch());
    try std.testing.expectEqual(initial_annotation_epoch + 4000, tb.getAnnotationEpoch());
    tb.unregisterView(view_id);
    tb.deinit();
    tb_owned = false;
    try std.testing.expectEqual(tracked.allocations, tracked.deallocations);
}

test "Rope compaction defers for EditBuffer history then reclaims after history clear" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    try tb.setText("0");

    for (1..TextBuffer.rope_compaction_arena_limit + 4) |index| {
        var value: [16]u8 = undefined;
        const replacement = try std.fmt.bufPrint(&value, "{d}", .{index});
        try tb.rope().store_undo(replacement);
        _ = try tb.replaceNormalizedBytes(0, tb.getByteSize(), replacement);
    }
    try std.testing.expect(tb.getRopeTransactionArenaCount() > TextBuffer.rope_compaction_arena_limit);
    _ = try tb.rope().undo("current");
    try expectText(tb, "34");

    tb.rope().clear_history();
    _ = try tb.replaceNormalizedBytes(0, tb.getByteSize(), "compacted");
    try expectText(tb, "compacted");
    try std.testing.expect(tb.getRopeTransactionArenaCount() <= 2);
}

fn exerciseDocumentCompactionFailure(fail_offset: ?usize) !usize {
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    const allocator = failing.allocator();
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const tb = try TextBuffer.init(allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    const view_id = try tb.registerView();
    defer tb.unregisterView(view_id);
    const empty_style: text_buffer.StyledChunk = .{ .text_ptr = "".ptr, .text_len = 0, .fg_ptr = null, .bg_ptr = null, .attributes = 0 };
    const initial_chunk: text_buffer.StyledChunk = .{ .text_ptr = "seed🙂".ptr, .text_len = "seed🙂".len, .fg_ptr = null, .bg_ptr = null, .attributes = 0 };
    const initial_range = [_]text_buffer.DocumentRangeInput{.{
        .start_chunk = 0,
        .end_chunk = 1,
        .style = empty_style,
        .styled = true,
        .priority = 1,
    }};
    var ids: [1]u64 = undefined;
    try tb.applyDocumentOperations(&.{.{
        .kind = .replace,
        .use_target = false,
        .owner = 81,
        .chunks = &.{initial_chunk},
        .ranges = &initial_range,
    }}, &ids);
    for (1..TextBuffer.rope_compaction_arena_limit) |index| {
        const text = if (index % 2 == 0) "seed🙂" else "seed\r\n界";
        const chunk: text_buffer.StyledChunk = .{ .text_ptr = text.ptr, .text_len = text.len, .fg_ptr = null, .bg_ptr = null, .attributes = 0 };
        try tb.applyDocumentOperations(&.{.{ .kind = .replace, .target_id = ids[0], .owner = 81, .chunks = &.{chunk} }}, &.{});
    }
    try std.testing.expectEqual(TextBuffer.rope_compaction_arena_limit, tb.getRopeTransactionArenaCount());
    const before_range = tb.getDocumentRange(ids[0]).?;
    const before_epoch = tb.getContentEpoch();
    const before_annotation_epoch = tb.getAnnotationEpoch();
    tb.clearViewDirty(view_id);
    var before_text: [32]u8 = undefined;
    const before_written = tb.getPlainTextIntoBuffer(&before_text);
    const before_alloc = failing.alloc_index;
    if (fail_offset) |offset| failing.fail_index = before_alloc + offset;

    const replacement: text_buffer.StyledChunk = .{ .text_ptr = "retry中🙂".ptr, .text_len = "retry中🙂".len, .fg_ptr = null, .bg_ptr = null, .attributes = 0 };
    const edit = tb.applyDocumentOperations(&.{.{ .kind = .replace, .target_id = ids[0], .owner = 81, .chunks = &.{replacement} }}, &.{});
    if (fail_offset != null) {
        try std.testing.expectError(error.OutOfMemory, edit);
        try std.testing.expectEqual(before_epoch, tb.getContentEpoch());
        try std.testing.expectEqual(before_annotation_epoch, tb.getAnnotationEpoch());
        try std.testing.expectEqualDeep(before_range, tb.getDocumentRange(ids[0]).?);
        if (tb.getRopeTransactionArenaCount() < TextBuffer.rope_compaction_arena_limit) {
            try std.testing.expect(tb.isViewDirty(view_id));
        }
        var after_text: [32]u8 = undefined;
        const after_written = tb.getPlainTextIntoBuffer(&after_text);
        try std.testing.expectEqualStrings(before_text[0..before_written], after_text[0..after_written]);

        failing.fail_index = std.math.maxInt(usize);
        try tb.applyDocumentOperations(&.{.{ .kind = .replace, .target_id = ids[0], .owner = 81, .chunks = &.{replacement} }}, &.{});
    } else {
        try edit;
    }
    try expectText(tb, "retry中🙂");
    try std.testing.expect(tb.getRopeTransactionArenaCount() <= 2);
    return failing.alloc_index - before_alloc;
}

test "document compaction OOM is semantic-atomic and retryable at every allocation" {
    const allocations = try exerciseDocumentCompactionFailure(null);
    for (0..allocations) |offset| _ = try exerciseDocumentCompactionFailure(offset);
}

test "document range transaction rolls back every allocation failure" {
    const allocations = try exerciseDocumentRangeTransactionFailure(null);
    for (0..allocations) |offset| _ = try exerciseDocumentRangeTransactionFailure(offset);
}

test "zero-length document moves are exact no-ops among co-located ranges" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    const empty_style: text_buffer.StyledChunk = .{
        .text_ptr = "".ptr,
        .text_len = 0,
        .fg_ptr = null,
        .bg_ptr = null,
        .attributes = 0,
    };
    const chunks = [_]text_buffer.StyledChunk{
        .{ .text_ptr = "A".ptr, .text_len = 1, .fg_ptr = null, .bg_ptr = null, .attributes = 0 },
        .{ .text_ptr = "".ptr, .text_len = 0, .fg_ptr = null, .bg_ptr = null, .attributes = 0 },
        .{ .text_ptr = "B".ptr, .text_len = 1, .fg_ptr = null, .bg_ptr = null, .attributes = 0 },
    };
    const ranges = [_]text_buffer.DocumentRangeInput{
        .{ .start_chunk = 0, .end_chunk = 3, .style = empty_style, .styled = true, .priority = 1 },
        .{ .start_chunk = 1, .end_chunk = 1, .style = empty_style, .styled = false, .priority = 2 },
        .{ .start_chunk = 1, .end_chunk = 1, .style = empty_style, .styled = true, .priority = 3 },
        .{ .start_chunk = 1, .end_chunk = 1, .style = empty_style, .styled = false, .priority = 4 },
    };
    var ids: [ranges.len]u64 = undefined;
    try tb.applyDocumentOperations(&.{.{
        .kind = .replace,
        .use_target = false,
        .owner = 55,
        .chunks = &chunks,
        .ranges = &ranges,
    }}, &ids);

    const root_before = tb.rope().root;
    const content_epoch = tb.getContentEpoch();
    const annotation_epoch = tb.getAnnotationEpoch();
    var before: [3]TextAnnotations.Annotation = undefined;
    for (ids[1..], 0..) |id, index| before[index] = tb.textAnnotations().get(id).?;
    var no_ids: [0]u64 = .{};
    try tb.applyDocumentOperations(&.{
        .{ .kind = .move, .target_id = ids[1], .anchor_id = ids[3], .owner = 55, .before = false },
        .{ .kind = .move, .target_id = ids[2], .anchor_id = ids[2], .owner = 55, .before = true },
        .{ .kind = .move, .target_id = ids[3], .anchor_id = ids[1], .owner = 55, .before = true },
    }, &no_ids);

    try expectText(tb, "AB");
    try std.testing.expect(tb.rope().root == root_before);
    try std.testing.expectEqual(content_epoch, tb.getContentEpoch());
    try std.testing.expectEqual(annotation_epoch, tb.getAnnotationEpoch());
    for (ids[1..], 0..) |id, index| try std.testing.expectEqualDeep(before[index], tb.textAnnotations().get(id).?);
}

test "document operation candidate releases every intermediate style and link" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    const style = try syntax_style.SyntaxStyle.init(std.testing.allocator);
    defer style.deinit();
    tb.setSyntaxStyle(style);

    const urls = [_][]const u8{ "https://a.test", "https://b.test", "https://c.test" };
    var values: [3]text_buffer.StyledChunk = undefined;
    for (&values, urls, 0..) |*value, url, index| value.* = .{
        .text_ptr = "".ptr,
        .text_len = 0,
        .fg_ptr = null,
        .bg_ptr = null,
        .attributes = @intCast(index + 1),
        .link_ptr = url.ptr,
        .link_len = url.len,
    };
    const text = [_]text_buffer.StyledChunk{.{
        .text_ptr = "x".ptr,
        .text_len = 1,
        .fg_ptr = null,
        .bg_ptr = null,
        .attributes = 0,
    }};
    const initial_ranges = [_]text_buffer.DocumentRangeInput{.{
        .start_chunk = 0,
        .end_chunk = 1,
        .style = values[0],
        .styled = true,
        .priority = 1,
    }};
    var ids: [1]u64 = undefined;
    try tb.applyDocumentOperations(&.{.{
        .kind = .replace,
        .use_target = false,
        .owner = 66,
        .chunks = &text,
        .ranges = &initial_ranges,
    }}, &ids);

    var no_ids: [0]u64 = .{};
    try tb.applyDocumentOperations(&.{
        .{ .kind = .update_style, .target_id = ids[0], .owner = 66, .style = values[1] },
        .{ .kind = .update_style, .target_id = ids[0], .owner = 66, .style = values[2] },
    }, &no_ids);
    var live_refs: u32 = 0;
    for (tb.internal_style_slots.items) |slot| live_refs += slot.refs;
    try std.testing.expectEqual(@as(u32, 1), live_refs);
    _ = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), style.getAnonymousStyleCount());
    try std.testing.expectEqual(@as(u64, 1), link_pool.getLiveSlotCount());

    try tb.applyDocumentOperations(&.{.{ .kind = .clear_owner, .owner = 66 }}, &no_ids);
    live_refs = 0;
    for (tb.internal_style_slots.items) |slot| live_refs += slot.refs;
    try std.testing.expectEqual(@as(u32, 0), live_refs);
    try std.testing.expectEqual(@as(usize, 0), style.getAnonymousStyleCount());
    try std.testing.expectEqual(@as(u64, 0), link_pool.getLiveSlotCount());
}

fn exerciseTwoDocumentTransferFailure(fail_offset: ?usize) !usize {
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    const allocator = failing.allocator();
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const source = try TextBuffer.init(allocator, pool, link_pool, .unicode);
    defer source.deinit();
    const destination = try TextBuffer.init(allocator, pool, link_pool, .unicode);
    defer destination.deinit();
    const source_style = try syntax_style.SyntaxStyle.init(allocator);
    defer source_style.deinit();
    const destination_style = try syntax_style.SyntaxStyle.init(allocator);
    defer destination_style.deinit();
    source.setSyntaxStyle(source_style);
    destination.setSyntaxStyle(destination_style);

    const url = "https://transfer.test";
    const value: text_buffer.StyledChunk = .{
        .text_ptr = "".ptr,
        .text_len = 0,
        .fg_ptr = null,
        .bg_ptr = null,
        .attributes = 1,
        .link_ptr = url.ptr,
        .link_len = url.len,
    };
    const empty_style: text_buffer.StyledChunk = .{
        .text_ptr = "".ptr,
        .text_len = 0,
        .fg_ptr = null,
        .bg_ptr = null,
        .attributes = 0,
    };
    const source_chunks = [_]text_buffer.StyledChunk{
        .{ .text_ptr = "L".ptr, .text_len = 1, .fg_ptr = null, .bg_ptr = null, .attributes = 0 },
        .{ .text_ptr = "X".ptr, .text_len = 1, .fg_ptr = null, .bg_ptr = null, .attributes = 0 },
    };
    const source_ranges = [_]text_buffer.DocumentRangeInput{
        .{ .start_chunk = 0, .end_chunk = 2, .style = empty_style, .styled = false, .priority = 1 },
        .{ .start_chunk = 1, .end_chunk = 2, .style = value, .styled = true, .priority = 2 },
    };
    var source_ids: [2]u64 = undefined;
    try source.applyDocumentOperations(&.{.{
        .kind = .replace,
        .use_target = false,
        .owner = 71,
        .chunks = &source_chunks,
        .ranges = &source_ranges,
    }}, &source_ids);
    const destination_chunks = [_]text_buffer.StyledChunk{.{
        .text_ptr = "R".ptr,
        .text_len = 1,
        .fg_ptr = null,
        .bg_ptr = null,
        .attributes = 0,
    }};
    const destination_ranges = [_]text_buffer.DocumentRangeInput{.{
        .start_chunk = 0,
        .end_chunk = 1,
        .style = empty_style,
        .styled = false,
        .priority = 1,
    }};
    var destination_ids: [1]u64 = undefined;
    try destination.applyDocumentOperations(&.{.{
        .kind = .replace,
        .use_target = false,
        .owner = 72,
        .chunks = &destination_chunks,
        .ranges = &destination_ranges,
    }}, &destination_ids);
    _ = source.getLineHighlights(0);

    const source_transfer_ranges = [_]text_buffer.DocumentRangeInput{.{
        .id = source_ids[1],
        .remove = true,
        .start_chunk = 0,
        .end_chunk = 0,
        .style = empty_style,
        .styled = false,
        .priority = 0,
    }};
    const destination_transfer_chunks = [_]text_buffer.StyledChunk{
        .{ .text_ptr = "R".ptr, .text_len = 1, .fg_ptr = null, .bg_ptr = null, .attributes = 0 },
        .{ .text_ptr = "X".ptr, .text_len = 1, .fg_ptr = null, .bg_ptr = null, .attributes = 0 },
    };
    const destination_transfer_ranges = [_]text_buffer.DocumentRangeInput{
        .{ .id = destination_ids[0], .start_chunk = 0, .end_chunk = 2, .style = empty_style, .styled = false, .priority = 1 },
        .{ .start_chunk = 1, .end_chunk = 2, .style = value, .styled = true, .priority = 2 },
    };
    const source_operations = [_]text_buffer.DocumentOperation{.{
        .kind = .replace,
        .target_id = source_ids[1],
        .owner = 71,
        .ranges = &source_transfer_ranges,
    }};
    const destination_operations = [_]text_buffer.DocumentOperation{.{
        .kind = .replace,
        .target_id = destination_ids[0],
        .owner = 72,
        .chunks = &destination_transfer_chunks,
        .ranges = &destination_transfer_ranges,
    }};

    const source_root = source.rope().root;
    const destination_root = destination.rope().root;
    const source_epoch = source.getContentEpoch();
    const destination_epoch = destination.getContentEpoch();
    const source_annotation_epoch = source.getAnnotationEpoch();
    const destination_annotation_epoch = destination.getAnnotationEpoch();
    const source_range = source.getDocumentRange(source_ids[1]).?;
    const destination_range = destination.getDocumentRange(destination_ids[0]).?;
    const source_refs = source.internal_style_slots.items[0].refs;
    const source_anonymous = source_style.getAnonymousStyleCount();
    const destination_anonymous = destination_style.getAnonymousStyleCount();
    const live_links = link_pool.getLiveSlotCount();
    var source_output = [_]u64{std.math.maxInt(u64)};
    var destination_output = [_]u64{std.math.maxInt(u64)} ** 2;
    const before_alloc = failing.alloc_index;
    if (fail_offset) |offset| failing.fail_index = before_alloc + offset;

    const transfer = text_buffer.applyTwoDocumentOperations(
        source,
        &source_operations,
        &source_output,
        destination,
        &destination_operations,
        &destination_output,
    );
    if (fail_offset != null) {
        try std.testing.expectError(error.OutOfMemory, transfer);
        try std.testing.expect(source.rope().root == source_root);
        try std.testing.expect(destination.rope().root == destination_root);
        try std.testing.expectEqual(source_epoch, source.getContentEpoch());
        try std.testing.expectEqual(destination_epoch, destination.getContentEpoch());
        try std.testing.expectEqual(source_annotation_epoch, source.getAnnotationEpoch());
        try std.testing.expectEqual(destination_annotation_epoch, destination.getAnnotationEpoch());
        try std.testing.expectEqualDeep(source_range, source.getDocumentRange(source_ids[1]).?);
        try std.testing.expectEqualDeep(destination_range, destination.getDocumentRange(destination_ids[0]).?);
        try std.testing.expectEqual(source_refs, source.internal_style_slots.items[0].refs);
        try std.testing.expectEqual(source_anonymous, source_style.getAnonymousStyleCount());
        try std.testing.expectEqual(destination_anonymous, destination_style.getAnonymousStyleCount());
        try std.testing.expectEqual(live_links, link_pool.getLiveSlotCount());
        try std.testing.expectEqualSlices(u64, &.{std.math.maxInt(u64)}, &source_output);
        try std.testing.expectEqualSlices(u64, &.{ std.math.maxInt(u64), std.math.maxInt(u64) }, &destination_output);
        try expectText(source, "LX");
        try expectText(destination, "R");
    } else {
        try transfer;
        try expectText(source, "L");
        try expectText(destination, "RX");
        try std.testing.expectEqual(source_ids[1], source_output[0]);
        try std.testing.expectEqual(destination_ids[0], destination_output[0]);
        try std.testing.expect(destination_output[1] != source_ids[1]);
    }
    return failing.alloc_index - before_alloc;
}

test "two-document transfer publishes both candidates or neither at every allocation" {
    const allocations = try exerciseTwoDocumentTransferFailure(null);
    for (0..allocations) |offset| _ = try exerciseTwoDocumentTransferFailure(offset);
}

test "splice backing survives undo roots and reset releases it" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    try tb.setText("before");
    try tb.rope().store_undo("before");
    _ = try tb.replaceNormalizedBytes(0, 6, "after");
    _ = try tb.rope().undo("after");
    try expectText(tb, "before");
    _ = try tb.rope().redo();
    try expectText(tb, "after");

    tb.reset();
    try std.testing.expectEqual(@as(usize, 0), tb.memRegistry().getUsedSlots());
    try std.testing.expect(!tb.rope().can_undo());
    _ = try tb.replaceNormalizedBytes(0, 0, "reused");
    try expectText(tb, "reused");
    try std.testing.expectEqual(@as(usize, 1), tb.memRegistry().getUsedSlots());
}

fn exerciseMetricRopeFailure(fail_offset: ?usize) !usize {
    var storage: [128 * 1024]u8 = undefined;
    var fixed = std.heap.FixedBufferAllocator.init(&storage);
    var failing = std.testing.FailingAllocator.init(fixed.allocator(), .{});
    const allocator = failing.allocator();
    var rope = try MetricTestRope.from_slice(allocator, &.{
        .{ .marker = {} },
        .{ .text = 2 },
        .{ .marker = {} },
        .{ .text = 4 },
        .{ .marker = {} },
    });
    const splitter: MetricTestRope.Node.MetricSplitFn = .{
        .metricFn = metricTestValue,
        .splitFn = splitMetricTestItem,
    };
    const root = rope.root;
    const version = rope.version;
    const before_alloc = failing.alloc_index;
    if (fail_offset) |offset| failing.fail_index = before_alloc + offset;

    const prepared = rope.prepareReplaceRangeByMetric(0, 6, &.{MetricTestItem{ .text = 3 }}, &splitter);
    if (fail_offset != null) {
        try std.testing.expectError(error.OutOfMemory, prepared);
        try std.testing.expect(rope.root == root);
        try std.testing.expectEqual(version, rope.version);

        failing.fail_index = std.math.maxInt(usize);
        const retry = try rope.prepareReplaceRangeByMetric(0, 6, &.{MetricTestItem{ .text = 3 }}, &splitter);
        rope.commitPreparedRoot(retry);
        try std.testing.expectEqual(version + 1, rope.version);
        try std.testing.expect(rope.get(0).?.* == .marker);
    } else {
        const success = try prepared;
        rope.commitPreparedRoot(success);
    }
    return failing.alloc_index - before_alloc;
}

test "metric Rope prepare commit is atomic at every direct allocator failure" {
    const allocations = try exerciseMetricRopeFailure(null);
    for (0..allocations) |offset| _ = try exerciseMetricRopeFailure(offset);
}

fn exerciseSpliceFailure(fail_offset: ?usize, growth: bool) !usize {
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    const allocator = failing.allocator();
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const tb = try TextBuffer.init(allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    try tb.setText("left\nA\u{fe0f}\nright");
    if (growth) {
        _ = try tb.replaceNormalizedBytes(0, 0, "seed");
    }

    const before_root = tb.rope().root;
    const before_version = tb.rope().version;
    const before_epoch = tb.getContentEpoch();
    const before_slots = tb.memRegistry().getUsedSlots();
    const before_alloc = failing.alloc_index;
    const replacement = if (growth) ([_]u8{'x'} ** 5000)[0..] else "one\r\ntwo\nthree";
    if (fail_offset) |offset| failing.fail_index = before_alloc + offset;

    const splice = tb.replaceNormalizedBytes(1, 10, replacement);
    if (fail_offset != null) {
        try std.testing.expectError(error.OutOfMemory, splice);
        try std.testing.expect(tb.rope().root == before_root);
        try std.testing.expectEqual(before_version, tb.rope().version);
        try std.testing.expectEqual(before_epoch, tb.getContentEpoch());
        try std.testing.expectEqual(before_slots, tb.memRegistry().getUsedSlots());
        try expectText(tb, if (growth) "seedleft\nA\u{fe0f}\nright" else "left\nA\u{fe0f}\nright");

        failing.fail_index = std.math.maxInt(usize);
        _ = try tb.replaceNormalizedBytes(1, 10, replacement);
        try expectMarkerInvariants(tb);
    } else {
        _ = try splice;
    }
    return failing.alloc_index - before_alloc;
}

test "splice allocation failures preserve logical state and permit reuse" {
    const initial_allocations = try exerciseSpliceFailure(null, false);
    for (0..initial_allocations) |offset| _ = try exerciseSpliceFailure(offset, false);

    const growth_allocations = try exerciseSpliceFailure(null, true);
    for (0..growth_allocations) |offset| _ = try exerciseSpliceFailure(offset, true);
}

fn exerciseStyledTransactionFailure(fail_offset: ?usize) !usize {
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    const allocator = failing.allocator();
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const tb = try TextBuffer.init(allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    const style = try syntax_style.SyntaxStyle.init(allocator);
    defer style.deinit();
    tb.setSyntaxStyle(style);
    try tb.setText("left middle right");
    const urls = [_][]const u8{ "https://one.test", "https://two.test", "https://three.test" };
    var original_ids: [3]u64 = undefined;
    for (&original_ids, urls, 0..) |*id, url, index| {
        const value: text_buffer.StyledChunk = .{
            .text_ptr = "".ptr,
            .text_len = 0,
            .fg_ptr = null,
            .bg_ptr = null,
            .attributes = @intCast(index + 2),
            .link_ptr = url.ptr,
            .link_len = url.len,
        };
        id.* = try tb.createStyleValueRange(9, @intCast(index), @intCast(16 - index), value, @intCast(index + 3));
    }
    try std.testing.expectEqual(@as(usize, 3), tb.getLineHighlights(0).len);
    const replacement = "中🙂";
    const chunks = [_]text_buffer.StyledChunk{.{
        .text_ptr = replacement.ptr,
        .text_len = replacement.len,
        .fg_ptr = null,
        .bg_ptr = null,
        .attributes = 1,
    }};
    const before_root = tb.rope().root;
    const before_epoch = tb.getContentEpoch();
    const before_annotation_epoch = tb.getAnnotationEpoch();
    const before_annotations = tb.textAnnotations().count();
    const before_position_generation = tb.textAnnotations().positionGeneration();
    const before_anonymous = style.getAnonymousStyleCount();
    const before_links = link_pool.getLiveSlotCount();
    var before_values: [3]TextAnnotations.Annotation = undefined;
    var before_refs: [3]u32 = undefined;
    for (original_ids, 0..) |id, index| {
        before_values[index] = tb.textAnnotations().get(id).?;
        before_refs[index] = tb.internal_style_slots.items[index].refs;
    }
    const before_alloc = failing.alloc_index;
    if (fail_offset) |offset| failing.fail_index = before_alloc + offset;

    const transaction = tb.replaceStyledRangeBytes(5, 11, &chunks, 9);
    if (fail_offset != null) {
        try std.testing.expectError(error.OutOfMemory, transaction);
        try std.testing.expect(tb.rope().root == before_root);
        try std.testing.expectEqual(before_epoch, tb.getContentEpoch());
        try std.testing.expectEqual(before_annotation_epoch, tb.getAnnotationEpoch());
        try std.testing.expectEqual(before_annotations, tb.textAnnotations().count());
        try std.testing.expectEqual(before_position_generation, tb.textAnnotations().positionGeneration());
        try std.testing.expectEqual(before_anonymous, style.getAnonymousStyleCount());
        try std.testing.expectEqual(before_links, link_pool.getLiveSlotCount());
        for (original_ids, 0..) |id, index| {
            try std.testing.expectEqualDeep(before_values[index], tb.textAnnotations().get(id).?);
            try std.testing.expectEqual(before_refs[index], tb.internal_style_slots.items[index].refs);
        }
        try expectText(tb, "left middle right");

        failing.fail_index = std.math.maxInt(usize);
        _ = try tb.replaceStyledRangeBytes(5, 11, &chunks, 9);
        try expectText(tb, "left 中🙂 right");
    } else {
        _ = try transaction;
    }
    return failing.alloc_index - before_alloc;
}

test "styled replacement failures preserve text annotations and epoch at every allocation" {
    const allocations = try exerciseStyledTransactionFailure(null);
    for (0..allocations) |offset| _ = try exerciseStyledTransactionFailure(offset);
}

test "EditBuffer display splitter preserves interior wide and tab behavior" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    const eb = try edit_buffer.EditBuffer.init(std.testing.allocator, pool, link_pool, .unicode, null);
    defer eb.deinit();

    try eb.setText("界");
    try eb.setCursor(0, 1);
    try eb.insertText("X");
    try expectText(eb.getTextBuffer(), "界X");

    try eb.setText("A\tB");
    try eb.setCursor(0, 2);
    try eb.insertText("X");
    try expectText(eb.getTextBuffer(), "AX\tB");
}

test "EditBuffer undo and redo restore exact annotation identity payload and lifecycle" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const eb = try edit_buffer.EditBuffer.init(std.testing.allocator, pool, link_pool, .unicode, null);
    defer eb.deinit();
    try eb.setText("abcdef");
    const id = try eb.tb.textAnnotations().addRange(.{ .start_byte = 2, .end_byte = 4 }, .{
        .namespace = 71,
        .style_id = 99,
        .priority = 7,
        .kind_flags = 0x42,
        .splice_policy = .invalidate,
    });

    try eb.setCursor(0, 1);
    try eb.insertText("X");
    try std.testing.expectEqual(@as(u32, 3), eb.tb.textAnnotations().get(id).?.mark.range.start_byte);
    _ = try eb.undo();
    const undone = eb.tb.textAnnotations().get(id).?;
    try std.testing.expectEqual(@as(u32, 2), undone.mark.range.start_byte);
    try std.testing.expectEqual(@as(u32, 99), undone.payload.style_id);
    try std.testing.expectEqual(@as(u32, 0x42), undone.payload.kind_flags);
    _ = try eb.redo();
    try std.testing.expectEqual(@as(u32, 3), eb.tb.textAnnotations().get(id).?.mark.range.start_byte);

    try eb.deleteRange(.{ .row = 0, .col = 3 }, .{ .row = 0, .col = 5 });
    try std.testing.expect(eb.tb.textAnnotations().get(id) == null);
    _ = try eb.undo();
    try std.testing.expectEqual(@as(u32, 3), eb.tb.textAnnotations().get(id).?.mark.range.start_byte);
}

test "styled owner replacement clips and splits old coverage atomically" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    try tb.setText("abcdef");
    const initial = "abcdef";
    const first = [_]text_buffer.StyledChunk{.{ .text_ptr = initial.ptr, .text_len = initial.len, .fg_ptr = null, .bg_ptr = null, .attributes = 1 }};
    _ = try tb.replaceStyledRangeBytes(0, 6, &first, 9);
    const replacement = "XY";
    const second = [_]text_buffer.StyledChunk{.{ .text_ptr = replacement.ptr, .text_len = replacement.len, .fg_ptr = null, .bg_ptr = null, .attributes = 2 }};
    _ = try tb.replaceStyledRangeBytes(2, 4, &second, 9);

    var ranges: [3]struct { start: u32, end: u32 } = undefined;
    var count: usize = 0;
    var it = tb.textAnnotations().iterator();
    while (try it.next()) |annotation| {
        if (annotation.payload.namespace != 9) continue;
        ranges[count] = .{ .start = annotation.mark.range.start_byte, .end = annotation.mark.range.end_byte };
        count += 1;
    }
    std.mem.sort(@TypeOf(ranges[0]), ranges[0..count], {}, struct {
        fn lessThan(_: void, a: @TypeOf(ranges[0]), b: @TypeOf(ranges[0])) bool {
            return a.start < b.start;
        }
    }.lessThan);
    try std.testing.expectEqual(@as(usize, 3), count);
    try std.testing.expectEqualSlices(@TypeOf(ranges[0]), &.{ .{ .start = 0, .end = 2 }, .{ .start = 2, .end = 4 }, .{ .start = 4, .end = 6 } }, &ranges);
    try std.testing.expectEqual(@as(u32, 3), tb.getHighlightCount());
}

test "annotation IDs do not alias after clear and highlight clears include style ranges" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    try tb.setText("aa\nbb");
    const old_id = try tb.createStyleRange(4, 0, 5, 12, 1);
    tb.clearLineHighlights(0);
    const clipped = tb.textAnnotations().get(old_id).?;
    try std.testing.expectEqual(@as(u32, 3), clipped.mark.range.start_byte);
    try std.testing.expectEqual(@as(u32, 5), clipped.mark.range.end_byte);
    tb.clearAllHighlights();
    try std.testing.expectEqual(@as(u32, 0), tb.getHighlightCount());

    tb.clear();
    try tb.setText("x");
    const new_id = try tb.createStyleRange(4, 0, 1, 13, 1);
    try std.testing.expect(old_id != new_id);
    try std.testing.expect(tb.textAnnotations().get(old_id) == null);
}

test "anonymous styles and links reclaim under ten thousand range updates" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    const syntax = try syntax_style.SyntaxStyle.init(std.testing.allocator);
    defer syntax.deinit();
    tb.setSyntaxStyle(syntax);
    try tb.setText("x");
    const url = "https://example.test/churn";
    const style_value: text_buffer.StyledChunk = .{
        .text_ptr = "".ptr,
        .text_len = 0,
        .fg_ptr = null,
        .bg_ptr = null,
        .attributes = 1,
        .link_ptr = url.ptr,
        .link_len = url.len,
    };
    for (0..10000) |_| {
        const id = try tb.createStyleValueRange(88, 0, 1, style_value, 1);
        try std.testing.expectEqual(@as(usize, 1), tb.getLineHighlights(0).len);
        try std.testing.expect(try tb.removeStyleRange(id));
    }
    try std.testing.expectEqual(@as(usize, 1), tb.internal_style_slots.items.len);
    try std.testing.expectEqual(@as(usize, 0), syntax.getStyleCount());
    try std.testing.expectEqual(@as(u64, 0), link_pool.getLiveSlotCount());
}

test "resolved internal styles invalidate on detach replacement destroy and removal" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    const first = try syntax_style.SyntaxStyle.init(std.testing.allocator);
    defer first.deinit();
    const second = try syntax_style.SyntaxStyle.init(std.testing.allocator);
    const third = try syntax_style.SyntaxStyle.init(std.testing.allocator);
    defer third.deinit();
    tb.setSyntaxStyle(first);
    try tb.setText("styled");
    const url = "https://lifecycle.test";
    const value: text_buffer.StyledChunk = .{
        .text_ptr = "".ptr,
        .text_len = 0,
        .fg_ptr = null,
        .bg_ptr = null,
        .attributes = 1,
        .link_ptr = url.ptr,
        .link_len = url.len,
    };
    const id = try tb.createStyleValueRange(61, 0, 6, value, 1);
    const baseline_first = first.getAnonymousStyleCount();
    const baseline_third = third.getAnonymousStyleCount();
    const baseline_links = link_pool.getLiveSlotCount();

    _ = tb.getLineHighlights(0);
    try std.testing.expectEqual(baseline_first + 1, first.getAnonymousStyleCount());
    try std.testing.expectEqual(baseline_links + 1, link_pool.getLiveSlotCount());
    const detach_epoch = tb.getAnnotationEpoch();
    tb.setSyntaxStyle(null);
    try std.testing.expect(tb.getAnnotationEpoch() > detach_epoch);
    try std.testing.expectEqual(baseline_first, first.getAnonymousStyleCount());
    try std.testing.expectEqual(baseline_links, link_pool.getLiveSlotCount());
    try std.testing.expectEqual(@as(u32, 0), tb.internal_style_slots.items[0].resolved_style_id);
    try std.testing.expectEqual(@as(u32, 0), tb.internal_style_slots.items[0].link_id);

    tb.setSyntaxStyle(first);
    _ = tb.getLineHighlights(0);
    try std.testing.expectEqual(baseline_first + 1, first.getAnonymousStyleCount());
    tb.setSyntaxStyle(second);
    try std.testing.expectEqual(baseline_first, first.getAnonymousStyleCount());
    try std.testing.expectEqual(baseline_links, link_pool.getLiveSlotCount());
    _ = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), second.getAnonymousStyleCount());
    try std.testing.expectEqual(baseline_links + 1, link_pool.getLiveSlotCount());

    second.deinit();
    try std.testing.expect(tb.getSyntaxStyle() == null);
    try std.testing.expectEqual(baseline_links, link_pool.getLiveSlotCount());
    try std.testing.expectEqual(@as(u32, 0), tb.internal_style_slots.items[0].resolved_style_id);
    try std.testing.expectEqual(@as(u32, 0), tb.internal_style_slots.items[0].link_id);

    tb.setSyntaxStyle(third);
    _ = tb.getLineHighlights(0);
    try std.testing.expectEqual(baseline_third + 1, third.getAnonymousStyleCount());
    try std.testing.expectEqual(baseline_links + 1, link_pool.getLiveSlotCount());
    try std.testing.expect(try tb.removeStyleRange(id));
    try std.testing.expectEqual(baseline_third, third.getAnonymousStyleCount());
    try std.testing.expectEqual(baseline_links, link_pool.getLiveSlotCount());
    try std.testing.expectEqual(@as(u32, 0), tb.internal_style_slots.items[0].refs);
}
