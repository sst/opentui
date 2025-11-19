const std = @import("std");
const testing = std.testing;
const Terminal = @import("../terminal.zig");

test "parseXtversion - kitty format" {
    var term = Terminal.init(.{});
    const response = "\x1bP>|kitty(0.40.1)\x1b\\";
    term.processCapabilityResponse(response);

    try testing.expectEqualStrings("kitty", term.getTerminalName());
    try testing.expectEqualStrings("0.40.1", term.getTerminalVersion());
    try testing.expect(term.term_info.from_xtversion);
}

test "parseXtversion - ghostty format" {
    var term = Terminal.init(.{});
    const response = "\x1bP>|ghostty 1.1.3\x1b\\";
    term.processCapabilityResponse(response);

    try testing.expectEqualStrings("ghostty", term.getTerminalName());
    try testing.expectEqualStrings("1.1.3", term.getTerminalVersion());
    try testing.expect(term.term_info.from_xtversion);
}

test "parseXtversion - tmux format" {
    var term = Terminal.init(.{});
    const response = "\x1bP>|tmux 3.5a\x1b\\";
    term.processCapabilityResponse(response);

    try testing.expectEqualStrings("tmux", term.getTerminalName());
    try testing.expectEqualStrings("3.5a", term.getTerminalVersion());
    try testing.expect(term.term_info.from_xtversion);
}

test "parseXtversion - with prefix data" {
    var term = Terminal.init(.{});
    const response = "\x1b[1;1R\x1bP>|tmux 3.5a\x1b\\";
    term.processCapabilityResponse(response);

    try testing.expectEqualStrings("tmux", term.getTerminalName());
    try testing.expectEqualStrings("3.5a", term.getTerminalVersion());
    try testing.expect(term.term_info.from_xtversion);
}

test "parseXtversion - full kitty response" {
    var term = Terminal.init(.{});
    const response = "\x1b[?1016;2$y\x1b[?2027;0$y\x1b[?2031;2$y\x1b[?1004;1$y\x1b[?2026;2$y\x1b[1;2R\x1b[1;3R\x1bP>|kitty(0.40.1)\x1b\\\x1b[?0u\x1b_Gi=1;EINVAL:Zero width/height not allowed\x1b\\\x1b[?62;c";
    term.processCapabilityResponse(response);

    try testing.expectEqualStrings("kitty", term.getTerminalName());
    try testing.expectEqualStrings("0.40.1", term.getTerminalVersion());
    try testing.expect(term.term_info.from_xtversion);
    try testing.expect(term.caps.kitty_keyboard);
    try testing.expect(term.caps.kitty_graphics);
}

test "parseXtversion - full ghostty response" {
    var term = Terminal.init(.{});
    const response = "\x1b[?1016;1$y\x1b[?2027;1$y\x1b[?2031;2$y\x1b[?1004;1$y\x1b[?2004;2$y\x1b[?2026;2$y\x1b[1;1R\x1b[1;1R\x1bP>|ghostty 1.1.3\x1b\\\x1b[?0u\x1b_Gi=1;OK\x1b\\\x1b[?62;22c";
    term.processCapabilityResponse(response);

    try testing.expectEqualStrings("ghostty", term.getTerminalName());
    try testing.expectEqualStrings("1.1.3", term.getTerminalVersion());
    try testing.expect(term.term_info.from_xtversion);
}

test "environment variables - should be overridden by xtversion" {
    var term = Terminal.init(.{});

    // First check environment (simulated by setting values directly)
    term.term_info.name_len = 6;
    @memcpy(term.term_info.name[0..6], "vscode");
    term.term_info.version_len = 5;
    @memcpy(term.term_info.version[0..5], "1.0.0");
    term.term_info.from_xtversion = false;

    try testing.expectEqualStrings("vscode", term.getTerminalName());
    try testing.expectEqualStrings("1.0.0", term.getTerminalVersion());
    try testing.expect(!term.term_info.from_xtversion);

    // Now process xtversion response - should override
    const response = "\x1bP>|kitty(0.40.1)\x1b\\";
    term.processCapabilityResponse(response);

    try testing.expectEqualStrings("kitty", term.getTerminalName());
    try testing.expectEqualStrings("0.40.1", term.getTerminalVersion());
    try testing.expect(term.term_info.from_xtversion);
}

test "parseXtversion - terminal name only" {
    var term = Terminal.init(.{});
    const response = "\x1bP>|wezterm\x1b\\";
    term.processCapabilityResponse(response);

    try testing.expectEqualStrings("wezterm", term.getTerminalName());
    try testing.expectEqualStrings("", term.getTerminalVersion());
    try testing.expect(term.term_info.from_xtversion);
}

test "parseXtversion - empty response" {
    var term = Terminal.init(.{});

    const initial_name_len = term.term_info.name_len;
    const initial_version_len = term.term_info.version_len;

    const response = "\x1bP>|\x1b\\";
    term.processCapabilityResponse(response);

    try testing.expectEqual(initial_name_len, term.term_info.name_len);
    try testing.expectEqual(initial_version_len, term.term_info.version_len);
}
