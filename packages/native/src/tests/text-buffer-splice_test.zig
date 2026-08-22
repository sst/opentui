const std = @import("std");
const text_buffer = @import("../text-buffer.zig");
const edit_buffer = @import("../edit-buffer.zig");
const syntax_style = @import("../syntax-style.zig");
const rope_mod = @import("../rope.zig");
const gp = @import("../grapheme.zig");
const link = @import("../link.zig");

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
    try std.testing.expectEqual(@as(usize, 2), tb.memRegistry().getUsedSlots());

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
    try std.testing.expectEqual(@as(usize, 2), tb.memRegistry().getUsedSlots());

    _ = try tb.replaceNormalizedBytes(6, 6, " again");
    try expectText(tb, "styled again");
    try std.testing.expectEqual(@as(usize, 3), tb.memRegistry().getUsedSlots());
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
