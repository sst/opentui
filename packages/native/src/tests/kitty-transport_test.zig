const std = @import("std");
const builtin = @import("builtin");
const kitty = @import("../kitty-transport.zig");
const image = @import("../image.zig");

const Fixture = struct {
    tmp: std.testing.TmpDir,
    directory: [512]u8 = undefined,
    directory_len: usize = 0,
    transport: kitty.Transport = .{ .mode = .file },
    output: std.Io.Writer.Allocating = .init(std.testing.allocator),

    fn init(self: *Fixture) !void {
        if (builtin.os.tag == .windows) return error.SkipZigTest;
        self.* = .{ .tmp = std.testing.tmpDir(.{}) };
        errdefer self.tmp.cleanup();
        self.directory_len = try self.tmp.dir.realPath(std.testing.io, &self.directory);
    }

    fn deinit(self: *Fixture) void {
        self.transport.cancel(.cancelled);
        self.output.deinit();
        self.tmp.cleanup();
    }

    fn probe(self: *Fixture) !void {
        try self.transport.startProbe(&self.output.writer, 7, self.directory[0..self.directory_len]);
    }

    fn ready(self: *Fixture) !void {
        try self.probe();
        try std.testing.expect(self.transport.handleReply("\x1b_Gi=7;OK\x1b\\"));
        try std.testing.expect(self.transport.handleReply("\x1b_Gi=8;OK\x1b\\"));
        try std.testing.expectEqual(.ready, self.transport.file_state);
        self.output.clearRetainingCapacity();
    }

    fn transmit(self: *Fixture, value: *image.Image, id: u32) !void {
        try self.transport.transmit(std.testing.allocator, &self.output.writer, value, id, false, self.directory[0..self.directory_len]);
    }
};

test "kitty file query requires medium and explicit image ACK, not ordinary frame reports" {
    var f: Fixture = undefined;
    try f.init();
    defer f.deinit();
    try f.probe();
    try std.testing.expect(std.mem.find(u8, f.output.written(), "a=q,t=f") != null);
    try std.testing.expect(std.mem.find(u8, f.output.written(), "a=t,t=f") != null);
    try std.testing.expectEqual(@as(u32, 1), f.transport.pendingCount());
    try std.testing.expect(!f.transport.handleReply("\x1b[0n"));
    try std.testing.expect(!f.transport.handleReply("\x1b_Gi=31337;OK\x1b\\"));
    try std.testing.expect(!f.transport.handleReply("\x1b_Gi=7,i=8;OK\x1b\\"));
    try std.testing.expect(f.transport.handleReply("\x1b_Gi=7;OK\x1b\\"));
    try std.testing.expectEqual(.probing, f.transport.file_state);
    f.transport.expire(std.math.maxInt(i64));
    try std.testing.expectEqual(.timeout, f.transport.file_state);
    try std.testing.expectEqual(@as(u32, 0), f.transport.pendingCount());
    try std.testing.expect(f.transport.handleReply("\x1b_Gi=8;OK\x1b\\"));
    try std.testing.expectEqual(.timeout, f.transport.file_state);
}

test "kitty file leases contain immutable bytes and are released only by matching ACK" {
    var f: Fixture = undefined;
    try f.init();
    defer f.deinit();
    try f.ready();
    const value = try image.createFromRgba(std.testing.allocator, &.{ 1, 2, 3, 255 }, 1, 1, 4);
    defer value.deinit();
    try f.transmit(value, 19);
    try std.testing.expectEqual(.file, f.transport.effective);
    const path = try @import("terminal-image_test.zig").decodeKittyChunks(f.output.written());
    defer std.testing.allocator.free(path);
    const contents = try std.Io.Dir.cwd().readFileAlloc(std.testing.io, path, std.testing.allocator, .limited(16));
    defer std.testing.allocator.free(contents);
    try std.testing.expectEqualSlices(u8, &.{ 1, 2, 3 }, contents);
    value.pixels[0] = 99;
    try f.transmit(value, 19);
    try std.testing.expectEqual(.raw, f.transport.effective);
    try std.testing.expectEqual(.busy, f.transport.fallback);
    try std.testing.expectEqual(@as(u32, 1), f.transport.pendingCount());
    try std.testing.expect(!f.transport.handleReply("\x1b_Gi=190;OK\x1b\\"));
    try std.Io.Dir.accessAbsolute(std.testing.io, path, .{});
    const unchanged = try std.Io.Dir.cwd().readFileAlloc(std.testing.io, path, std.testing.allocator, .limited(16));
    defer std.testing.allocator.free(unchanged);
    try std.testing.expectEqualSlices(u8, contents, unchanged);
    try std.testing.expect(f.transport.handleReply("\x1b_Gi=19;OK\x1b\\"));
    try std.testing.expectError(error.FileNotFound, std.Io.Dir.accessAbsolute(std.testing.io, path, .{}));
    try std.testing.expectEqual(@as(u32, 0), f.transport.pendingCount());
}

test "kitty file upload expiry cancels rather than reusing a late acknowledged lease" {
    var f: Fixture = undefined;
    try f.init();
    defer f.deinit();
    try f.ready();
    const value = try image.createFromRgba(std.testing.allocator, &.{ 1, 2, 3, 4 }, 1, 1, 4);
    defer value.deinit();
    try f.transmit(value, 19);
    var deadline: i64 = 0;
    for (f.transport.leases) |lease| if (lease.path_len != 0) {
        deadline = lease.deadline_ms;
    };
    f.transport.expire(deadline - 1);
    try std.testing.expectEqual(@as(u32, 1), f.transport.pendingCount());
    f.transport.expire(deadline);
    try std.testing.expectEqual(@as(u32, 0), f.transport.pendingCount());
    try std.testing.expectEqual(.timeout, f.transport.file_state);
    try f.transmit(value, 19);
    try std.testing.expectEqual(.raw, f.transport.effective);
    try std.testing.expect(!f.transport.handleReply("\x1b_Gi=19;OK\x1b\\"));
    try std.testing.expectEqual(.timeout, f.transport.file_state);
}

test "kitty file budget timeout errors and cancel release bounded leases" {
    var f: Fixture = undefined;
    try f.init();
    defer f.deinit();
    try f.ready();
    const value = try image.createFromRgba(std.testing.allocator, &.{ 1, 2, 3, 4 }, 1, 1, 4);
    defer value.deinit();
    for (0..kitty.LEASES_MAX) |i| try f.transmit(value, @intCast(20 + i));
    try f.transmit(value, 100);
    try std.testing.expectEqual(.raw, f.transport.effective);
    try std.testing.expectEqual(.budget, f.transport.fallback);
    try std.testing.expectEqual(@as(u32, kitty.LEASES_MAX), f.transport.pendingCount());
    try std.testing.expectEqual(@as(usize, kitty.LEASES_MAX * 4), f.transport.pendingBytes());
    try std.testing.expect(f.transport.handleReply("\x1b_Gi=20;ENOENT:not found\x1b\\"));
    try std.testing.expectEqual(.unsupported, f.transport.file_state);
    try std.testing.expect(f.transport.retry_images);
    try std.testing.expectEqual(@as(u32, 0), f.transport.pendingCount());
    try f.transmit(value, 100);
    try std.testing.expectEqual(.raw, f.transport.effective);
    f.transport.cancel(.cancelled);
    try std.testing.expectEqual(.cancelled, f.transport.file_state);
}

test "kitty file preparation and output failures do not leak resources" {
    var f: Fixture = undefined;
    try f.init();
    defer f.deinit();
    var failed: std.Io.Writer = .failing;
    try std.testing.expectError(error.WriteFailed, f.transport.startProbe(&failed, 7, f.directory[0..f.directory_len]));
    try std.testing.expectEqual(@as(u32, 0), f.transport.pendingCount());
    f.transport = .{ .mode = .file, .file_state = .ready };
    const value = try image.createFromRgba(std.testing.allocator, &.{ 1, 2, 3, 4 }, 1, 1, 4);
    defer value.deinit();
    try f.transport.transmit(std.testing.allocator, &f.output.writer, value, 19, false, "relative/path");
    try std.testing.expectEqual(.raw, f.transport.effective);
    try std.testing.expectEqual(.io_error, f.transport.file_state);
    try std.testing.expectEqual(@as(u32, 0), f.transport.pendingCount());
}
