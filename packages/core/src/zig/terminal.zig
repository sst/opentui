const std = @import("std");
const builtin = @import("builtin");
const atomic = std.atomic;
const assert = std.debug.assert;
const ansi = @import("ansi.zig");
const utf8 = @import("utf8.zig");
const logger = @import("logger.zig");

const WidthMethod = utf8.WidthMethod;

/// Terminal capability detection and management
pub const Terminal = @This();

pub const Capabilities = struct {
    kitty_keyboard: bool = false,
    kitty_graphics: bool = false,
    rgb: bool = false,
    unicode: WidthMethod = .unicode,
    sgr_pixels: bool = false,
    color_scheme_updates: bool = false,
    explicit_width: bool = false,
    scaled_text: bool = false,
    sixel: bool = false,
    focus_tracking: bool = false,
    sync: bool = false,
    bracketed_paste: bool = false,
    hyperlinks: bool = false,
    osc52: bool = false,
    explicit_cursor_positioning: bool = false,
};

pub const MouseLevel = enum {
    none,
    basic, // click only
    drag, // click + drag
    motion, // all motion
    pixels, // pixel coordinates
};

pub const CursorStyle = enum {
    block,
    line,
    underline,
};

pub const ClipboardTarget = enum {
    clipboard, // "c"
    primary, // "p"
    secondary, // "s"
    query, // "q"

    pub fn toChar(self: ClipboardTarget) u8 {
        return switch (self) {
            .clipboard => 'c',
            .primary => 'p',
            .secondary => 's',
            .query => 'q',
        };
    }
};

pub const Options = struct {
    // Kitty keyboard protocol flags (progressive enhancement):
    // See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/#progressive-enhancement
    // Bit 0 (0b1):     Disambiguate escape codes (fixes ESC timing, alt+key ambiguity, ctrl+c as event)
    // Bit 1 (0b10):    Report event types (press/repeat/release)
    // Bit 2 (0b100):   Report alternate keys (e.g., numpad vs regular, shifted, base layout)
    // Bit 3 (0b1000):  Report all keys as escape codes
    // Bit 4 (0b10000): Report text associated with key events
    // Default 0b00101 (5) = disambiguate + alternate keys
    // Use 0b00111 (7) to also enable event types for key release detection
    kitty_keyboard_flags: u8 = 0b00101,
    remote: bool = false,
    // Optional override for environment lookups. Caller owns the map.
    env_map: ?*const std.process.EnvMap = null,
};

pub const TerminalInfo = struct {
    name: [64]u8 = [_]u8{0} ** 64,
    name_len: usize = 0,
    version: [32]u8 = [_]u8{0} ** 32,
    version_len: usize = 0,
    from_xtversion: bool = false,
};

caps: Capabilities = .{},
opts: Options = .{},

in_tmux: bool = false,
skip_graphics_query: bool = false,
skip_explicit_width_query: bool = false,
graphics_query_pending: bool = false,
capability_queries_pending: bool = false,

state: struct {
    alt_screen: bool = false,
    kitty_keyboard: bool = false,
    kitty_keyboard_flags: u8 = 0,
    bracketed_paste: bool = false,
    mouse: bool = false,
    pixel_mouse: bool = false,
    color_scheme_updates: bool = false,
    focus_tracking: bool = false,
    modify_other_keys: bool = false,
    cursor: struct {
        row: u16 = 0,
        col: u16 = 0,
        x: u32 = 1, // 1-based for rendering
        y: u32 = 1, // 1-based for rendering
        visible: bool = true,
        style: CursorStyle = .block,
        blinking: bool = false,
        color: [4]f32 = .{ 1.0, 1.0, 1.0, 1.0 }, // RGBA
    } = .{},
} = .{},

term_info: TerminalInfo = .{},

pub fn init(opts: Options) Terminal {
    var term: Terminal = .{
        .opts = opts,
    };

    term.checkEnvironmentOverrides();
    return term;
}

pub fn resetState(self: *Terminal, tty: anytype) !void {
    try tty.writeAll(ansi.ANSI.showCursor);
    try tty.writeAll(ansi.ANSI.reset);

    if (self.state.kitty_keyboard) {
        try self.setKittyKeyboard(tty, false, 0);
    }

    if (self.state.modify_other_keys) {
        try self.setModifyOtherKeys(tty, false);
    }

    if (self.state.mouse) {
        try self.setMouseMode(tty, false);
    }

    if (self.state.bracketed_paste) {
        try self.setBracketedPaste(tty, false);
    }

    if (self.state.focus_tracking) {
        try self.setFocusTracking(tty, false);
    }

    if (self.state.alt_screen) {
        try self.exitAltScreen(tty);
    } else {
        switch (builtin.os.tag) {
            .windows => {
                try tty.writeByte('\r');
                var i: u16 = 0;
                while (i < self.state.cursor.row) : (i += 1) {
                    try tty.writeAll(ansi.ANSI.reverseIndex);
                }
                try tty.writeAll(ansi.ANSI.eraseBelowCursor);
            },
            else => {},
        }
    }

    if (self.state.color_scheme_updates) {
        try tty.writeAll(ansi.ANSI.colorSchemeReset);
        self.state.color_scheme_updates = false;
    }

    self.setTerminalTitle(tty, "");
}

pub fn enterAltScreen(self: *Terminal, tty: anytype) !void {
    try tty.writeAll(ansi.ANSI.switchToAlternateScreen);
    self.state.alt_screen = true;
}

pub fn exitAltScreen(self: *Terminal, tty: anytype) !void {
    try tty.writeAll(ansi.ANSI.switchToMainScreen);
    self.state.alt_screen = false;
}

pub fn queryTerminalSend(self: *Terminal, tty: anytype) !void {
    self.checkEnvironmentOverrides();
    self.graphics_query_pending = !self.skip_graphics_query;
    self.capability_queries_pending = false;

    // Send xtversion first (doesn't need DCS wrapping - used for tmux detection)
    try tty.writeAll(ansi.ANSI.xtversion ++
        ansi.ANSI.hideCursor ++
        ansi.ANSI.saveCursorState);

    if (self.in_tmux) {
        try tty.writeAll(ansi.ANSI.capabilityQueriesTmux);
    } else {
        try tty.writeAll(ansi.ANSI.capabilityQueries);
        self.capability_queries_pending = true;
    }

    if (!self.skip_explicit_width_query) {
        try tty.writeAll(ansi.ANSI.home ++
            ansi.ANSI.explicitWidthQuery ++
            ansi.ANSI.cursorPositionRequest ++
            ansi.ANSI.home ++
            ansi.ANSI.scaledTextQuery ++
            ansi.ANSI.cursorPositionRequest);
    }

    try tty.writeAll(ansi.ANSI.restoreCursorState);
}

pub fn sendPendingQueries(self: *Terminal, tty: anytype) !bool {
    var sent = false;
    const is_tmux = self.in_tmux or self.isXtversionTmux();

    // Re-send capability queries DCS wrapped if tmux detected via xtversion
    // Only needed if we got xtversion response indicating tmux
    if (self.capability_queries_pending) {
        if (self.term_info.from_xtversion and is_tmux) {
            try tty.writeAll(ansi.ANSI.capabilityQueriesTmux);
            sent = true;
        }
        // Clear pending flag regardless - non-tmux terminals already received unwrapped queries
        self.capability_queries_pending = false;
    }

    if (self.graphics_query_pending and !self.skip_graphics_query) {
        if (is_tmux) {
            try tty.writeAll(ansi.ANSI.kittyGraphicsQueryTmux);
        } else {
            try tty.writeAll(ansi.ANSI.kittyGraphicsQuery);
        }
        self.graphics_query_pending = false;
        sent = true;
    }

    return sent;
}

pub fn enableDetectedFeatures(self: *Terminal, tty: anytype, use_kitty_keyboard: bool) !void {
    if (builtin.os.tag == .windows) {
        // Windows-specific defaults for ConPTY
        self.caps.rgb = true;
        self.caps.bracketed_paste = true;
    }

    self.checkEnvironmentOverrides();

    if (!self.state.modify_other_keys and !self.state.kitty_keyboard) {
        try self.setModifyOtherKeys(tty, true);
    }

    if (self.caps.kitty_keyboard and use_kitty_keyboard) {
        if (self.state.modify_other_keys) {
            try self.setModifyOtherKeys(tty, false);
        }
        try self.setKittyKeyboard(tty, true, self.opts.kitty_keyboard_flags);
    }

    if (self.caps.unicode == .unicode and !self.caps.explicit_width) {
        try tty.writeAll(ansi.ANSI.unicodeSet);
    }

    if (self.caps.bracketed_paste) {
        try self.setBracketedPaste(tty, true);
    }

    if (self.caps.focus_tracking) {
        try self.setFocusTracking(tty, true);
    }
}

fn checkEnvironmentOverrides(self: *Terminal) void {
    self.in_tmux = false;
    self.skip_graphics_query = false;
    self.skip_explicit_width_query = false;

    // Always just try to enable bracketed paste, even if it was reported as not supported
    self.caps.bracketed_paste = true;

    if (self.caps.rgb) {
        self.caps.hyperlinks = true;
    }

    if (self.opts.remote) {
        return;
    }

    var env_map_storage: ?std.process.EnvMap = null;
    const env_map: *const std.process.EnvMap = self.opts.env_map orelse blk: {
        env_map_storage = std.process.getEnvMap(std.heap.page_allocator) catch return;
        break :blk &env_map_storage.?;
    };
    defer if (env_map_storage) |*map| map.deinit();

    if (!self.term_info.from_xtversion) {
        if (env_map.get("TMUX")) |_| {
            self.in_tmux = true;
            self.caps.unicode = .wcwidth;
            self.caps.explicit_cursor_positioning = true;
        } else if (env_map.get("TERM")) |term| {
            if (std.mem.startsWith(u8, term, "tmux")) {
                self.in_tmux = true;
                self.caps.unicode = .wcwidth;
                self.caps.explicit_cursor_positioning = true;
            } else if (std.mem.startsWith(u8, term, "screen")) {
                self.skip_graphics_query = true;
                self.caps.unicode = .wcwidth;
                self.caps.explicit_cursor_positioning = true;
            }
            if (std.mem.indexOf(u8, term, "alacritty") != null) {
                self.caps.explicit_cursor_positioning = true;
            }
        }
    }

    if (env_map.get("OPENTUI_NO_GRAPHICS")) |_| {
        self.skip_graphics_query = true;
    }

    if (!self.term_info.from_xtversion) {
        if (env_map.get("TERM_PROGRAM")) |prog| {
            const copy_len = @min(prog.len, self.term_info.name.len);
            @memcpy(self.term_info.name[0..copy_len], prog[0..copy_len]);
            self.term_info.name_len = copy_len;

            if (env_map.get("TERM_PROGRAM_VERSION")) |ver| {
                const ver_len = @min(ver.len, self.term_info.version.len);
                @memcpy(self.term_info.version[0..ver_len], ver[0..ver_len]);
                self.term_info.version_len = ver_len;
            }
        }

        if (env_map.get("TERM_PROGRAM")) |prog| {
            if (std.mem.eql(u8, prog, "vscode")) {
                self.caps.kitty_keyboard = false;
                self.caps.kitty_graphics = false;
                self.caps.unicode = .unicode;
            } else if (std.mem.eql(u8, prog, "Apple_Terminal")) {
                self.caps.unicode = .wcwidth;
            } else if (std.mem.eql(u8, prog, "Alacritty")) {
                self.caps.explicit_cursor_positioning = true;
            }
        }

        if (env_map.get("ALACRITTY_SOCKET") != null or env_map.get("ALACRITTY_LOG") != null) {
            self.caps.explicit_cursor_positioning = true;
            if (self.term_info.name_len == 0) {
                const name = "Alacritty";
                @memcpy(self.term_info.name[0..name.len], name);
                self.term_info.name_len = name.len;
            }
        }
    }

    if (env_map.get("COLORTERM")) |colorterm| {
        if (std.mem.eql(u8, colorterm, "truecolor") or
            std.mem.eql(u8, colorterm, "24bit"))
        {
            self.caps.rgb = true;
        }
    }

    if (!self.term_info.from_xtversion) {
        if (env_map.get("TERMUX_VERSION")) |_| {
            self.caps.unicode = .wcwidth;
        }

        if (env_map.get("VHS_RECORD")) |_| {
            self.caps.unicode = .wcwidth;
            self.caps.kitty_keyboard = false;
            self.caps.kitty_graphics = false;
        }
    }

    if (env_map.get("OPENTUI_FORCE_WCWIDTH")) |_| {
        self.caps.unicode = .wcwidth;
    }
    if (env_map.get("OPENTUI_FORCE_UNICODE")) |_| {
        self.caps.unicode = .unicode;
    }
    if (env_map.get("OPENTUI_FORCE_NOZWJ")) |_| {
        self.caps.unicode = .no_zwj;
    }

    if (env_map.get("OPENTUI_FORCE_EXPLICIT_WIDTH")) |val| {
        if (std.mem.eql(u8, val, "true") or std.mem.eql(u8, val, "1")) {
            self.caps.explicit_width = true;
        } else if (std.mem.eql(u8, val, "false") or std.mem.eql(u8, val, "0")) {
            self.caps.explicit_width = false;
            self.skip_explicit_width_query = true;
        }
    }

    if (!self.caps.hyperlinks and self.term_info.from_xtversion) {
        if (isHyperlinkTerm(self.getTerminalName())) {
            self.caps.hyperlinks = true;
        }
    }

    if (!self.caps.hyperlinks and !self.term_info.from_xtversion) {
        if (env_map.get("TERM")) |term| {
            if (isHyperlinkTerm(term)) {
                self.caps.hyperlinks = true;
            }
        }
    }

    if (!self.caps.osc52 and !self.term_info.from_xtversion) {
        if (env_map.get("WT_SESSION") != null) {
            self.caps.osc52 = true;
        }

        if (!self.caps.osc52 and (self.in_tmux or env_map.get("STY") != null)) {
            self.caps.osc52 = true;
        }

        if (!self.caps.osc52) {
            if (env_map.get("TERM_PROGRAM")) |prog| {
                if (isOsc52Term(prog)) {
                    self.caps.osc52 = true;
                }
            }
        }

        if (!self.caps.osc52) {
            if (env_map.get("TERM")) |term| {
                if (isOsc52Term(term) or std.mem.indexOf(u8, term, "256color") != null or std.mem.indexOf(u8, term, "xterm") != null) {
                    self.caps.osc52 = true;
                }
            }
        }
    }
}

// TODO: Allow pixel mouse mode to be enabled,
// currently does not make sense and is not supported by higher levels
pub fn setMouseMode(self: *Terminal, tty: anytype, enable: bool) !void {
    if (self.state.mouse == enable) return;

    if (enable) {
        self.state.mouse = true;
        try tty.writeAll(ansi.ANSI.enableMouseTracking);
        try tty.writeAll(ansi.ANSI.enableButtonEventTracking);
        try tty.writeAll(ansi.ANSI.enableAnyEventTracking);
        try tty.writeAll(ansi.ANSI.enableSGRMouseMode);
    } else {
        self.state.mouse = false;
        self.state.pixel_mouse = false;
        try tty.writeAll(ansi.ANSI.disableAnyEventTracking);
        try tty.writeAll(ansi.ANSI.disableButtonEventTracking);
        try tty.writeAll(ansi.ANSI.disableMouseTracking);
        try tty.writeAll(ansi.ANSI.disableSGRMouseMode);
    }
}

pub fn setBracketedPaste(self: *Terminal, tty: anytype, enable: bool) !void {
    const seq = if (enable) ansi.ANSI.bracketedPasteSet else ansi.ANSI.bracketedPasteReset;
    try tty.writeAll(seq);
    self.state.bracketed_paste = enable;
}

pub fn setFocusTracking(self: *Terminal, tty: anytype, enable: bool) !void {
    const seq = if (enable) ansi.ANSI.focusSet else ansi.ANSI.focusReset;
    try tty.writeAll(seq);
    self.state.focus_tracking = enable;
}

pub fn setKittyKeyboard(self: *Terminal, tty: anytype, enable: bool, flags: u8) !void {
    if (enable) {
        if (!self.state.kitty_keyboard) {
            try tty.print(ansi.ANSI.csiUPush, .{flags});
            self.state.kitty_keyboard = true;
            self.state.kitty_keyboard_flags = flags;
        }
    } else {
        if (self.state.kitty_keyboard) {
            try tty.writeAll(ansi.ANSI.csiUPop);
            self.state.kitty_keyboard = false;
            self.state.kitty_keyboard_flags = 0;
        }
    }
}

pub fn setModifyOtherKeys(self: *Terminal, tty: anytype, enable: bool) !void {
    const seq = if (enable) ansi.ANSI.modifyOtherKeysSet else ansi.ANSI.modifyOtherKeysReset;
    try tty.writeAll(seq);
    self.state.modify_other_keys = enable;
}

/// Re-send all currently-active terminal mode escape sequences unconditionally.
///
/// When the terminal loses and regains focus (e.g. alt-tab, tab switch, minimize),
/// some terminal emulators (notably Windows Terminal / ConPTY) strip or reset
/// DEC private modes like mouse tracking (?1000/?1002/?1003/?1006), focus
/// tracking (?1004), and bracketed paste (?2004). This function re-emits the
/// enable sequences for every mode that our state tracking says is currently on,
/// without checking whether the mode "should" already be enabled — because the
/// terminal may have silently disabled it.
///
/// This should be called in response to the focus-in event (\x1b[I).
///
/// Per the xterm ctlseqs spec (Patch #401, 2025/06/22) and the Microsoft
/// Console Virtual Terminal Sequences documentation, the relevant DECSET
/// private modes are:
///   ?1000h  - Normal mouse tracking (sends button press/release)
///   ?1002h  - Button-event tracking (adds drag reporting)
///   ?1003h  - Any-event tracking (adds all motion reporting)
///   ?1006h  - SGR extended mouse mode (extended coordinate encoding)
///   ?1004h  - Focus event tracking (sends \x1b[I / \x1b[O)
///   ?2004h  - Bracketed paste mode (wraps pasted text in markers)
///   Kitty keyboard protocol (CSI > flags u) - progressive enhancement
///   modifyOtherKeys (CSI > 4 ; 1 m) - xterm key modification
pub fn restoreTerminalModes(self: *Terminal, tty: anytype) !void {
    // Re-enable mouse tracking modes if active
    if (self.state.mouse) {
        try tty.writeAll(ansi.ANSI.enableMouseTracking);
        try tty.writeAll(ansi.ANSI.enableButtonEventTracking);
        try tty.writeAll(ansi.ANSI.enableAnyEventTracking);
        try tty.writeAll(ansi.ANSI.enableSGRMouseMode);
    }

    // Re-enable focus tracking if active
    if (self.state.focus_tracking) {
        try tty.writeAll(ansi.ANSI.focusSet);
    }

    // Re-enable bracketed paste if active
    if (self.state.bracketed_paste) {
        try tty.writeAll(ansi.ANSI.bracketedPasteSet);
    }

    // Pop stale entry then re-push kitty keyboard protocol to avoid stack growth.
    // Both sequences are in the same write buffer so the terminal processes them atomically.
    if (self.state.kitty_keyboard) {
        try tty.writeAll(ansi.ANSI.csiUPop);
        try tty.print(ansi.ANSI.csiUPush, .{self.state.kitty_keyboard_flags});
    }

    // Re-enable modifyOtherKeys if active
    if (self.state.modify_other_keys) {
        try tty.writeAll(ansi.ANSI.modifyOtherKeysSet);
    }
}

/// The responses look like these:
/// kitty - '\x1B[?1016;2$y\x1B[?2027;0$y\x1B[?2031;2$y\x1B[?1004;1$y\x1B[?2026;2$y\x1B[1;2R\x1B[1;3R\x1BP>|kitty(0.40.1)\x1B\\\x1B[?0u\x1B_Gi=1;EINVAL:Zero width/height not allowed\x1B\\\x1B[?62;c'
/// ghostty - '\x1B[?1016;1$y\x1B[?2027;1$y\x1B[?2031;2$y\x1B[?1004;1$y\x1B[?2004;2$y\x1B[?2026;2$y\x1B[1;1R\x1B[1;1R\x1BP>|ghostty 1.1.3\x1B\\\x1B[?0u\x1B_Gi=1;OK\x1B\\\x1B[?62;22c'
/// tmux - '\x1B[1;1R\x1B[1;1R\x1BP>|tmux 3.5a\x1B\\\x1B[?1;2;4c\x1B[?2;3;0S'
/// vscode - '\x1B[?1016;2$y'
/// alacritty - '\x1B[?1016;0$y\x1B[?2027;0$y\x1B[?2031;0$y\x1B[?1004;2$y\x1B[?2004;2$y\x1B[?2026;2$y\x1B[1;1R\x1B[1;1R\x1B[?0u\x1B[?6c'
///
/// Parsing these is not complete yet
pub fn processCapabilityResponse(self: *Terminal, response: []const u8) void {
    // DECRPM responses
    if (std.mem.indexOf(u8, response, "1016;2$y")) |_| {
        self.caps.sgr_pixels = true;
    }
    if (std.mem.indexOf(u8, response, "2027;2$y")) |_| {
        self.caps.unicode = .unicode;
    }
    if (std.mem.indexOf(u8, response, "2031;2$y")) |_| {
        self.caps.color_scheme_updates = true;
    }
    if (std.mem.indexOf(u8, response, "1004;1$y") != null or std.mem.indexOf(u8, response, "1004;2$y") != null) {
        self.caps.focus_tracking = true;
    }
    if (std.mem.indexOf(u8, response, "2026;1$y") != null or std.mem.indexOf(u8, response, "2026;2$y") != null) {
        self.caps.sync = true;
    }
    if (std.mem.indexOf(u8, response, "2004;1$y") != null or std.mem.indexOf(u8, response, "2004;2$y") != null) {
        self.caps.bracketed_paste = true;
    }

    // Explicit width detection - cursor position report [1;NR where N >= 2 means explicit width supported
    // We look for ESC[1; followed by a digit >= 2
    // This handles cases where the cursor isn't at exact home position when queries are sent
    if (std.mem.indexOf(u8, response, "\x1b[1;")) |pos| {
        const after = response[pos + 4 ..];
        if (after.len > 0) {
            var end: usize = 0;
            while (end < after.len and after[end] >= '0' and after[end] <= '9') : (end += 1) {}
            if (end > 0 and end < after.len and after[end] == 'R') {
                const col = std.fmt.parseInt(u16, after[0..end], 10) catch 0;
                if (col >= 2) {
                    self.caps.explicit_width = true;
                }
                if (col >= 3) {
                    self.caps.scaled_text = true;
                }
            }
        }
    }

    // Parse xtversion response: ESC P > | name version ESC \
    // Examples: "\x1BP>|kitty(0.40.1)\x1B\\" or "\x1BP>|ghostty 1.1.3\x1B\\" or "\x1BP>|tmux 3.5a\x1B\\"
    if (std.mem.indexOf(u8, response, "\x1bP>|")) |pos| {
        const start = pos + 4; // Skip past "\x1BP>|"
        if (std.mem.indexOf(u8, response[start..], "\x1b\\")) |end_offset| {
            const term_str = response[start .. start + end_offset];
            self.parseXtversion(term_str);
        }
    }

    // Kitty detection
    if (std.mem.indexOf(u8, response, "kitty")) |_| {
        self.caps.kitty_keyboard = true;
        self.caps.kitty_graphics = true;
        self.caps.unicode = .unicode;
        self.caps.rgb = true;
        self.caps.sixel = true;
        self.caps.bracketed_paste = true;
        self.caps.hyperlinks = true;
    }

    // Kitty keyboard protocol detection via CSI ? u response
    // Terminals supporting the protocol respond to CSI ? u with CSI ? <flags> u
    // Examples: \x1b[?0u (ghostty, alacritty), \x1b[?1u, etc.
    if (std.mem.indexOf(u8, response, "\x1b[?") != null and std.mem.indexOf(u8, response, "u") != null) {
        // Look for pattern \x1b[?Nu where N is 0-31
        var i: usize = 0;
        while (i + 4 < response.len) : (i += 1) {
            if (response[i] == '\x1b' and i + 1 < response.len and response[i + 1] == '[' and i + 2 < response.len and response[i + 2] == '?') {
                var num_end = i + 3;
                while (num_end < response.len and response[num_end] >= '0' and response[num_end] <= '9') : (num_end += 1) {}
                if (num_end > i + 3 and num_end < response.len and response[num_end] == 'u') {
                    self.caps.kitty_keyboard = true;
                    break;
                }
            }
        }
    }

    if (std.mem.indexOf(u8, response, "tmux")) |_| {
        self.caps.unicode = .wcwidth;
        self.caps.explicit_cursor_positioning = true;
    }

    if (std.mem.indexOf(u8, response, "alacritty")) |_| {
        self.caps.explicit_cursor_positioning = true;
    }

    // Sixel detection via device attributes (capability 4 in DA1 response ending with 'c')
    if (std.mem.indexOf(u8, response, ";c")) |pos| {
        var start: usize = 0;
        if (pos >= 4) {
            start = pos;
            while (start > 0 and response[start] != '\x1b') {
                start -= 1;
            }

            const da_response = response[start .. pos + 2];

            if (std.mem.indexOf(u8, da_response, "\x1b[?") == 0) {
                if (std.mem.indexOf(u8, da_response, "4;") != null or std.mem.indexOf(u8, da_response, ";4;") != null or std.mem.indexOf(u8, da_response, ";4c") != null) {
                    self.caps.sixel = true;
                }
            }
        }
    }

    // Kitty graphics response: ESC_Gi=31337;OK ESC\ or ESC_Gi=31337;EERROR... ESC\
    // We look for our specific query ID (31337) to avoid false positives
    if (std.mem.indexOf(u8, response, "\x1b_G")) |_| {
        if (std.mem.indexOf(u8, response, "i=31337")) |_| {
            // Got a response to our graphics query with our ID
            // If it contains "OK" or even an error, the protocol is supported
            // (errors mean the query was understood, just parameters were wrong)
            self.caps.kitty_graphics = true;
        }
    }

    if (!self.caps.osc52 and isOsc52Term(response)) {
        self.caps.osc52 = true;
    }

    if (!self.caps.hyperlinks and isHyperlinkTerm(response)) {
        self.caps.hyperlinks = true;
    }
}

fn isOsc52Term(value: []const u8) bool {
    return std.ascii.indexOfIgnoreCase(value, "iterm") != null or
        std.ascii.indexOfIgnoreCase(value, "kitty") != null or
        std.ascii.indexOfIgnoreCase(value, "alacritty") != null or
        std.ascii.indexOfIgnoreCase(value, "wezterm") != null or
        std.ascii.indexOfIgnoreCase(value, "contour") != null or
        std.ascii.indexOfIgnoreCase(value, "foot") != null or
        std.ascii.indexOfIgnoreCase(value, "rio") != null or
        std.ascii.indexOfIgnoreCase(value, "ghostty") != null or
        std.ascii.indexOfIgnoreCase(value, "tmux") != null or
        std.ascii.indexOfIgnoreCase(value, "screen") != null;
}

fn isHyperlinkTerm(value: []const u8) bool {
    return std.ascii.indexOfIgnoreCase(value, "ghostty") != null or
        std.ascii.indexOfIgnoreCase(value, "kitty") != null or
        std.ascii.indexOfIgnoreCase(value, "wezterm") != null or
        std.ascii.indexOfIgnoreCase(value, "alacritty") != null or
        std.ascii.indexOfIgnoreCase(value, "iterm") != null;
}

pub fn getCapabilities(self: *Terminal) Capabilities {
    return self.caps;
}

pub fn setCursorPosition(self: *Terminal, x: u32, y: u32, visible: bool) void {
    self.state.cursor.x = @max(1, x);
    self.state.cursor.y = @max(1, y);
    self.state.cursor.visible = visible;

    // Update 0-based coordinates for terminal operations
    self.state.cursor.col = @intCast(@max(0, x - 1));
    self.state.cursor.row = @intCast(@max(0, y - 1));
}

pub fn setCursorStyle(self: *Terminal, style: CursorStyle, blinking: bool) void {
    self.state.cursor.style = style;
    self.state.cursor.blinking = blinking;
}

pub fn setCursorColor(self: *Terminal, color: [4]f32) void {
    self.state.cursor.color = color;
}

pub fn getCursorPosition(self: *Terminal) struct { x: u32, y: u32, visible: bool } {
    return .{
        .x = self.state.cursor.x,
        .y = self.state.cursor.y,
        .visible = self.state.cursor.visible,
    };
}

pub fn getCursorStyle(self: *Terminal) struct { style: CursorStyle, blinking: bool } {
    return .{
        .style = self.state.cursor.style,
        .blinking = self.state.cursor.blinking,
    };
}

pub fn getCursorColor(self: *Terminal) [4]f32 {
    return self.state.cursor.color;
}

pub fn setKittyKeyboardFlags(self: *Terminal, flags: u8) void {
    self.opts.kitty_keyboard_flags = flags;
}

pub fn setTerminalTitle(_: *Terminal, tty: anytype, title: []const u8) void {
    // For Windows, we might need to use different approach, but ANSI sequences work in Windows Terminal, ConPTY, etc.
    // For other platforms, ANSI OSC sequences work reliably
    ansi.ANSI.setTerminalTitleOutput(tty, title) catch {};
}

/// Write OSC 52 clipboard sequence to the terminal
/// Supports tmux/screen passthrough, including nested tmux sessions
pub fn writeClipboard(self: *Terminal, tty: anytype, target: ClipboardTarget, payload: []const u8) !void {
    if (!self.canWriteClipboard()) {
        return error.NotSupported;
    }

    var buf: [1024]u8 = undefined;
    var stream = std.io.fixedBufferStream(&buf);
    const writer = stream.writer();

    // Build OSC 52 sequence: ESC]52;<target>;<payload>ESC\
    try writer.writeAll("\x1b]52;");
    try writer.writeByte(target.toChar());
    try writer.writeByte(';');
    try writer.writeAll(payload);
    try writer.writeAll("\x1b\\");

    const osc52 = stream.getWritten();

    // Use self.in_tmux which is set by checkEnvironmentOverrides() considering
    // env vars, xtversion response, and remote option
    const is_tmux = self.in_tmux or self.isXtversionTmux();

    if (is_tmux) {
        // For nested tmux, we use a fixed level of 1 as we don't have access
        // to env vars here (by design - detection already happened in checkEnvironmentOverrides)
        // In practice, single-level wrapping works for most cases
        var wrapped_buf: [4096]u8 = undefined;
        var wrapped_stream = std.io.fixedBufferStream(&wrapped_buf);
        const wrap_writer = wrapped_stream.writer();
        for (osc52) |c| {
            if (c == '\x1b') {
                try wrap_writer.writeByte('\x1b');
            }
            try wrap_writer.writeByte(c);
        }
        const doubled = wrapped_stream.getWritten();

        try tty.writeAll(ansi.ANSI.tmuxDcsStart);
        try tty.writeAll(doubled);
        try tty.writeAll(ansi.ANSI.tmuxDcsEnd);
    } else if (self.opts.remote) {
        try tty.writeAll(osc52);
    } else {
        var env_map_storage: ?std.process.EnvMap = null;
        const env_map: *const std.process.EnvMap = self.opts.env_map orelse blk: {
            env_map_storage = std.process.getEnvMap(std.heap.page_allocator) catch return;
            break :blk &env_map_storage.?;
        };
        defer if (env_map_storage) |*map| map.deinit();

        if (env_map.get("STY")) |_| {
            var wrapped_buf: [2048]u8 = undefined;
            var wrapped_stream = std.io.fixedBufferStream(&wrapped_buf);
            const wrapped_writer = wrapped_stream.writer();

            for (osc52) |c| {
                if (c == '\x1b') {
                    try wrapped_writer.writeByte('\x1b');
                }
                try wrapped_writer.writeByte(c);
            }
            const doubled = wrapped_stream.getWritten();

            try tty.writeAll(ansi.ANSI.screenDcsStart);
            try tty.writeAll(doubled);
            try tty.writeAll(ansi.ANSI.screenDcsEnd);
        } else {
            try tty.writeAll(osc52);
        }
    }
}

/// Check if we can write to the clipboard (TTY and OSC 52 supported)
fn canWriteClipboard(self: *Terminal) bool {
    // In a real TTY environment, we'd check isTTY here
    // For now, we just check if OSC 52 is supported
    return self.caps.osc52;
}

/// Parse xtversion response string and extract terminal name and version
/// Examples: "kitty(0.40.1)", "ghostty 1.1.3", "tmux 3.5a"
fn parseXtversion(self: *Terminal, term_str: []const u8) void {
    if (term_str.len == 0) return;

    if (std.mem.indexOf(u8, term_str, "(")) |paren_pos| {
        const name_len = @min(paren_pos, self.term_info.name.len);
        @memcpy(self.term_info.name[0..name_len], term_str[0..name_len]);
        self.term_info.name_len = name_len;

        if (std.mem.indexOf(u8, term_str[paren_pos..], ")")) |close_offset| {
            const ver_start = paren_pos + 1;
            const ver_end = paren_pos + close_offset;
            const ver_len = @min(ver_end - ver_start, self.term_info.version.len);
            @memcpy(self.term_info.version[0..ver_len], term_str[ver_start .. ver_start + ver_len]);
            self.term_info.version_len = ver_len;
        }
    } else {
        if (std.mem.indexOf(u8, term_str, " ")) |space_pos| {
            const name_len = @min(space_pos, self.term_info.name.len);
            @memcpy(self.term_info.name[0..name_len], term_str[0..name_len]);
            self.term_info.name_len = name_len;

            const ver_start = space_pos + 1;
            const ver_len = @min(term_str.len - ver_start, self.term_info.version.len);
            @memcpy(self.term_info.version[0..ver_len], term_str[ver_start .. ver_start + ver_len]);
            self.term_info.version_len = ver_len;
        } else {
            const name_len = @min(term_str.len, self.term_info.name.len);
            @memcpy(self.term_info.name[0..name_len], term_str[0..name_len]);
            self.term_info.name_len = name_len;
            self.term_info.version_len = 0;
        }
    }

    self.term_info.from_xtversion = true;
}

pub fn isXtversionTmux(self: *Terminal) bool {
    return self.term_info.from_xtversion and std.mem.eql(u8, self.getTerminalName(), "tmux");
}

pub fn getTerminalInfo(self: *Terminal) TerminalInfo {
    return self.term_info;
}

pub fn getTerminalName(self: *Terminal) []const u8 {
    return self.term_info.name[0..self.term_info.name_len];
}

pub fn getTerminalVersion(self: *Terminal) []const u8 {
    return self.term_info.version[0..self.term_info.version_len];
}
