const std = @import("std");

test "macOS clipboard shim enables ARC exception cleanup" {
    const source = @embedFile("../../build.zig");
    try std.testing.expect(std.mem.indexOf(u8, source, "\"-fobjc-arc-exceptions\"") != null);
}
