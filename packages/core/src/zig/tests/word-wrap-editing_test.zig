const std = @import("std");
const edit_buffer = @import("../edit-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const gp = @import("../grapheme.zig");

const EditBuffer = edit_buffer.EditBuffer;
const TextBufferView = text_buffer_view.TextBufferView;

test "Word wrap - editing around wrap boundary creates correct wrap" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(18);

    try eb.setText("hello my good");

    const vlines1 = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines1.len);

    try eb.setCursor(0, 13);
    try eb.insertText(" friend");

    const vlines2 = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), vlines2.len);

    try std.testing.expectEqual(@as(u32, 14), vlines2[0].width);
    try std.testing.expectEqual(@as(u32, 6), vlines2[1].width);
}

test "Word wrap - backspace and retype near boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(18);

    try eb.setText("hello my good friend");

    var vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), vlines.len);

    try eb.setCursor(0, 20);
    var i: usize = 0;
    while (i < 7) : (i += 1) {
        try eb.backspace();
    }

    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    try eb.insertText(" friend");

    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), vlines.len);

    try std.testing.expectEqual(@as(u32, 14), vlines[0].width);
    try std.testing.expectEqual(@as(u32, 6), vlines[1].width);
}

test "Word wrap - type character by character near boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(18);

    try eb.setText("hello my good ");

    var vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    try eb.setCursor(0, 14);
    try eb.insertText("f");

    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    try eb.insertText("r");
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    try eb.insertText("i");
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    try eb.insertText("e");
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    try eb.insertText("n");
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), vlines.len);

    try eb.insertText("d");
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), vlines.len);

    try eb.insertText(" ");
    vlines = view.getVirtualLines();

    try std.testing.expectEqual(@as(usize, 2), vlines.len);
    try std.testing.expectEqual(@as(u32, 14), vlines[0].width);
    try std.testing.expectEqual(@as(u32, 7), vlines[1].width);
}

test "Word wrap - insert word in middle causes rewrap" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(20);

    try eb.setText("hello friend");

    var vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    try eb.setCursor(0, 6);
    try eb.insertText("my good ");

    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);
}

test "Word wrap - delete word causes rewrap" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(18);

    try eb.setText("hello my good friend buddy");

    var vlines = view.getVirtualLines();
    try std.testing.expect(vlines.len >= 2);

    try eb.setCursor(0, 6);
    var i: usize = 0;
    while (i < 8) : (i += 1) {
        try eb.deleteForward();
    }

    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);
}

test "Word wrap - rapid edits maintain correct wrapping" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(18);

    try eb.setText("hello my ");
    try eb.setCursor(0, 9);
    try eb.insertText("g");
    try eb.insertText("o");
    try eb.insertText("o");
    try eb.insertText("d");
    try eb.insertText(" ");
    try eb.insertText("f");
    try eb.insertText("r");
    try eb.insertText("i");
    try eb.insertText("e");
    try eb.insertText("n");
    try eb.insertText("d");

    const vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), vlines.len);

    try std.testing.expectEqual(@as(u32, 14), vlines[0].width);
    try std.testing.expectEqual(@as(u32, 6), vlines[1].width);
}

test "Word wrap - fragmented at exact word boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(18);

    try eb.setText("hello ");
    try eb.setCursor(0, 6);
    try eb.insertText("my ");
    try eb.insertText("good ");
    try eb.insertText("friend");

    const vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), vlines.len);
    try std.testing.expectEqual(@as(u32, 14), vlines[0].width);
    try std.testing.expectEqual(@as(u32, 6), vlines[1].width);
}

test "Word wrap - chunk boundary at start of word" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(18);

    try eb.setText("hello my good ");
    try eb.setCursor(0, 14);

    try eb.insertText("f");

    try eb.backspace();
    try eb.insertText("friend");

    const vlines = view.getVirtualLines();

    try std.testing.expectEqual(@as(usize, 2), vlines.len);
    try std.testing.expectEqual(@as(u32, 14), vlines[0].width);
    try std.testing.expectEqual(@as(u32, 6), vlines[1].width);
}

test "Word wrap - multiple edits create complex fragmentation" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(20);

    try eb.setText("hello ");
    try eb.setCursor(0, 6);
    try eb.insertText("w");
    try eb.backspace();
    try eb.insertText("m");
    try eb.insertText("y");
    try eb.insertText(" ");
    try eb.insertText("g");
    try eb.insertText("o");
    try eb.backspace();
    try eb.insertText("o");
    try eb.insertText("o");
    try eb.insertText("d");
    try eb.insertText(" ");
    try eb.insertText("x");
    try eb.backspace();
    try eb.insertText("f");
    try eb.insertText("r");
    try eb.insertText("iend");

    const vlines = view.getVirtualLines();

    var buffer: [100]u8 = undefined;
    const len = view.getPlainTextIntoBuffer(&buffer);
    try std.testing.expectEqualStrings("hello my good friend", buffer[0..len]);

    try std.testing.expectEqual(@as(usize, 1), vlines.len);
}

test "Word wrap - insert at wrap boundary with existing wrap" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(15);

    try eb.setText("hello world test");

    var vlines = view.getVirtualLines();
    try std.testing.expect(vlines.len >= 2);

    try eb.setCursor(0, 11);
    try eb.insertText("s");

    vlines = view.getVirtualLines();

    try std.testing.expect(vlines.len >= 2);

    for (vlines) |vline| {
        try std.testing.expect(vline.width <= 15);
    }
}

test "Word wrap - word at exact wrap width" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(20);

    try eb.setText("12345678901234567890");

    var vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    try eb.setCursor(0, 20);
    try eb.insertText(" word");

    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), vlines.len);
    try std.testing.expectEqual(@as(u32, 20), vlines[0].width);
    try std.testing.expectEqual(@as(u32, 5), vlines[1].width);
}

test "Word wrap - debug virtual line contents" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(18);

    try eb.setText("hello my good ");
    try eb.setCursor(0, 14);
    try eb.insertText("f");
    try eb.backspace();
    try eb.insertText("friend");

    const vlines = view.getVirtualLines();

    try std.testing.expectEqual(@as(usize, 2), vlines.len);
}

test "Word wrap - incremental character edits near boundary" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(18);

    try eb.setText("hello my good ");

    var vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    try eb.setCursor(0, 14);
    try eb.insertText("f");
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    try eb.insertText("r");
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    try eb.insertText("i");
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    try eb.insertText("e");
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 1), vlines.len);

    try eb.insertText("n");
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), vlines.len);

    try eb.insertText("d");
    vlines = view.getVirtualLines();
    try std.testing.expectEqual(@as(usize, 2), vlines.len);

    try std.testing.expectEqual(@as(u32, 14), vlines[0].width);
    try std.testing.expectEqual(@as(u32, 6), vlines[1].width);
}
