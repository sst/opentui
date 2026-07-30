const std = @import("std");
const ghostty = @import("ghostty.zig");

pub const Error = ghostty.Error;
pub const KeyAction = ghostty.KeyAction;
pub const MouseAction = ghostty.MouseAction;
pub const MouseButton = ghostty.MouseButton;

pub const Key = struct {
    action: ghostty.KeyAction = .press,
    key: c_int = 0,
    mods: u16 = 0,
    consumed_mods: u16 = 0,
    composing: bool = false,
    utf8: []const u8 = "",
    unshifted_codepoint: u32 = 0,
};

pub const Mouse = struct {
    action: ghostty.MouseAction,
    button: ?ghostty.MouseButton = null,
    mods: u16 = 0,
    x: f32,
    y: f32,
    any_button_pressed: bool = false,
};

pub const Options = struct {
    cols: u16,
    rows: u16,
    max_scrollback: usize = 10_000,
    library_path: ?[]const u8 = null,
};

pub const EmbeddedTerminal = struct {
    allocator: std.mem.Allocator,
    api: ghostty.Api,
    terminal: ghostty.Handle,
    key_encoder: ghostty.Handle,
    key_event: ghostty.Handle,
    mouse_encoder: ghostty.Handle,
    mouse_event: ghostty.Handle,
    cols: u16,
    rows: u16,
    responses: std.ArrayListUnmanaged(u8),
    response_error: bool,

    pub fn init(allocator: std.mem.Allocator, options: Options) Error!*EmbeddedTerminal {
        if (options.cols == 0 or options.rows == 0) return error.InvalidValue;

        const self = allocator.create(EmbeddedTerminal) catch return error.OutOfMemory;
        errdefer allocator.destroy(self);
        self.* = .{
            .allocator = allocator,
            .api = try .load(allocator, options.library_path),
            .terminal = null,
            .key_encoder = null,
            .key_event = null,
            .mouse_encoder = null,
            .mouse_event = null,
            .cols = options.cols,
            .rows = options.rows,
            .responses = .empty,
            .response_error = false,
        };
        errdefer self.api.deinit();

        try ghostty.result(self.api.terminal_new(null, &self.terminal, .{
            .cols = options.cols,
            .rows = options.rows,
            .max_scrollback = options.max_scrollback,
        }));
        errdefer self.api.terminal_free(self.terminal);
        try ghostty.result(self.api.key_encoder_new(null, &self.key_encoder));
        errdefer self.api.key_encoder_free(self.key_encoder);
        try ghostty.result(self.api.key_event_new(null, &self.key_event));
        errdefer self.api.key_event_free(self.key_event);
        try ghostty.result(self.api.mouse_encoder_new(null, &self.mouse_encoder));
        errdefer self.api.mouse_encoder_free(self.mouse_encoder);
        try ghostty.result(self.api.mouse_event_new(null, &self.mouse_event));
        errdefer self.api.mouse_event_free(self.mouse_event);
        try ghostty.result(self.api.terminal_set(self.terminal, .userdata, self));
        try ghostty.result(self.api.terminal_set(self.terminal, .write_pty, @ptrCast(&writePty)));
        return self;
    }

    pub fn deinit(self: *EmbeddedTerminal) void {
        const allocator = self.allocator;
        self.api.mouse_event_free(self.mouse_event);
        self.api.mouse_encoder_free(self.mouse_encoder);
        self.api.key_event_free(self.key_event);
        self.api.key_encoder_free(self.key_encoder);
        self.api.terminal_free(self.terminal);
        self.api.deinit();
        self.responses.deinit(allocator);
        allocator.destroy(self);
    }

    pub fn write(self: *EmbeddedTerminal, bytes: []const u8) void {
        self.api.terminal_write(self.terminal, if (bytes.len == 0) null else bytes.ptr, bytes.len);
    }

    pub fn resize(self: *EmbeddedTerminal, cols: u16, rows: u16) Error!void {
        if (cols == 0 or rows == 0) return error.InvalidValue;
        try ghostty.result(self.api.terminal_resize(self.terminal, cols, rows, 0, 0));
        self.cols = cols;
        self.rows = rows;
    }

    pub fn scroll(self: *EmbeddedTerminal, delta: i32) void {
        self.api.terminal_scroll_viewport(self.terminal, .{
            .tag = .delta,
            .value = .{ .delta = delta },
        });
    }

    pub fn encodeKey(self: *EmbeddedTerminal, key: Key, output: []u8) Error!usize {
        self.api.key_encoder_from_terminal(self.key_encoder, self.terminal);
        self.api.key_event_set_action(self.key_event, key.action);
        self.api.key_event_set_key(self.key_event, key.key);
        self.api.key_event_set_mods(self.key_event, key.mods);
        self.api.key_event_set_consumed_mods(self.key_event, key.consumed_mods);
        self.api.key_event_set_composing(self.key_event, key.composing);
        self.api.key_event_set_utf8(self.key_event, if (key.utf8.len == 0) null else key.utf8.ptr, key.utf8.len);
        self.api.key_event_set_unshifted_codepoint(self.key_event, key.unshifted_codepoint);
        return encode(self.api.key_encoder_encode, self.key_encoder, self.key_event, output);
    }

    pub fn encodeMouse(self: *EmbeddedTerminal, mouse: Mouse, output: []u8) Error!usize {
        self.api.mouse_encoder_from_terminal(self.mouse_encoder, self.terminal);
        const size: ghostty.MouseEncoderSize = .{
            .screen_width = self.cols,
            .screen_height = self.rows,
        };
        const track_last_cell = true;
        self.api.mouse_encoder_setopt(self.mouse_encoder, .size, @ptrCast(&size));
        self.api.mouse_encoder_setopt(self.mouse_encoder, .any_button_pressed, @ptrCast(&mouse.any_button_pressed));
        self.api.mouse_encoder_setopt(self.mouse_encoder, .track_last_cell, @ptrCast(&track_last_cell));
        self.api.mouse_event_set_action(self.mouse_event, mouse.action);
        if (mouse.button) |button| self.api.mouse_event_set_button(self.mouse_event, button) else self.api.mouse_event_clear_button(self.mouse_event);
        self.api.mouse_event_set_mods(self.mouse_event, mouse.mods);
        self.api.mouse_event_set_position(self.mouse_event, .{ .x = mouse.x, .y = mouse.y });
        return encode(self.api.mouse_encoder_encode, self.mouse_encoder, self.mouse_event, output);
    }

    pub fn encodePaste(self: *EmbeddedTerminal, input: []const u8, output: []u8) Error!usize {
        const copy = self.allocator.dupe(u8, input) catch return error.OutOfMemory;
        defer self.allocator.free(copy);
        var bracketed = false;
        try ghostty.result(self.api.terminal_mode_get(self.terminal, 2004, &bracketed));
        var written: usize = 0;
        try ghostty.result(self.api.paste_encode(
            if (copy.len == 0) null else copy.ptr,
            copy.len,
            bracketed,
            if (output.len == 0) null else output.ptr,
            output.len,
            &written,
        ));
        return written;
    }

    pub fn encodeFocus(self: *EmbeddedTerminal, focused: bool, output: []u8) Error!usize {
        var enabled = false;
        try ghostty.result(self.api.terminal_mode_get(self.terminal, 1004, &enabled));
        if (!enabled) return 0;
        var written: usize = 0;
        try ghostty.result(self.api.focus_encode(
            if (focused) 0 else 1,
            if (output.len == 0) null else output.ptr,
            output.len,
            &written,
        ));
        return written;
    }

    pub fn drainResponses(self: *EmbeddedTerminal, output: []u8) Error!usize {
        if (self.response_error) return error.OutOfMemory;
        const count = @min(output.len, self.responses.items.len);
        @memcpy(output[0..count], self.responses.items[0..count]);
        std.mem.copyForwards(u8, self.responses.items[0 .. self.responses.items.len - count], self.responses.items[count..]);
        self.responses.items.len -= count;
        return count;
    }

    fn writePty(_: ghostty.Handle, userdata: ?*anyopaque, data: [*]const u8, len: usize) callconv(.c) void {
        const self: *EmbeddedTerminal = @ptrCast(@alignCast(userdata orelse return));
        self.responses.appendSlice(self.allocator, data[0..len]) catch {
            self.response_error = true;
        };
    }
};

fn encode(
    function: anytype,
    encoder: ghostty.Handle,
    event: ghostty.Handle,
    output: []u8,
) Error!usize {
    var written: usize = 0;
    try ghostty.result(function(
        encoder,
        event,
        if (output.len == 0) null else output.ptr,
        output.len,
        &written,
    ));
    return written;
}
