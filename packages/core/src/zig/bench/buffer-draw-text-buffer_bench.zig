const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const buffer = @import("../buffer.zig");
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const gp = @import("../grapheme.zig");

const OptimizedBuffer = buffer.OptimizedBuffer;
const UnifiedTextBuffer = text_buffer.UnifiedTextBuffer;
const UnifiedTextBufferView = text_buffer_view.UnifiedTextBufferView;
const WrapMode = text_buffer.WrapMode;
const BenchResult = bench_utils.BenchResult;
const MemStat = bench_utils.MemStat;

pub const benchName = "Buffer drawTextBuffer";

fn generateText(allocator: std.mem.Allocator, lines: u32, avg_line_len: u32) ![]u8 {
    var buf = std.ArrayList(u8).init(allocator);
    errdefer buf.deinit();

    const patterns = [_][]const u8{
        "The quick brown fox jumps over the lazy dog. ",
        "Lorem ipsum dolor sit amet consectetur. ",
        "function test() { return 42; } ",
        "Hello 世界 Unicode テスト 🌍 ",
        "Mixed: ASCII 中文 emoji 🚀💻 text. ",
    };

    var i: u32 = 0;
    while (i < lines) : (i += 1) {
        var line_len: u32 = 0;
        while (line_len < avg_line_len) {
            const pattern = patterns[i % patterns.len];
            try buf.appendSlice(pattern);
            line_len += @intCast(pattern.len);
        }
        try buf.append('\n');
    }

    return try buf.toOwnedSlice();
}

fn generateManySmallChunks(allocator: std.mem.Allocator, chunks: u32) ![]u8 {
    var buf = std.ArrayList(u8).init(allocator);
    errdefer buf.deinit();

    var i: u32 = 0;
    while (i < chunks) : (i += 1) {
        try buf.appendSlice("ab ");
        if (i % 20 == 19) try buf.append('\n');
    }

    return try buf.toOwnedSlice();
}

fn setupTextBuffer(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    
    
    text: []const u8,
    wrap_width: ?u32,
) !struct { *UnifiedTextBuffer, *UnifiedTextBufferView } {
    const tb = try UnifiedTextBuffer.init(allocator, pool, .unicode);
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
) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    const text = try generateText(allocator, 500, 100);
    defer allocator.free(text);

    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;
        var final_buf_mem: usize = 0;

        var i: usize = 0;
        while (i < iterations) : (i += 1) {
            const tb, const view = try setupTextBuffer(allocator, pool, text, 120);
            defer tb.deinit();
            defer view.deinit();

            const buf = try OptimizedBuffer.init(allocator, 120, 40, .{ .pool = pool });
            defer buf.deinit();

            try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

            var timer = try std.time.Timer.start();
            try buf.drawTextBuffer(view, 0, 0);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;

            if (i == iterations - 1 and show_mem) {
                final_buf_mem = @sizeOf(OptimizedBuffer) + (buf.width * buf.height * (@sizeOf(u32) + @sizeOf(@TypeOf(buf.buffer.fg[0])) * 2 + @sizeOf(u8)));
            }
        }

        const name = try std.fmt.allocPrint(allocator, "COLD: 120x40 render (500 lines, wrap=120, includes setup)", .{});
        const mem_stats: ?[]const MemStat = if (show_mem) blk: {
            const stats = try allocator.alloc(MemStat, 1);
            stats[0] = .{ .name = "Buf", .bytes = final_buf_mem };
            break :blk stats;
        } else null;

        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = mem_stats,
        });
    }

    return try results.toOwnedSlice();
}

fn benchRenderWarmCache(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    
    
    iterations: usize,
    show_mem: bool,
) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    const text = try generateText(allocator, 500, 100);
    defer allocator.free(text);

    {
        const tb, const view = try setupTextBuffer(allocator, pool, text, 120);
        defer tb.deinit();
        defer view.deinit();

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;
        var final_buf_mem: usize = 0;

        var i: usize = 0;
        while (i < iterations) : (i += 1) {
            const buf = try OptimizedBuffer.init(allocator, 120, 40, .{ .pool = pool });
            defer buf.deinit();

            try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

            var timer = try std.time.Timer.start();
            try buf.drawTextBuffer(view, 0, 0);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;

            if (i == iterations - 1 and show_mem) {
                final_buf_mem = @sizeOf(OptimizedBuffer) + (buf.width * buf.height * (@sizeOf(u32) + @sizeOf(@TypeOf(buf.buffer.fg[0])) * 2 + @sizeOf(u8)));
            }
        }

        const name = try std.fmt.allocPrint(allocator, "WARM: 120x40 render (500 lines, pre-wrapped, pure render)", .{});
        const mem_stats: ?[]const MemStat = if (show_mem) blk: {
            const stats = try allocator.alloc(MemStat, 1);
            stats[0] = .{ .name = "Buf", .bytes = final_buf_mem };
            break :blk stats;
        } else null;

        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = mem_stats,
        });
    }

    {
        const tb, const view = try setupTextBuffer(allocator, pool, text, 120);
        defer tb.deinit();
        defer view.deinit();

        const buf = try OptimizedBuffer.init(allocator, 120, 40, .{ .pool = pool });
        defer buf.deinit();

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var i: usize = 0;
        while (i < iterations) : (i += 1) {
            try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

            var timer = try std.time.Timer.start();
            try buf.drawTextBuffer(view, 0, 0);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "HOT:  120x40 render (500 lines, reused buffer, pure render)", .{});

        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return try results.toOwnedSlice();
}

fn benchRenderSmallResolution(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    
    
    iterations: usize,
    show_mem: bool,
) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    const text = try generateText(allocator, 100, 80);
    defer allocator.free(text);

    {
        const tb, const view = try setupTextBuffer(allocator, pool, text, 80);
        defer tb.deinit();
        defer view.deinit();

        const buf = try OptimizedBuffer.init(allocator, 80, 24, .{ .pool = pool });
        defer buf.deinit();

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;
        var final_buf_mem: usize = 0;

        var i: usize = 0;
        while (i < iterations) : (i += 1) {
            try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

            var timer = try std.time.Timer.start();
            try buf.drawTextBuffer(view, 0, 0);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;

            if (i == iterations - 1 and show_mem) {
                final_buf_mem = @sizeOf(OptimizedBuffer) + (buf.width * buf.height * (@sizeOf(u32) + @sizeOf(@TypeOf(buf.buffer.fg[0])) * 2 + @sizeOf(u8)));
            }
        }

        const name = try std.fmt.allocPrint(allocator, "80x24 render (100 lines, no wrap)", .{});
        const mem_stats: ?[]const MemStat = if (show_mem) blk: {
            const stats = try allocator.alloc(MemStat, 1);
            stats[0] = .{ .name = "Buf", .bytes = final_buf_mem };
            break :blk stats;
        } else null;

        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = mem_stats,
        });
    }

    {
        const tb, const view = try setupTextBuffer(allocator, pool, text, 40);
        defer tb.deinit();
        defer view.deinit();

        const buf = try OptimizedBuffer.init(allocator, 80, 24, .{ .pool = pool });
        defer buf.deinit();

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var i: usize = 0;
        while (i < iterations) : (i += 1) {
            try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

            var timer = try std.time.Timer.start();
            try buf.drawTextBuffer(view, 0, 0);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "80x24 render (100 lines, wrap=40)", .{});

        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return try results.toOwnedSlice();
}

fn benchRenderMediumResolution(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    
    
    iterations: usize,
    show_mem: bool,
) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    const text = try generateText(allocator, 1000, 120);
    defer allocator.free(text);

    {
        const tb, const view = try setupTextBuffer(allocator, pool, text, 200);
        defer tb.deinit();
        defer view.deinit();

        const buf = try OptimizedBuffer.init(allocator, 200, 60, .{ .pool = pool });
        defer buf.deinit();

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;
        var final_buf_mem: usize = 0;

        var i: usize = 0;
        while (i < iterations) : (i += 1) {
            try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

            var timer = try std.time.Timer.start();
            try buf.drawTextBuffer(view, 0, 0);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;

            if (i == iterations - 1 and show_mem) {
                final_buf_mem = @sizeOf(OptimizedBuffer) + (buf.width * buf.height * (@sizeOf(u32) + @sizeOf(@TypeOf(buf.buffer.fg[0])) * 2 + @sizeOf(u8)));
            }
        }

        const name = try std.fmt.allocPrint(allocator, "200x60 render (1000 lines, wrap=200)", .{});
        const mem_stats: ?[]const MemStat = if (show_mem) blk: {
            const stats = try allocator.alloc(MemStat, 1);
            stats[0] = .{ .name = "Buf", .bytes = final_buf_mem };
            break :blk stats;
        } else null;

        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = mem_stats,
        });
    }

    return try results.toOwnedSlice();
}

fn benchRenderMassiveResolution(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    
    
    iterations: usize,
    show_mem: bool,
) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    const text = try generateText(allocator, 10000, 200);
    defer allocator.free(text);

    {
        const tb, const view = try setupTextBuffer(allocator, pool, text, 400);
        defer tb.deinit();
        defer view.deinit();

        const buf = try OptimizedBuffer.init(allocator, 400, 200, .{ .pool = pool });
        defer buf.deinit();

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;
        var final_buf_mem: usize = 0;

        var i: usize = 0;
        while (i < iterations) : (i += 1) {
            try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

            var timer = try std.time.Timer.start();
            try buf.drawTextBuffer(view, 0, 0);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;

            if (i == iterations - 1 and show_mem) {
                final_buf_mem = @sizeOf(OptimizedBuffer) + (buf.width * buf.height * (@sizeOf(u32) + @sizeOf(@TypeOf(buf.buffer.fg[0])) * 2 + @sizeOf(u8)));
            }
        }

        const name = try std.fmt.allocPrint(allocator, "400x200 render (10k lines, wrap=400)", .{});
        const mem_stats: ?[]const MemStat = if (show_mem) blk: {
            const stats = try allocator.alloc(MemStat, 1);
            stats[0] = .{ .name = "Buf", .bytes = final_buf_mem };
            break :blk stats;
        } else null;

        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = mem_stats,
        });
    }

    return try results.toOwnedSlice();
}

fn benchRenderMassiveLines(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    
    
    iterations: usize,
    show_mem: bool,
) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    const text = try generateText(allocator, 50000, 60);
    defer allocator.free(text);

    {
        const tb, const view = try setupTextBuffer(allocator, pool, text, null);
        defer tb.deinit();
        defer view.deinit();

        const buf = try OptimizedBuffer.init(allocator, 120, 40, .{ .pool = pool });
        defer buf.deinit();

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;
        var final_buf_mem: usize = 0;

        var i: usize = 0;
        while (i < iterations) : (i += 1) {
            try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

            var timer = try std.time.Timer.start();
            try buf.drawTextBuffer(view, 0, 0);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;

            if (i == iterations - 1 and show_mem) {
                final_buf_mem = @sizeOf(OptimizedBuffer) + (buf.width * buf.height * (@sizeOf(u32) + @sizeOf(@TypeOf(buf.buffer.fg[0])) * 2 + @sizeOf(u8)));
            }
        }

        const name = try std.fmt.allocPrint(allocator, "120x40 render (50k lines, viewport first 40)", .{});
        const mem_stats: ?[]const MemStat = if (show_mem) blk: {
            const stats = try allocator.alloc(MemStat, 1);
            stats[0] = .{ .name = "Buf", .bytes = final_buf_mem };
            break :blk stats;
        } else null;

        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = mem_stats,
        });
    }

    return try results.toOwnedSlice();
}

fn benchRenderOneMassiveLine(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    
    
    iterations: usize,
    show_mem: bool,
) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    var buf_builder = std.ArrayList(u8).init(allocator);
    defer buf_builder.deinit();

    var j: u32 = 0;
    while (j < 100000) : (j += 1) {
        try buf_builder.appendSlice("word ");
    }
    const text = try buf_builder.toOwnedSlice();
    defer allocator.free(text);

    {
        const tb, const view = try setupTextBuffer(allocator, pool, text, 80);
        defer tb.deinit();
        defer view.deinit();

        const buf = try OptimizedBuffer.init(allocator, 80, 30, .{ .pool = pool });
        defer buf.deinit();

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;
        var final_buf_mem: usize = 0;

        var i: usize = 0;
        while (i < iterations) : (i += 1) {
            try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

            var timer = try std.time.Timer.start();
            try buf.drawTextBuffer(view, 0, 0);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;

            if (i == iterations - 1 and show_mem) {
                final_buf_mem = @sizeOf(OptimizedBuffer) + (buf.width * buf.height * (@sizeOf(u32) + @sizeOf(@TypeOf(buf.buffer.fg[0])) * 2 + @sizeOf(u8)));
            }
        }

        const name = try std.fmt.allocPrint(allocator, "80x30 render (1 massive line 500KB, wrap=80)", .{});
        const mem_stats: ?[]const MemStat = if (show_mem) blk: {
            const stats = try allocator.alloc(MemStat, 1);
            stats[0] = .{ .name = "Buf", .bytes = final_buf_mem };
            break :blk stats;
        } else null;

        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = mem_stats,
        });
    }

    return try results.toOwnedSlice();
}

fn benchRenderManySmallChunks(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    
    
    iterations: usize,
    show_mem: bool,
) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    const text = try generateManySmallChunks(allocator, 10000);
    defer allocator.free(text);

    {
        const tb, const view = try setupTextBuffer(allocator, pool, text, 80);
        defer tb.deinit();
        defer view.deinit();

        const buf = try OptimizedBuffer.init(allocator, 80, 30, .{ .pool = pool });
        defer buf.deinit();

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;
        var final_buf_mem: usize = 0;

        var i: usize = 0;
        while (i < iterations) : (i += 1) {
            try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

            var timer = try std.time.Timer.start();
            try buf.drawTextBuffer(view, 0, 0);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;

            if (i == iterations - 1 and show_mem) {
                final_buf_mem = @sizeOf(OptimizedBuffer) + (buf.width * buf.height * (@sizeOf(u32) + @sizeOf(@TypeOf(buf.buffer.fg[0])) * 2 + @sizeOf(u8)));
            }
        }

        const name = try std.fmt.allocPrint(allocator, "80x30 render (10k tiny chunks)", .{});
        const mem_stats: ?[]const MemStat = if (show_mem) blk: {
            const stats = try allocator.alloc(MemStat, 1);
            stats[0] = .{ .name = "Buf", .bytes = final_buf_mem };
            break :blk stats;
        } else null;

        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = mem_stats,
        });
    }

    return try results.toOwnedSlice();
}

fn benchRenderWithViewport(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    
    
    iterations: usize,
    show_mem: bool,
) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);
    _ = show_mem;

    const text = try generateText(allocator, 10000, 100);
    defer allocator.free(text);

    {
        const tb, const view = try setupTextBuffer(allocator, pool, text, null);
        defer tb.deinit();
        defer view.deinit();

        view.setViewport(.{ .x = 0, .y = 5000, .width = 100, .height = 30 });

        const buf = try OptimizedBuffer.init(allocator, 100, 30, .{ .pool = pool });
        defer buf.deinit();

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var i: usize = 0;
        while (i < iterations) : (i += 1) {
            try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

            var timer = try std.time.Timer.start();
            try buf.drawTextBuffer(view, 0, 0);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "100x30 render (10k lines, viewport at line 5000)", .{});

        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    {
        const tb, const view = try setupTextBuffer(allocator, pool, text, null);
        defer tb.deinit();
        defer view.deinit();

        const buf = try OptimizedBuffer.init(allocator, 100, 30, .{ .pool = pool });
        defer buf.deinit();

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var i: usize = 0;
        while (i < iterations) : (i += 1) {
            try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

            var timer = try std.time.Timer.start();
            try buf.drawTextBuffer(view, 0, 0);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "100x30 render (10k lines, no viewport)", .{});

        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return try results.toOwnedSlice();
}

fn benchRenderWithSelection(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    
    
    iterations: usize,
    show_mem: bool,
) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);
    _ = show_mem;

    const text = try generateText(allocator, 500, 100);
    defer allocator.free(text);

    {
        const tb, const view = try setupTextBuffer(allocator, pool, text, 120);
        defer tb.deinit();
        defer view.deinit();

        view.setSelection(500, 1500, .{ 0.2, 0.4, 0.8, 1.0 }, .{ 1.0, 1.0, 1.0, 1.0 });

        const buf = try OptimizedBuffer.init(allocator, 120, 40, .{ .pool = pool });
        defer buf.deinit();

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var i: usize = 0;
        while (i < iterations) : (i += 1) {
            try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

            var timer = try std.time.Timer.start();
            try buf.drawTextBuffer(view, 0, 0);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "120x40 render (500 lines, with selection)", .{});

        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    {
        const tb, const view = try setupTextBuffer(allocator, pool, text, 120);
        defer tb.deinit();
        defer view.deinit();

        const buf = try OptimizedBuffer.init(allocator, 120, 40, .{ .pool = pool });
        defer buf.deinit();

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var i: usize = 0;
        while (i < iterations) : (i += 1) {
            try buf.clear(.{ 0.0, 0.0, 0.0, 1.0 }, null);

            var timer = try std.time.Timer.start();
            try buf.drawTextBuffer(view, 0, 0);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "120x40 render (500 lines, no selection)", .{});

        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return try results.toOwnedSlice();
}

pub fn run(
    allocator: std.mem.Allocator,
    show_mem: bool,
) ![]BenchResult {
    const stdout = std.io.getStdOut().writer();

    // Global pool and unicode data are initialized once in bench.zig
    const pool = gp.initGlobalPool(allocator);
    
    

    if (show_mem) {
        try stdout.print("Memory stats enabled\n", .{});
    }
    try stdout.print("\n", .{});

    var all_results = std.ArrayList(BenchResult).init(allocator);

    const iterations: usize = 10;

    const cold_cache_results = try benchRenderColdCache(allocator, pool, iterations, show_mem);
    defer allocator.free(cold_cache_results);
    try all_results.appendSlice(cold_cache_results);

    const warm_cache_results = try benchRenderWarmCache(allocator, pool, iterations, show_mem);
    defer allocator.free(warm_cache_results);
    try all_results.appendSlice(warm_cache_results);

    try stdout.print("\n", .{});

    const small_res_results = try benchRenderSmallResolution(allocator, pool, iterations, show_mem);
    defer allocator.free(small_res_results);
    try all_results.appendSlice(small_res_results);

    const medium_res_results = try benchRenderMediumResolution(allocator, pool, iterations, show_mem);
    defer allocator.free(medium_res_results);
    try all_results.appendSlice(medium_res_results);

    const massive_res_results = try benchRenderMassiveResolution(allocator, pool, iterations, show_mem);
    defer allocator.free(massive_res_results);
    try all_results.appendSlice(massive_res_results);

    const massive_lines_results = try benchRenderMassiveLines(allocator, pool, iterations, show_mem);
    defer allocator.free(massive_lines_results);
    try all_results.appendSlice(massive_lines_results);

    const one_massive_line_results = try benchRenderOneMassiveLine(allocator, pool, iterations, show_mem);
    defer allocator.free(one_massive_line_results);
    try all_results.appendSlice(one_massive_line_results);

    const many_chunks_results = try benchRenderManySmallChunks(allocator, pool, iterations, show_mem);
    defer allocator.free(many_chunks_results);
    try all_results.appendSlice(many_chunks_results);

    const viewport_results = try benchRenderWithViewport(allocator, pool, iterations, show_mem);
    defer allocator.free(viewport_results);
    try all_results.appendSlice(viewport_results);

    const selection_results = try benchRenderWithSelection(allocator, pool, iterations, show_mem);
    defer allocator.free(selection_results);
    try all_results.appendSlice(selection_results);

    return try all_results.toOwnedSlice();
}
