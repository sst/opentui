const std = @import("std");

pub const MemStats = struct {
    text_buffer_bytes: usize,
    view_bytes: usize,
};

pub const BenchResult = struct {
    name: []const u8,
    min_ns: u64,
    avg_ns: u64,
    max_ns: u64,
    total_ns: u64,
    iterations: usize,
    mem_stats: ?MemStats,
};

pub fn formatDuration(ns: u64) struct { value: f64, unit: []const u8 } {
    if (ns < 1_000) {
        return .{ .value = @as(f64, @floatFromInt(ns)), .unit = "ns" };
    } else if (ns < 1_000_000) {
        return .{ .value = @as(f64, @floatFromInt(ns)) / 1_000.0, .unit = "µs" };
    } else if (ns < 1_000_000_000) {
        return .{ .value = @as(f64, @floatFromInt(ns)) / 1_000_000.0, .unit = "ms" };
    } else {
        return .{ .value = @as(f64, @floatFromInt(ns)) / 1_000_000_000.0, .unit = "s" };
    }
}

pub fn formatBytes(bytes: usize) struct { value: f64, unit: []const u8 } {
    if (bytes < 1024) {
        return .{ .value = @as(f64, @floatFromInt(bytes)), .unit = "B" };
    } else if (bytes < 1024 * 1024) {
        return .{ .value = @as(f64, @floatFromInt(bytes)) / 1024.0, .unit = "KiB" };
    } else {
        return .{ .value = @as(f64, @floatFromInt(bytes)) / (1024.0 * 1024.0), .unit = "MiB" };
    }
}

pub fn printResults(writer: anytype, results: []const BenchResult) !void {
    for (results) |result| {
        const min = formatDuration(result.min_ns);
        const avg = formatDuration(result.avg_ns);
        const max = formatDuration(result.max_ns);

        try writer.print("{s}: min={d:.2}{s} avg={d:.2}{s} max={d:.2}{s}\n", .{
            result.name,
            min.value,
            min.unit,
            avg.value,
            avg.unit,
            max.value,
            max.unit,
        });

        if (result.mem_stats) |mem| {
            const tb_mem = formatBytes(mem.text_buffer_bytes);
            const view_mem = formatBytes(mem.view_bytes);
            try writer.print("  TB arena: {d:.2} {s}  |  View arena: {d:.2} {s}\n", .{
                tb_mem.value,
                tb_mem.unit,
                view_mem.value,
                view_mem.unit,
            });
        }
    }
}
