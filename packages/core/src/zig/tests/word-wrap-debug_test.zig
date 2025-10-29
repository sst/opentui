const std = @import("std");
const edit_buffer = @import("../edit-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const gp = @import("../grapheme.zig");

const EditBuffer = edit_buffer.EditBuffer;
const TextBufferView = text_buffer_view.TextBufferView;

test "Word wrap - debug rope structure with incremental edits" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);
    const graphemes_ptr, const display_width_ptr = gd;

    var eb = try EditBuffer.init(std.testing.allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer eb.deinit();

    var view = try TextBufferView.init(std.testing.allocator, eb.getTextBuffer());
    defer view.deinit();

    view.setWrapMode(.word);
    view.setWrapWidth(18);

    try eb.setText("hello my good ", false);

    {
        const rope_text = try eb.getTextBuffer().rope.toText(std.testing.allocator);
        defer std.testing.allocator.free(rope_text);
        std.debug.print("\n\nAfter setText 'hello my good ':\n{s}\n", .{rope_text});
    }

    var vlines = view.getVirtualLines();
    std.debug.print("Virtual lines: {}\n", .{vlines.len});

    // Type "f"
    try eb.setCursor(0, 14);
    try eb.insertText("f");

    {
        const rope_text = try eb.getTextBuffer().rope.toText(std.testing.allocator);
        defer std.testing.allocator.free(rope_text);
        std.debug.print("\nAfter insertText 'f':\n{s}\n", .{rope_text});
    }

    vlines = view.getVirtualLines();
    std.debug.print("Virtual lines: {}\n", .{vlines.len});

    // Type "r"
    try eb.insertText("r");
    {
        const rope_text = try eb.getTextBuffer().rope.toText(std.testing.allocator);
        defer std.testing.allocator.free(rope_text);
        std.debug.print("\nAfter insertText 'r':\n{s}\n", .{rope_text});
    }

    vlines = view.getVirtualLines();
    std.debug.print("Virtual lines: {}\n", .{vlines.len});

    // Type "i"
    try eb.insertText("i");
    {
        const rope_text = try eb.getTextBuffer().rope.toText(std.testing.allocator);
        defer std.testing.allocator.free(rope_text);
        std.debug.print("\nAfter insertText 'i':\n{s}\n", .{rope_text});
    }

    vlines = view.getVirtualLines();
    std.debug.print("Virtual lines: {}\n", .{vlines.len});

    // Type "e"
    try eb.insertText("e");
    {
        const rope_text = try eb.getTextBuffer().rope.toText(std.testing.allocator);
        defer std.testing.allocator.free(rope_text);
        std.debug.print("\nAfter insertText 'e':\n{s}\n", .{rope_text});
    }

    vlines = view.getVirtualLines();
    std.debug.print("Virtual lines: {}\n", .{vlines.len});

    // Type "n"
    try eb.insertText("n");
    {
        const rope_text = try eb.getTextBuffer().rope.toText(std.testing.allocator);
        defer std.testing.allocator.free(rope_text);
        std.debug.print("\nAfter insertText 'n':\n{s}\n", .{rope_text});
    }

    vlines = view.getVirtualLines();
    std.debug.print("Virtual lines: {}\n", .{vlines.len});

    // Type "d"
    try eb.insertText("d");
    {
        const rope_text = try eb.getTextBuffer().rope.toText(std.testing.allocator);
        defer std.testing.allocator.free(rope_text);
        std.debug.print("\nAfter insertText 'd':\n{s}\n", .{rope_text});
    }

    vlines = view.getVirtualLines();
    std.debug.print("Virtual lines: {}\n", .{vlines.len});

    std.debug.print("\n", .{});
}
