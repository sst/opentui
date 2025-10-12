//! Shared Test File Generator for UTF-8 Scanning Benchmarks
//!
//! This module provides utilities to generate test files with various sizes
//! for benchmarking line break detection and word wrap break point detection.
//! The generated text contains both line breaks and wrap points.

const std = @import("std");

// Sample text with line breaks AND wrap break points
// This text works for both line break and wrap point detection
pub const sample_text =
    "The quick brown fox jumps over the lazy dog.\n" ++
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n" ++
    "File paths: /usr/local/bin and C:\\Windows\\System32\n" ++
    "Windows uses CRLF line endings.\r\n" ++
    "Unix uses LF line endings.\n" ++
    "Classic Mac used CR line endings.\r" ++
    "Punctuation test: Hello, world! How are you? I'm fine.\n" ++
    "Brackets test: (parentheses) [square] {curly}\n" ++
    "Dashes test: pre-dash post-dash multi-word-expression\n" ++
    "UTF-8 text with breaks: 世界 こんにちは test\n" ++
    "This is a longer line with-various/break.points,including;punctuation:and!more?\n" ++
    "Tabs\there\tand\tthere.\n" ++
    "Short line\n" ++
    "\n" ++
    "Empty line above. Here's some more text to make the sample more realistic.\n";

pub fn formatBytes(bytes: usize, writer: anytype) !void {
    if (bytes < 1024) {
        try writer.print("{d} B", .{bytes});
    } else if (bytes < 1024 * 1024) {
        try writer.print("{d:.2} KB", .{@as(f64, @floatFromInt(bytes)) / 1024.0});
    } else if (bytes < 1024 * 1024 * 1024) {
        try writer.print("{d:.2} MB", .{@as(f64, @floatFromInt(bytes)) / (1024.0 * 1024.0)});
    } else {
        try writer.print("{d:.2} GB", .{@as(f64, @floatFromInt(bytes)) / (1024.0 * 1024.0 * 1024.0)});
    }
}

pub fn parseSizeString(size_str: []const u8) !usize {
    if (size_str.len == 0) return error.InvalidSize;

    // Find where the number ends and suffix begins
    var num_end: usize = 0;
    while (num_end < size_str.len) : (num_end += 1) {
        const c = size_str[num_end];
        if (!std.ascii.isDigit(c) and c != '.') break;
    }

    if (num_end == 0) return error.InvalidSize;

    const num_str = size_str[0..num_end];
    const suffix = if (num_end < size_str.len) size_str[num_end..] else "";

    // Parse the number (support both integer and float)
    const base_value = if (std.mem.indexOfScalar(u8, num_str, '.')) |_|
        try std.fmt.parseFloat(f64, num_str)
    else
        @as(f64, @floatFromInt(try std.fmt.parseInt(usize, num_str, 10)));

    // Apply multiplier based on suffix
    const multiplier: f64 = if (suffix.len == 0)
        1.0
    else if (std.ascii.eqlIgnoreCase(suffix, "K") or std.ascii.eqlIgnoreCase(suffix, "KB"))
        1024.0
    else if (std.ascii.eqlIgnoreCase(suffix, "M") or std.ascii.eqlIgnoreCase(suffix, "MB"))
        1024.0 * 1024.0
    else if (std.ascii.eqlIgnoreCase(suffix, "G") or std.ascii.eqlIgnoreCase(suffix, "GB"))
        1024.0 * 1024.0 * 1024.0
    else
        return error.InvalidSizeSuffix;

    return @intFromFloat(base_value * multiplier);
}

pub fn generateTestFiles(test_dir: []const u8, max_size_arg: ?usize) !void {
    const stdout = std.io.getStdOut().writer();

    // Create test directory
    std.fs.cwd().makeDir(test_dir) catch |err| {
        if (err != error.PathAlreadyExists) return err;
    };

    // Generate 16 files with exponentially increasing sizes
    const file_count = 16;
    const min_size: usize = 1024; // 1 KB
    const max_size: usize = max_size_arg orelse (1024 * 1024 * 1024); // Default 1 GB

    try stdout.print("Generating test files in '{s}/' (1 KB to ", .{test_dir});
    try formatBytes(max_size, stdout);
    try stdout.writeAll(")...\n\n");

    // Calculate growth factor: max_size = min_size * factor^(file_count-1)
    const growth_factor = std.math.pow(f64, @as(f64, @floatFromInt(max_size)) / @as(f64, @floatFromInt(min_size)), 1.0 / @as(f64, @floatFromInt(file_count - 1)));

    var i: usize = 0;
    while (i < file_count) : (i += 1) {
        const target_size = @as(usize, @intFromFloat(@as(f64, @floatFromInt(min_size)) * std.math.pow(f64, growth_factor, @as(f64, @floatFromInt(i)))));

        var filename_buf: [256]u8 = undefined;
        const filename = try std.fmt.bufPrint(&filename_buf, "{s}/test_{d:0>2}.txt", .{ test_dir, i });

        try stdout.print("Creating {s} (target: ", .{filename});
        try formatBytes(target_size, stdout);
        try stdout.writeAll(")...\n");

        const file = try std.fs.cwd().createFile(filename, .{});
        defer file.close();

        var buffered = std.io.bufferedWriter(file.writer());
        const writer = buffered.writer();

        var written: usize = 0;
        while (written < target_size) {
            const to_write = @min(sample_text.len, target_size - written);
            try writer.writeAll(sample_text[0..to_write]);
            written += to_write;
        }

        try buffered.flush();

        const actual_size = (try file.stat()).size;
        try stdout.writeAll("  Actual: ");
        try formatBytes(actual_size, stdout);
        try stdout.writeAll("\n");
    }

    try stdout.writeAll("\n✓ Test files generated successfully!\n");
}
