const std = @import("std");
const builtin = @import("builtin");
const linux = @import("clipboard-linux.zig");

pub const ATOM_PRIMARY: u32 = 1;
pub const ATOM_ATOM: u32 = 4;
pub const ATOM_STRING: u32 = 31;
const ATOM_INTEGER: u32 = 19;
const EVENT_PROPERTY_NOTIFY: u8 = 28;
const EVENT_SELECTION_CLEAR: u8 = 29;
const EVENT_SELECTION_REQUEST: u8 = 30;
const EVENT_SELECTION_NOTIFY: u8 = 31;
const EVENT_MASK_PROPERTY_CHANGE: u32 = 1 << 22;
const PROPERTY_DELETE: u8 = 1;
const MAX_PROVIDERS = 4;
const TRANSFER_IDLE_TIMEOUT_NS = 30 * std.time.ns_per_s;

const ATOM_NAMES = [_][]const u8{
    "CLIPBOARD",
    "TARGETS",
    "UTF8_STRING",
    "TEXT",
    "text/plain",
    "text/plain;charset=utf-8",
    "image/png",
    "OPENTUI_CLIPBOARD",
    "INCR",
    "MULTIPLE",
    "TIMESTAMP",
    "SAVE_TARGETS",
};

pub const Progress = enum { pending, ready, unsupported, failed };
pub const Failure = enum { none, connection, flush, atom, protocol, provider };
pub const SelectionResult = enum { ok, pending, committed, unsupported, failed };
pub const ReadResult = enum { pending, ready, refused, limit_exceeded, failed };

const Phase = enum { idle, atoms, flush, replies, window, window_flush, ready, unsupported, failed };
const FlushReadiness = enum { pending, ready, failed };
const OutputResult = enum { complete, pending, failed };

const ReadPhase = enum { idle, selection, property, incremental, ready, refused, limit_exceeded, failed };
pub const ReadState = struct {
    phase: ReadPhase = .idle,
    window: u32 = 0,
    selection: u32 = 0,
    target: u32 = 0,
    property_cookie: ?linux.XcbCookie = null,
    expected_type: u32 = 0,
    incremental: bool = false,
    max_bytes: u32 = 0,
    notification_pending: bool = false,
    actual_type: u32 = 0,
};

pub const WriteState = struct {
    provider: ?*Provider = null,
    clear: bool = false,
    selection: u32 = 0,
    waiting_timestamp: bool = false,
    committed: bool = false,
    timestamp: u32 = 0,
    owner_cookie: ?linux.XcbCookie = null,
    failed: bool = false,
    timestamp_window: u32 = 0,
};

const Transfer = struct {
    provider: *Provider,
    data: []const u8,
    requestor: u32,
    property: u32,
    target: u32,
    offset: u32 = 0,
    sent_terminal: bool = false,
    last_progress_ns: i128,
    delete_pending: bool = false,
};

const PendingResponse = struct {
    request: linux.XcbSelectionRequestEvent,
    property_cookie: linux.XcbCookie,
    barrier_cookie: linux.XcbCookie,
    property: u32,
    transfer_requestor: u32 = 0,
    transfer_property: u32 = 0,
    notify: bool = true,
};

pub const Provider = struct {
    selection: u32,
    data: []u8,
    latin1: []u8 = &.{},
    timestamp: u32 = 0,
    owns_data: bool = false,
    retired: bool = false,
    transfer_count: u32 = 0,
};

pub const Atoms = struct {
    primary: u32,
    atom: u32,
    string: u32,
    clipboard: u32,
    targets: u32,
    utf8_string: u32,
    text: u32,
    text_plain: u32,
    text_plain_utf8: u32,
    png: u32,
    property: u32,
    incr: u32,
    multiple: u32,
    timestamp: u32,
    save_targets: u32,
};

pub const Connection = struct {
    allocator: std.mem.Allocator,
    symbols: *const linux.XcbSymbols,
    max_provider_transfers: u32,
    connection: ?*linux.XcbConnection = null,
    phase: Phase = .idle,
    failure: Failure = .none,
    cookies: [ATOM_NAMES.len]linux.XcbCookie = undefined,
    atom_values: [ATOM_NAMES.len]u32 = undefined,
    request_index: u8 = 0,
    reply_index: u8 = 0,
    output_ready_override: ?bool = null,
    screen_index: c_int = 0,
    root_window: u32 = 0,
    owner_window: u32 = 0,
    maximum_request_bytes: u32 = 0,
    providers: [MAX_PROVIDERS]?*Provider = .{null} ** MAX_PROVIDERS,
    clipboard_provider: ?*Provider = null,
    primary_provider: ?*Provider = null,
    transfers: []Transfer = &.{},
    transfer_count: u32 = 0,
    transfer_cursor: u32 = 0,
    responses: []PendingResponse = &.{},
    response_count: u32 = 0,
    output_pending: bool = false,
    retired_timestamp_window: u32 = 0,

    pub fn init(
        allocator: std.mem.Allocator,
        symbols: *const linux.XcbSymbols,
        max_provider_transfers: u32,
    ) Connection {
        return .{
            .allocator = allocator,
            .symbols = symbols,
            .max_provider_transfers = max_provider_transfers,
        };
    }

    pub fn deinit(self: *Connection) void {
        if (self.connection) |connection| {
            var index = self.reply_index;
            while (index < self.request_index) : (index += 1) {
                self.symbols.xcb_discard_reply(connection, self.cookies[index].sequence);
            }
            self.releaseProviders();
            if (self.retired_timestamp_window != 0) {
                _ = self.symbols.xcb_destroy_window(connection, self.retired_timestamp_window);
            }
            if (self.owner_window != 0) _ = self.symbols.xcb_destroy_window(connection, self.owner_window);
            self.symbols.xcb_disconnect(connection);
        }
        if (self.transfers.len > 0) self.allocator.free(self.transfers);
        if (self.responses.len > 0) self.allocator.free(self.responses);
        self.* = undefined;
    }

    pub fn drive(self: *Connection) Progress {
        switch (self.phase) {
            .idle => return self.connect(),
            .atoms => return self.requestAtom(),
            .flush => return self.flushAtoms(),
            .replies => return self.pollAtom(),
            .window => return self.createOwnerWindow(),
            .window_flush => return self.flushOwnerWindow(),
            .ready => return .ready,
            .unsupported => return .unsupported,
            .failed => return .failed,
        }
    }

    pub fn atoms(self: *const Connection) ?Atoms {
        if (self.phase != .ready) return null;
        return .{
            .primary = ATOM_PRIMARY,
            .atom = ATOM_ATOM,
            .string = ATOM_STRING,
            .clipboard = self.atom_values[0],
            .targets = self.atom_values[1],
            .utf8_string = self.atom_values[2],
            .text = self.atom_values[3],
            .text_plain = self.atom_values[4],
            .text_plain_utf8 = self.atom_values[5],
            .png = self.atom_values[6],
            .property = self.atom_values[7],
            .incr = self.atom_values[8],
            .multiple = self.atom_values[9],
            .timestamp = self.atom_values[10],
            .save_targets = self.atom_values[11],
        };
    }

    pub fn takeFailure(self: *Connection) Failure {
        const failure = self.failure;
        if (self.phase == .ready) self.failure = .none;
        return failure;
    }

    fn connect(self: *Connection) Progress {
        var screen: c_int = 0;
        const connection = self.symbols.xcb_connect(null, &screen) orelse {
            self.phase = .unsupported;
            return .unsupported;
        };
        self.connection = connection;
        self.screen_index = screen;
        if (self.symbols.xcb_connection_has_error(connection) != 0) {
            self.phase = .unsupported;
            return .unsupported;
        }
        self.phase = .atoms;
        return .pending;
    }

    fn requestAtom(self: *Connection) Progress {
        const connection = self.connection orelse return self.fail(.connection);
        if (self.symbols.xcb_connection_has_error(connection) != 0) return self.fail(.connection);
        std.debug.assert(self.request_index < ATOM_NAMES.len);

        const name = ATOM_NAMES[self.request_index];
        self.cookies[self.request_index] = self.symbols.xcb_intern_atom(
            connection,
            0,
            @intCast(name.len),
            name.ptr,
        );
        self.request_index += 1;
        if (self.request_index < ATOM_NAMES.len) return .pending;
        self.phase = .flush;
        return .pending;
    }

    fn flushAtoms(self: *Connection) Progress {
        const connection = self.connection orelse return self.fail(.connection);
        switch (self.flushReadiness(connection)) {
            .pending => return .pending,
            .failed => return self.fail(.connection),
            .ready => {},
        }
        // This fresh private connection has only the fixed atom batch queued.
        if (self.symbols.xcb_flush(connection) <= 0) return self.fail(.flush);
        self.phase = .replies;
        return .pending;
    }

    fn flushReadiness(self: *Connection, connection: *linux.XcbConnection) FlushReadiness {
        if (comptime builtin.is_test) {
            if (self.output_ready_override) |ready| return if (ready) .ready else .pending;
        }
        var descriptor = [_]std.posix.pollfd{.{
            .fd = self.symbols.xcb_get_file_descriptor(connection),
            .events = std.posix.POLL.OUT,
            .revents = 0,
        }};
        const count = std.posix.poll(&descriptor, 0) catch return .failed;
        if (descriptor[0].revents & (std.posix.POLL.ERR | std.posix.POLL.HUP | std.posix.POLL.NVAL) != 0) {
            return .failed;
        }
        if (count == 0 or descriptor[0].revents & std.posix.POLL.OUT == 0) return .pending;
        return .ready;
    }

    fn pollAtom(self: *Connection) Progress {
        const connection = self.connection orelse return self.fail(.connection);
        if (self.symbols.xcb_connection_has_error(connection) != 0) return self.fail(.connection);
        std.debug.assert(self.reply_index < self.request_index);

        var reply_pointer: ?*anyopaque = null;
        var error_pointer: ?*linux.XcbGenericError = null;
        const available = self.symbols.xcb_poll_for_reply(
            connection,
            self.cookies[self.reply_index].sequence,
            &reply_pointer,
            &error_pointer,
        );
        if (available == 0) return .pending;
        self.reply_index += 1;
        defer if (reply_pointer) |pointer| std.c.free(pointer);
        defer if (error_pointer) |pointer| std.c.free(pointer);
        if (error_pointer != null) return self.fail(.atom);
        const opaque_reply = reply_pointer orelse return self.fail(.atom);
        const reply: *const linux.XcbInternAtomReply = @ptrCast(@alignCast(opaque_reply));
        if (reply.atom == 0) return self.fail(.atom);
        self.atom_values[self.reply_index - 1] = reply.atom;

        if (self.reply_index < self.request_index) return .pending;
        self.phase = .window;
        return .pending;
    }

    pub fn selectionAtom(self: *const Connection, primary: bool) u32 {
        return if (primary) ATOM_PRIMARY else self.atoms().?.clipboard;
    }

    pub fn targetAtoms(self: *const Connection, mime: []const u8, output: *[5]u32) []const u32 {
        const atoms_value = self.atoms().?;
        if (std.ascii.eqlIgnoreCase(mime, "image/png")) {
            output[0] = atoms_value.png;
            return output[0..1];
        }
        if (!std.ascii.eqlIgnoreCase(mime, "text/plain")) return output[0..0];
        output.* = .{
            atoms_value.text_plain_utf8,
            atoms_value.utf8_string,
            atoms_value.text_plain,
            atoms_value.text,
            atoms_value.string,
        };
        return output;
    }

    pub fn beginRead(self: *Connection, state: *ReadState, primary: bool, target: u32, max_bytes: u32) bool {
        const connection = self.connection orelse return false;
        std.debug.assert(state.phase == .idle or state.phase == .refused);
        if (state.window == 0) {
            state.window = self.symbols.xcb_generate_id(connection);
            if (state.window == 0 or state.window == std.math.maxInt(u32)) return false;
            const event_mask = [_]u32{EVENT_MASK_PROPERTY_CHANGE};
            _ = self.symbols.xcb_create_window(
                connection,
                0,
                state.window,
                self.root_window,
                0,
                0,
                1,
                1,
                0,
                1,
                0,
                1 << 11,
                &event_mask,
            );
        }
        const atoms_value = self.atoms().?;
        state.selection = self.selectionAtom(primary);
        state.target = target;
        state.expected_type = target;
        state.max_bytes = max_bytes;
        state.phase = .selection;
        _ = self.symbols.xcb_delete_property(connection, state.window, atoms_value.property);
        _ = self.symbols.xcb_convert_selection(
            connection,
            state.window,
            state.selection,
            target,
            atoms_value.property,
            0,
        );
        return self.queueFlush() != .failed;
    }

    pub fn routeReadEvent(self: *Connection, state: *ReadState, event: *const linux.XcbGenericEvent) bool {
        const event_type = event.response_type & 0x7f;
        if (event_type == EVENT_SELECTION_NOTIFY) {
            const notify: *const linux.XcbSelectionNotifyEvent = @ptrCast(@alignCast(event));
            if (state.phase != .selection or notify.requestor != state.window or
                notify.selection != state.selection or notify.target != state.target) return false;
            if (notify.property == 0) {
                state.phase = .refused;
                return true;
            }
            state.property_cookie = self.symbols.xcb_get_property(
                self.connection.?,
                0,
                state.window,
                self.atoms().?.property,
                0,
                0,
                propertyLongLength(state.max_bytes +| 1),
            );
            state.phase = .property;
            _ = self.queueFlush();
            return true;
        }
        if (event_type == EVENT_PROPERTY_NOTIFY and state.phase == .incremental) {
            const notify: *const linux.XcbPropertyNotifyEvent = @ptrCast(@alignCast(event));
            if (notify.window != state.window or notify.atom != self.atoms().?.property or notify.state != 0) return false;
            state.property_cookie = self.symbols.xcb_get_property(
                self.connection.?,
                1,
                state.window,
                self.atoms().?.property,
                0,
                0,
                propertyLongLength(state.max_bytes +| 1),
            );
            state.phase = .property;
            _ = self.queueFlush();
            return true;
        }
        if (event_type == EVENT_PROPERTY_NOTIFY and state.phase == .property) {
            const notify: *const linux.XcbPropertyNotifyEvent = @ptrCast(@alignCast(event));
            if (notify.window != state.window or notify.atom != self.atoms().?.property or notify.state != 0) return false;
            state.notification_pending = true;
            return true;
        }
        return false;
    }

    pub fn driveRead(
        self: *Connection,
        state: *ReadState,
        data: *std.ArrayListUnmanaged(u8),
        max_bytes: u32,
    ) ReadResult {
        if (self.output_pending) switch (self.flushOutput()) {
            .complete => {},
            .pending => return .pending,
            .failed => return failRead(state),
        };
        switch (state.phase) {
            .ready => return .ready,
            .refused => return .refused,
            .limit_exceeded => return .limit_exceeded,
            .failed => return .failed,
            .idle, .selection, .incremental => return .pending,
            .property => {},
        }
        const cookie = state.property_cookie orelse return .pending;
        var reply_pointer: ?*anyopaque = null;
        var error_pointer: ?*linux.XcbGenericError = null;
        const available = self.symbols.xcb_poll_for_reply(
            self.connection.?,
            cookie.sequence,
            &reply_pointer,
            &error_pointer,
        );
        if (available == 0) return .pending;
        state.property_cookie = null;
        defer if (reply_pointer) |pointer| std.c.free(pointer);
        defer if (error_pointer) |pointer| std.c.free(pointer);
        if (error_pointer != null) return failRead(state);
        const opaque_reply = reply_pointer orelse return failRead(state);
        const reply: *const linux.XcbGetPropertyReply = @ptrCast(@alignCast(opaque_reply));
        const bytes = propertyBytes(reply) orelse return failRead(state);
        if (reply.atom_type == self.atoms().?.incr) {
            if (reply.format != 32 or (bytes.len != 0 and bytes.len < 4)) return failRead(state);
            // xclip sends an empty INCR property instead of the ICCCM size hint.
            if (bytes.len >= 4) {
                const announced = std.mem.readInt(u32, bytes[0..4], builtin.cpu.arch.endian());
                if (announced > max_bytes) {
                    state.phase = .limit_exceeded;
                    return .limit_exceeded;
                }
            }
            state.incremental = true;
            state.phase = .incremental;
            _ = self.symbols.xcb_delete_property(self.connection.?, state.window, self.atoms().?.property);
            _ = self.queueFlush();
            return .pending;
        }
        const atoms_value = self.atoms().?;
        const text_type_supported = reply.atom_type == atoms_value.utf8_string or
            reply.atom_type == atoms_value.text_plain_utf8 or reply.atom_type == atoms_value.text_plain or
            reply.atom_type == ATOM_STRING;
        const target_is_text = state.target == atoms_value.text or state.target == atoms_value.utf8_string or
            state.target == atoms_value.text_plain_utf8 or state.target == atoms_value.text_plain or
            state.target == ATOM_STRING;
        const accepted_type = if (target_is_text)
            ((state.actual_type == 0 and text_type_supported) or reply.atom_type == state.actual_type)
        else
            reply.atom_type == state.expected_type;
        if (reply.format != 8 or !accepted_type) {
            return failRead(state);
        }
        if (state.actual_type == 0) state.actual_type = reply.atom_type;
        if (bytes.len == 0 and state.incremental) {
            state.phase = .ready;
            return .ready;
        }
        if (reply.bytes_after > 0 or bytes.len > max_bytes -| data.items.len) {
            state.phase = .limit_exceeded;
            return .limit_exceeded;
        }
        if (textPropertyUsesLatin1(state.actual_type)) {
            const appended = appendLatin1(self.allocator, data, bytes, max_bytes) catch return failRead(state);
            if (!appended) {
                state.phase = .limit_exceeded;
                return .limit_exceeded;
            }
        } else {
            data.appendSlice(self.allocator, bytes) catch return failRead(state);
        }
        if (state.incremental) {
            state.phase = .incremental;
            if (state.notification_pending) {
                state.notification_pending = false;
                self.requestIncrementalProperty(state);
            }
            return .pending;
        }
        _ = self.symbols.xcb_delete_property(self.connection.?, state.window, self.atoms().?.property);
        _ = self.queueFlush();
        state.phase = .ready;
        return .ready;
    }

    pub fn cleanupRead(self: *Connection, state: *ReadState) void {
        const connection = self.connection orelse return;
        if (state.property_cookie) |cookie| self.symbols.xcb_discard_reply(connection, cookie.sequence);
        if (state.window != 0) {
            _ = self.symbols.xcb_delete_property(connection, state.window, self.atom_values[7]);
            _ = self.symbols.xcb_destroy_window(connection, state.window);
            if (self.phase == .ready) _ = self.queueFlush();
        }
        state.* = .{};
    }

    pub fn beginWrite(self: *Connection, state: *WriteState, primary: bool, data: []u8) SelectionResult {
        if (self.retired_timestamp_window != 0) return .pending;
        if (!self.canPublish(primary)) return self.selectionFailure(.provider);
        const slot = self.freeProviderSlot() orelse return self.selectionFailure(.provider);
        const provider = self.allocator.create(Provider) catch return self.selectionFailure(.provider);
        provider.* = .{
            .selection = self.selectionAtom(primary),
            .data = data,
            .latin1 = encodeLatin1(self.allocator, data) catch &.{},
        };
        const connection = self.connection orelse {
            self.allocator.destroy(provider);
            return self.selectionFailure(.connection);
        };
        state.* = .{
            .provider = provider,
            .selection = provider.selection,
            .waiting_timestamp = true,
        };
        slot.* = provider;
        if (!self.createTimestampWindow(state)) {
            self.removeProvider(provider, false);
            state.* = .{};
            return self.selectionFailure(.protocol);
        }
        _ = self.symbols.xcb_change_property(
            connection,
            0,
            state.timestamp_window,
            self.atoms().?.timestamp,
            ATOM_INTEGER,
            8,
            0,
            null,
        );
        if (self.queueFlush() != .failed) return .pending;
        self.removeProvider(provider, false);
        self.destroyTimestampWindow(state);
        state.* = .{};
        return self.selectionFailure(.flush);
    }

    pub fn beginClear(self: *Connection, state: *WriteState, primary: bool) SelectionResult {
        if (self.retired_timestamp_window != 0) return .pending;
        const connection = self.connection orelse return self.selectionFailure(.connection);
        const selection = self.selectionAtom(primary);
        state.* = .{
            .clear = true,
            .selection = selection,
            .waiting_timestamp = true,
        };
        if (!self.createTimestampWindow(state)) {
            state.* = .{};
            return self.selectionFailure(.protocol);
        }
        _ = self.symbols.xcb_change_property(
            connection,
            0,
            state.timestamp_window,
            self.atoms().?.timestamp,
            ATOM_INTEGER,
            8,
            0,
            null,
        );
        if (self.queueFlush() != .failed) return .pending;
        self.destroyTimestampWindow(state);
        state.* = .{};
        return self.selectionFailure(.flush);
    }

    pub fn driveWrite(self: *Connection, state: *WriteState) SelectionResult {
        if (state.failed) return .failed;
        if (self.output_pending) switch (self.flushOutput()) {
            .complete => {},
            .pending => return .pending,
            .failed => return self.abortWrite(state),
        };
        if (state.committed) return .committed;
        const cookie = state.owner_cookie orelse return .pending;
        var reply_pointer: ?*anyopaque = null;
        var error_pointer: ?*linux.XcbGenericError = null;
        const available = self.symbols.xcb_poll_for_reply(
            self.connection.?,
            cookie.sequence,
            &reply_pointer,
            &error_pointer,
        );
        if (available == 0) return .pending;
        state.owner_cookie = null;
        defer if (reply_pointer) |pointer| std.c.free(pointer);
        defer if (error_pointer) |pointer| std.c.free(pointer);
        if (error_pointer != null or reply_pointer == null) return self.abortWrite(state);
        const reply: *const linux.XcbGetSelectionOwnerReply = @ptrCast(@alignCast(reply_pointer.?));
        if (state.clear) {
            if (reply.owner != 0) return self.abortWrite(state);
            self.retireCurrent(state.selection);
        } else {
            if (reply.owner != self.owner_window) return self.abortWrite(state);
            const provider = state.provider.?;
            provider.timestamp = state.timestamp;
            provider.owns_data = true;
            const previous = self.currentProvider(provider.selection);
            if (previous) |old| self.retireProvider(old);
            self.setCurrentProvider(provider);
            state.provider = null;
        }
        state.committed = true;
        return .committed;
    }

    pub fn cleanupWrite(self: *Connection, state: *WriteState) void {
        if (state.owner_cookie) |cookie| {
            self.symbols.xcb_discard_reply(self.connection.?, cookie.sequence);
            _ = self.symbols.xcb_set_selection_owner(self.connection.?, 0, state.selection, state.timestamp);
            _ = self.queueFlush();
        }
        if (state.provider) |provider| self.removeProvider(provider, false);
        if (state.waiting_timestamp) self.retireTimestampWindow(state) else self.destroyTimestampWindow(state);
        state.* = .{};
    }

    pub fn consumeRetiredTimestampEvent(self: *Connection, event: *const linux.XcbGenericEvent) bool {
        if (self.retired_timestamp_window == 0 or (event.response_type & 0x7f) != EVENT_PROPERTY_NOTIFY) return false;
        const notify: *const linux.XcbPropertyNotifyEvent = @ptrCast(@alignCast(event));
        if (notify.window != self.retired_timestamp_window or notify.atom != self.atom_values[10] or notify.state != 0) {
            return false;
        }
        _ = self.symbols.xcb_destroy_window(self.connection.?, self.retired_timestamp_window);
        self.retired_timestamp_window = 0;
        _ = self.queueFlush();
        return true;
    }

    pub fn routeWriteEvent(self: *Connection, state: *WriteState, event: *const linux.XcbGenericEvent) bool {
        if (!state.waiting_timestamp or (event.response_type & 0x7f) != EVENT_PROPERTY_NOTIFY) return false;
        const notify: *const linux.XcbPropertyNotifyEvent = @ptrCast(@alignCast(event));
        if (notify.window != state.timestamp_window or notify.atom != self.atoms().?.timestamp or notify.state != 0) return false;
        state.waiting_timestamp = false;
        state.timestamp = notify.time;
        self.destroyTimestampWindow(state);
        _ = self.symbols.xcb_set_selection_owner(
            self.connection.?,
            if (state.clear) 0 else self.owner_window,
            state.selection,
            notify.time,
        );
        state.owner_cookie = self.symbols.xcb_get_selection_owner(self.connection.?, state.selection);
        if (self.queueFlush() == .failed) _ = self.abortWrite(state);
        return true;
    }

    pub fn pollEvent(self: *Connection) ?*linux.XcbGenericEvent {
        return self.symbols.xcb_poll_for_event(self.connection.?);
    }

    pub fn handleProviderEvent(self: *Connection, event: *const linux.XcbGenericEvent) void {
        switch (event.response_type & 0x7f) {
            EVENT_SELECTION_REQUEST => self.handleSelectionRequest(@ptrCast(@alignCast(event))),
            EVENT_SELECTION_CLEAR => self.handleSelectionClear(@ptrCast(@alignCast(event))),
            EVENT_PROPERTY_NOTIFY => self.handleTransferProperty(@ptrCast(@alignCast(event))),
            else => {},
        }
    }

    pub fn driveProviderUnit(self: *Connection) bool {
        if (self.phase == .failed) {
            self.output_pending = false;
            self.releaseProviders();
            return false;
        }
        if (self.output_pending and self.flushOutput() == .failed) {
            self.failure = .flush;
            self.phase = .failed;
            self.releaseProviders();
            return false;
        }
        if (self.response_count > 0) {
            self.drivePendingResponse();
            return self.hasWork();
        }
        if (self.transfer_count > 0) {
            const now = std.time.nanoTimestamp();
            const index = self.transfer_cursor % self.transfer_count;
            self.transfer_cursor = (self.transfer_cursor + 1) % self.transfer_count;
            if (now - self.transfers[index].last_progress_ns >= TRANSFER_IDLE_TIMEOUT_NS) {
                self.removeTransfer(index);
            }
        }
        return self.hasWork();
    }

    pub fn hasWork(self: *const Connection) bool {
        if (self.phase == .failed) return false;
        return self.output_pending or self.retired_timestamp_window != 0 or self.response_count > 0 or self.clipboard_provider != null or
            self.primary_provider != null or self.transfer_count > 0;
    }

    pub fn releaseProviders(self: *Connection) void {
        if (self.connection) |connection| {
            for (self.responses[0..self.response_count]) |response| {
                self.symbols.xcb_discard_reply(connection, response.barrier_cookie.sequence);
            }
        }
        self.response_count = 0;
        self.transfer_count = 0;
        for (&self.providers) |*slot| {
            const provider = slot.* orelse continue;
            if (provider.owns_data and provider.data.len > 0) self.allocator.free(provider.data);
            if (provider.latin1.len > 0) self.allocator.free(provider.latin1);
            self.allocator.destroy(provider);
            slot.* = null;
        }
        self.clipboard_provider = null;
        self.primary_provider = null;
    }

    fn queueFlush(self: *Connection) OutputResult {
        const result = self.flushOutput();
        if (result == .failed) {
            if (self.failure == .none) self.failure = .flush;
            self.output_pending = false;
            self.phase = .failed;
        }
        return result;
    }

    fn flushOutput(self: *Connection) OutputResult {
        const connection = self.connection orelse return .failed;
        switch (self.flushReadiness(connection)) {
            .pending => {
                self.output_pending = true;
                return .pending;
            },
            .failed => return .failed,
            .ready => {},
        }
        if (self.symbols.xcb_flush(connection) <= 0) return .failed;
        self.output_pending = false;
        return .complete;
    }

    fn selectionFailure(self: *Connection, failure: Failure) SelectionResult {
        if (self.failure == .none) self.failure = failure;
        return .failed;
    }

    fn abortWrite(self: *Connection, state: *WriteState) SelectionResult {
        if (state.timestamp != 0 and state.selection != 0) {
            _ = self.symbols.xcb_set_selection_owner(self.connection.?, 0, state.selection, state.timestamp);
            _ = self.queueFlush();
        }
        if (state.provider) |provider| self.removeProvider(provider, false);
        self.destroyTimestampWindow(state);
        state.* = .{};
        state.failed = true;
        return self.selectionFailure(.protocol);
    }

    fn requestIncrementalProperty(self: *Connection, state: *ReadState) void {
        state.property_cookie = self.symbols.xcb_get_property(
            self.connection.?,
            1,
            state.window,
            self.atoms().?.property,
            0,
            0,
            propertyLongLength(state.max_bytes +| 1),
        );
        state.phase = .property;
        _ = self.queueFlush();
    }

    fn createTimestampWindow(self: *Connection, state: *WriteState) bool {
        const connection = self.connection orelse return false;
        state.timestamp_window = self.symbols.xcb_generate_id(connection);
        if (state.timestamp_window == 0 or state.timestamp_window == std.math.maxInt(u32)) return false;
        const event_mask = [_]u32{EVENT_MASK_PROPERTY_CHANGE};
        _ = self.symbols.xcb_create_window(
            connection,
            0,
            state.timestamp_window,
            self.root_window,
            0,
            0,
            1,
            1,
            0,
            1,
            0,
            1 << 11,
            &event_mask,
        );
        return true;
    }

    fn destroyTimestampWindow(self: *Connection, state: *WriteState) void {
        if (state.timestamp_window == 0) return;
        if (self.connection) |connection| _ = self.symbols.xcb_destroy_window(connection, state.timestamp_window);
        state.timestamp_window = 0;
    }

    fn retireTimestampWindow(self: *Connection, state: *WriteState) void {
        if (state.timestamp_window == 0) return;
        std.debug.assert(self.retired_timestamp_window == 0);
        self.retired_timestamp_window = state.timestamp_window;
        state.timestamp_window = 0;
        _ = self.queueFlush();
    }

    fn freeProviderSlot(self: *Connection) ?*?*Provider {
        for (&self.providers) |*slot| if (slot.* == null) return slot;
        return null;
    }

    fn canPublish(self: *const Connection, primary: bool) bool {
        const selection = self.selectionAtom(primary);
        var count: u8 = 0;
        for (self.providers) |candidate| {
            const provider = candidate orelse continue;
            if (provider.selection == selection) count += 1;
        }
        return count < 2;
    }

    fn currentProvider(self: *const Connection, selection: u32) ?*Provider {
        return if (selection == ATOM_PRIMARY) self.primary_provider else self.clipboard_provider;
    }

    fn setCurrentProvider(self: *Connection, provider: *Provider) void {
        if (provider.selection == ATOM_PRIMARY) self.primary_provider = provider else self.clipboard_provider = provider;
    }

    fn retireCurrent(self: *Connection, selection: u32) void {
        const provider = self.currentProvider(selection) orelse return;
        self.retireProvider(provider);
    }

    fn retireProvider(self: *Connection, provider: *Provider) void {
        if (self.clipboard_provider == provider) self.clipboard_provider = null;
        if (self.primary_provider == provider) self.primary_provider = null;
        provider.retired = true;
        if (provider.transfer_count == 0) self.removeProvider(provider, true);
    }

    fn removeProvider(self: *Connection, provider: *Provider, free_data: bool) void {
        for (&self.providers) |*slot| {
            if (slot.* != provider) continue;
            if (free_data and provider.data.len > 0) self.allocator.free(provider.data);
            if (provider.latin1.len > 0) self.allocator.free(provider.latin1);
            self.allocator.destroy(provider);
            slot.* = null;
            return;
        }
    }

    fn handleSelectionClear(self: *Connection, event: *const linux.XcbSelectionClearEvent) void {
        if (event.owner != self.owner_window) return;
        self.retireCurrent(event.selection);
    }

    fn handleSelectionRequest(self: *Connection, event: *const linux.XcbSelectionRequestEvent) void {
        const provider = self.currentProvider(event.selection) orelse {
            self.sendSelectionNotify(event, 0);
            return;
        };
        if (event.time != 0 and timestampBefore(event.time, provider.timestamp)) {
            self.sendSelectionNotify(event, 0);
            return;
        }
        const property = if (event.property == 0) event.target else event.property;
        const atoms_value = self.atoms().?;
        if (self.response_count >= self.responses.len) {
            self.sendSelectionNotify(event, 0);
            return;
        }
        if (event.target == atoms_value.targets) {
            const targets = [_]u32{
                atoms_value.targets,
                atoms_value.timestamp,
                atoms_value.utf8_string,
                atoms_value.text_plain_utf8,
                atoms_value.text_plain,
                atoms_value.text,
                atoms_value.string,
            };
            const target_count: usize = if (provider.latin1.len > 0) targets.len else targets.len - 1;
            const property_cookie = self.symbols.xcb_change_property_checked(
                self.connection.?,
                0,
                event.requestor,
                property,
                ATOM_ATOM,
                32,
                @intCast(target_count),
                &targets,
            );
            self.queuePropertyResponse(event, property_cookie, property, 0, 0);
            return;
        }
        if (event.target == atoms_value.timestamp) {
            const timestamp = [_]u32{provider.timestamp};
            const property_cookie = self.symbols.xcb_change_property_checked(
                self.connection.?,
                0,
                event.requestor,
                property,
                ATOM_INTEGER,
                32,
                1,
                &timestamp,
            );
            self.queuePropertyResponse(event, property_cookie, property, 0, 0);
            return;
        }
        const output_type = if (event.target == atoms_value.text) atoms_value.utf8_string else event.target;
        if (event.target != atoms_value.utf8_string and event.target != atoms_value.text_plain_utf8 and
            event.target != atoms_value.text_plain and event.target != atoms_value.text and
            (event.target != atoms_value.string or provider.latin1.len == 0))
        {
            self.sendSelectionNotify(event, 0);
            return;
        }
        const output_data = if (event.target == atoms_value.string) provider.latin1 else provider.data;
        if (output_data.len <= self.directPayloadBytes()) {
            const property_cookie = self.symbols.xcb_change_property_checked(
                self.connection.?,
                0,
                event.requestor,
                property,
                output_type,
                8,
                @intCast(output_data.len),
                if (output_data.len == 0) null else output_data.ptr,
            );
            self.queuePropertyResponse(event, property_cookie, property, 0, 0);
            return;
        }
        if (self.transfer_count >= self.transfers.len or self.hasTransfer(event.requestor, property)) {
            self.sendSelectionNotify(event, 0);
            return;
        }
        const mask = [_]u32{EVENT_MASK_PROPERTY_CHANGE};
        _ = self.symbols.xcb_change_window_attributes(self.connection.?, event.requestor, 1 << 11, &mask);
        const length = [_]u32{@intCast(output_data.len)};
        const property_cookie = self.symbols.xcb_change_property_checked(
            self.connection.?,
            0,
            event.requestor,
            property,
            atoms_value.incr,
            32,
            1,
            &length,
        );
        self.transfers[self.transfer_count] = .{
            .provider = provider,
            .data = output_data,
            .requestor = event.requestor,
            .property = property,
            .target = output_type,
            .last_progress_ns = std.time.nanoTimestamp(),
        };
        self.transfer_count += 1;
        provider.transfer_count += 1;
        self.queuePropertyResponse(event, property_cookie, property, event.requestor, property);
    }

    fn sendSelectionNotify(self: *Connection, request: *const linux.XcbSelectionRequestEvent, property: u32) void {
        const notify: linux.XcbSelectionNotifyEvent = .{
            .response_type = EVENT_SELECTION_NOTIFY,
            .pad0 = 0,
            .sequence = 0,
            .time = request.time,
            .requestor = request.requestor,
            .selection = request.selection,
            .target = request.target,
            .property = property,
        };
        var event_bytes = [_]u8{0} ** 32;
        @memcpy(event_bytes[0..@sizeOf(linux.XcbSelectionNotifyEvent)], std.mem.asBytes(&notify));
        _ = self.symbols.xcb_send_event(self.connection.?, 0, request.requestor, 0, &event_bytes);
        _ = self.queueFlush();
    }

    fn queuePropertyResponse(
        self: *Connection,
        request: *const linux.XcbSelectionRequestEvent,
        property_cookie: linux.XcbCookie,
        property: u32,
        transfer_requestor: u32,
        transfer_property: u32,
    ) void {
        std.debug.assert(self.response_count < self.responses.len);
        self.responses[self.response_count] = .{
            .request = request.*,
            .property_cookie = property_cookie,
            .barrier_cookie = self.symbols.xcb_get_selection_owner(self.connection.?, request.selection),
            .property = property,
            .transfer_requestor = transfer_requestor,
            .transfer_property = transfer_property,
        };
        self.response_count += 1;
        _ = self.queueFlush();
    }

    fn drivePendingResponse(self: *Connection) void {
        const response = self.responses[0];
        var reply_pointer: ?*anyopaque = null;
        var error_pointer: ?*linux.XcbGenericError = null;
        const available = self.symbols.xcb_poll_for_reply(
            self.connection.?,
            response.barrier_cookie.sequence,
            &reply_pointer,
            &error_pointer,
        );
        if (available == 0) return;
        defer if (reply_pointer) |pointer| std.c.free(pointer);
        defer if (error_pointer) |pointer| std.c.free(pointer);
        const property_error = self.symbols.xcb_request_check(self.connection.?, response.property_cookie);
        defer if (property_error) |pointer| std.c.free(pointer);
        const success = reply_pointer != null and error_pointer == null and property_error == null;
        if (response.notify) self.sendSelectionNotify(&response.request, if (success) response.property else 0);
        if (!success and response.transfer_requestor != 0) {
            self.removeTransferByKey(response.transfer_requestor, response.transfer_property);
        }
        self.response_count -= 1;
        if (self.response_count > 0) {
            std.mem.copyForwards(PendingResponse, self.responses[0..self.response_count], self.responses[1 .. self.response_count + 1]);
        }
        if (success and response.transfer_requestor != 0) {
            self.advancePendingTransfer(response.transfer_requestor, response.transfer_property);
        }
    }

    fn handleTransferProperty(self: *Connection, event: *const linux.XcbPropertyNotifyEvent) void {
        if (event.state != PROPERTY_DELETE) return;
        var index: u32 = 0;
        while (index < self.transfer_count) : (index += 1) {
            const transfer = &self.transfers[index];
            if (transfer.requestor != event.window or transfer.property != event.atom) continue;
            if (transfer.sent_terminal) {
                self.removeTransfer(index);
                return;
            }
            if (self.response_count >= self.responses.len or self.hasPendingResponseForTransfer(event.window, event.atom)) {
                transfer.delete_pending = true;
                return;
            }
            self.advanceTransfer(index);
            return;
        }
    }

    fn advanceTransfer(self: *Connection, index: u32) void {
        const transfer = &self.transfers[index];
        transfer.delete_pending = false;
        const remaining = transfer.data.len - transfer.offset;
        const count = @min(remaining, self.directPayloadBytes());
        const property_cookie = self.symbols.xcb_change_property_checked(
            self.connection.?,
            0,
            transfer.requestor,
            transfer.property,
            transfer.target,
            8,
            @intCast(count),
            if (count == 0) null else transfer.data.ptr + transfer.offset,
        );
        transfer.offset += @intCast(count);
        transfer.sent_terminal = count == 0;
        transfer.last_progress_ns = std.time.nanoTimestamp();
        self.responses[self.response_count] = .{
            .request = std.mem.zeroes(linux.XcbSelectionRequestEvent),
            .property_cookie = property_cookie,
            .barrier_cookie = self.symbols.xcb_get_selection_owner(self.connection.?, transfer.provider.selection),
            .property = transfer.property,
            .transfer_requestor = transfer.requestor,
            .transfer_property = transfer.property,
            .notify = false,
        };
        self.response_count += 1;
        _ = self.queueFlush();
    }

    fn directPayloadBytes(self: *const Connection) u32 {
        return @max(@as(u32, 1), self.maximum_request_bytes -| 24);
    }

    fn hasTransfer(self: *const Connection, requestor: u32, property: u32) bool {
        for (self.transfers[0..self.transfer_count]) |transfer| {
            if (transfer.requestor == requestor and transfer.property == property) return true;
        }
        return false;
    }

    fn hasPendingResponseForTransfer(self: *const Connection, requestor: u32, property: u32) bool {
        for (self.responses[0..self.response_count]) |response| {
            if (response.transfer_requestor == requestor and response.transfer_property == property) return true;
        }
        return false;
    }

    fn advancePendingTransfer(self: *Connection, requestor: u32, property: u32) void {
        var index: u32 = 0;
        while (index < self.transfer_count) : (index += 1) {
            const transfer = &self.transfers[index];
            if (transfer.requestor != requestor or transfer.property != property or !transfer.delete_pending) continue;
            if (transfer.sent_terminal) {
                self.removeTransfer(index);
            } else if (self.response_count < self.responses.len) {
                self.advanceTransfer(index);
            }
            return;
        }
    }

    fn removeTransfer(self: *Connection, index: u32) void {
        const provider = self.transfers[index].provider;
        std.debug.assert(provider.transfer_count > 0);
        provider.transfer_count -= 1;
        self.transfer_count -= 1;
        if (index != self.transfer_count) self.transfers[index] = self.transfers[self.transfer_count];
        if (self.transfer_count == 0) self.transfer_cursor = 0 else self.transfer_cursor %= self.transfer_count;
        if (provider.retired and provider.transfer_count == 0) self.removeProvider(provider, true);
    }

    fn removeTransferByKey(self: *Connection, requestor: u32, property: u32) void {
        var index: u32 = 0;
        while (index < self.transfer_count) : (index += 1) {
            if (self.transfers[index].requestor != requestor or self.transfers[index].property != property) continue;
            self.removeTransfer(index);
            return;
        }
    }

    fn createOwnerWindow(self: *Connection) Progress {
        const connection = self.connection orelse return self.fail(.connection);
        const setup = self.symbols.xcb_get_setup(connection);
        var iterator = self.symbols.xcb_setup_roots_iterator(setup);
        var screen_index: c_int = 0;
        while (screen_index < self.screen_index and iterator.remaining > 0) : (screen_index += 1) {
            self.symbols.xcb_screen_next(&iterator);
        }
        if (iterator.remaining <= 0) return self.fail(.protocol);
        const screen = iterator.data;
        self.root_window = screen.root;
        self.maximum_request_bytes = @as(u32, setup.maximum_request_length) * 4;
        self.owner_window = self.symbols.xcb_generate_id(connection);
        if (self.owner_window == 0 or self.owner_window == std.math.maxInt(u32)) return self.fail(.protocol);
        const event_mask = [_]u32{EVENT_MASK_PROPERTY_CHANGE};
        _ = self.symbols.xcb_create_window(
            connection,
            0,
            self.owner_window,
            self.root_window,
            0,
            0,
            1,
            1,
            0,
            1,
            0,
            1 << 11,
            &event_mask,
        );
        self.phase = .window_flush;
        return .pending;
    }

    fn flushOwnerWindow(self: *Connection) Progress {
        const connection = self.connection orelse return self.fail(.connection);
        switch (self.flushReadiness(connection)) {
            .pending => return .pending,
            .failed => return self.fail(.connection),
            .ready => {},
        }
        if (self.symbols.xcb_flush(connection) <= 0) return self.fail(.flush);
        self.transfers = self.allocator.alloc(Transfer, self.max_provider_transfers) catch return self.fail(.provider);
        self.responses = self.allocator.alloc(PendingResponse, self.max_provider_transfers) catch return self.fail(.provider);
        self.phase = .ready;
        return .ready;
    }

    fn fail(self: *Connection, failure: Failure) Progress {
        self.failure = failure;
        self.phase = .failed;
        return .failed;
    }
};

fn propertyLongLength(max_bytes: u32) u32 {
    return max_bytes / 4 + @intFromBool(max_bytes % 4 != 0);
}

fn propertyBytes(reply: *const linux.XcbGetPropertyReply) ?[]const u8 {
    const element_bytes: u32 = switch (reply.format) {
        0 => 0,
        8 => 1,
        16 => 2,
        32 => 4,
        else => return null,
    };
    const length = std.math.mul(u32, reply.value_length, element_bytes) catch return null;
    const framed_length = std.math.mul(u32, reply.length, 4) catch return null;
    if (length > framed_length) return null;
    const pointer: [*]const u8 = @ptrCast(reply);
    return pointer[@sizeOf(linux.XcbGetPropertyReply)..][0..length];
}

fn failRead(state: *ReadState) ReadResult {
    state.phase = .failed;
    return .failed;
}

fn timestampBefore(left: u32, right: u32) bool {
    const difference: i32 = @bitCast(left -% right);
    return difference < 0;
}

fn textPropertyUsesLatin1(actual_type: u32) bool {
    return actual_type == ATOM_STRING;
}

fn encodeLatin1(allocator: std.mem.Allocator, utf8: []const u8) ![]u8 {
    var count: usize = 0;
    var offset: usize = 0;
    while (offset < utf8.len) : (count += 1) {
        const sequence_length = std.unicode.utf8ByteSequenceLength(utf8[offset]) catch return error.InvalidUtf8;
        if (sequence_length > utf8.len - offset) return error.InvalidUtf8;
        const codepoint = std.unicode.utf8Decode(utf8[offset .. offset + sequence_length]) catch return error.InvalidUtf8;
        if (codepoint > 255) return error.NotRepresentable;
        offset += sequence_length;
    }
    const output = try allocator.alloc(u8, count);
    offset = 0;
    var output_index: usize = 0;
    while (offset < utf8.len) : (output_index += 1) {
        const sequence_length = std.unicode.utf8ByteSequenceLength(utf8[offset]) catch unreachable;
        output[output_index] = @intCast(std.unicode.utf8Decode(utf8[offset .. offset + sequence_length]) catch unreachable);
        offset += sequence_length;
    }
    return output;
}

fn appendLatin1(
    allocator: std.mem.Allocator,
    output: *std.ArrayListUnmanaged(u8),
    latin1: []const u8,
    max_bytes: u32,
) !bool {
    var required: usize = 0;
    for (latin1) |byte| required += if (byte < 0x80) 1 else 2;
    if (required > max_bytes -| output.items.len) return false;
    try output.ensureUnusedCapacity(allocator, required);
    for (latin1) |byte| {
        if (byte < 0x80) {
            output.appendAssumeCapacity(byte);
        } else {
            output.appendAssumeCapacity(0xc0 | (byte >> 6));
            output.appendAssumeCapacity(0x80 | (byte & 0x3f));
        }
    }
    return true;
}

test "X11 MIME candidates preserve caller order and deterministic target compatibility" {
    var connection: Connection = undefined;
    connection.phase = .ready;
    for (&connection.atom_values, 0..) |*atom, index| atom.* = @intCast(100 + index);
    var output: [5]u32 = undefined;

    const text = connection.targetAtoms("text/plain", &output);
    try std.testing.expectEqualSlices(u32, &.{ 105, 102, 104, 103, 31 }, text);
    const png = connection.targetAtoms("image/png", &output);
    try std.testing.expectEqualSlices(u32, &.{106}, png);
    try std.testing.expectEqual(@as(usize, 0), connection.targetAtoms("application/octet-stream", &output).len);
}

test "X11 SelectionNotify routing isolates concurrent requestor windows" {
    var connection: Connection = undefined;
    var first: ReadState = .{ .phase = .selection, .window = 10, .selection = 1, .target = 2 };
    var second: ReadState = .{ .phase = .selection, .window = 11, .selection = 1, .target = 2 };
    const event: linux.XcbSelectionNotifyEvent = .{
        .response_type = EVENT_SELECTION_NOTIFY,
        .pad0 = 0,
        .sequence = 0,
        .time = 0,
        .requestor = 11,
        .selection = 1,
        .target = 2,
        .property = 0,
    };

    try std.testing.expect(!connection.routeReadEvent(&first, @ptrCast(&event)));
    try std.testing.expect(connection.routeReadEvent(&second, @ptrCast(&event)));
    try std.testing.expectEqual(ReadPhase.selection, first.phase);
    try std.testing.expectEqual(ReadPhase.refused, second.phase);
}

test "X11 property parsing enforces reply framing bounds" {
    const Property = extern struct {
        reply: linux.XcbGetPropertyReply,
        data: [4]u8,
    };
    var property: Property = .{
        .reply = .{
            .response_type = 1,
            .format = 8,
            .sequence = 0,
            .length = 1,
            .atom_type = 1,
            .bytes_after = 0,
            .value_length = 4,
            .pad0 = .{0} ** 12,
        },
        .data = "test".*,
    };
    try std.testing.expectEqualStrings("test", propertyBytes(&property.reply).?);
    property.reply.value_length = 5;
    try std.testing.expect(propertyBytes(&property.reply) == null);
}

test "X11 provider generations reserve capacity independently per selection" {
    var connection: Connection = undefined;
    connection.phase = .ready;
    connection.atom_values[0] = 100;
    var clipboard_current: Provider = .{ .selection = 100, .data = &.{} };
    var clipboard_retired: Provider = .{ .selection = 100, .data = &.{}, .retired = true, .transfer_count = 1 };
    connection.providers = .{ &clipboard_current, &clipboard_retired, null, null };
    connection.clipboard_provider = &clipboard_current;
    connection.primary_provider = null;

    try std.testing.expect(!connection.canPublish(false));
    try std.testing.expect(connection.canPublish(true));
}

test "X11 STRING conversion is Latin-1 aware and bounded after UTF-8 expansion" {
    const latin1 = try encodeLatin1(std.testing.allocator, "A\u{e9}");
    defer std.testing.allocator.free(latin1);
    try std.testing.expectEqualSlices(u8, &.{ 'A', 0xe9 }, latin1);
    try std.testing.expectError(error.NotRepresentable, encodeLatin1(std.testing.allocator, "\u{20ac}"));

    var output: std.ArrayListUnmanaged(u8) = .{};
    defer output.deinit(std.testing.allocator);
    try std.testing.expect(try appendLatin1(std.testing.allocator, &output, latin1, 3));
    try std.testing.expectEqualStrings("A\u{e9}", output.items);
    try std.testing.expect(!(try appendLatin1(std.testing.allocator, &output, &.{0xff}, 4)));
}

test "X11 text compatibility decodes by returned property type" {
    try std.testing.expect(textPropertyUsesLatin1(ATOM_STRING));
    try std.testing.expect(!textPropertyUsesLatin1(102));
}

test "X11 timestamp ordering handles server timestamp wraparound" {
    try std.testing.expect(timestampBefore(10, 20));
    try std.testing.expect(!timestampBefore(20, 10));
    try std.testing.expect(timestampBefore(std.math.maxInt(u32) - 2, 2));
}

test "X11 buffers early INCR notifications while the previous property reply is pending" {
    var connection: Connection = undefined;
    connection.phase = .ready;
    connection.atom_values[7] = 107;
    var state: ReadState = .{
        .phase = .property,
        .window = 10,
        .max_bytes = 1024,
        .incremental = true,
    };
    const event: linux.XcbPropertyNotifyEvent = .{
        .response_type = EVENT_PROPERTY_NOTIFY,
        .pad0 = 0,
        .sequence = 0,
        .window = 10,
        .atom = 107,
        .time = 1,
        .state = 0,
        .pad1 = .{0} ** 3,
    };
    try std.testing.expect(connection.routeReadEvent(&state, @ptrCast(&event)));
    try std.testing.expect(state.notification_pending);
    try std.testing.expectEqual(ReadPhase.property, state.phase);
}

test "X11 buffers INCR deletions while a checked chunk response is pending" {
    var connection: Connection = undefined;
    var provider: Provider = .{ .selection = 1, .data = &.{}, .transfer_count = 1 };
    var transfers: [1]Transfer = .{.{
        .provider = &provider,
        .data = &.{},
        .requestor = 10,
        .property = 20,
        .target = 30,
        .last_progress_ns = 1,
    }};
    var responses: [1]PendingResponse = undefined;
    connection.transfers = &transfers;
    connection.transfer_count = 1;
    connection.responses = &responses;
    connection.response_count = 1;
    const event: linux.XcbPropertyNotifyEvent = .{
        .response_type = EVENT_PROPERTY_NOTIFY,
        .pad0 = 0,
        .sequence = 0,
        .window = 10,
        .atom = 20,
        .time = 1,
        .state = PROPERTY_DELETE,
        .pad1 = .{0} ** 3,
    };
    connection.handleTransferProperty(&event);
    try std.testing.expect(connection.transfers[0].delete_pending);
    try std.testing.expectEqual(@as(u32, 1), connection.transfer_count);
}

test "X11 read cleanup remains safe after the connection enters failed phase" {
    var symbols: linux.XcbSymbols = undefined;
    symbols.xcb_discard_reply = fakeDiscardReply;
    symbols.xcb_delete_property = fakeDeleteProperty;
    symbols.xcb_destroy_window = fakeDestroyWindow;
    var fake: FakeXcb = .{};
    var connection: Connection = undefined;
    connection.symbols = &symbols;
    connection.connection = @ptrCast(&fake);
    connection.phase = .failed;
    connection.atom_values[7] = 107;
    var state: ReadState = .{ .window = 42 };

    connection.cleanupRead(&state);

    try std.testing.expectEqual(@as(u32, 0), state.window);
}

test "X11 timestamp events are isolated by per-mutation windows" {
    var connection: Connection = undefined;
    connection.phase = .ready;
    connection.owner_window = 1;
    connection.atom_values[10] = 110;
    var successor: WriteState = .{
        .selection = ATOM_PRIMARY,
        .waiting_timestamp = true,
        .timestamp_window = 22,
    };
    const stale: linux.XcbPropertyNotifyEvent = .{
        .response_type = EVENT_PROPERTY_NOTIFY,
        .pad0 = 0,
        .sequence = 0,
        .window = 21,
        .atom = 110,
        .time = 7,
        .state = 0,
        .pad1 = .{0} ** 3,
    };

    try std.testing.expect(!connection.routeWriteEvent(&successor, @ptrCast(&stale)));
    try std.testing.expect(successor.waiting_timestamp);
    try std.testing.expectEqual(@as(u32, 0), successor.timestamp);
}

test "X11 cancelled timestamp windows remain tombstoned until their event is consumed" {
    var symbols: linux.XcbSymbols = undefined;
    symbols.xcb_destroy_window = fakeDestroyWindow;
    symbols.xcb_flush = fakeFlush;
    var fake: FakeXcb = .{};
    var connection: Connection = undefined;
    connection.symbols = &symbols;
    connection.connection = @ptrCast(&fake);
    connection.phase = .ready;
    connection.output_ready_override = true;
    connection.atom_values[10] = 110;
    connection.retired_timestamp_window = 21;
    const event: linux.XcbPropertyNotifyEvent = .{
        .response_type = EVENT_PROPERTY_NOTIFY,
        .pad0 = 0,
        .sequence = 0,
        .window = 21,
        .atom = 110,
        .time = 7,
        .state = 0,
        .pad1 = .{0} ** 3,
    };

    try std.testing.expect(connection.consumeRetiredTimestampEvent(@ptrCast(&event)));
    try std.testing.expectEqual(@as(u32, 0), connection.retired_timestamp_window);
    try std.testing.expectEqual(@as(u32, 1), fake.flush_count);
}

const FakeXcb = struct {
    next_sequence: u32 = 1,
    replies_ready: bool = false,
    error_sequence: u32 = 0,
    flush_count: u32 = 0,
    discard_count: u32 = 0,
    disconnected: bool = false,
};

test "X11 atom initialization polls one reply per drive without blocking" {
    var symbols: linux.XcbSymbols = undefined;
    symbols.xcb_connection_has_error = fakeConnectionHasError;
    symbols.xcb_disconnect = fakeDisconnect;
    symbols.xcb_poll_for_reply = fakePollForReply;
    symbols.xcb_discard_reply = fakeDiscardReply;
    symbols.xcb_flush = fakeFlush;
    symbols.xcb_intern_atom = fakeInternAtom;
    symbols.xcb_get_setup = fakeGetSetup;
    symbols.xcb_setup_roots_iterator = fakeRootsIterator;
    symbols.xcb_screen_next = fakeScreenNext;
    symbols.xcb_generate_id = fakeGenerateId;
    symbols.xcb_create_window = fakeCreateWindow;
    symbols.xcb_destroy_window = fakeDestroyWindow;

    var fake: FakeXcb = .{};
    var connection = Connection.init(std.testing.allocator, &symbols, 2);
    connection.connection = @ptrCast(&fake);
    connection.phase = .atoms;
    connection.output_ready_override = false;
    defer connection.deinit();

    for (0..ATOM_NAMES.len) |_| try std.testing.expectEqual(Progress.pending, connection.drive());
    try std.testing.expectEqual(Progress.pending, connection.drive());
    try std.testing.expectEqual(@as(u32, 0), fake.flush_count);
    connection.output_ready_override = true;
    try std.testing.expectEqual(Progress.pending, connection.drive());
    try std.testing.expectEqual(@as(u32, 1), fake.flush_count);
    try std.testing.expectEqual(Progress.pending, connection.drive());
    try std.testing.expectEqual(@as(u8, 0), connection.reply_index);

    fake.replies_ready = true;
    for (0..ATOM_NAMES.len - 1) |_| try std.testing.expectEqual(Progress.pending, connection.drive());
    try std.testing.expectEqual(Progress.pending, connection.drive());
    try std.testing.expectEqual(Progress.pending, connection.drive());
    try std.testing.expectEqual(Progress.ready, connection.drive());
    const atoms = connection.atoms().?;
    try std.testing.expectEqual(ATOM_PRIMARY, atoms.primary);
    try std.testing.expectEqual(ATOM_ATOM, atoms.atom);
    try std.testing.expectEqual(ATOM_STRING, atoms.string);
    try std.testing.expectEqual(@as(u32, 101), atoms.clipboard);
    try std.testing.expectEqual(@as(u32, 112), atoms.save_targets);
    try std.testing.expectEqual(@as(u32, 0), fake.discard_count);
}

test "X11 atom initialization fails on a polled protocol error and discards remaining replies" {
    var symbols: linux.XcbSymbols = undefined;
    symbols.xcb_connection_has_error = fakeConnectionHasError;
    symbols.xcb_disconnect = fakeDisconnect;
    symbols.xcb_poll_for_reply = fakePollForReply;
    symbols.xcb_discard_reply = fakeDiscardReply;
    symbols.xcb_flush = fakeFlush;
    symbols.xcb_intern_atom = fakeInternAtom;

    var fake: FakeXcb = .{ .replies_ready = true, .error_sequence = 2 };
    var connection = Connection.init(std.testing.allocator, &symbols, 2);
    connection.connection = @ptrCast(&fake);
    connection.phase = .atoms;
    connection.output_ready_override = true;

    for (0..ATOM_NAMES.len) |_| try std.testing.expectEqual(Progress.pending, connection.drive());
    try std.testing.expectEqual(Progress.pending, connection.drive());
    try std.testing.expectEqual(Progress.pending, connection.drive());
    try std.testing.expectEqual(Progress.failed, connection.drive());
    try std.testing.expectEqual(Failure.atom, connection.failure);
    connection.deinit();
    try std.testing.expectEqual(@as(u32, ATOM_NAMES.len - 2), fake.discard_count);
    try std.testing.expect(fake.disconnected);
}

fn fakeConnectionHasError(_: *linux.XcbConnection) callconv(.c) c_int {
    return 0;
}

fn fakeDisconnect(connection: *linux.XcbConnection) callconv(.c) void {
    const fake: *FakeXcb = @ptrCast(@alignCast(connection));
    fake.disconnected = true;
}

fn fakeInternAtom(
    connection: *linux.XcbConnection,
    _: u8,
    _: u16,
    _: [*]const u8,
) callconv(.c) linux.XcbCookie {
    const fake: *FakeXcb = @ptrCast(@alignCast(connection));
    const sequence = fake.next_sequence;
    fake.next_sequence += 1;
    return .{ .sequence = sequence };
}

fn fakeFlush(connection: *linux.XcbConnection) callconv(.c) c_int {
    const fake: *FakeXcb = @ptrCast(@alignCast(connection));
    fake.flush_count += 1;
    return 1;
}

fn fakePollForReply(
    connection: *linux.XcbConnection,
    sequence: u32,
    reply_pointer: *?*anyopaque,
    error_pointer: *?*linux.XcbGenericError,
) callconv(.c) c_int {
    const fake: *FakeXcb = @ptrCast(@alignCast(connection));
    if (!fake.replies_ready) return 0;
    if (fake.error_sequence == sequence) {
        const error_memory = std.c.malloc(@sizeOf(linux.XcbGenericError)) orelse unreachable;
        error_pointer.* = @ptrCast(@alignCast(error_memory));
        return 1;
    }
    const reply_memory = std.c.malloc(@sizeOf(linux.XcbInternAtomReply)) orelse unreachable;
    const reply: *linux.XcbInternAtomReply = @ptrCast(@alignCast(reply_memory));
    reply.* = .{
        .response_type = 1,
        .pad0 = 0,
        .sequence = @truncate(sequence),
        .length = 0,
        .atom = 100 + sequence,
    };
    reply_pointer.* = reply;
    return 1;
}

fn fakeDiscardReply(connection: *linux.XcbConnection, _: u32) callconv(.c) void {
    const fake: *FakeXcb = @ptrCast(@alignCast(connection));
    fake.discard_count += 1;
}

var fake_setup: linux.XcbSetup = .{
    .status = 1,
    .pad0 = 0,
    .protocol_major_version = 11,
    .protocol_minor_version = 0,
    .length = 0,
    .release_number = 0,
    .resource_id_base = 0,
    .resource_id_mask = 0,
    .motion_buffer_size = 0,
    .vendor_length = 0,
    .maximum_request_length = 65535,
    .roots_length = 1,
    .pixmap_formats_length = 0,
    .image_byte_order = 0,
    .bitmap_format_bit_order = 0,
    .bitmap_format_scanline_unit = 0,
    .bitmap_format_scanline_pad = 0,
    .min_keycode = 0,
    .max_keycode = 0,
    .pad1 = .{0} ** 4,
};
var fake_screen: linux.XcbScreen = .{
    .root = 1,
    .default_colormap = 0,
    .white_pixel = 0,
    .black_pixel = 0,
    .current_input_masks = 0,
    .width_in_pixels = 1,
    .height_in_pixels = 1,
    .width_in_millimeters = 1,
    .height_in_millimeters = 1,
    .min_installed_maps = 0,
    .max_installed_maps = 0,
    .root_visual = 0,
    .backing_stores = 0,
    .save_unders = 0,
    .root_depth = 0,
    .allowed_depths_length = 0,
};

fn fakeGetSetup(_: *linux.XcbConnection) callconv(.c) *const linux.XcbSetup {
    return &fake_setup;
}

fn fakeRootsIterator(_: *const linux.XcbSetup) callconv(.c) linux.XcbScreenIterator {
    return .{ .data = &fake_screen, .remaining = 1, .index = 0 };
}

fn fakeScreenNext(iterator: *linux.XcbScreenIterator) callconv(.c) void {
    iterator.remaining = 0;
}

fn fakeGenerateId(_: *linux.XcbConnection) callconv(.c) u32 {
    return 2;
}

fn fakeCreateWindow(
    _: *linux.XcbConnection,
    _: u8,
    _: u32,
    _: u32,
    _: i16,
    _: i16,
    _: u16,
    _: u16,
    _: u16,
    _: u16,
    _: u32,
    _: u32,
    _: ?*const anyopaque,
) callconv(.c) linux.XcbCookie {
    return .{ .sequence = 1 };
}

fn fakeDestroyWindow(_: *linux.XcbConnection, _: u32) callconv(.c) linux.XcbCookie {
    return .{ .sequence = 1 };
}

fn fakeDeleteProperty(_: *linux.XcbConnection, _: u32, _: u32) callconv(.c) linux.XcbCookie {
    return .{ .sequence = 1 };
}
