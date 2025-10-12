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

    // Check if any results have memory stats
    var has_mem_stats = false;
    for (results) |result| {
        if (result.mem_stats != null) {
            has_mem_stats = true;
            break;
        }
    }

    // Calculate column widths
    var max_name_len: usize = 20; // minimum
    var min_col_width: usize = 3; // minimum for "Min"
    var avg_col_width: usize = 3; // minimum for "Avg"
    var max_col_width: usize = 3; // minimum for "Max"
    var tb_col_width: usize = 2; // minimum for "TB"
    var view_col_width: usize = 4; // minimum for "View"

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

        if (result.mem_stats) |mem| {
            const tb_mem = formatBytes(mem.text_buffer_bytes);
            const view_mem = formatBytes(mem.view_bytes);

            var tb_buf: [32]u8 = undefined;
            const tb_str = std.fmt.bufPrint(&tb_buf, "{d:.2} {s}", .{ tb_mem.value, tb_mem.unit }) catch unreachable;
            if (tb_str.len > tb_col_width) tb_col_width = tb_str.len;

            var view_buf: [32]u8 = undefined;
            const view_str = std.fmt.bufPrint(&view_buf, "{d:.2} {s}", .{ view_mem.value, view_mem.unit }) catch unreachable;
            if (view_str.len > view_col_width) view_col_width = view_str.len;
        }
    }

    // Print header
    var total_width = max_name_len + 3 + min_col_width + 3 + avg_col_width + 3 + max_col_width;
    if (has_mem_stats) {
        total_width += 3 + tb_col_width + 3 + view_col_width;
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

    if (has_mem_stats) {
        try writer.writeAll(" | ");
        try writer.writeAll("TB");
        try writer.writeByteNTimes(' ', tb_col_width - 2);
        try writer.writeAll(" | ");
        try writer.writeAll("View");
        try writer.writeByteNTimes(' ', view_col_width - 4);
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

        // Memory stats columns if available
        if (has_mem_stats) {
            try writer.writeAll(" | ");

            if (result.mem_stats) |mem| {
                const tb_mem = formatBytes(mem.text_buffer_bytes);
                const view_mem = formatBytes(mem.view_bytes);

                var tb_buf: [32]u8 = undefined;
                const tb_str = std.fmt.bufPrint(&tb_buf, "{d:.2} {s}", .{ tb_mem.value, tb_mem.unit }) catch unreachable;

                var view_buf: [32]u8 = undefined;
                const view_str = std.fmt.bufPrint(&view_buf, "{d:.2} {s}", .{ view_mem.value, view_mem.unit }) catch unreachable;

                // TB column (right-aligned)
                if (tb_str.len < tb_col_width) {
                    try writer.writeByteNTimes(' ', tb_col_width - tb_str.len);
                }
                try writer.writeAll(tb_str);
                try writer.writeAll(" | ");

                // View column (right-aligned)
                if (view_str.len < view_col_width) {
                    try writer.writeByteNTimes(' ', view_col_width - view_str.len);
                }
                try writer.writeAll(view_str);
            } else {
                // Empty memory columns
                try writer.writeByteNTimes(' ', tb_col_width);
                try writer.writeAll(" | ");
                try writer.writeByteNTimes(' ', view_col_width);
            }
        }

        try writer.writeByte('\n');
    }

    try writer.writeByteNTimes('-', total_width);
    try writer.writeByte('\n');
}
