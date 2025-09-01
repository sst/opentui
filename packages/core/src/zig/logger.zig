const std = @import("std");

// Logging system
pub const LogLevel = enum(u8) {
    err = 0,
    warn = 1,
    info = 2,
    debug = 3,
};

// Global logger state
var global_log_callback: ?*const fn (level: u8, msgPtr: [*]const u8, msgLen: usize) callconv(.C) void = null;

// Register the logging callback from TypeScript
pub fn setLogCallback(callback: ?*const fn (level: u8, msgPtr: [*]const u8, msgLen: usize) callconv(.C) void) void {
    global_log_callback = callback;
}

// Helper function to log messages - can be used directly throughout the codebase
pub fn logMessage(level: LogLevel, comptime format: []const u8, args: anytype) void {
    if (global_log_callback) |callback| {
        // Format the message into a buffer
        var buf: [4096]u8 = undefined;
        const msg = std.fmt.bufPrint(&buf, format, args) catch {
            // If formatting fails, try to log the error
            const fallback = "Log formatting failed";
            callback(@intFromEnum(LogLevel.err), fallback.ptr, fallback.len);
            return;
        };
        // msg is a slice that points into buf, with the actual formatted length
        callback(@intFromEnum(level), msg.ptr, msg.len);
    }
    // If no callback registered, drop the log
}

// Convenience functions for different log levels
pub fn err(comptime format: []const u8, args: anytype) void {
    logMessage(.err, format, args);
}

pub fn warn(comptime format: []const u8, args: anytype) void {
    logMessage(.warn, format, args);
}

pub fn info(comptime format: []const u8, args: anytype) void {
    logMessage(.info, format, args);
}

pub fn debug(comptime format: []const u8, args: anytype) void {
    logMessage(.debug, format, args);
}
