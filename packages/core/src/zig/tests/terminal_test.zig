const std = @import("std");
const builtin = @import("builtin");
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
    try testing.expect(term.caps.osc52);
}

test "parseXtversion - ghostty format" {
    var term = Terminal.init(.{});
    const response = "\x1bP>|ghostty 1.1.3\x1b\\";
    term.processCapabilityResponse(response);

    try testing.expectEqualStrings("ghostty", term.getTerminalName());
    try testing.expectEqualStrings("1.1.3", term.getTerminalVersion());
    try testing.expect(term.term_info.from_xtversion);
    try testing.expect(term.caps.osc52);
}

test "parseXtversion - tmux format" {
    var term = Terminal.init(.{});
    const response = "\x1bP>|tmux 3.5a\x1b\\";
    term.processCapabilityResponse(response);

    try testing.expectEqualStrings("tmux", term.getTerminalName());
    try testing.expectEqualStrings("3.5a", term.getTerminalVersion());
    try testing.expect(term.term_info.from_xtversion);
    try testing.expect(term.caps.osc52);
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
    try testing.expect(term.caps.osc52);
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

test "remote ignores env overrides but accepts capability responses" {
    if (builtin.os.tag == .windows) return error.SkipZigTest;

    var env = std.process.EnvMap.init(testing.allocator);
    defer env.deinit();
    try env.put("TMUX", "/tmp/tmux-1000/default,12345,0");
    try env.put("TERM_PROGRAM", "iTerm.app");
    try env.put("WT_SESSION", "test-session");

    var term = Terminal.init(.{ .remote = true, .env_map = &env });

    try testing.expect(!term.in_tmux);
    try testing.expect(!term.caps.osc52);
    try testing.expect(!term.caps.explicit_cursor_positioning);

    term.processCapabilityResponse("\x1bP>|kitty(0.40.1)\x1b\\");
    try testing.expect(term.caps.osc52);
}

test "parseXtversion - terminal name only" {
    var term = Terminal.init(.{});
    const response = "\x1bP>|wezterm\x1b\\";
    term.processCapabilityResponse(response);

    try testing.expectEqualStrings("wezterm", term.getTerminalName());
    try testing.expectEqualStrings("", term.getTerminalVersion());
    try testing.expect(term.term_info.from_xtversion);
    try testing.expect(term.caps.osc52);
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

// ============================================================================
// CLIPBOARD (OSC 52) TESTS
// ============================================================================

test "writeClipboard - generates basic OSC52 sequence" {
    if (builtin.os.tag == .windows) return error.SkipZigTest;

    var env = std.process.EnvMap.init(testing.allocator);
    defer env.deinit();

    var term = Terminal.init(.{ .env_map = &env });
    term.caps.osc52 = true;

    var writer = TestWriter.init(testing.allocator);
    defer writer.deinit();

    try term.writeClipboard(&writer, .clipboard, "aGVsbG8=");

    const output = writer.getWritten();
    // Should be: ESC]52;c;aGVsbG8=ESC\
    try testing.expectEqualStrings("\x1b]52;c;aGVsbG8=\x1b\\", output);
}

test "writeClipboard - supports different targets" {
    if (builtin.os.tag == .windows) return error.SkipZigTest;

    var env = std.process.EnvMap.init(testing.allocator);
    defer env.deinit();

    var term = Terminal.init(.{ .env_map = &env });
    term.caps.osc52 = true;

    var writer = TestWriter.init(testing.allocator);
    defer writer.deinit();

    try term.writeClipboard(&writer, .primary, "test");
    try testing.expect(std.mem.indexOf(u8, writer.getWritten(), "\x1b]52;p;") != null);

    writer.reset();
    try term.writeClipboard(&writer, .secondary, "test");
    try testing.expect(std.mem.indexOf(u8, writer.getWritten(), "\x1b]52;s;") != null);

    writer.reset();
    try term.writeClipboard(&writer, .query, "test");
    try testing.expect(std.mem.indexOf(u8, writer.getWritten(), "\x1b]52;q;") != null);
}

test "writeClipboard - returns error when OSC52 not supported" {
    if (builtin.os.tag == .windows) return error.SkipZigTest;

    var term = Terminal.init(.{});
    term.caps.osc52 = false;

    var writer = TestWriter.init(testing.allocator);
    defer writer.deinit();

    const result = term.writeClipboard(&writer, .clipboard, "test");
    try testing.expectError(error.NotSupported, result);
}

test "writeClipboard - wraps in DCS passthrough for tmux" {
    if (builtin.os.tag == .windows) return error.SkipZigTest;

    var env = std.process.EnvMap.init(testing.allocator);
    defer env.deinit();
    try env.put("TMUX", "/tmp/tmux-1000/default,12345,0");

    var term = Terminal.init(.{ .env_map = &env });
    term.caps.osc52 = true;

    var writer = TestWriter.init(testing.allocator);
    defer writer.deinit();

    try term.writeClipboard(&writer, .clipboard, "test");

    const output = writer.getWritten();
    // Should start with tmux DCS wrapper
    try testing.expect(std.mem.startsWith(u8, output, "\x1bPtmux;"));
    // Should end with DCS terminator
    try testing.expect(std.mem.endsWith(u8, output, "\x1b\\"));
    // Should have doubled ESC characters inside
    try testing.expect(std.mem.indexOf(u8, output, "\x1b\x1b") != null);
}

test "writeClipboard - wraps in DCS passthrough for GNU Screen" {
    if (builtin.os.tag == .windows) return error.SkipZigTest;

    var env = std.process.EnvMap.init(testing.allocator);
    defer env.deinit();
    try env.put("STY", "12345.pts-0.hostname");

    var term = Terminal.init(.{ .env_map = &env });
    term.caps.osc52 = true;

    var writer = TestWriter.init(testing.allocator);
    defer writer.deinit();

    try term.writeClipboard(&writer, .clipboard, "test");

    const output = writer.getWritten();
    // Should start with DCS (but not tmux prefix)
    try testing.expect(std.mem.startsWith(u8, output, "\x1bP"));
    try testing.expect(!std.mem.startsWith(u8, output, "\x1bPtmux;"));
    // Should end with DCS terminator
    try testing.expect(std.mem.endsWith(u8, output, "\x1b\\"));
    // Should have doubled ESC characters
    try testing.expect(std.mem.indexOf(u8, output, "\x1b\x1b") != null);
}

test "writeClipboard - handles tmux sessions" {
    if (builtin.os.tag == .windows) return error.SkipZigTest;

    var env = std.process.EnvMap.init(testing.allocator);
    defer env.deinit();
    try env.put("TMUX", "/tmp/tmux-1000/default,12345,0");

    var term = Terminal.init(.{ .env_map = &env });
    term.caps.osc52 = true;

    var writer = TestWriter.init(testing.allocator);
    defer writer.deinit();

    try term.writeClipboard(&writer, .clipboard, "test");

    const output = writer.getWritten();
    // Should have tmux DCS wrapper
    try testing.expect(std.mem.startsWith(u8, output, "\x1bPtmux;"));
    // Should end with DCS terminator
    try testing.expect(std.mem.endsWith(u8, output, "\x1b\\"));
    // Should have doubled ESC characters
    try testing.expect(std.mem.indexOf(u8, output, "\x1b\x1b") != null);
}

test "caps.osc52 - clipboard capability flag" {
    var term = Terminal.init(.{});

    term.caps.osc52 = false;
    try testing.expect(!term.caps.osc52);

    term.caps.osc52 = true;
    try testing.expect(term.caps.osc52);
}

fn countSubstring(haystack: []const u8, needle: []const u8) usize {
    var count: usize = 0;
    var i: usize = 0;
    while (i < haystack.len) {
        if (std.mem.startsWith(u8, haystack[i..], needle)) {
            count += 1;
            i += needle.len;
        } else {
            i += 1;
        }
    }
    return count;
}

test "queryTerminalSend - skips OSC 66 queries when OPENTUI_FORCE_EXPLICIT_WIDTH=false" {
    if (builtin.os.tag == .windows) return error.SkipZigTest;

    var env = std.process.EnvMap.init(testing.allocator);
    defer env.deinit();
    try env.put("OPENTUI_FORCE_EXPLICIT_WIDTH", "false");

    var term = Terminal.init(.{ .env_map = &env });

    var writer = TestWriter.init(testing.allocator);
    defer writer.deinit();

    try term.queryTerminalSend(&writer);

    const output = writer.getWritten();

    // Should not contain OSC 66 queries
    try testing.expect(std.mem.indexOf(u8, output, "\x1b]66;") == null);

    // Should still contain other queries
    try testing.expect(std.mem.indexOf(u8, output, "\x1b[>0q") != null); // xtversion

    // Verify the flag was set correctly
    try testing.expect(term.skip_explicit_width_query);
    try testing.expect(!term.caps.explicit_width);
}

test "queryTerminalSend - sends OSC 66 queries by default" {
    if (builtin.os.tag == .windows) return error.SkipZigTest;

    var env = std.process.EnvMap.init(testing.allocator);
    defer env.deinit();

    var term = Terminal.init(.{ .env_map = &env });

    var writer = TestWriter.init(testing.allocator);
    defer writer.deinit();

    try term.queryTerminalSend(&writer);

    const output = writer.getWritten();

    // Should contain OSC 66 explicit width query
    try testing.expect(std.mem.indexOf(u8, output, "\x1b]66;w=1; \x1b\\") != null);

    // Should contain OSC 66 scaled text query
    try testing.expect(std.mem.indexOf(u8, output, "\x1b]66;s=2; \x1b\\") != null);

    // Verify the flag was not set
    try testing.expect(!term.skip_explicit_width_query);
}

test "queryTerminalSend - sends OSC 66 queries when OPENTUI_FORCE_EXPLICIT_WIDTH=true" {
    if (builtin.os.tag == .windows) return error.SkipZigTest;

    var env = std.process.EnvMap.init(testing.allocator);
    defer env.deinit();
    try env.put("OPENTUI_FORCE_EXPLICIT_WIDTH", "true");

    var term = Terminal.init(.{ .env_map = &env });

    var writer = TestWriter.init(testing.allocator);
    defer writer.deinit();

    try term.queryTerminalSend(&writer);

    const output = writer.getWritten();

    // Should contain OSC 66 queries
    try testing.expect(std.mem.indexOf(u8, output, "\x1b]66;w=1; \x1b\\") != null);
    try testing.expect(std.mem.indexOf(u8, output, "\x1b]66;s=2; \x1b\\") != null);

    // Verify the capability was forced on
    try testing.expect(term.caps.explicit_width);
    try testing.expect(!term.skip_explicit_width_query);
}
