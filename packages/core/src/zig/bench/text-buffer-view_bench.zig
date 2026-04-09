const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const text_buffer = @import("../text-buffer.zig");
const text_buffer_view = @import("../text-buffer-view.zig");
const gp = @import("../grapheme.zig");
const link = @import("../link.zig");

const UnifiedTextBuffer = text_buffer.UnifiedTextBuffer;
const UnifiedTextBufferView = text_buffer_view.UnifiedTextBufferView;
const WrapMode = text_buffer.WrapMode;
const BenchResult = bench_utils.BenchResult;
const BenchStats = bench_utils.BenchStats;
const MemStat = bench_utils.MemStat;

pub const benchName = "TextBuffer Wrapping";

const large_text_patterns = [_][]const u8{
    "The quick brown fox jumps over the lazy dog. ",
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ",
    "Hello, 世界! Unicode テスト 🌍🎉 ",
    "Mixed width: ASCII 中文字符 emoji 🚀🔥💻 and more text. ",
    "Programming languages: Rust, Zig, Go, Python, JavaScript. ",
    "Αυτό είναι ελληνικό κείμενο. Это русский текст. ",
    "Numbers and symbols: 12345 !@#$%^&*() []{}|;:',.<>? ",
    "Tab\tseparated\tvalues\there\tfor\ttesting\twrapping. ",
};

pub fn generateLargeText(allocator: std.mem.Allocator, lines: u32, target_bytes: usize) ![]u8 {
    var buffer: std.ArrayListUnmanaged(u8) = .{};
    errdefer buffer.deinit(allocator);

    var current_bytes: usize = 0;
    var line_idx: u32 = 0;

    while (current_bytes < target_bytes and line_idx < lines) : (line_idx += 1) {
        const pattern = large_text_patterns[line_idx % large_text_patterns.len];
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

    var current_bytes: usize = 0;
    var pattern_idx: usize = 0;

    while (current_bytes < target_bytes) {
        const pattern = large_text_patterns[pattern_idx % large_text_patterns.len];
        try buffer.appendSlice(allocator, pattern);
        current_bytes += pattern.len;
        pattern_idx += 1;
    }

    return try buffer.toOwnedSlice(allocator);
}

fn computeLargeTextStats(lines: u32, target_bytes: usize) struct { bytes: usize, line_count: usize } {
    var current_bytes: usize = 0;
    var line_idx: u32 = 0;

    while (current_bytes < target_bytes and line_idx < lines) : (line_idx += 1) {
        const pattern = large_text_patterns[line_idx % large_text_patterns.len];
        const repeat_count = 2 + (line_idx % 5);
        current_bytes += pattern.len * repeat_count + 1;
    }

    return .{ .bytes = current_bytes, .line_count = line_idx };
}

fn computeSingleLineTextSize(target_bytes: usize) usize {
    var current_bytes: usize = 0;
    var pattern_idx: usize = 0;

    while (current_bytes < target_bytes) {
        const pattern = large_text_patterns[pattern_idx % large_text_patterns.len];
        current_bytes += pattern.len;
        pattern_idx += 1;
    }

    return current_bytes;
}

fn benchSetText(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    iterations: usize,
    show_mem: bool,
    bench_filter: ?[]const u8,
) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(allocator);
    const link_pool = link.initGlobalLinkPool(allocator);

    // Small text
    {
        const name = "TextBuffer setText small (3 lines, 40 bytes)";
        if (bench_utils.matchesBenchFilter(name, bench_filter)) {
            const text = "Hello, world!\nSecond line\nThird line";
            var stats = BenchStats{};
            var final_mem: usize = 0;

            for (0..iterations) |i| {
                var tb = try UnifiedTextBuffer.init(allocator, pool, link_pool, .unicode);
                defer tb.deinit();

                var timer = try std.time.Timer.start();
                try tb.setText(text);
                stats.record(timer.read());

                if (i == iterations - 1 and show_mem) {
                    final_mem = tb.getArenaAllocatedBytes();
                }
            }

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
    }

    // Large multi-line text
    {
        const text_stats = computeLargeTextStats(5000, 1 * 1024 * 1024);
        const text_mb = @as(f64, @floatFromInt(text_stats.bytes)) / (1024.0 * 1024.0);
        const name = try std.fmt.allocPrint(
            allocator,
            "TextBuffer setText large ({d} lines, {d:.2} MiB)",
            .{ text_stats.line_count, text_mb },
        );

        if (!bench_utils.matchesBenchFilter(name, bench_filter)) {
            allocator.free(name);
        } else {
            const text = try generateLargeText(allocator, 5000, 1 * 1024 * 1024);
            defer allocator.free(text);

            var stats = BenchStats{};
            var final_mem: usize = 0;

            for (0..iterations) |i| {
                var tb = try UnifiedTextBuffer.init(allocator, pool, link_pool, .unicode);
                defer tb.deinit();

                var timer = try std.time.Timer.start();
                try tb.setText(text);
                stats.record(timer.read());

                if (i == iterations - 1 and show_mem) {
                    final_mem = tb.getArenaAllocatedBytes();
                }
            }

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
    const link_pool = link.initGlobalLinkPool(allocator);

    for (0..iterations) |i| {
        var tb = try UnifiedTextBuffer.init(allocator, pool, link_pool, .unicode);
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
    const link_pool = link.initGlobalLinkPool(allocator);

    const token = "token ";
    const newline = "\n";
    const newline_stride: usize = 20;

    for (0..iterations) |i| {
        var tb = try UnifiedTextBuffer.init(allocator, pool, link_pool, .unicode);
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
    bench_filter: ?[]const u8,
) ![]BenchResult {
    // Global pool and unicode data are initialized once in bench.zig
    const pool = gp.initGlobalPool(allocator);

    var all_results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer all_results.deinit(allocator);

    const iterations: usize = 10;

    // Run setText benchmarks
    const setText_results = try benchSetText(allocator, pool, iterations, show_mem, bench_filter);
    try all_results.appendSlice(allocator, setText_results);

    var text_multiline: ?[]u8 = null;
    defer if (text_multiline) |text| allocator.free(text);
    var text_singleline: ?[]u8 = null;
    defer if (text_singleline) |text| allocator.free(text);
    const multiline_stats = computeLargeTextStats(5000, 1 * 1024 * 1024);
    const multiline_mb = @as(f64, @floatFromInt(multiline_stats.bytes)) / (1024.0 * 1024.0);

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
            .{ scenario.label, multiline_mb },
        );

        if (!bench_utils.matchesBenchFilter(bench_name, bench_filter)) {
            allocator.free(bench_name);
            continue;
        }

        if (text_multiline == null) {
            text_multiline = try generateLargeText(allocator, 5000, 1 * 1024 * 1024);
        }

        var bench_result = try benchMeasureForDimensionsLayout(
            allocator,
            pool,
            text_multiline.?,
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
        if (scenario.single_line) {
            if (text_singleline == null) {
                text_singleline = try generateLargeTextSingleLine(allocator, 2 * 1024 * 1024);
            }
        } else {
            if (text_multiline == null) {
                text_multiline = try generateLargeText(allocator, 5000, 1 * 1024 * 1024);
            }
        }
        const text = if (scenario.single_line) text_singleline.? else text_multiline.?;
        const line_type = if (scenario.single_line) "single" else "multi";

        const bench_name = try std.fmt.allocPrint(allocator, "TextBufferView wrap ({s}, width={d}, {s}-line)", .{
            scenario.mode_str,
            scenario.width,
            line_type,
        });

        if (!bench_utils.matchesBenchFilter(bench_name, bench_filter)) {
            allocator.free(bench_name);
            continue;
        }

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
