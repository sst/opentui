const std = @import("std");
const EmbeddedTerminal = @import("main.zig").EmbeddedTerminal;

fn libraryPath() ![]u8 {
    return std.process.getEnvVarOwned(std.testing.allocator, "OPENTUI_GHOSTTY_VT_LIBRARY") catch
        return error.SkipZigTest;
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

test "embedded terminal provides mode-aware input encoders and responses" {
    const path = try libraryPath();
    defer std.testing.allocator.free(path);

    const terminal = try EmbeddedTerminal.init(std.testing.allocator, .{
        .cols = 20,
        .rows = 4,
        .library_path = path,
    });
    defer terminal.deinit();

    terminal.write("\x1b[?1004h\x1b[?2004h\x1b[?1000h\x1b[?1006h");

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
