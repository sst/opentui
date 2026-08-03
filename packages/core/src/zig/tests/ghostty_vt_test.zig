const std = @import("std");
const ghostty_vt = @import("../ghostty-vt.zig");

test "statically linked Ghostty VT uses the pinned build" {
    try std.testing.expectEqualStrings(
        ghostty_vt.expected_version,
        ghostty_vt.buildVersion() orelse return error.TestUnexpectedResult,
    );
    try std.testing.expect(ghostty_vt.isExpectedBuild());
    try std.testing.expect(ghostty_vt.smokeTest());
}
