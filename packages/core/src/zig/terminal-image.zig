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
const SixelMoment = struct { count: u64 = 0, r: u64 = 0, g: u64 = 0, b: u64 = 0, square: u64 = 0 };
const SixelBox = struct { r0: u8 = 0, r1: u8 = 32, g0: u8 = 0, g1: u8 = 32, b0: u8 = 0, b1: u8 = 32 };
const SixelError = struct { r: i32 = 0, g: i32 = 0, b: i32 = 0 };
const SIXEL_HISTOGRAM_SIDE = 33;
const SIXEL_HISTOGRAM_LEN = SIXEL_HISTOGRAM_SIDE * SIXEL_HISTOGRAM_SIDE * SIXEL_HISTOGRAM_SIDE;

// Wu quantization uses a fixed 5-bit RGB moment cube for deterministic, bounded palette generation:
// https://doi.org/10.1016/B978-0-08-050754-5.50035-9
// Remapping uses serpentine Floyd-Steinberg diffusion for better gradients with only two error rows:
// https://steveomohundro.com/wp-content/uploads/2009/03/omohundro90_floyd_steinberg_dithering.pdf

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

fn momentIndex(r: usize, g: usize, b: usize) usize {
    return (r * SIXEL_HISTOGRAM_SIDE + g) * SIXEL_HISTOGRAM_SIDE + b;
}

fn addMoment(target: *SixelMoment, value: SixelMoment) void {
    target.count += value.count;
    target.r += value.r;
    target.g += value.g;
    target.b += value.b;
    target.square += value.square;
}

fn volumeValue(comptime field: []const u8, moments: []const SixelMoment, box: SixelBox) u64 {
    const value = @as(i128, @field(moments[momentIndex(box.r1, box.g1, box.b1)], field)) -
        @as(i128, @field(moments[momentIndex(box.r1, box.g1, box.b0)], field)) -
        @as(i128, @field(moments[momentIndex(box.r1, box.g0, box.b1)], field)) +
        @as(i128, @field(moments[momentIndex(box.r1, box.g0, box.b0)], field)) -
        @as(i128, @field(moments[momentIndex(box.r0, box.g1, box.b1)], field)) +
        @as(i128, @field(moments[momentIndex(box.r0, box.g1, box.b0)], field)) +
        @as(i128, @field(moments[momentIndex(box.r0, box.g0, box.b1)], field)) -
        @as(i128, @field(moments[momentIndex(box.r0, box.g0, box.b0)], field));
    return @intCast(value);
}

fn boxEnergy(moments: []const SixelMoment, box: SixelBox) u128 {
    const count = volumeValue("count", moments, box);
    if (count == 0) return 0;
    const r = volumeValue("r", moments, box);
    const g = volumeValue("g", moments, box);
    const b = volumeValue("b", moments, box);
    return (2 * @as(u128, r) * r + 4 * @as(u128, g) * g + 3 * @as(u128, b) * b) / count;
}

fn boxVariance(moments: []const SixelMoment, box: SixelBox) u128 {
    const square = volumeValue("square", moments, box);
    const energy = boxEnergy(moments, box);
    return @as(u128, square) - @min(@as(u128, square), energy);
}

const SixelAxis = enum { r, g, b };
const SixelCut = struct { axis: SixelAxis, at: u8, score: u128 };

fn bestBoxCut(moments: []const SixelMoment, box: SixelBox) ?SixelCut {
    var best: ?SixelCut = null;
    inline for ([_]SixelAxis{ .r, .g, .b }) |axis| {
        const low = switch (axis) {
            .r => box.r0,
            .g => box.g0,
            .b => box.b0,
        };
        const high = switch (axis) {
            .r => box.r1,
            .g => box.g1,
            .b => box.b1,
        };
        var at = low + 1;
        while (at < high) : (at += 1) {
            var first = box;
            var second = box;
            switch (axis) {
                .r => {
                    first.r1 = at;
                    second.r0 = at;
                },
                .g => {
                    first.g1 = at;
                    second.g0 = at;
                },
                .b => {
                    first.b1 = at;
                    second.b0 = at;
                },
            }
            if (volumeValue("count", moments, first) == 0 or volumeValue("count", moments, second) == 0) continue;
            const score = boxEnergy(moments, first) + boxEnergy(moments, second);
            if (best == null or score > best.?.score) best = .{ .axis = axis, .at = at, .score = score };
        }
    }
    return best;
}

fn nearestPaletteIndex(color: SixelColor, palette: []const SixelColor) u8 {
    var closest: usize = 0;
    var closest_distance: u32 = std.math.maxInt(u32);
    for (palette, 0..) |candidate, index| {
        const dr = @as(i32, color.r) - candidate.r;
        const dg = @as(i32, color.g) - candidate.g;
        const db = @as(i32, color.b) - candidate.b;
        const distance: u32 = @intCast(2 * dr * dr + 4 * dg * dg + 3 * db * db);
        if (distance < closest_distance) {
            closest_distance = distance;
            closest = index;
        }
    }
    return @intCast(closest);
}

fn applyError(value: u8, error_value: i32) u8 {
    const rounded = if (error_value < 0) @divTrunc(error_value - 8, 16) else @divTrunc(error_value + 8, 16);
    return @intCast(std.math.clamp(@as(i32, value) + rounded, 0, 255));
}

fn quantizeSixel(allocator: std.mem.Allocator, image: *const native_image.Image) !QuantizedSixel {
    const pixel_count = std.math.mul(usize, image.width(), image.height()) catch return error.InvalidImageData;
    const expected_bytes = std.math.mul(usize, pixel_count, 4) catch return error.InvalidImageData;
    if (image.pixels.len < expected_bytes) return error.InvalidImageData;
    const moments = try allocator.alloc(SixelMoment, SIXEL_HISTOGRAM_LEN);
    defer allocator.free(moments);
    @memset(moments, .{});
    var active_bins: usize = 0;

    var offset: usize = 0;
    while (offset < expected_bytes) : (offset += 4) {
        if (image.pixels[offset + 3] < 128) continue;
        const r = image.pixels[offset];
        const g = image.pixels[offset + 1];
        const b = image.pixels[offset + 2];
        const bin = &moments[momentIndex(@as(usize, r >> 3) + 1, @as(usize, g >> 3) + 1, @as(usize, b >> 3) + 1)];
        if (bin.count == 0) active_bins += 1;
        bin.count += 1;
        bin.r += r;
        bin.g += g;
        bin.b += b;
        bin.square += 2 * @as(u64, r) * r + 4 * @as(u64, g) * g + 3 * @as(u64, b) * b;
    }

    for (1..SIXEL_HISTOGRAM_SIDE) |r| {
        var area = [_]SixelMoment{.{}} ** SIXEL_HISTOGRAM_SIDE;
        for (1..SIXEL_HISTOGRAM_SIDE) |g| {
            var line: SixelMoment = .{};
            for (1..SIXEL_HISTOGRAM_SIDE) |b| {
                addMoment(&line, moments[momentIndex(r, g, b)]);
                addMoment(&area[b], line);
                var cumulative = moments[momentIndex(r - 1, g, b)];
                addMoment(&cumulative, area[b]);
                moments[momentIndex(r, g, b)] = cumulative;
            }
        }
    }

    var result = QuantizedSixel{
        .allocator = allocator,
        .palette = undefined,
        .palette_len = 0,
        .indices = try allocator.alloc(u8, pixel_count),
    };
    errdefer allocator.free(result.indices);
    if (active_bins == 0) {
        @memset(result.indices, 0);
        return result;
    }

    var boxes: [256]SixelBox = undefined;
    var variances: [256]u128 = [_]u128{0} ** 256;
    boxes[0] = .{};
    variances[0] = boxVariance(moments, boxes[0]);
    var box_count: usize = 1;
    const target_count = @min(active_bins, boxes.len);
    while (box_count < target_count) {
        var split_index: ?usize = null;
        var highest_variance: u128 = 0;
        for (variances[0..box_count], 0..) |variance, index| {
            if (variance > highest_variance) {
                highest_variance = variance;
                split_index = index;
            }
        }
        if (split_index == null) break;
        const cut = bestBoxCut(moments, boxes[split_index.?]) orelse {
            variances[split_index.?] = 0;
            continue;
        };
        var second = boxes[split_index.?];
        switch (cut.axis) {
            .r => {
                boxes[split_index.?].r1 = cut.at;
                second.r0 = cut.at;
            },
            .g => {
                boxes[split_index.?].g1 = cut.at;
                second.g0 = cut.at;
            },
            .b => {
                boxes[split_index.?].b1 = cut.at;
                second.b0 = cut.at;
            },
        }
        boxes[box_count] = second;
        variances[split_index.?] = boxVariance(moments, boxes[split_index.?]);
        variances[box_count] = boxVariance(moments, second);
        box_count += 1;
    }
    result.palette_len = box_count;
    for (boxes[0..box_count], 0..) |box, index| {
        const count = volumeValue("count", moments, box);
        result.palette[index] = .{
            .r = @intCast((volumeValue("r", moments, box) + count / 2) / count),
            .g = @intCast((volumeValue("g", moments, box) + count / 2) / count),
            .b = @intCast((volumeValue("b", moments, box) + count / 2) / count),
        };
    }

    const lookup = try allocator.alloc(u16, 32 * 32 * 32);
    defer allocator.free(lookup);
    @memset(lookup, 256);

    const error_len = @as(usize, image.width()) + 2;
    var current_errors = try allocator.alloc(SixelError, error_len);
    defer allocator.free(current_errors);
    var next_errors = try allocator.alloc(SixelError, error_len);
    defer allocator.free(next_errors);
    @memset(current_errors, .{});
    @memset(next_errors, .{});
    for (0..image.height()) |y| {
        const left_to_right = y % 2 == 0;
        for (0..image.width()) |step| {
            const x = if (left_to_right) step else image.width() - 1 - step;
            const pixel = y * image.width() + x;
            offset = pixel * 4;
            if (image.pixels[offset + 3] < 128) {
                result.indices[pixel] = 0;
                continue;
            }
            const error_index = x + 1;
            const color = SixelColor{
                .r = applyError(image.pixels[offset], current_errors[error_index].r),
                .g = applyError(image.pixels[offset + 1], current_errors[error_index].g),
                .b = applyError(image.pixels[offset + 2], current_errors[error_index].b),
            };
            const histogram_index = histogramIndex(color.r, color.g, color.b);
            if (lookup[histogram_index] == 256) {
                const r = (@as(u8, @intCast((histogram_index >> 10) & 31)) << 3) | 4;
                const g = (@as(u8, @intCast((histogram_index >> 5) & 31)) << 3) | 4;
                const b = (@as(u8, @intCast(histogram_index & 31)) << 3) | 4;
                lookup[histogram_index] = nearestPaletteIndex(.{ .r = r, .g = g, .b = b }, result.palette[0..result.palette_len]);
            }
            const palette_index: u8 = @intCast(lookup[histogram_index]);
            result.indices[pixel] = palette_index;
            const selected = result.palette[palette_index];
            const diff = SixelError{
                .r = @as(i32, color.r) - selected.r,
                .g = @as(i32, color.g) - selected.g,
                .b = @as(i32, color.b) - selected.b,
            };
            const forward = if (left_to_right) error_index + 1 else error_index - 1;
            const below_back = if (left_to_right) error_index - 1 else error_index + 1;
            current_errors[forward].r += diff.r * 7;
            current_errors[forward].g += diff.g * 7;
            current_errors[forward].b += diff.b * 7;
            next_errors[below_back].r += diff.r * 3;
            next_errors[below_back].g += diff.g * 3;
            next_errors[below_back].b += diff.b * 3;
            next_errors[error_index].r += diff.r * 5;
            next_errors[error_index].g += diff.g * 5;
            next_errors[error_index].b += diff.b * 5;
            const below_forward = if (left_to_right) error_index + 1 else error_index - 1;
            next_errors[below_forward].r += diff.r;
            next_errors[below_forward].g += diff.g;
            next_errors[below_forward].b += diff.b;
        }
        std.mem.swap([]SixelError, &current_errors, &next_errors);
        @memset(next_errors, .{});
    }
    return result;
}

fn percent(value: u8) u8 {
    return @intCast((@as(u16, value) * 100 + 127) / 255);
}

pub fn writeSixelPayload(allocator: std.mem.Allocator, writer: anytype, image: *const native_image.Image) !void {
    var quantized = try quantizeSixel(allocator, image);
    defer quantized.deinit();
    const masks = try allocator.alloc(u8, quantized.palette_len * image.width());
    defer allocator.free(masks);
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
