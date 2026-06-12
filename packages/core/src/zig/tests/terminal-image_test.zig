const std = @import("std");
const terminal_image = @import("../terminal-image.zig");
const image = @import("../image.zig");

const DecodedSixel = struct {
    indices: []u8,
    width: usize,
    height: usize,

    fn deinit(self: DecodedSixel) void {
        std.testing.allocator.free(self.indices);
    }
};

fn parseUnsigned(bytes: []const u8, position: *usize) !usize {
    const start = position.*;
    var value: usize = 0;
    while (position.* < bytes.len and std.ascii.isDigit(bytes[position.*])) : (position.* += 1) {
        value = value * 10 + bytes[position.*] - '0';
    }
    if (position.* == start) return error.InvalidSixel;
    return value;
}

fn decodeSixelIndices(payload: []const u8) !DecodedSixel {
    const quote = std.mem.indexOfScalar(u8, payload, '"') orelse return error.InvalidSixel;
    var position = quote + 1;
    _ = try parseUnsigned(payload, &position);
    if (position >= payload.len or payload[position] != ';') return error.InvalidSixel;
    position += 1;
    _ = try parseUnsigned(payload, &position);
    if (position >= payload.len or payload[position] != ';') return error.InvalidSixel;
    position += 1;
    const width = try parseUnsigned(payload, &position);
    if (position >= payload.len or payload[position] != ';') return error.InvalidSixel;
    position += 1;
    const height = try parseUnsigned(payload, &position);
    const indices = try std.testing.allocator.alloc(u8, width * height);
    errdefer std.testing.allocator.free(indices);
    @memset(indices, 255);

    var selected: ?u8 = null;
    var x: usize = 0;
    var band_y: usize = 0;
    while (position < payload.len) {
        const byte = payload[position];
        position += 1;
        switch (byte) {
            '#' => {
                selected = @intCast(try parseUnsigned(payload, &position));
                if (position < payload.len and payload[position] == ';') {
                    // Skip color mode and three color components.
                    for (0..4) |_| {
                        if (position >= payload.len or payload[position] != ';') return error.InvalidSixel;
                        position += 1;
                        _ = try parseUnsigned(payload, &position);
                    }
                }
            },
            '!' => {
                const count = try parseUnsigned(payload, &position);
                if (position >= payload.len) return error.InvalidSixel;
                const data = payload[position];
                position += 1;
                if (data < '?' or data > '~') return error.InvalidSixel;
                for (0..count) |_| {
                    const mask = data - '?';
                    for (0..6) |bit| {
                        const y = band_y + bit;
                        if (selected != null and x < width and y < height and mask & (@as(u8, 1) << @intCast(bit)) != 0) {
                            indices[y * width + x] = selected.?;
                        }
                    }
                    x += 1;
                }
            },
            '$' => x = 0,
            '-' => {
                x = 0;
                band_y += 6;
            },
            '?'...'~' => {
                const mask = byte - '?';
                for (0..6) |bit| {
                    const y = band_y + bit;
                    if (selected != null and x < width and y < height and mask & (@as(u8, 1) << @intCast(bit)) != 0) {
                        indices[y * width + x] = selected.?;
                    }
                }
                x += 1;
            },
            else => {},
        }
    }
    return .{ .indices = indices, .width = width, .height = height };
}

fn decodeKittyChunks(payload: []const u8) ![]u8 {
    var decoded: std.ArrayList(u8) = .empty;
    errdefer decoded.deinit(std.testing.allocator);
    var offset: usize = 0;
    while (std.mem.indexOfPos(u8, payload, offset, "\x1b_G")) |start| {
        const separator = std.mem.indexOfScalarPos(u8, payload, start + 3, ';') orelse return error.InvalidKittyPayload;
        const end = std.mem.indexOfPos(u8, payload, separator + 1, "\x1b\\") orelse return error.InvalidKittyPayload;
        const encoded = payload[separator + 1 .. end];
        const decoded_len = try std.base64.standard.Decoder.calcSizeForSlice(encoded);
        const destination = try decoded.addManyAsSlice(std.testing.allocator, decoded_len);
        try std.base64.standard.Decoder.decode(destination, encoded);
        offset = end + 2;
    }
    return decoded.toOwnedSlice(std.testing.allocator);
}

test "kitty transmission chunks RGBA payloads and places without cursor movement" {
    const pixels = try std.testing.allocator.alloc(u8, 1025 * 4);
    defer std.testing.allocator.free(pixels);
    @memset(pixels, 42);
    const value = image.Image{
        .allocator = std.testing.allocator,
        .pixels = pixels,
        .metadata = .{ .width = 1025, .height = 1, .has_alpha = 1 },
    };
    var output: std.ArrayList(u8) = .empty;
    defer output.deinit(std.testing.allocator);
    try terminal_image.writeKittyTransmit(output.writer(std.testing.allocator), &value, 7, false);
    try terminal_image.writeKittyPlacement(output.writer(std.testing.allocator), 7, 8, 2, 3, 4, 5, 0, 0, 1, 1, -99, false);
    try std.testing.expect(std.mem.indexOf(u8, output.items, "i=7,m=1,q=2;") != null);
    try std.testing.expect(std.mem.indexOf(u8, output.items, "\x1b_Gm=0,q=2;") != null);
    try std.testing.expect(std.mem.indexOf(u8, output.items, "a=p,i=7,p=8,c=4,r=5,x=0,y=0,w=1,h=1,C=1,z=-99") != null);
}

test "kitty transmission uses RGB only when every pixel is opaque" {
    const opaque_image = try image.createFromRgba(std.testing.allocator, &[_]u8{ 1, 2, 3, 255 }, 1, 1, 4);
    defer opaque_image.deinit();
    var rgb: std.ArrayList(u8) = .empty;
    defer rgb.deinit(std.testing.allocator);
    try terminal_image.writeKittyTransmit(rgb.writer(std.testing.allocator), opaque_image, 1, false);
    try std.testing.expect(std.mem.indexOf(u8, rgb.items, "f=24") != null);
    try std.testing.expect(std.mem.indexOf(u8, rgb.items, ";AQID\x1b\\") != null);

    const transparent = try image.createFromRgba(std.testing.allocator, &[_]u8{ 1, 2, 3, 4 }, 1, 1, 4);
    defer transparent.deinit();
    var rgba: std.ArrayList(u8) = .empty;
    defer rgba.deinit(std.testing.allocator);
    try terminal_image.writeKittyTransmit(rgba.writer(std.testing.allocator), transparent, 1, false);
    try std.testing.expect(std.mem.indexOf(u8, rgba.items, "f=32") != null);
    try std.testing.expect(std.mem.indexOf(u8, rgba.items, ";AQIDBA==\x1b\\") != null);
}

test "kitty transmission rejects truncated image storage before writing" {
    var pixels = [_]u8{ 1, 2, 3 };
    const value = image.Image{
        .allocator = std.testing.allocator,
        .pixels = &pixels,
        .metadata = .{ .width = 1, .height = 1 },
    };
    var output: std.ArrayList(u8) = .empty;
    defer output.deinit(std.testing.allocator);
    try std.testing.expectError(error.InvalidImageData, terminal_image.writeKittyTransmit(output.writer(std.testing.allocator), &value, 1, false));
    try std.testing.expectEqual(@as(usize, 0), output.items.len);
}

test "kitty RGB transmission preserves pixels across chunk boundaries" {
    const width = 2050;
    const height = 1;
    const pixels = try std.testing.allocator.alloc(u8, width * height * 4);
    defer std.testing.allocator.free(pixels);
    const expected = try std.testing.allocator.alloc(u8, width * height * 3);
    defer std.testing.allocator.free(expected);
    for (0..width) |pixel| {
        pixels[pixel * 4] = @truncate(pixel);
        pixels[pixel * 4 + 1] = @truncate(pixel * 3);
        pixels[pixel * 4 + 2] = @truncate(pixel * 7);
        pixels[pixel * 4 + 3] = 255;
        @memcpy(expected[pixel * 3 ..][0..3], pixels[pixel * 4 ..][0..3]);
    }
    const value = try image.createFromRgba(std.testing.allocator, pixels, width, height, width * 4);
    defer value.deinit();
    var output: std.ArrayList(u8) = .empty;
    defer output.deinit(std.testing.allocator);
    try terminal_image.writeKittyTransmit(output.writer(std.testing.allocator), value, 1, false);
    const decoded = try decodeKittyChunks(output.items);
    defer std.testing.allocator.free(decoded);
    try std.testing.expectEqualSlices(u8, expected, decoded);
}

test "sixel encoding writes palette raster and terminator" {
    const value = try image.createFromRgba(std.testing.allocator, &[_]u8{ 255, 0, 0, 255 }, 1, 1, 4);
    defer value.deinit();
    var output: std.ArrayList(u8) = .empty;
    defer output.deinit(std.testing.allocator);
    try terminal_image.writeSixel(std.testing.allocator, output.writer(std.testing.allocator), value, false);
    try std.testing.expect(std.mem.startsWith(u8, output.items, "\x1bP0;1;0q\"1;1;1;1"));
    try std.testing.expect(std.mem.endsWith(u8, output.items, "\x1b\\"));
    try std.testing.expect(std.mem.indexOf(u8, output.items, ";2;100;0;0") != null);
}

test "sixel encoding does not open a DCS when payload generation fails" {
    const pixels = try std.testing.allocator.alloc(u8, 0);
    defer std.testing.allocator.free(pixels);
    const value = image.Image{
        .allocator = std.testing.allocator,
        .pixels = pixels,
        .metadata = .{ .width = 1, .height = 1 },
    };
    var output: std.ArrayList(u8) = .empty;
    defer output.deinit(std.testing.allocator);
    try std.testing.expectError(error.InvalidImageData, terminal_image.writeSixel(std.testing.allocator, output.writer(std.testing.allocator), &value, false));
    try std.testing.expectEqual(@as(usize, 0), output.items.len);
}

test "kitty tmux passthrough doubles inner escape bytes" {
    const value = try image.createFromRgba(std.testing.allocator, &[_]u8{ 1, 2, 3, 4 }, 1, 1, 4);
    defer value.deinit();
    var output: std.ArrayList(u8) = .empty;
    defer output.deinit(std.testing.allocator);
    try terminal_image.writeKittyTransmit(output.writer(std.testing.allocator), value, 11, true);
    try std.testing.expect(std.mem.startsWith(u8, output.items, "\x1bPtmux;\x1b\x1b_G"));
    try std.testing.expect(std.mem.endsWith(u8, output.items, "\x1b\x1b\\\x1b\\"));
}

test "sixel encoding uses RLE and omits transparent pixels" {
    const pixels = [_]u8{
        255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255,
        0,   0, 0, 0,
    };
    const value = try image.createFromRgba(std.testing.allocator, &pixels, 5, 1, 20);
    defer value.deinit();
    var output: std.ArrayList(u8) = .empty;
    defer output.deinit(std.testing.allocator);
    try terminal_image.writeSixel(std.testing.allocator, output.writer(std.testing.allocator), value, false);
    try std.testing.expect(std.mem.indexOf(u8, output.items, "!4@") != null);
}

test "sixel adaptive palette caps at 255 colors deterministically" {
    const width = 512;
    const pixels = try std.testing.allocator.alloc(u8, width * 4);
    defer std.testing.allocator.free(pixels);
    for (0..width) |index| {
        const offset = index * 4;
        pixels[offset] = @intCast(((index >> 6) & 0x1F) << 3);
        pixels[offset + 1] = @intCast(((index >> 3) & 0x1F) << 3);
        pixels[offset + 2] = @intCast((index & 0x1F) << 3);
        pixels[offset + 3] = 255;
    }
    const value = try image.createFromRgba(std.testing.allocator, pixels, width, 1, width * 4);
    defer value.deinit();
    var first: std.ArrayList(u8) = .empty;
    defer first.deinit(std.testing.allocator);
    var second: std.ArrayList(u8) = .empty;
    defer second.deinit(std.testing.allocator);
    try terminal_image.writeSixel(std.testing.allocator, first.writer(std.testing.allocator), value, false);
    try terminal_image.writeSixel(std.testing.allocator, second.writer(std.testing.allocator), value, false);
    try std.testing.expectEqualSlices(u8, first.items, second.items);
    try std.testing.expectEqual(@as(usize, 255), std.mem.count(u8, first.items, ";2;"));
}

test "sixel adaptive palette assigns shorter indices to common colors" {
    const width = 100;
    const pixels = try std.testing.allocator.alloc(u8, width * 4);
    defer std.testing.allocator.free(pixels);
    for (0..width) |index| {
        const offset = index * 4;
        const color: [4]u8 = if (index < 90) .{ 240, 32, 16, 255 } else .{ 8, 64, 224, 255 };
        @memcpy(pixels[offset..][0..4], &color);
    }
    const value = try image.createFromRgba(std.testing.allocator, pixels, width, 1, width * 4);
    defer value.deinit();
    var quantized = try terminal_image.quantizeSixel(std.testing.allocator, value, 2);
    defer quantized.deinit();
    try std.testing.expectEqual(@as(usize, 2), quantized.palette_len);
    try std.testing.expectEqual(@as(usize, 90), std.mem.count(u8, quantized.indices, &[_]u8{0}));
}

test "sixel indexed encoding preserves the supplied palette" {
    const indices = [_]u8{ 0, 1, 0, 1 };
    const palette = [_][3]u8{ .{ 12, 34, 56 }, .{ 210, 180, 90 } };
    var output: std.ArrayList(u8) = .empty;
    defer output.deinit(std.testing.allocator);
    try terminal_image.writeSixelIndexedPayload(std.testing.allocator, output.writer(std.testing.allocator), &indices, &palette, 4, 1);
    try std.testing.expect(std.mem.indexOf(u8, output.items, "#0;2;5;13;22") != null);
    try std.testing.expect(std.mem.indexOf(u8, output.items, "#1;2;82;71;35") != null);
    const decoded = try decodeSixelIndices(output.items);
    defer decoded.deinit();
    try std.testing.expectEqualSlices(u8, &indices, decoded.indices);
}

test "sixel indexed encoding reserves index 255 for transparency" {
    const palette = [_][3]u8{.{ 0, 0, 0 }} ** 256;
    var output: std.ArrayList(u8) = .empty;
    defer output.deinit(std.testing.allocator);
    try std.testing.expectError(
        error.InvalidImageData,
        terminal_image.writeSixelIndexedPayload(std.testing.allocator, output.writer(std.testing.allocator), &[_]u8{255}, &palette, 1, 1),
    );
    try std.testing.expectEqual(@as(usize, 0), output.items.len);
}

test "sixel indexed scheduling preserves cursor resets bands and transparency" {
    const width = 65;
    const height = 13;
    const palette = [_][3]u8{ .{ 255, 0, 0 }, .{ 0, 255, 0 }, .{ 0, 0, 255 } };
    const indices = try std.testing.allocator.alloc(u8, width * height);
    defer std.testing.allocator.free(indices);
    @memset(indices, 255);
    indices[0] = 0;
    indices[64] = 1;
    indices[1 * width + 40] = 0;
    indices[2 * width + 40] = 1;
    indices[6 * width + 63] = 2;
    indices[12 * width] = 1;
    indices[12 * width + 64] = 0;

    var output: std.ArrayList(u8) = .empty;
    defer output.deinit(std.testing.allocator);
    try terminal_image.writeSixelIndexedPayload(std.testing.allocator, output.writer(std.testing.allocator), indices, &palette, width, height);
    const decoded = try decodeSixelIndices(output.items);
    defer decoded.deinit();
    try std.testing.expectEqual(width, decoded.width);
    try std.testing.expectEqual(height, decoded.height);
    try std.testing.expectEqualSlices(u8, indices, decoded.indices);
    try std.testing.expectEqual(@as(usize, 2), std.mem.count(u8, output.items, "-"));
    try std.testing.expect(std.mem.indexOfScalar(u8, output.items, '$') != null);
}

test "sixel indexed scheduling handles cover-sized geometry" {
    const width = 576;
    const height = 1015;
    const palette = [_][3]u8{ .{ 255, 255, 255 }, .{ 64, 128, 255 } };
    const indices = try std.testing.allocator.alloc(u8, width * height);
    defer std.testing.allocator.free(indices);
    @memset(indices, 255);
    indices[0] = 0;
    indices[width - 1] = 1;
    indices[63] = 1;
    indices[64] = 0;
    indices[(height - 1) * width] = 1;
    indices[height * width - 1] = 0;

    var output: std.ArrayList(u8) = .empty;
    defer output.deinit(std.testing.allocator);
    try terminal_image.writeSixelIndexedPayload(std.testing.allocator, output.writer(std.testing.allocator), indices, &palette, width, height);
    const decoded = try decodeSixelIndices(output.items);
    defer decoded.deinit();
    try std.testing.expectEqualSlices(u8, indices, decoded.indices);
    try std.testing.expect(output.items.len < 10_000);
}

test "sixel indexed scheduling handles width and band boundaries" {
    const palette = [_][3]u8{ .{ 255, 255, 255 }, .{ 32, 96, 192 } };
    for ([_]usize{ 1, 5, 6, 7, 12, 13 }) |height| {
        for ([_]usize{ 1, 63, 64, 65, 127, 128, 129 }) |width| {
            const indices = try std.testing.allocator.alloc(u8, width * height);
            defer std.testing.allocator.free(indices);
            @memset(indices, 255);
            indices[0] = 0;
            indices[width - 1] = 1;
            indices[(height - 1) * width] = 1;
            indices[height * width - 1] = 0;
            if (width > 64) {
                indices[63] = 1;
                indices[64] = 0;
            }

            var output: std.ArrayList(u8) = .empty;
            defer output.deinit(std.testing.allocator);
            try terminal_image.writeSixelIndexedPayload(
                std.testing.allocator,
                output.writer(std.testing.allocator),
                indices,
                &palette,
                @intCast(width),
                @intCast(height),
            );
            const decoded = try decodeSixelIndices(output.items);
            defer decoded.deinit();
            try std.testing.expectEqualSlices(u8, indices, decoded.indices);
            try std.testing.expect(std.mem.indexOf(u8, output.items, "$-") == null);
        }
    }
}

test "sixel dithering is deterministic for a full color image" {
    const width = 160;
    const height = 240;
    const pixels = try std.testing.allocator.alloc(u8, width * height * 4);
    defer std.testing.allocator.free(pixels);
    for (0..width * height) |index| {
        const x = index % width;
        const y = index / width;
        const offset = index * 4;
        pixels[offset] = @truncate(x * 13 + y * 3);
        pixels[offset + 1] = @truncate(x * 5 + y * 11);
        pixels[offset + 2] = @truncate(x * 7 + y * 17);
        pixels[offset + 3] = 255;
    }
    const value = try image.createFromRgba(std.testing.allocator, pixels, width, height, width * 4);
    defer value.deinit();
    var first: std.ArrayList(u8) = .empty;
    defer first.deinit(std.testing.allocator);
    var second: std.ArrayList(u8) = .empty;
    defer second.deinit(std.testing.allocator);
    try terminal_image.writeSixel(std.testing.allocator, first.writer(std.testing.allocator), value, false);
    try terminal_image.writeSixel(std.testing.allocator, second.writer(std.testing.allocator), value, false);
    try std.testing.expectEqualSlices(u8, first.items, second.items);
}

test "adaptive Sixel palette quality by color limit" {
    const width = 160;
    const height = 240;
    const pixels = try std.testing.allocator.alloc(u8, width * height * 4);
    defer std.testing.allocator.free(pixels);
    for (0..width * height) |index| {
        const x = index % width;
        const y = index / width;
        const offset = index * 4;
        pixels[offset] = @truncate(x * 13 + y * 3);
        pixels[offset + 1] = @truncate(x * 5 + y * 11);
        pixels[offset + 2] = @truncate(x * 7 + y * 17);
        pixels[offset + 3] = 255;
    }
    const value = try image.createFromRgba(std.testing.allocator, pixels, width, height, width * 4);
    defer value.deinit();
    const weights = [_]u64{ 2, 4, 3 };
    for ([_]usize{ 64, 128, 255 }) |color_limit| {
        var quantized = try terminal_image.quantizeSixel(std.testing.allocator, value, color_limit);
        defer quantized.deinit();
        var error_sum: u64 = 0;
        for (quantized.indices, 0..) |palette_index, pixel| {
            const color = quantized.palette[palette_index];
            const offset = pixel * 4;
            for (0..3) |channel| {
                const difference = @as(i32, pixels[offset + channel]) - color[channel];
                error_sum += @as(u64, @intCast(difference * difference)) * weights[channel];
            }
        }
        const rmse = @sqrt(@as(f64, @floatFromInt(error_sum)) / (width * height * 9));
        var filtered_error: f64 = 0;
        var blocks: usize = 0;
        var block_y: usize = 0;
        while (block_y < height) : (block_y += 4) {
            var block_x: usize = 0;
            while (block_x < width) : (block_x += 4) {
                for (0..3) |channel| {
                    var source_sum: i32 = 0;
                    var output_sum: i32 = 0;
                    for (block_y..@min(block_y + 4, height)) |y| {
                        for (block_x..@min(block_x + 4, width)) |x| {
                            const pixel = y * width + x;
                            source_sum += pixels[pixel * 4 + channel];
                            output_sum += quantized.palette[quantized.indices[pixel]][channel];
                        }
                    }
                    const difference = @as(f64, @floatFromInt(source_sum - output_sum)) / 16.0;
                    filtered_error += difference * difference * @as(f64, @floatFromInt(weights[channel]));
                }
                blocks += 1;
            }
        }
        const filtered_rmse = @sqrt(filtered_error / @as(f64, @floatFromInt(blocks * 9)));
        const maximum_rmse: f64 = switch (color_limit) {
            64 => 19,
            128 => 15.5,
            255 => 12.2,
            else => unreachable,
        };
        const maximum_filtered_rmse: f64 = switch (color_limit) {
            64 => 4.3,
            128 => 2.7,
            255 => 2.5,
            else => unreachable,
        };
        try std.testing.expect(rmse <= maximum_rmse);
        try std.testing.expect(filtered_rmse <= maximum_filtered_rmse);
    }
}
