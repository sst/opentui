const std = @import("std");
const gp = @import("grapheme.zig");
const tbv_bench = @import("bench/text-buffer-view_bench.zig");

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);

    var show_mem = false;
    for (args[1..]) |arg| {
        if (std.mem.eql(u8, arg, "--mem")) {
            show_mem = true;
        }
    }

    const pool = gp.initGlobalPool(allocator);
    defer gp.deinitGlobalPool();

    const unicode_data = gp.initGlobalUnicodeData(allocator);
    defer gp.deinitGlobalUnicodeData(allocator);
    const graphemes_ptr, const display_width_ptr = unicode_data;

    const stdout = std.io.getStdOut().writer();

    try stdout.print("\n=== TextBufferView Wrapping Benchmarks ===\n\n", .{});

    const text = try tbv_bench.generateLargeText(allocator, 5000, 2 * 1024 * 1024);
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
        try stdout.print("Memory stats enabled (--mem)\n", .{});
    }
    try stdout.print("\n", .{});

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
            @import("text-buffer.zig").WrapMode.char
        else
            @import("text-buffer.zig").WrapMode.word;

        const bench_name = try std.fmt.allocPrint(allocator, "TextBufferView wrap ({s}, {s}, width={d})", .{
            scenario.impl,
            scenario.mode,
            scenario.width,
        });
        defer allocator.free(bench_name);

        if (std.mem.eql(u8, scenario.impl, "Array")) {
            const bench_data = try tbv_bench.benchWrapArray(
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

            try tbv_bench.printBenchResult(stdout, bench_name, bench_data.result, bench_data.mem);
        } else {
            const bench_data = try tbv_bench.benchWrapRope(
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

            try tbv_bench.printBenchResult(stdout, bench_name, bench_data.result, bench_data.mem);
        }
    }

    try stdout.print("\n=== Benchmarks complete ===\n", .{});
}
