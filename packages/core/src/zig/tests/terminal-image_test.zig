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
    try std.testing.expect(std.mem.indexOf(u8, output.items, "#0;2;100;0;0") != null);
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

test "sixel encoding uses RLE for repeated columns and omits transparent pixels" {
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

test "sixel palette is derived from source colors" {
    const pixels = [_]u8{
        123, 45,  201, 255,
        17,  231, 89,  255,
    };
    const value = try image.createFromRgba(std.testing.allocator, &pixels, 2, 1, 8);
    defer value.deinit();
    var output: std.ArrayList(u8) = .empty;
    defer output.deinit(std.testing.allocator);
    try terminal_image.writeSixel(std.testing.allocator, output.writer(std.testing.allocator), value, false);
    try std.testing.expect(std.mem.indexOf(u8, output.items, ";2;48;18;79") != null);
    try std.testing.expect(std.mem.indexOf(u8, output.items, ";2;7;91;35") != null);
}

test "sixel palette caps at 256 colors deterministically" {
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
    try std.testing.expectEqual(@as(usize, 256), std.mem.count(u8, first.items, ";2;"));
}
