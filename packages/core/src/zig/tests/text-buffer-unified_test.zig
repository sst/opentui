const std = @import("std");
const testing = std.testing;
const text_buffer = @import("../text-buffer.zig");
const iter_mod = @import("../text-buffer-iterators.zig");
const gp = @import("../grapheme.zig");

const UnifiedTextBuffer = text_buffer.UnifiedTextBuffer;

test "UnifiedTextBuffer - init and deinit" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const unicode_data = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = unicode_data;

    var tb = try UnifiedTextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try testing.expectEqual(@as(u32, 0), tb.getLength());
    try testing.expectEqual(@as(u32, 0), tb.getLineCount()); // Empty rope = 0 lines (use setText("") for 1 empty line)
}

test "UnifiedTextBuffer - setText single line" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const unicode_data = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = unicode_data;

    var tb = try UnifiedTextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const text = "Hello, world!";
    try tb.setText(text);

    try testing.expectEqual(@as(u32, 13), tb.getLength());
    try testing.expectEqual(@as(u32, 1), tb.getLineCount());
    try testing.expectEqual(@as(u32, 2), tb.rope.count()); // linestart + text segment

    // Verify we can extract the text back
    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try testing.expectEqual(@as(usize, 13), written);
    try testing.expectEqualStrings(text, out_buffer[0..written]);
}

test "UnifiedTextBuffer - setText multiple lines" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const unicode_data = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = unicode_data;

    var tb = try UnifiedTextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const text = "Line 1\nLine 2\nLine 3";
    try tb.setText(text);

    try testing.expectEqual(@as(u32, 18), tb.getLength()); // 6 + 6 + 6 chars
    try testing.expectEqual(@as(u32, 3), tb.getLineCount());
    try testing.expectEqual(@as(u32, 8), tb.rope.count()); // 3 linestart + 3 text + 2 breaks

    // Verify extraction
    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try testing.expectEqual(@as(usize, 20), written); // 18 chars + 2 newlines
    try testing.expectEqualStrings(text, out_buffer[0..written]);
}

test "UnifiedTextBuffer - setText with trailing newline" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const unicode_data = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = unicode_data;

    var tb = try UnifiedTextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const text = "Line 1\nLine 2\n";
    try tb.setText(text);

    // Trailing newline creates an empty 3rd line (matches editor semantics)
    try testing.expectEqual(@as(u32, 3), tb.getLineCount()); // 3 lines (last is empty)
    // Rope structure: [linestart] [text "Line 1"] [break] [linestart] [text "Line 2"] [break] [linestart]
    try testing.expectEqual(@as(u32, 7), tb.rope.count());
}

test "UnifiedTextBuffer - setText empty text" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const unicode_data = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = unicode_data;

    var tb = try UnifiedTextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("");

    try testing.expectEqual(@as(u32, 0), tb.getLength());
    try testing.expectEqual(@as(u32, 1), tb.getLineCount()); // setText("") creates 1 empty line
    try testing.expectEqual(@as(u32, 2), tb.rope.count()); // linestart + one empty text segment
}

test "UnifiedTextBuffer - line iteration" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const unicode_data = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = unicode_data;

    var tb = try UnifiedTextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const text = "First\nSecond\nThird";
    try tb.setText(text);

    const Context = struct {
        lines: std.ArrayList(iter_mod.LineInfo),

        fn callback(ctx_ptr: *anyopaque, line_info: iter_mod.LineInfo) void {
            const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
            ctx.lines.append(line_info) catch {};
        }
    };

    var ctx = Context{ .lines = std.ArrayList(iter_mod.LineInfo).init(testing.allocator) };
    defer ctx.lines.deinit();

    iter_mod.walkLines(&tb.rope, &ctx, Context.callback);

    try testing.expectEqual(@as(usize, 3), ctx.lines.items.len);
    try testing.expectEqual(@as(u32, 0), ctx.lines.items[0].line_idx);
    try testing.expectEqual(@as(u32, 5), ctx.lines.items[0].width);

    try testing.expectEqual(@as(u32, 1), ctx.lines.items[1].line_idx);
    try testing.expectEqual(@as(u32, 6), ctx.lines.items[1].width);

    try testing.expectEqual(@as(u32, 2), ctx.lines.items[2].line_idx);
    try testing.expectEqual(@as(u32, 5), ctx.lines.items[2].width);
}

test "UnifiedTextBuffer - unicode content" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const unicode_data = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = unicode_data;

    var tb = try UnifiedTextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const text = "Hello 世界\n🚀 Emoji\nΑλφα";
    try tb.setText(text);

    try testing.expectEqual(@as(u32, 3), tb.getLineCount());

    // Verify extraction preserves unicode
    var out_buffer: [100]u8 = undefined;
    const written = tb.getPlainTextIntoBuffer(&out_buffer);
    try testing.expectEqualStrings(text, out_buffer[0..written]);
}

test "UnifiedTextBuffer - view registration" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const unicode_data = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = unicode_data;

    var tb = try UnifiedTextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const view_id1 = try tb.registerView();
    const view_id2 = try tb.registerView();

    try testing.expect(view_id1 != view_id2);
    try testing.expect(tb.isViewDirty(view_id1));
    try testing.expect(tb.isViewDirty(view_id2));

    tb.clearViewDirty(view_id1);
    try testing.expect(!tb.isViewDirty(view_id1));
    try testing.expect(tb.isViewDirty(view_id2));

    tb.markViewsDirty();
    try testing.expect(tb.isViewDirty(view_id1));
    try testing.expect(tb.isViewDirty(view_id2));

    tb.unregisterView(view_id1);
    // After unregistering, ID should be reusable
    const view_id3 = try tb.registerView();
    try testing.expectEqual(view_id1, view_id3);
}

test "UnifiedTextBuffer - reset" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const unicode_data = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = unicode_data;

    var tb = try UnifiedTextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Some text\nMore text");
    try testing.expectEqual(@as(u32, 2), tb.getLineCount());

    tb.reset();
    try testing.expectEqual(@as(u32, 0), tb.getLength());
    try testing.expectEqual(@as(u32, 0), tb.getLineCount()); // After reset, truly empty (0 lines)
}

test "UnifiedTextBuffer - getLineInfo" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const unicode_data = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = unicode_data;

    var tb = try UnifiedTextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("First\nSecond\nThird");

    const line_info = tb.getLineInfo();
    try testing.expectEqual(@as(u32, 3), line_info.line_count);
    try testing.expectEqual(@as(usize, 3), line_info.starts.len);
    try testing.expectEqual(@as(usize, 3), line_info.widths.len);

    try testing.expectEqual(@as(u32, 0), line_info.starts[0]);
    try testing.expectEqual(@as(u32, 5), line_info.widths[0]);

    try testing.expectEqual(@as(u32, 5), line_info.starts[1]);
    try testing.expectEqual(@as(u32, 6), line_info.widths[1]);

    try testing.expectEqual(@as(u32, 11), line_info.starts[2]);
    try testing.expectEqual(@as(u32, 5), line_info.widths[2]);

    try testing.expectEqual(@as(u32, 6), line_info.max_width); // "Second" is longest
}

test "UnifiedTextBuffer - getLine compatibility" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const unicode_data = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = unicode_data;

    var tb = try UnifiedTextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("Line1\nLine2");

    const line0 = tb.getLine(0);
    try testing.expect(line0 != null);
    try testing.expectEqual(@as(u32, 0), line0.?.char_offset);
    try testing.expectEqual(@as(u32, 5), line0.?.width);

    const line1 = tb.getLine(1);
    try testing.expect(line1 != null);
    try testing.expectEqual(@as(u32, 5), line1.?.char_offset);
    try testing.expectEqual(@as(u32, 5), line1.?.width);

    const line_invalid = tb.getLine(10);
    try testing.expect(line_invalid == null);
}

test "UnifiedTextBuffer - walkLines compatibility" {
    const pool = gp.initGlobalPool(testing.allocator);
    defer gp.deinitGlobalPool();

    const unicode_data = gp.initGlobalUnicodeData(testing.allocator);
    defer gp.deinitGlobalUnicodeData(testing.allocator);
    const graphemes_ptr, const display_width_ptr = unicode_data;

    var tb = try UnifiedTextBuffer.init(testing.allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    try tb.setText("A\nBB\nCCC");

    const Context = struct {
        line_count: u32 = 0,
        total_width: u32 = 0,

        fn walker(ctx_ptr: *anyopaque, line: *const UnifiedTextBuffer.LineCompat, idx: u32) void {
            const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
            _ = idx;
            ctx.line_count += 1;
            ctx.total_width += line.width;
        }
    };

    var ctx = Context{};
    tb.walkLines(&ctx, Context.walker);

    try testing.expectEqual(@as(u32, 3), ctx.line_count);
    try testing.expectEqual(@as(u32, 6), ctx.total_width); // 1 + 2 + 3
}
