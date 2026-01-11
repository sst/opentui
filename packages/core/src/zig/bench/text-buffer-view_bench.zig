const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const gp = @import("../grapheme.zig");

const UnifiedTextBuffer = text_buffer.UnifiedTextBuffer;
const UnifiedTextBufferView = text_buffer_view.UnifiedTextBufferView;
const WrapMode = text_buffer.WrapMode;
const BenchResult = bench_utils.BenchResult;
const BenchStats = bench_utils.BenchStats;
const MemStat = bench_utils.MemStat;

pub const benchName = "TextBuffer Wrapping";

pub fn generateLargeText(allocator: std.mem.Allocator, lines: u32, target_bytes: usize) ![]u8 {
    var buffer: std.ArrayListUnmanaged(u8) = .{};
    errdefer buffer.deinit(allocator);

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

        for (0..repeat_count) |_| {
            try buffer.appendSlice(allocator, pattern);
            current_bytes += pattern.len;
        }

        try buffer.append(allocator, '\n');
        current_bytes += 1;
    }

    return try buffer.toOwnedSlice(allocator);
}

pub fn generateLargeTextSingleLine(allocator: std.mem.Allocator, target_bytes: usize) ![]u8 {
    var buffer: std.ArrayListUnmanaged(u8) = .{};
    errdefer buffer.deinit(allocator);

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
        try buffer.appendSlice(allocator, pattern);
        current_bytes += pattern.len;
        pattern_idx += 1;
    }

    return try buffer.toOwnedSlice(allocator);
}

fn benchSetText(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    iterations: usize,
    show_mem: bool,
) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(allocator);

    // Small text
    {
        const text = "Hello, world!\nSecond line\nThird line";
        var stats = BenchStats{};
        var final_mem: usize = 0;

        for (0..iterations) |i| {
            var tb = try UnifiedTextBuffer.init(allocator, pool, .unicode);
            defer tb.deinit();

            var timer = try std.time.Timer.start();
            try tb.setText(text);
            stats.record(timer.read());

            if (i == iterations - 1 and show_mem) {
                final_mem = tb.getArenaAllocatedBytes();
            }
        }

        const name = try std.fmt.allocPrint(allocator, "TextBuffer setText small (3 lines, 40 bytes)", .{});
        const mem_stats: ?[]const MemStat = if (show_mem) blk: {
            const mem = try allocator.alloc(MemStat, 1);
            mem[0] = .{ .name = "TB", .bytes = final_mem };
            break :blk mem;
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
    }

    // Large multi-line text
    {
        const text = try generateLargeText(allocator, 5000, 1 * 1024 * 1024);
        defer allocator.free(text);

        var stats = BenchStats{};
        var final_mem: usize = 0;

        for (0..iterations) |i| {
            var tb = try UnifiedTextBuffer.init(allocator, pool, .unicode);
            defer tb.deinit();

            var timer = try std.time.Timer.start();
            try tb.setText(text);
            stats.record(timer.read());

            if (i == iterations - 1 and show_mem) {
                final_mem = tb.getArenaAllocatedBytes();
            }
        }

        const text_mb = @as(f64, @floatFromInt(text.len)) / (1024.0 * 1024.0);
        var line_count: usize = 1;
        for (text) |byte| {
            if (byte == '\n') line_count += 1;
        }

        const name = try std.fmt.allocPrint(
            allocator,
            "TextBuffer setText large ({d} lines, {d:.2} MiB)",
            .{ line_count, text_mb },
        );
        const mem_stats: ?[]const MemStat = if (show_mem) blk: {
            const mem = try allocator.alloc(MemStat, 1);
            mem[0] = .{ .name = "TB", .bytes = final_mem };
            break :blk mem;
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
    }

    return try results.toOwnedSlice(allocator);
}

fn benchWrap(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    text: []const u8,
    wrap_width: u32,
    wrap_mode: WrapMode,
    iterations: usize,
    show_mem: bool,
) !BenchResult {
    var stats = BenchStats{};
    var final_tb_mem: usize = 0;
    var final_view_mem: usize = 0;

    for (0..iterations) |i| {
        var tb = try UnifiedTextBuffer.init(allocator, pool, .unicode);
        defer tb.deinit();

        try tb.setText(text);

        var view = try UnifiedTextBufferView.init(allocator, tb);
        defer view.deinit();

        view.setWrapMode(wrap_mode);

        var timer = try std.time.Timer.start();
        view.setWrapWidth(wrap_width);
        const count = view.getVirtualLineCount();
        stats.record(timer.read());
        _ = count;

        if (i == iterations - 1 and show_mem) {
            final_tb_mem = tb.getArenaAllocatedBytes();
            final_view_mem = view.getArenaAllocatedBytes();
        }
    }

    const mem_stats: ?[]const MemStat = if (show_mem) blk: {
        const mem = try allocator.alloc(MemStat, 2);
        mem[0] = .{ .name = "TB", .bytes = final_tb_mem };
        mem[1] = .{ .name = "View", .bytes = final_view_mem };
        break :blk mem;
    } else null;

    return .{
        .name = "",
        .min_ns = stats.min_ns,
        .avg_ns = stats.avg(),
        .max_ns = stats.max_ns,
        .total_ns = stats.total_ns,
        .iterations = iterations,
        .mem_stats = mem_stats,
    };
}

fn benchMeasureForDimensionsLayout(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    text: []const u8,
    streaming: bool,
    measure_width: u32,
    layout_passes: usize,
    iterations: usize,
    show_mem: bool,
) !BenchResult {
    const steps: usize = 200;

    var stats = BenchStats{};
    var final_tb_mem: usize = 0;
    var final_view_mem: usize = 0;

    const token = "token ";
    const newline = "\n";
    const newline_stride: usize = 20;

    for (0..iterations) |i| {
        var tb = try UnifiedTextBuffer.init(allocator, pool, .unicode);
        defer tb.deinit();

        try tb.setText(text);

        var view = try UnifiedTextBufferView.init(allocator, tb);
        defer view.deinit();

        view.setWrapMode(.word);

        var token_mem_id: u8 = 0;
        var newline_mem_id: u8 = 0;
        if (streaming) {
            token_mem_id = try tb.registerMemBuffer(token, false);
            newline_mem_id = try tb.registerMemBuffer(newline, false);
        }

        var timer = try std.time.Timer.start();
        for (0..steps) |step| {
            if (streaming) {
                try tb.appendFromMemId(token_mem_id);
                if ((step + 1) % newline_stride == 0) {
                    try tb.appendFromMemId(newline_mem_id);
                }
            }

            // Simulate Yoga's repeated measure calls within a single layout pass.
            for (0..layout_passes) |_| {
                _ = try view.measureForDimensions(measure_width, 24);
            }
        }
        stats.record(timer.read());

        if (i == iterations - 1 and show_mem) {
            final_tb_mem = tb.getArenaAllocatedBytes();
            final_view_mem = view.getArenaAllocatedBytes();
        }
    }

    const mem_stats: ?[]const MemStat = if (show_mem) blk: {
        const mem = try allocator.alloc(MemStat, 2);
        mem[0] = .{ .name = "TB", .bytes = final_tb_mem };
        mem[1] = .{ .name = "View", .bytes = final_view_mem };
        break :blk mem;
    } else null;

    return .{
        .name = "",
        .min_ns = stats.min_ns,
        .avg_ns = stats.avg(),
        .max_ns = stats.max_ns,
        .total_ns = stats.total_ns,
        .iterations = iterations,
        .mem_stats = mem_stats,
    };
}

pub fn run(
    allocator: std.mem.Allocator,
    show_mem: bool,
) ![]BenchResult {
    // Global pool and unicode data are initialized once in bench.zig
    const pool = gp.initGlobalPool(allocator);

    var all_results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer all_results.deinit(allocator);

    const iterations: usize = 10;

    // Run setText benchmarks
    const setText_results = try benchSetText(allocator, pool, iterations, show_mem);
    try all_results.appendSlice(allocator, setText_results);

    // Generate test data for wrapping benchmarks
    const text_multiline = try generateLargeText(allocator, 5000, 1 * 1024 * 1024);
    const text_singleline = try generateLargeTextSingleLine(allocator, 2 * 1024 * 1024);

    // Run measureForDimensions benchmarks
    const layout_passes: usize = 3;
    const wrap_width: u32 = 80;
    const measure_scenarios = [_]struct {
        label: []const u8,
        streaming: bool,
        width: u32,
    }{
        .{ .label = "layout streaming wrap", .streaming = true, .width = wrap_width },
        .{ .label = "layout streaming intrinsic", .streaming = true, .width = 0 },
        .{ .label = "layout static wrap", .streaming = false, .width = wrap_width },
    };

    for (measure_scenarios) |scenario| {
        const bench_name = try std.fmt.allocPrint(
            allocator,
            "TextBufferView measureForDimensions ({s}, {d:.2} MiB)",
            .{ scenario.label, @as(f64, @floatFromInt(text_multiline.len)) / (1024.0 * 1024.0) },
        );

        var bench_result = try benchMeasureForDimensionsLayout(
            allocator,
            pool,
            text_multiline,
            scenario.streaming,
            scenario.width,
            layout_passes,
            iterations,
            show_mem,
        );
        bench_result.name = bench_name;

        try all_results.append(allocator, bench_result);
    }

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

        var bench_result = try benchWrap(
            allocator,
            pool,
            text,
            scenario.width,
            scenario.mode,
            iterations,
            show_mem,
        );
        bench_result.name = bench_name;

        try all_results.append(allocator, bench_result);
    }

    return try all_results.toOwnedSlice(allocator);
}
