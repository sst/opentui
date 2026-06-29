const std = @import("std");
const builtin = @import("builtin");
const handles = @import("handles.zig");
const clipboard_linux = @import("clipboard-linux.zig");
const clipboard_wayland = @import("clipboard-wayland.zig");
const clipboard_x11 = @import("clipboard-x11.zig");
const clipboard_windows = @import("clipboard-windows.zig");
const clipboard_macos = @import("clipboard-macos.zig");

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
const Selection = enum(u8) { clipboard = 0, primary = 1 };
const OperationKind = enum { test_read, read, write, clear };
const PlatformJobState = enum { none, queued, running, complete };

const ErrorCode = enum(i32) {
    internal = 1,
    out_of_memory = 2,
    wayland_protocol = 100,
    wayland_dispatch = 101,
    wayland_flush = 102,
    wayland_provider = 103,
    wayland_transfer = 104,
    x11_protocol = 200,
    x11_flush = 201,
    x11_provider = 202,
    x11_transfer = 203,
};

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
    kind: OperationKind,
    request: []u8 = &.{},
    result: []u8 = &.{},
    error_code: i32 = 0,
    diagnostic: []const u8 = &.{},
    result_mime: []u8 = &.{},
    transfer_data: std.ArrayListUnmanaged(u8) = .{},
    transfer_fd: ?std.posix.fd_t = null,
    max_bytes: u32 = 0,
    selection: Selection = .clipboard,
    preference_offset: usize = 4,
    candidate_failed: bool = false,
    implemented_candidate_attempted: bool = false,
    mechanism: ?clipboard_linux.Mechanism = null,
    x11_read: clipboard_x11.ReadState = .{},
    x11_write: clipboard_x11.WriteState = .{},
    x11_targets: [5]u32 = undefined,
    x11_target_count: u8 = 0,
    x11_target_index: u8 = 0,
    platform_job_state: PlatformJobState = .none,
    platform_cancel: std.atomic.Value(bool) = .init(false),
    platform_terminal_request: ?OperationStatus = null,
    mutation_sequence: u64 = 0,
    timeout_ms: u32 = 0,
    started_ns: i128 = 0,

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
            operation.cleanupTransfer();
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
        if (operation.status != .pending) {
            operation.mutex.unlock();
            return .already_terminal;
        }
        if (comptime builtin.os.tag == .windows or builtin.os.tag == .macos) {
            operation.cancel_requested = true;
            operation.platform_cancel.store(true, .release);
            if (operation.platform_terminal_request == null) operation.platform_terminal_request = .cancelled;
            operation.mutex.unlock();
            operation.service.wakePlatformWorker();
            return .requested;
        }
        defer operation.mutex.unlock();
        if (operation.x11_write.committed) {
            operation.status = if (operation.kind == .write) .written else .cleared;
            return .already_terminal;
        }
        operation.cancel_requested = true;
        if (operation.kind != .test_read) {
            operation.cleanupTransfer();
            operation.cleanupX11();
            operation.status = .cancelled;
        }
        return .requested;
    }

    fn poll(operation: *Operation) OperationStatus {
        operation.mutex.lock();
        if (operation.kind == .test_read) {
            const status = operation.status;
            operation.mutex.unlock();
            return status;
        }
        if (operation.status != .pending) {
            const status = operation.status;
            operation.mutex.unlock();
            return status;
        }
        if (operation.x11_write.committed) {
            operation.status = if (operation.kind == .write) .written else .cleared;
            const status = operation.status;
            operation.mutex.unlock();
            return status;
        }
        if (comptime builtin.os.tag == .windows or builtin.os.tag == .macos) {
            const elapsed_ns = std.time.nanoTimestamp() - operation.started_ns;
            if (elapsed_ns >= @as(i128, operation.timeout_ms) * std.time.ns_per_ms and
                operation.platform_terminal_request == null)
            {
                operation.platform_terminal_request = .timed_out;
                operation.platform_cancel.store(true, .release);
                operation.mutex.unlock();
                operation.service.wakePlatformWorker();
                return .pending;
            }
            operation.mutex.unlock();
            return .pending;
        }
        if (operation.cancel_requested) {
            operation.status = .cancelled;
            operation.mutex.unlock();
            return .cancelled;
        }
        const elapsed_ns = std.time.nanoTimestamp() - operation.started_ns;
        if (elapsed_ns >= @as(i128, operation.timeout_ms) * std.time.ns_per_ms) {
            operation.cleanupTransfer();
            operation.cleanupX11();
            operation.status = .timed_out;
            operation.mutex.unlock();
            return .timed_out;
        }
        operation.mutex.unlock();
        return operation.service.driveOperation(operation);
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
        if (operation.result_mime.len > 0) operation.allocator.free(operation.result_mime);
        operation.transfer_data.deinit(operation.allocator);
        operation.cleanupTransfer();
        operation.cleanupX11();
        operation.allocator.destroy(operation);
    }

    fn cleanupTransfer(operation: *Operation) void {
        if (comptime builtin.os.tag != .linux) {
            operation.transfer_fd = null;
            return;
        }
        if (operation.transfer_fd) |fd| std.posix.close(fd);
        operation.transfer_fd = null;
    }

    fn rememberFailure(operation: *Operation, code: ErrorCode, diagnostic: []const u8) void {
        if (operation.error_code != 0) return;
        operation.error_code = @intFromEnum(code);
        operation.diagnostic = diagnostic;
    }

    fn cleanupX11(operation: *Operation) void {
        if (comptime builtin.os.tag != .linux) return;
        const x11 = operation.service.x11 orelse return;
        x11.cleanupRead(&operation.x11_read);
        x11.cleanupWrite(&operation.x11_write);
    }
};

const Service = struct {
    allocator: Allocator,
    max_operations: u32,
    max_provider_transfers: u32,
    route: clipboard_linux.Route,
    wayland: ?*clipboard_wayland.Connection = null,
    x11: ?*clipboard_x11.Connection = null,
    drain_mechanism: clipboard_linux.Mechanism = .wayland,
    requested_wayland_seat: []u8,
    environment_wayland_seat: []u8,
    shutting_down: bool = false,
    next_mutation_sequence: u64 = 1,
    operations: std.ArrayListUnmanaged(*Operation) = .{},
    platform_mutex: std.Thread.Mutex = .{},
    platform_condition: std.Thread.Condition = .{},
    platform_queue: std.ArrayListUnmanaged(*Operation) = .{},
    platform_thread: ?std.Thread = null,
    platform_stop: bool = false,
    platform_exited: bool = false,
    platform_failed: bool = false,
    platform_joined: bool = false,

    fn takeMutationSequence(service: *Service) u64 {
        const sequence = service.next_mutation_sequence;
        std.debug.assert(sequence != std.math.maxInt(u64));
        service.next_mutation_sequence += 1;
        return sequence;
    }

    fn removeOperation(service: *Service, operation: *Operation) void {
        for (service.operations.items, 0..) |candidate, index| {
            if (candidate == operation) {
                _ = service.operations.swapRemove(index);
                return;
            }
        }
        unreachable;
    }

    fn enqueuePlatformOperation(service: *Service, operation: *Operation) void {
        if (comptime builtin.os.tag != .windows and builtin.os.tag != .macos) return;
        service.platform_mutex.lock();
        if (service.platform_failed) {
            service.platform_mutex.unlock();
            operation.rememberFailure(.internal, "Native clipboard worker initialization failed");
            operation.platform_job_state = .complete;
            operation.status = .failed;
            return;
        }
        std.debug.assert(service.platform_queue.items.len < service.platform_queue.capacity);
        service.platform_queue.appendAssumeCapacity(operation);
        operation.platform_job_state = .queued;
        service.platform_condition.signal();
        service.platform_mutex.unlock();
    }

    fn wakePlatformWorker(service: *Service) void {
        if (comptime builtin.os.tag != .windows and builtin.os.tag != .macos) return;
        service.platform_mutex.lock();
        service.platform_condition.signal();
        service.platform_mutex.unlock();
    }

    fn platformWorker(service: *Service) void {
        if (comptime builtin.os.tag == .windows) {
            var worker = clipboard_windows.Worker.init() catch {
                service.failPlatformWorker();
                return;
            };
            defer worker.deinit();
            service.platformWorkerLoop(&worker);
        } else if (comptime builtin.os.tag == .macos) {
            service.platformWorkerLoop({});
        } else unreachable;

        service.platform_mutex.lock();
        service.platform_exited = true;
        service.platform_mutex.unlock();
    }

    fn failPlatformWorker(service: *Service) void {
        service.platform_mutex.lock();
        service.platform_failed = true;
        while (service.platform_queue.items.len > 0) {
            const operation = service.platform_queue.orderedRemove(0);
            operation.mutex.lock();
            operation.rememberFailure(.internal, "Native clipboard worker initialization failed");
            operation.platform_job_state = .complete;
            operation.status = .failed;
            operation.mutex.unlock();
        }
        service.platform_exited = true;
        service.platform_mutex.unlock();
    }

    fn platformWorkerLoop(service: *Service, worker: anytype) void {
        while (true) {
            service.platform_mutex.lock();
            while (service.platform_queue.items.len == 0 and !service.platform_stop) {
                if (comptime builtin.os.tag == .windows) {
                    service.platform_condition.timedWait(&service.platform_mutex, 10 * std.time.ns_per_ms) catch {};
                    if (service.platform_queue.items.len == 0 and !service.platform_stop) {
                        service.platform_mutex.unlock();
                        worker.pumpMessages();
                        service.platform_mutex.lock();
                    }
                } else {
                    service.platform_condition.wait(&service.platform_mutex);
                }
            }
            if (service.platform_queue.items.len == 0 and service.platform_stop) {
                service.platform_mutex.unlock();
                return;
            }
            const operation = service.platform_queue.orderedRemove(0);
            operation.platform_job_state = .running;
            service.platform_mutex.unlock();
            if (comptime builtin.os.tag == .windows) worker.pumpMessages();
            service.executePlatformOperation(worker, operation);
            if (comptime builtin.os.tag == .windows) worker.pumpMessages();
        }
    }

    fn executePlatformOperation(service: *Service, worker: anytype, operation: *Operation) void {
        operation.mutex.lock();
        const requested = operation.platform_terminal_request;
        operation.mutex.unlock();
        if (requested) |status| {
            service.publishPlatformResult(operation, status, &.{}, &.{}, 0);
            return;
        }
        if (comptime builtin.os.tag == .windows) {
            if (operation.selection == .primary) {
                service.publishPlatformResult(operation, .unsupported, &.{}, &.{}, 0);
                return;
            }
        }

        if (comptime builtin.os.tag == .windows) {
            const job: clipboard_windows.Job = switch (operation.kind) {
                .read => .{ .read = .{ .request = operation.request, .max_bytes = operation.max_bytes } },
                .write => .{ .write = .{ .mime = "text/plain", .data = operation.request } },
                .clear => .clear,
                .test_read => unreachable,
            };
            var result = worker.execute(service.allocator, job, .{
                .cancel_requested = &operation.platform_cancel,
                .deadline_ns = operation.started_ns + @as(i128, operation.timeout_ms) * std.time.ns_per_ms,
            });
            defer result.deinit(service.allocator);
            const status: OperationStatus = switch (result.status) {
                .read => .read,
                .empty => .empty,
                .written => .written,
                .cleared => .cleared,
                .unsupported => .unsupported,
                .cancelled => .cancelled,
                .timed_out => .timed_out,
                .limit_exceeded => .limit_exceeded,
                .invalid_request, .failed => .failed,
            };
            service.publishPlatformResult(operation, status, result.mime, result.data, @intCast(result.error_code));
        } else if (comptime builtin.os.tag == .macos) {
            const selection: clipboard_macos.Selection = if (operation.selection == .clipboard) .clipboard else .primary;
            const job: clipboard_macos.Job = switch (operation.kind) {
                .read => .{ .read = .{ .selection = selection, .request = operation.request, .max_bytes = operation.max_bytes } },
                .write => .{ .write_text = .{ .selection = selection, .text = operation.request } },
                .clear => .{ .clear = .{ .selection = selection } },
                .test_read => unreachable,
            };
            var result = clipboard_macos.runJob(service.allocator, job) catch |err| {
                const status: OperationStatus = if (err == error.LimitExceeded) .limit_exceeded else .failed;
                service.publishPlatformResult(operation, status, &.{}, &.{}, 0);
                return;
            };
            defer result.deinit(service.allocator);
            switch (result) {
                .read => |read| service.publishPlatformResult(operation, .read, read.mime.name(), read.data, 0),
                .empty => service.publishPlatformResult(operation, .empty, &.{}, &.{}, 0),
                .written => service.publishPlatformResult(operation, .written, &.{}, &.{}, 0),
                .cleared => service.publishPlatformResult(operation, .cleared, &.{}, &.{}, 0),
                .unsupported => service.publishPlatformResult(operation, .unsupported, &.{}, &.{}, 0),
            }
        } else unreachable;
    }

    fn publishPlatformResult(
        service: *Service,
        operation: *Operation,
        platform_status: OperationStatus,
        mime: []const u8,
        data: []const u8,
        error_code: i32,
    ) void {
        operation.mutex.lock();
        defer operation.mutex.unlock();
        var status = if (platform_status == .written or platform_status == .cleared)
            platform_status
        else
            operation.platform_terminal_request orelse platform_status;
        if (status == .read) {
            operation.result_mime = service.allocator.dupe(u8, mime) catch {
                status = .failed;
                operation.rememberFailure(.out_of_memory, "Failed to allocate native clipboard MIME result");
                operation.platform_job_state = .complete;
                operation.status = status;
                return;
            };
            operation.result = service.allocator.dupe(u8, data) catch blk: {
                service.allocator.free(operation.result_mime);
                operation.result_mime = &.{};
                status = .failed;
                operation.rememberFailure(.out_of_memory, "Failed to allocate native clipboard result");
                break :blk &.{};
            };
        }
        if (status == .failed) {
            operation.error_code = if (error_code != 0) error_code else @intFromEnum(ErrorCode.internal);
            if (operation.diagnostic.len == 0) operation.diagnostic = "Native platform clipboard operation failed";
        }
        operation.platform_job_state = .complete;
        operation.status = status;
    }

    fn beginShutdown(service: *Service) void {
        if (service.shutting_down) return;
        service.shutting_down = true;
        for (service.operations.items) |operation| {
            _ = operation.requestCancel();
        }
        if (comptime builtin.os.tag == .linux) {
            if (service.wayland) |wayland| wayland.releaseProviders();
            if (service.x11) |x11| x11.releaseProviders();
        }
        if (comptime builtin.os.tag == .windows or builtin.os.tag == .macos) {
            service.platform_mutex.lock();
            service.platform_stop = true;
            service.platform_condition.signal();
            service.platform_mutex.unlock();
        }
    }

    fn pollShutdown(service: *Service) ShutdownStatus {
        if (!service.shutting_down) return .pending;
        for (service.operations.items) |operation| {
            if (!operation.isReadyToDestroy()) return .pending;
        }
        if (comptime builtin.os.tag == .windows or builtin.os.tag == .macos) {
            service.platform_mutex.lock();
            const exited = service.platform_exited;
            service.platform_mutex.unlock();
            if (!exited) return .pending;
            if (!service.platform_joined) {
                const thread = service.platform_thread orelse return .pending;
                if (!tryJoinThread(thread)) return .pending;
                service.platform_thread = null;
                service.platform_joined = true;
            }
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
        service.platform_queue.deinit(service.allocator);
        if (comptime builtin.os.tag == .linux) {
            if (service.wayland) |wayland| {
                wayland.deinit();
                service.allocator.destroy(wayland);
            }
            if (service.x11) |x11| {
                x11.deinit();
                service.allocator.destroy(x11);
            }
        }
        if (service.requested_wayland_seat.len > 0) service.allocator.free(service.requested_wayland_seat);
        if (service.environment_wayland_seat.len > 0) service.allocator.free(service.environment_wayland_seat);
        service.allocator.destroy(service);
    }

    fn driveOperation(service: *Service, operation: *Operation) OperationStatus {
        if (comptime builtin.os.tag == .windows or builtin.os.tag == .macos) {
            return operation.status;
        }
        if (comptime builtin.os.tag != .linux) return service.finishOperation(operation, .unsupported);
        if (operation.kind == .read and !implementsNativeReadType(operation.request)) {
            return service.finishOperation(operation, .unsupported);
        }
        const libraries = switch (service.route) {
            .unsupported => return service.finishOperation(operation, .unsupported),
            .linux => |libraries| libraries,
        };
        operation.mechanism = operation.mechanism orelse clipboard_linux.firstMechanism(libraries) orelse
            return service.finishOperation(operation, .unsupported);
        return switch (operation.mechanism.?) {
            .wayland => service.driveWayland(operation, libraries),
            .x11 => service.driveX11(operation),
        };
    }

    fn driveWayland(
        service: *Service,
        operation: *Operation,
        libraries: clipboard_linux.Libraries,
    ) OperationStatus {
        if (service.wayland == null) {
            const symbols = clipboard_linux.waylandSymbols() orelse
                return service.fallbackWayland(operation, libraries, .unavailable);
            const wayland = service.allocator.create(clipboard_wayland.Connection) catch {
                operation.rememberFailure(.out_of_memory, "Failed to allocate Wayland clipboard connection");
                return service.finishOperation(operation, .failed);
            };
            wayland.* = clipboard_wayland.Connection.init(
                service.allocator,
                symbols,
                service.requested_wayland_seat,
                service.environment_wayland_seat,
                service.max_provider_transfers,
            );
            service.wayland = wayland;
        }
        return switch (service.wayland.?.drive()) {
            .pending => .pending,
            .ready => service.driveWaylandOperation(operation),
            .unsupported => service.fallbackWayland(operation, libraries, .unsupported),
            .failed => service.finishWaylandFailure(operation),
        };
    }

    fn fallbackWayland(
        service: *Service,
        operation: *Operation,
        libraries: clipboard_linux.Libraries,
        outcome: clipboard_linux.MechanismOutcome,
    ) OperationStatus {
        const next = clipboard_linux.fallbackMechanism(libraries, .wayland, outcome) orelse
            return service.finishOperation(operation, .unsupported);
        operation.cleanupTransfer();
        operation.mechanism = next;
        operation.preference_offset = 4;
        operation.candidate_failed = false;
        operation.implemented_candidate_attempted = false;
        return .pending;
    }

    fn ensureX11(service: *Service, operation: *Operation) ?OperationStatus {
        if (service.x11 == null) {
            const symbols = clipboard_linux.xcbSymbols() orelse
                return service.finishOperation(operation, .unsupported);
            const x11 = service.allocator.create(clipboard_x11.Connection) catch {
                operation.rememberFailure(.out_of_memory, "Failed to allocate X11 clipboard connection");
                return service.finishOperation(operation, .failed);
            };
            x11.* = clipboard_x11.Connection.init(service.allocator, symbols, service.max_provider_transfers);
            service.x11 = x11;
        }
        return switch (service.x11.?.drive()) {
            .pending => .pending,
            .ready => null,
            .unsupported => service.finishOperation(operation, .unsupported),
            .failed => service.finishX11Failure(operation),
        };
    }

    fn driveX11(service: *Service, operation: *Operation) OperationStatus {
        if (service.ensureX11(operation)) |status| return status;
        service.driveX11EventUnit();
        return switch (operation.kind) {
            .read => service.driveX11Read(operation),
            .write => service.driveX11Write(operation),
            .clear => service.driveX11Clear(operation),
            .test_read => unreachable,
        };
    }

    fn driveWaylandOperation(service: *Service, operation: *Operation) OperationStatus {
        if (comptime builtin.os.tag != .linux) return service.finishOperation(operation, .unsupported);
        return switch (operation.kind) {
            .read => service.driveWaylandRead(operation),
            .write => service.driveWaylandWrite(operation),
            .clear => service.driveWaylandClear(operation),
            .test_read => unreachable,
        };
    }

    fn driveWaylandWrite(service: *Service, operation: *Operation) OperationStatus {
        if (comptime builtin.os.tag != .linux) return service.finishOperation(operation, .unsupported);
        const result = service.wayland.?.publishText(operation.selection == .primary, operation.request);
        switch (result) {
            .ok, .committed => std.debug.assert(selectionRequestCommitted(result)),
            .pending => unreachable,
            .unsupported => return service.fallbackCurrentWayland(operation),
            .failed => return service.finishWaylandFailure(operation),
        }
        operation.request = &.{};
        return service.finishOperation(operation, .written);
    }

    fn driveWaylandClear(service: *Service, operation: *Operation) OperationStatus {
        if (comptime builtin.os.tag != .linux) return service.finishOperation(operation, .unsupported);
        const result = service.wayland.?.clearSelection(operation.selection == .primary);
        switch (result) {
            .ok, .committed => std.debug.assert(selectionRequestCommitted(result)),
            .pending => unreachable,
            .unsupported => return service.fallbackCurrentWayland(operation),
            .failed => return service.finishWaylandFailure(operation),
        }
        return service.finishOperation(operation, .cleared);
    }

    fn driveWaylandRead(service: *Service, operation: *Operation) OperationStatus {
        if (comptime builtin.os.tag != .linux) return service.finishOperation(operation, .unsupported);
        if (operation.transfer_fd) |fd| {
            var buffer: [64 * 1024]u8 = undefined;
            const count = std.posix.read(fd, &buffer) catch |err| switch (err) {
                error.WouldBlock => return .pending,
                else => {
                    operation.rememberFailure(.wayland_transfer, "Wayland clipboard transfer read failed");
                    operation.cleanupTransfer();
                    operation.candidate_failed = true;
                    if (operation.result_mime.len > 0) operation.allocator.free(operation.result_mime);
                    operation.result_mime = &.{};
                    operation.transfer_data.clearRetainingCapacity();
                    return .pending;
                },
            };
            if (count == 0) {
                operation.cleanupTransfer();
                if (std.ascii.eqlIgnoreCase(operation.result_mime, "image/png") and
                    operation.transfer_data.items.len == 0)
                {
                    operation.implemented_candidate_attempted = true;
                    operation.allocator.free(operation.result_mime);
                    operation.result_mime = &.{};
                    operation.transfer_data.clearRetainingCapacity();
                    return .pending;
                }
                operation.result = operation.transfer_data.toOwnedSlice(operation.allocator) catch {
                    operation.rememberFailure(.out_of_memory, "Failed to allocate Wayland clipboard result");
                    return service.finishOperation(operation, .failed);
                };
                return service.finishOperation(operation, .read);
            }
            if (operation.transfer_data.items.len + count > operation.max_bytes) {
                operation.cleanupTransfer();
                return service.finishOperation(operation, .limit_exceeded);
            }
            operation.transfer_data.appendSlice(operation.allocator, buffer[0..count]) catch {
                operation.cleanupTransfer();
                operation.rememberFailure(.out_of_memory, "Failed to grow Wayland clipboard result");
                return service.finishOperation(operation, .failed);
            };
            return .pending;
        }

        const primary = operation.selection == .primary;
        if (primary and !service.wayland.?.primary_supported) {
            return service.fallbackCurrentWayland(operation);
        }
        const any_implemented = implementsNativeReadType(operation.request);
        if (!any_implemented) return service.fallbackCurrentWayland(operation);
        const offer = service.wayland.?.currentOffer(primary) orelse
            return service.finishOperation(operation, .empty);
        var implemented = false;
        var offset = operation.preference_offset;
        while (offset < operation.request.len) {
            const length = std.mem.readInt(u32, operation.request[offset..][0..4], .little);
            offset += 4;
            const preferred = operation.request[offset .. offset + length];
            offset += length;
            operation.preference_offset = offset;
            if (!std.ascii.eqlIgnoreCase(preferred, "text/plain") and
                !std.ascii.eqlIgnoreCase(preferred, "image/png")) continue;
            implemented = true;
            operation.implemented_candidate_attempted = true;
            const offered = clipboard_wayland.Connection.offeredMime(offer, preferred) orelse continue;
            return service.beginWaylandRead(operation, offer, preferred, offered);
        }
        return service.finishOperation(operation, waylandReadExhaustionStatus(
            implemented or operation.implemented_candidate_attempted,
            operation.candidate_failed,
        ));
    }

    fn implementsNativeReadType(request: []const u8) bool {
        var offset: usize = 4;
        while (offset < request.len) {
            const length = std.mem.readInt(u32, request[offset..][0..4], .little);
            offset += 4;
            const preferred = request[offset .. offset + length];
            offset += length;
            if (std.ascii.eqlIgnoreCase(preferred, "text/plain") or
                std.ascii.eqlIgnoreCase(preferred, "image/png")) return true;
        }
        return false;
    }

    fn beginWaylandRead(
        service: *Service,
        operation: *Operation,
        offer: *const clipboard_wayland.Offer,
        preferred: []const u8,
        offered: []const u8,
    ) OperationStatus {
        if (comptime builtin.os.tag != .linux) return service.finishOperation(operation, .unsupported);
        const pipe = std.posix.pipe2(.{ .NONBLOCK = true, .CLOEXEC = true }) catch {
            operation.rememberFailure(.wayland_transfer, "Failed to create Wayland clipboard transfer pipe");
            return service.rememberWaylandReadFailure(operation);
        };
        const requested = service.wayland.?.receive(offer, offered, pipe[1]);
        std.posix.close(pipe[1]);
        if (!requested) {
            std.posix.close(pipe[0]);
            operation.rememberFailure(.wayland_flush, "Failed to request Wayland clipboard transfer");
            return service.rememberWaylandReadFailure(operation);
        }
        operation.result_mime = operation.allocator.dupe(u8, preferred) catch {
            std.posix.close(pipe[0]);
            operation.rememberFailure(.out_of_memory, "Failed to allocate Wayland clipboard MIME result");
            return service.rememberWaylandReadFailure(operation);
        };
        operation.transfer_fd = pipe[0];
        return .pending;
    }

    fn rememberWaylandReadFailure(_: *Service, operation: *Operation) OperationStatus {
        operation.candidate_failed = true;
        return .pending;
    }

    fn fallbackCurrentWayland(service: *Service, operation: *Operation) OperationStatus {
        const libraries = switch (service.route) {
            .unsupported => return service.finishOperation(operation, .unsupported),
            .linux => |libraries| libraries,
        };
        return service.fallbackWayland(operation, libraries, .unsupported);
    }

    fn driveX11EventUnit(service: *Service) void {
        const x11 = service.x11 orelse return;
        const event = x11.pollEvent() orelse return;
        defer std.c.free(event);
        if (x11.consumeRetiredTimestampEvent(event)) return;
        for (service.operations.items) |candidate| {
            if (candidate.mechanism != .x11) continue;
            if (candidate.kind == .read and x11.routeReadEvent(&candidate.x11_read, event)) return;
            if ((candidate.kind == .write or candidate.kind == .clear) and
                x11.routeWriteEvent(&candidate.x11_write, event))
            {
                if (candidate.kind == .write and candidate.x11_write.committed) candidate.request = &.{};
                return;
            }
        }
        x11.handleProviderEvent(event);
    }

    fn driveX11Read(service: *Service, operation: *Operation) OperationStatus {
        const x11 = service.x11.?;
        switch (x11.driveRead(&operation.x11_read, &operation.transfer_data, operation.max_bytes)) {
            .pending => {
                if (operation.x11_read.phase != .idle) return .pending;
            },
            .ready => {
                const empty_png = operation.result_mime.len > 0 and
                    std.ascii.eqlIgnoreCase(operation.result_mime, "image/png") and
                    operation.transfer_data.items.len == 0;
                if (!empty_png) {
                    operation.result = operation.transfer_data.toOwnedSlice(operation.allocator) catch {
                        operation.rememberFailure(.out_of_memory, "Failed to allocate X11 clipboard result");
                        return service.finishOperation(operation, .failed);
                    };
                    x11.cleanupRead(&operation.x11_read);
                    return service.finishOperation(operation, .read);
                }
                x11.cleanupRead(&operation.x11_read);
                operation.transfer_data.clearRetainingCapacity();
                operation.x11_target_index = operation.x11_target_count;
            },
            .refused => operation.x11_target_index += 1,
            .limit_exceeded => {
                x11.cleanupRead(&operation.x11_read);
                return service.finishOperation(operation, .limit_exceeded);
            },
            .failed => {
                x11.cleanupRead(&operation.x11_read);
                operation.rememberFailure(.x11_transfer, "X11 clipboard property transfer failed");
                return service.finishOperation(operation, .failed);
            },
        }

        while (true) {
            if (operation.x11_target_index < operation.x11_target_count) {
                operation.x11_read.phase = .refused;
                if (!x11.beginRead(
                    &operation.x11_read,
                    operation.selection == .primary,
                    operation.x11_targets[operation.x11_target_index],
                    operation.max_bytes,
                )) {
                    operation.rememberFailure(.x11_flush, "Failed to request X11 clipboard conversion");
                    return service.finishOperation(operation, .failed);
                }
                return .pending;
            }
            if (operation.result_mime.len > 0) {
                operation.allocator.free(operation.result_mime);
                operation.result_mime = &.{};
            }
            if (operation.preference_offset >= operation.request.len) {
                return service.finishOperation(
                    operation,
                    if (operation.implemented_candidate_attempted) .empty else .unsupported,
                );
            }
            const length = std.mem.readInt(u32, operation.request[operation.preference_offset..][0..4], .little);
            operation.preference_offset += 4;
            const preferred = operation.request[operation.preference_offset .. operation.preference_offset + length];
            operation.preference_offset += length;
            const targets = x11.targetAtoms(preferred, &operation.x11_targets);
            if (targets.len == 0) continue;
            operation.implemented_candidate_attempted = true;
            operation.result_mime = operation.allocator.dupe(u8, preferred) catch {
                operation.rememberFailure(.out_of_memory, "Failed to allocate X11 clipboard MIME result");
                return service.finishOperation(operation, .failed);
            };
            operation.x11_target_count = @intCast(targets.len);
            operation.x11_target_index = 0;
        }
    }

    fn driveX11Write(service: *Service, operation: *Operation) OperationStatus {
        const x11 = service.x11.?;
        if (service.hasEarlierSelectionMutation(operation)) return .pending;
        if (operation.x11_write.selection == 0 and !operation.x11_write.committed and !operation.x11_write.failed) {
            return switch (x11.beginWrite(
                &operation.x11_write,
                operation.selection == .primary,
                operation.request,
            )) {
                .pending => .pending,
                .unsupported => service.finishOperation(operation, .unsupported),
                .failed => service.finishX11Failure(operation),
                .ok, .committed => unreachable,
            };
        }
        return switch (x11.driveWrite(&operation.x11_write)) {
            .pending => .pending,
            .ok, .committed => blk: {
                operation.request = &.{};
                break :blk service.finishOperation(operation, .written);
            },
            .unsupported => service.finishOperation(operation, .unsupported),
            .failed => service.finishX11Failure(operation),
        };
    }

    fn driveX11Clear(service: *Service, operation: *Operation) OperationStatus {
        const x11 = service.x11.?;
        if (service.hasEarlierSelectionMutation(operation)) return .pending;
        if (operation.x11_write.selection == 0 and !operation.x11_write.committed and !operation.x11_write.failed) {
            return switch (x11.beginClear(&operation.x11_write, operation.selection == .primary)) {
                .pending => .pending,
                .unsupported => service.finishOperation(operation, .unsupported),
                .failed => service.finishX11Failure(operation),
                .ok, .committed => unreachable,
            };
        }
        return switch (x11.driveWrite(&operation.x11_write)) {
            .pending => .pending,
            .ok, .committed => service.finishOperation(operation, .cleared),
            .unsupported => service.finishOperation(operation, .unsupported),
            .failed => service.finishX11Failure(operation),
        };
    }

    fn finishX11Failure(service: *Service, operation: *Operation) OperationStatus {
        const failure = if (service.x11) |x11| x11.takeFailure() else .protocol;
        switch (failure) {
            .none, .connection, .protocol, .atom => operation.rememberFailure(.x11_protocol, "X11 clipboard protocol failed"),
            .flush => operation.rememberFailure(.x11_flush, "X11 clipboard output flush failed"),
            .provider => operation.rememberFailure(.x11_provider, "X11 clipboard provider failed"),
        }
        return service.finishOperation(operation, .failed);
    }

    fn hasEarlierSelectionMutation(service: *const Service, operation: *const Operation) bool {
        for (service.operations.items) |candidate| {
            if (candidate.status != .pending) continue;
            if (candidate.kind != .write and candidate.kind != .clear) continue;
            if (candidate.mutation_sequence < operation.mutation_sequence) return true;
        }
        return false;
    }

    fn finishOperation(_: *Service, operation: *Operation, status: OperationStatus) OperationStatus {
        if (status == .failed and operation.error_code == 0) {
            operation.rememberFailure(.internal, "Native clipboard operation failed");
        }
        operation.mutex.lock();
        defer operation.mutex.unlock();
        if (operation.status == .pending) operation.status = status;
        return operation.status;
    }

    fn finishWaylandFailure(service: *Service, operation: *Operation) OperationStatus {
        const failure = if (service.wayland) |wayland| wayland.takeFailure() else .protocol;
        switch (failure) {
            .none, .protocol => operation.rememberFailure(.wayland_protocol, "Wayland clipboard protocol failed"),
            .dispatch => operation.rememberFailure(.wayland_dispatch, "Wayland clipboard event dispatch failed"),
            .flush => operation.rememberFailure(.wayland_flush, "Wayland clipboard output flush failed"),
            .provider => operation.rememberFailure(.wayland_provider, "Wayland clipboard provider publication failed"),
        }
        return service.finishOperation(operation, .failed);
    }
};

fn selectionRequestCommitted(result: clipboard_wayland.SelectionResult) bool {
    return result == .ok or result == .committed;
}

fn waylandReadExhaustionStatus(implemented: bool, failed: bool) OperationStatus {
    if (failed) return .failed;
    return if (implemented) .empty else .unsupported;
}

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

pub fn createService(
    allocator: Allocator,
    max_operations: u32,
    max_provider_transfers: u32,
    wayland_seat_pointer: ?[*]const u8,
    wayland_seat_length: u32,
) Handle {
    if (max_operations == 0 or max_provider_transfers == 0) return 0;
    const configured_seat = sliceFromPointer(wayland_seat_pointer, wayland_seat_length) orelse return 0;
    var requested_wayland_seat: []u8 = &.{};
    var environment_wayland_seat: []u8 = &.{};
    const route: clipboard_linux.Route = switch (builtin.os.tag) {
        .linux => blk: {
            var env = std.process.getEnvMap(allocator) catch return 0;
            defer env.deinit();
            if (configured_seat.len > 0) {
                requested_wayland_seat = allocator.dupe(u8, configured_seat) catch return 0;
            } else if (env.get("XDG_SEAT")) |seat| {
                if (seat.len > 0) environment_wayland_seat = allocator.dupe(u8, seat) catch return 0;
            }
            break :blk clipboard_linux.initialize(clipboard_linux.Environment.detect(&env));
        },
        else => .unsupported,
    };
    const service = allocator.create(Service) catch {
        if (requested_wayland_seat.len > 0) allocator.free(requested_wayland_seat);
        if (environment_wayland_seat.len > 0) allocator.free(environment_wayland_seat);
        return 0;
    };
    service.* = .{
        .allocator = allocator,
        .max_operations = max_operations,
        .max_provider_transfers = max_provider_transfers,
        .route = route,
        .requested_wayland_seat = requested_wayland_seat,
        .environment_wayland_seat = environment_wayland_seat,
    };
    if (comptime builtin.os.tag == .windows or builtin.os.tag == .macos) {
        service.platform_queue.ensureTotalCapacity(allocator, max_operations) catch {
            service.deinit();
            return 0;
        };
    }
    const service_handle = handles.insert(.clipboard_service, erasePtr(service)) catch {
        service.deinit();
        return 0;
    };
    if (comptime builtin.os.tag == .windows or builtin.os.tag == .macos) {
        service.platform_thread = std.Thread.spawn(.{}, Service.platformWorker, .{service}) catch {
            handles.invalidate(service_handle, .clipboard_service);
            service.deinit();
            return 0;
        };
    }
    return service_handle;
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
        .kind = .test_read,
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
    operation.worker_joined = false;
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

fn parseSelection(value: u8) ?Selection {
    return std.meta.intToEnum(Selection, value) catch null;
}

fn validateReadRequest(request: []const u8) bool {
    if (request.len < @sizeOf(u32)) return false;
    const count = std.mem.readInt(u32, request[0..4], .little);
    if (count == 0) return false;

    var offset: usize = 4;
    var index: u32 = 0;
    while (index < count) : (index += 1) {
        if (request.len - offset < @sizeOf(u32)) return false;
        const length = std.mem.readInt(u32, request[offset..][0..4], .little);
        offset += 4;
        if (length == 0 or length > request.len - offset) return false;
        offset += length;
    }
    return offset == request.len;
}

fn startImmediateOperation(
    service: *Service,
    service_handle: Handle,
    kind: OperationKind,
    request: []const u8,
    timeout_ms: u32,
    max_bytes: u32,
    selection: Selection,
    out_handle: *Handle,
) StartStatus {
    const owned_request = service.allocator.dupe(u8, request) catch return .out_of_memory;
    const operation = service.allocator.create(Operation) catch {
        if (owned_request.len > 0) service.allocator.free(owned_request);
        return .out_of_memory;
    };
    operation.* = .{
        .allocator = service.allocator,
        .service = service,
        .kind = kind,
        .request = owned_request,
        .status = if (timeout_ms == 0) .timed_out else .pending,
        .worker_joined = true,
        .timeout_ms = timeout_ms,
        .started_ns = std.time.nanoTimestamp(),
        .max_bytes = max_bytes,
        .selection = selection,
        .mutation_sequence = if (kind == .write or kind == .clear) service.takeMutationSequence() else 0,
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
    if (comptime builtin.os.tag == .windows or builtin.os.tag == .macos) {
        if (operation.status == .pending) service.enqueuePlatformOperation(operation);
    }
    out_handle.* = operation_handle;
    return .ok;
}

pub fn startReadOperation(
    service_handle: Handle,
    request_pointer: ?[*]const u8,
    request_length: u32,
    selection_value: u8,
    max_bytes: u32,
    timeout_ms: u32,
    out_operation_handle: ?*Handle,
) StartStatus {
    const out_handle = out_operation_handle orelse return .invalid_argument;
    out_handle.* = 0;
    const service = acquireService(service_handle) orelse return .invalid_service;
    if (service.shutting_down) return .shutting_down;
    if (service.operations.items.len >= service.max_operations) return .limit_exceeded;
    const selection = parseSelection(selection_value) orelse return .invalid_argument;
    const request = sliceFromPointer(request_pointer, request_length) orelse return .invalid_argument;
    if (!validateReadRequest(request)) return .invalid_argument;
    return startImmediateOperation(service, service_handle, .read, request, timeout_ms, max_bytes, selection, out_handle);
}

pub fn startWriteOperation(
    service_handle: Handle,
    text_pointer: ?[*]const u8,
    text_length: u32,
    selection_value: u8,
    timeout_ms: u32,
    out_operation_handle: ?*Handle,
) StartStatus {
    const out_handle = out_operation_handle orelse return .invalid_argument;
    out_handle.* = 0;
    const service = acquireService(service_handle) orelse return .invalid_service;
    if (service.shutting_down) return .shutting_down;
    if (service.operations.items.len >= service.max_operations) return .limit_exceeded;
    const selection = parseSelection(selection_value) orelse return .invalid_argument;
    const text = sliceFromPointer(text_pointer, text_length) orelse return .invalid_argument;
    if (text.len == 0 or std.mem.indexOfScalar(u8, text, 0) != null) return .invalid_argument;
    return startImmediateOperation(service, service_handle, .write, text, timeout_ms, 0, selection, out_handle);
}

pub fn startClearOperation(
    service_handle: Handle,
    selection_value: u8,
    timeout_ms: u32,
    out_operation_handle: ?*Handle,
) StartStatus {
    const out_handle = out_operation_handle orelse return .invalid_argument;
    out_handle.* = 0;
    const service = acquireService(service_handle) orelse return .invalid_service;
    if (service.shutting_down) return .shutting_down;
    if (service.operations.items.len >= service.max_operations) return .limit_exceeded;
    const selection = parseSelection(selection_value) orelse return .invalid_argument;
    return startImmediateOperation(service, service_handle, .clear, "", timeout_ms, 0, selection, out_handle);
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
        .mime => if (operation.status == .read)
            (if (operation.kind == .test_read) TEST_MIME else operation.result_mime)
        else
            null,
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

pub fn drainService(service_handle: Handle) u8 {
    const service = acquireService(service_handle) orelse return 2;
    if (service.shutting_down) return 0;
    if (comptime builtin.os.tag != .linux) return 0;
    var active = false;
    const mechanism = service.drain_mechanism;
    service.drain_mechanism = if (mechanism == .wayland) .x11 else .wayland;
    switch (mechanism) {
        .wayland => if (service.wayland) |wayland| {
            switch (wayland.drive()) {
                .failed => wayland.retireProviders(),
                else => {},
            }
            active = wayland.driveProviderUnit();
        },
        .x11 => if (service.x11) |x11| {
            service.driveX11EventUnit();
            active = x11.driveProviderUnit();
        },
    }
    if (service.wayland) |wayland| active = active or wayland.hasWork();
    if (service.x11) |x11| active = active or x11.hasWork();
    return if (active) 1 else 0;
}

test "clipboard status values are stable" {
    try std.testing.expectEqual(@as(u8, 0), @intFromEnum(OperationStatus.pending));
    try std.testing.expectEqual(@as(u8, 1), @intFromEnum(OperationStatus.read));
    try std.testing.expectEqual(@as(u8, 10), @intFromEnum(OperationStatus.invalid_handle));
    try std.testing.expectEqual(@as(u8, 1), @intFromEnum(CopyStatus.buffer_too_small));
    try std.testing.expectEqual(@as(u8, 2), @intFromEnum(DestroyStatus.invalid_handle));
}

test "clipboard worker copies input and rejects stale handles" {
    const service = createService(std.testing.allocator, 2, 16, null, 0);
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
    const first_service = createService(std.testing.allocator, 1, 16, null, 0);
    const second_service = createService(std.testing.allocator, 1, 16, null, 0);
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
    const first_cancel = cancelOperation(first_operation);
    try std.testing.expect(first_cancel == .requested or first_cancel == .already_terminal);
    const repeated_cancel = cancelOperation(first_operation);
    try std.testing.expect(repeated_cancel == .requested or repeated_cancel == .already_terminal);
    _ = beginServiceShutdown(first_service);
    while (pollServiceShutdown(first_service) == .pending) std.Thread.yield() catch {};
    try std.testing.expectEqual(DestroyStatus.destroyed, destroyService(first_service));
    try std.testing.expectEqual(OperationStatus.invalid_handle, pollOperation(first_operation));

    while (pollOperation(second_operation) == .pending) std.Thread.yield() catch {};
    try std.testing.expectEqual(OperationStatus.read, pollOperation(second_operation));
    try std.testing.expectEqual(DestroyStatus.destroyed, destroyOperation(second_operation));
}

test "clipboard production operations validate requests and remain unsupported until platform protocols exist" {
    const service = createService(std.testing.allocator, 3, 16, null, 0);
    try std.testing.expect(service != 0);
    acquireService(service).?.route = .unsupported;
    defer {
        _ = beginServiceShutdown(service);
        while (pollServiceShutdown(service) == .pending) std.Thread.yield() catch {};
        _ = destroyService(service);
    }

    var operation: Handle = 0;
    const malformed_read = [_]u8{ 1, 0, 0, 0, 4, 0, 0, 0, 't' };
    try std.testing.expectEqual(
        StartStatus.invalid_argument,
        startReadOperation(service, &malformed_read, malformed_read.len, 0, 1024, 100, &operation),
    );
    try std.testing.expectEqual(@as(Handle, 0), operation);

    const read_request = [_]u8{ 1, 0, 0, 0, 10, 0, 0, 0 } ++ "text/plain".*;
    try std.testing.expectEqual(
        StartStatus.ok,
        startReadOperation(service, &read_request, read_request.len, 0, 1024, 100, &operation),
    );
    try std.testing.expectEqual(OperationStatus.unsupported, pollOperation(operation));
    try std.testing.expectEqual(DestroyStatus.destroyed, destroyOperation(operation));

    try std.testing.expectEqual(
        StartStatus.invalid_argument,
        startWriteOperation(service, "bad\x00text", 8, 0, 100, &operation),
    );
    try std.testing.expectEqual(
        StartStatus.ok,
        startClearOperation(service, 1, 0, &operation),
    );
    try std.testing.expectEqual(OperationStatus.timed_out, pollOperation(operation));
    try std.testing.expectEqual(DestroyStatus.destroyed, destroyOperation(operation));
}

test "clipboard zero-byte final image candidate exhausts as empty" {
    try std.testing.expectEqual(OperationStatus.empty, waylandReadExhaustionStatus(true, false));
    try std.testing.expectEqual(OperationStatus.unsupported, waylandReadExhaustionStatus(false, false));
    try std.testing.expectEqual(OperationStatus.failed, waylandReadExhaustionStatus(true, true));
}

test "clipboard Wayland selection requests settle when committed before flush completion" {
    try std.testing.expect(selectionRequestCommitted(.ok));
    try std.testing.expect(selectionRequestCommitted(.committed));
    try std.testing.expect(!selectionRequestCommitted(.pending));
    try std.testing.expect(!selectionRequestCommitted(.unsupported));
    try std.testing.expect(!selectionRequestCommitted(.failed));
}

test "clipboard failed operations always publish a portable diagnostic" {
    var operation: Operation = .{
        .allocator = std.testing.allocator,
        .service = undefined,
        .kind = .read,
        .worker_joined = true,
    };
    var service: Service = undefined;

    try std.testing.expectEqual(OperationStatus.failed, service.finishOperation(&operation, .failed));
    try std.testing.expect(operation.error_code != 0);
    try std.testing.expect(operation.diagnostic.len > 0);
}

test "clipboard mutation ordering is stable when operation storage is reordered" {
    var service: Service = undefined;
    var earlier: Operation = .{
        .allocator = std.testing.allocator,
        .service = &service,
        .kind = .write,
        .mutation_sequence = 2,
        .worker_joined = true,
    };
    var later: Operation = .{
        .allocator = std.testing.allocator,
        .service = &service,
        .kind = .clear,
        .mutation_sequence = 3,
        .worker_joined = true,
    };
    var storage = [_]*Operation{ &later, &earlier };
    service.operations = .{ .items = &storage, .capacity = storage.len };

    try std.testing.expect(service.hasEarlierSelectionMutation(&later));
    try std.testing.expect(!service.hasEarlierSelectionMutation(&earlier));
}
