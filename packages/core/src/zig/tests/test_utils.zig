const std = @import("std");
const builtin = @import("builtin");
const testing = std.testing;

const is_posix = switch (builtin.os.tag) {
    .linux, .macos, .freebsd, .openbsd, .netbsd, .dragonfly => true,
    else => false,
};

extern "c" fn setenv(name: [*:0]const u8, value: [*:0]const u8, overwrite: c_int) c_int;
extern "c" fn unsetenv(name: [*:0]const u8) c_int;

/// Platform-specific environment variable manipulation for tests.
/// Temporarily sets an environment variable and returns the previous value.
/// Caller must call restoreEnvVar() to restore the original value.
///
/// # Safety
/// - On POSIX: Uses libc setenv/unsetenv which are thread-unsafe
/// - On Windows: Currently panics (not implemented)
pub fn setEnvVarTemp(allocator: std.mem.Allocator, name: [:0]const u8, value: ?[:0]const u8) !?[:0]u8 {
    if (!is_posix) {
        @panic("setEnvVarTemp not implemented for this platform");
    }

    const name_slice: []const u8 = name[0..name.len];
    var previous: ?[:0]u8 = null;

    if (std.posix.getenv(name_slice)) |existing| {
        const buffer = try allocator.alloc(u8, existing.len + 1);
        @memcpy(buffer[0..existing.len], existing);
        buffer[existing.len] = 0;
        previous = buffer[0..existing.len :0];
    }

    if (value) |v| {
        if (setenv(name, v, 1) != 0) {
            return error.SkipZigTest;
        }
    } else {
        _ = unsetenv(name);
    }

    return previous;
}

/// Restores an environment variable to its previous value.
/// Should be called with the value returned by setEnvVarTemp().
pub fn restoreEnvVar(allocator: std.mem.Allocator, name: [:0]const u8, previous: ?[:0]u8) void {
    if (!is_posix) {
        @panic("restoreEnvVar not implemented for this platform");
    }

    if (previous) |value| {
        _ = setenv(name, value, 1);
        allocator.free(value[0 .. value.len + 1]);
    } else {
        _ = unsetenv(name);
    }
}
