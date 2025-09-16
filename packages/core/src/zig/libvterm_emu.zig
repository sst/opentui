const std = @import("std");
const buffer = @import("buffer.zig");
const libvterm = @import("libvterm.zig");
const build_options = @import("build_options");

pub const RGBA = buffer.RGBA;

fn rgba(r: f32, g: f32, b: f32, a: f32) RGBA {
    return .{ r, g, b, a };
}

pub const LibVTermEmu = if (build_options.has_libvterm) struct {
    allocator: std.mem.Allocator,
    cols: u16,
    rows: u16,
    libvterm_renderer: *libvterm.LibVTermRenderer,
    packed_buf: []u8,

    pub fn init(allocator: std.mem.Allocator, cols: u16, rows: u16) !*LibVTermEmu {
        const renderer = try libvterm.LibVTermRenderer.init(allocator, cols, rows);

        const self = try allocator.create(LibVTermEmu);
        self.* = .{
            .allocator = allocator,
            .cols = cols,
            .rows = rows,
            .libvterm_renderer = renderer,
            .packed_buf = &[_]u8{},
        };
        return self;
    }

    pub fn deinit(self: *LibVTermEmu) void {
        self.libvterm_renderer.deinit();
        if (self.packed_buf.len > 0) self.allocator.free(self.packed_buf);
        self.allocator.destroy(self);
    }

    pub fn clearAll(self: *LibVTermEmu) void {
        const clear_seq = "\x1b[2J\x1b[H";
        _ = self.libvterm_renderer.write(clear_seq);
        self.libvterm_renderer.flushDamage();
    }

    pub fn feed(self: *LibVTermEmu, bytes: []const u8) void {
        _ = self.libvterm_renderer.write(bytes);
        self.libvterm_renderer.flushDamage();
    }

    pub fn resize(self: *LibVTermEmu, cols: u16, rows: u16) !void {
        if (cols == self.cols and rows == self.rows) return;

        self.libvterm_renderer.resize(cols, rows);

        self.cols = cols;
        self.rows = rows;

        if (self.packed_buf.len > 0) {
            self.allocator.free(self.packed_buf);
            self.packed_buf = &[_]u8{};
        }
    }

    pub fn packedView(self: *LibVTermEmu) []u8 {
        const cell_size: usize = 48;
        const total_cells: usize = @as(usize, self.cols) * @as(usize, self.rows);
        const total_bytes: usize = total_cells * cell_size;

        if (self.packed_buf.len != total_bytes) {
            if (self.packed_buf.len > 0) self.allocator.free(self.packed_buf);
            self.packed_buf = self.allocator.alloc(u8, total_bytes) catch return &[_]u8{};
        }

        var off: usize = 0;
        var row: u16 = 0;
        while (row < self.rows) : (row += 1) {
            var col: u16 = 0;
            while (col < self.cols) : (col += 1) {
                const pos = libvterm.VTermPos{ .row = @intCast(row), .col = @intCast(col) };
                const cell = self.libvterm_renderer.getCell(pos);

                var bg: RGBA = undefined;
                var fg: RGBA = undefined;
                var ch: u32 = ' ';

                if (cell) |c| {
                    // Get character
                    ch = if (c.chars[0] != 0) c.chars[0] else ' ';

                    // Convert colors
                    fg = if (c.fg.is_default)
                        self.libvterm_renderer.default_fg
                    else
                        c.fg.to_rgba();

                    bg = if (c.bg.is_default)
                        self.libvterm_renderer.default_bg
                    else
                        c.bg.to_rgba();

                    if (c.attrs.reverse) {
                        const temp = fg;
                        fg = bg;
                        bg = temp;
                    }

                    if (self.libvterm_renderer.isCellSelected(@intCast(row), @intCast(col))) {
                        const colors = self.libvterm_renderer.getSelectionColors();
                        fg = colors.fg;
                        bg = colors.bg;
                    }
                } else {
                    fg = self.libvterm_renderer.default_fg;
                    bg = self.libvterm_renderer.default_bg;
                }

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
                off += writeU32(self.packed_buf[off..], ch);
                // padding 12 bytes
                off += 12;
            }
        }

        return self.packed_buf;
    }

    pub fn keyboardUnichar(self: *LibVTermEmu, char: u32, shift: bool, alt: bool, ctrl: bool) void {
        const modifier = libvterm.VTermModifier{
            .shift = shift,
            .alt = alt,
            .ctrl = ctrl,
        };
        self.libvterm_renderer.keyboardUnichar(char, modifier);
        self.libvterm_renderer.flushDamage();
    }

    pub fn keyboardKey(self: *LibVTermEmu, key: c_int, shift: bool, alt: bool, ctrl: bool) void {
        const modifier = libvterm.VTermModifier{
            .shift = shift,
            .alt = alt,
            .ctrl = ctrl,
        };
        self.libvterm_renderer.keyboardKey(key, modifier);
        self.libvterm_renderer.flushDamage();
    }

    pub fn setSelection(self: *LibVTermEmu, rect: ?libvterm.SelectionRect, fg: RGBA, bg: RGBA) void {
        self.libvterm_renderer.setSelection(rect);
        self.libvterm_renderer.setSelectionColors(fg, bg);
    }

    pub fn clearSelection(self: *LibVTermEmu) void {
        self.libvterm_renderer.clearSelection();
    }

    pub fn hasSelection(self: *LibVTermEmu) bool {
        return self.libvterm_renderer.hasSelection();
    }

    pub fn copySelection(self: *LibVTermEmu, rect: libvterm.SelectionRect, out: []u8) usize {
        return self.libvterm_renderer.copySelection(rect, out);
    }
} else struct {
    // Stub implementation for platforms without libvterm
    allocator: std.mem.Allocator,
    cols: u16,
    rows: u16,
    packed_buf: []u8,

    pub fn init(allocator: std.mem.Allocator, cols: u16, rows: u16) !*@This() {
        _ = allocator;
        _ = cols;
        _ = rows;
        return error.LibVTermNotSupported;
    }

    pub fn deinit(self: *@This()) void {
        _ = self;
    }

    pub fn clearAll(self: *@This()) void {
        _ = self;
    }

    pub fn feed(self: *@This(), bytes: []const u8) void {
        _ = self;
        _ = bytes;
    }

    pub fn resize(self: *@This(), cols: u16, rows: u16) !void {
        _ = self;
        _ = cols;
        _ = rows;
    }

    pub fn packedView(self: *@This()) []u8 {
        _ = self;
        return &[_]u8{};
    }

    pub fn keyboardUnichar(self: *@This(), char: u32, shift: bool, alt: bool, ctrl: bool) void {
        _ = self;
        _ = char;
        _ = shift;
        _ = alt;
        _ = ctrl;
    }

    pub fn keyboardKey(self: *@This(), key: c_int, shift: bool, alt: bool, ctrl: bool) void {
        _ = self;
        _ = key;
        _ = shift;
        _ = alt;
        _ = ctrl;
    }

    pub fn setSelection(self: *@This(), rect: ?libvterm.SelectionRect, fg: RGBA, bg: RGBA) void {
        _ = self;
        _ = rect;
        _ = fg;
        _ = bg;
    }

    pub fn clearSelection(self: *@This()) void {
        _ = self;
    }

    pub fn hasSelection(self: *@This()) bool {
        _ = self;
        return false;
    }

    pub fn copySelection(self: *@This(), rect: libvterm.SelectionRect, out: []u8) usize {
        _ = self;
        _ = rect;
        _ = out;
        return 0;
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
