const std = @import("std");
const builtin = @import("builtin");
const buffer = @import("buffer.zig");
const build_options = @import("build_options");

// ===============================
// libvterm integration using C wrapper to avoid Zig @cImport issues
// ===============================

// Use build-time detection of libvterm availability
pub const HAS_LIBVTERM = build_options.has_libvterm;

// Define core types that work across platforms
pub const VTermPos = struct {
    row: i32,
    col: i32,
};

pub const VTermRect = struct {
    start_row: i32,
    end_row: i32,
    start_col: i32,
    end_col: i32,
};

pub const SelectionRect = struct {
    start_row: i32,
    end_row: i32,
    start_col: i32,
    end_col: i32,

    pub fn normalize(self: SelectionRect, max_rows: u16, max_cols: u16) ?SelectionRect {
        var start_row = @max(0, @min(self.start_row, self.end_row));
        var end_row = @max(self.start_row, self.end_row);
        var start_col = @max(0, @min(self.start_col, self.end_col));
        var end_col = @max(self.start_col, self.end_col);

        const max_r: i32 = @intCast(max_rows);
        const max_c: i32 = @intCast(max_cols);

        start_row = @max(0, @min(start_row, max_r));
        end_row = @max(0, @min(end_row, max_r));
        start_col = @max(0, @min(start_col, max_c));
        end_col = @max(0, @min(end_col, max_c));

        if (end_row <= start_row or end_col <= start_col) return null;

        return SelectionRect{
            .start_row = start_row,
            .end_row = end_row,
            .start_col = start_col,
            .end_col = end_col,
        };
    }
};

pub const SelectionColors = struct {
    fg: buffer.RGBA,
    bg: buffer.RGBA,
};

pub const VTermColor = struct {
    r: u8,
    g: u8,
    b: u8,
    is_default: bool,

    pub fn to_rgba(self: VTermColor) buffer.RGBA {
        // Use proper defaults when is_default is true
        if (self.is_default) {
            // Default foreground is white, but we'll determine that in context
            // For now, return white as a safe default
            return .{ 1.0, 1.0, 1.0, 1.0 };
        }
        return .{
            @as(f32, @floatFromInt(self.r)) / 255.0,
            @as(f32, @floatFromInt(self.g)) / 255.0,
            @as(f32, @floatFromInt(self.b)) / 255.0,
            1.0,
        };
    }
};

pub const VTermScreenCellAttrs = struct {
    bold: bool,
    underline: u2,
    italic: bool,
    blink: bool,
    reverse: bool,
    conceal: bool,
    strike: bool,
};

pub const VTermScreenCell = struct {
    chars: [6]u32,
    width: i8,
    attrs: VTermScreenCellAttrs,
    fg: VTermColor,
    bg: VTermColor,
};

pub const VTermModifier = packed struct(u8) {
    shift: bool = false,
    alt: bool = false,
    ctrl: bool = false,
    _padding: u5 = 0,

    pub fn to_c_uint(self: VTermModifier) c_uint {
        var result: c_uint = 0;
        if (self.shift) result |= 1; // VTERM_MOD_SHIFT
        if (self.alt) result |= 2;   // VTERM_MOD_ALT  
        if (self.ctrl) result |= 4;  // VTERM_MOD_CTRL
        return result;
    }
};

// Key constants
pub const VTermKey = struct {
    pub const NONE = 0;
    pub const ENTER = 1;
    pub const TAB = 2;
    pub const BACKSPACE = 3;
    pub const ESCAPE = 4;
    pub const UP = 5;
    pub const DOWN = 6;
    pub const LEFT = 7;
    pub const RIGHT = 8;
    pub const INS = 9;
    pub const DEL = 10;
    pub const HOME = 11;
    pub const END = 12;
    pub const PAGEUP = 13;
    pub const PAGEDOWN = 14;
};

// Platform-specific implementation
const LibVTermImpl = if (HAS_LIBVTERM) struct {
    // Import only our wrapper functions to avoid problematic types
    extern fn vterm_wrapper_new(rows: c_int, cols: c_int) ?*anyopaque;
    extern fn vterm_wrapper_free(vt: *anyopaque) void;
    extern fn vterm_wrapper_set_size(vt: *anyopaque, rows: c_int, cols: c_int) void;
    extern fn vterm_wrapper_set_utf8(vt: *anyopaque, is_utf8: c_int) void;
    extern fn vterm_wrapper_input_write(vt: *anyopaque, bytes: [*]const u8, len: usize) usize;
    
    extern fn vterm_wrapper_obtain_screen(vt: *anyopaque) ?*anyopaque;
    extern fn vterm_wrapper_screen_enable_altscreen(screen: *anyopaque, altscreen: c_int) void;
    extern fn vterm_wrapper_screen_flush_damage(screen: *anyopaque) void;
    extern fn vterm_wrapper_screen_reset(screen: *anyopaque, hard: c_int) void;
    extern fn vterm_wrapper_screen_get_cell(
        screen: *anyopaque, 
        row: c_int, 
        col: c_int,
        chars: [*]u32,
        width: *i8,
        bold: *c_int,
        underline: *c_int,
        italic: *c_int,
        blink: *c_int,
        reverse: *c_int,
        conceal: *c_int,
        strike: *c_int,
        fg_r: *c_int,
        fg_g: *c_int,
        fg_b: *c_int,
        fg_default: *c_int,
        bg_r: *c_int,
        bg_g: *c_int,
        bg_b: *c_int,
        bg_default: *c_int
    ) c_int;
    
    extern fn vterm_wrapper_obtain_state(vt: *anyopaque) ?*anyopaque;
    extern fn vterm_wrapper_state_get_cursorpos(state: *anyopaque, row: *c_int, col: *c_int) void;
    extern fn vterm_wrapper_state_get_default_colors(
        state: *anyopaque,
        fg_r: *c_int,
        fg_g: *c_int,
        fg_b: *c_int,
        bg_r: *c_int,
        bg_g: *c_int,
        bg_b: *c_int,
    ) void;
    extern fn vterm_wrapper_keyboard_unichar(vt: *anyopaque, c: u32, mod: c_uint) void;
    extern fn vterm_wrapper_keyboard_key(vt: *anyopaque, key: c_uint, mod: c_uint) void;
    extern fn vterm_wrapper_mouse_move(vt: *anyopaque, row: c_int, col: c_int, mod: c_uint) void;
    extern fn vterm_wrapper_mouse_button(vt: *anyopaque, button: c_int, pressed: c_int, mod: c_uint) void;

    extern fn vterm_wrapper_enable_callbacks(screen: *anyopaque) void;
    extern fn vterm_wrapper_disable_callbacks(screen: *anyopaque) void;
    extern fn vterm_wrapper_poll_callbacks(
        screen: *anyopaque,
        cursor_row: *c_int,
        cursor_col: *c_int,
        cursor_visible: *c_int,
        damage_pending: *c_int,
        damage_rect: *VTermRect,
    ) void;

    pub const LibVTermRenderer = struct {
        allocator: std.mem.Allocator,
        vterm: *anyopaque,
        screen: *anyopaque,
        state: *anyopaque,
        cols: u16,
        rows: u16,
        cursor_pos: VTermPos,
        cursor_visible: bool,
        default_fg: buffer.RGBA,
        default_bg: buffer.RGBA,
        selection_rect: ?SelectionRect,
        selection_colors: SelectionColors,
        pending_damage: ?VTermRect,

        const Self = @This();

        pub fn init(allocator: std.mem.Allocator, cols: u16, rows: u16) !*Self {
            const vterm = vterm_wrapper_new(@intCast(rows), @intCast(cols)) orelse return error.VTermCreateFailed;
            
            const screen = vterm_wrapper_obtain_screen(vterm);
            const state = vterm_wrapper_obtain_state(vterm);

            if (screen == null or state == null) {
                vterm_wrapper_free(vterm);
                return error.VTermInitFailed;
            }

            const self = try allocator.create(Self);
            self.* = .{
                .allocator = allocator,
                .vterm = vterm,
                .screen = screen.?,
                .state = state.?,
                .cols = cols,
                .rows = rows,
                .cursor_pos = .{ .row = 0, .col = 0 },
                .cursor_visible = true,
                .default_fg = .{ 1.0, 1.0, 1.0, 1.0 },
                .default_bg = .{ 0.0, 0.0, 0.0, 1.0 },
                .selection_rect = null,
                .selection_colors = SelectionColors{
                    .fg = .{ 0.0, 0.0, 0.0, 1.0 },
                    .bg = .{ 0.7, 0.7, 0.9, 1.0 },
                },
                .pending_damage = null,
            };

            // Set up callbacks for cursor tracking and damage notifications
            self.setupCallbacks();

            // Enable UTF-8 support
            vterm_wrapper_set_utf8(vterm, 1);
            
            // Reset the screen to initialize it properly  
            vterm_wrapper_screen_reset(screen.?, 1);  // Use hard reset

            // Disable alternate screen - we want normal screen for PTY
            vterm_wrapper_screen_enable_altscreen(screen.?, 0);

            self.refreshState();

            return self;
        }

        pub fn deinit(self: *Self) void {
            vterm_wrapper_disable_callbacks(self.screen);
            vterm_wrapper_free(self.vterm);
            self.allocator.destroy(self);
        }

        fn setupCallbacks(self: *Self) void {
            vterm_wrapper_enable_callbacks(self.screen);
        }

        pub fn resize(self: *Self, cols: u16, rows: u16) void {
            self.cols = cols;
            self.rows = rows;
            vterm_wrapper_set_size(self.vterm, @intCast(rows), @intCast(cols));
            self.refreshState();
        }

        pub fn write(self: *Self, data: []const u8) usize {
            // Add basic validation
            if (data.len == 0) return 0;

            const written = vterm_wrapper_input_write(self.vterm, data.ptr, data.len);
            self.refreshState();
            return written;
        }

        pub fn keyboardUnichar(self: *Self, char: u32, modifier: VTermModifier) void {
            vterm_wrapper_keyboard_unichar(self.vterm, char, modifier.to_c_uint());
            self.refreshState();
        }

        pub fn keyboardKey(self: *Self, key: c_int, modifier: VTermModifier) void {
            vterm_wrapper_keyboard_key(self.vterm, @intCast(key), modifier.to_c_uint());
            self.refreshState();
        }

        pub fn mouseMove(self: *Self, row: i32, col: i32, modifier: VTermModifier) void {
            vterm_wrapper_mouse_move(self.vterm, row, col, modifier.to_c_uint());
            self.refreshState();
        }

        pub fn mouseButton(self: *Self, button: i32, pressed: bool, modifier: VTermModifier) void {
            vterm_wrapper_mouse_button(self.vterm, button, if (pressed) 1 else 0, modifier.to_c_uint());
            self.refreshState();
        }

        fn refreshState(self: *Self) void {
            var row: c_int = 0;
            var col: c_int = 0;
            vterm_wrapper_state_get_cursorpos(self.state, &row, &col);
            self.cursor_pos = .{ .row = row, .col = col };

            var fg_r: c_int = 255;
            var fg_g: c_int = 255;
            var fg_b: c_int = 255;
            var bg_r: c_int = 0;
            var bg_g: c_int = 0;
            var bg_b: c_int = 0;
            vterm_wrapper_state_get_default_colors(self.state, &fg_r, &fg_g, &fg_b, &bg_r, &bg_g, &bg_b);

            self.default_fg = .{
                @as(f32, @floatFromInt(std.math.clamp(fg_r, 0, 255))) / 255.0,
                @as(f32, @floatFromInt(std.math.clamp(fg_g, 0, 255))) / 255.0,
                @as(f32, @floatFromInt(std.math.clamp(fg_b, 0, 255))) / 255.0,
                1.0,
            };

            self.default_bg = .{
                @as(f32, @floatFromInt(std.math.clamp(bg_r, 0, 255))) / 255.0,
                @as(f32, @floatFromInt(std.math.clamp(bg_g, 0, 255))) / 255.0,
                @as(f32, @floatFromInt(std.math.clamp(bg_b, 0, 255))) / 255.0,
                1.0,
            };

            var cb_row: c_int = -1;
            var cb_col: c_int = -1;
            var cb_visible: c_int = -1;
            var cb_damage: c_int = 0;
            var cb_rect: VTermRect = .{ .start_row = 0, .end_row = 0, .start_col = 0, .end_col = 0 };
            vterm_wrapper_poll_callbacks(self.screen, &cb_row, &cb_col, &cb_visible, &cb_damage, &cb_rect);

            if (cb_row >= 0 and cb_col >= 0) {
                self.cursor_pos = .{ .row = cb_row, .col = cb_col };
            }
            if (cb_visible >= 0) {
                self.cursor_visible = cb_visible != 0;
            }
            self.pending_damage = if (cb_damage != 0) cb_rect else null;
        }

        pub fn setSelection(self: *Self, rect: ?SelectionRect) void {
            if (rect) |raw_rect| {
                self.selection_rect = raw_rect.normalize(self.rows, self.cols);
            } else {
                self.selection_rect = null;
            }
        }

        pub fn setSelectionColors(self: *Self, fg: buffer.RGBA, bg: buffer.RGBA) void {
            self.selection_colors = .{ .fg = fg, .bg = bg };
        }

        pub fn clearSelection(self: *Self) void {
            self.selection_rect = null;
        }

        pub fn hasSelection(self: *Self) bool {
            return self.selection_rect != null;
        }

        pub fn isCellSelected(self: *Self, row: i32, col: i32) bool {
            if (self.selection_rect) |rect| {
                return row >= rect.start_row and row < rect.end_row and
                    col >= rect.start_col and col < rect.end_col;
            }
            return false;
        }

        pub fn getSelectionColors(self: *Self) SelectionColors {
            return self.selection_colors;
        }

        pub fn copySelection(self: *Self, rect: SelectionRect, out: []u8) usize {
            if (rect.normalize(self.rows, self.cols)) |normalized| {
                self.flushDamage();

                var out_index: usize = 0;
                var row = normalized.start_row;
                const last_row = normalized.end_row - 1;
                while (row < normalized.end_row and out_index < out.len) : (row += 1) {
                    var col = normalized.start_col;
                    while (col < normalized.end_col and out_index < out.len) {
                        const pos = VTermPos{ .row = row, .col = col };
                        const maybe_cell = self.getCell(pos);
                        var advance: i32 = 1;
                        if (maybe_cell) |cell| {
                            advance = if (cell.width <= 0) 1 else cell.width;
                            var i: usize = 0;
                            while (i < cell.chars.len and cell.chars[i] != 0) : (i += 1) {
                                const maybe_codepoint = std.math.cast(u21, cell.chars[i]);
                                if (maybe_codepoint) |codepoint| {
                                    var utf8_buf: [4]u8 = undefined;
                                    const len = std.unicode.utf8Encode(codepoint, &utf8_buf) catch 0;
                                    if (len == 0) continue;
                                    if (out_index + len > out.len) return out_index;
                                    @memcpy(out[out_index .. out_index + len], utf8_buf[0..len]);
                                    out_index += len;
                                }
                            }
                        } else {
                            if (out_index < out.len) {
                                out[out_index] = ' ';
                                out_index += 1;
                            }
                        }
                        col += @max(advance, 1);
                    }

                    if (row < last_row and out_index < out.len) {
                        out[out_index] = '\n';
                        out_index += 1;
                    }
                }

                return out_index;
            }

            return 0;
        }

        pub fn getCell(self: *Self, pos: VTermPos) ?VTermScreenCell {
            var chars: [6]u32 = [_]u32{0} ** 6;
            var width: i8 = 0;
            var bold: c_int = 0;
            var underline: c_int = 0;
            var italic: c_int = 0;
            var blink: c_int = 0;
            var reverse: c_int = 0;
            var conceal: c_int = 0;
            var strike: c_int = 0;
            var fg_r: c_int = 0;
            var fg_g: c_int = 0;
            var fg_b: c_int = 0;
            var fg_default: c_int = 0;
            var bg_r: c_int = 0;
            var bg_g: c_int = 0;
            var bg_b: c_int = 0;
            var bg_default: c_int = 0;

            const result = vterm_wrapper_screen_get_cell(
                self.screen, pos.row, pos.col,
                &chars, &width,
                &bold, &underline, &italic, &blink, &reverse, &conceal, &strike,
                &fg_r, &fg_g, &fg_b, &fg_default,
                &bg_r, &bg_g, &bg_b, &bg_default
            );

            if (result == 0) return null;

            return VTermScreenCell{
                .chars = chars,
                .width = width,
                .attrs = VTermScreenCellAttrs{
                    .bold = bold != 0,
                    .underline = @intCast(@min(@as(u32, @intCast(underline)), 3)),
                    .italic = italic != 0,
                    .blink = blink != 0,
                    .reverse = reverse != 0,
                    .conceal = conceal != 0,
                    .strike = strike != 0,
                },
                .fg = VTermColor{
                    .r = @intCast(@max(0, @min(255, fg_r))),
                    .g = @intCast(@max(0, @min(255, fg_g))),
                    .b = @intCast(@max(0, @min(255, fg_b))),
                    .is_default = fg_default != 0,
                },
                .bg = VTermColor{
                    .r = @intCast(@max(0, @min(255, bg_r))),
                    .g = @intCast(@max(0, @min(255, bg_g))),
                    .b = @intCast(@max(0, @min(255, bg_b))),
                    .is_default = bg_default != 0,
                },
            };
        }

        pub fn flushDamage(self: *Self) void {
            vterm_wrapper_screen_flush_damage(self.screen);
        }

        pub fn render(self: *Self, target: *buffer.OptimizedBuffer, x: u32, y: u32) void {
            // Flush any pending damage
            self.flushDamage();

            // Render each cell of the terminal
            var row: u16 = 0;
            while (row < self.rows) : (row += 1) {
                var col: u16 = 0;
                while (col < self.cols) {
                    const pos = VTermPos{ .row = @intCast(row), .col = @intCast(col) };
                    const is_selected = self.isCellSelected(@intCast(row), @intCast(col));
                    if (self.getCell(pos)) |cell| {
                        self.renderCell(target, cell, x + col, y + row, is_selected);

                        const width: u8 = if (cell.width <= 0) 1 else @intCast(cell.width);
                        var extra: u8 = 1;
                        while (extra < width and col + extra < self.cols) : (extra += 1) {
                            const cont_selected = self.isCellSelected(@intCast(row), @intCast(col + extra));
                            self.renderWideContinuation(target, cell, x + col + extra, y + row, cont_selected);
                        }

                        col += @as(u16, width);
                        continue;
                    } else {
                        // If getCell returns null, render a space with default colors
                        const space_cell = VTermScreenCell{
                            .chars = [_]u32{' '} ++ [_]u32{0} ** 5,
                            .width = 1,
                            .attrs = .{
                                .bold = false,
                                .underline = 0,
                                .italic = false,
                                .blink = false,
                                .reverse = false,
                                .strike = false,
                                .conceal = false,
                            },
                            .fg = VTermColor{ .r = 255, .g = 255, .b = 255, .is_default = true },
                            .bg = VTermColor{ .r = 0, .g = 0, .b = 0, .is_default = true },
                        };
                        self.renderCell(target, space_cell, x + col, y + row, is_selected);
                    }
                    col += 1;
                }
            }

            // Render cursor if visible
            if (self.cursor_visible) {
                self.renderCursor(target, x, y);
            }
        }

        fn renderCell(self: *Self, target: *buffer.OptimizedBuffer, cell: VTermScreenCell, x: u32, y: u32, selected: bool) void {
            // Get the primary character (first in the chars array)
            const char: u32 = if (cell.chars[0] != 0) cell.chars[0] else ' ';

            // Convert colors with proper defaults
            var fg_color = if (cell.fg.is_default) 
                self.default_fg
            else 
                cell.fg.to_rgba();
                
            var bg_color = if (cell.bg.is_default)
                self.default_bg
            else
                cell.bg.to_rgba();

            // Apply reverse attribute
            if (cell.attrs.reverse) {
                const temp = fg_color;
                fg_color = bg_color;
                bg_color = temp;
            }

            if (selected) {
                fg_color = self.selection_colors.fg;
                bg_color = self.selection_colors.bg;
            }

            // Calculate text attributes
            var attributes: u8 = 0;
            if (cell.attrs.bold) attributes |= 1; // BOLD
            if (cell.attrs.italic) attributes |= 4; // ITALIC
            if (cell.attrs.underline > 0) attributes |= 8; // UNDERLINE
            if (cell.attrs.blink) attributes |= 16; // BLINK
            if (cell.attrs.strike) attributes |= 128; // STRIKETHROUGH

            // Render the cell
            const buffer_cell = buffer.Cell{
                .char = char,
                .fg = fg_color,
                .bg = bg_color,
                .attributes = attributes,
            };
            target.set(x, y, buffer_cell);
        }

        fn renderWideContinuation(self: *Self, target: *buffer.OptimizedBuffer, cell: VTermScreenCell, x: u32, y: u32, selected: bool) void {
            var bg_color = if (cell.bg.is_default)
                self.default_bg
            else
                cell.bg.to_rgba();

            var fg_color = if (cell.fg.is_default)
                self.default_fg
            else
                cell.fg.to_rgba();

            if (cell.attrs.reverse) {
                const temp = fg_color;
                fg_color = bg_color;
                bg_color = temp;
            }

            if (selected) {
                fg_color = self.selection_colors.fg;
                bg_color = self.selection_colors.bg;
            }

            const buffer_cell = buffer.Cell{
                .char = ' ',
                .fg = fg_color,
                .bg = bg_color,
                .attributes = 0,
            };
            target.set(x, y, buffer_cell);
        }

        fn renderCursor(self: *Self, target: *buffer.OptimizedBuffer, offset_x: u32, offset_y: u32) void {
            if (self.cursor_pos.row < 0 or self.cursor_pos.col < 0) return;
            if (@as(u32, @intCast(self.cursor_pos.row)) >= self.rows or @as(u32, @intCast(self.cursor_pos.col)) >= self.cols) return;

            const cursor_x = offset_x + @as(u32, @intCast(self.cursor_pos.col));
            const cursor_y = offset_y + @as(u32, @intCast(self.cursor_pos.row));

            // Get the current cell at cursor position
            if (self.getCell(self.cursor_pos)) |cell| {
                var fg_color = if (cell.bg.is_default)
                    self.default_bg
                else
                    cell.bg.to_rgba();
                const bg_color = if (cell.fg.is_default)
                    self.default_fg
                else
                    cell.fg.to_rgba();
                
                // Ensure minimum contrast for cursor visibility
                if (fg_color[0] + fg_color[1] + fg_color[2] < 1.5) {
                    fg_color = .{ 1.0, 1.0, 1.0, 1.0 }; // White
                }

                const char: u32 = if (cell.chars[0] != 0) cell.chars[0] else ' ';
                const cursor_cell = buffer.Cell{
                    .char = char,
                    .fg = fg_color,
                    .bg = bg_color,
                    .attributes = 0,
                };
                target.set(cursor_x, cursor_y, cursor_cell);
            }
        }
    };
} else struct {
    // Stub implementation for non-macOS platforms
    pub const LibVTermRenderer = struct {
        pub fn init(_: std.mem.Allocator, _: u16, _: u16) !*@This() {
            return error.LibVTermNotSupported;
        }
        
        pub fn deinit(_: *@This()) void {}
        pub fn resize(_: *@This(), _: u16, _: u16) void {}
        pub fn write(_: *@This(), _: []const u8) usize { return 0; }
        pub fn keyboardUnichar(_: *@This(), _: u32, _: VTermModifier) void {}
        pub fn keyboardKey(_: *@This(), _: c_int, _: VTermModifier) void {}
        pub fn mouseMove(_: *@This(), _: i32, _: i32, _: VTermModifier) void {}
        pub fn mouseButton(_: *@This(), _: i32, _: bool, _: VTermModifier) void {}
        pub fn render(_: *@This(), _: *buffer.OptimizedBuffer, _: u32, _: u32) void {}
        pub fn flushDamage(_: *@This()) void {}
    };
};

// Export the appropriate implementation
pub const LibVTermRenderer = LibVTermImpl.LibVTermRenderer;

// ===============================
// C export functions for FFI
// ===============================

pub export fn libvterm_create(cols: u16, rows: u16) ?*LibVTermRenderer {
    if (!HAS_LIBVTERM) return null;
    const allocator = std.heap.c_allocator;
    return LibVTermRenderer.init(allocator, cols, rows) catch null;
}

pub export fn libvterm_destroy(renderer: ?*LibVTermRenderer) void {
    if (!HAS_LIBVTERM or renderer == null) return;
    renderer.?.deinit();
}

pub export fn libvterm_resize(renderer: ?*LibVTermRenderer, cols: u16, rows: u16) void {
    if (!HAS_LIBVTERM or renderer == null) return;
    renderer.?.resize(cols, rows);
}

pub export fn libvterm_write(renderer: ?*LibVTermRenderer, data: [*]const u8, len: usize) usize {
    if (!HAS_LIBVTERM or renderer == null) return 0;
    return renderer.?.write(data[0..len]);
}

pub export fn libvterm_keyboard_unichar(renderer: ?*LibVTermRenderer, char: u32, shift: u8, alt: u8, ctrl: u8) void {
    if (!HAS_LIBVTERM or renderer == null) return;
    const modifier = VTermModifier{
        .shift = shift != 0,
        .alt = alt != 0,
        .ctrl = ctrl != 0,
    };
    renderer.?.keyboardUnichar(char, modifier);
}

pub export fn libvterm_keyboard_key(renderer: ?*LibVTermRenderer, key: c_int, shift: u8, alt: u8, ctrl: u8) void {
    if (!HAS_LIBVTERM or renderer == null) return;
    const modifier = VTermModifier{
        .shift = shift != 0,
        .alt = alt != 0,
        .ctrl = ctrl != 0,
    };
    renderer.?.keyboardKey(key, modifier);
}

pub export fn libvterm_mouse_move(renderer: ?*LibVTermRenderer, row: i32, col: i32, shift: u8, alt: u8, ctrl: u8) void {
    if (!HAS_LIBVTERM or renderer == null) return;
    const modifier = VTermModifier{
        .shift = shift != 0,
        .alt = alt != 0,
        .ctrl = ctrl != 0,
    };
    renderer.?.mouseMove(row, col, modifier);
}

pub export fn libvterm_mouse_button(renderer: ?*LibVTermRenderer, button: i32, pressed: u8, shift: u8, alt: u8, ctrl: u8) void {
    if (!HAS_LIBVTERM or renderer == null) return;
    const modifier = VTermModifier{
        .shift = shift != 0,
        .alt = alt != 0,
        .ctrl = ctrl != 0,
    };
    renderer.?.mouseButton(button, pressed != 0, modifier);
}

pub export fn libvterm_render(renderer: ?*LibVTermRenderer, target: *buffer.OptimizedBuffer, x: u32, y: u32) void {
    if (!HAS_LIBVTERM or renderer == null) return;
    renderer.?.render(target, x, y);
}

pub export fn libvterm_flush_damage(renderer: ?*LibVTermRenderer) void {
    if (!HAS_LIBVTERM or renderer == null) return;
    renderer.?.flushDamage();
}

pub export fn libvterm_get_cursor_pos(renderer: ?*LibVTermRenderer, row: *i32, col: *i32) void {
    if (!HAS_LIBVTERM or renderer == null) return;
    renderer.?.refreshState();
    row.* = renderer.?.cursor_pos.row;
    col.* = renderer.?.cursor_pos.col;
}

pub export fn libvterm_get_cursor_visible(renderer: ?*LibVTermRenderer) u8 {
    if (!HAS_LIBVTERM or renderer == null) return 0;
    renderer.?.refreshState();
    return if (renderer.?.cursor_visible) 1 else 0;
}

pub export fn libvterm_has_support() u8 {
    return if (HAS_LIBVTERM) 1 else 0;
}
