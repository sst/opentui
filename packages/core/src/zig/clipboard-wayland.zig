const std = @import("std");
const builtin = @import("builtin");
const linux = @import("clipboard-linux.zig");
const protocol = @import("clipboard-wayland-protocol.zig");

const WlArgument = linux.WlArgument;
const WlInterface = linux.WlInterface;
const WlProxy = linux.WlProxy;
const MAX_SEATS = 16;
const MAX_SEAT_NAME_BYTES = 255;
const MAX_OFFERS = 8;
const MAX_MIME_TYPES = 64;
const MAX_MIME_BYTES = 255;
const MAX_PROVIDERS = 4;
const PROVIDER_TRANSFER_IDLE_TIMEOUT_NS = 30 * std.time.ns_per_s;

pub const Progress = enum { pending, ready, unsupported, failed };
pub const SelectionResult = enum { ok, pending, committed, unsupported, failed };
const FlushResult = enum { complete, pending, failed };
const FlushOutcome = struct { result: c_int, errno: std.posix.E };

pub const Failure = enum {
    none,
    protocol,
    dispatch,
    flush,
    provider,
};

const Phase = enum { idle, registry, seats, device, ready, unsupported, failed };

const Seat = struct {
    global_name: u32,
    proxy: *WlProxy,
    name: [MAX_SEAT_NAME_BYTES]u8 = undefined,
    name_length: u8 = 0,

    fn nameSlice(self: *const Seat) []const u8 {
        return self.name[0..self.name_length];
    }
};

const Mime = struct {
    bytes: [MAX_MIME_BYTES]u8,
    length: u8,

    fn slice(self: *const Mime) []const u8 {
        return self.bytes[0..self.length];
    }
};

pub const Offer = struct {
    proxy: *WlProxy,
    mimes: [MAX_MIME_TYPES]Mime = undefined,
    mime_count: u8 = 0,
};

const Transfer = struct {
    fd: std.posix.fd_t,
    offset: usize = 0,
    last_progress_ns: i128,
};

const Provider = struct {
    connection: *Connection,
    source: *WlProxy,
    primary: bool,
    data: []u8,
    transfers: []Transfer,
    transfer_count: u32 = 0,
    transfer_cursor: u32 = 0,
    retired: bool = false,
};

pub const Connection = struct {
    allocator: std.mem.Allocator,
    symbols: *const linux.WaylandSymbols,
    max_provider_transfers: u32,
    display: ?*linux.WlDisplay = null,
    registry: ?*WlProxy = null,
    sync_callback: ?*WlProxy = null,
    phase: Phase = .idle,
    sync_done: bool = false,
    output_pending: bool = false,
    failure: Failure = .none,
    ext_global: ?u32 = null,
    wlr_global: ?u32 = null,
    wlr_version: u32 = 0,
    seats: [MAX_SEATS]Seat = undefined,
    seat_count: u8 = 0,
    seats_overflowed: bool = false,
    requested_seat: []const u8,
    environment_seat: []const u8,
    metadata: protocol.Metadata = undefined,
    manager: ?*WlProxy = null,
    bound_manager_global: ?u32 = null,
    device: ?*WlProxy = null,
    offers: [MAX_OFFERS]Offer = undefined,
    offer_count: u8 = 0,
    clipboard_offer: ?*WlProxy = null,
    primary_offer: ?*WlProxy = null,
    primary_supported: bool = false,
    primary_event_seen: bool = false,
    bound_seat_global: ?u32 = null,
    providers: [MAX_PROVIDERS]?*Provider = .{null} ** MAX_PROVIDERS,
    clipboard_provider: ?*Provider = null,
    primary_provider: ?*Provider = null,
    provider_cursor: u8 = 0,
    flush_outcome_override: ?FlushOutcome = null,
    test_marshal_count: u8 = 0,
    test_flush_marshal_count: u8 = 0,

    pub fn init(
        allocator: std.mem.Allocator,
        symbols: *const linux.WaylandSymbols,
        requested_seat: []const u8,
        environment_seat: []const u8,
        max_provider_transfers: u32,
    ) Connection {
        return .{
            .allocator = allocator,
            .symbols = symbols,
            .requested_seat = requested_seat,
            .environment_seat = environment_seat,
            .max_provider_transfers = max_provider_transfers,
        };
    }

    pub fn deinit(self: *Connection) void {
        self.releaseProviders();
        for (self.offers[0..self.offer_count]) |offer| self.destroyProtocolProxy(offer.proxy, 1);
        if (self.device) |device| self.destroyProtocolProxy(device, 1);
        if (self.manager) |manager| self.destroyProtocolProxy(manager, 2);
        for (self.seats[0..self.seat_count]) |seat| self.symbols.wl_proxy_destroy(seat.proxy);
        if (self.sync_callback) |callback| self.symbols.wl_proxy_destroy(callback);
        if (self.registry) |registry| self.symbols.wl_proxy_destroy(registry);
        if (self.display != null) _ = self.queueFlush();
        if (self.display) |display| self.symbols.wl_display_disconnect(display);
        self.* = undefined;
    }

    pub fn drive(self: *Connection) Progress {
        if (self.output_pending) {
            switch (self.flushOutput()) {
                .complete => {},
                .pending => return .pending,
                .failed => return self.fail(.flush),
            }
        }
        switch (self.phase) {
            .idle => self.start() catch |err| switch (err) {
                error.ConnectFailed => {
                    self.phase = .unsupported;
                    return .unsupported;
                },
                else => return self.fail(.protocol),
            },
            .unsupported => return .unsupported,
            .failed => return .failed,
            .ready => {
                if (!self.dispatchAvailable()) return self.fail(.dispatch);
                return if (self.phase == .ready) .ready else .failed;
            },
            else => {},
        }

        if (!self.dispatchAvailable()) {
            return self.fail(.dispatch);
        }
        if (!self.sync_done) return .pending;

        self.sync_done = false;
        switch (self.phase) {
            .registry => {
                if (self.ext_global == null and self.wlr_global == null) {
                    self.phase = .unsupported;
                    return .unsupported;
                }
                self.phase = .seats;
                if (!self.sendSync()) return self.fail(.protocol);
            },
            .seats => {
                switch (self.bindDevice()) {
                    .ok, .pending => {},
                    .committed => unreachable,
                    .unsupported => {
                        self.phase = .unsupported;
                        return .unsupported;
                    },
                    .failed => return self.fail(.protocol),
                }
                self.phase = .device;
                if (!self.sendSync()) return self.fail(.protocol);
            },
            .device => {
                self.primary_supported = self.primary_event_seen;
                self.phase = .ready;
            },
            else => {},
        }
        return if (self.phase == .ready) .ready else .pending;
    }

    pub fn currentOffer(self: *Connection, primary: bool) ?*const Offer {
        const proxy = if (primary) self.primary_offer else self.clipboard_offer;
        const selected = proxy orelse return null;
        for (self.offers[0..self.offer_count]) |*offer| {
            if (offer.proxy == selected) return offer;
        }
        return null;
    }

    pub fn takeFailure(self: *Connection) Failure {
        const failure = self.failure;
        if (self.phase == .ready) self.failure = .none;
        return failure;
    }

    pub fn receive(self: *Connection, offer: *const Offer, mime: []const u8, fd: std.posix.fd_t) bool {
        if (mime.len > MAX_MIME_BYTES) return false;
        var mime_z: [MAX_MIME_BYTES:0]u8 = undefined;
        @memcpy(mime_z[0..mime.len], mime);
        mime_z[mime.len] = 0;
        var arguments = [_]WlArgument{ .{ .s = mime_z[0..mime.len :0].ptr }, .{ .h = fd } };
        _ = self.marshal(offer.proxy, 0, null, 1, 0, &arguments);
        return self.queueFlush() != .failed;
    }

    pub fn publishText(self: *Connection, primary: bool, data: []u8) SelectionResult {
        self.failure = .none;
        if (primary and !self.primary_supported) return .unsupported;
        const manager = self.manager orelse return self.selectionFailure(.protocol);
        const device = self.device orelse return self.selectionFailure(.protocol);
        if (!self.canPublishProvider(primary)) return self.selectionFailure(.provider);
        const slot = self.freeProviderSlot() orelse return self.selectionFailure(.provider);
        const provider = self.allocator.create(Provider) catch return self.selectionFailure(.provider);
        const transfers = self.allocator.alloc(Transfer, self.max_provider_transfers) catch {
            self.allocator.destroy(provider);
            return self.selectionFailure(.provider);
        };
        const source = self.marshal(manager, 0, &self.metadata.source, 1, 0, &.{}) orelse {
            self.allocator.free(transfers);
            self.allocator.destroy(provider);
            return self.selectionFailure(.provider);
        };
        provider.* = .{
            .connection = self,
            .source = source,
            .primary = primary,
            .data = data,
            .transfers = transfers,
        };
        if (self.symbols.wl_proxy_add_listener(source, source_listener[0..].ptr, provider) != 0 or
            !self.offerSource(source, "text/plain") or
            !self.offerSource(source, "text/plain;charset=utf-8"))
        {
            self.symbols.wl_proxy_destroy(source);
            self.allocator.free(transfers);
            self.allocator.destroy(provider);
            return self.selectionFailure(.provider);
        }
        var arguments = [_]WlArgument{.{ .o = source }};
        _ = self.marshal(device, if (primary) 2 else 0, null, self.symbols.wl_proxy_get_version(device), 0, &arguments);
        const flush_result = self.queueFlush();
        const previous = if (primary) self.primary_provider else self.clipboard_provider;
        if (previous) |old| self.retireProvider(old);
        slot.* = provider;
        if (primary) self.primary_provider = provider else self.clipboard_provider = provider;
        if (flush_result == .failed) self.phase = .failed;
        return if (flush_result == .complete) .ok else .committed;
    }

    pub fn clearSelection(self: *Connection, primary: bool) SelectionResult {
        self.failure = .none;
        if (primary and !self.primary_supported) return .unsupported;
        const device = self.device orelse return self.selectionFailure(.protocol);
        if (!self.canRetireCurrentProvider(primary)) return self.selectionFailure(.provider);
        var arguments = [_]WlArgument{.{ .o = null }};
        _ = self.marshal(device, if (primary) 2 else 0, null, self.symbols.wl_proxy_get_version(device), 0, &arguments);
        const flush_result = self.queueFlush();
        const provider = if (primary) self.primary_provider else self.clipboard_provider;
        if (provider) |value| self.retireProvider(value);
        if (primary) self.primary_provider = null else self.clipboard_provider = null;
        if (flush_result == .failed) self.phase = .failed;
        return if (flush_result == .complete) .ok else .committed;
    }

    pub fn hasProviders(self: *const Connection) bool {
        for (self.providers) |provider| if (provider != null) return true;
        return false;
    }

    pub fn hasWork(self: *const Connection) bool {
        return self.output_pending or self.hasProviders();
    }

    pub fn releaseProviders(self: *Connection) void {
        for (&self.providers) |*slot| {
            const provider = slot.* orelse continue;
            self.freeProvider(provider);
            slot.* = null;
        }
        self.clipboard_provider = null;
        self.primary_provider = null;
        if (self.display != null) _ = self.queueFlush();
    }

    pub fn retireProviders(self: *Connection) void {
        self.clipboard_provider = null;
        self.primary_provider = null;
        for (&self.providers) |*slot| {
            const provider = slot.* orelse continue;
            provider.retired = true;
            if (provider.transfer_count > 0) continue;
            self.freeProvider(provider);
            slot.* = null;
        }
    }

    pub fn driveProviderUnit(self: *Connection) bool {
        var visited: u8 = 0;
        while (visited < MAX_PROVIDERS) : (visited += 1) {
            const slot_index = self.provider_cursor;
            self.provider_cursor = (self.provider_cursor + 1) % MAX_PROVIDERS;
            const provider = self.providers[slot_index] orelse continue;
            if (provider.retired and provider.transfer_count == 0) {
                self.retireProvider(provider);
                continue;
            }
            if (provider.transfer_count == 0) continue;
            const transfer_index = provider.transfer_cursor % provider.transfer_count;
            provider.transfer_cursor = (provider.transfer_cursor + 1) % provider.transfer_count;
            self.driveProviderTransfer(provider, transfer_index);
            break;
        }
        return self.hasWork();
    }

    pub fn offeredMime(offer: *const Offer, preferred: []const u8) ?[]const u8 {
        for (offer.mimes[0..offer.mime_count]) |*mime| {
            if (std.ascii.eqlIgnoreCase(mime.slice(), preferred)) return mime.slice();
            if (std.ascii.eqlIgnoreCase(preferred, "text/plain") and
                (std.ascii.eqlIgnoreCase(mime.slice(), "text/plain;charset=utf-8") or
                    std.ascii.eqlIgnoreCase(mime.slice(), "text/plain;charset=UTF-8")))
            {
                return mime.slice();
            }
        }
        return null;
    }

    fn start(self: *Connection) !void {
        const display = self.symbols.wl_display_connect(null) orelse return error.ConnectFailed;
        self.display = display;
        const registry = self.marshal(@ptrCast(display), 1, self.symbols.wl_registry_interface, 1, 0, &.{}) orelse
            return error.RegistryFailed;
        self.registry = registry;
        if (self.addListener(registry, &registry_listener) != 0) return error.ListenerFailed;
        self.phase = .registry;
        if (!self.sendSync()) return error.SyncFailed;
        if (self.queueFlush() == .failed) return error.FlushFailed;
    }

    fn sendSync(self: *Connection) bool {
        const display = self.display orelse return false;
        const callback = self.marshal(@ptrCast(display), 0, self.symbols.wl_callback_interface, 1, 0, &.{}) orelse
            return false;
        self.sync_callback = callback;
        return self.addListener(callback, &callback_listener) == 0 and self.queueFlush() != .failed;
    }

    fn dispatchAvailable(self: *Connection) bool {
        const display = self.display orelse return false;
        if (self.dispatchPending(display) < 0) return false;
        if (self.queueFlush() == .failed) return false;
        if (self.symbols.wl_display_prepare_read(display) != 0) {
            return self.dispatchPending(display) >= 0;
        }

        var descriptor = [_]std.posix.pollfd{.{
            .fd = self.symbols.wl_display_get_fd(display),
            .events = std.posix.POLL.IN,
            .revents = 0,
        }};
        const count = std.posix.poll(&descriptor, 0) catch {
            self.symbols.wl_display_cancel_read(display);
            return false;
        };
        if (count == 0 or descriptor[0].revents & std.posix.POLL.IN == 0) {
            self.symbols.wl_display_cancel_read(display);
            return descriptor[0].revents & (std.posix.POLL.ERR | std.posix.POLL.HUP | std.posix.POLL.NVAL) == 0;
        }
        if (self.symbols.wl_display_read_events(display) < 0) return false;
        return self.dispatchPending(display) >= 0;
    }

    fn dispatchPending(self: *Connection, display: *linux.WlDisplay) c_int {
        return self.symbols.wl_display_dispatch_pending_single(display);
    }

    fn queueFlush(self: *Connection) FlushResult {
        const result = self.flushOutput();
        if (result == .failed and self.failure == .none) self.failure = .flush;
        self.output_pending = result == .pending;
        return result;
    }

    fn flushOutput(self: *Connection) FlushResult {
        if (comptime builtin.is_test) {
            if (self.flush_outcome_override) |outcome| {
                self.test_flush_marshal_count = self.test_marshal_count;
                const flush_result = classifyFlush(outcome.result, outcome.errno);
                self.output_pending = flush_result == .pending;
                return flush_result;
            }
        }
        const result = self.symbols.wl_display_flush(self.display.?);
        const flush_result = classifyFlush(result, if (result < 0) std.posix.errno(result) else .SUCCESS);
        self.output_pending = flush_result == .pending;
        return flush_result;
    }

    fn offerSource(self: *Connection, source: *WlProxy, mime: []const u8) bool {
        if (mime.len > MAX_MIME_BYTES) return false;
        var mime_z: [MAX_MIME_BYTES:0]u8 = undefined;
        @memcpy(mime_z[0..mime.len], mime);
        mime_z[mime.len] = 0;
        var arguments = [_]WlArgument{.{ .s = mime_z[0..mime.len :0].ptr }};
        _ = self.marshal(source, 0, null, 1, 0, &arguments);
        return true;
    }

    fn freeProviderSlot(self: *Connection) ?*?*Provider {
        for (&self.providers) |*slot| if (slot.* == null) return slot;
        return null;
    }

    fn canPublishProvider(self: *const Connection, primary: bool) bool {
        var count: u8 = 0;
        for (self.providers) |candidate| {
            const provider = candidate orelse continue;
            if (provider.primary == primary) count += 1;
        }
        return count < 2;
    }

    fn canRetireCurrentProvider(self: *const Connection, primary: bool) bool {
        const current = if (primary) self.primary_provider else self.clipboard_provider;
        return current == null or self.canPublishProvider(primary);
    }

    fn retireProvider(self: *Connection, provider: *Provider) void {
        if (self.clipboard_provider == provider) self.clipboard_provider = null;
        if (self.primary_provider == provider) self.primary_provider = null;
        provider.retired = true;
        if (provider.transfer_count > 0) return;
        for (&self.providers) |*slot| {
            if (slot.* != provider) continue;
            self.freeProvider(provider);
            slot.* = null;
            return;
        }
    }

    fn freeProvider(self: *Connection, provider: *Provider) void {
        for (provider.transfers[0..provider.transfer_count]) |transfer| std.posix.close(transfer.fd);
        self.allocator.free(provider.transfers);
        if (provider.data.len > 0) self.allocator.free(provider.data);
        self.destroyProtocolProxy(provider.source, 1);
        self.allocator.destroy(provider);
    }

    fn destroyProtocolProxy(self: *Connection, proxy: *WlProxy, opcode: u32) void {
        _ = self.marshal(proxy, opcode, null, self.symbols.wl_proxy_get_version(proxy), 1, &.{});
    }

    fn driveProviderTransfer(_: *Connection, provider: *Provider, index: u32) void {
        const transfer = &provider.transfers[index];
        const now_ns = std.time.nanoTimestamp();
        if (providerTransferExpired(transfer.last_progress_ns, now_ns)) {
            finishProviderTransfer(provider, index);
            return;
        }
        const remaining = provider.data[transfer.offset..];
        const chunk = remaining[0..@min(remaining.len, 64 * 1024)];
        const count = std.posix.write(transfer.fd, chunk) catch |err| switch (err) {
            error.WouldBlock => return,
            else => 0,
        };
        transfer.offset += count;
        if (count > 0) transfer.last_progress_ns = now_ns;
        if (count == 0 or transfer.offset == provider.data.len) {
            finishProviderTransfer(provider, index);
        }
    }

    fn bindDevice(self: *Connection) SelectionResult {
        const seat = self.selectSeat() orelse return .unsupported;
        const kind: protocol.Kind = if (self.ext_global != null) .ext else .wlr;
        self.metadata.init(kind, self.symbols.wl_seat_interface);
        const manager_version: u32 = if (kind == .ext) 1 else @min(self.wlr_version, 2);
        const manager_global = if (kind == .ext) self.ext_global.? else self.wlr_global.?;
        const manager = self.bind(manager_global, &self.metadata.manager, manager_version) orelse return .failed;
        self.manager = manager;
        self.bound_manager_global = manager_global;
        var arguments = [_]WlArgument{ .{ .n = 0 }, .{ .o = seat.proxy } };
        const device = self.marshal(manager, 1, &self.metadata.device, manager_version, 0, &arguments) orelse return .failed;
        self.device = device;
        self.bound_seat_global = seat.global_name;
        if (self.addListener(device, &device_listener) != 0) return .failed;
        self.primary_supported = false;
        return switch (self.queueFlush()) {
            .complete => .ok,
            .pending => .pending,
            .failed => .failed,
        };
    }

    fn selectSeat(self: *Connection) ?*Seat {
        if (self.seats_overflowed or self.seat_count == 0) return null;
        if (self.requested_seat.len > 0) {
            for (self.seats[0..self.seat_count]) |*seat| {
                if (std.mem.eql(u8, seat.nameSlice(), self.requested_seat)) return seat;
            }
            return null;
        }
        if (self.environment_seat.len > 0) {
            for (self.seats[0..self.seat_count]) |*seat| {
                if (std.mem.eql(u8, seat.nameSlice(), self.environment_seat)) return seat;
            }
        }
        if (self.seat_count != 1) return null;
        return &self.seats[0];
    }

    fn bind(self: *Connection, name: u32, interface: *const WlInterface, version: u32) ?*WlProxy {
        var arguments = [_]WlArgument{
            .{ .u = name },
            .{ .s = interface.name },
            .{ .u = version },
            .{ .n = 0 },
        };
        return self.marshal(self.registry.?, 0, interface, version, 0, &arguments);
    }

    fn marshal(
        self: *Connection,
        proxy: *WlProxy,
        opcode: u32,
        interface: ?*const WlInterface,
        version: u32,
        flags: u32,
        arguments: []const WlArgument,
    ) ?*WlProxy {
        if (comptime builtin.is_test) self.test_marshal_count += 1;
        var empty: [1]WlArgument = undefined;
        const pointer: [*]WlArgument = if (arguments.len == 0) &empty else @constCast(arguments.ptr);
        return self.symbols.wl_proxy_marshal_array_flags(proxy, opcode, interface, version, flags, pointer);
    }

    fn addListener(self: *Connection, proxy: *WlProxy, listener: []const *const anyopaque) c_int {
        return self.symbols.wl_proxy_add_listener(proxy, listener.ptr, self);
    }

    fn fail(self: *Connection, failure: Failure) Progress {
        if (self.failure == .none) self.failure = failure;
        self.phase = .failed;
        return .failed;
    }

    fn selectionFailure(self: *Connection, failure: Failure) SelectionResult {
        if (self.failure == .none) self.failure = failure;
        return .failed;
    }

    fn registryGlobal(
        data: ?*anyopaque,
        _: ?*WlProxy,
        name: u32,
        interface_pointer: [*:0]const u8,
        version: u32,
    ) callconv(.c) void {
        const self: *Connection = @ptrCast(@alignCast(data.?));
        const interface = std.mem.span(interface_pointer);
        if (std.mem.eql(u8, interface, "ext_data_control_manager_v1")) {
            self.ext_global = name;
        } else if (std.mem.eql(u8, interface, "zwlr_data_control_manager_v1")) {
            self.wlr_global = name;
            self.wlr_version = version;
        } else if (std.mem.eql(u8, interface, "wl_seat")) {
            self.addSeat(name, version);
        }
    }

    fn registryGlobalRemove(data: ?*anyopaque, _: ?*WlProxy, name: u32) callconv(.c) void {
        const self: *Connection = @ptrCast(@alignCast(data.?));
        if (self.removeGlobal(name)) |proxy| self.symbols.wl_proxy_destroy(proxy);
    }

    fn removeGlobal(self: *Connection, name: u32) ?*WlProxy {
        if (self.ext_global == name) self.ext_global = null;
        if (self.wlr_global == name) {
            self.wlr_global = null;
            self.wlr_version = 0;
        }
        if (self.bound_manager_global == name) {
            const manager = self.manager;
            self.manager = null;
            self.bound_manager_global = null;
            return manager;
        }

        var index: u8 = 0;
        while (index < self.seat_count) : (index += 1) {
            if (self.seats[index].global_name != name) continue;
            const proxy = self.seats[index].proxy;
            self.seat_count -= 1;
            self.seats[index] = self.seats[self.seat_count];
            if (self.bound_seat_global == name) {
                self.failure = .protocol;
                self.phase = .failed;
            }
            return proxy;
        }
        return null;
    }

    fn addSeat(self: *Connection, name: u32, version: u32) void {
        if (self.seat_count == MAX_SEATS) {
            self.seats_overflowed = true;
            return;
        }
        const proxy = self.bind(name, self.symbols.wl_seat_interface, @min(version, 2)) orelse return;
        const seat = &self.seats[self.seat_count];
        seat.* = .{ .global_name = name, .proxy = proxy };
        self.seat_count += 1;
        _ = self.addListener(proxy, &seat_listener);
    }

    fn seatCapabilities(_: ?*anyopaque, _: ?*WlProxy, _: u32) callconv(.c) void {}

    fn seatName(data: ?*anyopaque, proxy: ?*WlProxy, name_pointer: [*:0]const u8) callconv(.c) void {
        const self: *Connection = @ptrCast(@alignCast(data.?));
        const name = std.mem.span(name_pointer);
        if (name.len > MAX_SEAT_NAME_BYTES) return;
        for (self.seats[0..self.seat_count]) |*seat| {
            if (seat.proxy != proxy) continue;
            @memcpy(seat.name[0..name.len], name);
            seat.name_length = @intCast(name.len);
            return;
        }
    }

    fn callbackDone(data: ?*anyopaque, callback: ?*WlProxy, _: u32) callconv(.c) void {
        const self: *Connection = @ptrCast(@alignCast(data.?));
        if (callback) |proxy| self.symbols.wl_proxy_destroy(proxy);
        self.sync_callback = null;
        self.sync_done = true;
    }

    fn deviceDataOffer(data: ?*anyopaque, _: ?*WlProxy, offer_proxy: ?*WlProxy) callconv(.c) void {
        const self: *Connection = @ptrCast(@alignCast(data.?));
        const proxy = offer_proxy orelse return;
        if (self.offer_count == MAX_OFFERS) {
            self.symbols.wl_proxy_destroy(proxy);
            return;
        }
        self.offers[self.offer_count] = .{ .proxy = proxy };
        self.offer_count += 1;
        _ = self.addListener(proxy, &offer_listener);
    }

    fn deviceSelection(data: ?*anyopaque, _: ?*WlProxy, offer: ?*WlProxy) callconv(.c) void {
        const self: *Connection = @ptrCast(@alignCast(data.?));
        if (self.clipboard_offer) |previous| {
            if (previous != offer and previous != self.primary_offer) self.removeOffer(previous);
        }
        self.clipboard_offer = offer;
    }

    fn deviceFinished(data: ?*anyopaque, _: ?*WlProxy) callconv(.c) void {
        const self: *Connection = @ptrCast(@alignCast(data.?));
        self.phase = .failed;
    }

    fn devicePrimarySelection(data: ?*anyopaque, _: ?*WlProxy, offer: ?*WlProxy) callconv(.c) void {
        const self: *Connection = @ptrCast(@alignCast(data.?));
        self.primary_event_seen = true;
        if (self.primary_offer) |previous| {
            if (previous != offer and previous != self.clipboard_offer) self.removeOffer(previous);
        }
        self.primary_offer = offer;
    }

    fn removeOffer(self: *Connection, proxy: *WlProxy) void {
        var index: u8 = 0;
        while (index < self.offer_count) : (index += 1) {
            if (self.offers[index].proxy != proxy) continue;
            self.destroyProtocolProxy(proxy, 1);
            self.offer_count -= 1;
            self.offers[index] = self.offers[self.offer_count];
            return;
        }
    }

    fn offerMime(data: ?*anyopaque, offer_proxy: ?*WlProxy, mime_pointer: [*:0]const u8) callconv(.c) void {
        const self: *Connection = @ptrCast(@alignCast(data.?));
        const proxy = offer_proxy orelse return;
        const mime = std.mem.span(mime_pointer);
        if (!isRelevantMime(mime)) return;
        for (self.offers[0..self.offer_count]) |*offer| {
            if (offer.proxy != proxy) continue;
            for (offer.mimes[0..offer.mime_count]) |*existing| {
                if (std.ascii.eqlIgnoreCase(existing.slice(), mime)) return;
            }
            if (offer.mime_count == MAX_MIME_TYPES) return;
            const entry = &offer.mimes[offer.mime_count];
            @memcpy(entry.bytes[0..mime.len], mime);
            entry.length = @intCast(mime.len);
            offer.mime_count += 1;
            return;
        }
    }

    fn sourceSend(data: ?*anyopaque, _: ?*WlProxy, mime_pointer: [*:0]const u8, fd: i32) callconv(.c) void {
        const provider: *Provider = @ptrCast(@alignCast(data.?));
        const mime = std.mem.span(mime_pointer);
        if ((!std.ascii.eqlIgnoreCase(mime, "text/plain") and
            !std.ascii.eqlIgnoreCase(mime, "text/plain;charset=utf-8")) or
            provider.retired or provider.transfer_count == provider.transfers.len)
        {
            std.posix.close(fd);
            return;
        }
        const flags = std.posix.fcntl(fd, std.posix.F.GETFL, 0) catch {
            std.posix.close(fd);
            return;
        };
        const nonblocking: u32 = @bitCast(std.posix.O{ .NONBLOCK = true });
        _ = std.posix.fcntl(fd, std.posix.F.SETFL, flags | nonblocking) catch {
            std.posix.close(fd);
            return;
        };
        provider.transfers[provider.transfer_count] = .{
            .fd = fd,
            .last_progress_ns = std.time.nanoTimestamp(),
        };
        provider.transfer_count += 1;
    }

    fn sourceCancelled(data: ?*anyopaque, _: ?*WlProxy) callconv(.c) void {
        const provider: *Provider = @ptrCast(@alignCast(data.?));
        provider.retired = true;
        if (provider.connection.clipboard_provider == provider) provider.connection.clipboard_provider = null;
        if (provider.connection.primary_provider == provider) provider.connection.primary_provider = null;
    }
};

fn finishProviderTransfer(provider: *Provider, index: u32) void {
    std.posix.close(provider.transfers[index].fd);
    provider.transfer_count -= 1;
    provider.transfers[index] = provider.transfers[provider.transfer_count];
    if (provider.transfer_count == 0) provider.transfer_cursor = 0 else provider.transfer_cursor %= provider.transfer_count;
}

fn providerTransferExpired(last_progress_ns: i128, now_ns: i128) bool {
    return now_ns - last_progress_ns >= PROVIDER_TRANSFER_IDLE_TIMEOUT_NS;
}

fn isRelevantMime(mime: []const u8) bool {
    return std.ascii.eqlIgnoreCase(mime, "image/png") or
        std.ascii.eqlIgnoreCase(mime, "text/plain") or
        std.ascii.eqlIgnoreCase(mime, "text/plain;charset=utf-8");
}

fn classifyFlush(result: c_int, errno: std.posix.E) FlushResult {
    if (result >= 0) return .complete;
    return if (errno == .AGAIN) .pending else .failed;
}

const registry_listener = [_]*const anyopaque{
    @ptrCast(&Connection.registryGlobal),
    @ptrCast(&Connection.registryGlobalRemove),
};
const seat_listener = [_]*const anyopaque{
    @ptrCast(&Connection.seatCapabilities),
    @ptrCast(&Connection.seatName),
};
const callback_listener = [_]*const anyopaque{@ptrCast(&Connection.callbackDone)};
const device_listener = [_]*const anyopaque{
    @ptrCast(&Connection.deviceDataOffer),
    @ptrCast(&Connection.deviceSelection),
    @ptrCast(&Connection.deviceFinished),
    @ptrCast(&Connection.devicePrimarySelection),
};
const offer_listener = [_]*const anyopaque{@ptrCast(&Connection.offerMime)};
const source_listener = [_]*const anyopaque{
    @ptrCast(&Connection.sourceSend),
    @ptrCast(&Connection.sourceCancelled),
};

test "Wayland connection negotiates data control without blocking when a compositor is available" {
    if (comptime builtin.os.tag != .linux) return;
    if (builtin.abi == .musl) return;
    const env = std.process.getEnvVarOwned(std.testing.allocator, "WAYLAND_DISPLAY") catch return;
    defer std.testing.allocator.free(env);
    if (linux.waylandSymbols() == null) {
        _ = linux.initialize(.{ .is_wsl = false, .has_wayland_display = true, .has_x11_display = false });
    }
    const symbols = linux.waylandSymbols() orelse return;
    var connection = Connection.init(std.testing.allocator, symbols, "", "", 16);
    defer connection.deinit();
    var progress: Progress = .pending;
    var attempts: u32 = 0;
    while (progress == .pending and attempts < 2_000) : (attempts += 1) {
        progress = connection.drive();
        if (progress == .pending) std.Thread.sleep(std.time.ns_per_ms);
    }
    try std.testing.expect(progress == .ready or progress == .unsupported);
}

test "Wayland seat selection treats XDG_SEAT as advisory but explicit configuration as strict" {
    var connection: Connection = undefined;
    connection.seats_overflowed = false;
    connection.seat_count = 1;
    connection.seats[0] = .{ .global_name = 1, .proxy = undefined };
    @memcpy(connection.seats[0].name[0..8], "Hyprland");
    connection.seats[0].name_length = 8;

    connection.requested_seat = "";
    connection.environment_seat = "seat0";
    try std.testing.expectEqual(@as(u32, 1), connection.selectSeat().?.global_name);

    connection.requested_seat = "seat0";
    try std.testing.expect(connection.selectSeat() == null);

    connection.requested_seat = "Hyprland";
    try std.testing.expectEqual(@as(u32, 1), connection.selectSeat().?.global_name);

    connection.requested_seat = "";
    connection.environment_seat = "seat0";
    connection.seat_count = 2;
    connection.seats[1] = .{ .global_name = 2, .proxy = undefined };
    @memcpy(connection.seats[1].name[0..5], "other");
    connection.seats[1].name_length = 5;
    try std.testing.expect(connection.selectSeat() == null);
}

test "Wayland flush completion distinguishes EAGAIN from completion and hard failure" {
    try std.testing.expectEqual(FlushResult.complete, classifyFlush(0, .SUCCESS));
    try std.testing.expectEqual(FlushResult.pending, classifyFlush(-1, .AGAIN));
    try std.testing.expectEqual(FlushResult.failed, classifyFlush(-1, .PIPE));
}

test "Wayland writes and clears settle deterministically after marshalling for every flush outcome" {
    const TestCase = struct {
        flush: FlushOutcome,
        selection: SelectionResult,
        output_pending: bool,
        phase: Phase,
    };
    const cases = [_]TestCase{
        .{ .flush = .{ .result = 0, .errno = .SUCCESS }, .selection = .ok, .output_pending = false, .phase = .ready },
        .{ .flush = .{ .result = -1, .errno = .AGAIN }, .selection = .committed, .output_pending = true, .phase = .ready },
        .{ .flush = .{ .result = -1, .errno = .PIPE }, .selection = .committed, .output_pending = false, .phase = .failed },
    };

    var symbols: linux.WaylandSymbols = undefined;
    symbols.wl_proxy_marshal_array_flags = testMarshal;
    symbols.wl_proxy_add_listener = testAddListener;
    symbols.wl_proxy_destroy = testDestroyProxy;
    symbols.wl_proxy_get_version = testProxyVersion;

    for (cases) |case| {
        var write = testReadyConnection(&symbols, case.flush);
        try std.testing.expectEqual(case.selection, write.publishText(false, &.{}));
        try std.testing.expectEqual(case.output_pending, write.output_pending);
        try std.testing.expectEqual(case.phase, write.phase);
        try std.testing.expectEqual(@as(u8, 4), write.test_flush_marshal_count);
        write.releaseProviders();

        var clear = testReadyConnection(&symbols, case.flush);
        try std.testing.expectEqual(case.selection, clear.clearSelection(false));
        try std.testing.expectEqual(case.output_pending, clear.output_pending);
        try std.testing.expectEqual(case.phase, clear.phase);
        try std.testing.expectEqual(@as(u8, 1), clear.test_flush_marshal_count);
    }
}

fn testReadyConnection(symbols: *const linux.WaylandSymbols, flush: FlushOutcome) Connection {
    var connection = Connection.init(std.testing.allocator, symbols, "", "", 1);
    connection.display = @ptrFromInt(1);
    connection.manager = @ptrFromInt(2);
    connection.device = @ptrFromInt(3);
    connection.phase = .ready;
    connection.flush_outcome_override = flush;
    return connection;
}

fn testMarshal(
    _: *WlProxy,
    _: u32,
    _: ?*const WlInterface,
    _: u32,
    _: u32,
    _: [*]WlArgument,
) callconv(.c) ?*WlProxy {
    return @ptrFromInt(4);
}

fn testAddListener(_: *WlProxy, _: [*]const *const anyopaque, _: ?*anyopaque) callconv(.c) c_int {
    return 0;
}

fn testDestroyProxy(_: *WlProxy) callconv(.c) void {}

fn testProxyVersion(_: *WlProxy) callconv(.c) u32 {
    return 1;
}

test "Wayland MIME retention ignores irrelevant metadata without consuming the bounded set" {
    try std.testing.expect(isRelevantMime("image/png"));
    try std.testing.expect(isRelevantMime("TEXT/PLAIN;CHARSET=UTF-8"));
    try std.testing.expect(!isRelevantMime("application/x-irrelevant"));
    try std.testing.expect(!isRelevantMime(&([_]u8{'x'} ** (MAX_MIME_BYTES + 1))));

    const proxy: *WlProxy = @ptrFromInt(1);
    var connection: Connection = undefined;
    connection.offer_count = 1;
    connection.offers[0] = .{ .proxy = proxy };
    var index: u8 = 0;
    while (index < MAX_MIME_TYPES) : (index += 1) {
        Connection.offerMime(&connection, proxy, "application/x-irrelevant");
    }
    Connection.offerMime(&connection, proxy, "image/png");
    try std.testing.expectEqual(@as(u8, 1), connection.offers[0].mime_count);
    try std.testing.expectEqualStrings("image/png", connection.offers[0].mimes[0].slice());
}

test "Wayland provider retirement preserves active transfers" {
    var connection: Connection = undefined;
    var transfer: [1]Transfer = undefined;
    var provider: Provider = .{
        .connection = &connection,
        .source = undefined,
        .primary = false,
        .data = &.{},
        .transfers = &transfer,
        .transfer_count = 1,
    };
    connection.clipboard_provider = &provider;
    connection.primary_provider = null;
    connection.providers = .{ &provider, null, null, null };

    connection.retireProvider(&provider);

    try std.testing.expect(provider.retired);
    try std.testing.expect(connection.clipboard_provider == null);
    try std.testing.expect(connection.providers[0] == &provider);

    connection.clipboard_provider = &provider;
    provider.retired = false;
    connection.retireProviders();
    try std.testing.expect(provider.retired);
    try std.testing.expect(connection.providers[0] == &provider);
}

test "Wayland reserves provider capacity independently for each selection" {
    var connection: Connection = undefined;
    var current: Provider = undefined;
    current.primary = false;
    current.retired = false;
    var retired: Provider = undefined;
    retired.primary = false;
    retired.retired = true;
    connection.clipboard_provider = &current;
    connection.primary_provider = null;
    connection.providers = .{ &current, &retired, null, null };

    try std.testing.expect(!connection.canPublishProvider(false));
    try std.testing.expect(connection.canPublishProvider(true));
    connection.clipboard_provider = null;
    current.retired = true;
    try std.testing.expect(!connection.canPublishProvider(false));
    connection.providers[1] = null;
    try std.testing.expect(connection.canPublishProvider(false));
}

test "Wayland provider transfers expire after a bounded idle interval" {
    try std.testing.expect(!providerTransferExpired(1, 1 + PROVIDER_TRANSFER_IDLE_TIMEOUT_NS - 1));
    try std.testing.expect(providerTransferExpired(1, 1 + PROVIDER_TRANSFER_IDLE_TIMEOUT_NS));
}

test "Wayland registry removal invalidates cached globals and selected seats" {
    var connection: Connection = undefined;
    connection.ext_global = 10;
    connection.wlr_global = 11;
    connection.wlr_version = 2;
    connection.seat_count = 1;
    connection.seats[0] = .{ .global_name = 12, .proxy = @ptrFromInt(1) };
    connection.bound_seat_global = 12;
    connection.failure = .none;
    connection.phase = .ready;

    try std.testing.expect(connection.removeGlobal(10) == null);
    try std.testing.expect(connection.ext_global == null);
    try std.testing.expectEqual(@as(u32, 11), connection.wlr_global.?);
    try std.testing.expect(connection.removeGlobal(12) != null);
    try std.testing.expectEqual(@as(u8, 0), connection.seat_count);
    try std.testing.expectEqual(Phase.failed, connection.phase);
    try std.testing.expectEqual(Failure.protocol, connection.failure);
}

test "Wayland registry removal invalidates the bound manager" {
    const manager: *WlProxy = @ptrFromInt(1);
    var connection: Connection = undefined;
    connection.ext_global = 20;
    connection.wlr_global = null;
    connection.manager = manager;
    connection.bound_manager_global = 20;

    try std.testing.expectEqual(manager, connection.removeGlobal(20).?);
    try std.testing.expect(connection.ext_global == null);
    try std.testing.expect(connection.manager == null);
    try std.testing.expect(connection.bound_manager_global == null);
}

test "Wayland selection failures do not leak across operations" {
    var connection: Connection = undefined;
    connection.failure = .provider;
    connection.phase = .ready;
    connection.primary_supported = false;
    connection.manager = null;

    try std.testing.expectEqual(SelectionResult.failed, connection.publishText(false, &.{}));
    try std.testing.expectEqual(Failure.protocol, connection.failure);
    try std.testing.expectEqual(Failure.protocol, connection.takeFailure());
    try std.testing.expectEqual(Failure.none, connection.failure);
}
