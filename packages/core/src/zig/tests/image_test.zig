const std = @import("std");
const image = @import("../image.zig");

fn makeImage(pixels: []const u8, width: u32, height: u32) !*image.Image {
    return image.createFromRgba(std.testing.allocator, pixels, width, height, width * 4);
}

fn decodeBase64(encoded: []const u8) ![]u8 {
    const size = try std.base64.standard.Decoder.calcSizeForSlice(encoded);
    const decoded = try std.testing.allocator.alloc(u8, size);
    errdefer std.testing.allocator.free(decoded);
    try std.base64.standard.Decoder.decode(decoded, encoded);
    return decoded;
}

test "PNG probe and decode return canonical red RGBA" {
    const encoded = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==";
    const png = try decodeBase64(encoded);
    defer std.testing.allocator.free(png);

    var info: image.Info = .{};
    try std.testing.expectEqual(image.Status.ok, image.probe(png, .{}, &info));
    try std.testing.expectEqual(@as(u32, 1), info.width);
    try std.testing.expectEqual(@as(u32, 1), info.height);
    try std.testing.expectEqual(@as(u32, 1), info.has_alpha);

    const decoded = try image.decode(std.testing.allocator, png, .{});
    defer decoded.deinit();
    try std.testing.expectEqualSlices(u8, &[_]u8{ 255, 0, 0, 255 }, decoded.pixels);
}

test "PNG probe distinguishes unsupported input, corruption, and limits" {
    var info: image.Info = .{};
    try std.testing.expectEqual(image.Status.unsupported_format, image.probe("not png", .{}, &info));

    const encoded = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==";
    const png = try decodeBase64(encoded);
    defer std.testing.allocator.free(png);
    png[29] ^= 1;
    try std.testing.expectEqual(image.Status.malformed_input, image.probe(png, .{}, &info));
    png[29] ^= 1;
    try std.testing.expectEqual(image.Status.memory_limit, image.probe(png, .{ .max_encoded_bytes = 1 }, &info));
    try std.testing.expectEqual(image.Status.dimension_limit, image.probe(png, .{ .max_pixels = 0 }, &info));
}

test "image creation copies strided RGBA input" {
    const pixels = [_]u8{
        1, 2,  3,  4,  5,  6,  7,  8,  99, 99, 99, 99,
        9, 10, 11, 12, 13, 14, 15, 16, 99, 99, 99, 99,
    };
    const value = try image.createFromRgba(std.testing.allocator, &pixels, 2, 2, 12);
    defer value.deinit();
    try std.testing.expectEqualSlices(u8, &[_]u8{ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 }, value.pixels);
}

test "image creation rejects invalid stride and short input" {
    const pixels = [_]u8{0} ** 16;
    try std.testing.expectError(error.InvalidArgument, image.createFromRgba(std.testing.allocator, &pixels, 2, 2, 7));
    try std.testing.expectError(error.InvalidArgument, image.createFromRgba(std.testing.allocator, pixels[0..15], 2, 2, 8));
}

test "extract copies the exact requested rectangle" {
    const pixels = [_]u8{
        1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255,
        4, 0, 0, 255, 5, 0, 0, 255, 6, 0, 0, 255,
    };
    const source = try makeImage(&pixels, 3, 2);
    defer source.deinit();
    const output = try image.extract(std.testing.allocator, source, 1, 0, 2, 2);
    defer output.deinit();
    try std.testing.expectEqualSlices(u8, &[_]u8{
        2, 0, 0, 255, 3, 0, 0, 255,
        5, 0, 0, 255, 6, 0, 0, 255,
    }, output.pixels);
    try std.testing.expectError(error.InvalidArgument, image.extract(std.testing.allocator, source, 2, 0, 2, 1));
}

test "extend fills every edge and preserves source pixels" {
    const source = try makeImage(&[_]u8{ 10, 20, 30, 40 }, 1, 1);
    defer source.deinit();
    const output = try image.extend(std.testing.allocator, source, 1, 2, 1, 1, .{ 1, 2, 3, 4 });
    defer output.deinit();
    try std.testing.expectEqual(@as(u32, 4), output.width);
    try std.testing.expectEqual(@as(u32, 3), output.height);
    try std.testing.expectEqualSlices(u8, &[_]u8{ 10, 20, 30, 40 }, output.pixels[20..24]);
    try std.testing.expectEqualSlices(u8, &[_]u8{ 1, 2, 3, 4 }, output.pixels[0..4]);
}

test "orthogonal transforms map pixels exactly" {
    const pixels = [_]u8{
        1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255,
        4, 0, 0, 255, 5, 0, 0, 255, 6, 0, 0, 255,
    };
    const source = try makeImage(&pixels, 3, 2);
    defer source.deinit();

    const rotated = try image.transform(std.testing.allocator, source, .rotate_90);
    defer rotated.deinit();
    try std.testing.expectEqual(@as(u32, 2), rotated.width);
    try std.testing.expectEqual(@as(u32, 3), rotated.height);
    try std.testing.expectEqualSlices(u8, &[_]u8{
        4, 0, 0, 255, 1, 0, 0, 255,
        5, 0, 0, 255, 2, 0, 0, 255,
        6, 0, 0, 255, 3, 0, 0, 255,
    }, rotated.pixels);

    const flopped = try image.transform(std.testing.allocator, source, .flop);
    defer flopped.deinit();
    try std.testing.expectEqualSlices(u8, &[_]u8{
        3, 0, 0, 255, 2, 0, 0, 255, 1, 0, 0, 255,
        6, 0, 0, 255, 5, 0, 0, 255, 4, 0, 0, 255,
    }, flopped.pixels);

    const rotated_180 = try image.transform(std.testing.allocator, source, .rotate_180);
    defer rotated_180.deinit();
    try std.testing.expectEqualSlices(u8, &[_]u8{
        6, 0, 0, 255, 5, 0, 0, 255, 4, 0, 0, 255,
        3, 0, 0, 255, 2, 0, 0, 255, 1, 0, 0, 255,
    }, rotated_180.pixels);

    const flipped = try image.transform(std.testing.allocator, source, .flip);
    defer flipped.deinit();
    try std.testing.expectEqualSlices(u8, &[_]u8{
        4, 0, 0, 255, 5, 0, 0, 255, 6, 0, 0, 255,
        1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255,
    }, flipped.pixels);
}

test "copyPixels supports RGBA, BGRA, and padded rows" {
    const source = try makeImage(&[_]u8{ 1, 2, 3, 4, 5, 6, 7, 8 }, 2, 1);
    defer source.deinit();
    var rgba = [_]u8{99} ** 12;
    try std.testing.expectEqual(image.Status.ok, image.copyPixels(source, &rgba, 12, false));
    try std.testing.expectEqualSlices(u8, &[_]u8{ 1, 2, 3, 4, 5, 6, 7, 8 }, rgba[0..8]);
    try std.testing.expectEqual(@as(u8, 99), rgba[8]);

    var bgra: [8]u8 = undefined;
    try std.testing.expectEqual(image.Status.ok, image.copyPixels(source, &bgra, 8, true));
    try std.testing.expectEqualSlices(u8, &[_]u8{ 3, 2, 1, 4, 7, 6, 5, 8 }, &bgra);
}

test "source-over composite uses linear light and correct alpha" {
    const base = try makeImage(&[_]u8{ 0, 0, 0, 255 }, 1, 1);
    defer base.deinit();
    const overlay = try makeImage(&[_]u8{ 255, 255, 255, 128 }, 1, 1);
    defer overlay.deinit();
    const output = try image.composite(std.testing.allocator, base, overlay, 0, 0, .source_over, 255);
    defer output.deinit();
    try std.testing.expect(@abs(@as(i16, output.pixels[0]) - 188) <= 1);
    try std.testing.expectEqual(@as(u8, 255), output.pixels[3]);
}

test "composite clips negative offsets and supports source mode" {
    const base = try makeImage(&([_]u8{ 0, 0, 0, 255 } ** 4), 2, 2);
    defer base.deinit();
    const overlay = try makeImage(&([_]u8{ 255, 0, 0, 255 } ** 4), 2, 2);
    defer overlay.deinit();
    const output = try image.composite(std.testing.allocator, base, overlay, -1, -1, .source, 128);
    defer output.deinit();
    try std.testing.expectEqualSlices(u8, &[_]u8{ 255, 0, 0, 128 }, output.pixels[0..4]);
    try std.testing.expectEqualSlices(u8, &[_]u8{ 0, 0, 0, 255 }, output.pixels[4..8]);
}

test "resize performs alpha-aware sRGB reduction" {
    const source = try makeImage(&[_]u8{
        255, 0, 0, 0,
        0,   0, 0, 255,
    }, 2, 1);
    defer source.deinit();
    const output = try image.resize(std.testing.allocator, source, 1, 1, .area);
    defer output.deinit();
    try std.testing.expect(output.pixels[0] <= 2);
    try std.testing.expect(@abs(@as(i16, output.pixels[3]) - 128) <= 1);
}
