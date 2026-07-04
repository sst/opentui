const std = @import("std");
const builtin = @import("builtin");

const Allocator = std.mem.Allocator;

const CF_UNICODETEXT: u32 = 13;
const COINIT_APARTMENTTHREADED: u32 = 0x2;
const GMEM_MOVEABLE: u32 = 0x2;
const OPEN_RETRY_SLEEP_NS_DEFAULT: u64 = 5 * std.time.ns_per_ms;
const ERROR_OUTOFMEMORY: u32 = 14;
const ERROR_INVALID_DATA: u32 = 13;
const ERROR_INVALID_PARAMETER: u32 = 87;
const PM_REMOVE: u32 = 1;

const win32 = struct {
    const Point = extern struct { x: i32, y: i32 };
    const Message = extern struct {
        window: ?*anyopaque,
        message: u32,
        wparam: usize,
        lparam: isize,
        time: u32,
        point: Point,
        private: u32,
    };

    extern "ole32" fn CoInitializeEx(reserved: ?*anyopaque, coinit: u32) callconv(.winapi) i32;
    extern "ole32" fn CoUninitialize() callconv(.winapi) void;

    extern "user32" fn OpenClipboard(owner: ?*anyopaque) callconv(.winapi) i32;
    extern "user32" fn CloseClipboard() callconv(.winapi) i32;
    extern "user32" fn EmptyClipboard() callconv(.winapi) i32;
    extern "user32" fn GetClipboardData(format: u32) callconv(.winapi) ?*anyopaque;
    extern "user32" fn IsClipboardFormatAvailable(format: u32) callconv(.winapi) i32;
    extern "user32" fn RegisterClipboardFormatW(name: [*:0]const u16) callconv(.winapi) u32;
    extern "user32" fn SetClipboardData(format: u32, memory: ?*anyopaque) callconv(.winapi) ?*anyopaque;
    extern "user32" fn PeekMessageW(message: *Message, window: ?*anyopaque, minimum: u32, maximum: u32, remove: u32) callconv(.winapi) i32;
    extern "user32" fn TranslateMessage(message: *const Message) callconv(.winapi) i32;
    extern "user32" fn DispatchMessageW(message: *const Message) callconv(.winapi) isize;
    extern "user32" fn CreateWindowExW(
        extended_style: u32,
        class_name: [*:0]const u16,
        window_name: [*:0]const u16,
        style: u32,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        parent: ?*anyopaque,
        menu: ?*anyopaque,
        instance: ?*anyopaque,
        parameter: ?*anyopaque,
    ) callconv(.winapi) ?*anyopaque;
    extern "user32" fn DestroyWindow(window: *anyopaque) callconv(.winapi) i32;

    extern "kernel32" fn GetCurrentThreadId() callconv(.winapi) u32;
    extern "kernel32" fn GetLastError() callconv(.winapi) u32;
    extern "kernel32" fn GlobalAlloc(flags: u32, size_bytes: usize) callconv(.winapi) ?*anyopaque;
    extern "kernel32" fn GlobalFree(memory: ?*anyopaque) callconv(.winapi) ?*anyopaque;
    extern "kernel32" fn GlobalLock(memory: ?*anyopaque) callconv(.winapi) ?*anyopaque;
    extern "kernel32" fn GlobalSize(memory: ?*anyopaque) callconv(.winapi) usize;
    extern "kernel32" fn GlobalUnlock(memory: ?*anyopaque) callconv(.winapi) i32;
};

pub const Status = enum {
    read,
    empty,
    written,
    cleared,
    unsupported,
    cancelled,
    timed_out,
    limit_exceeded,
    invalid_request,
    failed,
};

pub const Result = struct {
    status: Status,
    mime: []u8 = &.{},
    data: []u8 = &.{},
    error_code: u32 = 0,

    pub fn deinit(result: *Result, allocator: Allocator) void {
        if (result.status == .read) {
            allocator.free(result.mime);
            allocator.free(result.data);
        }
        result.* = .{ .status = .failed };
    }
};

pub const ReadJob = struct {
    // Same framing as clipboard.zig: u32 count, then repeated u32 byte length and MIME bytes.
    request: []const u8,
    max_bytes: u32,
};

pub const WriteJob = struct {
    mime: []const u8,
    data: []const u8,
};

pub const Job = union(enum) {
    read: ReadJob,
    write: WriteJob,
    clear,
};

pub const ExecuteOptions = struct {
    cancel_requested: ?*const std.atomic.Value(bool) = null,
    deadline_ns: i128,
    open_retry_sleep_ns: u64 = OPEN_RETRY_SLEEP_NS_DEFAULT,
};

pub const InitError = error{
    UnsupportedPlatform,
    ApartmentInitializationFailed,
    ClipboardFormatRegistrationFailed,
    WindowCreationFailed,
};

pub const Worker = struct {
    thread_id: u32,
    png_format: u32,
    owner_window: *anyopaque,
    initialized: bool,

    pub fn init() InitError!Worker {
        if (comptime builtin.os.tag != .windows) return error.UnsupportedPlatform;

        const hresult = win32.CoInitializeEx(null, COINIT_APARTMENTTHREADED);
        if (hresult < 0) return error.ApartmentInitializationFailed;
        errdefer win32.CoUninitialize();

        const png_format = win32.RegisterClipboardFormatW(std.unicode.utf8ToUtf16LeStringLiteral("PNG"));
        if (png_format == 0) return error.ClipboardFormatRegistrationFailed;
        const owner_window = win32.CreateWindowExW(
            0,
            std.unicode.utf8ToUtf16LeStringLiteral("STATIC"),
            std.unicode.utf8ToUtf16LeStringLiteral("OpenTUI Clipboard"),
            0,
            0,
            0,
            0,
            0,
            null,
            null,
            null,
            null,
        ) orelse return error.WindowCreationFailed;
        return .{
            .thread_id = win32.GetCurrentThreadId(),
            .png_format = png_format,
            .owner_window = owner_window,
            .initialized = true,
        };
    }

    pub fn deinit(worker: *Worker) void {
        if (comptime builtin.os.tag != .windows) return;
        std.debug.assert(worker.initialized);
        std.debug.assert(worker.thread_id == win32.GetCurrentThreadId());
        std.debug.assert(win32.DestroyWindow(worker.owner_window) != 0);
        worker.initialized = false;
        win32.CoUninitialize();
    }

    pub fn execute(worker: *Worker, allocator: Allocator, job: Job, options: ExecuteOptions) Result {
        if (comptime builtin.os.tag != .windows) return .{ .status = .unsupported };
        std.debug.assert(worker.initialized);
        std.debug.assert(worker.thread_id == win32.GetCurrentThreadId());

        if (options.open_retry_sleep_ns == 0) {
            return .{ .status = .invalid_request, .error_code = ERROR_INVALID_PARAMETER };
        }
        if (job == .read and !validateReadRequest(job.read.request)) {
            return .{ .status = .invalid_request, .error_code = ERROR_INVALID_DATA };
        }

        var prepared: ?PreparedWrite = null;
        if (job == .write) {
            prepared = prepareWrite(allocator, worker.png_format, job.write) catch |err| {
                return preparationFailure(err);
            };
            if (prepared == null) return .{ .status = .unsupported };
        }
        defer if (prepared) |*write| write.deinit();

        if (checkStop(options)) |status| return .{ .status = status };
        if (openClipboard(worker.owner_window, options)) |failure| return failure;
        defer _ = win32.CloseClipboard();
        if (checkStop(options)) |status| return .{ .status = status };

        return switch (job) {
            .read => |read| worker.executeRead(allocator, read),
            .write => worker.executeWrite(&prepared.?),
            .clear => executeClear(),
        };
    }

    pub fn pumpMessages(worker: *const Worker) void {
        if (comptime builtin.os.tag != .windows) return;
        std.debug.assert(worker.initialized);
        std.debug.assert(worker.thread_id == win32.GetCurrentThreadId());
        var message: win32.Message = undefined;
        while (win32.PeekMessageW(&message, null, 0, 0, PM_REMOVE) != 0) {
            _ = win32.TranslateMessage(&message);
            _ = win32.DispatchMessageW(&message);
        }
    }

    fn executeRead(worker: *const Worker, allocator: Allocator, job: ReadJob) Result {
        var iterator = PreferenceIterator.init(job.request) catch unreachable;
        var supported = false;
        while (iterator.next() catch unreachable) |mime| {
            const format = worker.formatForMime(mime) orelse continue;
            supported = true;
            if (win32.IsClipboardFormatAvailable(format) == 0) continue;
            if (format == CF_UNICODETEXT) return readText(allocator, mime, job.max_bytes);
            const result = readBytes(allocator, mime, format, job.max_bytes);
            if (result.status != .empty) return result;
        }
        return .{ .status = if (supported) .empty else .unsupported };
    }

    fn executeWrite(_: *const Worker, prepared: *PreparedWrite) Result {
        if (win32.EmptyClipboard() == 0) return lastErrorResult();
        const memory = prepared.memory orelse unreachable;
        if (win32.SetClipboardData(prepared.format, memory) == null) return lastErrorResult();
        prepared.memory = null; // SetClipboardData owns the HGLOBAL after success.
        return .{ .status = .written };
    }

    fn formatForMime(worker: *const Worker, mime: []const u8) ?u32 {
        if (std.ascii.eqlIgnoreCase(mime, "text/plain")) return CF_UNICODETEXT;
        if (std.ascii.eqlIgnoreCase(mime, "image/png")) return worker.png_format;
        return null;
    }
};

const PreparedWrite = struct {
    format: u32,
    memory: ?*anyopaque,

    fn deinit(prepared: *PreparedWrite) void {
        if (prepared.memory) |memory| std.debug.assert(win32.GlobalFree(memory) == null);
        prepared.memory = null;
    }
};

const PreferenceIterator = struct {
    request: []const u8,
    count: u32,
    index: u32 = 0,
    offset: usize = 4,

    fn init(request: []const u8) error{InvalidRequest}!PreferenceIterator {
        if (!validateReadRequest(request)) return error.InvalidRequest;
        return .{ .request = request, .count = std.mem.readInt(u32, request[0..4], .little) };
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

const ConversionError = error{
    InvalidUtf8,
    InvalidUtf16,
    EmbeddedNul,
    MissingNul,
    LimitExceeded,
    OutOfMemory,
};

fn validateReadRequest(request: []const u8) bool {
    if (request.len < 4) return false;
    const count = std.mem.readInt(u32, request[0..4], .little);
    if (count == 0) return false;
    var iterator = PreferenceIterator{
        .request = request,
        .count = count,
    };
    while (iterator.next() catch return false) |_| {}
    return true;
}

fn utf8ToClipboardText(allocator: Allocator, utf8: []const u8) ConversionError![:0]u16 {
    var extra_bytes: usize = 0;
    var index: usize = 0;
    while (index < utf8.len) {
        const byte = utf8[index];
        if (byte == 0) return error.EmbeddedNul;
        if (byte == '\r') {
            if (index + 1 < utf8.len and utf8[index + 1] == '\n') {
                index += 2;
            } else {
                index += 1;
                extra_bytes = std.math.add(usize, extra_bytes, 1) catch return error.LimitExceeded;
            }
        } else if (byte == '\n') {
            index += 1;
            extra_bytes = std.math.add(usize, extra_bytes, 1) catch return error.LimitExceeded;
        } else {
            index += 1;
        }
    }

    var normalized: ?[]u8 = null;
    defer if (normalized) |bytes| allocator.free(bytes);

    if (extra_bytes > 0) {
        const normalized_len = std.math.add(usize, utf8.len, extra_bytes) catch return error.LimitExceeded;
        const normalized_bytes = allocator.alloc(u8, normalized_len) catch return error.OutOfMemory;
        normalized = normalized_bytes;

        index = 0;
        var output_index: usize = 0;
        while (index < utf8.len) {
            const byte = utf8[index];
            if (byte == '\r') {
                normalized_bytes[output_index] = '\r';
                output_index += 1;
                if (index + 1 < utf8.len and utf8[index + 1] == '\n') {
                    normalized_bytes[output_index] = '\n';
                    output_index += 1;
                    index += 2;
                } else {
                    normalized_bytes[output_index] = '\n';
                    output_index += 1;
                    index += 1;
                }
            } else if (byte == '\n') {
                normalized_bytes[output_index] = '\r';
                normalized_bytes[output_index + 1] = '\n';
                output_index += 2;
                index += 1;
            } else {
                normalized_bytes[output_index] = byte;
                output_index += 1;
                index += 1;
            }
        }
        std.debug.assert(output_index == normalized_bytes.len);
    }

    return std.unicode.utf8ToUtf16LeAllocZ(allocator, normalized orelse utf8) catch |err| switch (err) {
        error.InvalidUtf8 => error.InvalidUtf8,
        error.OutOfMemory => error.OutOfMemory,
    };
}

fn clipboardTextToUtf8(allocator: Allocator, utf16: []const u16, max_bytes: u32) ConversionError![]u8 {
    const nul_index = std.mem.indexOfScalar(u16, utf16, 0) orelse return error.MissingNul;
    const text = utf16[0..nul_index];
    var iterator = std.unicode.Utf16LeIterator.init(text);
    var size_bytes: usize = 0;
    while (iterator.nextCodepoint() catch return error.InvalidUtf16) |codepoint| {
        const sequence_length = std.unicode.utf8CodepointSequenceLength(codepoint) catch unreachable;
        size_bytes = std.math.add(usize, size_bytes, sequence_length) catch return error.LimitExceeded;
        if (size_bytes > max_bytes) return error.LimitExceeded;
    }

    const output = try allocator.alloc(u8, size_bytes);
    errdefer allocator.free(output);
    iterator = std.unicode.Utf16LeIterator.init(text);
    var offset: usize = 0;
    while (iterator.nextCodepoint() catch unreachable) |codepoint| {
        offset += std.unicode.utf8Encode(codepoint, output[offset..]) catch unreachable;
    }
    std.debug.assert(offset == output.len);
    return output;
}

fn prepareWrite(allocator: Allocator, png_format: u32, job: WriteJob) ConversionError!?PreparedWrite {
    if (std.ascii.eqlIgnoreCase(job.mime, "text/plain")) {
        const utf16 = try utf8ToClipboardText(allocator, job.data);
        defer allocator.free(utf16);
        const size_bytes = std.math.mul(usize, utf16.len + 1, @sizeOf(u16)) catch return error.LimitExceeded;
        const memory = win32.GlobalAlloc(GMEM_MOVEABLE, size_bytes) orelse return error.OutOfMemory;
        errdefer std.debug.assert(win32.GlobalFree(memory) == null);
        const pointer = win32.GlobalLock(memory) orelse return error.OutOfMemory;
        defer _ = win32.GlobalUnlock(memory);
        const destination: [*]u16 = @ptrCast(@alignCast(pointer));
        @memcpy(destination[0 .. utf16.len + 1], utf16.ptr[0 .. utf16.len + 1]);
        return .{ .format = CF_UNICODETEXT, .memory = memory };
    }
    if (!std.ascii.eqlIgnoreCase(job.mime, "image/png")) return null;
    if (job.data.len == 0) return error.InvalidUtf8;
    const memory = win32.GlobalAlloc(GMEM_MOVEABLE, job.data.len) orelse return error.OutOfMemory;
    errdefer std.debug.assert(win32.GlobalFree(memory) == null);
    const pointer = win32.GlobalLock(memory) orelse return error.OutOfMemory;
    defer _ = win32.GlobalUnlock(memory);
    const destination: [*]u8 = @ptrCast(pointer);
    @memcpy(destination[0..job.data.len], job.data);
    return .{ .format = png_format, .memory = memory };
}

fn preparationFailure(err: ConversionError) Result {
    return switch (err) {
        error.OutOfMemory => .{ .status = .failed, .error_code = ERROR_OUTOFMEMORY },
        error.LimitExceeded => .{ .status = .limit_exceeded },
        error.InvalidUtf8, error.InvalidUtf16, error.EmbeddedNul, error.MissingNul => .{ .status = .invalid_request, .error_code = ERROR_INVALID_DATA },
    };
}

fn openClipboard(owner_window: *anyopaque, options: ExecuteOptions) ?Result {
    while (true) {
        if (checkStop(options)) |status| return .{ .status = status };
        if (win32.OpenClipboard(owner_window) != 0) return null;

        const now_ns = std.time.nanoTimestamp();
        if (now_ns >= options.deadline_ns) return .{ .status = .timed_out };
        const remaining_ns: u64 = @intCast(@min(options.deadline_ns - now_ns, std.math.maxInt(u64)));
        std.Thread.sleep(@min(options.open_retry_sleep_ns, remaining_ns));
    }
}

fn checkStop(options: ExecuteOptions) ?Status {
    if (options.cancel_requested) |cancelled| {
        if (cancelled.load(.acquire)) return .cancelled;
    }
    if (std.time.nanoTimestamp() >= options.deadline_ns) return .timed_out;
    return null;
}

fn executeClear() Result {
    if (win32.EmptyClipboard() == 0) return lastErrorResult();
    return .{ .status = .cleared };
}

fn readText(allocator: Allocator, mime: []const u8, max_bytes: u32) Result {
    const memory = win32.GetClipboardData(CF_UNICODETEXT) orelse return lastErrorResult();
    const size_bytes = win32.GlobalSize(memory);
    if (size_bytes < @sizeOf(u16) or size_bytes % @sizeOf(u16) != 0) {
        return .{ .status = .failed, .error_code = ERROR_INVALID_DATA };
    }
    const pointer = win32.GlobalLock(memory) orelse return lastErrorResult();
    defer _ = win32.GlobalUnlock(memory);
    const utf16_pointer: [*]const u16 = @ptrCast(@alignCast(pointer));
    const data = clipboardTextToUtf8(allocator, utf16_pointer[0 .. size_bytes / 2], max_bytes) catch |err| {
        return switch (err) {
            error.LimitExceeded => .{ .status = .limit_exceeded },
            error.OutOfMemory => .{ .status = .failed, .error_code = ERROR_OUTOFMEMORY },
            else => .{ .status = .failed, .error_code = ERROR_INVALID_DATA },
        };
    };
    return readResult(allocator, mime, data);
}

fn readBytes(allocator: Allocator, mime: []const u8, format: u32, max_bytes: u32) Result {
    const memory = win32.GetClipboardData(format) orelse return lastErrorResult();
    const size_bytes = win32.GlobalSize(memory);
    if (size_bytes == 0) return .{ .status = .empty };
    if (size_bytes > max_bytes) return .{ .status = .limit_exceeded };
    const pointer = win32.GlobalLock(memory) orelse return lastErrorResult();
    defer _ = win32.GlobalUnlock(memory);
    const source: [*]const u8 = @ptrCast(pointer);
    const data = allocator.dupe(u8, source[0..size_bytes]) catch {
        return .{ .status = .failed, .error_code = ERROR_OUTOFMEMORY };
    };
    return readResult(allocator, mime, data);
}

fn readResult(allocator: Allocator, mime: []const u8, data: []u8) Result {
    const owned_mime = allocator.dupe(u8, mime) catch {
        allocator.free(data);
        return .{ .status = .failed, .error_code = ERROR_OUTOFMEMORY };
    };
    return .{ .status = .read, .mime = owned_mime, .data = data };
}

fn lastErrorResult() Result {
    return .{ .status = .failed, .error_code = win32.GetLastError() };
}

test "Windows clipboard worker API paths compile without mutating the clipboard" {
    if (comptime builtin.os.tag != .windows) return error.SkipZigTest;
    var worker = Worker{
        .thread_id = win32.GetCurrentThreadId(),
        .png_format = 1,
        .owner_window = undefined,
        .initialized = true,
    };
    const result = worker.execute(std.testing.allocator, .clear, .{
        .deadline_ns = std.time.nanoTimestamp() - 1,
    });
    try std.testing.expectEqual(Status.timed_out, result.status);
}

test "Windows clipboard MIME request parsing preserves preference order" {
    const request = [_]u8{
        3,   0,   0,   0,
        9,   0,   0,   0,
        'i', 'm', 'a', 'g',
        'e', '/', 'p', 'n',
        'g', 10,  0,   0,
        0,   't', 'e', 'x',
        't', '/', 'p', 'l',
        'a', 'i', 'n', 3,
        0,   0,   0,   'f',
        'o', 'o',
    };
    var iterator = try PreferenceIterator.init(&request);
    try std.testing.expectEqualStrings("image/png", (try iterator.next()).?);
    try std.testing.expectEqualStrings("text/plain", (try iterator.next()).?);
    try std.testing.expectEqualStrings("foo", (try iterator.next()).?);
    try std.testing.expect((try iterator.next()) == null);
}

test "Windows clipboard MIME request parsing rejects malformed framing" {
    try std.testing.expect(!validateReadRequest(&.{ 0, 0, 0, 0 }));
    try std.testing.expect(!validateReadRequest(&.{ 1, 0, 0, 0, 0, 0, 0, 0 }));
    try std.testing.expect(!validateReadRequest(&.{ 1, 0, 0, 0, 2, 0, 0, 0, 'x' }));
    try std.testing.expect(!validateReadRequest(&.{ 1, 0, 0, 0, 1, 0, 0, 0, 'x', 'y' }));
}

test "Windows clipboard text conversion round trips Unicode and terminates UTF-16" {
    const utf16 = try utf8ToClipboardText(std.testing.allocator, "plain \u{1f642}");
    defer std.testing.allocator.free(utf16);
    try std.testing.expectEqual(@as(u16, 0), utf16[utf16.len]);

    const utf8 = try clipboardTextToUtf8(std.testing.allocator, utf16.ptr[0 .. utf16.len + 1], 64);
    defer std.testing.allocator.free(utf8);
    try std.testing.expectEqualStrings("plain \u{1f642}", utf8);
}

test "Windows clipboard text conversion normalizes CF_UNICODETEXT line endings" {
    const utf16 = try utf8ToClipboardText(std.testing.allocator, "a\nb\r\nc\rd");
    defer std.testing.allocator.free(utf16);
    const utf8 = try clipboardTextToUtf8(std.testing.allocator, utf16.ptr[0 .. utf16.len + 1], 64);
    defer std.testing.allocator.free(utf8);
    try std.testing.expectEqualStrings("a\r\nb\r\nc\r\nd", utf8);
}

test "Windows clipboard text conversion validates NUL UTF-16 and size" {
    try std.testing.expectError(error.EmbeddedNul, utf8ToClipboardText(std.testing.allocator, "a\x00b"));
    try std.testing.expectError(
        error.MissingNul,
        clipboardTextToUtf8(std.testing.allocator, &.{ 'a', 'b' }, 8),
    );
    try std.testing.expectError(
        error.InvalidUtf16,
        clipboardTextToUtf8(std.testing.allocator, &.{ 0xd800, 0 }, 8),
    );
    try std.testing.expectError(
        error.LimitExceeded,
        clipboardTextToUtf8(std.testing.allocator, &.{ 'a', 'b', 0 }, 1),
    );
}
