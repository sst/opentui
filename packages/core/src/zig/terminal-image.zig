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
const SixelBin = struct { count: u32 = 0, r: u64 = 0, g: u64 = 0, b: u64 = 0 };

const QuantizedSixel = struct {
    allocator: std.mem.Allocator,
    palette: [256]SixelColor,
    palette_len: usize,
    indices: []u8,

    fn deinit(self: *QuantizedSixel) void {
        self.allocator.free(self.indices);
    }
};

fn histogramIndex(r: u8, g: u8, b: u8) u16 {
    return (@as(u16, r >> 3) << 10) | (@as(u16, g >> 3) << 5) | (b >> 3);
}

fn averageBin(bin: SixelBin) SixelColor {
    return .{
        .r = @intCast((bin.r + bin.count / 2) / bin.count),
        .g = @intCast((bin.g + bin.count / 2) / bin.count),
        .b = @intCast((bin.b + bin.count / 2) / bin.count),
    };
}

fn quantizeSixel(allocator: std.mem.Allocator, image: *const native_image.Image) !QuantizedSixel {
    const pixel_count = @as(usize, image.width()) * image.height();
    const expected_bytes = std.math.mul(usize, pixel_count, 4) catch return error.InvalidImageData;
    if (image.pixels.len < expected_bytes) return error.InvalidImageData;
    const bins = try allocator.alloc(SixelBin, 32 * 32 * 32);
    defer allocator.free(bins);
    @memset(bins, .{});
    var active: std.ArrayListUnmanaged(u16) = .{};
    defer active.deinit(allocator);

    var offset: usize = 0;
    while (offset < expected_bytes) : (offset += 4) {
        if (image.pixels[offset + 3] < 128) continue;
        const index = histogramIndex(image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2]);
        const bin = &bins[index];
        if (bin.count == 0) try active.append(allocator, index);
        bin.count += 1;
        bin.r += image.pixels[offset];
        bin.g += image.pixels[offset + 1];
        bin.b += image.pixels[offset + 2];
    }

    const SortContext = struct {
        bins: []const SixelBin,
        fn lessThan(ctx: @This(), a: u16, b: u16) bool {
            const ac = ctx.bins[a].count;
            const bc = ctx.bins[b].count;
            return ac > bc or (ac == bc and a < b);
        }
    };
    std.mem.sort(u16, active.items, SortContext{ .bins = bins }, SortContext.lessThan);

    var result = QuantizedSixel{
        .allocator = allocator,
        .palette = undefined,
        .palette_len = @min(active.items.len, 256),
        .indices = try allocator.alloc(u8, pixel_count),
    };
    errdefer allocator.free(result.indices);
    for (active.items[0..result.palette_len], 0..) |bin_index, index| {
        result.palette[index] = averageBin(bins[bin_index]);
    }

    const lookup = try allocator.alloc(u8, bins.len);
    defer allocator.free(lookup);
    @memset(lookup, 0);
    for (active.items) |bin_index| {
        const color = averageBin(bins[bin_index]);
        var closest: usize = 0;
        var closest_distance: u32 = std.math.maxInt(u32);
        for (result.palette[0..result.palette_len], 0..) |candidate, index| {
            const dr = @as(i32, color.r) - candidate.r;
            const dg = @as(i32, color.g) - candidate.g;
            const db = @as(i32, color.b) - candidate.b;
            const distance: u32 = @intCast(dr * dr + dg * dg + db * db);
            if (distance < closest_distance) {
                closest_distance = distance;
                closest = index;
            }
        }
        lookup[bin_index] = @intCast(closest);
    }

    offset = 0;
    var pixel: usize = 0;
    while (offset < expected_bytes) : ({
        offset += 4;
        pixel += 1;
    }) {
        if (image.pixels[offset + 3] < 128 or result.palette_len == 0) {
            result.indices[pixel] = 0;
        } else {
            result.indices[pixel] = lookup[histogramIndex(image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2])];
        }
    }
    return result;
}

fn percent(value: u8) u8 {
    return @intCast((@as(u16, value) * 100 + 127) / 255);
}

pub fn writeSixel(allocator: std.mem.Allocator, writer: anytype, image: *const native_image.Image, tmux: bool) !void {
    var quantized = try quantizeSixel(allocator, image);
    defer quantized.deinit();
    const masks = try allocator.alloc(u8, quantized.palette_len * image.width());
    defer allocator.free(masks);
    if (tmux) try writer.writeAll("\x1bPtmux;\x1b\x1bP") else try writer.writeAll("\x1bP");
    try writer.print("0;1;0q\"1;1;{d};{d}", .{ image.width(), image.height() });
    for (quantized.palette[0..quantized.palette_len], 0..) |color, index| {
        try writer.print("#{d};2;{d};{d};{d}", .{ index, percent(color.r), percent(color.g), percent(color.b) });
    }

    var band_y: u32 = 0;
    while (band_y < image.height()) : (band_y += 6) {
        @memset(masks, 0);
        var used = [_]bool{false} ** 256;
        for (0..6) |bit| {
            const y = band_y + @as(u32, @intCast(bit));
            if (y >= image.height()) continue;
            for (0..image.width()) |x| {
                const pixel = @as(usize, y) * image.width() + x;
                if (image.pixels[pixel * 4 + 3] < 128) continue;
                const palette_index = quantized.indices[pixel];
                masks[@as(usize, palette_index) * image.width() + x] |= @as(u8, 1) << @intCast(bit);
                used[palette_index] = true;
            }
        }

        var palette: u16 = 0;
        while (palette < quantized.palette_len) : (palette += 1) {
            if (!used[palette]) continue;
            const plane = masks[@as(usize, palette) * image.width() ..][0..image.width()];
            var last_nonzero = plane.len;
            while (last_nonzero > 0 and plane[last_nonzero - 1] == 0) last_nonzero -= 1;
            try writer.print("#{d}", .{palette});
            var x: usize = 0;
            while (x < last_nonzero) {
                const mask = plane[x];
                const char: u8 = '?' + mask;
                var run: usize = 1;
                while (x + run < last_nonzero and plane[x + run] == mask) : (run += 1) {}
                if (run >= 4) try writer.print("!{d}{c}", .{ run, char }) else for (0..run) |_| try writer.writeByte(char);
                x += run;
            }
            try writer.writeByte('$');
        }
        if (band_y + 6 < image.height()) try writer.writeByte('-');
    }
    if (tmux) try writer.writeAll("\x1b\x1b\\\x1b\\") else try writer.writeAll("\x1b\\");
}
