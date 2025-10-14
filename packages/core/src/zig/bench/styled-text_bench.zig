const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const text_buffer_mod = @import("../text-buffer.zig");
const syntax_style_mod = @import("../syntax-style.zig");
const gp = @import("../grapheme.zig");
const gwidth = @import("../gwidth.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");

const BenchResult = bench_utils.BenchResult;
const MemStats = bench_utils.MemStats;
const TextBuffer = text_buffer_mod.UnifiedTextBuffer;
const StyledChunk = text_buffer_mod.UnifiedTextBuffer.StyledChunk;
const SyntaxStyle = syntax_style_mod.SyntaxStyle;

pub const benchName = "Styled Text Operations";

fn benchSetStyledTextOperations(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    // Setup global resources
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const global_alloc = arena.allocator();

    const pool = gp.initGlobalPool(global_alloc);
    const unicode_data = gp.initGlobalUnicodeData(global_alloc);
    const graphemes_ptr, const display_width_ptr = unicode_data;

    // Single chunk - baseline
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        const text = "Hello, World! This is a test of styled text rendering.";

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            const tb = try TextBuffer.init(allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
            defer tb.deinit();

            const style = try SyntaxStyle.init(allocator);
            defer style.deinit();
            tb.setSyntaxStyle(style);

            const chunks = [_]StyledChunk{.{
                .text = text,
                .fg = .{ 1.0, 1.0, 1.0, 1.0 },
                .bg = null,
                .attributes = 0,
            }};

            var timer = try std.time.Timer.start();
            try tb.setStyledText(&chunks);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "setStyledText - single chunk (55 chars)", .{});
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

    // Multiple small chunks
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            const tb = try TextBuffer.init(allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
            defer tb.deinit();

            const style = try SyntaxStyle.init(allocator);
            defer style.deinit();
            tb.setSyntaxStyle(style);

            const chunks = [_]StyledChunk{
                .{ .text = "Red ", .fg = .{ 1.0, 0.0, 0.0, 1.0 }, .bg = null, .attributes = 0 },
                .{ .text = "Green ", .fg = .{ 0.0, 1.0, 0.0, 1.0 }, .bg = null, .attributes = 0 },
                .{ .text = "Blue ", .fg = .{ 0.0, 0.0, 1.0, 1.0 }, .bg = null, .attributes = 0 },
                .{ .text = "Yellow ", .fg = .{ 1.0, 1.0, 0.0, 1.0 }, .bg = null, .attributes = 0 },
                .{ .text = "Cyan ", .fg = .{ 0.0, 1.0, 1.0, 1.0 }, .bg = null, .attributes = 0 },
                .{ .text = "Magenta ", .fg = .{ 1.0, 0.0, 1.0, 1.0 }, .bg = null, .attributes = 0 },
            };

            var timer = try std.time.Timer.start();
            try tb.setStyledText(&chunks);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "setStyledText - 6 small chunks (~6 chars each)", .{});
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

    // Many chunks (simulating syntax highlighted code)
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            const tb = try TextBuffer.init(allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
            defer tb.deinit();

            const style = try SyntaxStyle.init(allocator);
            defer style.deinit();
            tb.setSyntaxStyle(style);

            // Simulate a line of syntax highlighted code: "const x = 42;"
            const chunks = [_]StyledChunk{
                .{ .text = "const", .fg = .{ 0.8, 0.4, 1.0, 1.0 }, .bg = null, .attributes = 0 }, // keyword
                .{ .text = " ", .fg = null, .bg = null, .attributes = 0 }, // whitespace
                .{ .text = "x", .fg = .{ 0.7, 0.9, 1.0, 1.0 }, .bg = null, .attributes = 0 }, // identifier
                .{ .text = " ", .fg = null, .bg = null, .attributes = 0 }, // whitespace
                .{ .text = "=", .fg = .{ 1.0, 1.0, 1.0, 1.0 }, .bg = null, .attributes = 0 }, // operator
                .{ .text = " ", .fg = null, .bg = null, .attributes = 0 }, // whitespace
                .{ .text = "42", .fg = .{ 0.7, 1.0, 0.7, 1.0 }, .bg = null, .attributes = 0 }, // number
                .{ .text = ";", .fg = .{ 1.0, 1.0, 1.0, 1.0 }, .bg = null, .attributes = 0 }, // punctuation
            };

            var timer = try std.time.Timer.start();
            try tb.setStyledText(&chunks);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "setStyledText - 8 chunks (syntax highlighting)", .{});
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

    // Large text with many chunks
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            const tb = try TextBuffer.init(allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
            defer tb.deinit();

            const style = try SyntaxStyle.init(allocator);
            defer style.deinit();
            tb.setSyntaxStyle(style);

            // Create 50 chunks to simulate a larger styled text
            var chunk_list = std.ArrayList(StyledChunk).init(allocator);
            defer chunk_list.deinit();

            var i: usize = 0;
            while (i < 50) : (i += 1) {
                const color_r: f32 = @as(f32, @floatFromInt(i % 3)) / 3.0 + 0.3;
                const color_g: f32 = @as(f32, @floatFromInt((i + 1) % 3)) / 3.0 + 0.3;
                const color_b: f32 = @as(f32, @floatFromInt((i + 2) % 3)) / 3.0 + 0.3;

                try chunk_list.append(.{
                    .text = "Lorem ipsum dolor sit amet ",
                    .fg = .{ color_r, color_g, color_b, 1.0 },
                    .bg = null,
                    .attributes = 0,
                });
            }

            var timer = try std.time.Timer.start();
            try tb.setStyledText(chunk_list.items);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "setStyledText - 50 chunks (~1350 chars total)", .{});
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

    // Chunks with attributes (bold, italic, etc.)
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            const tb = try TextBuffer.init(allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
            defer tb.deinit();

            const style = try SyntaxStyle.init(allocator);
            defer style.deinit();
            tb.setSyntaxStyle(style);

            const chunks = [_]StyledChunk{
                .{ .text = "Normal ", .fg = null, .bg = null, .attributes = 0 },
                .{ .text = "Bold ", .fg = null, .bg = null, .attributes = 1 },
                .{ .text = "Italic ", .fg = null, .bg = null, .attributes = 2 },
                .{ .text = "Underline ", .fg = null, .bg = null, .attributes = 4 },
                .{ .text = "Bold+Italic ", .fg = null, .bg = null, .attributes = 3 },
            };

            var timer = try std.time.Timer.start();
            try tb.setStyledText(&chunks);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "setStyledText - 5 chunks with attributes", .{});
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
    _ = show_mem;

    var all_results = std.ArrayList(BenchResult).init(allocator);

    const iterations: usize = 100;

    const styled_text_results = try benchSetStyledTextOperations(allocator, iterations);
    defer allocator.free(styled_text_results);
    try all_results.appendSlice(styled_text_results);

    return try all_results.toOwnedSlice();
}
