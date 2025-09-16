const std = @import("std");
const builtin = @import("builtin");

/// Pty provides a cross-platform interface for creating and managing
/// pseudo-terminals. On Unix-like systems, it spawns an interactive shell
/// process connected via PTY. Windows support is stubbed.
pub const Pty = if (builtin.os.tag == .windows) struct {
    master_fd: i32 = -1,
    child_pid: i32 = -1,

    pub fn spawnShell(_: std.mem.Allocator, _: u16, _: u16) !*Pty {
        return error.UnsupportedPlatform;
    }
    pub fn resize(_: *Pty, _: u16, _: u16) void {}
    pub fn write(_: *Pty, _: []const u8) usize { return 0; }
    pub fn readNonblocking(_: *Pty, _: []u8) !usize { return 0; }
    pub fn destroy(self: *Pty, allocator: std.mem.Allocator) void { allocator.destroy(self); }
} else struct {
    const c = @cImport({
        @cInclude("errno.h");
        @cInclude("fcntl.h");
        @cInclude("signal.h");
        @cInclude("stdlib.h");
        @cInclude("string.h");
        @cInclude("sys/ioctl.h");
        @cInclude("sys/wait.h");
        @cInclude("sys/types.h");
        @cInclude("termios.h");
        @cInclude("unistd.h");
    });

    master_fd: i32,
    child_pid: i32,

    /// Creates a new PTY and spawns an interactive shell process.
    /// The shell is determined by $SHELL environment variable or defaults to /bin/bash.
    /// Returns a Pty instance that can be used to read/write to the shell.
    pub fn spawnShell(allocator: std.mem.Allocator, cols: u16, rows: u16) !*Pty {
        // Open a new PTY master using posix_openpt
        const flags: i32 = c.O_RDWR | c.O_NOCTTY | c.O_CLOEXEC;
        const master: i32 = @intCast(c.posix_openpt(flags));
        if (master < 0) return error.OpenPtyFailed;

        if (c.grantpt(master) != 0) {
            _ = c.close(master);
            return error.GrantPtyFailed;
        }
        if (c.unlockpt(master) != 0) {
            _ = c.close(master);
            return error.UnlockPtyFailed;
        }

        const name = c.ptsname(master);
        if (name == null) {
            _ = c.close(master);
            return error.PtsNameFailed;
        }

        // Set non-blocking on master
        const cur_flags = c.fcntl(master, c.F_GETFL, @as(i32, 0));
        if (cur_flags >= 0) {
            _ = c.fcntl(master, c.F_SETFL, cur_flags | c.O_NONBLOCK);
        }

        // Note: We don't configure terminal modes on the master side
        // The slave side (shell) handles echo, and we display what comes back
        // Setting modes on master can cause issues with some shells

        // Fork child process to exec shell
        const pid: i32 = @intCast(c.fork());
        if (pid < 0) {
            _ = c.close(master);
            return error.ForkFailed;
        }

        if (pid == 0) {
            // Child
            // Create new session
            _ = c.setsid();

            // Open slave
            const slave: i32 = @intCast(c.open(name, c.O_RDWR | c.O_NOCTTY, @as(i32, 0)));
            if (slave < 0) {
                // If we fail, just exit child
                c._exit(1);
            }

            // Make slave controlling terminal
            var one: i32 = 0;
            _ = c.ioctl(slave, c.TIOCSCTTY, &one);

            // Set window size
            var ws: c.struct_winsize = .{ .ws_row = rows, .ws_col = cols, .ws_xpixel = 0, .ws_ypixel = 0 };
            _ = c.ioctl(slave, c.TIOCSWINSZ, &ws);
            
            // Set terminal to sane defaults before the shell starts
            // DISABLE ECHO to prevent double character issue
            var tios: c.struct_termios = undefined;
            if (c.tcgetattr(slave, &tios) == 0) {
                // Enable canonical mode WITHOUT echo
                tios.c_lflag = c.ICANON | c.ISIG;  // No ECHO flags
                // Set input flags
                tios.c_iflag = c.ICRNL | c.IXON;
                // Set output flags  
                tios.c_oflag = c.OPOST | c.ONLCR;
                // Set control flags
                tios.c_cflag |= c.CREAD | c.CS8;
                _ = c.tcsetattr(slave, c.TCSANOW, &tios);
            }

            // Duplicate stdio
            _ = c.dup2(slave, 0);
            _ = c.dup2(slave, 1);
            _ = c.dup2(slave, 2);

            // Close inherited fds
            if (slave != 0 and slave != 1 and slave != 2) _ = c.close(slave);
            _ = c.close(master);

            // Basic environment setup
            _ = c.setenv("TERM", "xterm-256color", 1);

            // Determine shell
            var shell_buf: [256]u8 = undefined;
            var shell_len: usize = 0;
            if (std.process.getEnvVarOwned(std.heap.page_allocator, "SHELL")) |sh| {
                defer std.heap.page_allocator.free(sh);
                if (sh.len < shell_buf.len) {
                    std.mem.copyForwards(u8, shell_buf[0..sh.len], sh);
                    shell_len = sh.len;
                }
            } else |_| {
                const fallback = "/bin/bash";
                std.mem.copyForwards(u8, shell_buf[0..fallback.len], fallback);
                shell_len = fallback.len;
            }
            shell_buf[shell_len] = 0; // nul

            const sh_ptr: [*c]const u8 = @ptrCast(&shell_buf[0]);
            // Don't print debug in child - it pollutes the PTY
            var argv: [3][*c]const u8 = .{ sh_ptr, "-i", null };
            // exec: interactive shell
            _ = c.execvp(sh_ptr, @ptrCast(&argv[0]));

            // If exec fails, exit child silently
            c._exit(127);
        }

        // Parent: set initial winsize on master to notify child
        var ws2: c.struct_winsize = .{ .ws_row = rows, .ws_col = cols, .ws_xpixel = 0, .ws_ypixel = 0 };
        _ = c.ioctl(master, c.TIOCSWINSZ, &ws2);

        const self = try allocator.create(Pty);
        self.* = .{ .master_fd = master, .child_pid = pid };
        return self;
    }

    pub fn resize(self: *Pty, cols: u16, rows: u16) void {
        var ws: c.struct_winsize = .{ .ws_row = rows, .ws_col = cols, .ws_xpixel = 0, .ws_ypixel = 0 };
        _ = c.ioctl(self.master_fd, c.TIOCSWINSZ, &ws);
    }

    pub fn write(self: *Pty, data: []const u8) usize {
        const rc = c.write(self.master_fd, data.ptr, @intCast(data.len));
        if (rc < 0) return 0;
        return @intCast(rc);
    }

    /// Reads available data from the PTY in non-blocking mode.
    /// Returns 0 if no data is available or on transient errors.
    /// The master FD is set to O_NONBLOCK during initialization.
    pub fn readNonblocking(self: *Pty, out: []u8) !usize {
        const n = c.read(self.master_fd, out.ptr, @intCast(out.len));
        if (n < 0) {
            // Return 0 for any error (likely EAGAIN/EWOULDBLOCK)
            return 0;
        }
        return @intCast(n);
    }

    pub fn destroy(self: *Pty, allocator: std.mem.Allocator) void {
        if (self.master_fd >= 0) _ = c.close(self.master_fd);
        // Try to reap child non-blocking
        var status: i32 = 0;
        _ = c.waitpid(self.child_pid, &status, c.WNOHANG);
        allocator.destroy(self);
    }
};
