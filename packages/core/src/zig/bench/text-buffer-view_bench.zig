const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const gp = @import("../grapheme.zig");
const gwidth = @import("../gwidth.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");

const TextBufferArray = text_buffer.TextBufferArray;
const TextBufferRope = text_buffer.TextBufferRope;
const TextBufferViewArray = text_buffer_view.TextBufferViewArray;
const TextBufferViewRope = text_buffer_view.TextBufferViewRope;
const WrapMode = text_buffer.WrapMode;
const BenchResult = bench_utils.BenchResult;
const MemStat = bench_utils.MemStat;

const BenchData = struct {
    min_ns: u64,
    avg_ns: u64,
    max_ns: u64,
    total_ns: u64,
    mem: ?[]const MemStat,
};

pub fn generateLargeText(allocator: std.mem.Allocator, lines: u32, target_bytes: usize) ![]u8 {
    var buffer = std.ArrayList(u8).init(allocator);
    errdefer buffer.deinit();

    const patterns = [_][]const u8{
        "The quick brown fox jumps over the lazy dog. ",
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ",
        "Hello, 世界! Unicode テスト 🌍🎉 ",
        "Mixed width: ASCII 中文字符 emoji 🚀🔥💻 and more text. ",
        "Programming languages: Rust, Zig, Go, Python, JavaScript. ",
        "Αυτό είναι ελληνικό κείμενο. Это русский текст. ",
        "Numbers and symbols: 12345 !@#$%^&*() []{}|;:',.<>? ",
        "Tab\tseparated\tvalues\there\tfor\ttesting\twrapping. ",
    };

    var current_bytes: usize = 0;
    var line_idx: u32 = 0;

    while (current_bytes < target_bytes and line_idx < lines) : (line_idx += 1) {
        const pattern = patterns[line_idx % patterns.len];
        const repeat_count = 2 + (line_idx % 5);

        var repeat: usize = 0;
        while (repeat < repeat_count) : (repeat += 1) {
            try buffer.appendSlice(pattern);
            current_bytes += pattern.len;
        }

        try buffer.append('\n');
        current_bytes += 1;
    }

    return try buffer.toOwnedSlice();
}

fn benchWrapArray(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    graphemes_ptr: *Graphemes,
    display_width_ptr: *DisplayWidth,
    text: []const u8,
    wrap_width: u32,
    wrap_mode: WrapMode,
    iterations: usize,
    show_mem: bool,
) !BenchData {
    var tb = try TextBufferArray.init(allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const mem_id = try tb.registerMemBuffer(text, false);

    var line_start: u32 = 0;
    for (text, 0..) |byte, i| {
        if (byte == '\n') {
            if (i > line_start) {
                try tb.addLine(mem_id, line_start, @intCast(i));
            }
            line_start = @intCast(i + 1);
        }
    }
    if (line_start < text.len) {
        try tb.addLine(mem_id, line_start, @intCast(text.len));
    }

    var view = try TextBufferViewArray.init(allocator, tb);
    defer view.deinit();

    view.setWrapMode(wrap_mode);
    view.setWrapWidth(wrap_width);

    _ = view.getVirtualLineCount();

    var min_ns: u64 = std.math.maxInt(u64);
    var max_ns: u64 = 0;
    var total_ns: u64 = 0;

    var i: usize = 0;
    while (i < iterations) : (i += 1) {
        view.setWrapWidth(null);
        _ = view.getVirtualLineCount();

        var timer = try std.time.Timer.start();
        view.setWrapWidth(wrap_width);
        const count = view.getVirtualLineCount();
        const elapsed = timer.read();
        _ = count;

        min_ns = @min(min_ns, elapsed);
        max_ns = @max(max_ns, elapsed);
        total_ns += elapsed;
    }

    const mem_stats: ?[]const MemStat = if (show_mem) blk: {
        const stats = try allocator.alloc(MemStat, 2);
        stats[0] = .{ .name = "TB", .bytes = tb.getArenaAllocatedBytes() };
        stats[1] = .{ .name = "View", .bytes = view.getArenaAllocatedBytes() };
        break :blk stats;
    } else null;

    return .{
        .min_ns = min_ns,
        .avg_ns = total_ns / iterations,
        .max_ns = max_ns,
        .total_ns = total_ns,
        .mem = mem_stats,
    };
}

fn benchWrapRope(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    graphemes_ptr: *Graphemes,
    display_width_ptr: *DisplayWidth,
    text: []const u8,
    wrap_width: u32,
    wrap_mode: WrapMode,
    iterations: usize,
    show_mem: bool,
) !BenchData {
    var tb = try TextBufferRope.init(allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
    defer tb.deinit();

    const mem_id = try tb.registerMemBuffer(text, false);

    var line_start: u32 = 0;
    for (text, 0..) |byte, i| {
        if (byte == '\n') {
            if (i > line_start) {
                try tb.addLine(mem_id, line_start, @intCast(i));
            }
            line_start = @intCast(i + 1);
        }
    }
    if (line_start < text.len) {
        try tb.addLine(mem_id, line_start, @intCast(text.len));
    }

    var view = try TextBufferViewRope.init(allocator, tb);
    defer view.deinit();

    view.setWrapMode(wrap_mode);
    view.setWrapWidth(wrap_width);

    _ = view.getVirtualLineCount();

    var min_ns: u64 = std.math.maxInt(u64);
    var max_ns: u64 = 0;
    var total_ns: u64 = 0;

    var i: usize = 0;
    while (i < iterations) : (i += 1) {
        view.setWrapWidth(null);
        _ = view.getVirtualLineCount();

        var timer = try std.time.Timer.start();
        view.setWrapWidth(wrap_width);
        const count = view.getVirtualLineCount();
        const elapsed = timer.read();
        _ = count;

        min_ns = @min(min_ns, elapsed);
        max_ns = @max(max_ns, elapsed);
        total_ns += elapsed;
    }

    const mem_stats: ?[]const MemStat = if (show_mem) blk: {
        const stats = try allocator.alloc(MemStat, 2);
        stats[0] = .{ .name = "TB", .bytes = tb.getArenaAllocatedBytes() };
        stats[1] = .{ .name = "View", .bytes = view.getArenaAllocatedBytes() };
        break :blk stats;
    } else null;

    return .{
        .min_ns = min_ns,
        .avg_ns = total_ns / iterations,
        .max_ns = max_ns,
        .total_ns = total_ns,
        .mem = mem_stats,
    };
}

pub fn run(
    allocator: std.mem.Allocator,
    show_mem: bool,
) ![]BenchResult {
    const stdout = std.io.getStdOut().writer();

    // Set up benchmark-specific dependencies
    const pool = gp.initGlobalPool(allocator);
    defer gp.deinitGlobalPool();

    const unicode_data = gp.initGlobalUnicodeData(allocator);
    defer gp.deinitGlobalUnicodeData(allocator);
    const graphemes_ptr, const display_width_ptr = unicode_data;

    const text = try generateLargeText(allocator, 5000, 2 * 1024 * 1024);
    defer allocator.free(text);

    const text_mb = @as(f64, @floatFromInt(text.len)) / (1024.0 * 1024.0);
    const line_count = blk: {
        var count: usize = 0;
        for (text) |byte| {
            if (byte == '\n') count += 1;
        }
        break :blk count;
    };

    try stdout.print("Generated {d:.2} MiB of text ({d} lines)\n", .{ text_mb, line_count });
    if (show_mem) {
        try stdout.print("Memory stats enabled\n", .{});
    }
    try stdout.print("\n", .{});

    var results = std.ArrayList(BenchResult).init(allocator);

    const scenarios = [_]struct {
        impl: []const u8,
        width: u32,
        mode: []const u8,
    }{
        .{ .impl = "Array", .width = 40, .mode = "char" },
        .{ .impl = "Array", .width = 80, .mode = "char" },
        .{ .impl = "Array", .width = 120, .mode = "char" },
        .{ .impl = "Array", .width = 40, .mode = "word" },
        .{ .impl = "Array", .width = 80, .mode = "word" },
        .{ .impl = "Array", .width = 120, .mode = "word" },
        .{ .impl = "Rope", .width = 40, .mode = "char" },
        .{ .impl = "Rope", .width = 80, .mode = "char" },
        .{ .impl = "Rope", .width = 120, .mode = "char" },
        .{ .impl = "Rope", .width = 40, .mode = "word" },
        .{ .impl = "Rope", .width = 80, .mode = "word" },
        .{ .impl = "Rope", .width = 120, .mode = "word" },
    };

    const iterations: usize = 5;

    for (scenarios) |scenario| {
        const wrap_mode = if (std.mem.eql(u8, scenario.mode, "char"))
            WrapMode.char
        else
            WrapMode.word;

        const bench_name = try std.fmt.allocPrint(allocator, "TextBufferView wrap ({s}, {s}, width={d})", .{
            scenario.impl,
            scenario.mode,
            scenario.width,
        });
        errdefer allocator.free(bench_name);

        const bench_data = if (std.mem.eql(u8, scenario.impl, "Array"))
            try benchWrapArray(
                allocator,
                pool,
                graphemes_ptr,
                display_width_ptr,
                text,
                scenario.width,
                wrap_mode,
                iterations,
                show_mem,
            )
        else
            try benchWrapRope(
                allocator,
                pool,
                graphemes_ptr,
                display_width_ptr,
                text,
                scenario.width,
                wrap_mode,
                iterations,
                show_mem,
            );

        try results.append(BenchResult{
            .name = bench_name,
            .min_ns = bench_data.min_ns,
            .avg_ns = bench_data.avg_ns,
            .max_ns = bench_data.max_ns,
            .total_ns = bench_data.total_ns,
            .iterations = iterations,
            .mem_stats = bench_data.mem,
        });
    }

    return try results.toOwnedSlice();
}
