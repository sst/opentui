const std = @import("std");
const ansi = @import("../ansi.zig");
const buffer = @import("../buffer.zig");
const ghostty = @import("ghostty.zig");

pub const Error = ghostty.Error || buffer.BufferError;

pub const Result = struct {
    dirty: ghostty.Dirty,
    rows: u32,
    cells: u32,
};

pub fn compose(
    allocator: std.mem.Allocator,
    api: *const ghostty.Api,
    render_state: ghostty.Handle,
    row_iterator: ghostty.Handle,
    row_cells: ghostty.Handle,
    target: *buffer.OptimizedBuffer,
    origin_x: i32,
    origin_y: i32,
) Error!Result {
    var dirty: ghostty.Dirty = .clean;
    try ghostty.result(api.render_state_get(render_state, .dirty, @ptrCast(&dirty)));
    if (dirty == .clean) return .{ .dirty = dirty, .rows = 0, .cells = 0 };

    var colors: ghostty.RenderColors = .{};
    try ghostty.result(api.render_state_colors_get(render_state, &colors));
    var cols: u16 = 0;
    try ghostty.result(api.render_state_get(render_state, .cols, @ptrCast(&cols)));
    var iterator = row_iterator;
    try ghostty.result(api.render_state_get(render_state, .row_iterator, @ptrCast(&iterator)));

    var y: u32 = 0;
    var rows: u32 = 0;
    var cells: u32 = 0;
    while (api.row_iterator_next(iterator)) : (y += 1) {
        var row_dirty = false;
        try ghostty.result(api.row_get(iterator, .dirty, @ptrCast(&row_dirty)));
        if (dirty == .partial and !row_dirty) continue;

        const dest_y = origin_y + @as(i32, @intCast(y));
        if (dest_y >= 0 and dest_y < target.getHeight()) {
            clearRow(target, origin_x, @intCast(dest_y), cols, colors.foreground, colors.background);
            try composeRow(allocator, api, iterator, row_cells, target, origin_x, @intCast(dest_y), &colors, &cells);
        }

        const clean = false;
        try ghostty.result(api.row_set(iterator, .dirty, @ptrCast(&clean)));
        rows += 1;
    }

    const clean: ghostty.Dirty = .clean;
    try ghostty.result(api.render_state_set(render_state, .dirty, @ptrCast(&clean)));
    return .{ .dirty = dirty, .rows = rows, .cells = cells };
}

fn clearRow(
    target: *buffer.OptimizedBuffer,
    origin_x: i32,
    y: u32,
    cols: u16,
    foreground: ghostty.Color,
    background: ghostty.Color,
) void {
    const fg = color(foreground);
    const bg = color(background);
    var x: u32 = 0;
    while (x < target.getWidth()) : (x += 1) {
        const source_x = @as(i32, @intCast(x)) - origin_x;
        if (source_x < 0 or source_x >= cols) continue;
        target.set(x, y, .{
            .char = buffer.DEFAULT_SPACE_CHAR,
            .fg = fg,
            .bg = bg,
            .attributes = 0,
        });
    }
}

fn composeRow(
    allocator: std.mem.Allocator,
    api: *const ghostty.Api,
    row_iterator: ghostty.Handle,
    row_cells: ghostty.Handle,
    target: *buffer.OptimizedBuffer,
    origin_x: i32,
    dest_y: u32,
    colors: *const ghostty.RenderColors,
    cells_drawn: *u32,
) Error!void {
    var cells = row_cells;
    try ghostty.result(api.row_get(row_iterator, .cells, @ptrCast(&cells)));

    var x: u32 = 0;
    while (api.row_cells_next(cells)) : (x += 1) {
        const dest_x = origin_x + @as(i32, @intCast(x));
        if (dest_x < 0 or dest_x >= target.getWidth()) continue;

        var raw: u64 = 0;
        try ghostty.result(api.row_cells_get(cells, .raw, @ptrCast(&raw)));
        var wide: ghostty.CellWide = .narrow;
        try ghostty.result(api.cell_get(raw, .wide, @ptrCast(&wide)));
        if (wide == .spacer_tail or wide == .spacer_head) continue;

        var style: ghostty.Style = .{};
        try ghostty.result(api.row_cells_get(cells, .style, @ptrCast(&style)));
        var fg = getColor(api, cells, .fg_color, colors.foreground) catch |err| switch (err) {
            error.NoValue, error.InvalidValue => colors.foreground,
            else => return err,
        };
        var bg = getColor(api, cells, .bg_color, colors.background) catch |err| switch (err) {
            error.NoValue, error.InvalidValue => colors.background,
            else => return err,
        };
        if (style.inverse) std.mem.swap(ghostty.Color, &fg, &bg);

        var stack: [128]u8 = undefined;
        var grapheme: ghostty.Buffer = .{ .ptr = &stack, .cap = stack.len, .len = 0 };
        const first = api.row_cells_get(cells, .graphemes_utf8, @ptrCast(&grapheme));
        const text = text: {
            if (first == .success) break :text stack[0..grapheme.len];
            if (first != .out_of_space) {
                try ghostty.result(first);
                unreachable;
            }
            const bytes = allocator.alloc(u8, grapheme.len) catch return error.OutOfMemory;
            defer allocator.free(bytes);
            grapheme = .{ .ptr = bytes.ptr, .cap = bytes.len, .len = 0 };
            try ghostty.result(api.row_cells_get(cells, .graphemes_utf8, @ptrCast(&grapheme)));
            try draw(target, bytes[0..grapheme.len], @intCast(dest_x), dest_y, fg, bg, style);
            cells_drawn.* += 1;
            continue;
        };

        try draw(target, text, @intCast(dest_x), dest_y, fg, bg, style);
        cells_drawn.* += 1;
    }
}

fn draw(
    target: *buffer.OptimizedBuffer,
    text: []const u8,
    x: u32,
    y: u32,
    foreground: ghostty.Color,
    background: ghostty.Color,
    style: ghostty.Style,
) buffer.BufferError!void {
    const cell_attributes = attributes(style);
    if (text.len == 0 or style.invisible) {
        target.set(x, y, .{
            .char = buffer.DEFAULT_SPACE_CHAR,
            .fg = color(foreground),
            .bg = color(background),
            .attributes = cell_attributes,
        });
        return;
    }
    try target.drawText(text, x, y, color(foreground), color(background), cell_attributes);
}

fn getColor(api: *const ghostty.Api, cells: ghostty.Handle, data: ghostty.CellData, fallback: ghostty.Color) ghostty.Error!ghostty.Color {
    var value = fallback;
    try ghostty.result(api.row_cells_get(cells, data, @ptrCast(&value)));
    return value;
}

fn color(value: ghostty.Color) buffer.RGBA {
    return ansi.rgbColor(value.r, value.g, value.b, 255);
}

fn attributes(style: ghostty.Style) u32 {
    var value: u32 = 0;
    if (style.bold) value |= ansi.TextAttributes.BOLD;
    if (style.faint) value |= ansi.TextAttributes.DIM;
    if (style.italic) value |= ansi.TextAttributes.ITALIC;
    if (style.underline != 0) value |= ansi.TextAttributes.UNDERLINE;
    if (style.blink) value |= ansi.TextAttributes.BLINK;
    if (style.invisible) value |= ansi.TextAttributes.HIDDEN;
    if (style.strikethrough) value |= ansi.TextAttributes.STRIKETHROUGH;
    return value;
}
