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

pub fn generateLargeTextSingleLine(allocator: std.mem.Allocator, target_bytes: usize) ![]u8 {
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
    var pattern_idx: usize = 0;

    while (current_bytes < target_bytes) {
        const pattern = patterns[pattern_idx % patterns.len];
        try buffer.appendSlice(pattern);
        current_bytes += pattern.len;
        pattern_idx += 1;
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
    use_set_text: bool,
) !BenchData {
    var min_ns: u64 = std.math.maxInt(u64);
    var max_ns: u64 = 0;
    var total_ns: u64 = 0;
    var final_tb_mem: usize = 0;
    var final_view_mem: usize = 0;

    var i: usize = 0;
    while (i < iterations) : (i += 1) {
        var tb = try TextBufferArray.init(allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
        defer tb.deinit();

        if (use_set_text) {
            try tb.setText(text);
        } else {
            const mem_id = try tb.registerMemBuffer(text, false);

            var line_start: u32 = 0;
            for (text, 0..) |byte, idx| {
                if (byte == '\n') {
                    if (idx > line_start) {
                        try tb.addLine(mem_id, line_start, @intCast(idx));
                    }
                    line_start = @intCast(idx + 1);
                }
            }
            if (line_start < text.len) {
                try tb.addLine(mem_id, line_start, @intCast(text.len));
            }
        }

        var view = try TextBufferViewArray.init(allocator, tb);
        defer view.deinit();

        view.setWrapMode(wrap_mode);

        var timer = try std.time.Timer.start();
        view.setWrapWidth(wrap_width);
        const count = view.getVirtualLineCount();
        const elapsed = timer.read();
        _ = count;

        min_ns = @min(min_ns, elapsed);
        max_ns = @max(max_ns, elapsed);
        total_ns += elapsed;

        if (i == iterations - 1 and show_mem) {
            final_tb_mem = tb.getArenaAllocatedBytes();
            final_view_mem = view.getArenaAllocatedBytes();
        }
    }

    const mem_stats: ?[]const MemStat = if (show_mem) blk: {
        const stats = try allocator.alloc(MemStat, 2);
        stats[0] = .{ .name = "TB", .bytes = final_tb_mem };
        stats[1] = .{ .name = "View", .bytes = final_view_mem };
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
    use_set_text: bool,
) !BenchData {
    var min_ns: u64 = std.math.maxInt(u64);
    var max_ns: u64 = 0;
    var total_ns: u64 = 0;
    var final_tb_mem: usize = 0;
    var final_view_mem: usize = 0;

    var i: usize = 0;
    while (i < iterations) : (i += 1) {
        var tb = try TextBufferRope.init(allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
        defer tb.deinit();

        if (use_set_text) {
            try tb.setText(text);
        } else {
            const mem_id = try tb.registerMemBuffer(text, false);

            var line_start: u32 = 0;
            for (text, 0..) |byte, idx| {
                if (byte == '\n') {
                    if (idx > line_start) {
                        try tb.addLine(mem_id, line_start, @intCast(idx));
                    }
                    line_start = @intCast(idx + 1);
                }
            }
            if (line_start < text.len) {
                try tb.addLine(mem_id, line_start, @intCast(text.len));
            }
        }

        var view = try TextBufferViewRope.init(allocator, tb);
        defer view.deinit();

        view.setWrapMode(wrap_mode);

        var timer = try std.time.Timer.start();
        view.setWrapWidth(wrap_width);
        const count = view.getVirtualLineCount();
        const elapsed = timer.read();
        _ = count;

        min_ns = @min(min_ns, elapsed);
        max_ns = @max(max_ns, elapsed);
        total_ns += elapsed;

        if (i == iterations - 1 and show_mem) {
            final_tb_mem = tb.getArenaAllocatedBytes();
            final_view_mem = view.getArenaAllocatedBytes();
        }
    }

    const mem_stats: ?[]const MemStat = if (show_mem) blk: {
        const stats = try allocator.alloc(MemStat, 2);
        stats[0] = .{ .name = "TB", .bytes = final_tb_mem };
        stats[1] = .{ .name = "View", .bytes = final_view_mem };
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

    const pool = gp.initGlobalPool(allocator);
    defer gp.deinitGlobalPool();

    const unicode_data = gp.initGlobalUnicodeData(allocator);
    defer gp.deinitGlobalUnicodeData(allocator);
    const graphemes_ptr, const display_width_ptr = unicode_data;

    const text_multiline = try generateLargeText(allocator, 5000, 2 * 1024 * 1024);
    defer allocator.free(text_multiline);

    const text_singleline = try generateLargeTextSingleLine(allocator, 2 * 1024 * 1024);
    defer allocator.free(text_singleline);

    const text_mb_multi = @as(f64, @floatFromInt(text_multiline.len)) / (1024.0 * 1024.0);
    const text_mb_single = @as(f64, @floatFromInt(text_singleline.len)) / (1024.0 * 1024.0);
    const line_count_multi = blk: {
        var count: usize = 0;
        for (text_multiline) |byte| {
            if (byte == '\n') count += 1;
        }
        break :blk count;
    };

    try stdout.print("Generated {d:.2} MiB multiline text ({d} lines)\n", .{ text_mb_multi, line_count_multi });
    try stdout.print("Generated {d:.2} MiB single-line text\n", .{text_mb_single});
    if (show_mem) {
        try stdout.print("Memory stats enabled\n", .{});
    }
    try stdout.print("\n", .{});

    var results = std.ArrayList(BenchResult).init(allocator);

    const scenarios = [_]struct {
        impl: []const u8,
        width: u32,
        mode: []const u8,
        single_line: bool,
    }{
        .{ .impl = "Array", .width = 40, .mode = "char", .single_line = false },
        .{ .impl = "Array", .width = 80, .mode = "char", .single_line = false },
        .{ .impl = "Array", .width = 120, .mode = "char", .single_line = false },
        .{ .impl = "Array", .width = 40, .mode = "word", .single_line = false },
        .{ .impl = "Array", .width = 80, .mode = "word", .single_line = false },
        .{ .impl = "Array", .width = 120, .mode = "word", .single_line = false },
        .{ .impl = "Rope", .width = 40, .mode = "char", .single_line = false },
        .{ .impl = "Rope", .width = 80, .mode = "char", .single_line = false },
        .{ .impl = "Rope", .width = 120, .mode = "char", .single_line = false },
        .{ .impl = "Rope", .width = 40, .mode = "word", .single_line = false },
        .{ .impl = "Rope", .width = 80, .mode = "word", .single_line = false },
        .{ .impl = "Rope", .width = 120, .mode = "word", .single_line = false },
        .{ .impl = "Array", .width = 40, .mode = "char", .single_line = true },
        .{ .impl = "Array", .width = 80, .mode = "char", .single_line = true },
        .{ .impl = "Array", .width = 120, .mode = "char", .single_line = true },
        .{ .impl = "Array", .width = 40, .mode = "word", .single_line = true },
        .{ .impl = "Array", .width = 80, .mode = "word", .single_line = true },
        .{ .impl = "Array", .width = 120, .mode = "word", .single_line = true },
        .{ .impl = "Rope", .width = 40, .mode = "char", .single_line = true },
        .{ .impl = "Rope", .width = 80, .mode = "char", .single_line = true },
        .{ .impl = "Rope", .width = 120, .mode = "char", .single_line = true },
        .{ .impl = "Rope", .width = 40, .mode = "word", .single_line = true },
        .{ .impl = "Rope", .width = 80, .mode = "word", .single_line = true },
        .{ .impl = "Rope", .width = 120, .mode = "word", .single_line = true },
    };

    const iterations: usize = 5;

    for (scenarios) |scenario| {
        const wrap_mode = if (std.mem.eql(u8, scenario.mode, "char"))
            WrapMode.char
        else
            WrapMode.word;

        const text = if (scenario.single_line) text_singleline else text_multiline;
        const line_type = if (scenario.single_line) "single" else "multi";

        const bench_name = try std.fmt.allocPrint(allocator, "TextBufferView wrap ({s}, {s}, width={d}, {s}-line)", .{
            scenario.impl,
            scenario.mode,
            scenario.width,
            line_type,
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
                scenario.single_line,
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
                scenario.single_line,
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
