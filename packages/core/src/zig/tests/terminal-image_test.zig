const std = @import("std");
const terminal_image = @import("../terminal-image.zig");
const image = @import("../image.zig");

test "kitty transmission chunks RGBA payloads and places without cursor movement" {
    const pixels = try std.testing.allocator.alloc(u8, 3073);
    defer std.testing.allocator.free(pixels);
    @memset(pixels, 42);
    const value = image.Image{
        .allocator = std.testing.allocator,
        .pixels = pixels,
        .metadata = .{ .width = 1, .height = 1 },
    };
    var output: std.ArrayList(u8) = .empty;
    defer output.deinit(std.testing.allocator);
    try terminal_image.writeKittyTransmit(output.writer(std.testing.allocator), &value, 7, false);
    try terminal_image.writeKittyPlacement(output.writer(std.testing.allocator), 7, 8, 2, 3, 4, 5, 0, 0, 1, 1, -99, false);
    try std.testing.expect(std.mem.indexOf(u8, output.items, "i=7,m=1,q=2;") != null);
    try std.testing.expect(std.mem.indexOf(u8, output.items, "\x1b_Gm=0,q=2;") != null);
    try std.testing.expect(std.mem.indexOf(u8, output.items, "a=p,i=7,p=8,c=4,r=5,x=0,y=0,w=1,h=1,C=1,z=-99") != null);
}

test "sixel encoding writes palette raster and terminator" {
    const value = try image.createFromRgba(std.testing.allocator, &[_]u8{ 255, 0, 0, 255 }, 1, 1, 4);
    defer value.deinit();
    var output: std.ArrayList(u8) = .empty;
    defer output.deinit(std.testing.allocator);
    try terminal_image.writeSixel(std.testing.allocator, output.writer(std.testing.allocator), value, false);
    try std.testing.expect(std.mem.startsWith(u8, output.items, "\x1bP0;1;0q\"1;1;1;1"));
    try std.testing.expect(std.mem.endsWith(u8, output.items, "\x1b\\"));
    try std.testing.expect(std.mem.indexOf(u8, output.items, "#18;2;100;0;0") != null);
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

test "sixel encoding writes contiguous planes and omits transparent pixels" {
    const pixels = [_]u8{
        255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255,
        0,   0, 0, 0,
    };
    const value = try image.createFromRgba(std.testing.allocator, &pixels, 5, 1, 20);
    defer value.deinit();
    var output: std.ArrayList(u8) = .empty;
    defer output.deinit(std.testing.allocator);
    try terminal_image.writeSixel(std.testing.allocator, output.writer(std.testing.allocator), value, false);
    try std.testing.expect(std.mem.indexOf(u8, output.items, "#18@@@@$") != null);
}

test "sixel uses a fixed 27 color palette deterministically" {
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
    try std.testing.expectEqual(@as(usize, 27), std.mem.count(u8, first.items, ";2;"));
}

test "sixel Bayer dithering preserves exact colors and spatial averages" {
    for (0..4) |y| {
        for (0..4) |x| {
            try std.testing.expectEqual([3]u8{ 128, 0, 255 }, terminal_image.sixelQuantizedColor(128, 0, 255, x, y));
        }
    }

    for (0..256) |value| {
        var sum: u32 = 0;
        for (0..4) |y| {
            for (0..4) |x| sum += terminal_image.sixelQuantizedColor(@intCast(value), 0, 0, x, y)[0];
        }
        const average = @as(f64, @floatFromInt(sum)) / 16.0;
        try std.testing.expect(@abs(average - @as(f64, @floatFromInt(value))) <= 8.0);
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
