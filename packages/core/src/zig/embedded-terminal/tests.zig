const std = @import("std");
const EmbeddedTerminal = @import("main.zig").EmbeddedTerminal;
const ghostty = @import("ghostty.zig");

test "embedded terminal supports lifecycle, resize, and viewport scroll" {
    const terminal = try EmbeddedTerminal.init(std.testing.io, std.testing.allocator, .{ .cols = 80, .rows = 24 });
    defer terminal.deinit();

    try terminal.write("hello");
    try terminal.resize(100, 40);
    terminal.scroll(-3);
    terminal.scroll(3);

    try std.testing.expectEqual(@as(u16, 100), terminal.cols);
    try std.testing.expectEqual(@as(u16, 40), terminal.rows);
    try std.testing.expectError(error.InvalidValue, terminal.resize(0, 40));
    try std.testing.expectError(error.InvalidValue, terminal.resize(100, 0));
    try std.testing.expectError(error.InvalidValue, EmbeddedTerminal.init(std.testing.io, std.testing.allocator, .{ .cols = 0, .rows = 24 }));
}

test "embedded terminal preserves parser state and provides mode-aware input" {
    const terminal = try EmbeddedTerminal.init(std.testing.io, std.testing.allocator, .{ .cols = 20, .rows = 4 });
    defer terminal.deinit();

    try terminal.write("\x1b[?20");
    try terminal.write("04h\x1b[?1004h\x1b[?1000h\x1b[?1006h");

    const paste = try terminal.encodePaste("one\ntwo");
    defer terminal.freeEncoded(paste);
    try std.testing.expectEqualStrings("\x1b[200~one\ntwo\x1b[201~", paste);

    const focus = try terminal.encodeFocus(true);
    defer terminal.freeEncoded(focus);
    try std.testing.expectEqualStrings("\x1b[I", focus);

    const key = try terminal.encodeKey(.{ .key = .enter });
    defer terminal.freeEncoded(key);
    try std.testing.expectEqualStrings("\r", key);

    const mouse = try terminal.encodeMouse(.{
        .action = .press,
        .button = .left,
        .x = 0,
        .y = 0,
        .any_button_pressed = true,
    });
    defer terminal.freeEncoded(mouse);
    try std.testing.expectEqualStrings("\x1b[<0;1;1M", mouse);
}

test "embedded terminal encodes long Kitty associated text" {
    const terminal = try EmbeddedTerminal.init(std.testing.io, std.testing.allocator, .{ .cols = 20, .rows = 4 });
    defer terminal.deinit();
    try terminal.write("\x1b[>19u");

    const text = "x" ** 2048;
    const encoded = try terminal.encodeKey(.{ .key = .unidentified, .utf8 = text });
    defer terminal.freeEncoded(encoded);
    try std.testing.expectEqualStrings(text, encoded);
}

test "embedded terminal drains generated PTY responses incrementally" {
    const terminal = try EmbeddedTerminal.init(std.testing.io, std.testing.allocator, .{ .cols = 20, .rows = 4 });
    defer terminal.deinit();

    try terminal.write("\x1b[5n");
    var first: [2]u8 = undefined;
    var rest: [16]u8 = undefined;
    const first_len = try terminal.drainResponses(&first);
    const rest_len = try terminal.drainResponses(&rest);

    var combined: [18]u8 = undefined;
    @memcpy(combined[0..first_len], first[0..first_len]);
    @memcpy(combined[first_len .. first_len + rest_len], rest[0..rest_len]);
    try std.testing.expectEqualStrings("\x1b[0n", combined[0 .. first_len + rest_len]);
}

test "embedded terminal preserves queued responses when the bound is reached" {
    const terminal = try EmbeddedTerminal.init(std.testing.io, std.testing.allocator, .{ .cols = 20, .rows = 4 });
    defer terminal.deinit();

    const query = "\x1b[5n";
    const count = @import("main.zig").response_limit / query.len + 1;
    const input = try std.testing.allocator.alloc(u8, count * query.len);
    defer std.testing.allocator.free(input);
    for (0..count) |index| @memcpy(input[index * query.len ..][0..query.len], query);

    try terminal.write(input);
    var byte: [1]u8 = undefined;
    try std.testing.expectError(error.ResponseOverflow, terminal.drainResponses(&byte));

    var preserved: [16]u8 = undefined;
    const preserved_len = try terminal.drainResponses(&preserved);
    try std.testing.expect(preserved_len > 0);
}

test "embedded terminal reports semantic failures per write" {
    const terminal = try EmbeddedTerminal.init(std.testing.io, std.testing.allocator, .{ .cols = 20, .rows = 4 });
    defer terminal.deinit();

    terminal.stream.handler.semantic_failure = true;
    try terminal.write("ok");
    try std.testing.expect(!terminal.stream.handler.semantic_failure);
}

test "embedded terminal resets mouse motion deduplication after resize" {
    const terminal = try EmbeddedTerminal.init(std.testing.io, std.testing.allocator, .{ .cols = 20, .rows = 4 });
    defer terminal.deinit();
    try terminal.write("\x1b[?1003h\x1b[?1006h");

    const mouse: ghostty.Mouse = .{ .action = .motion, .x = 0, .y = 0 };
    const first = try terminal.encodeMouse(mouse);
    defer terminal.freeEncoded(first);
    try std.testing.expect(first.len > 0);

    const duplicate = try terminal.encodeMouse(mouse);
    defer terminal.freeEncoded(duplicate);
    try std.testing.expectEqual(@as(usize, 0), duplicate.len);

    try terminal.resize(10, 4);
    const after_resize = try terminal.encodeMouse(mouse);
    defer terminal.freeEncoded(after_resize);
    try std.testing.expect(after_resize.len > 0);
}

comptime {
    _ = ghostty;
}
