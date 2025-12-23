const std = @import("std");
const ghostty_vt = @import("ghostty-vt");
const color = ghostty_vt.color;
const pagepkg = ghostty_vt.page;
const formatter = ghostty_vt.formatter;
const Screen = ghostty_vt.Screen;

pub const StyleFlags = packed struct(u8) {
    bold: bool = false,
    italic: bool = false,
    underline: bool = false,
    strikethrough: bool = false,
    inverse: bool = false,
    faint: bool = false,
    _padding: u2 = 0,

    pub fn toInt(self: StyleFlags) u8 {
        return @bitCast(self);
    }

    pub fn eql(self: StyleFlags, other: StyleFlags) bool {
        return self.toInt() == other.toInt();
    }
};

pub const CellStyle = struct {
    fg: ?color.RGB,
    bg: ?color.RGB,
    flags: StyleFlags,

    pub fn eql(self: CellStyle, other: CellStyle) bool {
        const fg_eq = if (self.fg) |a| (if (other.fg) |b| a.r == b.r and a.g == b.g and a.b == b.b else false) else other.fg == null;
        const bg_eq = if (self.bg) |a| (if (other.bg) |b| a.r == b.r and a.g == b.g and a.b == b.b else false) else other.bg == null;
        return fg_eq and bg_eq and self.flags.eql(other.flags);
    }
};

fn getStyleFromCell(
    cell: *const pagepkg.Cell,
    pin: ghostty_vt.Pin,
    palette: *const color.Palette,
    terminal_bg: ?color.RGB,
) CellStyle {
    var flags: StyleFlags = .{};
    var fg: ?color.RGB = null;
    var bg: ?color.RGB = null;

    const style = pin.style(cell);

    flags.bold = style.flags.bold;
    flags.italic = style.flags.italic;
    flags.faint = style.flags.faint;
    flags.inverse = style.flags.inverse;
    flags.strikethrough = style.flags.strikethrough;
    flags.underline = style.flags.underline != .none;

    fg = switch (style.fg_color) {
        .none => null,
        .palette => |idx| palette[idx],
        .rgb => |rgb| rgb,
    };

    bg = style.bg(cell, palette) orelse switch (cell.content_tag) {
        .bg_color_palette => palette[cell.content.color_palette],
        .bg_color_rgb => .{ .r = cell.content.color_rgb.r, .g = cell.content.color_rgb.g, .b = cell.content.color_rgb.b },
        else => null,
    };

    if (bg) |cell_bg| {
        if (terminal_bg) |term_bg| {
            if (cell_bg.r == term_bg.r and cell_bg.g == term_bg.g and cell_bg.b == term_bg.b) {
                bg = null;
            }
        }
    }

    return .{ .fg = fg, .bg = bg, .flags = flags };
}

fn writeJsonString(writer: anytype, s: []const u8) !void {
    try writer.writeByte('"');
    for (s) |c| {
        switch (c) {
            '"' => try writer.writeAll("\\\""),
            '\\' => try writer.writeAll("\\\\"),
            '\n' => try writer.writeAll("\\n"),
            '\r' => try writer.writeAll("\\r"),
            '\t' => try writer.writeAll("\\t"),
            else => {
                if (c < 0x20) {
                    try writer.print("\\u{x:0>4}", .{c});
                } else {
                    try writer.writeByte(c);
                }
            },
        }
    }
    try writer.writeByte('"');
}

fn writeColor(writer: anytype, rgb: ?color.RGB) !void {
    if (rgb) |c| {
        try writer.print("\"#{x:0>2}{x:0>2}{x:0>2}\"", .{ c.r, c.g, c.b });
    } else {
        try writer.writeAll("null");
    }
}

fn countLines(screen: *Screen) usize {
    var total: usize = 0;
    var iter = screen.pages.rowIterator(.right_down, .{ .screen = .{} }, null);
    while (iter.next()) |_| {
        total += 1;
    }
    return total;
}

fn hasEnoughLines(screen: *Screen, threshold: usize) bool {
    var count: usize = 0;
    var iter = screen.pages.rowIterator(.right_down, .{ .screen = .{} }, null);
    while (iter.next()) |_| {
        count += 1;
        if (count >= threshold) return true;
    }
    return false;
}

pub fn writeJsonOutput(
    writer: anytype,
    t: *ghostty_vt.Terminal,
    offset: usize,
    limit: ?usize,
) !void {
    const screen = t.screens.active;
    const palette = &t.colors.palette.current;
    const terminal_bg = t.colors.background.get();

    const total_lines = countLines(screen);

    try writer.writeAll("{");
    try writer.print("\"cols\":{},\"rows\":{},", .{ screen.pages.cols, screen.pages.rows });
    try writer.print("\"cursor\":[{},{}],", .{ screen.cursor.x, screen.cursor.y });
    try writer.print("\"offset\":{},\"totalLines\":{},", .{ offset, total_lines });
    try writer.writeAll("\"lines\":[");

    var text_buf: [4096]u8 = undefined;
    var row_iter = screen.pages.rowIterator(.right_down, .{ .screen = .{} }, null);
    var row_idx: usize = 0;
    var output_idx: usize = 0;

    while (row_iter.next()) |pin| {
        if (row_idx < offset) {
            row_idx += 1;
            continue;
        }

        if (limit) |lim| {
            if (output_idx >= lim) break;
        }

        if (output_idx > 0) try writer.writeByte(',');
        try writer.writeByte('[');

        const cells = pin.cells(.all);
        var span_start: usize = 0;
        var span_len: usize = 0;
        var current_style: ?CellStyle = null;
        var text_len: usize = 0;
        var span_idx: usize = 0;

        for (cells, 0..) |*cell, col_idx| {
            if (cell.wide == .spacer_tail) continue;

            const cp = cell.codepoint();
            const is_null = cp == 0;

            if (is_null) {
                if (text_len > 0) {
                    if (span_idx > 0) try writer.writeByte(',');
                    try writer.writeByte('[');
                    try writeJsonString(writer, text_buf[0..text_len]);
                    try writer.writeByte(',');
                    try writeColor(writer, current_style.?.fg);
                    try writer.writeByte(',');
                    try writeColor(writer, current_style.?.bg);
                    try writer.print(",{},{}", .{ current_style.?.flags.toInt(), span_len });
                    try writer.writeByte(']');
                    span_idx += 1;
                    text_len = 0;
                    span_len = 0;
                }
                current_style = null;
                continue;
            }

            const style = getStyleFromCell(cell, pin, palette, terminal_bg);
            const style_changed = if (current_style) |cs| !cs.eql(style) else true;

            if (style_changed and text_len > 0) {
                if (span_idx > 0) try writer.writeByte(',');
                try writer.writeByte('[');
                try writeJsonString(writer, text_buf[0..text_len]);
                try writer.writeByte(',');
                try writeColor(writer, current_style.?.fg);
                try writer.writeByte(',');
                try writeColor(writer, current_style.?.bg);
                try writer.print(",{},{}", .{ current_style.?.flags.toInt(), span_len });
                try writer.writeByte(']');
                span_idx += 1;
                text_len = 0;
                span_len = 0;
            }

            if (style_changed) {
                span_start = col_idx;
                current_style = style;
            }

            const cp21: u21 = @intCast(cp);
            const len = std.unicode.utf8CodepointSequenceLength(cp21) catch 1;
            if (text_len + len <= text_buf.len) {
                _ = std.unicode.utf8Encode(cp21, text_buf[text_len..]) catch 0;
                text_len += len;
            }

            span_len += if (cell.wide == .wide) 2 else 1;
        }

        if (text_len > 0) {
            if (span_idx > 0) try writer.writeByte(',');
            try writer.writeByte('[');
            try writeJsonString(writer, text_buf[0..text_len]);
            try writer.writeByte(',');
            try writeColor(writer, current_style.?.fg);
            try writer.writeByte(',');
            try writeColor(writer, current_style.?.bg);
            try writer.print(",{},{}", .{ current_style.?.flags.toInt(), span_len });
            try writer.writeByte(']');
        }

        try writer.writeByte(']');
        row_idx += 1;
        output_idx += 1;
    }

    try writer.writeAll("]}");
}

const ReadonlyStream = @typeInfo(@TypeOf(ghostty_vt.Terminal.vtStream)).@"fn".return_type.?;

pub const PersistentTerminal = struct {
    terminal: ghostty_vt.Terminal,
    allocator: std.mem.Allocator,
    stream: ?ReadonlyStream,

    pub fn init(alloc: std.mem.Allocator, cols: u16, rows: u16) !PersistentTerminal {
        var terminal = try ghostty_vt.Terminal.init(alloc, .{
            .cols = cols,
            .rows = rows,
            .max_scrollback = std.math.maxInt(usize),
        });

        terminal.modes.set(.linefeed, true);

        return .{
            .terminal = terminal,
            .allocator = alloc,
            .stream = null,
        };
    }

    pub fn initStream(self: *PersistentTerminal) void {
        self.stream = self.terminal.vtStream();
    }

    pub fn deinit(self: *PersistentTerminal) void {
        if (self.stream) |*s| {
            s.deinit();
        }
        self.terminal.deinit(self.allocator);
    }

    pub fn feed(self: *PersistentTerminal, data: []const u8) !void {
        try self.stream.?.nextSlice(data);
    }

    pub fn isReady(self: *const PersistentTerminal) bool {
        if (self.stream) |s| {
            return s.parser.state == .ground;
        }
        return true;
    }

    pub fn resize(self: *PersistentTerminal, cols: u16, rows: u16) !void {
        try self.terminal.resize(self.allocator, cols, rows);
    }

    pub fn reset(self: *PersistentTerminal) void {
        self.terminal.fullReset();
        if (self.stream) |*s| {
            s.deinit();
        }
        self.stream = self.terminal.vtStream();
    }
};

var terminals_mutex: std.Thread.Mutex = .{};
var terminals: ?std.AutoHashMap(u32, *PersistentTerminal) = null;

fn getTerminalsMap() *std.AutoHashMap(u32, *PersistentTerminal) {
    if (terminals == null) {
        terminals = std.AutoHashMap(u32, *PersistentTerminal).init(std.heap.page_allocator);
    }
    return &terminals.?;
}

pub fn ptyToJson(
    globalArena: std.mem.Allocator,
    input_ptr: [*]const u8,
    input_len: usize,
    cols: u16,
    rows: u16,
    offset: usize,
    limit: usize,
    out_len: *usize,
) ?[*]u8 {
    const input = input_ptr[0..input_len];
    const lim: ?usize = if (limit == 0) null else limit;

    var t: ghostty_vt.Terminal = ghostty_vt.Terminal.init(globalArena, .{
        .cols = cols,
        .rows = rows,
        .max_scrollback = std.math.maxInt(usize),
    }) catch return null;
    defer t.deinit(globalArena);

    t.modes.set(.linefeed, true);

    var stream = t.vtStream();
    defer stream.deinit();

    if (lim) |line_limit| {
        const chunk_size: usize = 4096;
        const threshold = line_limit + offset + 20;
        var pos: usize = 0;

        while (pos < input.len) {
            const end = @min(pos + chunk_size, input.len);
            stream.nextSlice(input[pos..end]) catch return null;
            pos = end;

            if (stream.parser.state == .ground) {
                if (hasEnoughLines(t.screens.active, threshold)) {
                    break;
                }
            }
        }
    } else {
        stream.nextSlice(input) catch return null;
    }

    var output: std.ArrayListAligned(u8, null) = .empty;
    writeJsonOutput(output.writer(globalArena), &t, offset, lim) catch return null;

    out_len.* = output.items.len;
    return output.items.ptr;
}

pub fn ptyToText(
    globalArena: std.mem.Allocator,
    input_ptr: [*]const u8,
    input_len: usize,
    cols: u16,
    rows: u16,
    out_len: *usize,
) ?[*]u8 {
    const input = input_ptr[0..input_len];

    var t: ghostty_vt.Terminal = ghostty_vt.Terminal.init(globalArena, .{
        .cols = cols,
        .rows = rows,
        .max_scrollback = std.math.maxInt(usize),
    }) catch return null;
    defer t.deinit(globalArena);

    t.modes.set(.linefeed, true);

    var stream = t.vtStream();
    defer stream.deinit();

    stream.nextSlice(input) catch return null;

    var builder: std.Io.Writer.Allocating = .init(globalArena);
    var fmt: formatter.TerminalFormatter = formatter.TerminalFormatter.init(&t, .plain);
    fmt.format(&builder.writer) catch return null;

    const output = builder.writer.buffered();
    out_len.* = output.len;
    return @constCast(output.ptr);
}

pub fn createTerminal(id: u32, cols: u32, rows: u32) bool {
    terminals_mutex.lock();
    defer terminals_mutex.unlock();

    const map = getTerminalsMap();

    if (map.get(id)) |existing| {
        existing.deinit();
        std.heap.page_allocator.destroy(existing);
        _ = map.remove(id);
    }

    const term_ptr = std.heap.page_allocator.create(PersistentTerminal) catch return false;

    term_ptr.* = PersistentTerminal.init(
        std.heap.page_allocator,
        @intCast(cols),
        @intCast(rows),
    ) catch {
        std.heap.page_allocator.destroy(term_ptr);
        return false;
    };

    term_ptr.initStream();

    map.put(id, term_ptr) catch {
        term_ptr.deinit();
        std.heap.page_allocator.destroy(term_ptr);
        return false;
    };

    return true;
}

pub fn destroyTerminal(id: u32) void {
    terminals_mutex.lock();
    defer terminals_mutex.unlock();

    const map = getTerminalsMap();
    if (map.get(id)) |term| {
        term.deinit();
        std.heap.page_allocator.destroy(term);
        _ = map.remove(id);
    }
}

pub fn feedTerminal(id: u32, data_ptr: [*]const u8, data_len: usize) bool {
    terminals_mutex.lock();
    defer terminals_mutex.unlock();

    const map = getTerminalsMap();
    const term = map.get(id) orelse return false;
    term.feed(data_ptr[0..data_len]) catch return false;
    return true;
}

pub fn resizeTerminal(id: u32, cols: u32, rows: u32) bool {
    terminals_mutex.lock();
    defer terminals_mutex.unlock();

    const map = getTerminalsMap();
    const term = map.get(id) orelse return false;
    term.resize(@intCast(cols), @intCast(rows)) catch return false;
    return true;
}

pub fn resetTerminal(id: u32) bool {
    terminals_mutex.lock();
    defer terminals_mutex.unlock();

    const map = getTerminalsMap();
    const term = map.get(id) orelse return false;
    term.reset();
    return true;
}

pub fn getTerminalJson(globalArena: std.mem.Allocator, id: u32, offset: u32, limit: u32, out_len: *usize) ?[*]u8 {
    terminals_mutex.lock();
    defer terminals_mutex.unlock();

    const map = getTerminalsMap();
    const term = map.get(id) orelse return null;

    const lim: ?usize = if (limit == 0) null else @intCast(limit);

    var output: std.ArrayListAligned(u8, null) = .empty;
    writeJsonOutput(output.writer(globalArena), &term.terminal, @intCast(offset), lim) catch return null;

    out_len.* = output.items.len;
    return output.items.ptr;
}

pub fn getTerminalText(globalArena: std.mem.Allocator, id: u32, out_len: *usize) ?[*]u8 {
    terminals_mutex.lock();
    defer terminals_mutex.unlock();

    const map = getTerminalsMap();
    const term = map.get(id) orelse return null;

    var builder: std.Io.Writer.Allocating = .init(globalArena);
    var fmt: formatter.TerminalFormatter = formatter.TerminalFormatter.init(&term.terminal, .plain);
    fmt.format(&builder.writer) catch return null;

    const output = builder.writer.buffered();
    out_len.* = output.len;
    return @constCast(output.ptr);
}

pub fn getTerminalCursor(globalArena: std.mem.Allocator, id: u32, out_len: *usize) ?[*]u8 {
    terminals_mutex.lock();
    defer terminals_mutex.unlock();

    const map = getTerminalsMap();
    const term = map.get(id) orelse return null;

    const screen = term.terminal.screens.active;

    const output = std.fmt.allocPrint(globalArena, "[{},{}]", .{ screen.cursor.x, screen.cursor.y }) catch return null;
    out_len.* = output.len;
    return @constCast(output.ptr);
}

pub fn isTerminalReady(id: u32) i32 {
    terminals_mutex.lock();
    defer terminals_mutex.unlock();

    const map = getTerminalsMap();
    const term = map.get(id) orelse return -1;

    return if (term.isReady()) 1 else 0;
}
