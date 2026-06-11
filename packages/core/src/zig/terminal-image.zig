const std = @import("std");
const native_image = @import("image.zig");

pub fn writeKittyTransmit(writer: anytype, image: *const native_image.Image, id: u32, tmux: bool) !void {
    const raw_chunk = 3072;
    var offset: usize = 0;
    var first = true;
    while (offset < image.pixels.len) {
        const end = @min(offset + raw_chunk, image.pixels.len);
        const more = end < image.pixels.len;
        if (tmux) try writer.writeAll("\x1bPtmux;\x1b\x1b_G") else try writer.writeAll("\x1b_G");
        if (first) {
            try writer.print("a=t,f=32,s={d},v={d},i={d},m={d},q=2;", .{ image.width(), image.height(), id, @intFromBool(more) });
        } else {
            try writer.print("m={d},q=2;", .{@intFromBool(more)});
        }
        var encoded: [4096]u8 = undefined;
        const payload = std.base64.standard.Encoder.encode(encoded[0..std.base64.standard.Encoder.calcSize(end - offset)], image.pixels[offset..end]);
        try writer.writeAll(payload);
        if (tmux) try writer.writeAll("\x1b\x1b\\\x1b\\") else try writer.writeAll("\x1b\\");
        offset = end;
        first = false;
    }
}

pub fn writeKittyPlacement(
    writer: anytype,
    id: u32,
    placement_id: u32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    source_x: u32,
    source_y: u32,
    source_width: u32,
    source_height: u32,
    z: i32,
    tmux: bool,
) !void {
    try writer.print("\x1b[{d};{d}H", .{ y + 1, x + 1 });
    if (tmux) try writer.writeAll("\x1bPtmux;\x1b\x1b_G") else try writer.writeAll("\x1b_G");
    try writer.print("a=p,i={d},p={d},c={d},r={d},x={d},y={d},w={d},h={d},C=1,z={d},q=2", .{
        id, placement_id, width, height, source_x, source_y, source_width, source_height, z,
    });
    if (tmux) try writer.writeAll("\x1b\x1b\\\x1b\\") else try writer.writeAll("\x1b\\");
}

pub fn writeKittyDelete(writer: anytype, id: u32, placement_id: ?u32, free_image: bool, tmux: bool) !void {
    if (tmux) try writer.writeAll("\x1bPtmux;\x1b\x1b_G") else try writer.writeAll("\x1b_G");
    try writer.print("a=d,d={c},i={d}", .{ if (free_image) @as(u8, 'I') else @as(u8, 'i'), id });
    if (placement_id) |p| try writer.print(",p={d}", .{p});
    try writer.writeAll(",q=2");
    if (tmux) try writer.writeAll("\x1b\x1b\\\x1b\\") else try writer.writeAll("\x1b\\");
}

fn sixelPaletteIndex(r: u8, g: u8, b: u8) u8 {
    const red: u8 = @intCast((@as(u16, r) * 3 + 127) / 255);
    const green: u8 = @intCast((@as(u16, g) + 127) / 255);
    const blue: u8 = @intCast((@as(u16, b) + 127) / 255);
    return red * 4 + green * 2 + blue;
}

pub fn writeSixel(writer: anytype, image: *const native_image.Image, tmux: bool) !void {
    if (tmux) try writer.writeAll("\x1bPtmux;\x1b\x1bP") else try writer.writeAll("\x1bP");
    try writer.print("0;1;0q\"1;1;{d};{d}", .{ image.width(), image.height() });
    for (0..16) |index| {
        const r = index / 4;
        const g = (index / 2) % 2;
        const b = index % 2;
        try writer.print("#{d};2;{d};{d};{d}", .{ index, (r * 100 + 1) / 3, g * 100, b * 100 });
    }

    var band_y: u32 = 0;
    while (band_y < image.height()) : (band_y += 6) {
        var palette: u16 = 0;
        while (palette < 16) : (palette += 1) {
            var last_nonzero: i32 = -1;
            var x: u32 = 0;
            while (x < image.width()) : (x += 1) {
                var mask: u8 = 0;
                for (0..6) |bit| {
                    const y = band_y + @as(u32, @intCast(bit));
                    if (y >= image.height()) continue;
                    const offset = (@as(usize, y) * image.width() + x) * 4;
                    if (image.pixels[offset + 3] < 128) continue;
                    if (sixelPaletteIndex(image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2]) == palette) mask |= @as(u8, 1) << @intCast(bit);
                }
                if (mask != 0) last_nonzero = @intCast(x);
            }
            if (last_nonzero < 0) continue;
            try writer.print("#{d}", .{palette});
            x = 0;
            while (x <= last_nonzero) {
                var mask: u8 = 0;
                for (0..6) |bit| {
                    const y = band_y + @as(u32, @intCast(bit));
                    if (y >= image.height()) continue;
                    const offset = (@as(usize, y) * image.width() + x) * 4;
                    if (image.pixels[offset + 3] < 128) continue;
                    if (sixelPaletteIndex(image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2]) == palette) mask |= @as(u8, 1) << @intCast(bit);
                }
                const char: u8 = '?' + mask;
                var run: u32 = 1;
                while (x + run <= last_nonzero) : (run += 1) {
                    var next_mask: u8 = 0;
                    for (0..6) |bit| {
                        const y = band_y + @as(u32, @intCast(bit));
                        if (y >= image.height()) continue;
                        const offset = (@as(usize, y) * image.width() + x + run) * 4;
                        if (image.pixels[offset + 3] >= 128 and sixelPaletteIndex(image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2]) == palette) next_mask |= @as(u8, 1) << @intCast(bit);
                    }
                    if (next_mask != mask) break;
                }
                if (run >= 4) try writer.print("!{d}{c}", .{ run, char }) else for (0..run) |_| try writer.writeByte(char);
                x += run;
            }
            try writer.writeByte('$');
        }
        if (band_y + 6 < image.height()) try writer.writeByte('-');
    }
    if (tmux) try writer.writeAll("\x1b\x1b\\\x1b\\") else try writer.writeAll("\x1b\\");
}
