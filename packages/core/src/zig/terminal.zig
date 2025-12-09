const std = @import("std");
const builtin = @import("builtin");
const atomic = std.atomic;
const assert = std.debug.assert;
const ansi = @import("ansi.zig");
const utf8 = @import("utf8.zig");

const WidthMethod = utf8.WidthMethod;
const log = std.log.scoped(.terminal);

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

pub const Options = struct {
    // Kitty keyboard protocol flags:
    // Bit 0 (1): Report alternate keys (e.g., numpad vs regular keys)
    // Bit 1 (2): Report event types (press/repeat/release)
    // Bit 2 (4): Report text associated with key events
    // Bit 3 (8): Report all keys as escape codes
    // Default 0b00001 (1) = alternate keys only (no event types)
    // Use 0b00011 (3) to enable event types for key release detection
    kitty_keyboard_flags: u8 = 0b00001,
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

state: struct {
    alt_screen: bool = false,
    kitty_keyboard: bool = false,
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

    try tty.writeAll(ansi.ANSI.hideCursor ++
        ansi.ANSI.saveCursorState ++
        ansi.ANSI.decrqmSgrPixels ++
        ansi.ANSI.decrqmUnicode ++
        ansi.ANSI.decrqmColorScheme ++
        ansi.ANSI.decrqmFocus ++
        ansi.ANSI.decrqmBracketedPaste ++
        ansi.ANSI.decrqmSync ++

        // Explicit width detection
        ansi.ANSI.home ++
        ansi.ANSI.explicitWidthQuery ++
        ansi.ANSI.cursorPositionRequest ++

        // Scaled text detection
        ansi.ANSI.home ++
        ansi.ANSI.scaledTextQuery ++
        ansi.ANSI.cursorPositionRequest ++

        // Version and capability queries
        ansi.ANSI.xtversion ++
        ansi.ANSI.csiUQuery ++
        // Kitty graphics detection: sends dummy query + DA1
        // Terminal will respond with ESC_Gi=31337;OK/ERROR ESC\ if supported, or just DA1 if not
        // NOTE: deactivated temporarily due to issues with tmux showing the query as pane title
        // ansi.ANSI.kittyGraphicsQuery ++
        ansi.ANSI.restoreCursorState
            // ++ ansi.ANSI.sixelGeometryQuery
    );
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
    var env_map = std.process.getEnvMap(std.heap.page_allocator) catch return;
    defer env_map.deinit();

    // Always just try to enable bracketed paste, even if it was reported as not supported
    self.caps.bracketed_paste = true;

    if (env_map.get("TMUX")) |_| {
        self.caps.unicode = .wcwidth;
    } else if (env_map.get("TERM")) |term| {
        if (std.mem.startsWith(u8, term, "tmux") or std.mem.startsWith(u8, term, "screen")) {
            self.caps.unicode = .wcwidth;
        }
    }

    // Extract terminal name and version from environment variables
    // These will be overridden by xtversion responses if available
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
    }

    if (env_map.get("TERM_PROGRAM")) |prog| {
        if (std.mem.eql(u8, prog, "vscode")) {
            // VSCode has limited capability
            self.caps.kitty_keyboard = false;
            self.caps.kitty_graphics = false;
            self.caps.unicode = .unicode;
        } else if (std.mem.eql(u8, prog, "Apple_Terminal")) {
            self.caps.unicode = .wcwidth;
        }
    }

    if (env_map.get("COLORTERM")) |colorterm| {
        if (std.mem.eql(u8, colorterm, "truecolor") or
            std.mem.eql(u8, colorterm, "24bit"))
        {
            self.caps.rgb = true;
        }
    }

    if (env_map.get("TERMUX_VERSION")) |_| {
        self.caps.unicode = .wcwidth;
    }

    if (env_map.get("VHS_RECORD")) |_| {
        self.caps.unicode = .wcwidth;
        self.caps.kitty_keyboard = false;
        self.caps.kitty_graphics = false;
    }

    if (env_map.get("OPENTUI_FORCE_WCWIDTH")) |_| {
        self.caps.unicode = .wcwidth;
    }
    if (env_map.get("OPENTUI_FORCE_UNICODE")) |_| {
        self.caps.unicode = .unicode;
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
        }
    } else {
        if (self.state.kitty_keyboard) {
            try tty.writeAll(ansi.ANSI.csiUPop);
            self.state.kitty_keyboard = false;
        }
    }
}

pub fn setModifyOtherKeys(self: *Terminal, tty: anytype, enable: bool) !void {
    const seq = if (enable) ansi.ANSI.modifyOtherKeysSet else ansi.ANSI.modifyOtherKeysReset;
    try tty.writeAll(seq);
    self.state.modify_other_keys = enable;
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

    log.info("Terminal detected via xtversion: {s} {s}", .{
        self.term_info.name[0..self.term_info.name_len],
        self.term_info.version[0..self.term_info.version_len],
    });
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
