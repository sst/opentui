const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const image = @import("../image.zig");
const terminal_image = @import("../terminal-image.zig");

pub const benchName = "Terminal Image";

pub fn run(allocator: std.mem.Allocator, show_mem: bool, bench_filter: ?[]const u8) ![]bench_utils.BenchResult {
    const name = "Sixel 160x240 quantize, dither, and serialize";
    var results: std.ArrayListUnmanaged(bench_utils.BenchResult) = .{};
    if (!bench_utils.matchesBenchFilter(name, bench_filter)) return results.toOwnedSlice(allocator);

    const width = 160;
    const height = 240;
    var gpa: std.heap.GeneralPurposeAllocator(.{}) = .{};
    defer _ = gpa.deinit();
    const work_allocator = gpa.allocator();
    const pixels = try work_allocator.alloc(u8, width * height * 4);
    defer work_allocator.free(pixels);
    for (0..width * height) |index| {
        const x = index % width;
        const y = index / width;
        const offset = index * 4;
        pixels[offset] = @truncate(x * 13 + y * 3);
        pixels[offset + 1] = @truncate(x * 5 + y * 11);
        pixels[offset + 2] = @truncate(x * 7 + y * 17);
        pixels[offset + 3] = 255;
    }
    const value = try image.createFromRgba(work_allocator, pixels, width, height, width * 4);
    defer value.deinit();
    var output: std.ArrayList(u8) = .empty;
    defer output.deinit(work_allocator);

    try terminal_image.writeSixelPayload(work_allocator, output.writer(work_allocator), value);
    var stats: bench_utils.BenchStats = .{};
    for (0..10) |_| {
        output.clearRetainingCapacity();
        var timer = try std.time.Timer.start();
        try terminal_image.writeSixelPayload(work_allocator, output.writer(work_allocator), value);
        stats.record(timer.read());
    }

    const mem_stats: ?[]const bench_utils.MemStat = if (show_mem) blk: {
        const values = try allocator.alloc(bench_utils.MemStat, 1);
        values[0] = .{ .name = "Payload", .bytes = output.items.len };
        break :blk values;
    } else null;
    try results.append(allocator, .{
        .name = name,
        .min_ns = stats.min_ns,
        .avg_ns = stats.avg(),
        .max_ns = stats.max_ns,
        .total_ns = stats.total_ns,
        .iterations = stats.count,
        .mem_stats = mem_stats,
    });
    return results.toOwnedSlice(allocator);
}
