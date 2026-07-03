const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const renderer = @import("../renderer.zig");
const buffer = @import("../buffer.zig");
const image = @import("../image.zig");
const gp = @import("../grapheme.zig");
const link = @import("../link.zig");
const handles = @import("../handles.zig");
const test_renderer_mod = @import("../tests/test-renderer.zig");

pub const benchName = "Renderer Image";

const TERM_WIDTH = 200;
const TERM_HEIGHT = 50;
const VIDEO_FRAMES = 24;
const FRAME_ITERATIONS = 96;

const Protocol = enum { kitty, sixel, blocks };

fn makeFrameImage(allocator: std.mem.Allocator, width: u32, height: u32, seed: u8) !*image.Image {
    const pixels = try allocator.alloc(u8, @as(usize, width) * height * 4);
    defer allocator.free(pixels);
    for (0..height) |y| {
        for (0..width) |x| {
            const offset = (y * width + x) * 4;
            pixels[offset] = @truncate(x + seed);
            pixels[offset + 1] = @truncate(y +% seed *% 3);
            pixels[offset + 2] = @truncate(x + y + seed *% 7);
            pixels[offset + 3] = 255;
        }
    }
    return image.createFromRgba(allocator, pixels, width, height, width * 4);
}

fn drawTextBackdrop(target: *buffer.OptimizedBuffer) void {
    var y: u32 = 0;
    while (y < TERM_HEIGHT) : (y += 1) {
        var x: u32 = 0;
        while (x < TERM_WIDTH) : (x += 1) {
            target.setRaw(x, y, .{
                .char = 'A' + (x + y) % 26,
                .fg = .{ 200, 200, 200, 255 },
                .bg = .{ 20, 20, 40, 255 },
                .attributes = 0,
            });
        }
    }
}

const FrameCost = struct {
    stats: bench_utils.BenchStats = .{},
    total_bytes: u64 = 0,
    frames: u64 = 0,

    fn bytesPerFrame(self: *const FrameCost) u64 {
        if (self.frames == 0) return 0;
        return self.total_bytes / self.frames;
    }
};

fn runPlacementScenario(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    protocol: Protocol,
    image_width: u32,
    image_height: u32,
    animate: bool,
    text_change: bool,
) !FrameCost {
    var test_renderer = try test_renderer_mod.TestRenderer.create(allocator, TERM_WIDTH, TERM_HEIGHT, pool);
    defer test_renderer.deinit();
    switch (protocol) {
        .kitty => test_renderer.renderer.terminal.caps.kitty_graphics = true,
        .sixel => test_renderer.renderer.terminal.caps.sixel = true,
        .blocks => {},
    }

    var images: [VIDEO_FRAMES]*image.Image = undefined;
    var image_handles: [VIDEO_FRAMES]u32 = undefined;
    for (0..VIDEO_FRAMES) |index| {
        images[index] = try makeFrameImage(allocator, image_width, image_height, @truncate(index * 5));
        image_handles[index] = try handles.insert(.image, @ptrCast(images[index]));
    }
    defer for (image_handles) |handle| {
        const token = handles.beginDestroy(handle, .image, image.Image).?;
        token.ptr.deinit();
        handles.finishDestroy(token.handle);
    };

    var cost = FrameCost{};
    var frame: usize = 0;
    while (frame < FRAME_ITERATIONS) : (frame += 1) {
        const index = if (animate) frame % VIDEO_FRAMES else 0;
        const next = test_renderer.renderer.getNextBuffer();
        drawTextBackdrop(next);
        if (text_change) {
            next.setRaw(0, 0, .{
                .char = '0' + @as(u32, @intCast(frame % 10)),
                .fg = .{ 255, 255, 0, 255 },
                .bg = .{ 0, 0, 0, 255 },
                .attributes = 0,
            });
        }
        _ = try next.drawImage(images[index], image_handles[index], 5, 5, 40, 20, 320, 200, 0, 0, image_width, image_height, .auto);

        test_renderer.memory.bytes.clearRetainingCapacity();
        test_renderer.memory.last_write_start = 0;
        test_renderer.memory.last_write_len = 0;
        var timer = try std.time.Timer.start();
        _ = test_renderer.renderer.render(false);
        cost.stats.record(timer.read());
        // Skip the first frame: it pays the initial full paint for every scenario.
        if (frame == 0) {
            cost.stats = .{};
            continue;
        }
        cost.total_bytes += test_renderer.memory.bytes.items.len;
        cost.frames += 1;
    }
    return cost;
}

fn runLargeStillTransmit(allocator: std.mem.Allocator, pool: *gp.GraphemePool) !FrameCost {
    var test_renderer = try test_renderer_mod.TestRenderer.create(allocator, TERM_WIDTH, TERM_HEIGHT, pool);
    defer test_renderer.deinit();
    test_renderer.renderer.terminal.caps.kitty_graphics = true;

    const still = try makeFrameImage(allocator, 1600, 1200, 11);
    const still_handle = try handles.insert(.image, @ptrCast(still));
    defer {
        const token = handles.beginDestroy(still_handle, .image, image.Image).?;
        token.ptr.deinit();
        handles.finishDestroy(token.handle);
    }

    var cost = FrameCost{};
    // Fresh transmission each iteration: alternate the placement geometry so
    // the committed state never matches and the image is retransmitted.
    var frame: usize = 0;
    while (frame < 8) : (frame += 1) {
        const next = test_renderer.renderer.getNextBuffer();
        const x: i32 = @intCast(5 + (frame % 2));
        _ = try next.drawImage(still, still_handle, x, 5, 40, 20, 320, 200, 0, 0, 1600, 1200, .auto);
        test_renderer.memory.bytes.clearRetainingCapacity();
        test_renderer.memory.last_write_start = 0;
        test_renderer.memory.last_write_len = 0;
        var timer = try std.time.Timer.start();
        _ = test_renderer.renderer.render(false);
        cost.stats.record(timer.read());
        cost.total_bytes += test_renderer.memory.bytes.items.len;
        cost.frames += 1;
    }
    return cost;
}

fn runDrawFrameBuffer(allocator: std.mem.Allocator, with_image: bool) !FrameCost {
    var pool = gp.GraphemePool.init(allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(allocator);
    defer link_pool.deinit();
    const source = try buffer.OptimizedBuffer.init(allocator, TERM_WIDTH, TERM_HEIGHT, .{ .pool = &pool, .link_pool = &link_pool });
    defer source.deinit();
    const target = try buffer.OptimizedBuffer.init(allocator, TERM_WIDTH, TERM_HEIGHT, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();
    drawTextBackdrop(source);

    const dot = if (with_image) try makeFrameImage(allocator, 8, 8, 3) else null;
    defer if (dot) |value| value.deinit();
    if (dot) |value| _ = try source.drawImage(value, 51, 2, 2, 4, 2, 8, 8, 0, 0, 8, 8, .auto);

    var cost = FrameCost{};
    var iteration: usize = 0;
    while (iteration < 400) : (iteration += 1) {
        var timer = try std.time.Timer.start();
        target.drawFrameBuffer(0, 0, source, null, null, null, null);
        cost.stats.record(timer.read());
        cost.frames += 1;
        target.clear(.{ 0, 0, 0, 255 }, null);
    }
    return cost;
}

pub fn run(allocator: std.mem.Allocator, show_mem: bool, bench_filter: ?[]const u8) ![]bench_utils.BenchResult {
    _ = show_mem;
    const pool = gp.initGlobalPool(allocator);
    defer gp.deinitGlobalPool();
    defer link.deinitGlobalLinkPool();

    var results: std.ArrayListUnmanaged(bench_utils.BenchResult) = .{};

    const Scenario = struct {
        name: []const u8,
        protocol: Protocol,
        animate: bool,
        text_change: bool,
    };
    const scenarios = [_]Scenario{
        .{ .name = "kitty video frames", .protocol = .kitty, .animate = true, .text_change = false },
        .{ .name = "kitty static image one text change", .protocol = .kitty, .animate = false, .text_change = true },
        .{ .name = "kitty static image no changes", .protocol = .kitty, .animate = false, .text_change = false },
        .{ .name = "sixel video frames", .protocol = .sixel, .animate = true, .text_change = false },
        .{ .name = "sixel static image no changes", .protocol = .sixel, .animate = false, .text_change = false },
        .{ .name = "blocks video frames", .protocol = .blocks, .animate = true, .text_change = false },
    };
    for (scenarios) |scenario| {
        if (!bench_utils.matchesBenchFilter(scenario.name, bench_filter)) continue;
        const cost = try runPlacementScenario(allocator, pool, scenario.protocol, 320, 200, scenario.animate, scenario.text_change);
        try results.append(allocator, .{
            .name = try std.fmt.allocPrint(allocator, "{s} ({d} bytes/frame)", .{ scenario.name, cost.bytesPerFrame() }),
            .min_ns = cost.stats.min_ns,
            .avg_ns = cost.stats.avg(),
            .max_ns = cost.stats.max_ns,
            .total_ns = cost.stats.total_ns,
            .iterations = cost.stats.count,
            .mem_stats = null,
        });
    }

    if (bench_utils.matchesBenchFilter("kitty large still transmit", bench_filter)) {
        const cost = try runLargeStillTransmit(allocator, pool);
        try results.append(allocator, .{
            .name = try std.fmt.allocPrint(allocator, "kitty large still transmit ({d} bytes/frame)", .{cost.bytesPerFrame()}),
            .min_ns = cost.stats.min_ns,
            .avg_ns = cost.stats.avg(),
            .max_ns = cost.stats.max_ns,
            .total_ns = cost.stats.total_ns,
            .iterations = cost.stats.count,
            .mem_stats = null,
        });
    }

    const framebuffer_scenarios = [_]struct { name: []const u8, with_image: bool }{
        .{ .name = "drawFrameBuffer no images", .with_image = false },
        .{ .name = "drawFrameBuffer one image", .with_image = true },
    };
    for (framebuffer_scenarios) |scenario| {
        if (!bench_utils.matchesBenchFilter(scenario.name, bench_filter)) continue;
        const cost = try runDrawFrameBuffer(allocator, scenario.with_image);
        try results.append(allocator, .{
            .name = scenario.name,
            .min_ns = cost.stats.min_ns,
            .avg_ns = cost.stats.avg(),
            .max_ns = cost.stats.max_ns,
            .total_ns = cost.stats.total_ns,
            .iterations = cost.stats.count,
            .mem_stats = null,
        });
    }

    return results.toOwnedSlice(allocator);
}
