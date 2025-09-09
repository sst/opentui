const std = @import("std");
const buffer = @import("buffer.zig");

pub const RGBA = buffer.RGBA;

fn rgba(r: f32, g: f32, b: f32, a: f32) RGBA {
    return .{ r, g, b, a };
}

const DEFAULT_FG = rgba(1.0, 1.0, 1.0, 1.0);
const DEFAULT_BG = rgba(0.0, 0.0, 0.0, 0.0);

pub const Cell = struct {
    ch: u32 = ' ',
    fg: RGBA = DEFAULT_FG,
    bg: RGBA = DEFAULT_BG,
};

pub const TerminalEmu = struct {
    allocator: std.mem.Allocator,
    cols: u16,
    rows: u16,
    grid: []Cell,
    cursor_x: u16 = 0,
    cursor_y: u16 = 0,
    saved_x: u16 = 0,
    saved_y: u16 = 0,
    cur_fg: RGBA = DEFAULT_FG,
    cur_bg: RGBA = DEFAULT_BG,
    bold: bool = false,
    ital: bool = false,
    underline: bool = false,
    alt_screen: bool = false,

    packed_buf: []u8,

    pub fn init(allocator: std.mem.Allocator, cols: u16, rows: u16) !*TerminalEmu {
        const self = try allocator.create(TerminalEmu);
        const count: usize = @as(usize, cols) * @as(usize, rows);
        const grid = try allocator.alloc(Cell, count);
        for (grid) |*c| c.* = Cell{};
        self.* = .{
            .allocator = allocator,
            .cols = cols,
            .rows = rows,
            .grid = grid,
            .packed_buf = &[_]u8{},
        };
        return self;
    }

    pub fn deinit(self: *TerminalEmu) void {
        self.allocator.free(self.grid);
        if (self.packed_buf.len > 0) self.allocator.free(self.packed_buf);
        self.allocator.destroy(self);
    }

    fn idx(self: *TerminalEmu, x: u16, y: u16) usize {
        return @as(usize, y) * @as(usize, self.cols) + @as(usize, x);
    }

    fn clampCursor(self: *TerminalEmu) void {
        if (self.cursor_x >= self.cols) self.cursor_x = self.cols - 1;
        if (self.cursor_y >= self.rows) self.cursor_y = self.rows - 1;
    }

    pub fn clearAll(self: *TerminalEmu) void {
        for (self.grid) |*c| c.* = Cell{};
        self.cursor_x = 0;
        self.cursor_y = 0;
    }

    fn clearLineFrom(self: *TerminalEmu, x: u16, y: u16) void {
        if (y >= self.rows) return;
        var col: u16 = x;
        while (col < self.cols) : (col += 1) {
            self.grid[self.idx(col, y)] = Cell{};
        }
    }

    fn clearLineTo(self: *TerminalEmu, x: u16, y: u16) void {
        if (y >= self.rows) return;
        var col: u16 = 0;
        while (true) : (col += 1) {
            self.grid[self.idx(col, y)] = Cell{};
            if (col == x) break;
        }
    }

    fn scrollUp(self: *TerminalEmu, n: u16) void {
        var i: usize = 0;
        const w: usize = self.cols;
        const h: usize = self.rows;
        const rows_move = @min(@as(usize, n), h);
        if (rows_move == 0 or h == 0) return;
        // move rows up
        var dst: usize = 0;
        var src: usize = rows_move * w;
        while (src < w * h) : ({ dst += 1; src += 1; }) {
            self.grid[dst] = self.grid[src];
        }
        // clear bottom rows
        i = (h - rows_move) * w;
        while (i < w * h) : (i += 1) self.grid[i] = Cell{};
        if (self.cursor_y >= n) self.cursor_y -= n else self.cursor_y = 0;
    }

    fn newline(self: *TerminalEmu) void {
        if (self.cursor_y + 1 >= self.rows) {
            self.scrollUp(1);
            self.cursor_x = 0;
        } else {
            self.cursor_y += 1;
            self.cursor_x = 0;
        }
    }

    fn putChar(self: *TerminalEmu, ch: u32) void {
        if (self.cursor_x >= self.cols) self.newline();
        if (self.cursor_x >= self.cols or self.cursor_y >= self.rows) return;
        const i = self.idx(self.cursor_x, self.cursor_y);
        self.grid[i].ch = ch;
        self.grid[i].fg = self.cur_fg;
        self.grid[i].bg = self.cur_bg;
        if (self.cursor_x + 1 >= self.cols) {
            self.newline();
        } else {
            self.cursor_x += 1;
        }
    }

    fn setSgr(self: *TerminalEmu, params: []const i32) void {
        if (params.len == 0) {
            self.cur_fg = DEFAULT_FG;
            self.cur_bg = DEFAULT_BG;
            self.bold = false;
            self.ital = false;
            self.underline = false;
            return;
        }
        var i: usize = 0;
        while (i < params.len) : (i += 1) {
            const p = params[i];
            switch (p) {
                0 => {
                    self.cur_fg = DEFAULT_FG;
                    self.cur_bg = DEFAULT_BG;
                    self.bold = false;
                    self.ital = false;
                    self.underline = false;
                },
                1 => self.bold = true,
                3 => self.ital = true,
                4 => self.underline = true,
                22 => self.bold = false,
                23 => self.ital = false,
                24 => self.underline = false,
                39 => self.cur_fg = DEFAULT_FG,
                49 => self.cur_bg = DEFAULT_BG,
                30...37 => self.cur_fg = ansi8ToRgb(@intCast(p - 30), self.bold),
                40...47 => self.cur_bg = ansi8ToRgb(@intCast(p - 40), false),
                90...97 => self.cur_fg = ansi8ToRgb(@intCast(p - 90 + 8), true),
                100...107 => self.cur_bg = ansi8ToRgb(@intCast(p - 100 + 8), true),
                38 => {
                    // extended fg: 38;5;n or 38;2;r;g;b
                    if (i + 1 < params.len) {
                        if (params[i + 1] == 5 and i + 2 < params.len) {
                            const pal_idx = @as(u8, @intCast(params[i + 2]));
                            self.cur_fg = ansi256ToRgb(pal_idx);
                            i += 2;
                        } else if (params[i + 1] == 2 and i + 4 < params.len) {
                            self.cur_fg = rgba(
                                @as(f32, @floatFromInt(params[i + 2])) / 255.0,
                                @as(f32, @floatFromInt(params[i + 3])) / 255.0,
                                @as(f32, @floatFromInt(params[i + 4])) / 255.0,
                                1.0,
                            );
                            i += 4;
                        }
                    }
                },
                48 => {
                    if (i + 1 < params.len) {
                        if (params[i + 1] == 5 and i + 2 < params.len) {
                            const pal_idx2 = @as(u8, @intCast(params[i + 2]));
                            self.cur_bg = ansi256ToRgb(pal_idx2);
                            i += 2;
                        } else if (params[i + 1] == 2 and i + 4 < params.len) {
                            self.cur_bg = rgba(
                                @as(f32, @floatFromInt(params[i + 2])) / 255.0,
                                @as(f32, @floatFromInt(params[i + 3])) / 255.0,
                                @as(f32, @floatFromInt(params[i + 4])) / 255.0,
                                1.0,
                            );
                            i += 4;
                        }
                    }
                },
                else => {},
            }
        }
    }

    fn ansi8ToRgb(color_idx: u8, bright: bool) RGBA {
        // 8 basic colors
        const table = [_]RGBA{
            rgba(0.0, 0.0, 0.0, 1.0), // black
            rgba(0.75, 0.0, 0.0, 1.0), // red
            rgba(0.0, 0.5, 0.0, 1.0), // green
            rgba(0.75, 0.75, 0.0, 1.0), // yellow
            rgba(0.2, 0.2, 1.0, 1.0), // blue
            rgba(0.75, 0.0, 0.75, 1.0), // magenta
            rgba(0.0, 0.75, 0.75, 1.0), // cyan
            rgba(0.9, 0.9, 0.9, 1.0), // white
        };
        const c = table[color_idx & 7];
        if (bright) {
            return rgba(
                @min(c[0] + 0.2, 1.0),
                @min(c[1] + 0.2, 1.0),
                @min(c[2] + 0.2, 1.0),
                c[3]
            );
        }
        return c;
    }

    fn ansi256ToRgb(color_idx: u8) RGBA {
        if (color_idx < 16) return ansi8ToRgb(@intCast(color_idx & 7), (color_idx >= 8));
        if (color_idx >= 232) {
            const v: f32 = (@as(f32, @floatFromInt(color_idx - 232)) * 10.0 + 8.0) / 255.0;
            return rgba(v, v, v, 1.0);
        }
        const i = color_idx - 16;
        const r = (i / 36) % 6;
        const g = (i / 6) % 6;
        const b = i % 6;
        const conv = struct { fn c(x: u8) f32 { return if (x == 0) 0.0 else (@as(f32, @floatFromInt(x)) * 40.0 + 55.0) / 255.0; } };
        return rgba(conv.c(r), conv.c(g), conv.c(b), 1.0);
    }

    fn handleCsi(self: *TerminalEmu, final: u8, params: []const i32) void {
        switch (final) {
            'A' => { // CUU
                const n: u16 = @intCast(if (params.len == 0 or params[0] <= 0) 1 else params[0]);
                if (self.cursor_y >= n) self.cursor_y -= n else self.cursor_y = 0;
            },
            'B' => { // CUD
                const n: u16 = @intCast(if (params.len == 0 or params[0] <= 0) 1 else params[0]);
                self.cursor_y = @min(self.rows - 1, self.cursor_y + n);
            },
            'C' => { // CUF
                const n: u16 = @intCast(if (params.len == 0 or params[0] <= 0) 1 else params[0]);
                self.cursor_x = @min(self.cols - 1, self.cursor_x + n);
            },
            'D' => { // CUB
                const n: u16 = @intCast(if (params.len == 0 or params[0] <= 0) 1 else params[0]);
                if (self.cursor_x >= n) self.cursor_x -= n else self.cursor_x = 0;
            },
            'E' => { // CNL
                const n: u16 = @intCast(if (params.len == 0 or params[0] <= 0) 1 else params[0]);
                self.cursor_y = @min(self.rows - 1, self.cursor_y + n);
                self.cursor_x = 0;
            },
            'F' => { // CPL
                const n: u16 = @intCast(if (params.len == 0 or params[0] <= 0) 1 else params[0]);
                if (self.cursor_y >= n) self.cursor_y -= n else self.cursor_y = 0;
                self.cursor_x = 0;
            },
            'G' => { // CHA
                const n: u16 = @intCast(if (params.len == 0 or params[0] <= 0) 1 else params[0]);
                self.cursor_x = @min(self.cols - 1, n - 1);
            },
            'H', 'f' => { // CUP
                const row: u16 = @intCast(if (params.len >= 1 and params[0] > 0) params[0] else 1);
                const col: u16 = @intCast(if (params.len >= 2 and params[1] > 0) params[1] else 1);
                self.cursor_y = @min(self.rows - 1, row - 1);
                self.cursor_x = @min(self.cols - 1, col - 1);
            },
            'J' => { // ED
                const mode = if (params.len == 0) 0 else params[0];
                switch (mode) {
                    0 => {
                        // clear from cursor to end of screen
                        self.clearLineFrom(self.cursor_x, self.cursor_y);
                        var y: u16 = self.cursor_y + 1;
                        while (y < self.rows) : (y += 1) self.clearLineFrom(0, y);
                    },
                    1 => {
                        // clear from start to cursor
                        var y: u16 = 0;
                        while (y < self.cursor_y) : (y += 1) self.clearLineFrom(0, y);
                        self.clearLineTo(self.cursor_x, self.cursor_y);
                    },
                    2 => self.clearAll(),
                    else => {},
                }
            },
            'K' => { // EL
                const mode = if (params.len == 0) 0 else params[0];
                switch (mode) {
                    0 => self.clearLineFrom(self.cursor_x, self.cursor_y),
                    1 => self.clearLineTo(self.cursor_x, self.cursor_y),
                    2 => self.clearLineFrom(0, self.cursor_y),
                    else => {},
                }
            },
            'm' => self.setSgr(params),
            's' => { self.saved_x = self.cursor_x; self.saved_y = self.cursor_y; },
            'u' => { self.cursor_x = self.saved_x; self.cursor_y = self.saved_y; },
            'h' => { // DECSET
                if (params.len >= 1 and params[0] == 1049) {
                    self.alt_screen = true;
                    self.clearAll();
                }
            },
            'l' => { // DECRST
                if (params.len >= 1 and params[0] == 1049) {
                    self.alt_screen = false;
                    self.clearAll();
                }
            },
            else => {},
        }
        self.clampCursor();
    }

    pub fn feed(self: *TerminalEmu, bytes: []const u8) void {
        var i: usize = 0;
        var state: enum { ground, esc, csi } = .ground;
        // CSI parsing indices
        var csi_start: usize = 0; // index of '[' in "ESC["
        var csi_priv: bool = false;

        while (i < bytes.len) : (i += 1) {
            const b = bytes[i];
            switch (state) {
                .ground => {
                    switch (b) {
                        0x1b => state = .esc,
                        '\r' => self.cursor_x = 0,
                        '\n' => self.newline(),
                        0x08 => { if (self.cursor_x > 0) self.cursor_x -= 1; },
                        0x09 => {
                            // tab to next 8-column boundary
                            const nx = ((self.cursor_x / 8) + 1) * 8;
                            self.cursor_x = @min(self.cols - 1, nx);
                        },
                        else => {
                            if (b >= 0x20) self.putChar(b);
                        },
                    }
                },
                .esc => {
                    switch (b) {
                        '[' => { state = .csi; csi_start = i; csi_priv = false; },
                        ']' => { // OSC: ignore till BEL/ST
                            // naive consume until BEL or ESC \
                            var j = i + 1;
                            while (j < bytes.len) : (j += 1) {
                                if (bytes[j] == 0x07) break;
                                if (bytes[j] == 0x1b and j + 1 < bytes.len and bytes[j + 1] == '\\') { j += 1; break; }
                            }
                            i = j;
                            state = .ground;
                        },
                        '7' => { self.saved_x = self.cursor_x; self.saved_y = self.cursor_y; state = .ground; },
                        '8' => { self.cursor_x = self.saved_x; self.cursor_y = self.saved_y; state = .ground; },
                        'E' => { self.cursor_x = 0; self.newline(); state = .ground; },
                        'M' => { if (self.cursor_y > 0) self.cursor_y -= 1; state = .ground; },
                        'c' => { self.clearAll(); state = .ground; },
                        else => state = .ground,
                    }
                },
                .csi => {
                    if (b == '?') { csi_priv = true; continue; }
                    if ((b >= '0' and b <= '9') or b == ';') {
                        // stay in CSI, accumulate by advancing i
                    } else {
                        // finalize: parse params in forward direction from after '[' up to i-1
                        // Detect and ignore SGR mouse sequences: ESC [ < ... (M|m)
                        var is_mouse: bool = false;
                        if (csi_start + 1 < bytes.len and bytes[csi_start + 1] == '<') {
                            if (b == 'M' or b == 'm') {
                                is_mouse = true;
                            }
                        }
                        if (is_mouse) {
                            state = .ground;
                            continue;
                        }
                        var params: [16]i32 = undefined;
                        var pc: usize = 0;
                        var num: i32 = 0;
                        var have_num = false;
                        var start_idx: usize = csi_start + 1;
                        if (start_idx < bytes.len and bytes[start_idx] == '?') start_idx += 1;
                        var j: usize = start_idx;
                        while (j < i and pc < params.len) : (j += 1) {
                            const ch = bytes[j];
                            if (ch >= '0' and ch <= '9') {
                                num = num * 10 + @as(i32, @intCast(ch - '0'));
                                have_num = true;
                            } else if (ch == ';') {
                                params[pc] = if (have_num) num else 0;
                                pc += 1;
                                num = 0;
                                have_num = false;
                            } else {
                                // unexpected; stop
                                break;
                            }
                        }
                        if (pc < params.len) {
                            params[pc] = if (have_num) num else 0;
                            pc += 1;
                        }
                        const slice = if (pc == 0) params[0..1] else params[0..pc];
                        self.handleCsi(b, slice);
                        state = .ground;
                    }
                },
            }
        }
    }

    pub fn resize(self: *TerminalEmu, cols: u16, rows: u16) !void {
        if (cols == self.cols and rows == self.rows) return;
        const new_count: usize = @as(usize, cols) * @as(usize, rows);
        var new_grid = try self.allocator.alloc(Cell, new_count);
        for (new_grid) |*c| c.* = Cell{};

        const copy_cols = @min(self.cols, cols);
        const copy_rows = @min(self.rows, rows);
        var y: u16 = 0;
        while (y < copy_rows) : (y += 1) {
            var x: u16 = 0;
            while (x < copy_cols) : (x += 1) {
                new_grid[@as(usize, y) * @as(usize, cols) + @as(usize, x)] = self.grid[self.idx(x, y)];
            }
        }
        self.allocator.free(self.grid);
        self.grid = new_grid;
        self.cols = cols;
        self.rows = rows;
        if (self.cursor_x >= cols) self.cursor_x = cols - 1;
        if (self.cursor_y >= rows) self.cursor_y = rows - 1;
        if (self.packed_buf.len > 0) {
            self.allocator.free(self.packed_buf);
            self.packed_buf = &[_]u8{};
        }
    }

    pub fn packedView(self: *TerminalEmu) []u8 {
        const cell_size: usize = 48;
        const total_cells: usize = @as(usize, self.cols) * @as(usize, self.rows);
        const total_bytes: usize = total_cells * cell_size;
        if (self.packed_buf.len != total_bytes) {
            if (self.packed_buf.len > 0) self.allocator.free(self.packed_buf);
            self.packed_buf = self.allocator.alloc(u8, total_bytes) catch return &[_]u8{};
        }
        var off: usize = 0;
        const cursor_idx = self.idx(self.cursor_x, self.cursor_y);
        for (self.grid, 0..) |c, i| {
            // Invert colors for cursor position
            const is_cursor = (i == cursor_idx);
            const bg = if (is_cursor) c.fg else c.bg;
            const fg = if (is_cursor) c.bg else c.fg;
            
            // bg RGBA (4*f32)
            off += writeF32(self.packed_buf[off..], bg[0]);
            off += writeF32(self.packed_buf[off..], bg[1]);
            off += writeF32(self.packed_buf[off..], bg[2]);
            off += writeF32(self.packed_buf[off..], bg[3]);
            // fg RGBA
            off += writeF32(self.packed_buf[off..], fg[0]);
            off += writeF32(self.packed_buf[off..], fg[1]);
            off += writeF32(self.packed_buf[off..], fg[2]);
            off += writeF32(self.packed_buf[off..], fg[3]);
            // char u32
            off += writeU32(self.packed_buf[off..], c.ch);
            // padding 12 bytes
            off += 12;
        }
        return self.packed_buf;
    }
};

fn writeF32(buf: []u8, v: f32) usize {
    const bits = @as(u32, @bitCast(v));
    std.mem.writeInt(u32, buf[0..4], bits, .little);
    return 4;
}

fn writeU32(buf: []u8, v: u32) usize {
    std.mem.writeInt(u32, buf[0..4], v, .little);
    return 4;
}
