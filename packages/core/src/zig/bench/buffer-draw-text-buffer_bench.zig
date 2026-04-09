const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const buffer = @import("../buffer.zig");
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const gp = @import("../grapheme.zig");
const link = @import("../link.zig");

const OptimizedBuffer = buffer.OptimizedBuffer;
const UnifiedTextBuffer = text_buffer.UnifiedTextBuffer;
const UnifiedTextBufferView = text_buffer_view.UnifiedTextBufferView;
const WrapMode = text_buffer.WrapMode;
const BenchResult = bench_utils.BenchResult;
const BenchStats = bench_utils.BenchStats;
const MemStat = bench_utils.MemStat;

pub const benchName = "Buffer drawTextBuffer";

fn generateText(allocator: std.mem.Allocator, lines: u32, avg_line_len: u32) ![]u8 {
    var buf: std.ArrayListUnmanaged(u8) = .{};
    errdefer buf.deinit(allocator);

    const patterns = [_][]const u8{
        "The quick brown fox jumps over the lazy dog. ",
        "Lorem ipsum dolor sit amet consectetur. ",
        "function test() { return 42; } ",
        "Hello 世界 Unicode テスト 🌍 ",
        "Mixed: ASCII 中文 emoji 🚀💻 text. ",
    };

    for (0..lines) |i| {
        var line_len: u32 = 0;
        while (line_len < avg_line_len) {
            const pattern = patterns[i % patterns.len];
            try buf.appendSlice(allocator, pattern);
            line_len += @intCast(pattern.len);
        }
        try buf.append(allocator, '\n');
    }

    return try buf.toOwnedSlice(allocator);
}

fn generateManySmallChunks(allocator: std.mem.Allocator, chunks: u32) ![]u8 {
    var buf: std.ArrayListUnmanaged(u8) = .{};
    errdefer buf.deinit(allocator);

    for (0..chunks) |i| {
        try buf.appendSlice(allocator, "ab ");
        if (i % 20 == 19) try buf.append(allocator, '\n');
    }

    return try buf.toOwnedSlice(allocator);
}

fn setupTextBuffer(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    text: []const u8,
    wrap_width: ?u32,
) !struct { *UnifiedTextBuffer, *UnifiedTextBufferView } {
    const link_pool = link.initGlobalLinkPool(allocator);
    const tb = try UnifiedTextBuffer.init(allocator, pool, link_pool, .unicode);
    errdefer tb.deinit();

    try tb.setText(text);

    const view = try UnifiedTextBufferView.init(allocator, tb);
    errdefer view.deinit();

    if (wrap_width) |w| {
        view.setWrapMode(.char);
        view.setWrapWidth(w);
    } else {
        view.setWrapMode(.none);
    }

    return .{ tb, view };
}

fn benchRenderColdCache(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    iterations: usize,
    show_mem: bool,
    bench_filter: ?[]const u8,
) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(allocator);

    const name = "COLD: 120x40 render (500 lines, wrap=120, includes setup)";
    if (!bench_utils.matchesBenchFilter(name, bench_filter)) return try results.toOwnedSlice(allocator);

    const text = try generateText(allocator, 500, 100);
    defer allocator.free(text);

    var stats = BenchStats{};
    var final_buf_mem: usize = 0;

    for (0..iterations) |i| {
        const tb, const view = try setupTextBuffer(allocator, pool, text, 120);
        defer tb.deinit();
        defer view.deinit();

        const buf = try OptimizedBuffer.init(allocator, 120, 40, .{ .pool = pool });
        defer buf.deinit();

        try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

        var timer = try std.time.Timer.start();
        try buf.drawTextBuffer(view, 0, 0);
        stats.record(timer.read());

        if (i == iterations - 1 and show_mem) {
            final_buf_mem = @sizeOf(OptimizedBuffer) + (buf.width * buf.height * (@sizeOf(u32) + @sizeOf(@TypeOf(buf.buffer.fg[0])) * 2 + @sizeOf(u8)));
        }
    }

    const mem_stats: ?[]const MemStat = if (show_mem) blk: {
        const mem_stat_slice = try allocator.alloc(MemStat, 1);
        mem_stat_slice[0] = .{ .name = "Buf", .bytes = final_buf_mem };
        break :blk mem_stat_slice;
    } else null;

    try results.append(allocator, BenchResult{
        .name = name,
        .min_ns = stats.min_ns,
        .avg_ns = stats.avg(),
        .max_ns = stats.max_ns,
        .total_ns = stats.total_ns,
        .iterations = iterations,
        .mem_stats = mem_stats,
    });

    return try results.toOwnedSlice(allocator);
}

fn benchWrapAndRender(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    iterations: usize,
    show_mem: bool,
    bench_filter: ?[]const u8,
) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(allocator);

    const name = "WRAP+RENDER: 120x40 render (500 lines, wrap=120)";
    if (!bench_utils.matchesBenchFilter(name, bench_filter)) return try results.toOwnedSlice(allocator);

    const text = try generateText(allocator, 500, 100);
    defer allocator.free(text);

    var stats = BenchStats{};
    var final_tb_mem: usize = 0;
    var final_view_mem: usize = 0;
    var final_buf_mem: usize = 0;

    for (0..iterations) |i| {
        const tb, const view = try setupTextBuffer(allocator, pool, text, 120);
        defer tb.deinit();
        defer view.deinit();

        const buf = try OptimizedBuffer.init(allocator, 120, 40, .{ .pool = pool });
        defer buf.deinit();

        try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

        var timer = try std.time.Timer.start();
        try buf.drawTextBuffer(view, 0, 0);
        stats.record(timer.read());

        if (i == iterations - 1 and show_mem) {
            final_tb_mem = tb.getArenaAllocatedBytes();
            final_view_mem = view.getArenaAllocatedBytes();
            final_buf_mem = @sizeOf(OptimizedBuffer) + (buf.width * buf.height * (@sizeOf(u32) + @sizeOf(@TypeOf(buf.buffer.fg[0])) * 2 + @sizeOf(u8)));
        }
    }

    const mem_stats: ?[]const MemStat = if (show_mem) blk: {
        const mem_stat_slice = try allocator.alloc(MemStat, 3);
        mem_stat_slice[0] = .{ .name = "TB", .bytes = final_tb_mem };
        mem_stat_slice[1] = .{ .name = "View", .bytes = final_view_mem };
        mem_stat_slice[2] = .{ .name = "Buf", .bytes = final_buf_mem };
        break :blk mem_stat_slice;
    } else null;

    try results.append(allocator, BenchResult{
        .name = name,
        .min_ns = stats.min_ns,
        .avg_ns = stats.avg(),
        .max_ns = stats.max_ns,
        .total_ns = stats.total_ns,
        .iterations = iterations,
        .mem_stats = mem_stats,
    });

    return try results.toOwnedSlice(allocator);
}

fn benchRenderWarmCache(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    iterations: usize,
    show_mem: bool,
    bench_filter: ?[]const u8,
) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(allocator);

    const warm_name = "WARM: 120x40 render (500 lines, pre-wrapped, pure render)";
    const hot_name = "HOT:  120x40 render (500 lines, reused buffer, pure render)";
    const run_warm = bench_utils.matchesBenchFilter(warm_name, bench_filter);
    const run_hot = bench_utils.matchesBenchFilter(hot_name, bench_filter);
    if (!run_warm and !run_hot) return try results.toOwnedSlice(allocator);

    const text = try generateText(allocator, 500, 100);
    defer allocator.free(text);

    if (run_warm) {
        const tb, const view = try setupTextBuffer(allocator, pool, text, 120);
        defer tb.deinit();
        defer view.deinit();

        var stats = BenchStats{};
        var final_buf_mem: usize = 0;

        for (0..iterations) |i| {
            const buf = try OptimizedBuffer.init(allocator, 120, 40, .{ .pool = pool });
            defer buf.deinit();

            try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

            var timer = try std.time.Timer.start();
            try buf.drawTextBuffer(view, 0, 0);
            stats.record(timer.read());

            if (i == iterations - 1 and show_mem) {
                final_buf_mem = @sizeOf(OptimizedBuffer) + (buf.width * buf.height * (@sizeOf(u32) + @sizeOf(@TypeOf(buf.buffer.fg[0])) * 2 + @sizeOf(u8)));
            }
        }

        const mem_stats: ?[]const MemStat = if (show_mem) blk: {
            const mem_stat_slice = try allocator.alloc(MemStat, 1);
            mem_stat_slice[0] = .{ .name = "Buf", .bytes = final_buf_mem };
            break :blk mem_stat_slice;
        } else null;

        try results.append(allocator, BenchResult{
            .name = warm_name,
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = mem_stats,
        });
    }

    if (run_hot) {
        const tb, const view = try setupTextBuffer(allocator, pool, text, 120);
        defer tb.deinit();
        defer view.deinit();

        const buf = try OptimizedBuffer.init(allocator, 120, 40, .{ .pool = pool });
        defer buf.deinit();

        var stats = BenchStats{};

        for (0..iterations) |_| {
            try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

            var timer = try std.time.Timer.start();
            try buf.drawTextBuffer(view, 0, 0);
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = hot_name,
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return try results.toOwnedSlice(allocator);
}

fn benchRenderSmallResolution(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    iterations: usize,
    show_mem: bool,
    bench_filter: ?[]const u8,
) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(allocator);

    const no_wrap_name = "80x24 render (100 lines, no wrap)";
    const wrap_name = "80x24 render (100 lines, wrap=40)";
    const run_no_wrap = bench_utils.matchesBenchFilter(no_wrap_name, bench_filter);
    const run_wrap = bench_utils.matchesBenchFilter(wrap_name, bench_filter);
    if (!run_no_wrap and !run_wrap) return try results.toOwnedSlice(allocator);

    const text = try generateText(allocator, 100, 80);
    defer allocator.free(text);

    if (run_no_wrap) {
        const tb, const view = try setupTextBuffer(allocator, pool, text, 80);
        defer tb.deinit();
        defer view.deinit();

        const buf = try OptimizedBuffer.init(allocator, 80, 24, .{ .pool = pool });
        defer buf.deinit();

        var stats = BenchStats{};
        var final_buf_mem: usize = 0;

        for (0..iterations) |i| {
            try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

            var timer = try std.time.Timer.start();
            try buf.drawTextBuffer(view, 0, 0);
            stats.record(timer.read());

            if (i == iterations - 1 and show_mem) {
                final_buf_mem = @sizeOf(OptimizedBuffer) + (buf.width * buf.height * (@sizeOf(u32) + @sizeOf(@TypeOf(buf.buffer.fg[0])) * 2 + @sizeOf(u8)));
            }
        }

        const mem_stats: ?[]const MemStat = if (show_mem) blk: {
            const mem_stat_slice = try allocator.alloc(MemStat, 1);
            mem_stat_slice[0] = .{ .name = "Buf", .bytes = final_buf_mem };
            break :blk mem_stat_slice;
        } else null;

        try results.append(allocator, BenchResult{
            .name = no_wrap_name,
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = mem_stats,
        });
    }

    if (run_wrap) {
        const tb, const view = try setupTextBuffer(allocator, pool, text, 40);
        defer tb.deinit();
        defer view.deinit();

        const buf = try OptimizedBuffer.init(allocator, 80, 24, .{ .pool = pool });
        defer buf.deinit();

        var stats = BenchStats{};

        for (0..iterations) |_| {
            try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

            var timer = try std.time.Timer.start();
            try buf.drawTextBuffer(view, 0, 0);
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = wrap_name,
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return try results.toOwnedSlice(allocator);
}

fn benchRenderMediumResolution(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    iterations: usize,
    show_mem: bool,
    bench_filter: ?[]const u8,
) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(allocator);

    const name = "200x60 render (1000 lines, wrap=200)";
    if (!bench_utils.matchesBenchFilter(name, bench_filter)) return try results.toOwnedSlice(allocator);

    const text = try generateText(allocator, 1000, 120);
    defer allocator.free(text);

    const tb, const view = try setupTextBuffer(allocator, pool, text, 200);
    defer tb.deinit();
    defer view.deinit();

    const buf = try OptimizedBuffer.init(allocator, 200, 60, .{ .pool = pool });
    defer buf.deinit();

    var stats = BenchStats{};
    var final_buf_mem: usize = 0;

    for (0..iterations) |i| {
        try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

        var timer = try std.time.Timer.start();
        try buf.drawTextBuffer(view, 0, 0);
        stats.record(timer.read());

        if (i == iterations - 1 and show_mem) {
            final_buf_mem = @sizeOf(OptimizedBuffer) + (buf.width * buf.height * (@sizeOf(u32) + @sizeOf(@TypeOf(buf.buffer.fg[0])) * 2 + @sizeOf(u8)));
        }
    }

    const mem_stats: ?[]const MemStat = if (show_mem) blk: {
        const mem_stat_slice = try allocator.alloc(MemStat, 1);
        mem_stat_slice[0] = .{ .name = "Buf", .bytes = final_buf_mem };
        break :blk mem_stat_slice;
    } else null;

    try results.append(allocator, BenchResult{
        .name = name,
        .min_ns = stats.min_ns,
        .avg_ns = stats.avg(),
        .max_ns = stats.max_ns,
        .total_ns = stats.total_ns,
        .iterations = iterations,
        .mem_stats = mem_stats,
    });

    return try results.toOwnedSlice(allocator);
}

fn benchRenderMassiveResolution(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    iterations: usize,
    show_mem: bool,
    bench_filter: ?[]const u8,
) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(allocator);

    const name = "400x200 render (10k lines, wrap=400)";
    if (!bench_utils.matchesBenchFilter(name, bench_filter)) return try results.toOwnedSlice(allocator);

    const text = try generateText(allocator, 10000, 200);
    defer allocator.free(text);

    const tb, const view = try setupTextBuffer(allocator, pool, text, 400);
    defer tb.deinit();
    defer view.deinit();

    const buf = try OptimizedBuffer.init(allocator, 400, 200, .{ .pool = pool });
    defer buf.deinit();

    var stats = BenchStats{};
    var final_buf_mem: usize = 0;

    for (0..iterations) |i| {
        try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

        var timer = try std.time.Timer.start();
        try buf.drawTextBuffer(view, 0, 0);
        stats.record(timer.read());

        if (i == iterations - 1 and show_mem) {
            final_buf_mem = @sizeOf(OptimizedBuffer) + (buf.width * buf.height * (@sizeOf(u32) + @sizeOf(@TypeOf(buf.buffer.fg[0])) * 2 + @sizeOf(u8)));
        }
    }

    const mem_stats: ?[]const MemStat = if (show_mem) blk: {
        const mem_stat_slice = try allocator.alloc(MemStat, 1);
        mem_stat_slice[0] = .{ .name = "Buf", .bytes = final_buf_mem };
        break :blk mem_stat_slice;
    } else null;

    try results.append(allocator, BenchResult{
        .name = name,
        .min_ns = stats.min_ns,
        .avg_ns = stats.avg(),
        .max_ns = stats.max_ns,
        .total_ns = stats.total_ns,
        .iterations = iterations,
        .mem_stats = mem_stats,
    });

    return try results.toOwnedSlice(allocator);
}

fn benchRenderMassiveLines(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    iterations: usize,
    show_mem: bool,
    bench_filter: ?[]const u8,
) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(allocator);

    const name = "120x40 render (50k lines, viewport first 40)";
    if (!bench_utils.matchesBenchFilter(name, bench_filter)) return try results.toOwnedSlice(allocator);

    const text = try generateText(allocator, 50000, 60);
    defer allocator.free(text);

    const tb, const view = try setupTextBuffer(allocator, pool, text, null);
    defer tb.deinit();
    defer view.deinit();

    const buf = try OptimizedBuffer.init(allocator, 120, 40, .{ .pool = pool });
    defer buf.deinit();

    var stats = BenchStats{};
    var final_buf_mem: usize = 0;

    for (0..iterations) |i| {
        try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

        var timer = try std.time.Timer.start();
        try buf.drawTextBuffer(view, 0, 0);
        stats.record(timer.read());

        if (i == iterations - 1 and show_mem) {
            final_buf_mem = @sizeOf(OptimizedBuffer) + (buf.width * buf.height * (@sizeOf(u32) + @sizeOf(@TypeOf(buf.buffer.fg[0])) * 2 + @sizeOf(u8)));
        }
    }

    const mem_stats: ?[]const MemStat = if (show_mem) blk: {
        const mem_stat_slice = try allocator.alloc(MemStat, 1);
        mem_stat_slice[0] = .{ .name = "Buf", .bytes = final_buf_mem };
        break :blk mem_stat_slice;
    } else null;

    try results.append(allocator, BenchResult{
        .name = name,
        .min_ns = stats.min_ns,
        .avg_ns = stats.avg(),
        .max_ns = stats.max_ns,
        .total_ns = stats.total_ns,
        .iterations = iterations,
        .mem_stats = mem_stats,
    });

    return try results.toOwnedSlice(allocator);
}

fn benchRenderOneMassiveLine(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    iterations: usize,
    show_mem: bool,
    bench_filter: ?[]const u8,
) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(allocator);

    const name = "80x30 render (1 massive line 500KB, wrap=80)";
    if (!bench_utils.matchesBenchFilter(name, bench_filter)) return try results.toOwnedSlice(allocator);

    var buf_builder: std.ArrayListUnmanaged(u8) = .{};
    defer buf_builder.deinit(allocator);

    for (0..100000) |_| {
        try buf_builder.appendSlice(allocator, "word ");
    }
    const text = try buf_builder.toOwnedSlice(allocator);
    defer allocator.free(text);

    const tb, const view = try setupTextBuffer(allocator, pool, text, 80);
    defer tb.deinit();
    defer view.deinit();

    const buf = try OptimizedBuffer.init(allocator, 80, 30, .{ .pool = pool });
    defer buf.deinit();

    var stats = BenchStats{};
    var final_buf_mem: usize = 0;

    for (0..iterations) |i| {
        try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

        var timer = try std.time.Timer.start();
        try buf.drawTextBuffer(view, 0, 0);
        stats.record(timer.read());

        if (i == iterations - 1 and show_mem) {
            final_buf_mem = @sizeOf(OptimizedBuffer) + (buf.width * buf.height * (@sizeOf(u32) + @sizeOf(@TypeOf(buf.buffer.fg[0])) * 2 + @sizeOf(u8)));
        }
    }

    const mem_stats: ?[]const MemStat = if (show_mem) blk: {
        const mem_stat_slice = try allocator.alloc(MemStat, 1);
        mem_stat_slice[0] = .{ .name = "Buf", .bytes = final_buf_mem };
        break :blk mem_stat_slice;
    } else null;

    try results.append(allocator, BenchResult{
        .name = name,
        .min_ns = stats.min_ns,
        .avg_ns = stats.avg(),
        .max_ns = stats.max_ns,
        .total_ns = stats.total_ns,
        .iterations = iterations,
        .mem_stats = mem_stats,
    });

    return try results.toOwnedSlice(allocator);
}

fn benchRenderManySmallChunks(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    iterations: usize,
    show_mem: bool,
    bench_filter: ?[]const u8,
) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(allocator);

    const name = "80x30 render (10k tiny chunks)";
    if (!bench_utils.matchesBenchFilter(name, bench_filter)) return try results.toOwnedSlice(allocator);

    const text = try generateManySmallChunks(allocator, 10000);
    defer allocator.free(text);

    const tb, const view = try setupTextBuffer(allocator, pool, text, 80);
    defer tb.deinit();
    defer view.deinit();

    const buf = try OptimizedBuffer.init(allocator, 80, 30, .{ .pool = pool });
    defer buf.deinit();

    var stats = BenchStats{};
    var final_buf_mem: usize = 0;

    for (0..iterations) |i| {
        try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

        var timer = try std.time.Timer.start();
        try buf.drawTextBuffer(view, 0, 0);
        stats.record(timer.read());

        if (i == iterations - 1 and show_mem) {
            final_buf_mem = @sizeOf(OptimizedBuffer) + (buf.width * buf.height * (@sizeOf(u32) + @sizeOf(@TypeOf(buf.buffer.fg[0])) * 2 + @sizeOf(u8)));
        }
    }

    const mem_stats: ?[]const MemStat = if (show_mem) blk: {
        const mem_stat_slice = try allocator.alloc(MemStat, 1);
        mem_stat_slice[0] = .{ .name = "Buf", .bytes = final_buf_mem };
        break :blk mem_stat_slice;
    } else null;

    try results.append(allocator, BenchResult{
        .name = name,
        .min_ns = stats.min_ns,
        .avg_ns = stats.avg(),
        .max_ns = stats.max_ns,
        .total_ns = stats.total_ns,
        .iterations = iterations,
        .mem_stats = mem_stats,
    });

    return try results.toOwnedSlice(allocator);
}

fn benchRenderWithViewport(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    iterations: usize,
    show_mem: bool,
    bench_filter: ?[]const u8,
) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(allocator);
    _ = show_mem;

    const viewport_name = "100x30 render (10k lines, viewport at line 5000)";
    const no_viewport_name = "100x30 render (10k lines, no viewport)";
    const run_viewport = bench_utils.matchesBenchFilter(viewport_name, bench_filter);
    const run_no_viewport = bench_utils.matchesBenchFilter(no_viewport_name, bench_filter);
    if (!run_viewport and !run_no_viewport) return try results.toOwnedSlice(allocator);

    const text = try generateText(allocator, 10000, 100);
    defer allocator.free(text);

    if (run_viewport) {
        const tb, const view = try setupTextBuffer(allocator, pool, text, null);
        defer tb.deinit();
        defer view.deinit();

        view.setViewport(.{ .x = 0, .y = 5000, .width = 100, .height = 30 });

        const buf = try OptimizedBuffer.init(allocator, 100, 30, .{ .pool = pool });
        defer buf.deinit();

        var stats = BenchStats{};

        for (0..iterations) |_| {
            try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

            var timer = try std.time.Timer.start();
            try buf.drawTextBuffer(view, 0, 0);
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = viewport_name,
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    if (run_no_viewport) {
        const tb, const view = try setupTextBuffer(allocator, pool, text, null);
        defer tb.deinit();
        defer view.deinit();

        const buf = try OptimizedBuffer.init(allocator, 100, 30, .{ .pool = pool });
        defer buf.deinit();

        var stats = BenchStats{};

        for (0..iterations) |_| {
            try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

            var timer = try std.time.Timer.start();
            try buf.drawTextBuffer(view, 0, 0);
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = no_viewport_name,
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return try results.toOwnedSlice(allocator);
}

fn benchRenderWithSelection(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    iterations: usize,
    show_mem: bool,
    bench_filter: ?[]const u8,
) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(allocator);
    _ = show_mem;

    const selection_name = "120x40 render (500 lines, with selection)";
    const no_selection_name = "120x40 render (500 lines, no selection)";
    const run_selection = bench_utils.matchesBenchFilter(selection_name, bench_filter);
    const run_no_selection = bench_utils.matchesBenchFilter(no_selection_name, bench_filter);
    if (!run_selection and !run_no_selection) return try results.toOwnedSlice(allocator);

    const text = try generateText(allocator, 500, 100);
    defer allocator.free(text);

    if (run_selection) {
        const tb, const view = try setupTextBuffer(allocator, pool, text, 120);
        defer tb.deinit();
        defer view.deinit();

        view.setSelection(500, 1500, .{ 0.2, 0.4, 0.8, 1.0 }, .{ 1.0, 1.0, 1.0, 1.0 });

        const buf = try OptimizedBuffer.init(allocator, 120, 40, .{ .pool = pool });
        defer buf.deinit();

        var stats = BenchStats{};

        for (0..iterations) |_| {
            try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

            var timer = try std.time.Timer.start();
            try buf.drawTextBuffer(view, 0, 0);
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = selection_name,
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    if (run_no_selection) {
        const tb, const view = try setupTextBuffer(allocator, pool, text, 120);
        defer tb.deinit();
        defer view.deinit();

        const buf = try OptimizedBuffer.init(allocator, 120, 40, .{ .pool = pool });
        defer buf.deinit();

        var stats = BenchStats{};

        for (0..iterations) |_| {
            try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

            var timer = try std.time.Timer.start();
            try buf.drawTextBuffer(view, 0, 0);
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = no_selection_name,
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return try results.toOwnedSlice(allocator);
}

pub fn run(
    allocator: std.mem.Allocator,
    show_mem: bool,
    bench_filter: ?[]const u8,
) ![]BenchResult {
    // Global pool and unicode data are initialized once in bench.zig
    const pool = gp.initGlobalPool(allocator);

    var all_results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer all_results.deinit(allocator);

    const iterations: usize = 10;

    const cold_cache_results = try benchRenderColdCache(allocator, pool, iterations, show_mem, bench_filter);
    try all_results.appendSlice(allocator, cold_cache_results);

    const warm_cache_results = try benchRenderWarmCache(allocator, pool, iterations, show_mem, bench_filter);
    try all_results.appendSlice(allocator, warm_cache_results);

    const wrap_render_results = try benchWrapAndRender(allocator, pool, iterations, show_mem, bench_filter);
    try all_results.appendSlice(allocator, wrap_render_results);

    const small_res_results = try benchRenderSmallResolution(allocator, pool, iterations, show_mem, bench_filter);
    try all_results.appendSlice(allocator, small_res_results);

    const medium_res_results = try benchRenderMediumResolution(allocator, pool, iterations, show_mem, bench_filter);
    try all_results.appendSlice(allocator, medium_res_results);

    const massive_res_results = try benchRenderMassiveResolution(allocator, pool, iterations, show_mem, bench_filter);
    try all_results.appendSlice(allocator, massive_res_results);

    const massive_lines_results = try benchRenderMassiveLines(allocator, pool, iterations, show_mem, bench_filter);
    try all_results.appendSlice(allocator, massive_lines_results);

    const one_massive_line_results = try benchRenderOneMassiveLine(allocator, pool, iterations, show_mem, bench_filter);
    try all_results.appendSlice(allocator, one_massive_line_results);

    const many_chunks_results = try benchRenderManySmallChunks(allocator, pool, iterations, show_mem, bench_filter);
    try all_results.appendSlice(allocator, many_chunks_results);

    const viewport_results = try benchRenderWithViewport(allocator, pool, iterations, show_mem, bench_filter);
    try all_results.appendSlice(allocator, viewport_results);

    const selection_results = try benchRenderWithSelection(allocator, pool, iterations, show_mem, bench_filter);
    try all_results.appendSlice(allocator, selection_results);

    return try all_results.toOwnedSlice(allocator);
}
