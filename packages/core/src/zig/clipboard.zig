const std = @import("std");
const builtin = @import("builtin");
const handles = @import("handles.zig");

const Allocator = std.mem.Allocator;
pub const Handle = handles.Handle;

pub const OperationStatus = enum(u8) {
    pending = 0,
    read = 1,
    empty = 2,
    written = 3,
    cleared = 4,
    unsupported = 5,
    cancelled = 6,
    timed_out = 7,
    limit_exceeded = 8,
    failed = 9,
    invalid_handle = 10,
};

pub const StartStatus = enum(u8) {
    ok = 0,
    invalid_service = 1,
    shutting_down = 2,
    limit_exceeded = 3,
    invalid_argument = 4,
    out_of_memory = 5,
    worker_start_failed = 6,
};

pub const CancelStatus = enum(u8) {
    requested = 0,
    already_terminal = 1,
    invalid_handle = 2,
};

pub const CopyStatus = enum(u8) {
    ok = 0,
    buffer_too_small = 1,
    invalid_handle = 2,
    invalid_state = 3,
    invalid_argument = 4,
};

pub const DestroyStatus = enum(u8) {
    destroyed = 0,
    not_ready = 1,
    invalid_handle = 2,
};

pub const ShutdownStatus = enum(u8) {
    pending = 0,
    ready = 1,
    invalid_handle = 2,
};

const TEST_MIME = "application/octet-stream";
const ResultKind = enum { mime, data, diagnostic };

extern "c" fn pthread_mach_thread_np(thread: std.c.pthread_t) std.c.mach_port_t;
extern "c" fn pthread_tryjoin_np(thread: std.Thread.Handle, result: ?*?*anyopaque) c_int;

fn tryJoinThread(thread: std.Thread) bool {
    return switch (builtin.os.tag) {
        .linux => switch (pthread_tryjoin_np(thread.getHandle(), null)) {
            0 => true,
            @intFromEnum(std.posix.E.BUSY) => false,
            else => false,
        },
        .windows => blk: {
            std.os.windows.WaitForSingleObject(thread.getHandle(), 0) catch |err| switch (err) {
                error.WaitTimeOut => break :blk false,
                else => break :blk false,
            };
            thread.join();
            break :blk true;
        },
        .macos => blk: {
            var info: std.c.thread_basic_info = undefined;
            var count = std.c.THREAD_BASIC_INFO_COUNT;
            const result = std.c.thread_info(
                pthread_mach_thread_np(thread.getHandle()),
                std.c.THREAD_BASIC_INFO,
                @ptrCast(&info),
                &count,
            );
            if (result != 0 and result != 4) break :blk false; // KERN_INVALID_ARGUMENT means the thread is gone.
            if (result == 0 and info.run_state != 5) break :blk false; // TH_STATE_HALTED
            thread.join();
            break :blk true;
        },
        else => @compileError("Unsupported clipboard worker target"),
    };
}

const Operation = struct {
    allocator: Allocator,
    handle: Handle = 0,
    service: *Service,
    mutex: std.Thread.Mutex = .{},
    thread: ?std.Thread = null,
    status: OperationStatus = .pending,
    cancel_requested: bool = false,
    worker_joined: bool = false,
    request: []u8,
    result: []u8 = &.{},
    error_code: i32 = 0,
    diagnostic: []u8 = &.{},

    fn worker(operation: *Operation, delay_ms: u32) void {
        var elapsed_ms: u32 = 0;
        while (elapsed_ms < delay_ms) : (elapsed_ms += 1) {
            operation.mutex.lock();
            const cancelled = operation.cancel_requested;
            operation.mutex.unlock();
            if (cancelled) break;
            std.Thread.sleep(std.time.ns_per_ms);
        }

        operation.mutex.lock();
        if (operation.cancel_requested) {
            operation.status = .cancelled;
        } else {
            operation.result = operation.request;
            operation.request = &.{};
            operation.status = .read;
        }
        operation.mutex.unlock();
    }

    fn requestCancel(operation: *Operation) CancelStatus {
        operation.mutex.lock();
        defer operation.mutex.unlock();
        if (operation.status != .pending) return .already_terminal;
        operation.cancel_requested = true;
        return .requested;
    }

    fn poll(operation: *Operation) OperationStatus {
        operation.mutex.lock();
        defer operation.mutex.unlock();
        return operation.status;
    }

    fn isReadyToDestroy(operation: *Operation) bool {
        operation.mutex.lock();
        const terminal = operation.status != .pending;
        operation.mutex.unlock();
        if (!terminal) return false;
        if (operation.worker_joined) return true;
        const thread = operation.thread orelse return false;
        if (!tryJoinThread(thread)) return false;
        operation.thread = null;
        operation.worker_joined = true;
        return true;
    }

    fn deinit(operation: *Operation) void {
        std.debug.assert(operation.worker_joined);
        if (operation.request.len > 0) operation.allocator.free(operation.request);
        if (operation.result.len > 0) operation.allocator.free(operation.result);
        if (operation.diagnostic.len > 0) operation.allocator.free(operation.diagnostic);
        operation.allocator.destroy(operation);
    }
};

const Service = struct {
    allocator: Allocator,
    max_operations: u32,
    shutting_down: bool = false,
    operations: std.ArrayListUnmanaged(*Operation) = .{},

    fn removeOperation(service: *Service, operation: *Operation) void {
        for (service.operations.items, 0..) |candidate, index| {
            if (candidate == operation) {
                _ = service.operations.swapRemove(index);
                return;
            }
        }
        unreachable;
    }

    fn beginShutdown(service: *Service) void {
        if (service.shutting_down) return;
        service.shutting_down = true;
        for (service.operations.items) |operation| {
            _ = operation.requestCancel();
        }
    }

    fn pollShutdown(service: *Service) ShutdownStatus {
        if (!service.shutting_down) return .pending;
        for (service.operations.items) |operation| {
            if (!operation.isReadyToDestroy()) return .pending;
        }
        return .ready;
    }

    fn deinit(service: *Service) void {
        for (service.operations.items) |operation| {
            std.debug.assert(operation.worker_joined);
            handles.invalidate(operation.handle, .clipboard_operation);
            operation.deinit();
        }
        service.operations.deinit(service.allocator);
        service.allocator.destroy(service);
    }
};

fn erasePtr(pointer: anytype) *anyopaque {
    return @ptrCast(pointer);
}

fn acquireService(handle: Handle) ?*Service {
    return handles.acquire(handle, .clipboard_service, Service);
}

fn acquireOperation(handle: Handle) ?*Operation {
    return handles.acquire(handle, .clipboard_operation, Operation);
}

fn sliceFromPointer(pointer: ?[*]const u8, length: u32) ?[]const u8 {
    if (length == 0) return "";
    const valid_pointer = pointer orelse return null;
    return valid_pointer[0..@as(usize, length)];
}

pub fn createService(allocator: Allocator, max_operations: u32) Handle {
    if (max_operations == 0) return 0;
    const service = allocator.create(Service) catch return 0;
    service.* = .{ .allocator = allocator, .max_operations = max_operations };
    return handles.insert(.clipboard_service, erasePtr(service)) catch {
        allocator.destroy(service);
        return 0;
    };
}

pub fn startTestOperation(
    service_handle: Handle,
    request_pointer: ?[*]const u8,
    request_length: u32,
    delay_ms: u32,
    out_operation_handle: ?*Handle,
) StartStatus {
    const out_handle = out_operation_handle orelse return .invalid_argument;
    out_handle.* = 0;
    const service = acquireService(service_handle) orelse return .invalid_service;
    if (service.shutting_down) return .shutting_down;
    if (service.operations.items.len >= service.max_operations) return .limit_exceeded;
    const request = sliceFromPointer(request_pointer, request_length) orelse return .invalid_argument;
    const owned_request = service.allocator.dupe(u8, request) catch return .out_of_memory;

    const operation = service.allocator.create(Operation) catch {
        if (owned_request.len > 0) service.allocator.free(owned_request);
        return .out_of_memory;
    };
    operation.* = .{
        .allocator = service.allocator,
        .service = service,
        .request = owned_request,
    };
    const operation_handle = handles.insertOwnedChild(
        .clipboard_operation,
        erasePtr(operation),
        service_handle,
    ) catch {
        if (owned_request.len > 0) service.allocator.free(owned_request);
        service.allocator.destroy(operation);
        return .out_of_memory;
    };
    operation.handle = operation_handle;
    service.operations.append(service.allocator, operation) catch {
        handles.invalidate(operation_handle, .clipboard_operation);
        if (owned_request.len > 0) service.allocator.free(owned_request);
        service.allocator.destroy(operation);
        return .out_of_memory;
    };

    operation.thread = std.Thread.spawn(.{}, Operation.worker, .{ operation, delay_ms }) catch {
        _ = service.operations.pop();
        handles.invalidate(operation_handle, .clipboard_operation);
        if (owned_request.len > 0) service.allocator.free(owned_request);
        service.allocator.destroy(operation);
        return .worker_start_failed;
    };
    out_handle.* = operation_handle;
    return .ok;
}

pub fn pollOperation(operation_handle: Handle) OperationStatus {
    const operation = acquireOperation(operation_handle) orelse return .invalid_handle;
    return operation.poll();
}

pub fn cancelOperation(operation_handle: Handle) CancelStatus {
    const operation = acquireOperation(operation_handle) orelse return .invalid_handle;
    return operation.requestCancel();
}

fn resultSlice(operation: *Operation, kind: ResultKind) ?[]const u8 {
    operation.mutex.lock();
    defer operation.mutex.unlock();
    return switch (kind) {
        .mime => if (operation.status == .read) TEST_MIME else null,
        .data => if (operation.status == .read) operation.result else null,
        .diagnostic => if (operation.status == .failed) operation.diagnostic else null,
    };
}

fn resultLength(operation_handle: Handle, out_length: ?*u32, kind: ResultKind) CopyStatus {
    const operation = acquireOperation(operation_handle) orelse return .invalid_handle;
    const output = out_length orelse return .invalid_argument;
    const result = resultSlice(operation, kind) orelse return .invalid_state;
    output.* = @intCast(result.len);
    return .ok;
}

fn resultCopy(
    operation_handle: Handle,
    output_pointer: ?[*]u8,
    output_capacity: u32,
    kind: ResultKind,
) CopyStatus {
    const operation = acquireOperation(operation_handle) orelse return .invalid_handle;
    const result = resultSlice(operation, kind) orelse return .invalid_state;
    if (output_capacity < result.len) return .buffer_too_small;
    if (result.len == 0) return .ok;
    const output = output_pointer orelse return .invalid_argument;
    @memcpy(output[0..result.len], result);
    return .ok;
}

pub fn resultMimeLength(operation_handle: Handle, out_length: ?*u32) CopyStatus {
    return resultLength(operation_handle, out_length, .mime);
}

pub fn resultMimeCopy(operation_handle: Handle, output_pointer: ?[*]u8, output_capacity: u32) CopyStatus {
    return resultCopy(operation_handle, output_pointer, output_capacity, .mime);
}

pub fn resultDataLength(operation_handle: Handle, out_length: ?*u32) CopyStatus {
    return resultLength(operation_handle, out_length, .data);
}

pub fn resultDataCopy(operation_handle: Handle, output_pointer: ?[*]u8, output_capacity: u32) CopyStatus {
    return resultCopy(operation_handle, output_pointer, output_capacity, .data);
}

pub fn resultErrorCode(operation_handle: Handle, out_error_code: ?*i32) CopyStatus {
    const operation = acquireOperation(operation_handle) orelse return .invalid_handle;
    const output = out_error_code orelse return .invalid_argument;
    operation.mutex.lock();
    defer operation.mutex.unlock();
    if (operation.status != .failed) return .invalid_state;
    output.* = operation.error_code;
    return .ok;
}

pub fn resultDiagnosticLength(operation_handle: Handle, out_length: ?*u32) CopyStatus {
    return resultLength(operation_handle, out_length, .diagnostic);
}

pub fn resultDiagnosticCopy(operation_handle: Handle, output_pointer: ?[*]u8, output_capacity: u32) CopyStatus {
    return resultCopy(operation_handle, output_pointer, output_capacity, .diagnostic);
}

pub fn destroyOperation(operation_handle: Handle) DestroyStatus {
    const operation = acquireOperation(operation_handle) orelse return .invalid_handle;
    if (!operation.isReadyToDestroy()) return .not_ready;
    operation.service.removeOperation(operation);
    handles.invalidate(operation_handle, .clipboard_operation);
    operation.deinit();
    return .destroyed;
}

pub fn beginServiceShutdown(service_handle: Handle) ShutdownStatus {
    const service = acquireService(service_handle) orelse return .invalid_handle;
    service.beginShutdown();
    return .pending;
}

pub fn pollServiceShutdown(service_handle: Handle) ShutdownStatus {
    const service = acquireService(service_handle) orelse return .invalid_handle;
    return service.pollShutdown();
}

pub fn destroyService(service_handle: Handle) DestroyStatus {
    const service = acquireService(service_handle) orelse return .invalid_handle;
    if (service.pollShutdown() != .ready) return .not_ready;
    handles.invalidate(service_handle, .clipboard_service);
    service.deinit();
    return .destroyed;
}

test "clipboard status values are stable" {
    try std.testing.expectEqual(@as(u8, 0), @intFromEnum(OperationStatus.pending));
    try std.testing.expectEqual(@as(u8, 1), @intFromEnum(OperationStatus.read));
    try std.testing.expectEqual(@as(u8, 10), @intFromEnum(OperationStatus.invalid_handle));
    try std.testing.expectEqual(@as(u8, 1), @intFromEnum(CopyStatus.buffer_too_small));
    try std.testing.expectEqual(@as(u8, 2), @intFromEnum(DestroyStatus.invalid_handle));
}

test "clipboard worker copies input and rejects stale handles" {
    const service = createService(std.testing.allocator, 2);
    try std.testing.expect(service != 0);
    const input = [_]u8{ 0, 1, 2, 0, 255 };
    var operation: Handle = 0;
    try std.testing.expectEqual(
        StartStatus.ok,
        startTestOperation(service, input[0..].ptr, input.len, 0, &operation),
    );

    while (pollOperation(operation) == .pending) std.Thread.yield() catch {};
    try std.testing.expectEqual(OperationStatus.read, pollOperation(operation));
    var length: u32 = 0;
    try std.testing.expectEqual(CopyStatus.ok, resultDataLength(operation, &length));
    try std.testing.expectEqual(@as(u32, input.len), length);
    var too_small = [_]u8{0xaa} ** (input.len - 1);
    try std.testing.expectEqual(CopyStatus.buffer_too_small, resultDataCopy(operation, &too_small, too_small.len));
    try std.testing.expectEqualSlices(u8, &([_]u8{0xaa} ** (input.len - 1)), &too_small);
    var output: [input.len]u8 = undefined;
    try std.testing.expectEqual(CopyStatus.ok, resultDataCopy(operation, &output, output.len));
    try std.testing.expectEqualSlices(u8, &input, &output);
    try std.testing.expectEqual(DestroyStatus.destroyed, destroyOperation(operation));
    try std.testing.expectEqual(DestroyStatus.invalid_handle, destroyOperation(operation));
    try std.testing.expectEqual(OperationStatus.invalid_handle, pollOperation(operation));
    _ = beginServiceShutdown(service);
    try std.testing.expectEqual(DestroyStatus.destroyed, destroyService(service));
}

test "clipboard cancellation and service shutdown are asynchronous and isolated" {
    const first_service = createService(std.testing.allocator, 1);
    const second_service = createService(std.testing.allocator, 1);
    defer {
        _ = beginServiceShutdown(second_service);
        while (pollServiceShutdown(second_service) == .pending) std.Thread.yield() catch {};
        _ = destroyService(second_service);
    }

    var first_operation: Handle = 0;
    var second_operation: Handle = 0;
    const byte = [_]u8{42};
    try std.testing.expectEqual(StartStatus.ok, startTestOperation(first_service, &byte, 1, 100, &first_operation));
    try std.testing.expectEqual(StartStatus.ok, startTestOperation(second_service, &byte, 1, 0, &second_operation));
    try std.testing.expectEqual(CancelStatus.requested, cancelOperation(first_operation));
    try std.testing.expectEqual(CancelStatus.requested, cancelOperation(first_operation));
    _ = beginServiceShutdown(first_service);
    while (pollServiceShutdown(first_service) == .pending) std.Thread.yield() catch {};
    try std.testing.expectEqual(DestroyStatus.destroyed, destroyService(first_service));
    try std.testing.expectEqual(OperationStatus.invalid_handle, pollOperation(first_operation));

    while (pollOperation(second_operation) == .pending) std.Thread.yield() catch {};
    try std.testing.expectEqual(OperationStatus.read, pollOperation(second_operation));
    try std.testing.expectEqual(DestroyStatus.destroyed, destroyOperation(second_operation));
}
