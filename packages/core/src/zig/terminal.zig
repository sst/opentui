const std = @import("std");
const builtin = @import("builtin");
const atomic = std.atomic;
const AnyWriter = std.io.AnyWriter;
const assert = std.debug.assert;
const ansi = @import("ansi.zig");
const gwidth = @import("gwidth.zig");

const WidthMethod = gwidth.WidthMethod;
const log = std.log.scoped(.terminal);

/// Terminal capability detection and management
pub const Terminal = @This();

pub const Capabilities = struct {
    kitty_keyboard: bool = false,
    kitty_graphics: bool = false,
    rgb: bool = false,
    unicode: WidthMethod = .wcwidth,
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
    kitty_keyboard_flags: u8 = 0b00001,
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

pub fn init(opts: Options) Terminal {
    return .{
        .opts = opts,
    };
}

pub fn deinit(self: *Terminal, tty: AnyWriter) void {
    self.resetState(tty) catch {};
}

pub fn resetState(self: *Terminal, tty: AnyWriter) !void {
    try tty.writeAll(ansi.ANSI.showCursor);
    try tty.writeAll(ansi.ANSI.reset);

    if (self.state.kitty_keyboard) {
        try self.setKittyKeyboard(tty, false, 0);
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
        try tty.writeAll(ansi.ANSI.home);
        try tty.writeAll(ansi.ANSI.eraseBelowCursor);
        try self.exitAltScreen(tty);
    } else {
        try tty.writeByte('\r');
        var i: u16 = 0;
        while (i < self.state.cursor.row) : (i += 1) {
            try tty.writeAll(ansi.ANSI.reverseIndex);
        }
        try tty.writeAll(ansi.ANSI.eraseBelowCursor);
    }

    if (self.state.color_scheme_updates) {
        try tty.writeAll(ansi.ANSI.colorSchemeReset);
        self.state.color_scheme_updates = false;
    }

    self.setTerminalTitle(tty, "");
}

pub fn enterAltScreen(self: *Terminal, tty: AnyWriter) !void {
    try tty.writeAll(ansi.ANSI.switchToAlternateScreen);
    self.state.alt_screen = true;
}

pub fn exitAltScreen(self: *Terminal, tty: AnyWriter) !void {
    try tty.writeAll(ansi.ANSI.switchToMainScreen);
    self.state.alt_screen = false;
}

pub fn queryTerminalSend(self: *Terminal, tty: AnyWriter) !void {
    self.checkEnvironmentOverrides();

    try tty.writeAll(ansi.ANSI.hideCursor ++
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
        ansi.ANSI.kittyGraphicsQuery ++
        ansi.ANSI.primaryDeviceAttrs
            // ++ ansi.ANSI.sixelGeometryQuery
    );
}

pub fn enableDetectedFeatures(self: *Terminal, tty: AnyWriter) !void {
    switch (builtin.os.tag) {
        .windows => {
            // Windows-specific defaults for ConPTY
            self.caps.rgb = true;
            self.caps.bracketed_paste = true;
        },
        else => {
            self.checkEnvironmentOverrides();

            // NOTE: Not enabling kitty keyboard by default even when it is supported
            // Higher levels do not support that yet and stdin handling may move to native

            if (self.caps.unicode == .unicode and !self.caps.explicit_width) {
                try tty.writeAll(ansi.ANSI.unicodeSet);
            }

            if (self.caps.bracketed_paste) {
                try self.setBracketedPaste(tty, true);
            }

            if (self.caps.focus_tracking) {
                try self.setFocusTracking(tty, true);
            }
        },
    }
}

fn checkEnvironmentOverrides(self: *Terminal) void {
    var env_map = std.process.getEnvMap(std.heap.page_allocator) catch return;
    defer env_map.deinit();

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
pub fn setMouseMode(self: *Terminal, tty: AnyWriter, enable: bool) !void {
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

pub fn setBracketedPaste(self: *Terminal, tty: AnyWriter, enable: bool) !void {
    const seq = if (enable) ansi.ANSI.bracketedPasteSet else ansi.ANSI.bracketedPasteReset;
    try tty.writeAll(seq);
    self.state.bracketed_paste = enable;
}

pub fn setFocusTracking(self: *Terminal, tty: AnyWriter, enable: bool) !void {
    const seq = if (enable) ansi.ANSI.focusSet else ansi.ANSI.focusReset;
    try tty.writeAll(seq);
    self.state.focus_tracking = enable;
}

pub fn setKittyKeyboard(self: *Terminal, tty: AnyWriter, enable: bool, flags: u8) !void {
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
    if (std.mem.indexOf(u8, response, "2026;2$y")) |_| {
        self.caps.sync = true;
    }
    if (std.mem.indexOf(u8, response, "2004;1$y") != null or std.mem.indexOf(u8, response, "2004;2$y") != null) {
        self.caps.bracketed_paste = true;
    }

    // Explicit width detection - cursor position report [1;2R means explicit width supported
    if (std.mem.indexOf(u8, response, "\x1b[1;2R")) |_| {
        self.caps.explicit_width = true;
    }

    // Scaled text detection - cursor position report [1;3R means scaled text supported
    if (std.mem.indexOf(u8, response, "\x1b[1;3R")) |_| {
        self.caps.scaled_text = true;
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

    // Kitty graphics response
    if (std.mem.indexOf(u8, response, "\x1b_G")) |_| {
        if (std.mem.indexOf(u8, response, "OK")) |_| {
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

pub fn setTerminalTitle(_: *Terminal, tty: AnyWriter, title: []const u8) void {
    // For Windows, we might need to use different approach, but ANSI sequences work in Windows Terminal, ConPTY, etc.
    // For other platforms, ANSI OSC sequences work reliably
    ansi.ANSI.setTerminalTitleOutput(tty, title) catch {};
}
