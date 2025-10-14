const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const gp = @import("../grapheme.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");

const UnifiedTextBuffer = text_buffer.UnifiedTextBuffer;
const UnifiedTextBufferView = text_buffer_view.UnifiedTextBufferView;
const WrapMode = text_buffer.WrapMode;
const BenchResult = bench_utils.BenchResult;
const MemStat = bench_utils.MemStat;

pub const benchName = "TextBuffer";

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

fn benchSetText(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    graphemes_ptr: *Graphemes,
    display_width_ptr: *DisplayWidth,
    iterations: usize,
    show_mem: bool,
) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    // Small text
    {
        const text = "Hello, world!\nSecond line\nThird line";
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;
        var final_mem: usize = 0;

        var i: usize = 0;
        while (i < iterations) : (i += 1) {
            var tb = try UnifiedTextBuffer.init(allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
            defer tb.deinit();

            var timer = try std.time.Timer.start();
            try tb.setText(text);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;

            if (i == iterations - 1 and show_mem) {
                final_mem = tb.getArenaAllocatedBytes();
            }
        }

        const name = try std.fmt.allocPrint(allocator, "TextBuffer setText small (3 lines, 40 bytes)", .{});
        const mem_stats: ?[]const MemStat = if (show_mem) blk: {
            const stats = try allocator.alloc(MemStat, 1);
            stats[0] = .{ .name = "TB", .bytes = final_mem };
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

    // Large multi-line text
    {
        const text = try generateLargeText(allocator, 5000, 1 * 1024 * 1024);
        defer allocator.free(text);

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;
        var final_mem: usize = 0;

        var i: usize = 0;
        while (i < iterations) : (i += 1) {
            var tb = try UnifiedTextBuffer.init(allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
            defer tb.deinit();

            var timer = try std.time.Timer.start();
            try tb.setText(text);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;

            if (i == iterations - 1 and show_mem) {
                final_mem = tb.getArenaAllocatedBytes();
            }
        }

        const text_mb = @as(f64, @floatFromInt(text.len)) / (1024.0 * 1024.0);
        const line_count = blk: {
            var count: usize = 1;
            for (text) |byte| {
                if (byte == '\n') count += 1;
            }
            break :blk count;
        };

        const name = try std.fmt.allocPrint(
            allocator,
            "TextBuffer setText large ({d} lines, {d:.2} MiB)",
            .{ line_count, text_mb },
        );
        const mem_stats: ?[]const MemStat = if (show_mem) blk: {
            const stats = try allocator.alloc(MemStat, 1);
            stats[0] = .{ .name = "TB", .bytes = final_mem };
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

fn benchWrap(
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
    var min_ns: u64 = std.math.maxInt(u64);
    var max_ns: u64 = 0;
    var total_ns: u64 = 0;
    var final_tb_mem: usize = 0;
    var final_view_mem: usize = 0;

    var i: usize = 0;
    while (i < iterations) : (i += 1) {
        var tb = try UnifiedTextBuffer.init(allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
        defer tb.deinit();

        try tb.setText(text);

        var view = try UnifiedTextBufferView.init(allocator, tb);
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

    if (show_mem) {
        try stdout.print("Memory stats enabled\n", .{});
    }
    try stdout.print("\n", .{});

    var all_results = std.ArrayList(BenchResult).init(allocator);

    const iterations: usize = 10;

    // Run setText benchmarks
    const setText_results = try benchSetText(allocator, pool, graphemes_ptr, display_width_ptr, iterations, show_mem);
    defer allocator.free(setText_results);
    try all_results.appendSlice(setText_results);

    // Generate test data for wrapping benchmarks
    const text_multiline = try generateLargeText(allocator, 5000, 1 * 1024 * 1024);
    defer allocator.free(text_multiline);

    const text_singleline = try generateLargeTextSingleLine(allocator, 2 * 1024 * 1024);
    defer allocator.free(text_singleline);

    const text_mb_multi = @as(f64, @floatFromInt(text_multiline.len)) / (1024.0 * 1024.0);
    const text_mb_single = @as(f64, @floatFromInt(text_singleline.len)) / (1024.0 * 1024.0);
    const line_count_multi = blk: {
        var count: usize = 1;
        for (text_multiline) |byte| {
            if (byte == '\n') count += 1;
        }
        break :blk count;
    };

    try stdout.print("Generated {d:.2} MiB multiline text ({d} lines)\n", .{ text_mb_multi, line_count_multi });
    try stdout.print("Generated {d:.2} MiB single-line text\n", .{text_mb_single});

    // Test wrapping scenarios
    const scenarios = [_]struct {
        width: u32,
        mode: WrapMode,
        mode_str: []const u8,
        single_line: bool,
    }{
        .{ .width = 40, .mode = .char, .mode_str = "char", .single_line = false },
        .{ .width = 80, .mode = .char, .mode_str = "char", .single_line = false },
        .{ .width = 120, .mode = .char, .mode_str = "char", .single_line = false },
        .{ .width = 40, .mode = .word, .mode_str = "word", .single_line = false },
        .{ .width = 80, .mode = .word, .mode_str = "word", .single_line = false },
        .{ .width = 120, .mode = .word, .mode_str = "word", .single_line = false },
        .{ .width = 40, .mode = .char, .mode_str = "char", .single_line = true },
        .{ .width = 80, .mode = .char, .mode_str = "char", .single_line = true },
        .{ .width = 120, .mode = .char, .mode_str = "char", .single_line = true },
        .{ .width = 40, .mode = .word, .mode_str = "word", .single_line = true },
        .{ .width = 80, .mode = .word, .mode_str = "word", .single_line = true },
        .{ .width = 120, .mode = .word, .mode_str = "word", .single_line = true },
    };

    for (scenarios) |scenario| {
        const text = if (scenario.single_line) text_singleline else text_multiline;
        const line_type = if (scenario.single_line) "single" else "multi";

        const bench_name = try std.fmt.allocPrint(allocator, "TextBufferView wrap ({s}, width={d}, {s}-line)", .{
            scenario.mode_str,
            scenario.width,
            line_type,
        });
        errdefer allocator.free(bench_name);

        const bench_data = try benchWrap(
            allocator,
            pool,
            graphemes_ptr,
            display_width_ptr,
            text,
            scenario.width,
            scenario.mode,
            iterations,
            show_mem,
        );

        try all_results.append(BenchResult{
            .name = bench_name,
            .min_ns = bench_data.min_ns,
            .avg_ns = bench_data.avg_ns,
            .max_ns = bench_data.max_ns,
            .total_ns = bench_data.total_ns,
            .iterations = iterations,
            .mem_stats = bench_data.mem,
        });
    }

    return try all_results.toOwnedSlice();
}
