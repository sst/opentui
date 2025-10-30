const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const text_buffer_mod = @import("../text-buffer.zig");
const syntax_style_mod = @import("../syntax-style.zig");
const gp = @import("../grapheme.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");

const BenchResult = bench_utils.BenchResult;
const MemStats = bench_utils.MemStats;
const TextBuffer = text_buffer_mod.UnifiedTextBuffer;
const StyledChunk = text_buffer_mod.StyledChunk; // Use the unified type from text-buffer
const SyntaxStyle = syntax_style_mod.SyntaxStyle;

pub const benchName = "Styled Text Operations";

// Helper to convert RGBA to pointer for benchmark
fn rgbaToPtr(rgba: *const [4]f32) [*]const f32 {
    return @ptrCast(rgba);
}

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
        const fg_color = [4]f32{ 1.0, 1.0, 1.0, 1.0 };

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            const tb = try TextBuffer.init(allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
            defer tb.deinit();

            const style = try SyntaxStyle.init(allocator);
            defer style.deinit();
            tb.setSyntaxStyle(style);

            const chunks = [_]StyledChunk{.{
                .text_ptr = text.ptr,
                .text_len = text.len,
                .fg_ptr = rgbaToPtr(&fg_color),
                .bg_ptr = null,
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

        const red = [4]f32{ 1.0, 0.0, 0.0, 1.0 };
        const green = [4]f32{ 0.0, 1.0, 0.0, 1.0 };
        const blue = [4]f32{ 0.0, 0.0, 1.0, 1.0 };
        const yellow = [4]f32{ 1.0, 1.0, 0.0, 1.0 };
        const cyan = [4]f32{ 0.0, 1.0, 1.0, 1.0 };
        const magenta = [4]f32{ 1.0, 0.0, 1.0, 1.0 };

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            const tb = try TextBuffer.init(allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
            defer tb.deinit();

            const style = try SyntaxStyle.init(allocator);
            defer style.deinit();
            tb.setSyntaxStyle(style);

            const text0 = "Red ";
            const text1 = "Green ";
            const text2 = "Blue ";
            const text3 = "Yellow ";
            const text4 = "Cyan ";
            const text5 = "Magenta ";

            const chunks = [_]StyledChunk{
                .{ .text_ptr = text0.ptr, .text_len = text0.len, .fg_ptr = rgbaToPtr(&red), .bg_ptr = null, .attributes = 0 },
                .{ .text_ptr = text1.ptr, .text_len = text1.len, .fg_ptr = rgbaToPtr(&green), .bg_ptr = null, .attributes = 0 },
                .{ .text_ptr = text2.ptr, .text_len = text2.len, .fg_ptr = rgbaToPtr(&blue), .bg_ptr = null, .attributes = 0 },
                .{ .text_ptr = text3.ptr, .text_len = text3.len, .fg_ptr = rgbaToPtr(&yellow), .bg_ptr = null, .attributes = 0 },
                .{ .text_ptr = text4.ptr, .text_len = text4.len, .fg_ptr = rgbaToPtr(&cyan), .bg_ptr = null, .attributes = 0 },
                .{ .text_ptr = text5.ptr, .text_len = text5.len, .fg_ptr = rgbaToPtr(&magenta), .bg_ptr = null, .attributes = 0 },
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

        const keyword_color = [4]f32{ 0.8, 0.4, 1.0, 1.0 };
        const identifier_color = [4]f32{ 0.7, 0.9, 1.0, 1.0 };
        const operator_color = [4]f32{ 1.0, 1.0, 1.0, 1.0 };
        const number_color = [4]f32{ 0.7, 1.0, 0.7, 1.0 };

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            const tb = try TextBuffer.init(allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
            defer tb.deinit();

            const style = try SyntaxStyle.init(allocator);
            defer style.deinit();
            tb.setSyntaxStyle(style);

            // Simulate a line of syntax highlighted code: "const x = 42;"
            const t0 = "const";
            const t1 = " ";
            const t2 = "x";
            const t3 = " ";
            const t4 = "=";
            const t5 = " ";
            const t6 = "42";
            const t7 = ";";

            const chunks = [_]StyledChunk{
                .{ .text_ptr = t0.ptr, .text_len = t0.len, .fg_ptr = rgbaToPtr(&keyword_color), .bg_ptr = null, .attributes = 0 },
                .{ .text_ptr = t1.ptr, .text_len = t1.len, .fg_ptr = null, .bg_ptr = null, .attributes = 0 },
                .{ .text_ptr = t2.ptr, .text_len = t2.len, .fg_ptr = rgbaToPtr(&identifier_color), .bg_ptr = null, .attributes = 0 },
                .{ .text_ptr = t3.ptr, .text_len = t3.len, .fg_ptr = null, .bg_ptr = null, .attributes = 0 },
                .{ .text_ptr = t4.ptr, .text_len = t4.len, .fg_ptr = rgbaToPtr(&operator_color), .bg_ptr = null, .attributes = 0 },
                .{ .text_ptr = t5.ptr, .text_len = t5.len, .fg_ptr = null, .bg_ptr = null, .attributes = 0 },
                .{ .text_ptr = t6.ptr, .text_len = t6.len, .fg_ptr = rgbaToPtr(&number_color), .bg_ptr = null, .attributes = 0 },
                .{ .text_ptr = t7.ptr, .text_len = t7.len, .fg_ptr = rgbaToPtr(&operator_color), .bg_ptr = null, .attributes = 0 },
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

    // Large text with many chunks (simplified)
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        const text = "Lorem ipsum ";

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            const tb = try TextBuffer.init(allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
            defer tb.deinit();

            const style = try SyntaxStyle.init(allocator);
            defer style.deinit();
            tb.setSyntaxStyle(style);

            // Just repeat the same chunk 10 times
            const color = [4]f32{ 1.0, 0.5, 0.5, 1.0 };
            const chunks = [_]StyledChunk{
                .{ .text_ptr = text.ptr, .text_len = text.len, .fg_ptr = rgbaToPtr(&color), .bg_ptr = null, .attributes = 0 },
                .{ .text_ptr = text.ptr, .text_len = text.len, .fg_ptr = rgbaToPtr(&color), .bg_ptr = null, .attributes = 0 },
                .{ .text_ptr = text.ptr, .text_len = text.len, .fg_ptr = rgbaToPtr(&color), .bg_ptr = null, .attributes = 0 },
                .{ .text_ptr = text.ptr, .text_len = text.len, .fg_ptr = rgbaToPtr(&color), .bg_ptr = null, .attributes = 0 },
                .{ .text_ptr = text.ptr, .text_len = text.len, .fg_ptr = rgbaToPtr(&color), .bg_ptr = null, .attributes = 0 },
                .{ .text_ptr = text.ptr, .text_len = text.len, .fg_ptr = rgbaToPtr(&color), .bg_ptr = null, .attributes = 0 },
                .{ .text_ptr = text.ptr, .text_len = text.len, .fg_ptr = rgbaToPtr(&color), .bg_ptr = null, .attributes = 0 },
                .{ .text_ptr = text.ptr, .text_len = text.len, .fg_ptr = rgbaToPtr(&color), .bg_ptr = null, .attributes = 0 },
                .{ .text_ptr = text.ptr, .text_len = text.len, .fg_ptr = rgbaToPtr(&color), .bg_ptr = null, .attributes = 0 },
                .{ .text_ptr = text.ptr, .text_len = text.len, .fg_ptr = rgbaToPtr(&color), .bg_ptr = null, .attributes = 0 },
            };

            var timer = try std.time.Timer.start();
            try tb.setStyledText(&chunks);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "setStyledText - 10 chunks (~120 chars total)", .{});
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

            const t0 = "Normal ";
            const t1 = "Bold ";
            const t2 = "Italic ";
            const t3 = "Underline ";
            const t4 = "Bold+Italic ";

            const chunks = [_]StyledChunk{
                .{ .text_ptr = t0.ptr, .text_len = t0.len, .fg_ptr = null, .bg_ptr = null, .attributes = 0 },
                .{ .text_ptr = t1.ptr, .text_len = t1.len, .fg_ptr = null, .bg_ptr = null, .attributes = 1 },
                .{ .text_ptr = t2.ptr, .text_len = t2.len, .fg_ptr = null, .bg_ptr = null, .attributes = 2 },
                .{ .text_ptr = t3.ptr, .text_len = t3.len, .fg_ptr = null, .bg_ptr = null, .attributes = 4 },
                .{ .text_ptr = t4.ptr, .text_len = t4.len, .fg_ptr = null, .bg_ptr = null, .attributes = 3 },
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

fn benchHighlightOperations(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    // Setup global resources
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const global_alloc = arena.allocator();

    const pool = gp.initGlobalPool(global_alloc);
    const unicode_data = gp.initGlobalUnicodeData(global_alloc);
    const graphemes_ptr, const display_width_ptr = unicode_data;

    // Baseline: 1000 sequential addHighlightByCharRange calls (unbatched)
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

            // Create a multi-line buffer
            const text = "Line 1 with some text\nLine 2 with more text\nLine 3 here\nLine 4 content\nLine 5 final";
            try tb.setText(text);

            var timer = try std.time.Timer.start();

            // Add 1000 highlights sequentially
            var i: u32 = 0;
            while (i < 1000) : (i += 1) {
                const start_char = (i * 2) % 50;
                const end_char = start_char + 3;
                const style_id = (i % 5) + 1;
                tb.addHighlightByCharRange(start_char, end_char, style_id, 1, 0) catch {};
            }

            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "addHighlightByCharRange - 1000 calls (unbatched)", .{});
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

    // Batched: 1000 sequential addHighlightByCharRange calls in a transaction
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

            // Create a multi-line buffer
            const text = "Line 1 with some text\nLine 2 with more text\nLine 3 here\nLine 4 content\nLine 5 final";
            try tb.setText(text);

            var timer = try std.time.Timer.start();

            // Batch all highlights in a transaction
            tb.startHighlightsTransaction();
            defer tb.endHighlightsTransaction();

            // Add 1000 highlights sequentially
            var i: u32 = 0;
            while (i < 1000) : (i += 1) {
                const start_char = (i * 2) % 50;
                const end_char = start_char + 3;
                const style_id = (i % 5) + 1;
                tb.addHighlightByCharRange(start_char, end_char, style_id, 1, 0) catch {};
            }

            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "addHighlightByCharRange - 1000 calls (batched)", .{});
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

    // setStyledText with 100 chunks (realistic syntax highlighting scenario)
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        // Build a realistic multi-line code snippet with 100 chunks
        var chunk_list = std.ArrayList(StyledChunk).init(allocator);
        defer chunk_list.deinit();

        const keyword_color = [4]f32{ 0.8, 0.4, 1.0, 1.0 };
        const identifier_color = [4]f32{ 0.7, 0.9, 1.0, 1.0 };
        const operator_color = [4]f32{ 1.0, 1.0, 1.0, 1.0 };
        const number_color = [4]f32{ 0.7, 1.0, 0.7, 1.0 };
        const string_color = [4]f32{ 0.9, 0.8, 0.5, 1.0 };

        // Repeat a pattern to create 100 chunks
        var chunk_idx: usize = 0;
        while (chunk_idx < 10) : (chunk_idx += 1) {
            try chunk_list.append(.{ .text_ptr = "const".ptr, .text_len = 5, .fg_ptr = rgbaToPtr(&keyword_color), .bg_ptr = null, .attributes = 0 });
            try chunk_list.append(.{ .text_ptr = " ".ptr, .text_len = 1, .fg_ptr = null, .bg_ptr = null, .attributes = 0 });
            try chunk_list.append(.{ .text_ptr = "myVar".ptr, .text_len = 5, .fg_ptr = rgbaToPtr(&identifier_color), .bg_ptr = null, .attributes = 0 });
            try chunk_list.append(.{ .text_ptr = " ".ptr, .text_len = 1, .fg_ptr = null, .bg_ptr = null, .attributes = 0 });
            try chunk_list.append(.{ .text_ptr = "=".ptr, .text_len = 1, .fg_ptr = rgbaToPtr(&operator_color), .bg_ptr = null, .attributes = 0 });
            try chunk_list.append(.{ .text_ptr = " ".ptr, .text_len = 1, .fg_ptr = null, .bg_ptr = null, .attributes = 0 });
            try chunk_list.append(.{ .text_ptr = "42".ptr, .text_len = 2, .fg_ptr = rgbaToPtr(&number_color), .bg_ptr = null, .attributes = 0 });
            try chunk_list.append(.{ .text_ptr = ";".ptr, .text_len = 1, .fg_ptr = rgbaToPtr(&operator_color), .bg_ptr = null, .attributes = 0 });
            try chunk_list.append(.{ .text_ptr = "\n".ptr, .text_len = 1, .fg_ptr = null, .bg_ptr = null, .attributes = 0 });
            try chunk_list.append(.{ .text_ptr = "\"str\"".ptr, .text_len = 5, .fg_ptr = rgbaToPtr(&string_color), .bg_ptr = null, .attributes = 0 });
        }

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            const tb = try TextBuffer.init(allocator, pool, .wcwidth, graphemes_ptr, display_width_ptr);
            defer tb.deinit();

            const style = try SyntaxStyle.init(allocator);
            defer style.deinit();
            tb.setSyntaxStyle(style);

            var timer = try std.time.Timer.start();
            try tb.setStyledText(chunk_list.items);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "setStyledText - 100 chunks (realistic code)", .{});
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

    const highlight_results = try benchHighlightOperations(allocator, iterations);
    defer allocator.free(highlight_results);
    try all_results.appendSlice(highlight_results);

    return try all_results.toOwnedSlice();
}
