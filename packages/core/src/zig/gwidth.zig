// https://github.com/rockorager/libvaxis/blob/main/src/gwidth.zig
// MIT License
// Copyright (c) 2023 Tim Culverhouse

const std = @import("std");
const unicode = std.unicode;
const testing = std.testing;
const DisplayWidth = @import("DisplayWidth");
const code_point = @import("code_point");

/// the method to use when calculating the width of a grapheme
pub const WidthMethod = enum {
    wcwidth,
    unicode,
    no_zwj,
};

/// returns the width of the provided string, as measured by the method chosen
pub fn gwidth(str: []const u8, method: WidthMethod, data: *const DisplayWidth) u16 {
    switch (method) {
        .unicode => {
            return @intCast(data.strWidth(str));
        },
        .wcwidth => {
            var total: u16 = 0;
            var iter: code_point.Iterator = .{ .bytes = str };
            while (iter.next()) |cp| {
                const w: u16 = switch (cp.code) {
                    // undo an override in zg for emoji skintone selectors
                    0x1f3fb...0x1f3ff,
                    => 2,
                    else => @max(0, data.codePointWidth(cp.code)),
                };
                total += w;
            }
            return total;
        },
        .no_zwj => {
            var iter = std.mem.splitSequence(u8, str, "\u{200D}");
            var result: u16 = 0;
            while (iter.next()) |s| {
                result += gwidth(s, .unicode, data);
            }
            return result;
        },
    }
}

test "gwidth: a" {
    const alloc = testing.allocator_instance.allocator();
    const data = try DisplayWidth.init(alloc);
    defer data.deinit(alloc);
    try testing.expectEqual(1, gwidth("a", .unicode, &data));
    try testing.expectEqual(1, gwidth("a", .wcwidth, &data));
    try testing.expectEqual(1, gwidth("a", .no_zwj, &data));
}

test "gwidth: emoji with ZWJ" {
    const alloc = testing.allocator_instance.allocator();
    const data = try DisplayWidth.init(alloc);
    defer data.deinit(alloc);
    try testing.expectEqual(2, gwidth("👩‍🚀", .unicode, &data));
    try testing.expectEqual(4, gwidth("👩‍🚀", .wcwidth, &data));
    try testing.expectEqual(4, gwidth("👩‍🚀", .no_zwj, &data));
}

test "gwidth: emoji with VS16 selector" {
    const alloc = testing.allocator_instance.allocator();
    const data = try DisplayWidth.init(alloc);
    defer data.deinit(alloc);
    try testing.expectEqual(2, gwidth("\xE2\x9D\xA4\xEF\xB8\x8F", .unicode, &data));
    try testing.expectEqual(1, gwidth("\xE2\x9D\xA4\xEF\xB8\x8F", .wcwidth, &data));
    try testing.expectEqual(2, gwidth("\xE2\x9D\xA4\xEF\xB8\x8F", .no_zwj, &data));
}

test "gwidth: emoji with skin tone selector" {
    const alloc = testing.allocator_instance.allocator();
    const data = try DisplayWidth.init(alloc);
    defer data.deinit(alloc);
    try testing.expectEqual(2, gwidth("👋🏿", .unicode, &data));
    try testing.expectEqual(4, gwidth("👋🏿", .wcwidth, &data));
    try testing.expectEqual(2, gwidth("👋🏿", .no_zwj, &data));
}
