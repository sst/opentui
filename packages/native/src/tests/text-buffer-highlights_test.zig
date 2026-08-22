const std = @import("std");
const text_buffer = @import("../text-buffer.zig");
const ansi = @import("../ansi.zig");
const gp = @import("../grapheme.zig");
const link = @import("../link.zig");
const ss = @import("../syntax-style.zig");
const bench_utils = @import("../bench-utils.zig");

const TextBuffer = text_buffer.UnifiedTextBuffer;
const RGBA = text_buffer.RGBA;
const Highlight = text_buffer.Highlight;
const StyleSpan = text_buffer.StyleSpan;

fn referenceSpans(allocator: std.mem.Allocator, highlights: []const Highlight, line_width: u32) !std.ArrayList(StyleSpan) {
    var boundaries: std.ArrayList(u32) = .empty;
    defer boundaries.deinit(allocator);
    for (highlights) |highlight| {
        try boundaries.append(allocator, highlight.col_start);
        try boundaries.append(allocator, highlight.col_end);
    }
    std.mem.sort(u32, boundaries.items, {}, std.sort.asc(u32));
    var unique: usize = 0;
    for (boundaries.items) |boundary| {
        if (unique != 0 and boundaries.items[unique - 1] == boundary) continue;
        boundaries.items[unique] = boundary;
        unique += 1;
    }
    boundaries.shrinkRetainingCapacity(unique);

    var output: std.ArrayList(StyleSpan) = .empty;
    errdefer output.deinit(allocator);
    var start: u32 = 0;
    for (boundaries.items) |end| {
        var winner: ?usize = null;
        for (highlights, 0..) |highlight, index| {
            if (highlight.col_start > start or highlight.col_end <= start) continue;
            if (winner == null or highlight.priority > highlights[winner.?].priority or
                (highlight.priority == highlights[winner.?].priority and index > winner.?)) winner = index;
        }
        const style_id = if (winner) |index| highlights[index].style_id else 0;
        if (start < end) {
            if (output.items.len != 0 and output.items[output.items.len - 1].style_id == style_id) {
                output.items[output.items.len - 1].next_col = end;
            } else {
                try output.append(allocator, .{ .col = start, .next_col = end, .style_id = style_id });
            }
        }
        start = end;
    }
    if (start < line_width) {
        if (output.items.len != 0 and output.items[output.items.len - 1].style_id == 0) {
            output.items[output.items.len - 1].next_col = line_width;
        } else {
            try output.append(allocator, .{ .col = start, .next_col = line_width, .style_id = 0 });
        }
    }
    return output;
}

test "TextBuffer coords - addHighlightByCoords" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth);
    defer tb.deinit();

    try tb.setText("Hello\nWorld");

    try tb.addHighlightByCoords(0, 1, 0, 5, 1, 1, 0);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
    try std.testing.expectEqual(@as(u32, 1), highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 5), highlights[0].col_end);
}

test "TextBuffer coords - addHighlightByCoords multi-line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth);
    defer tb.deinit();

    try tb.setText("Hello\nWorld");

    try tb.addHighlightByCoords(0, 3, 1, 3, 1, 1, 0);

    const line0_highlights = tb.getLineHighlights(0);
    const line1_highlights = tb.getLineHighlights(1);

    try std.testing.expectEqual(@as(usize, 1), line0_highlights.len);
    try std.testing.expectEqual(@as(usize, 1), line1_highlights.len);
}

// ===== Highlight System Tests =====

test "TextBuffer highlights - add single highlight to line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("Hello World");

    try tb.addHighlight(0, 0, 5, 1, 0, 0);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
    try std.testing.expectEqual(@as(u32, 0), highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 5), highlights[0].col_end);
    try std.testing.expectEqual(@as(u32, 1), highlights[0].style_id);
}

test "TextBuffer highlights - add multiple highlights to same line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("Hello World");

    try tb.addHighlight(0, 0, 5, 1, 0, 0);
    try tb.addHighlight(0, 6, 11, 2, 0, 0);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 2), highlights.len);
    try std.testing.expectEqual(@as(u32, 1), highlights[0].style_id);
    try std.testing.expectEqual(@as(u32, 2), highlights[1].style_id);
}

test "TextBuffer highlights - add highlights to multiple lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("Line 1\nLine 2\nLine 3");

    try tb.addHighlight(0, 0, 6, 1, 0, 0);
    try tb.addHighlight(1, 0, 6, 2, 0, 0);
    try tb.addHighlight(2, 0, 6, 3, 0, 0);

    try std.testing.expectEqual(@as(usize, 1), tb.getLineHighlights(0).len);
    try std.testing.expectEqual(@as(usize, 1), tb.getLineHighlights(1).len);
    try std.testing.expectEqual(@as(usize, 1), tb.getLineHighlights(2).len);
}

test "TextBuffer highlights - remove highlights by reference" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("Line 1\nLine 2");

    try tb.addHighlight(0, 0, 3, 1, 0, 100);
    try tb.addHighlight(0, 3, 6, 2, 0, 200);
    try tb.addHighlight(1, 0, 6, 3, 0, 100);

    tb.removeHighlightsByRef(100);

    const line0_highlights = tb.getLineHighlights(0);
    const line1_highlights = tb.getLineHighlights(1);

    try std.testing.expectEqual(@as(usize, 1), line0_highlights.len);
    try std.testing.expectEqual(@as(u32, 2), line0_highlights[0].style_id);
    try std.testing.expectEqual(@as(usize, 0), line1_highlights.len);
}

test "TextBuffer highlights - clear line highlights" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("Line 1\nLine 2");

    try tb.addHighlight(0, 0, 6, 1, 0, 0);
    try tb.addHighlight(0, 6, 10, 2, 0, 0);

    tb.clearLineHighlights(0);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 0), highlights.len);
}

test "TextBuffer highlights - clear all highlights" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("Line 1\nLine 2\nLine 3");

    try tb.addHighlight(0, 0, 6, 1, 0, 0);
    try tb.addHighlight(1, 0, 6, 2, 0, 0);
    try tb.addHighlight(2, 0, 6, 3, 0, 0);

    tb.clearAllHighlights();

    try std.testing.expectEqual(@as(usize, 0), tb.getLineHighlights(0).len);
    try std.testing.expectEqual(@as(usize, 0), tb.getLineHighlights(1).len);
    try std.testing.expectEqual(@as(usize, 0), tb.getLineHighlights(2).len);
}

test "TextBuffer highlights - get highlights from non-existent line" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("Line 1");

    // Get highlights from line that doesn't have any
    const highlights = tb.getLineHighlights(10);
    try std.testing.expectEqual(@as(usize, 0), highlights.len);
}

test "TextBuffer highlights - overlapping highlights" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("Hello World");

    try tb.addHighlight(0, 0, 8, 1, 0, 0);
    try tb.addHighlight(0, 5, 11, 2, 0, 0);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 2), highlights.len);
}

test "TextBuffer highlights - reset clears highlights" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("Hello World");
    try tb.addHighlight(0, 0, 5, 1, 0, 0);

    tb.reset();

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 0), highlights.len);
}

test "TextBuffer highlights - setSyntaxStyle and getSyntaxStyle" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    var syntax_style = try ss.SyntaxStyle.init(std.testing.allocator);
    defer syntax_style.deinit();

    try std.testing.expect(tb.getSyntaxStyle() == null);

    tb.setSyntaxStyle(syntax_style);
    try std.testing.expect(tb.getSyntaxStyle() != null);

    tb.setSyntaxStyle(null);
    try std.testing.expect(tb.getSyntaxStyle() == null);
}

test "TextBuffer highlights - rejects syntax style when destroy listener allocation fails" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    var failing_allocator = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = 2 });
    var syntax_style = try ss.SyntaxStyle.init(failing_allocator.allocator());
    defer syntax_style.deinit();
    defer tb.deinit();

    tb.setSyntaxStyle(syntax_style);

    try std.testing.expect(failing_allocator.has_induced_failure);
    try std.testing.expect(tb.getSyntaxStyle() == null);
}

test "TextBuffer highlights - preserves syntax style when replacement listener allocation fails" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    var first_style = try ss.SyntaxStyle.init(std.testing.allocator);
    defer first_style.deinit();
    var failing_allocator = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = 2 });
    var second_style = try ss.SyntaxStyle.init(failing_allocator.allocator());
    defer second_style.deinit();

    tb.setSyntaxStyle(first_style);
    tb.setSyntaxStyle(second_style);

    try std.testing.expect(failing_allocator.has_induced_failure);
    try std.testing.expectEqual(@as(?*const ss.SyntaxStyle, first_style), tb.getSyntaxStyle());
}

test "TextBuffer highlights - integration with SyntaxStyle" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    var syntax_style = try ss.SyntaxStyle.init(std.testing.allocator);
    defer syntax_style.deinit();

    const keyword_id = try syntax_style.registerStyle("keyword", ansi.rgbaFromFloats(1.0, 0.0, 0.0, 1.0), null, 0);
    const string_id = try syntax_style.registerStyle("string", ansi.rgbaFromFloats(0.0, 1.0, 0.0, 1.0), null, 0);
    const comment_id = try syntax_style.registerStyle("comment", ansi.rgbaFromFloats(0.5, 0.5, 0.5, 1.0), null, 0);

    try tb.setText("function hello() // comment");
    tb.setSyntaxStyle(syntax_style);

    try tb.addHighlight(0, 0, 8, keyword_id, 1, 0);
    try tb.addHighlight(0, 9, 14, string_id, 1, 0);
    try tb.addHighlight(0, 17, 27, comment_id, 1, 0);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 3), highlights.len);

    const style = tb.getSyntaxStyle().?;
    try std.testing.expect(style.resolveById(keyword_id) != null);
    try std.testing.expect(style.resolveById(string_id) != null);
    try std.testing.expect(style.resolveById(comment_id) != null);
}

test "TextBuffer highlights - style spans computed correctly" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("0123456789");

    try tb.addHighlight(0, 0, 3, 1, 1, 0);
    try tb.addHighlight(0, 5, 8, 2, 1, 0);

    const spans = tb.getLineSpans(0);
    try std.testing.expect(spans.len > 0);

    // Should have spans for: [0-3 style:1], [3-5 style:0/default], [5-8 style:2], ...
    var found_style1 = false;
    var found_style2 = false;
    for (spans) |span| {
        if (span.style_id == 1) found_style1 = true;
        if (span.style_id == 2) found_style2 = true;
    }
    try std.testing.expect(found_style1);
    try std.testing.expect(found_style2);
}

test "TextBuffer highlights - priority handling in spans" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("0123456789");

    try tb.addHighlight(0, 0, 8, 1, 1, 0);
    try tb.addHighlight(0, 3, 6, 2, 5, 0);

    const spans = tb.getLineSpans(0);
    try std.testing.expect(spans.len > 0);

    // In range 3-6, style 2 should win due to higher priority
    var found_high_priority = false;
    for (spans) |span| {
        if (span.col >= 3 and span.col < 6 and span.style_id == 2) {
            found_high_priority = true;
        }
    }
    try std.testing.expect(found_high_priority);
}

test "TextBuffer spans match reference for nested coextensive and crossed ranges" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    const line = try std.testing.allocator.alloc(u8, 4096);
    defer std.testing.allocator.free(line);
    @memset(line, 'x');
    try tb.setText(line);
    tb.startHighlightsTransaction();
    for (0..800) |index| {
        const inset: u32 = @intCast(index % 300);
        const start: u32 = if (index % 3 == 0) 100 else inset;
        const end: u32 = if (index % 5 == 0) 3900 else 4096 - inset;
        try tb.addHighlight(0, start, end, @intCast(index + 1), @intCast(index % 11), @intCast(index));
    }
    // Coextensive equal-priority entries verify that the newer array entry wins.
    try tb.addHighlight(0, 500, 3500, 9001, 50, 9001);
    try tb.addHighlight(0, 500, 3500, 9002, 50, 9002);
    tb.endHighlightsTransaction();

    const highlights = tb.getLineHighlights(0);
    var expected = try referenceSpans(std.testing.allocator, highlights, tb.lineWidthAt(0));
    defer expected.deinit(std.testing.allocator);
    try std.testing.expectEqualSlices(StyleSpan, expected.items, tb.getLineSpans(0));
    for (tb.getLineSpans(0)) |span| {
        if (span.col <= 500 and span.next_col > 500) try std.testing.expectEqual(@as(u32, 9002), span.style_id);
    }
}

test "TextBuffer dirty projection scales near n log n for flat range counts through 2000" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const counts = [_]usize{ 100, 200, 400, 800, 1600, 2000 };
    var elapsed: [counts.len]u64 = undefined;
    const line = try std.testing.allocator.alloc(u8, 5000);
    defer std.testing.allocator.free(line);
    @memset(line, 'x');

    for (counts, 0..) |count, count_index| {
        var samples: [3]u64 = undefined;
        for (&samples) |*sample| {
            const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
            defer tb.deinit();
            try tb.setText(line);
            for (0..count) |index| {
                const start: u32 = @intCast(index * 2);
                _ = try tb.createStyleRange(88, start, start + 1, @intCast(index + 1), @intCast(index % 13));
            }
            const timer = bench_utils.BenchTimer.start(std.testing.io);
            try std.testing.expectEqual(count * 2, tb.getLineSpans(0).len);
            sample.* = timer.read();
        }
        std.mem.sort(u64, &samples, {}, std.sort.asc(u64));
        elapsed[count_index] = samples[1];
    }

    // Doubling n log n remains comfortably below 3x. The additive allowance
    // absorbs timer and allocator noise at the two smallest sizes.
    for (elapsed[1..], elapsed[0 .. elapsed.len - 1]) |current, previous| {
        try std.testing.expect(current <= previous * 3 + 2 * std.time.ns_per_ms);
    }
    try std.testing.expect(elapsed[elapsed.len - 1] <= 100 * std.time.ns_per_ms);
}

// ===== Character Range Highlight Tests =====

test "TextBuffer char range highlights - single line highlight" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("Hello World");

    try tb.addHighlightByCharRange(0, 5, 1, 1, 0);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
    try std.testing.expectEqual(@as(u32, 0), highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 5), highlights[0].col_end);
    try std.testing.expectEqual(@as(u32, 1), highlights[0].style_id);
}

test "TextBuffer char range highlights - multi-line highlight" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    // "Hello" = 5 chars (0-4, newlines not counted in offsets)
    // "World" = 5 chars (5-9, newlines not counted in offsets)
    // "Test" = 4 chars (10-13, newlines not counted in offsets)
    try tb.setText("Hello\nWorld\nTest");

    // Highlight from middle of line 0 to middle of line 1 (chars 3-9, not counting newlines)
    // char 3 = 'l' in "Hello", char 9 = 'd' in "World" (last char)
    try tb.addHighlightByCharRange(3, 9, 1, 1, 0);

    const line0_highlights = tb.getLineHighlights(0);
    const line1_highlights = tb.getLineHighlights(1);

    try std.testing.expectEqual(@as(usize, 1), line0_highlights.len);
    try std.testing.expectEqual(@as(usize, 1), line1_highlights.len);

    // Line 0: highlight from col 3 to end (col 5)
    try std.testing.expectEqual(@as(u32, 3), line0_highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 5), line0_highlights[0].col_end);

    // Line 1: highlight from start (col 0) to col 4 (chars 5,6,7,8 = cols 0,1,2,3)
    try std.testing.expectEqual(@as(u32, 0), line1_highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 4), line1_highlights[0].col_end);
}

test "TextBuffer char range highlights - spanning three lines" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("Line1\nLine2\nLine3");

    try tb.addHighlightByCharRange(3, 13, 1, 1, 0);

    const line0_highlights = tb.getLineHighlights(0);
    const line1_highlights = tb.getLineHighlights(1);
    const line2_highlights = tb.getLineHighlights(2);

    try std.testing.expectEqual(@as(usize, 1), line0_highlights.len);
    try std.testing.expectEqual(@as(usize, 1), line1_highlights.len);
    try std.testing.expectEqual(@as(usize, 1), line2_highlights.len);

    try std.testing.expectEqual(@as(u32, 3), line0_highlights[0].col_start);

    try std.testing.expectEqual(@as(u32, 0), line1_highlights[0].col_start);

    try std.testing.expectEqual(@as(u32, 0), line2_highlights[0].col_start);
}

test "TextBuffer char range highlights - exact line boundaries" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("AAAA\nBBBB\nCCCC");

    // Highlight entire first line (chars 0-4, excluding newline)
    try tb.addHighlightByCharRange(0, 4, 1, 1, 0);

    const line0_highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), line0_highlights.len);
    try std.testing.expectEqual(@as(u32, 0), line0_highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 4), line0_highlights[0].col_end);

    // Line 1 should have no highlights
    const line1_highlights = tb.getLineHighlights(1);
    try std.testing.expectEqual(@as(usize, 0), line1_highlights.len);
}

test "TextBuffer char range highlights - empty range" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("Hello World");

    // Empty range (start == end) should add no highlights
    try tb.addHighlightByCharRange(5, 5, 1, 1, 0);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 0), highlights.len);
}

test "TextBuffer char range highlights - invalid range" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("Hello World");

    // Invalid range (start > end) should add no highlights
    try tb.addHighlightByCharRange(10, 5, 1, 1, 0);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 0), highlights.len);
}

test "TextBuffer char range highlights - out of bounds range" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("Hello");

    // Range extends beyond text length - should handle gracefully
    try tb.addHighlightByCharRange(3, 100, 1, 1, 0);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
    try std.testing.expectEqual(@as(u32, 3), highlights[0].col_start);
}

test "TextBuffer char range highlights - multiple non-overlapping ranges" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("function hello() { return 42; }");

    try tb.addHighlightByCharRange(0, 8, 1, 1, 0);
    try tb.addHighlightByCharRange(9, 14, 2, 1, 0);
    try tb.addHighlightByCharRange(19, 25, 3, 1, 0);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 3), highlights.len);
    try std.testing.expectEqual(@as(u32, 1), highlights[0].style_id);
    try std.testing.expectEqual(@as(u32, 2), highlights[1].style_id);
    try std.testing.expectEqual(@as(u32, 3), highlights[2].style_id);
}

test "TextBuffer char range highlights - with reference ID for removal" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("Line1\nLine2\nLine3");

    try tb.addHighlightByCharRange(0, 5, 1, 1, 100);
    try tb.addHighlightByCharRange(6, 11, 2, 1, 100);

    try std.testing.expectEqual(@as(usize, 1), tb.getLineHighlights(0).len);
    try std.testing.expectEqual(@as(usize, 1), tb.getLineHighlights(1).len);

    tb.removeHighlightsByRef(100);
    try std.testing.expectEqual(@as(usize, 0), tb.getLineHighlights(0).len);
    try std.testing.expectEqual(@as(usize, 0), tb.getLineHighlights(1).len);
}

test "TextBuffer char range highlights - priority handling" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("0123456789");

    try tb.addHighlightByCharRange(0, 8, 1, 1, 0);
    try tb.addHighlightByCharRange(3, 6, 2, 5, 0);

    const spans = tb.getLineSpans(0);
    try std.testing.expect(spans.len > 0);

    // Higher priority should win in overlap region
    var found_high_priority = false;
    for (spans) |span| {
        if (span.col >= 3 and span.col < 6 and span.style_id == 2) {
            found_high_priority = true;
        }
    }
    try std.testing.expect(found_high_priority);
}

test "TextBuffer char range highlights - unicode text" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("Hello 世界 🌟");

    const text_len = tb.getLength();
    try tb.addHighlightByCharRange(0, text_len, 1, 1, 0);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
}

test "TextBuffer char range highlights - preserved after setText" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("Hello World");
    try tb.addHighlightByCharRange(0, 5, 1, 1, 0);

    // Set new text - with clear() highlights are now preserved
    try tb.setText("New Text");

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);

    // To clear highlights, caller must explicitly call clearAllHighlights
    tb.clearAllHighlights();
    const cleared_highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 0), cleared_highlights.len);
}

test "TextBuffer char range highlights - multi-width chars before highlight" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("前后端分离 @git-committer");
    try tb.addHighlightByCharRange(11, 25, 1, 1, 0);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
    try std.testing.expectEqual(@as(u32, 11), highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 25), highlights[0].col_end);
}

test "TextBuffer char range highlights - multi-width chars between highlights" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("abc前后端def");
    try tb.addHighlightByCharRange(9, 12, 1, 1, 0);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
    try std.testing.expectEqual(@as(u32, 9), highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 12), highlights[0].col_end);
}

test "TextBuffer char range highlights - emoji grapheme clusters" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();

    try tb.setText("前🌟test");
    try tb.addHighlightByCharRange(4, 8, 1, 1, 0);

    const highlights = tb.getLineHighlights(0);
    try std.testing.expectEqual(@as(usize, 1), highlights.len);
    try std.testing.expectEqual(@as(u32, 4), highlights[0].col_start);
    try std.testing.expectEqual(@as(u32, 8), highlights[0].col_end);
}
