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

test "GIF probe and first frame decode preserve logical canvas transparency" {
    const gif = try decodeBase64("R0lGODlhAgACAPAAAAAAAP8AACH5BAEAAAAALAAAAAACAAIAAAIDDBAFADs=");
    defer std.testing.allocator.free(gif);
    var info: image.Info = .{};
    try std.testing.expectEqual(image.Status.ok, image.probe(gif, .{}, &info));
    try std.testing.expectEqual(@as(u32, @intFromEnum(image.Format.gif)), info.format);
    try std.testing.expectEqual(@as(u32, 2), info.width);
    try std.testing.expectEqual(@as(u32, 2), info.height);
    try std.testing.expectEqual(@as(u32, 1), info.has_alpha);

    const decoded = try image.decode(std.testing.allocator, gif, .{});
    defer decoded.deinit();
    try std.testing.expectEqual(info, decoded.info());
    try std.testing.expectEqualSlices(u8, &[_]u8{
        255, 0, 0, 255, 0,   0, 0, 0,
        0,   0, 0, 0,   255, 0, 0, 255,
    }, decoded.pixels);
}

test "GIF first frame uses logical canvas dimensions and frame offset" {
    const gif = try decodeBase64("R0lGODlhAwADAPAAAP8AAAAAACH5BAAAAAAALAEAAQABAAEAAAICRAEAOw==");
    defer std.testing.allocator.free(gif);
    const decoded = try image.decode(std.testing.allocator, gif, .{});
    defer decoded.deinit();
    try std.testing.expectEqual(@as(u32, 3), decoded.width());
    try std.testing.expectEqual(@as(u32, 3), decoded.height());
    try std.testing.expectEqual(@as(u32, 0), decoded.info().has_alpha);
    const center = (1 * 3 + 1) * 4;
    try std.testing.expectEqualSlices(u8, &[_]u8{ 255, 0, 0, 255 }, decoded.pixels[center .. center + 4]);
    try std.testing.expectEqualSlices(u8, &[_]u8{ 255, 0, 0, 255 }, decoded.pixels[0..4]);
}

test "GIF first frame honors a nonzero logical background palette index" {
    const encoded = "R0lGODlhAwADAPAAAP8AAAAAACH5BAAAAAAALAEAAQABAAEAAAICRAEAOw==";
    const gif = try decodeBase64(encoded);
    defer std.testing.allocator.free(gif);
    gif[11] = 1;

    const decoded = try image.decode(std.testing.allocator, gif, .{});
    defer decoded.deinit();
    const center = (1 * 3 + 1) * 4;
    try std.testing.expectEqualSlices(u8, &[_]u8{ 0, 0, 0, 255 }, decoded.pixels[0..4]);
    try std.testing.expectEqualSlices(u8, &[_]u8{ 255, 0, 0, 255 }, decoded.pixels[center .. center + 4]);
}

test "animated GIF decode returns only the first displayed frame" {
    const gif = try decodeBase64("R0lGODlhAgACAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAgACAAACAoRRACH5BAAKAAAALAAAAAACAAIAgAAA/wAAAAIChFEAOw==");
    defer std.testing.allocator.free(gif);
    const decoded = try image.decode(std.testing.allocator, gif, .{});
    defer decoded.deinit();
    var offset: usize = 0;
    while (offset < decoded.pixels.len) : (offset += 4) {
        try std.testing.expectEqualSlices(u8, &[_]u8{ 255, 0, 0, 255 }, decoded.pixels[offset .. offset + 4]);
    }
}

test "baseline and progressive JPEG decode to opaque RGBA" {
    const fixtures = [_][]const u8{
        "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAMDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAHCf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ADoDFU3/2Q==",
        "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wgARCAACAAMDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAB//EABUBAQEAAAAAAAAAAAAAAAAAAAYI/9oADAMBAAIQAxAAAAE5C1T/AP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//aAAwDAQACAAMAAAAQ/wD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==",
    };
    for (fixtures) |encoded| {
        const jpeg = try decodeBase64(encoded);
        defer std.testing.allocator.free(jpeg);
        var info: image.Info = .{};
        try std.testing.expectEqual(image.Status.ok, image.probe(jpeg, .{}, &info));
        try std.testing.expectEqual(@as(u32, @intFromEnum(image.Format.jpeg)), info.format);
        try std.testing.expectEqual(@as(u32, 3), info.width);
        try std.testing.expectEqual(@as(u32, 2), info.height);
        try std.testing.expectEqual(@as(u32, 0), info.has_alpha);
        const decoded = try image.decode(std.testing.allocator, jpeg, .{});
        defer decoded.deinit();
        try std.testing.expectEqual(info, decoded.info());
        for (decoded.pixels[3..], 0..) |channel, index| {
            if (index % 4 == 0) try std.testing.expectEqual(@as(u8, 255), channel);
        }
    }
}

test "JPEG decode rejects EOI bytes embedded in a comment without a terminal EOI marker" {
    const encoded = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAMDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAHCf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ADoDFU3/2Q==";
    const jpeg = try decodeBase64(encoded);
    defer std.testing.allocator.free(jpeg);

    const malformed = try std.testing.allocator.alloc(u8, jpeg.len + 4);
    defer std.testing.allocator.free(malformed);
    @memcpy(malformed[0..2], jpeg[0..2]);
    @memcpy(malformed[2..8], &[_]u8{ 0xFF, 0xFE, 0x00, 0x04, 0xFF, 0xD9 });
    @memcpy(malformed[8..], jpeg[2 .. jpeg.len - 2]);

    try std.testing.expectError(error.MalformedInput, image.decode(std.testing.allocator, malformed, .{}));
}

test "JPEG decode rejects EOI before the first scan" {
    const encoded = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAMDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAHCf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ADoDFU3/2Q==";
    const jpeg = try decodeBase64(encoded);
    defer std.testing.allocator.free(jpeg);
    const sos = std.mem.indexOf(u8, jpeg, &[_]u8{ 0xFF, 0xDA }) orelse return error.TestUnexpectedResult;

    const malformed = try std.testing.allocator.alloc(u8, sos + 2);
    defer std.testing.allocator.free(malformed);
    @memcpy(malformed[0..sos], jpeg[0..sos]);
    @memcpy(malformed[sos..], &[_]u8{ 0xFF, 0xD9 });

    try std.testing.expectError(error.MalformedInput, image.decode(std.testing.allocator, malformed, .{}));
}

test "JPEG decode rejects a scan without entropy data" {
    const encoded = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAMDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAHCf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ADoDFU3/2Q==";
    const jpeg = try decodeBase64(encoded);
    defer std.testing.allocator.free(jpeg);
    const sos = std.mem.indexOf(u8, jpeg, &[_]u8{ 0xFF, 0xDA }) orelse return error.TestUnexpectedResult;
    const scan_header_length = std.mem.readInt(u16, jpeg[sos + 2 ..][0..2], .big);
    const after_scan_header = sos + 2 + scan_header_length;

    const malformed = try std.testing.allocator.alloc(u8, after_scan_header + 2);
    defer std.testing.allocator.free(malformed);
    @memcpy(malformed[0..after_scan_header], jpeg[0..after_scan_header]);
    @memcpy(malformed[after_scan_header..], &[_]u8{ 0xFF, 0xD9 });

    try std.testing.expectError(error.MalformedInput, image.decode(std.testing.allocator, malformed, .{}));
}

test "JPEG decode rejects an incomplete entropy-coded scan" {
    const encoded = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAMDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAHCf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ADoDFU3/2Q==";
    const jpeg = try decodeBase64(encoded);
    defer std.testing.allocator.free(jpeg);
    const sos = std.mem.indexOf(u8, jpeg, &[_]u8{ 0xFF, 0xDA }) orelse return error.TestUnexpectedResult;
    const scan_header_length = std.mem.readInt(u16, jpeg[sos + 2 ..][0..2], .big);
    const after_scan_header = sos + 2 + scan_header_length;

    const malformed = try std.testing.allocator.alloc(u8, after_scan_header + 3);
    defer std.testing.allocator.free(malformed);
    @memcpy(malformed[0 .. after_scan_header + 1], jpeg[0 .. after_scan_header + 1]);
    @memcpy(malformed[after_scan_header + 1 ..], &[_]u8{ 0xFF, 0xD9 });

    try std.testing.expectError(error.MalformedInput, image.decode(std.testing.allocator, malformed, .{}));
}

test "JPEG probe applies dimension limits before full scan validation" {
    const encoded = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAMDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAHCf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ADoDFU3/2Q==";
    const jpeg = try decodeBase64(encoded);
    defer std.testing.allocator.free(jpeg);
    const sos = std.mem.indexOf(u8, jpeg, &[_]u8{ 0xFF, 0xDA }) orelse return error.TestUnexpectedResult;
    const scan_header_length = std.mem.readInt(u16, jpeg[sos + 2 ..][0..2], .big);
    const after_scan_header = sos + 2 + scan_header_length;

    const malformed = try std.testing.allocator.alloc(u8, after_scan_header + 3);
    defer std.testing.allocator.free(malformed);
    @memcpy(malformed[0 .. after_scan_header + 1], jpeg[0 .. after_scan_header + 1]);
    @memcpy(malformed[after_scan_header + 1 ..], &[_]u8{ 0xFF, 0xD9 });

    var info: image.Info = .{};
    try std.testing.expectEqual(image.Status.dimension_limit, image.probe(malformed, .{ .max_pixels = 0 }, &info));
    try std.testing.expectEqual(image.Status.malformed_input, image.probe(malformed, .{}, &info));
}

test "progressive JPEG decode rejects a final scan without entropy data" {
    const encoded = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wgARCAACAAMDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAB//EABUBAQEAAAAAAAAAAAAAAAAAAAYI/9oADAMBAAIQAxAAAAE5C1T/AP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//aAAwDAQACAAMAAAAQ/wD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==";
    const jpeg = try decodeBase64(encoded);
    defer std.testing.allocator.free(jpeg);

    var search_start: usize = 0;
    var final_sos: ?usize = null;
    while (std.mem.indexOfPos(u8, jpeg, search_start, &[_]u8{ 0xFF, 0xDA })) |sos| {
        final_sos = sos;
        search_start = sos + 2;
    }
    const sos = final_sos orelse return error.TestUnexpectedResult;
    const scan_header_length = std.mem.readInt(u16, jpeg[sos + 2 ..][0..2], .big);
    const after_scan_header = sos + 2 + scan_header_length;

    const malformed = try std.testing.allocator.alloc(u8, after_scan_header + 2);
    defer std.testing.allocator.free(malformed);
    @memcpy(malformed[0..after_scan_header], jpeg[0..after_scan_header]);
    @memcpy(malformed[after_scan_header..], &[_]u8{ 0xFF, 0xD9 });

    try std.testing.expectError(error.MalformedInput, image.decode(std.testing.allocator, malformed, .{}));
}

test "JPEG decode accepts trailing data after a complete stream" {
    const encoded = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAMDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAHCf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ADoDFU3/2Q==";
    const jpeg = try decodeBase64(encoded);
    defer std.testing.allocator.free(jpeg);

    const with_trailing_data = try std.testing.allocator.alloc(u8, jpeg.len + 3);
    defer std.testing.allocator.free(with_trailing_data);
    @memcpy(with_trailing_data[0..jpeg.len], jpeg);
    @memcpy(with_trailing_data[jpeg.len..], &[_]u8{ 1, 2, 3 });

    const decoded = try image.decode(std.testing.allocator, with_trailing_data, .{});
    defer decoded.deinit();
    try std.testing.expectEqual(@as(u32, 3), decoded.width());
    try std.testing.expectEqual(@as(u32, 2), decoded.height());
}

test "lossy lossless and alpha WebP decode to canonical RGBA" {
    const fixtures = [_]struct { encoded: []const u8, has_alpha: u32 }{
        .{ .encoded = "UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoDAAIAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=", .has_alpha = 0 },
        .{ .encoded = "UklGRhwAAABXRUJQVlA4TA8AAAAvAkAAAAcQ/Y/+ByKi/wEA", .has_alpha = 0 },
        .{ .encoded = "UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAEA8Q8x/zH4wViOh/CAA=", .has_alpha = 1 },
    };
    for (fixtures) |fixture| {
        const webp = try decodeBase64(fixture.encoded);
        defer std.testing.allocator.free(webp);
        var info: image.Info = .{};
        try std.testing.expectEqual(image.Status.ok, image.probe(webp, .{}, &info));
        try std.testing.expectEqual(@as(u32, @intFromEnum(image.Format.webp)), info.format);
        try std.testing.expectEqual(fixture.has_alpha, info.has_alpha);
        const decoded = try image.decode(std.testing.allocator, webp, .{});
        defer decoded.deinit();
        try std.testing.expectEqual(info, decoded.info());
    }
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

test "image creation records actual transparency" {
    const opaque_image = try image.createFromRgba(std.testing.allocator, &[_]u8{ 1, 2, 3, 255 }, 1, 1, 4);
    defer opaque_image.deinit();
    try std.testing.expectEqual(@as(u32, 0), opaque_image.metadata.has_alpha);

    const transparent = try image.createFromRgba(std.testing.allocator, &[_]u8{ 1, 2, 3, 254 }, 1, 1, 4);
    defer transparent.deinit();
    try std.testing.expectEqual(@as(u32, 1), transparent.metadata.has_alpha);
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
    try std.testing.expectEqual(@as(u32, 4), output.width());
    try std.testing.expectEqual(@as(u32, 3), output.height());
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
    try std.testing.expectEqual(@as(u32, 2), rotated.width());
    try std.testing.expectEqual(@as(u32, 3), rotated.height());
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
