const std = @import("std");
const builtin = @import("builtin");
const ansi = @import("../ansi.zig");
const buffer = @import("../buffer.zig");
const gp = @import("../grapheme.zig");
const EmbeddedTerminal = @import("main.zig").EmbeddedTerminal;

fn libraryPath() ![]u8 {
    if (builtin.os.tag == .linux and builtin.abi == .musl) return error.SkipZigTest;
    return std.process.getEnvVarOwned(std.testing.allocator, "OPENTUI_GHOSTTY_VT_LIBRARY") catch
        return error.SkipZigTest;
}

test "embedded terminal composes dirty Ghostty rows into an OptimizedBuffer" {
    const path = try libraryPath();
    defer std.testing.allocator.free(path);

    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var target = try buffer.OptimizedBuffer.init(std.testing.allocator, 12, 4, .{ .pool = pool });
    defer target.deinit();
    target.clear(ansi.rgbColor(0, 0, 0, 255), null);

    const terminal = try EmbeddedTerminal.init(std.testing.allocator, .{
        .cols = 8,
        .rows = 2,
        .library_path = path,
    });
    defer terminal.deinit();

    terminal.write("A\x1b[1;32mB\x1b[0m\r\nwide: \xe7\x95\x8c");
    const first = try terminal.compose(target, 2, 1);
    try std.testing.expectEqual(@import("ghostty.zig").Dirty.full, first.dirty);
    try std.testing.expectEqual(@as(u32, 2), first.rows);
    try std.testing.expectEqual(@as(u32, 'A'), target.get(2, 1).?.char);
    try std.testing.expectEqual(@as(u32, 'B'), target.get(3, 1).?.char);
    try std.testing.expect(target.get(3, 1).?.attributes & ansi.TextAttributes.BOLD != 0);
    try std.testing.expect(ansi.green(target.get(3, 1).?.fg) > ansi.red(target.get(3, 1).?.fg));
    try std.testing.expect(gp.isGraphemeChar(target.get(8, 2).?.char));
    try std.testing.expect(gp.isContinuationChar(target.get(9, 2).?.char));

    const clean = try terminal.compose(target, 2, 1);
    try std.testing.expectEqual(@import("ghostty.zig").Dirty.clean, clean.dirty);
    try std.testing.expectEqual(@as(u32, 0), clean.rows);

    try terminal.invalidate();
    const invalidated = try terminal.compose(target, 1, 0);
    try std.testing.expectEqual(@import("ghostty.zig").Dirty.full, invalidated.dirty);
    try std.testing.expectEqual(@as(u32, 2), invalidated.rows);
}

test "embedded terminal redraws changed rows and clips composition" {
    const path = try libraryPath();
    defer std.testing.allocator.free(path);

    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var target = try buffer.OptimizedBuffer.init(std.testing.allocator, 5, 2, .{ .pool = pool });
    defer target.deinit();

    const terminal = try EmbeddedTerminal.init(std.testing.allocator, .{
        .cols = 4,
        .rows = 2,
        .library_path = path,
    });
    defer terminal.deinit();

    terminal.write("abcd");
    _ = try terminal.compose(target, -1, 0);
    try std.testing.expectEqual(@as(u32, 'b'), target.get(0, 0).?.char);
    try std.testing.expectEqual(@as(u32, 'd'), target.get(2, 0).?.char);

    terminal.write("\x1b[1;2HZ");
    const partial = try terminal.compose(target, -1, 0);
    try std.testing.expectEqual(@import("ghostty.zig").Dirty.partial, partial.dirty);
    try std.testing.expectEqual(@as(u32, 1), partial.rows);
    try std.testing.expectEqual(@as(u32, 'Z'), target.get(0, 0).?.char);

    try terminal.resize(5, 2);
    const resized = try terminal.compose(target, 0, 0);
    try std.testing.expectEqual(@import("ghostty.zig").Dirty.full, resized.dirty);
}

test "embedded terminal reports a missing runtime library" {
    try std.testing.expectError(
        error.LibraryNotFound,
        EmbeddedTerminal.init(std.testing.allocator, .{
            .cols = 80,
            .rows = 24,
            .library_path = "/path/that/does/not/exist/libghostty-vt.so",
        }),
    );
}

test "embedded terminal supports lifecycle, resize, and viewport scroll" {
    const path = try libraryPath();
    defer std.testing.allocator.free(path);

    try std.testing.expectError(
        error.InvalidValue,
        EmbeddedTerminal.init(std.testing.allocator, .{
            .cols = 0,
            .rows = 24,
            .library_path = path,
        }),
    );

    const terminal = try EmbeddedTerminal.init(std.testing.allocator, .{
        .cols = 80,
        .rows = 24,
        .library_path = path,
    });
    defer terminal.deinit();

    terminal.write("hello");
    try terminal.resize(100, 40);
    terminal.scroll(-3);
    terminal.scroll(3);
    try std.testing.expectError(error.InvalidValue, terminal.resize(0, 40));
    try std.testing.expectError(error.InvalidValue, terminal.resize(100, 0));
}

test "embedded terminal exposes cursor and mode-aware input encoders" {
    const path = try libraryPath();
    defer std.testing.allocator.free(path);

    const terminal = try EmbeddedTerminal.init(std.testing.allocator, .{
        .cols = 20,
        .rows = 4,
        .library_path = path,
    });
    defer terminal.deinit();

    terminal.write("\x1b[2;3H\x1b[5 q\x1b[?1004h\x1b[?2004h\x1b[?1000h\x1b[?1006h");

    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var target = try buffer.OptimizedBuffer.init(std.testing.allocator, 20, 4, .{ .pool = pool });
    defer target.deinit();
    _ = try terminal.compose(target, 0, 0);

    const cursor = try terminal.cursor();
    try std.testing.expect(cursor.has_value);
    try std.testing.expect(cursor.visible);
    try std.testing.expectEqual(@as(u16, 2), cursor.x);
    try std.testing.expectEqual(@as(u16, 1), cursor.y);
    try std.testing.expectEqual(@import("ghostty.zig").CursorVisualStyle.bar, cursor.style);

    var output: [128]u8 = undefined;
    const focus_len = try terminal.encodeFocus(true, &output);
    try std.testing.expectEqualStrings("\x1b[I", output[0..focus_len]);

    const paste_len = try terminal.encodePaste("one\ntwo", &output);
    try std.testing.expectEqualStrings("\x1b[200~one\ntwo\x1b[201~", output[0..paste_len]);

    const key_len = try terminal.encodeKey(.{ .key = 58 }, &output);
    try std.testing.expectEqualStrings("\r", output[0..key_len]);

    const mouse_len = try terminal.encodeMouse(.{
        .action = .press,
        .button = .left,
        .x = 0,
        .y = 0,
        .any_button_pressed = true,
    }, &output);
    try std.testing.expectEqualStrings("\x1b[<0;1;1M", output[0..mouse_len]);

    terminal.write("\x1b[5n");
    var response: [6]u8 = undefined;
    const first_len = try terminal.drainResponses(response[0..2]);
    const second_len = try terminal.drainResponses(response[first_len..]);
    try std.testing.expectEqualStrings("\x1b[0n", response[0 .. first_len + second_len]);
}
