const std = @import("std");

const Allocator = std.mem.Allocator;

extern fn ot_image_png_probe(data: [*]const u8, data_len: u32, width: *u32, height: *u32) c_int;
extern fn ot_image_png_decode(
    data: [*]const u8,
    data_len: u32,
    output: [*]u8,
    output_len: u64,
    expected_width: u32,
    expected_height: u32,
) c_int;
extern fn ot_image_gif_probe(data: [*]const u8, data_len: u32, width: *u32, height: *u32, has_alpha: *u32) c_int;
extern fn ot_image_gif_decode_first_frame(
    data: [*]const u8,
    data_len: u32,
    output: [*]u8,
    output_len: u64,
    expected_width: u32,
    expected_height: u32,
) c_int;
extern fn ot_image_jpeg_probe(data: [*]const u8, data_len: u32, width: *u32, height: *u32) c_int;
extern fn ot_image_jpeg_header_probe(data: [*]const u8, data_len: u32, width: *u32, height: *u32) c_int;
extern fn ot_image_jpeg_decode(
    data: [*]const u8,
    data_len: u32,
    output: [*]u8,
    output_len: u64,
    expected_width: u32,
    expected_height: u32,
) c_int;
extern fn ot_image_webp_probe(data: [*]const u8, data_len: u32, width: *u32, height: *u32, has_alpha: *u32) c_int;
extern fn ot_image_webp_decode(
    data: [*]const u8,
    data_len: u32,
    output: [*]u8,
    output_len: u64,
    expected_width: u32,
    expected_height: u32,
) c_int;
extern fn ot_image_resize_rgba(
    input: [*]const u8,
    input_width: u32,
    input_height: u32,
    input_stride: u32,
    output: [*]u8,
    output_width: u32,
    output_height: u32,
    output_stride: u32,
    filter: u32,
) c_int;

pub const Status = enum(u32) {
    ok = 0,
    invalid_handle = 1,
    unsupported_format = 2,
    unsupported_color_space = 3,
    malformed_input = 4,
    dimension_limit = 5,
    memory_limit = 6,
    invalid_argument = 7,
    out_of_memory = 8,
    output_too_small = 9,
    internal_error = 10,
    unsupported_feature = 11,
};

pub const Format = enum(u32) {
    unknown = 0,
    png = 1,
    raw_rgba = 2,
    jpeg = 3,
    webp = 4,
    gif = 5,
};

pub const ColorStatus = enum(u32) {
    assumed_srgb = 0,
    explicit_srgb = 1,
};

pub const Info = extern struct {
    width: u32 = 0,
    height: u32 = 0,
    source_width: u32 = 0,
    source_height: u32 = 0,
    format: u32 = @intFromEnum(Format.unknown),
    color_status: u32 = @intFromEnum(ColorStatus.assumed_srgb),
    orientation: u32 = 1,
    has_alpha: u32 = 0,
};

pub const Limits = struct {
    max_encoded_bytes: u64 = 64 * 1024 * 1024,
    max_width: u32 = 16_384,
    max_height: u32 = 16_384,
    max_pixels: u64 = 25_000_000,
    max_decoded_bytes: u64 = 100 * 1024 * 1024,
};

pub const ResizeFilter = enum(u32) {
    default = 0,
    area = 1,
    triangle = 2,
    cubic_bspline = 3,
    catmull_rom = 4,
    mitchell = 5,
    nearest = 6,
};

pub const Transform = enum(u32) {
    rotate_90 = 0,
    rotate_180 = 1,
    rotate_270 = 2,
    flip = 3,
    flop = 4,
};

pub const Blend = enum(u32) {
    source_over = 0,
    source = 1,
    destination_over = 2,
};

pub const Image = struct {
    allocator: Allocator,
    pixels: []u8,
    metadata: Info,
    ref_count: u32 = 1,

    pub fn width(self: *const Image) u32 {
        return self.metadata.width;
    }

    pub fn height(self: *const Image) u32 {
        return self.metadata.height;
    }

    pub fn deinit(self: *Image) void {
        std.debug.assert(self.ref_count > 0);
        self.ref_count -= 1;
        if (self.ref_count > 0) return;
        self.allocator.free(self.pixels);
        self.allocator.destroy(self);
    }

    pub fn retain(self: *Image) void {
        std.debug.assert(self.ref_count < std.math.maxInt(u32));
        self.ref_count += 1;
    }

    pub fn info(self: *const Image) Info {
        return self.metadata;
    }

    pub fn clone(self: *const Image) !*Image {
        return copyImage(self.allocator, self.pixels, self.metadata);
    }
};

const png_signature = [_]u8{ 137, 80, 78, 71, 13, 10, 26, 10 };
const srgb_chromaticities = [_]u32{ 31_270, 32_900, 64_000, 33_000, 30_000, 60_000, 15_000, 6_000 };

fn readU32Be(bytes: []const u8) u32 {
    return std.mem.readInt(u32, bytes[0..4], .big);
}

fn detectFormat(data: []const u8) Format {
    if (data.len >= png_signature.len and std.mem.eql(u8, data[0..png_signature.len], &png_signature)) return .png;
    if (data.len >= 6 and (std.mem.eql(u8, data[0..6], "GIF87a") or std.mem.eql(u8, data[0..6], "GIF89a"))) return .gif;
    if (data.len >= 2 and data[0] == 0xFF and data[1] == 0xD8) return .jpeg;
    if (data.len >= 12 and std.mem.eql(u8, data[0..4], "RIFF") and std.mem.eql(u8, data[8..12], "WEBP")) return .webp;
    return .unknown;
}

fn checkedPixelBytes(width: u32, height: u32, limits: Limits) !usize {
    if (width == 0 or height == 0 or width > limits.max_width or height > limits.max_height) {
        return error.DimensionLimit;
    }
    const pixels = std.math.mul(u64, width, height) catch return error.DimensionLimit;
    if (pixels > limits.max_pixels) return error.DimensionLimit;
    const bytes = std.math.mul(u64, pixels, 4) catch return error.MemoryLimit;
    if (bytes > limits.max_decoded_bytes or bytes > std.math.maxInt(usize)) return error.MemoryLimit;
    return @intCast(bytes);
}

pub fn statusFromError(err: anyerror) Status {
    return switch (err) {
        error.UnsupportedFormat => .unsupported_format,
        error.UnsupportedFeature => .unsupported_feature,
        error.DimensionLimit => .dimension_limit,
        error.MemoryLimit => .memory_limit,
        error.OutOfMemory => .out_of_memory,
        error.UnsupportedColorSpace => .unsupported_color_space,
        error.InvalidArgument => .invalid_argument,
        else => .malformed_input,
    };
}

const PngMetadata = struct {
    width: u32,
    height: u32,
    orientation: u8 = 1,
    has_alpha: bool,
    color_status: ColorStatus = .assumed_srgb,
};

fn parseExifOrientation(data: []const u8) u8 {
    var tiff = data;
    if (tiff.len >= 6 and std.mem.eql(u8, tiff[0..6], "Exif\x00\x00")) tiff = tiff[6..];
    if (tiff.len < 8) return 1;

    const endian: std.builtin.Endian = if (std.mem.eql(u8, tiff[0..2], "II"))
        .little
    else if (std.mem.eql(u8, tiff[0..2], "MM"))
        .big
    else
        return 1;
    if (std.mem.readInt(u16, tiff[2..4], endian) != 42) return 1;

    const ifd_offset = std.mem.readInt(u32, tiff[4..8], endian);
    if (ifd_offset > tiff.len -| 2) return 1;
    const ifd: usize = @intCast(ifd_offset);
    const count = std.mem.readInt(u16, tiff[ifd..][0..2], endian);
    const entries_bytes = std.math.mul(usize, count, 12) catch return 1;
    if (entries_bytes > tiff.len -| (ifd + 2)) return 1;

    var found: u8 = 1;
    var seen = false;
    for (0..count) |index| {
        const offset = ifd + 2 + index * 12;
        const entry = tiff[offset..][0..12];
        if (std.mem.readInt(u16, entry[0..2], endian) != 0x0112) continue;
        if (seen or std.mem.readInt(u16, entry[2..4], endian) != 3 or
            std.mem.readInt(u32, entry[4..8], endian) != 1)
        {
            return 1;
        }
        const value = std.mem.readInt(u16, entry[8..10], endian);
        if (value < 1 or value > 8) return 1;
        found = @intCast(value);
        seen = true;
    }
    return found;
}

fn scanPng(data: []const u8) !PngMetadata {
    if (data.len < 8 or !std.mem.eql(u8, data[0..8], &png_signature)) return error.UnsupportedFormat;
    if (data.len < 33) return error.MalformedInput;

    var offset: usize = 8;
    var metadata: ?PngMetadata = null;
    var saw_srgb = false;
    var saw_cicp = false;
    var cicp_supported = false;
    var saw_iccp = false;
    var saw_gamma = false;
    var gamma_supported = false;
    var saw_chrm = false;
    var chrm_supported = false;
    var saw_idat = false;
    var saw_iend = false;

    while (offset <= data.len -| 12) {
        const length: usize = readU32Be(data[offset..][0..4]);
        const chunk_end = std.math.add(usize, offset + 12, length) catch return error.MalformedInput;
        if (chunk_end > data.len) return error.MalformedInput;
        const kind = data[offset + 4 .. offset + 8];
        const payload = data[offset + 8 .. offset + 8 + length];
        const expected_crc = readU32Be(data[offset + 8 + length ..][0..4]);
        if (std.hash.Crc32.hash(data[offset + 4 .. offset + 8 + length]) != expected_crc) return error.MalformedInput;

        if (std.mem.eql(u8, kind, "IHDR")) {
            if (metadata != null or length != 13 or offset != 8) return error.MalformedInput;
            const color_type = payload[9];
            if (color_type != 0 and color_type != 2 and color_type != 3 and color_type != 4 and color_type != 6) {
                return error.MalformedInput;
            }
            metadata = .{
                .width = readU32Be(payload[0..4]),
                .height = readU32Be(payload[4..8]),
                .has_alpha = color_type == 4 or color_type == 6,
            };
        } else if (std.mem.eql(u8, kind, "iCCP")) {
            if (saw_iccp) return error.MalformedInput;
            saw_iccp = true;
        } else if (std.mem.eql(u8, kind, "cICP")) {
            if (saw_cicp or length != 4) return error.MalformedInput;
            saw_cicp = true;
            cicp_supported = std.mem.eql(u8, payload, &[_]u8{ 1, 13, 0, 1 });
        } else if (std.mem.eql(u8, kind, "sRGB")) {
            if (saw_srgb or length != 1 or payload[0] > 3) return error.MalformedInput;
            saw_srgb = true;
            if (metadata) |*value| value.color_status = .explicit_srgb;
        } else if (std.mem.eql(u8, kind, "gAMA")) {
            if (saw_gamma or length != 4) return error.MalformedInput;
            saw_gamma = true;
            gamma_supported = readU32Be(payload) == 45_455;
        } else if (std.mem.eql(u8, kind, "cHRM")) {
            if (saw_chrm or length != 32) return error.MalformedInput;
            saw_chrm = true;
            chrm_supported = true;
            for (srgb_chromaticities, 0..) |expected, index| {
                if (readU32Be(payload[index * 4 ..][0..4]) != expected) chrm_supported = false;
            }
        } else if (std.mem.eql(u8, kind, "tRNS")) {
            if (metadata) |*value| value.has_alpha = true;
        } else if (std.mem.eql(u8, kind, "eXIf")) {
            if (metadata) |*value| value.orientation = parseExifOrientation(payload);
        } else if (std.mem.eql(u8, kind, "IDAT")) {
            saw_idat = true;
        } else if (std.mem.eql(u8, kind, "IEND")) {
            if (length != 0 or !saw_idat or chunk_end != data.len) return error.MalformedInput;
            saw_iend = true;
            break;
        }
        offset = chunk_end;
    }
    if (!saw_iend) return error.MalformedInput;
    var result = metadata orelse return error.MalformedInput;
    if (saw_cicp and cicp_supported) {
        result.color_status = .explicit_srgb;
    } else if (saw_iccp) {
        return error.UnsupportedColorSpace;
    } else if (saw_srgb) {
        result.color_status = .explicit_srgb;
    } else if ((saw_gamma and !gamma_supported) or (saw_chrm and !chrm_supported)) {
        return error.UnsupportedColorSpace;
    } else if (saw_gamma or saw_chrm) {
        result.color_status = .explicit_srgb;
    }
    return result;
}

fn probeInternal(data: []const u8, limits: Limits, out: *Info, validate_jpeg: bool) Status {
    if (data.len == 0 or data.len > std.math.maxInt(u32)) return .invalid_argument;
    if (data.len > limits.max_encoded_bytes) return .memory_limit;
    const format = detectFormat(data);
    if (format == .unknown) return .unsupported_format;
    if (format == .jpeg) {
        var width: u32 = 0;
        var height: u32 = 0;
        const result = ot_image_jpeg_header_probe(data.ptr, @intCast(data.len), &width, &height);
        if (result == 2) return .out_of_memory;
        if (result != 0) return .malformed_input;
        _ = checkedPixelBytes(width, height, limits) catch |err| return statusFromError(err);
        if (validate_jpeg) {
            var validated_width: u32 = 0;
            var validated_height: u32 = 0;
            const validation_result = ot_image_jpeg_probe(
                data.ptr,
                @intCast(data.len),
                &validated_width,
                &validated_height,
            );
            if (validation_result == 2) return .out_of_memory;
            if (validation_result != 0 or validated_width != width or validated_height != height) return .malformed_input;
        }
        out.* = .{
            .width = width,
            .height = height,
            .source_width = width,
            .source_height = height,
            .format = @intFromEnum(Format.jpeg),
            .color_status = @intFromEnum(ColorStatus.assumed_srgb),
            .orientation = 1,
            .has_alpha = 0,
        };
        return .ok;
    }
    if (format == .webp) {
        var width: u32 = 0;
        var height: u32 = 0;
        var has_alpha: u32 = 0;
        const result = ot_image_webp_probe(data.ptr, @intCast(data.len), &width, &height, &has_alpha);
        if (result == 2) return .out_of_memory;
        if (result == 4) return .unsupported_feature;
        if (result != 0) return .malformed_input;
        _ = checkedPixelBytes(width, height, limits) catch |err| return statusFromError(err);
        out.* = .{
            .width = width,
            .height = height,
            .source_width = width,
            .source_height = height,
            .format = @intFromEnum(Format.webp),
            .color_status = @intFromEnum(ColorStatus.assumed_srgb),
            .orientation = 1,
            .has_alpha = has_alpha,
        };
        return .ok;
    }
    if (format == .gif) {
        var width: u32 = 0;
        var height: u32 = 0;
        var has_alpha: u32 = 0;
        const result = ot_image_gif_probe(data.ptr, @intCast(data.len), &width, &height, &has_alpha);
        if (result == 2) return .out_of_memory;
        if (result != 0) return .malformed_input;
        _ = checkedPixelBytes(width, height, limits) catch |err| return statusFromError(err);
        out.* = .{
            .width = width,
            .height = height,
            .source_width = width,
            .source_height = height,
            .format = @intFromEnum(Format.gif),
            .color_status = @intFromEnum(ColorStatus.assumed_srgb),
            .orientation = 1,
            .has_alpha = has_alpha,
        };
        return .ok;
    }
    const metadata = scanPng(data) catch |err| return statusFromError(err);
    _ = checkedPixelBytes(metadata.width, metadata.height, limits) catch |err| return statusFromError(err);

    var decoder_width: u32 = 0;
    var decoder_height: u32 = 0;
    if (ot_image_png_probe(data.ptr, @intCast(data.len), &decoder_width, &decoder_height) != 0 or
        decoder_width != metadata.width or decoder_height != metadata.height)
    {
        return .malformed_input;
    }

    const swaps_dimensions = metadata.orientation >= 5 and metadata.orientation <= 8;
    out.* = .{
        .width = if (swaps_dimensions) metadata.height else metadata.width,
        .height = if (swaps_dimensions) metadata.width else metadata.height,
        .source_width = metadata.width,
        .source_height = metadata.height,
        .format = @intFromEnum(Format.png),
        .color_status = @intFromEnum(metadata.color_status),
        .orientation = metadata.orientation,
        .has_alpha = @intFromBool(metadata.has_alpha),
    };
    return .ok;
}

pub fn probe(data: []const u8, limits: Limits, out: *Info) Status {
    return probeInternal(data, limits, out, true);
}

fn allocateImage(allocator: Allocator, metadata: Info) !*Image {
    const len = try checkedPixelBytes(metadata.width, metadata.height, .{});
    const image = try allocator.create(Image);
    errdefer allocator.destroy(image);
    image.* = .{
        .allocator = allocator,
        .pixels = try allocator.alloc(u8, len),
        .metadata = metadata,
    };
    return image;
}

fn copyImage(allocator: Allocator, pixels: []const u8, metadata: Info) !*Image {
    const image = try allocateImage(allocator, metadata);
    errdefer image.deinit();
    @memcpy(image.pixels, pixels);
    return image;
}

pub fn createFromRgba(allocator: Allocator, pixels: []const u8, width: u32, height: u32, stride: u32) !*Image {
    const row_bytes = std.math.mul(u32, width, 4) catch return error.InvalidArgument;
    if (stride < row_bytes) return error.InvalidArgument;
    const preceding_rows = std.math.mul(u64, stride, height -| 1) catch return error.InvalidArgument;
    const required = std.math.add(u64, preceding_rows, row_bytes) catch return error.InvalidArgument;
    if (required > pixels.len) return error.InvalidArgument;

    const image = try allocateImage(allocator, .{
        .width = width,
        .height = height,
        .source_width = width,
        .source_height = height,
        .format = @intFromEnum(Format.raw_rgba),
        .color_status = @intFromEnum(ColorStatus.explicit_srgb),
        .orientation = 1,
        .has_alpha = 1,
    });
    errdefer image.deinit();
    for (0..height) |y| {
        const src_offset = y * stride;
        const dst_offset = y * row_bytes;
        @memcpy(image.pixels[dst_offset .. dst_offset + row_bytes], pixels[src_offset .. src_offset + row_bytes]);
    }
    return image;
}

pub fn decode(allocator: Allocator, data: []const u8, limits: Limits) !*Image {
    var image_info: Info = .{};
    const probe_status = probeInternal(data, limits, &image_info, false);
    if (probe_status != .ok) return switch (probe_status) {
        .unsupported_format => error.UnsupportedFormat,
        .unsupported_feature => error.UnsupportedFeature,
        .unsupported_color_space => error.UnsupportedColorSpace,
        .dimension_limit => error.DimensionLimit,
        .memory_limit => error.MemoryLimit,
        .out_of_memory => error.OutOfMemory,
        else => error.MalformedInput,
    };

    const source_len = try checkedPixelBytes(image_info.source_width, image_info.source_height, limits);
    const source = try allocator.alloc(u8, source_len);
    var source_owned = true;
    defer if (source_owned) allocator.free(source);
    const format: Format = @enumFromInt(image_info.format);
    const decode_status = switch (format) {
        .png => ot_image_png_decode(
            data.ptr,
            @intCast(data.len),
            source.ptr,
            source.len,
            image_info.source_width,
            image_info.source_height,
        ),
        .gif => ot_image_gif_decode_first_frame(
            data.ptr,
            @intCast(data.len),
            source.ptr,
            source.len,
            image_info.source_width,
            image_info.source_height,
        ),
        .jpeg => ot_image_jpeg_decode(
            data.ptr,
            @intCast(data.len),
            source.ptr,
            source.len,
            image_info.source_width,
            image_info.source_height,
        ),
        .webp => ot_image_webp_decode(
            data.ptr,
            @intCast(data.len),
            source.ptr,
            source.len,
            image_info.source_width,
            image_info.source_height,
        ),
        else => return error.UnsupportedFormat,
    };
    if (decode_status != 0) return switch (decode_status) {
        2 => error.OutOfMemory,
        4 => error.UnsupportedFeature,
        else => error.MalformedInput,
    };

    const color_status: ColorStatus = @enumFromInt(image_info.color_status);
    if (image_info.orientation == 1) {
        const image = try allocator.create(Image);
        image.* = .{
            .allocator = allocator,
            .pixels = source,
            .metadata = .{
                .width = image_info.width,
                .height = image_info.height,
                .source_width = image_info.source_width,
                .source_height = image_info.source_height,
                .format = image_info.format,
                .color_status = @intFromEnum(color_status),
                .orientation = 1,
                .has_alpha = image_info.has_alpha,
            },
        };
        source_owned = false;
        return image;
    }

    const unoriented = Image{
        .allocator = allocator,
        .pixels = source,
        .metadata = .{
            .width = image_info.source_width,
            .height = image_info.source_height,
            .source_width = image_info.source_width,
            .source_height = image_info.source_height,
            .format = image_info.format,
            .color_status = @intFromEnum(color_status),
            .orientation = 1,
            .has_alpha = image_info.has_alpha,
        },
    };
    return try orient(allocator, &unoriented, @intCast(image_info.orientation));
}

fn pixelOffset(width: u32, x: u32, y: u32) usize {
    return (@as(usize, y) * width + x) * 4;
}

fn copyPixel(dst: []u8, dst_width: u32, dx: u32, dy: u32, src: []const u8, src_width: u32, sx: u32, sy: u32) void {
    const dst_offset = pixelOffset(dst_width, dx, dy);
    const src_offset = pixelOffset(src_width, sx, sy);
    @memcpy(dst[dst_offset .. dst_offset + 4], src[src_offset .. src_offset + 4]);
}

fn orient(allocator: Allocator, source: *const Image, orientation: u8) !*Image {
    if (orientation == 1) return source.clone();
    const swap = orientation >= 5 and orientation <= 8;
    var metadata = source.metadata;
    metadata.width = if (swap) source.height() else source.width();
    metadata.height = if (swap) source.width() else source.height();
    metadata.orientation = 1;
    const output = try allocateImage(allocator, metadata);
    errdefer output.deinit();

    for (0..output.height()) |dy_usize| {
        for (0..output.width()) |dx_usize| {
            const dx: u32 = @intCast(dx_usize);
            const dy: u32 = @intCast(dy_usize);
            const coords: [2]u32 = switch (orientation) {
                2 => .{ source.width() - 1 - dx, dy },
                3 => .{ source.width() - 1 - dx, source.height() - 1 - dy },
                4 => .{ dx, source.height() - 1 - dy },
                5 => .{ dy, dx },
                6 => .{ dy, source.height() - 1 - dx },
                7 => .{ source.width() - 1 - dy, source.height() - 1 - dx },
                8 => .{ source.width() - 1 - dy, dx },
                else => return error.InvalidArgument,
            };
            copyPixel(output.pixels, output.width(), dx, dy, source.pixels, source.width(), coords[0], coords[1]);
        }
    }
    return output;
}

pub fn transform(allocator: Allocator, source: *const Image, operation: Transform) !*Image {
    return orient(allocator, source, switch (operation) {
        .rotate_90 => 6,
        .rotate_180 => 3,
        .rotate_270 => 8,
        .flip => 4,
        .flop => 2,
    });
}

pub fn extract(allocator: Allocator, source: *const Image, left: u32, top: u32, width: u32, height: u32) !*Image {
    if (width == 0 or height == 0 or left > source.width() or top > source.height() or
        width > source.width() - left or height > source.height() - top)
    {
        return error.InvalidArgument;
    }
    if (left == 0 and top == 0 and width == source.width() and height == source.height()) return source.clone();

    var metadata = source.metadata;
    metadata.width = width;
    metadata.height = height;
    const output = try allocateImage(allocator, metadata);
    errdefer output.deinit();
    const src_stride = source.width() * 4;
    const dst_stride = width * 4;
    for (0..height) |y| {
        const src_offset = @as(usize, top + @as(u32, @intCast(y))) * src_stride + @as(usize, left) * 4;
        const dst_offset = y * dst_stride;
        @memcpy(output.pixels[dst_offset .. dst_offset + dst_stride], source.pixels[src_offset .. src_offset + dst_stride]);
    }
    return output;
}

pub fn extend(
    allocator: Allocator,
    source: *const Image,
    top: u32,
    right: u32,
    bottom: u32,
    left: u32,
    background: [4]u8,
) !*Image {
    const width = std.math.add(u32, source.width(), left) catch return error.InvalidArgument;
    const final_width = std.math.add(u32, width, right) catch return error.InvalidArgument;
    const height = std.math.add(u32, source.height(), top) catch return error.InvalidArgument;
    const final_height = std.math.add(u32, height, bottom) catch return error.InvalidArgument;
    var metadata = source.metadata;
    metadata.width = final_width;
    metadata.height = final_height;
    if (background[3] < 255) metadata.has_alpha = 1;
    const output = try allocateImage(allocator, metadata);
    errdefer output.deinit();

    var index: usize = 0;
    while (index < output.pixels.len) : (index += 4) @memcpy(output.pixels[index .. index + 4], &background);
    const src_stride = source.width() * 4;
    const dst_stride = final_width * 4;
    for (0..source.height()) |y| {
        const src_offset = y * src_stride;
        const dst_offset = @as(usize, top + @as(u32, @intCast(y))) * dst_stride + @as(usize, left) * 4;
        @memcpy(output.pixels[dst_offset .. dst_offset + src_stride], source.pixels[src_offset .. src_offset + src_stride]);
    }
    return output;
}

pub fn resize(allocator: Allocator, source: *const Image, width: u32, height: u32, filter: ResizeFilter) !*Image {
    if (width == 0 or height == 0) return error.InvalidArgument;
    if (width == source.width() and height == source.height()) return source.clone();
    var metadata = source.metadata;
    metadata.width = width;
    metadata.height = height;
    const output = try allocateImage(allocator, metadata);
    errdefer output.deinit();
    if (ot_image_resize_rgba(
        source.pixels.ptr,
        source.width(),
        source.height(),
        source.width() * 4,
        output.pixels.ptr,
        width,
        height,
        width * 4,
        @intFromEnum(filter),
    ) != 0) return error.OutOfMemory;
    return output;
}

fn srgbToLinear(value: u8) f32 {
    const v: f32 = @as(f32, @floatFromInt(value)) / 255.0;
    return if (v <= 0.04045) v / 12.92 else std.math.pow(f32, (v + 0.055) / 1.055, 2.4);
}

fn linearToSrgb(value: f32) u8 {
    const v = std.math.clamp(value, 0.0, 1.0);
    const encoded = if (v <= 0.0031308) v * 12.92 else 1.055 * std.math.pow(f32, v, 1.0 / 2.4) - 0.055;
    return @intFromFloat(@round(encoded * 255.0));
}

fn blendPixel(dst: *[4]u8, src: *const [4]u8, mode: Blend, opacity: u8) void {
    const opacity_f = @as(f32, @floatFromInt(opacity)) / 255.0;
    const sa = (@as(f32, @floatFromInt(src[3])) / 255.0) * opacity_f;
    const da = @as(f32, @floatFromInt(dst[3])) / 255.0;
    if (mode == .source) {
        dst[0] = src[0];
        dst[1] = src[1];
        dst[2] = src[2];
        dst[3] = @intFromFloat(@round(sa * 255.0));
        return;
    }

    const source_first = mode == .source_over;
    const out_a = if (source_first) sa + da * (1.0 - sa) else da + sa * (1.0 - da);
    for (0..3) |channel| {
        const sp = srgbToLinear(src[channel]) * sa;
        const dp = srgbToLinear(dst[channel]) * da;
        const out_p = if (source_first) sp + dp * (1.0 - sa) else dp + sp * (1.0 - da);
        dst[channel] = if (out_a > 0.0) linearToSrgb(out_p / out_a) else 0;
    }
    dst[3] = @intFromFloat(@round(std.math.clamp(out_a, 0.0, 1.0) * 255.0));
}

pub fn composite(
    allocator: Allocator,
    base: *const Image,
    overlay: *const Image,
    left: i32,
    top: i32,
    mode: Blend,
    opacity: u8,
) !*Image {
    const output = try copyImage(allocator, base.pixels, base.metadata);
    errdefer output.deinit();

    const start_x: u32 = if (left < 0) @intCast(-@as(i64, left)) else 0;
    const start_y: u32 = if (top < 0) @intCast(-@as(i64, top)) else 0;
    const dest_x: u32 = if (left < 0) 0 else @intCast(left);
    const dest_y: u32 = if (top < 0) 0 else @intCast(top);
    if (start_x >= overlay.width() or start_y >= overlay.height() or dest_x >= base.width() or dest_y >= base.height()) return output;
    const copy_width = @min(overlay.width() - start_x, base.width() - dest_x);
    const copy_height = @min(overlay.height() - start_y, base.height() - dest_y);

    for (0..copy_height) |y| {
        for (0..copy_width) |x| {
            const dst_offset = pixelOffset(base.width(), dest_x + @as(u32, @intCast(x)), dest_y + @as(u32, @intCast(y)));
            const src_offset = pixelOffset(overlay.width(), start_x + @as(u32, @intCast(x)), start_y + @as(u32, @intCast(y)));
            const dst: *[4]u8 = @ptrCast(output.pixels[dst_offset .. dst_offset + 4].ptr);
            const src: *const [4]u8 = @ptrCast(overlay.pixels[src_offset .. src_offset + 4].ptr);
            blendPixel(dst, src, mode, opacity);
        }
    }
    return output;
}

pub fn copyPixels(image: *const Image, destination: []u8, stride: u32, bgra: bool) Status {
    const row_bytes = image.width() * 4;
    if (stride < row_bytes) return .invalid_argument;
    const preceding_rows = std.math.mul(u64, stride, image.height() - 1) catch return .invalid_argument;
    const required = std.math.add(u64, preceding_rows, row_bytes) catch return .invalid_argument;
    if (required > destination.len) return .output_too_small;
    for (0..image.height()) |y| {
        const src_offset = y * row_bytes;
        const dst_offset = y * stride;
        if (!bgra) {
            @memcpy(destination[dst_offset .. dst_offset + row_bytes], image.pixels[src_offset .. src_offset + row_bytes]);
            continue;
        }
        for (0..image.width()) |x| {
            const src = src_offset + x * 4;
            const dst = dst_offset + x * 4;
            destination[dst + 0] = image.pixels[src + 2];
            destination[dst + 1] = image.pixels[src + 1];
            destination[dst + 2] = image.pixels[src + 0];
            destination[dst + 3] = image.pixels[src + 3];
        }
    }
    return .ok;
}

test "Exif orientation parser handles little and big endian" {
    const little = [_]u8{ 'I', 'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0 };
    const big = [_]u8{ 'M', 'M', 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 8, 0, 0 };
    try std.testing.expectEqual(@as(u8, 6), parseExifOrientation(&little));
    try std.testing.expectEqual(@as(u8, 8), parseExifOrientation(&big));
}
