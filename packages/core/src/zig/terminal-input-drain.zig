//! Teardown drain of stale terminal input (POSIX).
//!
//! Disabling mouse reporting is not synchronized: reports the terminal
//! generated before it processed the shutdown sequence can arrive after a
//! plain `tcflush` and leak to the next reader of the tty (the shell). To
//! close that race, write a DSR operating-status query (`CSI 5 n`) after the
//! shutdown sequence and discard input until its reply (`CSI 0 n`) arrives.
//! Terminals process output in order, so the reply proves the shutdown
//! sequence took effect and nothing after the reply can be renderer-directed
//! protocol traffic. Input read after the reply is user typed-ahead and is
//! left in the queue.
//!
//! DA1 (`CSI c`) is not usable as the sentinel: `setupTerminal` already ends
//! its kitty-graphics probe with DA1, so an unconsumed startup reply could
//! satisfy the scanner before the shutdown sequence was processed. DSR `5n`
//! is not sent anywhere else in a session.
//!
//! Caller contract: nothing else may read `input_fd` during the drain. The
//! TS layer guarantees this by pausing stdin before native destroy.

const std = @import("std");
const builtin = @import("builtin");
const posix = std.posix;

const io = if (builtin.is_test) std.testing.io else @import("root").io;
const posix_io = @import("clipboard/posix-io.zig");

const SENTINEL_QUERY = "\x1b[5n";

pub const Outcome = enum {
    /// Reply seen: all stale protocol input was read and discarded, and
    /// input arriving after the reply is preserved for the next reader.
    sentinel_confirmed,
    /// No reply within deadline/budget; fell back to flushing the queue.
    queue_flushed,
    /// The input fd is not a terminal; nothing to drain.
    not_a_terminal,
};

pub const DrainOptions = struct {
    /// Normal cost is one terminal round trip (<1ms locally, one RTT over
    /// ssh). The deadline only bounds the no-reply case (terminal ignores
    /// DSR, or stdin and stdout are different terminals) and is chosen above
    /// typical intercontinental ssh RTTs so slow links still drain exactly.
    deadline_ms: u31 = 250,
    /// ~3000 SGR mouse reports; far beyond what one teardown can queue.
    /// Bounds work if the peer floods input faster than the deadline.
    budget_bytes: u32 = 64 * 1024,
};

/// Discard queued terminal input up to the sentinel reply, preserving input
/// that arrives after the terminal acknowledged the shutdown sequence. Falls
/// back to a plain input-queue flush when no reply arrives.
pub fn drainStaleInput(input_fd: posix.fd_t, output_fd: posix.fd_t, options: DrainOptions) Outcome {
    std.debug.assert(options.deadline_ms > 0);
    std.debug.assert(options.budget_bytes > 0);

    if (std.c.isatty(input_fd) == 0) return .not_a_terminal;
    if (std.c.isatty(output_fd) == 0) {
        // The query cannot reach the terminal, so a reply can never arrive.
        flushInputQueue(input_fd);
        return .queue_flushed;
    }

    const saved = posix.tcgetattr(input_fd) catch {
        flushInputQueue(input_fd);
        return .queue_flushed;
    };

    // The TS layer already restored cooked mode; canonical reads would hold
    // the reply hostage until a newline, and echo would print discarded
    // garbage. VMIN=1 keeps read()==0 an unambiguous EOF (poll gates reads,
    // so a blocking fd never stalls).
    var drain_termios = saved;
    drain_termios.lflag.ICANON = false;
    drain_termios.lflag.ECHO = false;
    drain_termios.cc[@intFromEnum(posix.V.MIN)] = 1;
    drain_termios.cc[@intFromEnum(posix.V.TIME)] = 0;
    posix.tcsetattr(input_fd, .NOW, drain_termios) catch {
        flushInputQueue(input_fd);
        return .queue_flushed;
    };
    defer posix.tcsetattr(input_fd, .NOW, saved) catch {};

    writeFull(output_fd, SENTINEL_QUERY) catch {
        flushInputQueue(input_fd);
        return .queue_flushed;
    };

    var scanner: ReplyScanner = .{};
    const deadline = Deadline.start(options.deadline_ms);
    var bytes_read: u32 = 0;
    while (bytes_read < options.budget_bytes) {
        const remaining_ms = deadline.remainingMs() orelse break;
        var poll_fds = [_]posix.pollfd{.{ .fd = input_fd, .events = posix.POLL.IN, .revents = 0 }};
        const ready = posix.poll(&poll_fds, remaining_ms) catch break;
        if (ready == 0) break; // Deadline reached.
        if (poll_fds[0].revents & posix.POLL.IN == 0) break; // ERR/HUP/NVAL.

        // One byte at a time: never overshoots the reply, so typed-ahead
        // after the reply is preserved. Teardown volume is tiny and bounded
        // by budget_bytes, so the syscall count is acceptable.
        var byte: [1]u8 = undefined;
        const read_count = posix.read(input_fd, &byte) catch |err| switch (err) {
            error.WouldBlock => continue, // Spurious wakeup on O_NONBLOCK fd.
            else => break,
        };
        if (read_count == 0) break; // EOF.
        bytes_read += 1;
        if (scanner.feed(byte[0])) return .sentinel_confirmed;
    }

    flushInputQueue(input_fd);
    return .queue_flushed;
}

/// Recognizes the DSR reply `CSI <digits/;> n`. The parameter set excludes
/// every look-alike a session can queue: theme reports (`CSI ? 997 ; 1 n`)
/// and DA1 replies (`CSI ? ... c`) carry `?`, SGR mouse reports carry `<`,
/// and cursor position reports end in `R`.
const ReplyScanner = struct {
    state: enum { idle, esc, csi } = .idle,

    fn feed(self: *ReplyScanner, byte: u8) bool {
        switch (self.state) {
            .idle => {
                if (byte == 0x1b) self.state = .esc;
            },
            .esc => {
                self.state = if (byte == '[') .csi else if (byte == 0x1b) .esc else .idle;
            },
            .csi => switch (byte) {
                '0'...'9', ';' => {},
                'n' => {
                    self.state = .idle;
                    return true;
                },
                0x1b => self.state = .esc,
                else => self.state = .idle,
            },
        }
        return false;
    }
};

const Deadline = struct {
    started: std.Io.Timestamp,
    total_ms: u31,

    fn start(total_ms: u31) Deadline {
        return .{ .started = std.Io.Clock.awake.now(io), .total_ms = total_ms };
    }

    /// Milliseconds left, or null when expired.
    fn remainingMs(self: *const Deadline) ?i32 {
        // Clamp: a stalled or coarse clock must not extend the deadline.
        const elapsed_ms = @max(self.started.untilNow(io, .awake).toMilliseconds(), 0);
        if (elapsed_ms >= self.total_ms) return null;
        return @intCast(self.total_ms - elapsed_ms);
    }
};

fn writeFull(fd: posix.fd_t, bytes: []const u8) !void {
    var written: usize = 0;
    while (written < bytes.len) {
        const chunk = try posix_io.write(fd, bytes[written..]);
        if (chunk == 0) return error.WriteZero;
        written += chunk;
    }
}

fn flushInputQueue(fd: posix.fd_t) void {
    // Not in std.posix; values differ per OS (glibc termios.h, XNU termios.h).
    const tciflush: c_int = switch (builtin.os.tag) {
        .linux => 0,
        .macos => 1,
        else => return,
    };
    const PosixTerminal = struct {
        extern "c" fn tcflush(fd: c_int, queue_selector: c_int) c_int;
    };
    _ = PosixTerminal.tcflush(fd, tciflush);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const testing = std.testing;

fn countScannerMatches(bytes: []const u8) u32 {
    var scanner: ReplyScanner = .{};
    var count: u32 = 0;
    for (bytes) |byte| {
        if (scanner.feed(byte)) count += 1;
    }
    return count;
}

test "reply scanner matches the DSR reply, alone and after stale traffic" {
    try testing.expectEqual(@as(u32, 1), countScannerMatches("\x1b[0n"));
    try testing.expectEqual(@as(u32, 1), countScannerMatches("\x1b[3n"));
    try testing.expectEqual(@as(u32, 1), countScannerMatches("\x1b[<35;125;28M\x1b[?62;22c\x1b[0n"));
}

test "reply scanner rejects look-alike sequences" {
    try testing.expectEqual(@as(u32, 0), countScannerMatches("\x1b[?997;1n")); // theme report
    try testing.expectEqual(@as(u32, 0), countScannerMatches("\x1b[12;34R")); // cursor position
    try testing.expectEqual(@as(u32, 0), countScannerMatches("\x1b[?1u")); // kitty flags
    try testing.expectEqual(@as(u32, 0), countScannerMatches("\x1b[?62;22c")); // DA1 reply
    try testing.expectEqual(@as(u32, 0), countScannerMatches("\x1b[<35;125;28M")); // SGR mouse
    try testing.expectEqual(@as(u32, 0), countScannerMatches("plain n text"));
}

test "reply scanner recovers when ESC restarts inside a sequence" {
    try testing.expectEqual(@as(u32, 1), countScannerMatches("\x1b[12\x1b[0n"));
    try testing.expectEqual(@as(u32, 1), countScannerMatches("\x1b\x1b[0n"));
}

const TestPty = struct {
    master: posix.fd_t,
    slave: posix.fd_t,

    const C = struct {
        extern "c" fn posix_openpt(flags: c_int) c_int;
        extern "c" fn grantpt(fd: c_int) c_int;
        extern "c" fn unlockpt(fd: c_int) c_int;
        extern "c" fn ptsname(fd: c_int) ?[*:0]const u8;
    };

    fn open() !TestPty {
        const open_flags: posix.O = .{ .ACCMODE = .RDWR, .NOCTTY = true };
        const master = C.posix_openpt(@bitCast(open_flags));
        if (master < 0) return error.OpenPtyFailed;
        errdefer posix_io.close(master);
        if (C.grantpt(master) != 0) return error.OpenPtyFailed;
        if (C.unlockpt(master) != 0) return error.OpenPtyFailed;
        const slave_path = C.ptsname(master) orelse return error.OpenPtyFailed;
        const slave = try posix.openatZ(posix.AT.FDCWD, slave_path, open_flags, 0);
        return .{ .master = master, .slave = slave };
    }

    fn close(self: *TestPty) void {
        posix_io.close(self.slave);
        posix_io.close(self.master);
    }

    /// Tests that read the slave after the drain switch off canonical mode
    /// and echo, so newline-less bytes are observable via poll/read and the
    /// master sees only what the drain writes.
    fn setNonCanonical(self: *TestPty) !void {
        var raw = try posix.tcgetattr(self.slave);
        raw.lflag.ICANON = false;
        raw.lflag.ECHO = false;
        raw.cc[@intFromEnum(posix.V.MIN)] = 1;
        raw.cc[@intFromEnum(posix.V.TIME)] = 0;
        try posix.tcsetattr(self.slave, .NOW, raw);
    }
};

fn pollReadable(fd: posix.fd_t) !bool {
    var poll_fds = [_]posix.pollfd{.{ .fd = fd, .events = posix.POLL.IN, .revents = 0 }};
    const ready = try posix.poll(&poll_fds, 0);
    return ready == 1 and (poll_fds[0].revents & posix.POLL.IN) != 0;
}

test "drain returns not_a_terminal for a pipe and preserves its data" {
    if (comptime builtin.os.tag == .windows) return error.SkipZigTest;
    var pipe_fds: [2]posix.fd_t = undefined;
    try testing.expect(std.c.pipe(&pipe_fds) == 0);
    defer posix_io.close(pipe_fds[0]);
    defer posix_io.close(pipe_fds[1]);

    try writeFull(pipe_fds[1], "abc");
    try testing.expectEqual(Outcome.not_a_terminal, drainStaleInput(pipe_fds[0], pipe_fds[1], .{}));

    var buffer: [8]u8 = undefined;
    try testing.expectEqual(@as(usize, 3), try posix.read(pipe_fds[0], &buffer));
}

test "drain discards stale canonical-queued input once the reply arrives" {
    if (comptime builtin.os.tag == .windows) return error.SkipZigTest;
    var pty = try TestPty.open();
    defer pty.close();

    // Default cooked mode: newline-less stale bytes are queued but not yet
    // line-complete — the exact state after setRawMode(false) at teardown.
    try writeFull(pty.master, "\x1b[<35;125;28M\x1b[0n");

    try testing.expectEqual(
        Outcome.sentinel_confirmed,
        drainStaleInput(pty.slave, pty.slave, .{ .deadline_ms = 5000 }),
    );
}

test "drain preserves typed-ahead that arrives after the reply" {
    if (comptime builtin.os.tag == .windows) return error.SkipZigTest;
    var pty = try TestPty.open();
    defer pty.close();
    try pty.setNonCanonical();

    try writeFull(pty.master, "\x1b[<35;125;28M\x1b[<35;126;28M\x1b[0n" ++ "after");

    try testing.expectEqual(
        Outcome.sentinel_confirmed,
        drainStaleInput(pty.slave, pty.slave, .{ .deadline_ms = 5000 }),
    );

    // Typed-ahead past the reply stays queued for the next reader.
    try testing.expect(try pollReadable(pty.slave));
    var buffer: [64]u8 = undefined;
    const count = try posix.read(pty.slave, &buffer);
    try testing.expectEqualStrings("after", buffer[0..count]);

    // The sentinel query reached the terminal side.
    try testing.expect(try pollReadable(pty.master));
    var master_buffer: [64]u8 = undefined;
    const master_count = try posix.read(pty.master, &master_buffer);
    try testing.expectEqualStrings(SENTINEL_QUERY, master_buffer[0..master_count]);
}

test "drain waits out a delayed reply and still preserves typed-ahead" {
    if (comptime builtin.os.tag == .windows) return error.SkipZigTest;
    var pty = try TestPty.open();
    defer pty.close();
    try pty.setNonCanonical();

    // Stale report already queued when teardown starts.
    try writeFull(pty.master, "\x1b[<35;125;28M");

    // Models a terminal one RTT away (ssh): it sees the query, keeps emitting
    // stale reports, and only then replies. A fixed post-shutdown delay
    // cannot cover this; the sentinel wait must.
    const Emulator = struct {
        fn run(master: posix.fd_t) void {
            var received: [16]u8 = undefined;
            var received_len: usize = 0;
            // Bounded wait for the query so a failing drain cannot deadlock
            // the test on join().
            while (received_len < SENTINEL_QUERY.len) {
                var poll_fds = [_]posix.pollfd{.{ .fd = master, .events = posix.POLL.IN, .revents = 0 }};
                const ready = posix.poll(&poll_fds, 3000) catch return;
                if (ready == 0) return;
                if (poll_fds[0].revents & posix.POLL.IN == 0) return;
                const count = posix.read(master, received[received_len..]) catch return;
                if (count == 0) return;
                received_len += count;
            }
            if (!std.mem.eql(u8, received[0..SENTINEL_QUERY.len], SENTINEL_QUERY)) return;
            io.sleep(.fromMilliseconds(100), .awake) catch {};
            writeFull(master, "\x1b[<36;1;1M\x1b[0n" ++ "typed") catch {};
        }
    };
    const emulator_thread = try std.Thread.spawn(.{}, Emulator.run, .{pty.master});
    defer emulator_thread.join();

    try testing.expectEqual(
        Outcome.sentinel_confirmed,
        drainStaleInput(pty.slave, pty.slave, .{ .deadline_ms = 5000 }),
    );

    // "typed" was part of the same write as the reply, so it is already
    // queued; the deferred join only reaps the emulator thread.
    try testing.expect(try pollReadable(pty.slave));
    var buffer: [64]u8 = undefined;
    const count = try posix.read(pty.slave, &buffer);
    try testing.expectEqualStrings("typed", buffer[0..count]);
}

test "drain flushes the unread queue when the reply never comes" {
    if (comptime builtin.os.tag == .windows) return error.SkipZigTest;
    var pty = try TestPty.open();
    defer pty.close();
    try pty.setNonCanonical();

    try writeFull(pty.master, "0123456789");

    try testing.expectEqual(
        Outcome.queue_flushed,
        drainStaleInput(pty.slave, pty.slave, .{ .deadline_ms = 50, .budget_bytes = 4 }),
    );

    // The budget stopped reads at 4 bytes; the fallback flush removed the rest.
    try testing.expect(!(try pollReadable(pty.slave)));
}

test "drain falls back after the deadline with a silent terminal" {
    if (comptime builtin.os.tag == .windows) return error.SkipZigTest;
    var pty = try TestPty.open();
    defer pty.close();

    try testing.expectEqual(
        Outcome.queue_flushed,
        drainStaleInput(pty.slave, pty.slave, .{ .deadline_ms = 30 }),
    );
}

test "drain restores the caller's termios" {
    if (comptime builtin.os.tag == .windows) return error.SkipZigTest;
    var pty = try TestPty.open();
    defer pty.close();

    const before = try posix.tcgetattr(pty.slave);
    try writeFull(pty.master, "\x1b[0n");

    try testing.expectEqual(
        Outcome.sentinel_confirmed,
        drainStaleInput(pty.slave, pty.slave, .{ .deadline_ms = 5000 }),
    );

    const after = try posix.tcgetattr(pty.slave);
    try testing.expectEqual(before.lflag, after.lflag);
    try testing.expectEqual(before.cc[@intFromEnum(posix.V.MIN)], after.cc[@intFromEnum(posix.V.MIN)]);
    try testing.expectEqual(before.cc[@intFromEnum(posix.V.TIME)], after.cc[@intFromEnum(posix.V.TIME)]);
}
