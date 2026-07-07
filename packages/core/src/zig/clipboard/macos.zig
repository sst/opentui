const std = @import("std");
const builtin = @import("builtin");
const clipboard_clock = @import("clock.zig");

const Allocator = std.mem.Allocator;
const LOCK_RETRY_SLEEP_NS: u64 = std.time.ns_per_ms;

var pasteboard_mutex: std.Thread.Mutex = .{};

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
    cancelled,
    timed_out,
    failed,

    pub fn deinit(result: *Result, allocator: Allocator) void {
        switch (result.*) {
            .read => |read_result| allocator.free(read_result.data),
            else => {},
        }
        result.* = undefined;
    }
};

pub const Status = enum {
    cancelled,
    timed_out,
    failed,
};

pub const JobError = error{
    InvalidArgument,
    InvalidText,
    LimitExceeded,
    NativeFailure,
    OutOfMemory,
};

pub const ExecuteOptions = struct {
    cancel_requested: ?*const std.atomic.Value(bool) = null,
    begin_mutation: ?*const fn (?*anyopaque) ?Status = null,
    mutation_context: ?*anyopaque = null,
    deadline_ns: i128,
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

pub fn runJob(allocator: Allocator, job: Job, options: ExecuteOptions) JobError!Result {
    return runJobWithMutex(allocator, job, options, &pasteboard_mutex);
}

fn runJobWithMutex(
    allocator: Allocator,
    job: Job,
    options: ExecuteOptions,
    mutex: *std.Thread.Mutex,
) JobError!Result {
    if (!selectionSupported(jobSelection(job))) return .unsupported;
    if (job == .write_text and job.write_text.text.len > std.math.maxInt(u32)) return error.InvalidArgument;
    if (acquireJobLock(mutex, job, options)) |status| return statusResult(status);
    defer mutex.unlock();

    return switch (job) {
        .read => |read_job| read(allocator, read_job, options),
        .write_text => |write_job| writeText(write_job),
        .clear => clear(),
    };
}

fn read(allocator: Allocator, job: ReadJob, options: ExecuteOptions) JobError!Result {
    var iterator = PreferenceIterator.init(job.request) catch return error.InvalidArgument;
    var supported = false;
    while (iterator.next() catch return error.InvalidArgument) |name| {
        if (stopStatus(options)) |status| return statusResult(status);
        const mime: MimeType = if (std.ascii.eqlIgnoreCase(name, "text/plain"))
            .text_plain
        else if (std.ascii.eqlIgnoreCase(name, "image/png"))
            .image_png
        else
            continue;
        supported = true;
        const result = try readMime(allocator, mime, job.max_bytes, options);
        if (result != .empty) return result;
    }
    return if (supported) .empty else .unsupported;
}

fn stopStatus(options: ExecuteOptions) ?Status {
    if (options.cancel_requested) |cancelled| {
        if (cancelled.load(.acquire)) return .cancelled;
    }
    if (options.deadline_ns == std.math.maxInt(i128)) return null;
    if (clipboard_clock.nowNs() >= options.deadline_ns) return .timed_out;
    return null;
}

fn acquirePasteboardLock(mutex: *std.Thread.Mutex, options: ExecuteOptions) ?Status {
    while (true) {
        if (stopStatus(options)) |status| return status;
        if (mutex.tryLock()) {
            if (stopStatus(options)) |status| {
                mutex.unlock();
                return status;
            }
            return null;
        }

        const sleep_ns = if (options.deadline_ns == std.math.maxInt(i128))
            LOCK_RETRY_SLEEP_NS
        else blk: {
            const now_ns = clipboard_clock.nowNs();
            if (now_ns >= options.deadline_ns) return .timed_out;
            const remaining_ns: u64 = @intCast(@min(options.deadline_ns - now_ns, std.math.maxInt(u64)));
            break :blk @min(LOCK_RETRY_SLEEP_NS, remaining_ns);
        };
        std.debug.assert(sleep_ns > 0);
        std.Thread.sleep(sleep_ns);
    }
}

fn acquireJobLock(mutex: *std.Thread.Mutex, job: Job, options: ExecuteOptions) ?Status {
    if (acquirePasteboardLock(mutex, options)) |status| return status;
    if (job != .write_text and job != .clear) return null;
    if (beginMutation(options)) |status| {
        mutex.unlock();
        return status;
    }
    return null;
}

fn readMime(allocator: Allocator, mime: MimeType, max_bytes: u32, options: ExecuteOptions) JobError!Result {
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
    if (postShimStop(options)) |result| return result;
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

fn beginMutation(options: ExecuteOptions) ?Status {
    if (stopStatus(options)) |status| return status;
    const begin = options.begin_mutation orelse return .failed;
    return begin(options.mutation_context);
}

fn postShimStop(options: ExecuteOptions) ?Result {
    const status = stopStatus(options) orelse return null;
    return statusResult(status);
}

fn statusResult(status: Status) Result {
    return switch (status) {
        .cancelled => .cancelled,
        .timed_out => .timed_out,
        .failed => .failed,
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

    const source = @embedFile("macos-shim.m");
    const abi_values = [_][]const u8{
        "OT_CLIPBOARD_MACOS_STATUS_OK = 0",
        "OT_CLIPBOARD_MACOS_STATUS_EMPTY = 1",
        "OT_CLIPBOARD_MACOS_STATUS_LIMIT_EXCEEDED = 2",
        "OT_CLIPBOARD_MACOS_STATUS_INVALID_ARGUMENT = 3",
        "OT_CLIPBOARD_MACOS_STATUS_INVALID_TEXT = 4",
        "OT_CLIPBOARD_MACOS_STATUS_FAILED = 5",
        "OT_CLIPBOARD_MACOS_MIME_TEXT_PLAIN = 1",
        "OT_CLIPBOARD_MACOS_MIME_IMAGE_PNG = 2",
    };
    for (abi_values) |abi_value| {
        try std.testing.expect(std.mem.indexOf(u8, source, abi_value) != null);
    }
}

test "macOS clipboard shim ABI is callable with live AppKit" {
    if (comptime builtin.os.tag != .macos) return error.SkipZigTest;

    var bytes: ?[*]u8 = null;
    var length: u32 = 99;
    var mime: u32 = 99;
    const status = shimStatus(ot_clipboard_macos_read(null, 0, 0, &bytes, &length, &mime));
    try std.testing.expectEqual(ShimStatus.empty, status);
    try std.testing.expect(bytes == null);
    try std.testing.expectEqual(@as(u32, 0), length);
    try std.testing.expectEqual(@as(u32, 0), mime);
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

test "macOS clipboard shim leaves serialization to Zig" {
    const source = @embedFile("macos-shim.m");
    try std.testing.expect(std.mem.indexOf(u8, source, "pthread_mutex") == null);

    const zig_source = @embedFile("macos.zig");
    try std.testing.expect(std.mem.indexOf(u8, zig_source, "var pasteboard_mutex: std.Thread.Mutex") != null);
}

test "macOS clipboard shim distinguishes absent and failed offered types" {
    const source = @embedFile("macos-shim.m");
    const text_offered = std.mem.indexOf(u8, source, "availableTypeFromArray:@[ NSPasteboardTypeString ]").?;
    const text_read = std.mem.indexOf(u8, source, "stringForType:NSPasteboardTypeString").?;
    const png_offered = std.mem.indexOf(u8, source, "availableTypeFromArray:@[ NSPasteboardTypePNG ]").?;
    const png_read = std.mem.indexOf(u8, source, "dataForType:NSPasteboardTypePNG").?;
    try std.testing.expect(text_offered < text_read);
    try std.testing.expect(png_offered < png_read);
    try std.testing.expectEqual(@as(usize, 2), std.mem.count(u8, source, "if (offered_type == nil)"));
    try std.testing.expectEqual(@as(usize, 2), std.mem.count(u8, source, "if (offered_value == nil)"));

    const zig_source = @embedFile("macos.zig");
    const read_start = std.mem.indexOf(u8, zig_source, "fn read(").?;
    const read_end = std.mem.indexOfPos(u8, zig_source, read_start, "fn stopStatus(").?;
    const read_source = zig_source[read_start..read_end];
    try std.testing.expect(std.mem.indexOf(u8, read_source, "const result = try readMime") != null);
    try std.testing.expect(std.mem.indexOf(u8, read_source, "candidate_failed") == null);
}

test "macOS clipboard mutations begin after the job lock" {
    const source = @embedFile("macos.zig");
    const lock_start = std.mem.indexOf(u8, source, "fn acquireJobLock(").?;
    const lock_end = std.mem.indexOfPos(u8, source, lock_start, "fn readMime(").?;
    const lock_source = source[lock_start..lock_end];
    try std.testing.expect(std.mem.indexOf(u8, lock_source, "acquirePasteboardLock").? <
        std.mem.indexOf(u8, lock_source, "beginMutation(options)").?);
}

const TestMutationContext = struct {
    called: bool = false,
};

fn testBeginMutation(context: ?*anyopaque) ?Status {
    const mutation: *TestMutationContext = @ptrCast(@alignCast(context.?));
    mutation.called = true;
    return null;
}

test "macOS clipboard lock contention observes cancellation and deadline" {
    try clipboard_clock.init();
    var mutex: std.Thread.Mutex = .{};
    mutex.lock();
    defer mutex.unlock();

    var cancelled = std.atomic.Value(bool).init(true);
    try std.testing.expectEqual(
        Status.cancelled,
        acquirePasteboardLock(&mutex, .{
            .cancel_requested = &cancelled,
            .deadline_ns = std.math.maxInt(i128),
        }).?,
    );
    cancelled.store(false, .release);
    try std.testing.expectEqual(
        Status.timed_out,
        acquirePasteboardLock(&mutex, .{
            .cancel_requested = &cancelled,
            .deadline_ns = clipboard_clock.nowNs(),
        }).?,
    );
}

test "macOS clipboard mutation callback is not called before the lock" {
    try clipboard_clock.init();
    var mutex: std.Thread.Mutex = .{};
    mutex.lock();
    defer mutex.unlock();
    var cancelled = std.atomic.Value(bool).init(true);
    var mutation = TestMutationContext{};

    const status = acquireJobLock(
        &mutex,
        .{ .write_text = .{ .text = "text" } },
        .{
            .cancel_requested = &cancelled,
            .begin_mutation = testBeginMutation,
            .mutation_context = &mutation,
            .deadline_ns = std.math.maxInt(i128),
        },
    );
    try std.testing.expectEqual(Status.cancelled, status.?);
    try std.testing.expect(!mutation.called);
}

test "macOS clipboard post-shim stop maps exact terminal status" {
    try clipboard_clock.init();
    var cancelled = std.atomic.Value(bool).init(true);
    try std.testing.expect(postShimStop(.{
        .cancel_requested = &cancelled,
        .deadline_ns = std.math.maxInt(i128),
    }).? == .cancelled);

    cancelled.store(false, .release);
    try std.testing.expect(postShimStop(.{
        .cancel_requested = &cancelled,
        .deadline_ns = clipboard_clock.nowNs(),
    }).? == .timed_out);
}
