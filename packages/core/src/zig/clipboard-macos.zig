const std = @import("std");

const Allocator = std.mem.Allocator;

pub const Selection = enum(u32) {
    clipboard = 0,
    primary = 1,
};

pub const MimeType = enum(u32) {
    text_plain = 1,
    image_png = 2,

    pub fn name(mime: MimeType) []const u8 {
        return switch (mime) {
            .text_plain => "text/plain",
            .image_png => "image/png",
        };
    }
};

pub const ReadJob = struct {
    selection: Selection = .clipboard,
    request: []const u8,
    max_bytes: u32,
};

pub const WriteTextJob = struct {
    selection: Selection = .clipboard,
    text: []const u8,
};

pub const ClearJob = struct {
    selection: Selection = .clipboard,
};

pub const Job = union(enum) {
    read: ReadJob,
    write_text: WriteTextJob,
    clear: ClearJob,
};

pub const ReadResult = struct {
    mime: MimeType,
    data: []u8,
};

pub const Result = union(enum) {
    read: ReadResult,
    empty,
    written,
    cleared,
    unsupported,

    pub fn deinit(result: *Result, allocator: Allocator) void {
        switch (result.*) {
            .read => |read_result| allocator.free(read_result.data),
            else => {},
        }
        result.* = undefined;
    }
};

pub const JobError = error{
    InvalidArgument,
    InvalidText,
    LimitExceeded,
    NativeFailure,
    OutOfMemory,
};

const ShimStatus = enum(i32) {
    ok = 0,
    empty = 1,
    limit_exceeded = 2,
    invalid_argument = 3,
    invalid_text = 4,
    failed = 5,
};

extern fn ot_clipboard_macos_read(
    preferred: ?[*]const u32,
    preferred_count: u32,
    max_bytes: u32,
    out_bytes: *?[*]u8,
    out_length: *u32,
    out_mime: *u32,
) i32;
extern fn ot_clipboard_macos_write_text(bytes: ?[*]const u8, length: u32) i32;
extern fn ot_clipboard_macos_clear() i32;
extern fn ot_clipboard_macos_free_bytes(bytes: ?[*]u8, length: u32) void;

comptime {
    std.debug.assert(@sizeOf(Selection) == @sizeOf(u32));
    std.debug.assert(@sizeOf(MimeType) == @sizeOf(u32));
}

// Jobs are synchronous and must be serialized by the owning service worker.
pub fn runJob(allocator: Allocator, job: Job) JobError!Result {
    if (!selectionSupported(jobSelection(job))) return .unsupported;

    return switch (job) {
        .read => |read_job| read(allocator, read_job),
        .write_text => |write_job| writeText(write_job),
        .clear => clear(),
    };
}

fn read(allocator: Allocator, job: ReadJob) JobError!Result {
    var iterator = PreferenceIterator.init(job.request) catch return error.InvalidArgument;
    var supported = false;
    while (iterator.next() catch return error.InvalidArgument) |name| {
        const mime: MimeType = if (std.ascii.eqlIgnoreCase(name, "text/plain"))
            .text_plain
        else if (std.ascii.eqlIgnoreCase(name, "image/png"))
            .image_png
        else
            continue;
        supported = true;
        const result = try readMime(allocator, mime, job.max_bytes);
        if (result != .empty) return result;
    }
    return if (supported) .empty else .unsupported;
}

fn readMime(allocator: Allocator, mime: MimeType, max_bytes: u32) JobError!Result {
    const preferred = [_]u32{@intFromEnum(mime)};

    var shim_bytes: ?[*]u8 = null;
    var length: u32 = 0;
    var mime_value: u32 = 0;
    const status = shimStatus(ot_clipboard_macos_read(
        &preferred,
        preferred.len,
        max_bytes,
        &shim_bytes,
        &length,
        &mime_value,
    ));

    switch (status) {
        .empty => return .empty,
        .limit_exceeded => return error.LimitExceeded,
        .invalid_argument => return error.InvalidArgument,
        .invalid_text => return error.NativeFailure,
        .failed => return error.NativeFailure,
        .ok => {},
    }

    defer ot_clipboard_macos_free_bytes(shim_bytes, length);
    if (length > max_bytes) return error.NativeFailure;
    const returned_mime = std.meta.intToEnum(MimeType, mime_value) catch return error.NativeFailure;
    if (returned_mime != mime) return error.NativeFailure;
    const source: []const u8 = if (length == 0)
        ""
    else
        (shim_bytes orelse return error.NativeFailure)[0..length];
    const data = allocator.dupe(u8, source) catch return error.OutOfMemory;
    return .{ .read = .{ .mime = returned_mime, .data = data } };
}

const PreferenceIterator = struct {
    request: []const u8,
    count: u32,
    index: u32 = 0,
    offset: usize = 4,

    fn init(request: []const u8) error{InvalidRequest}!PreferenceIterator {
        if (request.len < 4) return error.InvalidRequest;
        const count = std.mem.readInt(u32, request[0..4], .little);
        if (count == 0) return error.InvalidRequest;
        return .{ .request = request, .count = count };
    }

    fn next(iterator: *PreferenceIterator) error{InvalidRequest}!?[]const u8 {
        if (iterator.index == iterator.count) {
            if (iterator.offset != iterator.request.len) return error.InvalidRequest;
            return null;
        }
        if (iterator.request.len - iterator.offset < 4) return error.InvalidRequest;
        const length = std.mem.readInt(u32, iterator.request[iterator.offset..][0..4], .little);
        iterator.offset += 4;
        if (length == 0 or length > iterator.request.len - iterator.offset) return error.InvalidRequest;
        const mime = iterator.request[iterator.offset..][0..length];
        iterator.offset += length;
        iterator.index += 1;
        return mime;
    }
};

fn writeText(job: WriteTextJob) JobError!Result {
    if (job.text.len > std.math.maxInt(u32)) return error.InvalidArgument;
    const bytes: ?[*]const u8 = if (job.text.len == 0) null else job.text.ptr;
    return switch (shimStatus(ot_clipboard_macos_write_text(bytes, @intCast(job.text.len)))) {
        .ok => .written,
        .invalid_argument => error.InvalidArgument,
        .invalid_text => error.InvalidText,
        .empty, .limit_exceeded, .failed => error.NativeFailure,
    };
}

fn clear() JobError!Result {
    return switch (shimStatus(ot_clipboard_macos_clear())) {
        .ok => .cleared,
        .invalid_argument => error.InvalidArgument,
        .empty, .limit_exceeded, .invalid_text, .failed => error.NativeFailure,
    };
}

fn shimStatus(value: i32) ShimStatus {
    return std.meta.intToEnum(ShimStatus, value) catch .failed;
}

fn jobSelection(job: Job) Selection {
    return switch (job) {
        .read => |read_job| read_job.selection,
        .write_text => |write_job| write_job.selection,
        .clear => |clear_job| clear_job.selection,
    };
}

fn selectionSupported(selection: Selection) bool {
    return selection == .clipboard;
}

test "macOS clipboard ABI values are stable" {
    try std.testing.expectEqual(@as(u32, 0), @intFromEnum(Selection.clipboard));
    try std.testing.expectEqual(@as(u32, 1), @intFromEnum(Selection.primary));
    try std.testing.expectEqual(@as(u32, 1), @intFromEnum(MimeType.text_plain));
    try std.testing.expectEqual(@as(u32, 2), @intFromEnum(MimeType.image_png));
    try std.testing.expectEqual(@as(i32, 5), @intFromEnum(ShimStatus.failed));
}

test "macOS clipboard MIME names are exact" {
    try std.testing.expectEqualStrings("text/plain", MimeType.text_plain.name());
    try std.testing.expectEqualStrings("image/png", MimeType.image_png.name());
}

test "macOS clipboard jobs expose their selection" {
    try std.testing.expectEqual(
        Selection.primary,
        jobSelection(.{ .read = .{ .selection = .primary, .request = "", .max_bytes = 16 } }),
    );
    try std.testing.expectEqual(
        Selection.clipboard,
        jobSelection(.{ .write_text = .{ .text = "text" } }),
    );
    try std.testing.expectEqual(
        Selection.primary,
        jobSelection(.{ .clear = .{ .selection = .primary } }),
    );
    try std.testing.expect(selectionSupported(.clipboard));
    try std.testing.expect(!selectionSupported(.primary));
}

test "macOS clipboard MIME request parsing preserves order" {
    const request = [_]u8{ 2, 0, 0, 0, 9, 0, 0, 0 } ++ "image/png".* ++
        [_]u8{ 10, 0, 0, 0 } ++ "text/plain".*;
    var iterator = try PreferenceIterator.init(&request);
    try std.testing.expectEqualStrings("image/png", (try iterator.next()).?);
    try std.testing.expectEqualStrings("text/plain", (try iterator.next()).?);
    try std.testing.expect((try iterator.next()) == null);
}

test "macOS clipboard read results have explicit allocator ownership" {
    var result: Result = .{ .read = .{
        .mime = .image_png,
        .data = try std.testing.allocator.dupe(u8, &.{ 0x89, 0x50, 0x4e, 0x47 }),
    } };
    result.deinit(std.testing.allocator);
}
