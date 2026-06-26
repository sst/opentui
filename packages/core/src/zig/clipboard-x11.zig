const std = @import("std");
const builtin = @import("builtin");
const linux = @import("clipboard-linux.zig");

pub const ATOM_PRIMARY: u32 = 1;
pub const ATOM_ATOM: u32 = 4;
pub const ATOM_STRING: u32 = 31;

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
pub const Failure = enum { none, connection, flush, atom };

const Phase = enum { idle, atoms, flush, replies, ready, unsupported, failed };
const FlushReadiness = enum { pending, ready, failed };

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
    symbols: *const linux.XcbSymbols,
    connection: ?*linux.XcbConnection = null,
    phase: Phase = .idle,
    failure: Failure = .none,
    cookies: [ATOM_NAMES.len]linux.XcbCookie = undefined,
    atom_values: [ATOM_NAMES.len]u32 = undefined,
    request_index: u8 = 0,
    reply_index: u8 = 0,
    output_ready_override: ?bool = null,

    pub fn init(symbols: *const linux.XcbSymbols) Connection {
        return .{ .symbols = symbols };
    }

    pub fn deinit(self: *Connection) void {
        if (self.connection) |connection| {
            var index = self.reply_index;
            while (index < self.request_index) : (index += 1) {
                self.symbols.xcb_discard_reply(connection, self.cookies[index].sequence);
            }
            self.symbols.xcb_disconnect(connection);
        }
        self.* = undefined;
    }

    pub fn drive(self: *Connection) Progress {
        switch (self.phase) {
            .idle => return self.connect(),
            .atoms => return self.requestAtom(),
            .flush => return self.flushAtoms(),
            .replies => return self.pollAtom(),
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

    fn connect(self: *Connection) Progress {
        var screen: c_int = 0;
        const connection = self.symbols.xcb_connect(null, &screen) orelse {
            self.phase = .unsupported;
            return .unsupported;
        };
        self.connection = connection;
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
        self.phase = .ready;
        return .ready;
    }

    fn fail(self: *Connection, failure: Failure) Progress {
        self.failure = failure;
        self.phase = .failed;
        return .failed;
    }
};

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

    var fake: FakeXcb = .{};
    var connection = Connection.init(&symbols);
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
    var connection = Connection.init(&symbols);
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
