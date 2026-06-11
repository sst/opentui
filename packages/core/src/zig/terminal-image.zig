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

const SixelColor = struct { r: u8, g: u8, b: u8 };
const BAYER_4X4 = [16]u8{ 0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5 };

// A fixed 3x3x3 RGB cube avoids per-image palette construction. Local Bayer dithering keeps gradient
// detail without Floyd-Steinberg's serial dependency chain: https://github.com/hpjansson/chafa/blob/master/chafa/internal/chafa-dither.c
fn paletteColor(index: u8) SixelColor {
    return .{
        .r = @intCast((@as(u16, index / 9) * 255 + 1) / 2),
        .g = @intCast((@as(u16, (index / 3) % 3) * 255 + 1) / 2),
        .b = @intCast((@as(u16, index % 3) * 255 + 1) / 2),
    };
}

fn makeQuantize3() [16][256]u8 {
    @setEvalBranchQuota(16 * 256 * 4);
    var result: [16][256]u8 = undefined;
    for (0..16) |threshold| {
        for (0..256) |value| {
            const scaled = value * 2;
            const lower = scaled / 255;
            const remainder = scaled % 255;
            result[threshold][value] = @intCast(@min(lower + @intFromBool(remainder * 32 > (@as(usize, BAYER_4X4[threshold]) * 2 + 1) * 255), 2));
        }
    }
    return result;
}

const QUANTIZE_3 = makeQuantize3();

fn paletteIndex(r: u8, g: u8, b: u8, x: usize, y: usize) u8 {
    const threshold = (y & 3) * 4 + (x & 3);
    return QUANTIZE_3[threshold][r] * 9 + QUANTIZE_3[threshold][g] * 3 + QUANTIZE_3[threshold][b];
}

pub fn sixelQuantizedColor(r: u8, g: u8, b: u8, x: usize, y: usize) [3]u8 {
    const color = paletteColor(paletteIndex(r, g, b, x, y));
    return .{ color.r, color.g, color.b };
}

fn writeUnsigned(writer: anytype, value: usize) !void {
    var buffer: [20]u8 = undefined;
    var index = buffer.len;
    var remaining = value;
    while (true) {
        index -= 1;
        buffer[index] = @intCast('0' + remaining % 10);
        remaining /= 10;
        if (remaining == 0) break;
    }
    try writer.writeAll(buffer[index..]);
}

fn BufferedWriter(comptime Writer: type) type {
    return struct {
        writer: Writer,
        buffer: [8192]u8 = undefined,
        len: usize = 0,

        fn writeByte(self: *@This(), value: u8) !void {
            if (self.len == self.buffer.len) try self.flush();
            self.buffer[self.len] = value;
            self.len += 1;
        }

        fn writeAll(self: *@This(), value: []const u8) !void {
            if (value.len >= self.buffer.len) {
                try self.flush();
                try self.writer.writeAll(value);
                return;
            }
            if (self.len + value.len > self.buffer.len) try self.flush();
            @memcpy(self.buffer[self.len..][0..value.len], value);
            self.len += value.len;
        }

        fn flush(self: *@This()) !void {
            if (self.len == 0) return;
            try self.writer.writeAll(self.buffer[0..self.len]);
            self.len = 0;
        }
    };
}

pub fn writeSixelPayload(allocator: std.mem.Allocator, writer: anytype, image: *const native_image.Image) !void {
    const pixel_count = std.math.mul(usize, image.width(), image.height()) catch return error.InvalidImageData;
    const expected_bytes = std.math.mul(usize, pixel_count, 4) catch return error.InvalidImageData;
    if (image.pixels.len < expected_bytes) return error.InvalidImageData;
    const mask_count = std.math.mul(usize, 27, image.width()) catch return error.InvalidImageData;
    const masks = try allocator.alloc(u8, mask_count);
    defer allocator.free(masks);
    var buffered = BufferedWriter(@TypeOf(writer)){ .writer = writer };
    const output = &buffered;
    var generations = [_]u32{0} ** 27;
    var last_nonzero = [_]usize{0} ** 27;
    try output.writeAll("0;1;0q\"1;1;");
    try writeUnsigned(output, image.width());
    try output.writeByte(';');
    try writeUnsigned(output, image.height());
    for (0..27) |index| {
        const color = paletteColor(@intCast(index));
        try output.writeByte('#');
        try writeUnsigned(output, index);
        try output.writeAll(";2;");
        try writeUnsigned(output, (@as(u16, color.r) * 100 + 127) / 255);
        try output.writeByte(';');
        try writeUnsigned(output, (@as(u16, color.g) * 100 + 127) / 255);
        try output.writeByte(';');
        try writeUnsigned(output, (@as(u16, color.b) * 100 + 127) / 255);
    }

    const height: usize = image.height();
    var band_y: usize = 0;
    var generation: u32 = 0;
    while (band_y < height) : (band_y += 6) {
        generation += 1;
        for (0..6) |bit| {
            const y = band_y + bit;
            if (y >= height) continue;
            for (0..image.width()) |x| {
                const pixel = @as(usize, y) * image.width() + x;
                if (image.pixels[pixel * 4 + 3] < 128) continue;
                const palette_index = paletteIndex(image.pixels[pixel * 4], image.pixels[pixel * 4 + 1], image.pixels[pixel * 4 + 2], x, y);
                if (generations[palette_index] != generation) {
                    generations[palette_index] = generation;
                    @memset(masks[@as(usize, palette_index) * image.width() ..][0..image.width()], 0);
                    last_nonzero[palette_index] = 0;
                }
                masks[@as(usize, palette_index) * image.width() + x] |= @as(u8, 1) << @intCast(bit);
                last_nonzero[palette_index] = @max(last_nonzero[palette_index], x + 1);
            }
        }

        for (0..27) |palette| {
            if (generations[palette] != generation) continue;
            const plane = masks[palette * image.width() ..][0..last_nonzero[palette]];
            try output.writeByte('#');
            try writeUnsigned(output, palette);
            for (plane) |*value| value.* += '?';
            // Literal planes trade compression for throughput; payload caching avoids repeating this work.
            try output.writeAll(plane);
            try output.writeByte('$');
        }
        if (band_y + 6 < height) try output.writeByte('-');
    }
    try output.flush();
}

pub fn writeSixelFramedPayload(writer: anytype, payload: []const u8, tmux: bool) !void {
    if (tmux) try writer.writeAll("\x1bPtmux;\x1b\x1bP") else try writer.writeAll("\x1bP");
    try writer.writeAll(payload);
    if (tmux) try writer.writeAll("\x1b\x1b\\\x1b\\") else try writer.writeAll("\x1b\\");
}

pub fn writeSixel(allocator: std.mem.Allocator, writer: anytype, image: *const native_image.Image, tmux: bool) !void {
    var payload: std.ArrayList(u8) = .empty;
    defer payload.deinit(allocator);
    try writeSixelPayload(allocator, payload.writer(allocator), image);
    try writeSixelFramedPayload(writer, payload.items, tmux);
}
