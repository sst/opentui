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
    try terminal_image.writeSixel(output.writer(std.testing.allocator), value, false);
    try std.testing.expect(std.mem.startsWith(u8, output.items, "\x1bP0;1;0q\"1;1;1;1"));
    try std.testing.expect(std.mem.endsWith(u8, output.items, "\x1b\\"));
    try std.testing.expect(std.mem.indexOf(u8, output.items, "#12") != null);
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
    try terminal_image.writeSixel(output.writer(std.testing.allocator), value, false);
    try std.testing.expect(std.mem.indexOf(u8, output.items, "!4@") != null);
}
