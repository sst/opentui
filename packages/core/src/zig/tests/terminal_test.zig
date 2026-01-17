const std = @import("std");
const testing = std.testing;
const Terminal = @import("../terminal.zig");
const utf8 = @import("../utf8.zig");

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

// Test buffer for capturing terminal output
const TestWriter = struct {
    buffer: std.ArrayListUnmanaged(u8),
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) TestWriter {
        return .{ .buffer = .{}, .allocator = allocator };
    }

    pub fn deinit(self: *TestWriter) void {
        self.buffer.deinit(self.allocator);
    }

    pub fn writeAll(self: *TestWriter, data: []const u8) !void {
        try self.buffer.appendSlice(self.allocator, data);
    }

    pub fn print(self: *TestWriter, comptime fmt: []const u8, args: anytype) !void {
        try self.buffer.writer(self.allocator).print(fmt, args);
    }

    pub fn getWritten(self: *TestWriter) []const u8 {
        return self.buffer.items;
    }

    pub fn reset(self: *TestWriter) void {
        self.buffer.clearRetainingCapacity();
    }
};

test "queryTerminalSend - sends unwrapped queries when not in tmux" {
    // Note: This test may fail if running inside tmux since checkEnvironmentOverrides
    // reads TMUX/TERM env vars. We test the logic directly instead.
    var term = Terminal.init(.{});

    // Skip test if actually running in tmux
    if (term.in_tmux) return error.SkipZigTest;

    var writer = TestWriter.init(testing.allocator);
    defer writer.deinit();

    try term.queryTerminalSend(&writer);

    const output = writer.getWritten();

    // Should contain xtversion
    try testing.expect(std.mem.indexOf(u8, output, "\x1b[>0q") != null);

    // Should contain unwrapped DECRQM queries (single ESC)
    try testing.expect(std.mem.indexOf(u8, output, "\x1b[?1016$p") != null);
    try testing.expect(std.mem.indexOf(u8, output, "\x1b[?2027$p") != null);
    try testing.expect(std.mem.indexOf(u8, output, "\x1b[?u") != null);

    // Should NOT contain tmux DCS wrapper
    try testing.expect(std.mem.indexOf(u8, output, "\x1bPtmux;") == null);

    // Should mark capability queries as pending
    try testing.expect(term.capability_queries_pending);
}

test "queryTerminalSend - sends DCS wrapped queries when in tmux" {
    // Note: This test checks logic when in_tmux is true.
    // We can't easily force in_tmux=true since checkEnvironmentOverrides resets it,
    // so we test this via sendPendingQueries tests instead.
    var term = Terminal.init(.{});

    // Only run the DCS wrapping test if actually in tmux
    if (!term.in_tmux) return error.SkipZigTest;

    var writer = TestWriter.init(testing.allocator);
    defer writer.deinit();

    try term.queryTerminalSend(&writer);

    const output = writer.getWritten();

    // Should contain xtversion (unwrapped - used for detection)
    try testing.expect(std.mem.indexOf(u8, output, "\x1b[>0q") != null);

    // Should contain tmux DCS wrapper start and doubled ESC for queries
    // wrapForTmux wraps all queries together with one DCS envelope
    try testing.expect(std.mem.indexOf(u8, output, "\x1bPtmux;\x1b\x1b[?1016$p") != null);

    // Should NOT mark capability queries as pending (already sent wrapped)
    try testing.expect(!term.capability_queries_pending);
}

test "sendPendingQueries - sends wrapped queries after tmux detected via xtversion" {
    var term = Terminal.init(.{});
    term.in_tmux = false;
    term.capability_queries_pending = true;
    term.graphics_query_pending = true;

    // Simulate tmux detected via xtversion
    term.term_info.from_xtversion = true;
    term.term_info.name_len = 4;
    @memcpy(term.term_info.name[0..4], "tmux");

    var writer = TestWriter.init(testing.allocator);
    defer writer.deinit();

    const did_send = try term.sendPendingQueries(&writer);

    try testing.expect(did_send);

    const output = writer.getWritten();

    // Should send DCS wrapped capability queries (wrapForTmux wraps all queries together)
    try testing.expect(std.mem.indexOf(u8, output, "\x1bPtmux;\x1b\x1b[?1016$p") != null);

    // Should send DCS wrapped graphics query
    try testing.expect(std.mem.indexOf(u8, output, "\x1bPtmux;\x1b\x1b_G") != null);

    // Should clear pending flags
    try testing.expect(!term.capability_queries_pending);
    try testing.expect(!term.graphics_query_pending);
}

test "sendPendingQueries - sends unwrapped graphics query for non-tmux terminal" {
    var term = Terminal.init(.{});
    term.in_tmux = false;
    term.capability_queries_pending = true;
    term.graphics_query_pending = true;

    // Simulate non-tmux terminal detected via xtversion
    term.term_info.from_xtversion = true;
    term.term_info.name_len = 5;
    @memcpy(term.term_info.name[0..5], "kitty");

    var writer = TestWriter.init(testing.allocator);
    defer writer.deinit();

    const did_send = try term.sendPendingQueries(&writer);

    try testing.expect(did_send);

    const output = writer.getWritten();

    // Should NOT send DCS wrapped capability queries (not tmux)
    try testing.expect(std.mem.indexOf(u8, output, "\x1bPtmux;") == null);

    // Should send unwrapped graphics query
    try testing.expect(std.mem.indexOf(u8, output, "\x1b_Gi=31337") != null);

    // Should clear pending flags
    try testing.expect(!term.capability_queries_pending);
    try testing.expect(!term.graphics_query_pending);
}

test "sendPendingQueries - sends unwrapped graphics query even without xtversion response" {
    // This covers terminals that support kitty graphics but don't respond to xtversion.
    // The graphics query should still be sent (unwrapped) so we can detect graphics support.
    var term = Terminal.init(.{});
    term.in_tmux = false;
    term.term_info.from_xtversion = false;
    term.capability_queries_pending = true;
    term.graphics_query_pending = true;

    var writer = TestWriter.init(testing.allocator);
    defer writer.deinit();

    const did_send = try term.sendPendingQueries(&writer);

    try testing.expect(did_send);

    const output = writer.getWritten();

    // Should send unwrapped graphics query (not tmux, so no DCS wrapper)
    try testing.expect(std.mem.indexOf(u8, output, "\x1b_Gi=31337") != null);
    try testing.expect(std.mem.indexOf(u8, output, "\x1bPtmux;") == null);

    // Should clear graphics pending flag
    try testing.expect(!term.graphics_query_pending);

    // Capability queries should NOT be re-sent (no xtversion means we don't know if tmux,
    // but they were already sent unwrapped in queryTerminalSend)
    try testing.expect(!term.capability_queries_pending);
}

test "sendPendingQueries - skips graphics when skip_graphics_query is set" {
    var term = Terminal.init(.{});
    term.in_tmux = true;
    term.skip_graphics_query = true;
    term.graphics_query_pending = true;
    term.capability_queries_pending = false;

    var writer = TestWriter.init(testing.allocator);
    defer writer.deinit();

    const did_send = try term.sendPendingQueries(&writer);

    try testing.expect(!did_send);

    const output = writer.getWritten();
    try testing.expect(std.mem.indexOf(u8, output, "Gi=31337") == null);
}

test "isXtversionTmux - detects tmux from xtversion" {
    var term = Terminal.init(.{});

    // Not from xtversion
    term.term_info.from_xtversion = false;
    term.term_info.name_len = 4;
    @memcpy(term.term_info.name[0..4], "tmux");
    try testing.expect(!term.isXtversionTmux());

    // From xtversion but not tmux
    term.term_info.from_xtversion = true;
    term.term_info.name_len = 5;
    @memcpy(term.term_info.name[0..5], "kitty");
    try testing.expect(!term.isXtversionTmux());

    // From xtversion and is tmux
    term.term_info.name_len = 4;
    @memcpy(term.term_info.name[0..4], "tmux");
    try testing.expect(term.isXtversionTmux());
}

// ============================================================================
// GRAPHEME CURSOR POSITIONING CAPABILITY TESTS
// ============================================================================

test "processCapabilityResponse - tmux sets explicit_cursor_positioning" {
    var term: Terminal = .{};

    term.caps.explicit_cursor_positioning = false;
    term.caps.unicode = .unicode;

    const response = "\x1bP>|tmux 3.5a\x1b\\";
    term.processCapabilityResponse(response);

    try testing.expect(term.caps.explicit_cursor_positioning);
    try testing.expectEqual(utf8.WidthMethod.wcwidth, term.caps.unicode);
}

test "processCapabilityResponse - alacritty sets explicit_cursor_positioning" {
    var term: Terminal = .{};

    term.caps.explicit_cursor_positioning = false;

    const response = "\x1bP>|alacritty 0.13.0\x1b\\";
    term.processCapabilityResponse(response);

    try testing.expect(term.caps.explicit_cursor_positioning);
}

test "processCapabilityResponse - kitty does not set explicit_cursor_positioning" {
    var term: Terminal = .{};

    term.caps.explicit_cursor_positioning = false;

    const response = "\x1bP>|kitty(0.40.1)\x1b\\";
    term.processCapabilityResponse(response);

    try testing.expect(!term.caps.explicit_cursor_positioning);
}

test "processCapabilityResponse - ghostty does not set explicit_cursor_positioning" {
    var term: Terminal = .{};

    term.caps.explicit_cursor_positioning = false;

    const response = "\x1bP>|ghostty 1.1.3\x1b\\";
    term.processCapabilityResponse(response);

    try testing.expect(!term.caps.explicit_cursor_positioning);
}
