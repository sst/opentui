const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const image = @import("../image.zig");
const terminal_image = @import("../terminal-image.zig");

pub const benchName = "Terminal Image";

const Scenario = struct {
    name: []const u8,
    width: u32,
    height: u32,
    pattern: enum { flat, gradient, baseline, photo, noise, transparent },
};

const scenarios = [_]Scenario{
    .{ .name = "Sixel 160x240 flat", .width = 160, .height = 240, .pattern = .flat },
    .{ .name = "Sixel 160x240 gradient", .width = 160, .height = 240, .pattern = .gradient },
    .{ .name = "Sixel 160x240 original baseline", .width = 160, .height = 240, .pattern = .baseline },
    .{ .name = "Sixel 160x240 photo-like", .width = 160, .height = 240, .pattern = .photo },
    .{ .name = "Sixel 160x240 noise", .width = 160, .height = 240, .pattern = .noise },
    .{ .name = "Sixel 160x240 transparent", .width = 160, .height = 240, .pattern = .transparent },
    .{ .name = "Sixel 320x480 photo-like", .width = 320, .height = 480, .pattern = .photo },
};

const CountingWriter = struct {
    bytes: usize = 0,

    pub fn writeAll(self: *CountingWriter, value: []const u8) !void {
        self.bytes += value.len;
    }

    pub fn writeByte(self: *CountingWriter, value: u8) !void {
        _ = value;
        self.bytes += 1;
    }
};

fn fillPixels(pixels: []u8, scenario: Scenario) void {
    var random = std.Random.DefaultPrng.init(0x1234_5678_9abc_def0);
    for (0..@as(usize, scenario.width) * scenario.height) |index| {
        const x = index % scenario.width;
        const y = index / scenario.width;
        const offset = index * 4;
        const rgba: [4]u8 = switch (scenario.pattern) {
            .flat => .{ 48, 112, 192, 255 },
            .gradient => .{
                @intCast(x * 255 / (scenario.width - 1)),
                @intCast(y * 255 / (scenario.height - 1)),
                @intCast((x + y) * 255 / (scenario.width + scenario.height - 2)),
                255,
            },
            .baseline => .{
                @truncate(x * 13 + y * 3),
                @truncate(x * 5 + y * 11),
                @truncate(x * 7 + y * 17),
                255,
            },
            .photo => .{
                @truncate(x * 13 + y * 3 + (x * y) / 17),
                @truncate(x * 5 + y * 11 + (x * y) / 29),
                @truncate(x * 7 + y * 17 + (x * y) / 41),
                255,
            },
            .noise => .{ random.random().int(u8), random.random().int(u8), random.random().int(u8), 255 },
            .transparent => .{
                @truncate(x * 13 + y * 3),
                @truncate(x * 5 + y * 11),
                @truncate(x * 7 + y * 17),
                if ((x + y) % 4 == 0) 255 else 0,
            },
        };
        @memcpy(pixels[offset..][0..4], &rgba);
    }
}

pub fn run(allocator: std.mem.Allocator, show_mem: bool, bench_filter: ?[]const u8) ![]bench_utils.BenchResult {
    var results: std.ArrayListUnmanaged(bench_utils.BenchResult) = .{};
    for (scenarios) |scenario| {
        const count_name = try std.fmt.allocPrint(allocator, "{s} count-only", .{scenario.name});
        const run_materialized = bench_utils.matchesBenchFilter(scenario.name, bench_filter);
        const run_counted = bench_utils.matchesBenchFilter(count_name, bench_filter);
        if (!run_materialized and !run_counted) continue;
        var gpa: std.heap.GeneralPurposeAllocator(.{}) = .{};
        defer _ = gpa.deinit();
        const work_allocator = gpa.allocator();
        const pixels = try work_allocator.alloc(u8, @as(usize, scenario.width) * scenario.height * 4);
        defer work_allocator.free(pixels);
        fillPixels(pixels, scenario);
        const value = try image.createFromRgba(work_allocator, pixels, scenario.width, scenario.height, scenario.width * 4);
        defer value.deinit();
        var output: std.ArrayList(u8) = .empty;
        defer output.deinit(work_allocator);

        try terminal_image.writeSixelPayload(work_allocator, output.writer(work_allocator), value);
        const iterations: usize = if (scenario.width > 160) 20 else 50;
        if (run_materialized) {
            var stats: bench_utils.BenchStats = .{};
            for (0..iterations) |_| {
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
                .name = scenario.name,
                .min_ns = stats.min_ns,
                .avg_ns = stats.avg(),
                .max_ns = stats.max_ns,
                .total_ns = stats.total_ns,
                .iterations = stats.count,
                .mem_stats = mem_stats,
            });
        }

        if (run_counted) {
            var count_stats: bench_utils.BenchStats = .{};
            for (0..iterations) |_| {
                var counting: CountingWriter = .{};
                var timer = try std.time.Timer.start();
                try terminal_image.writeSixelPayload(work_allocator, &counting, value);
                count_stats.record(timer.read());
                if (counting.bytes != output.items.len) return error.IncorrectSixelByteCount;
            }
            try results.append(allocator, .{
                .name = count_name,
                .min_ns = count_stats.min_ns,
                .avg_ns = count_stats.avg(),
                .max_ns = count_stats.max_ns,
                .total_ns = count_stats.total_ns,
                .iterations = count_stats.count,
                .mem_stats = null,
            });
        }
    }
    return results.toOwnedSlice(allocator);
}
