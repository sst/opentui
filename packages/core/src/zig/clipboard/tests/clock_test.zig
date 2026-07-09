const std = @import("std");
const clipboard_clock = @import("../clock.zig");

test "clipboard clock is monotonic process-relative time" {
    try clipboard_clock.init();
    const before_ns = clipboard_clock.nowNs();
    const after_ns = clipboard_clock.nowNs();

    try std.testing.expect(after_ns >= before_ns);
}
