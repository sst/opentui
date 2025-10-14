const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const edit_buffer = @import("../edit-buffer.zig");
const gp = @import("../grapheme.zig");
const gwidth = @import("../gwidth.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");

const EditBuffer = edit_buffer.EditBuffer;
const BenchResult = bench_utils.BenchResult;
const MemStat = bench_utils.MemStat;

fn benchInsertOperations(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    graphemes_ptr: *Graphemes,
    display_width_ptr: *DisplayWidth,
    iterations: usize,
    show_mem: bool,
) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    // Single-line insert at start
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;
        var final_mem: usize = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var eb = try EditBuffer.init(allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
            defer eb.deinit();

            const text = "Hello, world! ";
            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 1000) : (i += 1) {
                try eb.insertText(text);
                try eb.setCursor(0, 0);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;

            if (iter == iterations - 1 and show_mem) {
                final_mem = eb.getTextBuffer().getArenaAllocatedBytes();
            }
        }

        const name = try std.fmt.allocPrint(allocator, "EditBuffer insert 1k times at start", .{});
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

    // Multi-line insert
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;
        var final_mem: usize = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var eb = try EditBuffer.init(allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
            defer eb.deinit();

            const text = "Line 1\nLine 2\nLine 3\n";
            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 500) : (i += 1) {
                try eb.insertText(text);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;

            if (iter == iterations - 1 and show_mem) {
                final_mem = eb.getTextBuffer().getArenaAllocatedBytes();
            }
        }

        const name = try std.fmt.allocPrint(allocator, "EditBuffer insert 500 multi-line blocks", .{});
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

fn benchDeleteOperations(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    graphemes_ptr: *Graphemes,
    display_width_ptr: *DisplayWidth,
    iterations: usize,
    show_mem: bool,
) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    // Single-line delete with backspace
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;
        var final_mem: usize = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var eb = try EditBuffer.init(allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
            defer eb.deinit();

            // Build up text
            const text = "Hello, world! ";
            var i: u32 = 0;
            while (i < 1000) : (i += 1) {
                try eb.insertText(text);
            }

            var timer = try std.time.Timer.start();
            i = 0;
            while (i < 500) : (i += 1) {
                try eb.backspace();
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;

            if (iter == iterations - 1 and show_mem) {
                final_mem = eb.getTextBuffer().getArenaAllocatedBytes();
            }
        }

        const name = try std.fmt.allocPrint(allocator, "EditBuffer backspace 500 chars", .{});
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

    // Multi-line delete range
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;
        var final_mem: usize = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var eb = try EditBuffer.init(allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
            defer eb.deinit();

            // Build up text with many lines
            const text = "Line 1\nLine 2\nLine 3\n";
            var i: u32 = 0;
            while (i < 100) : (i += 1) {
                try eb.insertText(text);
            }

            var timer = try std.time.Timer.start();
            // Delete across 50 lines
            try eb.deleteRange(.{ .row = 10, .col = 0 }, .{ .row = 60, .col = 0 });
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;

            if (iter == iterations - 1 and show_mem) {
                final_mem = eb.getTextBuffer().getArenaAllocatedBytes();
            }
        }

        const name = try std.fmt.allocPrint(allocator, "EditBuffer delete 50-line range", .{});
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

fn benchMixedOperations(
    allocator: std.mem.Allocator,
    pool: *gp.GraphemePool,
    graphemes_ptr: *Graphemes,
    display_width_ptr: *DisplayWidth,
    iterations: usize,
    show_mem: bool,
) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    // Simulated typing session
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;
        var final_mem: usize = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var eb = try EditBuffer.init(allocator, pool, .unicode, graphemes_ptr, display_width_ptr);
            defer eb.deinit();

            var timer = try std.time.Timer.start();

            // Type some text
            var i: u32 = 0;
            while (i < 100) : (i += 1) {
                try eb.insertText("function test() {\n");
                try eb.insertText("    return 42;\n");
                try eb.insertText("}\n");
            }

            // Navigate and edit
            try eb.setCursor(50, 0);
            try eb.insertText("// Comment\n");

            // Delete a range
            try eb.deleteRange(.{ .row = 100, .col = 0 }, .{ .row = 120, .col = 0 });

            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;

            if (iter == iterations - 1 and show_mem) {
                final_mem = eb.getTextBuffer().getArenaAllocatedBytes();
            }
        }

        const name = try std.fmt.allocPrint(allocator, "EditBuffer mixed operations (300 lines)", .{});
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

    const iterations: usize = 5;

    // Run all benchmark categories
    const insert_results = try benchInsertOperations(allocator, pool, graphemes_ptr, display_width_ptr, iterations, show_mem);
    defer allocator.free(insert_results);
    try all_results.appendSlice(insert_results);

    const delete_results = try benchDeleteOperations(allocator, pool, graphemes_ptr, display_width_ptr, iterations, show_mem);
    defer allocator.free(delete_results);
    try all_results.appendSlice(delete_results);

    const mixed_results = try benchMixedOperations(allocator, pool, graphemes_ptr, display_width_ptr, iterations, show_mem);
    defer allocator.free(mixed_results);
    try all_results.appendSlice(mixed_results);

    return try all_results.toOwnedSlice();
}
