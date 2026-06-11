const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const image = @import("../image.zig");
const terminal_image = @import("../terminal-image.zig");

pub const benchName = "Terminal Image";

const Scenario = struct {
    name: []const u8,
    width: u32,
    height: u32,
    colors: usize = 255,
    pattern: enum { flat, gradient, baseline, photo, noise, transparent },
};

const scenarios = [_]Scenario{
    .{ .name = "Sixel 160x240 flat", .width = 160, .height = 240, .pattern = .flat },
    .{ .name = "Sixel 160x240 gradient", .width = 160, .height = 240, .pattern = .gradient },
    .{ .name = "Sixel 160x240 original baseline", .width = 160, .height = 240, .pattern = .baseline },
    .{ .name = "Sixel 160x240 original baseline 128 colors", .width = 160, .height = 240, .colors = 128, .pattern = .baseline },
    .{ .name = "Sixel 160x240 original baseline 64 colors", .width = 160, .height = 240, .colors = 64, .pattern = .baseline },
    .{ .name = "Sixel 160x240 photo-like", .width = 160, .height = 240, .pattern = .photo },
    .{ .name = "Sixel 160x240 noise", .width = 160, .height = 240, .pattern = .noise },
    .{ .name = "Sixel 160x240 transparent", .width = 160, .height = 240, .pattern = .transparent },
    .{ .name = "Sixel 320x480 photo-like", .width = 320, .height = 480, .pattern = .photo },
};

fn writeScenario(allocator: std.mem.Allocator, writer: anytype, value: *const image.Image, colors: usize) !void {
    if (colors == 255) return terminal_image.writeSixelPayload(allocator, writer, value);
    var quantized = try terminal_image.quantizeSixel(allocator, value, colors);
    defer quantized.deinit();
    try terminal_image.writeSixelIndexedPayload(allocator, writer, quantized.indices, quantized.palette[0..quantized.palette_len], value.width(), value.height());
}

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

fn appendDragonGeometryBenchmarks(
    allocator: std.mem.Allocator,
    results: *std.ArrayListUnmanaged(bench_utils.BenchResult),
    show_mem: bool,
    bench_filter: ?[]const u8,
) !void {
    const names = [_][]const u8{
        "Sixel dragon fit 200x300",
        "Sixel dragon cover 300x300",
        "Sixel dragon cover 300x300 128 colors",
        "Sixel dragon cover 300x300 64 colors",
    };
    var run_any = false;
    for (names) |name| run_any = run_any or bench_utils.matchesBenchFilter(name, bench_filter);
    if (!run_any) return;
    var gpa: std.heap.GeneralPurposeAllocator(.{}) = .{};
    defer _ = gpa.deinit();
    const work_allocator = gpa.allocator();
    const encoded = try std.fs.cwd().readFileAlloc(work_allocator, "../../../examples/src/assets/image-demo.gif", 2 * 1024 * 1024);
    defer work_allocator.free(encoded);
    const decoded = try image.decode(work_allocator, encoded, .{});
    defer decoded.deinit();
    const geometries = [_]struct { x: u32, y: u32, width: u32, height: u32, output_width: u32, output_height: u32, colors: usize }{
        .{ .x = 0, .y = 0, .width = 256, .height = 384, .output_width = 200, .output_height = 300, .colors = 255 },
        .{ .x = 0, .y = 64, .width = 256, .height = 256, .output_width = 300, .output_height = 300, .colors = 255 },
        .{ .x = 0, .y = 64, .width = 256, .height = 256, .output_width = 300, .output_height = 300, .colors = 128 },
        .{ .x = 0, .y = 64, .width = 256, .height = 256, .output_width = 300, .output_height = 300, .colors = 64 },
    };
    for (names, geometries) |name, geometry| {
        if (!bench_utils.matchesBenchFilter(name, bench_filter)) continue;
        var output: std.ArrayList(u8) = .empty;
        defer output.deinit(work_allocator);
        var stats: bench_utils.BenchStats = .{};
        for (0..10) |_| {
            output.clearRetainingCapacity();
            var timer = try std.time.Timer.start();
            const cropped = try image.extract(work_allocator, decoded, geometry.x, geometry.y, geometry.width, geometry.height);
            defer cropped.deinit();
            const resized = try image.resize(work_allocator, cropped, geometry.output_width, geometry.output_height, .area);
            defer resized.deinit();
            try writeScenario(work_allocator, output.writer(work_allocator), resized, geometry.colors);
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
    }
}

pub fn run(allocator: std.mem.Allocator, show_mem: bool, bench_filter: ?[]const u8) ![]bench_utils.BenchResult {
    var results: std.ArrayListUnmanaged(bench_utils.BenchResult) = .{};
    for (scenarios) |scenario| {
        const count_name = try std.fmt.allocPrint(allocator, "{s} count-only", .{scenario.name});
        const quantize_name = "Sixel 160x240 original baseline quantize-only";
        const run_materialized = bench_utils.matchesBenchFilter(scenario.name, bench_filter);
        const run_counted = bench_utils.matchesBenchFilter(count_name, bench_filter);
        const run_quantized = scenario.pattern == .baseline and scenario.colors == 255 and bench_utils.matchesBenchFilter(quantize_name, bench_filter);
        if (!run_materialized and !run_counted and !run_quantized) continue;
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

        try writeScenario(work_allocator, output.writer(work_allocator), value, scenario.colors);
        const iterations: usize = if (scenario.width > 160) 20 else 50;
        if (run_materialized) {
            var stats: bench_utils.BenchStats = .{};
            for (0..iterations) |_| {
                output.clearRetainingCapacity();
                var timer = try std.time.Timer.start();
                try writeScenario(work_allocator, output.writer(work_allocator), value, scenario.colors);
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
                try writeScenario(work_allocator, &counting, value, scenario.colors);
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
        if (run_quantized) {
            var quantize_stats: bench_utils.BenchStats = .{};
            var checksum: usize = 0;
            for (0..iterations) |_| {
                var timer = try std.time.Timer.start();
                var quantized = try terminal_image.quantizeSixel(work_allocator, value, scenario.colors);
                quantize_stats.record(timer.read());
                checksum +%= quantized.palette_len + quantized.indices[0];
                quantized.deinit();
            }
            if (checksum == 0) return error.InvalidQuantizeBenchmark;
            try results.append(allocator, .{
                .name = quantize_name,
                .min_ns = quantize_stats.min_ns,
                .avg_ns = quantize_stats.avg(),
                .max_ns = quantize_stats.max_ns,
                .total_ns = quantize_stats.total_ns,
                .iterations = quantize_stats.count,
                .mem_stats = null,
            });
        }
    }
    try appendDragonGeometryBenchmarks(allocator, &results, show_mem, bench_filter);
    return results.toOwnedSlice(allocator);
}
