const std = @import("std");
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const gp = @import("../grapheme.zig");
const link = @import("../link.zig");

const TextBuffer = text_buffer.TextBuffer;
const TextBufferView = text_buffer_view.TextBufferView;

const ViewPair = struct {
    tb: *TextBuffer,
    view: *TextBufferView,
};

fn initView(text: []const u8) !ViewPair {
    const pool = gp.initGlobalPool(std.testing.allocator);
    errdefer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    errdefer link.deinitGlobalLinkPool();

    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    errdefer tb.deinit();
    const view = try TextBufferView.init(std.testing.allocator, tb);
    errdefer view.deinit();
    try tb.setText(text);
    return .{ .tb = tb, .view = view };
}

fn deinitView(pair: ViewPair) void {
    pair.view.deinit();
    pair.tb.deinit();
    gp.deinitGlobalPool();
    link.deinitGlobalLinkPool();
}

fn selected(view: *TextBufferView, range: text_buffer_view.SelectionRange, out: []u8) []const u8 {
    const len = view.getTextBuffer().getTextRange(range.start, range.end, out);
    return out[0..len];
}

fn expectSelected(
    view: *TextBufferView,
    range: ?text_buffer_view.SelectionRange,
    expected: []const u8,
) !void {
    const found = range orelse return error.TestUnexpectedResult;
    var out: [128]u8 = undefined;
    try std.testing.expectEqualStrings(expected, selected(view, found, &out));
}

test "selectWord - alpha beta click on b selects beta" {
    const pair = try initView("alpha beta");
    defer deinitView(pair);

    try expectSelected(pair.view, pair.view.selectWord(6), "beta");
}

test "selectWord - click on space selects one space" {
    const pair = try initView("alpha beta");
    defer deinitView(pair);

    try expectSelected(pair.view, pair.view.selectWord(5), " ");
}

test "selectWord - empty padding past the line returns no range" {
    const pair = try initView("alpha beta");
    defer deinitView(pair);

    try std.testing.expect(pair.view.selectWord(10) == null);
    try std.testing.expect(pair.view.selectWord(11) == null);
}

test "selectWord - newline returns no range" {
    const pair = try initView("alpha\nbeta");
    defer deinitView(pair);

    try std.testing.expect(pair.view.selectWord(5) == null);
}

test "selectWord - wide glyph 日本語abc is one word" {
    const pair = try initView("日本語abc");
    defer deinitView(pair);

    // 日=2, 本=2, 語=2, a=1, b=1, c=1. Click either cell of 本 (offsets 2 or 3).
    try expectSelected(pair.view, pair.view.selectWord(2), "日本語abc");
    try expectSelected(pair.view, pair.view.selectWord(3), "日本語abc");
}

test "selectWord - slash is not a boundary unlike wrap breaks" {
    const pair = try initView("foo/bar");
    defer deinitView(pair);

    try expectSelected(pair.view, pair.view.selectWord(0), "foo/bar");
    try expectSelected(pair.view, pair.view.selectWord(3), "foo/bar");
}

test "selectWord - wrapped hello world still selects world" {
    const pair = try initView("hello world");
    defer deinitView(pair);
    pair.view.setWrapMode(.char);
    pair.view.setWrapWidth(5);

    try expectSelected(pair.view, pair.view.selectWord(6), "world");
}

test "selectWordBetween - from alpha across spaces onto padding past beta" {
    const pair = try initView("alpha beta");
    defer deinitView(pair);

    try expectSelected(pair.view, pair.view.selectWordBetween(0, 10), "alpha");
    try expectSelected(pair.view, pair.view.selectWordBetween(10, 0), "beta");
}

test "selectLine - hello world keeps interior spaces and trims ends" {
    const pair = try initView("  hello world  ");
    defer deinitView(pair);

    try expectSelected(pair.view, pair.view.selectLine(4), "hello world");
}

test "selectLine - wrapped source line selected as one line" {
    const pair = try initView("hello world");
    defer deinitView(pair);
    pair.view.setWrapMode(.char);
    pair.view.setWrapWidth(5);

    try expectSelected(pair.view, pair.view.selectLine(0), "hello world");
    try expectSelected(pair.view, pair.view.selectLine(6), "hello world");
}

test "selectLine - blank line selected in full" {
    const pair = try initView("alpha\n   \nbeta");
    defer deinitView(pair);

    try expectSelected(pair.view, pair.view.selectLine(6), "   ");
}

test "selectLine - selected bytes match a whole visual-line drag" {
    const pair = try initView("hello\nworld");
    defer deinitView(pair);

    try expectSelected(pair.view, pair.view.selectLine(0), "hello");
}
