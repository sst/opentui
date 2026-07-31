const std = @import("std");
const buffer = @import("../buffer.zig");
const compositor = @import("compositor.zig");
const ghostty = @import("ghostty.zig");

pub const Error = ghostty.Error || buffer.BufferError || error{ResponseOverflow};
pub const ComposeResult = compositor.Result;
pub const KeyAction = ghostty.KeyAction;
pub const MouseAction = ghostty.MouseAction;
pub const MouseButton = ghostty.MouseButton;

pub const Cursor = struct {
    x: u16 = 0,
    y: u16 = 0,
    has_value: bool = false,
    visible: bool = false,
    blinking: bool = false,
    wide_tail: bool = false,
    style: ghostty.CursorVisualStyle = .block,
    color: ?ghostty.Color = null,
};

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
    render_state: ghostty.Handle,
    row_iterator: ghostty.Handle,
    row_cells: ghostty.Handle,
    key_encoder: ghostty.Handle,
    key_event: ghostty.Handle,
    mouse_encoder: ghostty.Handle,
    mouse_event: ghostty.Handle,
    cols: u16,
    rows: u16,
    responses: std.ArrayListUnmanaged(u8),
    response_error: ?Error,
    required_output: usize,

    pub fn init(allocator: std.mem.Allocator, options: Options) Error!*EmbeddedTerminal {
        if (options.cols == 0 or options.rows == 0) return error.InvalidValue;

        const self = allocator.create(EmbeddedTerminal) catch return error.OutOfMemory;
        errdefer allocator.destroy(self);
        self.* = .{
            .allocator = allocator,
            .api = try .load(allocator, options.library_path),
            .terminal = null,
            .render_state = null,
            .row_iterator = null,
            .row_cells = null,
            .key_encoder = null,
            .key_event = null,
            .mouse_encoder = null,
            .mouse_event = null,
            .cols = options.cols,
            .rows = options.rows,
            .responses = .empty,
            .response_error = null,
            .required_output = 0,
        };
        errdefer self.api.deinit();

        try ghostty.result(self.api.terminal_new(null, &self.terminal, .{
            .cols = options.cols,
            .rows = options.rows,
            .max_scrollback = options.max_scrollback,
        }));
        errdefer self.api.terminal_free(self.terminal);
        try ghostty.result(self.api.render_state_new(null, &self.render_state));
        errdefer self.api.render_state_free(self.render_state);
        try ghostty.result(self.api.row_iterator_new(null, &self.row_iterator));
        errdefer self.api.row_iterator_free(self.row_iterator);
        try ghostty.result(self.api.row_cells_new(null, &self.row_cells));
        errdefer self.api.row_cells_free(self.row_cells);
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
        self.api.row_cells_free(self.row_cells);
        self.api.row_iterator_free(self.row_iterator);
        self.api.render_state_free(self.render_state);
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

    /// Force the next composition to redraw every row after the target buffer
    /// is cleared, resized, or moved independently of terminal state.
    pub fn invalidate(self: *EmbeddedTerminal) Error!void {
        const dirty: ghostty.Dirty = .full;
        try ghostty.result(self.api.render_state_set(self.render_state, .dirty, @ptrCast(&dirty)));
    }

    pub fn scroll(self: *EmbeddedTerminal, delta: i32) void {
        self.api.terminal_scroll_viewport(self.terminal, .{
            .tag = .delta,
            .value = .{ .delta = delta },
        });
    }

    pub fn compose(self: *EmbeddedTerminal, target: *buffer.OptimizedBuffer, x: i32, y: i32) Error!ComposeResult {
        try ghostty.result(self.api.render_state_update(self.render_state, self.terminal));
        return compositor.compose(
            self.allocator,
            &self.api,
            self.render_state,
            self.row_iterator,
            self.row_cells,
            target,
            x,
            y,
        );
    }

    pub fn cursor(self: *EmbeddedTerminal) Error!Cursor {
        var result: Cursor = .{};
        try get(self, .cursor_visible, &result.visible);
        try get(self, .cursor_blinking, &result.blinking);
        try get(self, .cursor_viewport_has_value, &result.has_value);
        try get(self, .cursor_visual_style, &result.style);
        if (result.has_value) {
            try get(self, .cursor_viewport_x, &result.x);
            try get(self, .cursor_viewport_y, &result.y);
            try get(self, .cursor_viewport_wide_tail, &result.wide_tail);
        }

        var colors: ghostty.RenderColors = .{};
        try ghostty.result(self.api.render_state_colors_get(self.render_state, &colors));
        result.color = if (colors.cursor_has_value) colors.cursor else colors.foreground;
        return result;
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
        return encode(self.api.key_encoder_encode, self.key_encoder, self.key_event, output, &self.required_output);
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
        return encode(self.api.mouse_encoder_encode, self.mouse_encoder, self.mouse_event, output, &self.required_output);
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
        if (self.response_error) |err| return err;
        const count = @min(output.len, self.responses.items.len);
        @memcpy(output[0..count], self.responses.items[0..count]);
        std.mem.copyForwards(u8, self.responses.items[0 .. self.responses.items.len - count], self.responses.items[count..]);
        self.responses.items.len -= count;
        return count;
    }

    fn get(self: *EmbeddedTerminal, data: ghostty.RenderStateData, output: anytype) Error!void {
        try ghostty.result(self.api.render_state_get(self.render_state, data, @ptrCast(output)));
    }

    fn writePty(_: ghostty.Handle, userdata: ?*anyopaque, data: [*]const u8, len: usize) callconv(.c) void {
        const self: *EmbeddedTerminal = @ptrCast(@alignCast(userdata orelse return));
        const response_limit = 1024 * 1024;
        if (len > response_limit - @min(self.responses.items.len, response_limit)) {
            self.response_error = error.ResponseOverflow;
            return;
        }
        self.responses.appendSlice(self.allocator, data[0..len]) catch {
            self.response_error = error.OutOfMemory;
        };
    }
};

fn encode(
    function: anytype,
    encoder: ghostty.Handle,
    event: ghostty.Handle,
    output: []u8,
    required_output: *usize,
) Error!usize {
    var written: usize = 0;
    const status = function(
        encoder,
        event,
        if (output.len == 0) null else output.ptr,
        output.len,
        &written,
    );
    required_output.* = written;
    try ghostty.result(status);
    return written;
}
