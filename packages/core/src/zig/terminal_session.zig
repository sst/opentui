const std = @import("std");
const buffer = @import("buffer.zig");
const Pty = @import("pty.zig").Pty;
const TerminalEmu = @import("libvterm_emu.zig").LibVTermEmu;
const libvterm = @import("libvterm.zig");

/// TerminalSession combines a PTY (pseudo-terminal) with a terminal emulator.
/// It manages the lifecycle of spawning a shell, reading its output, processing
/// ANSI escape sequences, and rendering the terminal display.
pub const TerminalSession = struct {
    allocator: std.mem.Allocator,
    pty: *Pty,
    emu: *TerminalEmu,
    read_buf: []u8,

    pub fn create(allocator: std.mem.Allocator, cols: u16, rows: u16) !*TerminalSession {
        const pty = try Pty.spawnShell(allocator, cols, rows);
        const emu = try TerminalEmu.init(allocator, cols, rows);
        const rb = try allocator.alloc(u8, 64 * 1024);
        const self = try allocator.create(TerminalSession);
        self.* = .{ .allocator = allocator, .pty = pty, .emu = emu, .read_buf = rb };
        return self;
    }

    pub fn destroy(self: *TerminalSession) void {
        self.pty.destroy(self.allocator);
        self.emu.deinit();
        self.allocator.free(self.read_buf);
        self.allocator.destroy(self);
    }

    pub fn write(self: *TerminalSession, data: []const u8) usize {
        // Write only to PTY, not to emulator
        // The PTY will echo back and we'll display that
        return self.pty.write(data);
    }

    pub fn resize(self: *TerminalSession, cols: u16, rows: u16) void {
        self.pty.resize(cols, rows);
        self.emu.resize(cols, rows) catch {};
    }

    /// Reads data from the PTY and feeds it to the terminal emulator.
    /// Called each frame to process any pending output from the shell.
    /// Limits reading to prevent blocking the UI thread.
    pub fn tick(self: *TerminalSession) i32 {
        // Read a limited amount per tick to avoid starving renderer
        var total: usize = 0;
        var loops: usize = 0;
        while (loops < 32) : (loops += 1) {
            const n = self.pty.readNonblocking(self.read_buf) catch break;
            if (n == 0) break;
            total += n;
            self.emu.feed(self.read_buf[0..n]);
            if (total > 512 * 1024) break; // safety cap
        }
        return @intCast(total);
    }

    /// Renders the terminal display to the target buffer at the specified position.
    /// The terminal emulator provides a packed buffer format that includes
    /// character data, foreground/background colors, and cursor position.
    pub fn render(self: *TerminalSession, target: *buffer.OptimizedBuffer, x: u32, y: u32) void {
        const view = self.emu.packedView();
        if (view.len == 0) return;
        target.drawPackedBuffer(view.ptr, view.len, x, y, self.emu.cols, self.emu.rows);
    }

    pub fn setSelection(
        self: *TerminalSession,
        rect: ?libvterm.SelectionRect,
        fg: buffer.RGBA,
        bg: buffer.RGBA,
    ) void {
        self.emu.setSelection(rect, fg, bg);
    }

    pub fn clearSelection(self: *TerminalSession) void {
        self.emu.clearSelection();
    }

    pub fn hasSelection(self: *TerminalSession) bool {
        return self.emu.hasSelection();
    }

    pub fn copySelection(self: *TerminalSession, rect: libvterm.SelectionRect, out_buffer: []u8) usize {
        return self.emu.copySelection(rect, out_buffer);
    }
};
