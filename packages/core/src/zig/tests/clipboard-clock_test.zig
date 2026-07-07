const std = @import("std");
const clipboard_clock = @import("../clipboard-clock.zig");

test "clipboard clock is monotonic process-relative time" {
    try clipboard_clock.init();
    const before_ns = clipboard_clock.nowNs();
    const after_ns = clipboard_clock.nowNs();

    try std.testing.expect(after_ns >= before_ns);
}

test "clipboard production timestamps use the shared clock" {
    const sources = .{
        @embedFile("../clipboard.zig"),
        @embedFile("../clipboard-wayland.zig"),
        @embedFile("../clipboard-x11.zig"),
        @embedFile("../clipboard-windows.zig"),
        @embedFile("../clipboard-windows-dib.zig"),
        @embedFile("../clipboard-macos.zig"),
    };

    inline for (sources) |source| {
        try std.testing.expect(std.mem.indexOf(u8, source, "std.time.nanoTimestamp") == null);
    }
}
