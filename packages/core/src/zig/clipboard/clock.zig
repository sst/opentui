const std = @import("std");
const sync = @import("sync.zig");

pub fn init() !void {}

pub const sleep = sync.sleep;

pub fn nowNs() i128 {
    return sync.nowNs();
}

test "clipboard clock is monotonic process-relative time" {
    try init();
    const before_ns = nowNs();
    try std.testing.expect(nowNs() >= before_ns);
}
