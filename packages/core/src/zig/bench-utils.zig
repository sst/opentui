const std = @import("std");

pub const MemStat = struct {
    name: []const u8,
    bytes: usize,
};

pub const BenchResult = struct {
    name: []const u8,
    min_ns: u64,
    avg_ns: u64,
    max_ns: u64,
    total_ns: u64,
    iterations: usize,
    mem_stats: ?[]const MemStat,
};

pub fn formatDuration(ns: u64) struct { value: f64, unit: []const u8 } {
    if (ns < 1_000) {
        return .{ .value = @as(f64, @floatFromInt(ns)), .unit = "ns" };
    } else if (ns < 1_000_000) {
        return .{ .value = @as(f64, @floatFromInt(ns)) / 1_000.0, .unit = "us" };
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
    if (results.len == 0) return;

    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Collect all unique memory stat names
    var mem_stat_names = std.ArrayList([]const u8).init(allocator);
    for (results) |result| {
        if (result.mem_stats) |stats| {
            for (stats) |stat| {
                // Check if we already have this name
                var found = false;
                for (mem_stat_names.items) |existing_name| {
                    if (std.mem.eql(u8, existing_name, stat.name)) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    try mem_stat_names.append(stat.name);
                }
            }
        }
    }

    // Calculate column widths
    var max_name_len: usize = 20; // minimum
    var min_col_width: usize = 3; // minimum for "Min"
    var avg_col_width: usize = 3; // minimum for "Avg"
    var max_col_width: usize = 3; // minimum for "Max"

    // Create a map to store column widths for each memory stat
    var mem_col_widths = std.ArrayList(usize).init(allocator);
    for (mem_stat_names.items) |name| {
        try mem_col_widths.append(name.len); // minimum is the name length
    }

    // First pass: calculate maximum widths
    for (results) |result| {
        if (result.name.len > max_name_len) {
            max_name_len = result.name.len;
        }

        const min = formatDuration(result.min_ns);
        const avg = formatDuration(result.avg_ns);
        const max = formatDuration(result.max_ns);

        var min_buf: [32]u8 = undefined;
        const min_str = std.fmt.bufPrint(&min_buf, "{d:.2}{s}", .{ min.value, min.unit }) catch unreachable;
        if (min_str.len > min_col_width) min_col_width = min_str.len;

        var avg_buf: [32]u8 = undefined;
        const avg_str = std.fmt.bufPrint(&avg_buf, "{d:.2}{s}", .{ avg.value, avg.unit }) catch unreachable;
        if (avg_str.len > avg_col_width) avg_col_width = avg_str.len;

        var max_buf: [32]u8 = undefined;
        const max_str = std.fmt.bufPrint(&max_buf, "{d:.2}{s}", .{ max.value, max.unit }) catch unreachable;
        if (max_str.len > max_col_width) max_col_width = max_str.len;

        if (result.mem_stats) |stats| {
            for (stats) |stat| {
                const mem = formatBytes(stat.bytes);
                var mem_buf: [32]u8 = undefined;
                const mem_str = std.fmt.bufPrint(&mem_buf, "{d:.2} {s}", .{ mem.value, mem.unit }) catch unreachable;

                // Find the index of this stat name
                for (mem_stat_names.items, 0..) |name, i| {
                    if (std.mem.eql(u8, name, stat.name)) {
                        if (mem_str.len > mem_col_widths.items[i]) {
                            mem_col_widths.items[i] = mem_str.len;
                        }
                        break;
                    }
                }
            }
        }
    }

    // Print header
    var total_width = max_name_len + 3 + min_col_width + 3 + avg_col_width + 3 + max_col_width;
    for (mem_col_widths.items) |width| {
        total_width += 3 + width;
    }
    try writer.writeByteNTimes('-', total_width);
    try writer.writeByte('\n');

    // Column headers
    try writer.writeAll("Benchmark");
    try writer.writeByteNTimes(' ', max_name_len - 9);
    try writer.writeAll(" | ");

    try writer.writeAll("Min");
    try writer.writeByteNTimes(' ', min_col_width - 3);
    try writer.writeAll(" | ");

    try writer.writeAll("Avg");
    try writer.writeByteNTimes(' ', avg_col_width - 3);
    try writer.writeAll(" | ");

    try writer.writeAll("Max");
    try writer.writeByteNTimes(' ', max_col_width - 3);

    // Dynamic memory stat headers
    for (mem_stat_names.items, 0..) |name, i| {
        try writer.writeAll(" | ");
        try writer.writeAll(name);
        if (name.len < mem_col_widths.items[i]) {
            try writer.writeByteNTimes(' ', mem_col_widths.items[i] - name.len);
        }
    }

    try writer.writeByte('\n');

    try writer.writeByteNTimes('-', total_width);
    try writer.writeByte('\n');

    // Print each result
    for (results) |result| {
        const min = formatDuration(result.min_ns);
        const avg = formatDuration(result.avg_ns);
        const max = formatDuration(result.max_ns);

        // Format duration strings
        var min_buf: [32]u8 = undefined;
        const min_str = try std.fmt.bufPrint(&min_buf, "{d:.2}{s}", .{ min.value, min.unit });

        var avg_buf: [32]u8 = undefined;
        const avg_str = try std.fmt.bufPrint(&avg_buf, "{d:.2}{s}", .{ avg.value, avg.unit });

        var max_buf: [32]u8 = undefined;
        const max_str = try std.fmt.bufPrint(&max_buf, "{d:.2}{s}", .{ max.value, max.unit });

        // Benchmark name
        try writer.writeAll(result.name);
        try writer.writeByteNTimes(' ', max_name_len - result.name.len);
        try writer.writeAll(" | ");

        // Min (right-aligned)
        if (min_str.len < min_col_width) {
            try writer.writeByteNTimes(' ', min_col_width - min_str.len);
        }
        try writer.writeAll(min_str);
        try writer.writeAll(" | ");

        // Avg (right-aligned)
        if (avg_str.len < avg_col_width) {
            try writer.writeByteNTimes(' ', avg_col_width - avg_str.len);
        }
        try writer.writeAll(avg_str);
        try writer.writeAll(" | ");

        // Max (right-aligned)
        if (max_str.len < max_col_width) {
            try writer.writeByteNTimes(' ', max_col_width - max_str.len);
        }
        try writer.writeAll(max_str);

        // Dynamic memory stats columns
        for (mem_stat_names.items, 0..) |stat_name, i| {
            try writer.writeAll(" | ");

            // Look for this stat in the result's memory stats
            var found_stat: ?usize = null;
            if (result.mem_stats) |stats| {
                for (stats) |stat| {
                    if (std.mem.eql(u8, stat.name, stat_name)) {
                        found_stat = stat.bytes;
                        break;
                    }
                }
            }

            if (found_stat) |bytes| {
                const mem = formatBytes(bytes);
                var mem_buf: [32]u8 = undefined;
                const mem_str = std.fmt.bufPrint(&mem_buf, "{d:.2} {s}", .{ mem.value, mem.unit }) catch unreachable;

                // Right-aligned
                if (mem_str.len < mem_col_widths.items[i]) {
                    try writer.writeByteNTimes(' ', mem_col_widths.items[i] - mem_str.len);
                }
                try writer.writeAll(mem_str);
            } else {
                // Empty column
                try writer.writeByteNTimes(' ', mem_col_widths.items[i]);
            }
        }

        try writer.writeByte('\n');
    }

    try writer.writeByteNTimes('-', total_width);
    try writer.writeByte('\n');
}
