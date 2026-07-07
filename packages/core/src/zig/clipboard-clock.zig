const std = @import("std");

var mutex: std.Thread.Mutex = .{};
var timer: ?std.time.Timer = null;

pub fn init() !void {
    mutex.lock();
    defer mutex.unlock();

    if (timer != null) return;
    timer = try std.time.Timer.start();
}

pub fn nowNs() i128 {
    mutex.lock();
    defer mutex.unlock();

    return @intCast(timer.?.read());
}
