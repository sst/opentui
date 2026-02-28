const std = @import("std");
const testing = std.testing;
const ansi = @import("../ansi.zig");

test "rgbTo256Color: pure red" {
    const index = ansi.rgbTo256Color(255, 0, 0);
    try testing.expectEqual(@as(u8, 196), index);
}

test "rgbTo256Color: pure green" {
    const index = ansi.rgbTo256Color(0, 255, 0);
    try testing.expectEqual(@as(u8, 46), index);
}

test "rgbTo256Color: pure blue" {
    const index = ansi.rgbTo256Color(0, 0, 255);
    try testing.expectEqual(@as(u8, 21), index);
}

test "rgbTo256Color: black" {
    const index = ansi.rgbTo256Color(0, 0, 0);
    try testing.expectEqual(@as(u8, 16), index);
}

test "rgbTo256Color: white" {
    const index = ansi.rgbTo256Color(255, 255, 255);
    try testing.expectEqual(@as(u8, 231), index);
}

test "rgbTo256Color: grayscale" {
    const gray1 = ansi.rgbTo256Color(128, 128, 128);
    try testing.expect(gray1 >= 232 and gray1 <= 255);

    const gray2 = ansi.rgbTo256Color(64, 64, 64);
    try testing.expect(gray2 >= 232 and gray2 <= 255);

    const gray3 = ansi.rgbTo256Color(192, 192, 192);
    try testing.expect(gray3 >= 232 and gray3 <= 255);
}

test "rgbTo256Color: color cube colors" {
    const cyan = ansi.rgbTo256Color(0, 255, 255);
    try testing.expectEqual(@as(u8, 51), cyan);

    const magenta = ansi.rgbTo256Color(255, 0, 255);
    try testing.expectEqual(@as(u8, 201), magenta);

    const yellow = ansi.rgbTo256Color(255, 255, 0);
    try testing.expectEqual(@as(u8, 226), yellow);
}

test "rgbTo256Color: near-black uses grayscale" {
    const index = ansi.rgbTo256Color(10, 10, 10);
    try testing.expect(index >= 232);
}

test "rgbTo256Color: near-white uses grayscale" {
    const index = ansi.rgbTo256Color(245, 245, 245);
    try testing.expect(index >= 232);
}
