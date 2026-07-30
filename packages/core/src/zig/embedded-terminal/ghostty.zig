const std = @import("std");

pub const Error = error{
    LibraryNotFound,
    MissingSymbol,
    OutOfMemory,
    InvalidValue,
    OutOfSpace,
    NoValue,
};

pub const Result = enum(c_int) {
    success = 0,
    out_of_memory = -1,
    invalid_value = -2,
    out_of_space = -3,
    no_value = -4,
    _,
};

pub const Handle = ?*anyopaque;

pub const TerminalOptions = extern struct {
    cols: u16,
    rows: u16,
    max_scrollback: usize,
};

pub const TerminalOption = enum(c_int) {
    userdata = 0,
    write_pty = 1,
    _,
};

pub const KeyAction = enum(c_int) {
    release = 0,
    press = 1,
    repeat = 2,
    _,
};

pub const MouseAction = enum(c_int) {
    press = 0,
    release = 1,
    motion = 2,
    _,
};

pub const MouseButton = enum(c_int) {
    unknown = 0,
    left = 1,
    right = 2,
    middle = 3,
    four = 4,
    five = 5,
    six = 6,
    seven = 7,
    _,
};

pub const MousePosition = extern struct {
    x: f32,
    y: f32,
};

pub const MouseEncoderOption = enum(c_int) {
    event = 0,
    format = 1,
    size = 2,
    any_button_pressed = 3,
    track_last_cell = 4,
    _,
};

pub const MouseEncoderSize = extern struct {
    size: usize = @sizeOf(MouseEncoderSize),
    screen_width: u32,
    screen_height: u32,
    cell_width: u32 = 1,
    cell_height: u32 = 1,
    padding_top: u32 = 0,
    padding_bottom: u32 = 0,
    padding_right: u32 = 0,
    padding_left: u32 = 0,
};

pub const ScrollViewportTag = enum(c_int) {
    top = 0,
    bottom = 1,
    delta = 2,
    row = 3,
    _,
};

pub const ScrollViewportValue = extern union {
    delta: isize,
    row: usize,
    _padding: [2]u64,
};

pub const ScrollViewport = extern struct {
    tag: ScrollViewportTag,
    value: ScrollViewportValue,
};

const TerminalNew = *const fn (?*const anyopaque, *Handle, TerminalOptions) callconv(.c) Result;
const TerminalFree = *const fn (Handle) callconv(.c) void;
const TerminalWrite = *const fn (Handle, ?[*]const u8, usize) callconv(.c) void;
const TerminalResize = *const fn (Handle, u16, u16, u32, u32) callconv(.c) Result;
const TerminalSet = *const fn (Handle, TerminalOption, ?*const anyopaque) callconv(.c) Result;
const TerminalModeGet = *const fn (Handle, u16, *bool) callconv(.c) Result;
const TerminalScrollViewport = *const fn (Handle, ScrollViewport) callconv(.c) void;
const KeyEventNew = *const fn (?*const anyopaque, *Handle) callconv(.c) Result;
const KeyEventFree = *const fn (Handle) callconv(.c) void;
const KeyEventSetAction = *const fn (Handle, KeyAction) callconv(.c) void;
const KeyEventSetKey = *const fn (Handle, c_int) callconv(.c) void;
const KeyEventSetMods = *const fn (Handle, u16) callconv(.c) void;
const KeyEventSetConsumedMods = *const fn (Handle, u16) callconv(.c) void;
const KeyEventSetComposing = *const fn (Handle, bool) callconv(.c) void;
const KeyEventSetUtf8 = *const fn (Handle, ?[*]const u8, usize) callconv(.c) void;
const KeyEventSetUnshiftedCodepoint = *const fn (Handle, u32) callconv(.c) void;
const KeyEncoderNew = *const fn (?*const anyopaque, *Handle) callconv(.c) Result;
const KeyEncoderFree = *const fn (Handle) callconv(.c) void;
const KeyEncoderFromTerminal = *const fn (Handle, Handle) callconv(.c) void;
const KeyEncoderEncode = *const fn (Handle, Handle, ?[*]u8, usize, *usize) callconv(.c) Result;
const MouseEventNew = *const fn (?*const anyopaque, *Handle) callconv(.c) Result;
const MouseEventFree = *const fn (Handle) callconv(.c) void;
const MouseEventSetAction = *const fn (Handle, MouseAction) callconv(.c) void;
const MouseEventSetButton = *const fn (Handle, MouseButton) callconv(.c) void;
const MouseEventClearButton = *const fn (Handle) callconv(.c) void;
const MouseEventSetMods = *const fn (Handle, u16) callconv(.c) void;
const MouseEventSetPosition = *const fn (Handle, MousePosition) callconv(.c) void;
const MouseEncoderNew = *const fn (?*const anyopaque, *Handle) callconv(.c) Result;
const MouseEncoderFree = *const fn (Handle) callconv(.c) void;
const MouseEncoderSetopt = *const fn (Handle, MouseEncoderOption, *const anyopaque) callconv(.c) void;
const MouseEncoderFromTerminal = *const fn (Handle, Handle) callconv(.c) void;
const MouseEncoderEncode = *const fn (Handle, Handle, ?[*]u8, usize, *usize) callconv(.c) Result;
const PasteEncode = *const fn (?[*]u8, usize, bool, ?[*]u8, usize, *usize) callconv(.c) Result;
const FocusEncode = *const fn (c_int, ?[*]u8, usize, *usize) callconv(.c) Result;

pub const Api = struct {
    library: std.DynLib,
    terminal_new: TerminalNew,
    terminal_free: TerminalFree,
    terminal_write: TerminalWrite,
    terminal_resize: TerminalResize,
    terminal_set: TerminalSet,
    terminal_mode_get: TerminalModeGet,
    terminal_scroll_viewport: TerminalScrollViewport,
    key_event_new: KeyEventNew,
    key_event_free: KeyEventFree,
    key_event_set_action: KeyEventSetAction,
    key_event_set_key: KeyEventSetKey,
    key_event_set_mods: KeyEventSetMods,
    key_event_set_consumed_mods: KeyEventSetConsumedMods,
    key_event_set_composing: KeyEventSetComposing,
    key_event_set_utf8: KeyEventSetUtf8,
    key_event_set_unshifted_codepoint: KeyEventSetUnshiftedCodepoint,
    key_encoder_new: KeyEncoderNew,
    key_encoder_free: KeyEncoderFree,
    key_encoder_from_terminal: KeyEncoderFromTerminal,
    key_encoder_encode: KeyEncoderEncode,
    mouse_event_new: MouseEventNew,
    mouse_event_free: MouseEventFree,
    mouse_event_set_action: MouseEventSetAction,
    mouse_event_set_button: MouseEventSetButton,
    mouse_event_clear_button: MouseEventClearButton,
    mouse_event_set_mods: MouseEventSetMods,
    mouse_event_set_position: MouseEventSetPosition,
    mouse_encoder_new: MouseEncoderNew,
    mouse_encoder_free: MouseEncoderFree,
    mouse_encoder_setopt: MouseEncoderSetopt,
    mouse_encoder_from_terminal: MouseEncoderFromTerminal,
    mouse_encoder_encode: MouseEncoderEncode,
    paste_encode: PasteEncode,
    focus_encode: FocusEncode,

    pub fn load(allocator: std.mem.Allocator, explicit_path: ?[]const u8) Error!Api {
        if (explicit_path) |path| return loadPath(path);

        if (std.process.getEnvVarOwned(allocator, "OPENTUI_GHOSTTY_VT_LIBRARY")) |path| {
            defer allocator.free(path);
            return loadPath(path);
        } else |err| switch (err) {
            error.EnvironmentVariableNotFound => {},
            else => return error.OutOfMemory,
        }

        return error.LibraryNotFound;
    }

    fn loadPath(path: []const u8) Error!Api {
        var library = std.DynLib.open(path) catch return error.LibraryNotFound;
        errdefer library.close();
        return .{
            .library = library,
            .terminal_new = lookup(&library, TerminalNew, "ghostty_terminal_new") orelse return error.MissingSymbol,
            .terminal_free = lookup(&library, TerminalFree, "ghostty_terminal_free") orelse return error.MissingSymbol,
            .terminal_write = lookup(&library, TerminalWrite, "ghostty_terminal_vt_write") orelse return error.MissingSymbol,
            .terminal_resize = lookup(&library, TerminalResize, "ghostty_terminal_resize") orelse return error.MissingSymbol,
            .terminal_set = lookup(&library, TerminalSet, "ghostty_terminal_set") orelse return error.MissingSymbol,
            .terminal_mode_get = lookup(&library, TerminalModeGet, "ghostty_terminal_mode_get") orelse return error.MissingSymbol,
            .terminal_scroll_viewport = lookup(&library, TerminalScrollViewport, "ghostty_terminal_scroll_viewport") orelse return error.MissingSymbol,
            .key_event_new = lookup(&library, KeyEventNew, "ghostty_key_event_new") orelse return error.MissingSymbol,
            .key_event_free = lookup(&library, KeyEventFree, "ghostty_key_event_free") orelse return error.MissingSymbol,
            .key_event_set_action = lookup(&library, KeyEventSetAction, "ghostty_key_event_set_action") orelse return error.MissingSymbol,
            .key_event_set_key = lookup(&library, KeyEventSetKey, "ghostty_key_event_set_key") orelse return error.MissingSymbol,
            .key_event_set_mods = lookup(&library, KeyEventSetMods, "ghostty_key_event_set_mods") orelse return error.MissingSymbol,
            .key_event_set_consumed_mods = lookup(&library, KeyEventSetConsumedMods, "ghostty_key_event_set_consumed_mods") orelse return error.MissingSymbol,
            .key_event_set_composing = lookup(&library, KeyEventSetComposing, "ghostty_key_event_set_composing") orelse return error.MissingSymbol,
            .key_event_set_utf8 = lookup(&library, KeyEventSetUtf8, "ghostty_key_event_set_utf8") orelse return error.MissingSymbol,
            .key_event_set_unshifted_codepoint = lookup(&library, KeyEventSetUnshiftedCodepoint, "ghostty_key_event_set_unshifted_codepoint") orelse return error.MissingSymbol,
            .key_encoder_new = lookup(&library, KeyEncoderNew, "ghostty_key_encoder_new") orelse return error.MissingSymbol,
            .key_encoder_free = lookup(&library, KeyEncoderFree, "ghostty_key_encoder_free") orelse return error.MissingSymbol,
            .key_encoder_from_terminal = lookup(&library, KeyEncoderFromTerminal, "ghostty_key_encoder_setopt_from_terminal") orelse return error.MissingSymbol,
            .key_encoder_encode = lookup(&library, KeyEncoderEncode, "ghostty_key_encoder_encode") orelse return error.MissingSymbol,
            .mouse_event_new = lookup(&library, MouseEventNew, "ghostty_mouse_event_new") orelse return error.MissingSymbol,
            .mouse_event_free = lookup(&library, MouseEventFree, "ghostty_mouse_event_free") orelse return error.MissingSymbol,
            .mouse_event_set_action = lookup(&library, MouseEventSetAction, "ghostty_mouse_event_set_action") orelse return error.MissingSymbol,
            .mouse_event_set_button = lookup(&library, MouseEventSetButton, "ghostty_mouse_event_set_button") orelse return error.MissingSymbol,
            .mouse_event_clear_button = lookup(&library, MouseEventClearButton, "ghostty_mouse_event_clear_button") orelse return error.MissingSymbol,
            .mouse_event_set_mods = lookup(&library, MouseEventSetMods, "ghostty_mouse_event_set_mods") orelse return error.MissingSymbol,
            .mouse_event_set_position = lookup(&library, MouseEventSetPosition, "ghostty_mouse_event_set_position") orelse return error.MissingSymbol,
            .mouse_encoder_new = lookup(&library, MouseEncoderNew, "ghostty_mouse_encoder_new") orelse return error.MissingSymbol,
            .mouse_encoder_free = lookup(&library, MouseEncoderFree, "ghostty_mouse_encoder_free") orelse return error.MissingSymbol,
            .mouse_encoder_setopt = lookup(&library, MouseEncoderSetopt, "ghostty_mouse_encoder_setopt") orelse return error.MissingSymbol,
            .mouse_encoder_from_terminal = lookup(&library, MouseEncoderFromTerminal, "ghostty_mouse_encoder_setopt_from_terminal") orelse return error.MissingSymbol,
            .mouse_encoder_encode = lookup(&library, MouseEncoderEncode, "ghostty_mouse_encoder_encode") orelse return error.MissingSymbol,
            .paste_encode = lookup(&library, PasteEncode, "ghostty_paste_encode") orelse return error.MissingSymbol,
            .focus_encode = lookup(&library, FocusEncode, "ghostty_focus_encode") orelse return error.MissingSymbol,
        };
    }

    pub fn deinit(self: *Api) void {
        self.library.close();
        self.* = undefined;
    }
};

fn lookup(library: *std.DynLib, comptime T: type, name: [:0]const u8) ?T {
    return library.lookup(T, name);
}

pub fn result(value: Result) Error!void {
    return switch (value) {
        .success => {},
        .out_of_memory => error.OutOfMemory,
        .invalid_value => error.InvalidValue,
        .out_of_space => error.OutOfSpace,
        .no_value => error.NoValue,
        else => error.InvalidValue,
    };
}
