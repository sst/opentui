// Benchmark Runner CLI
//
// This is the main entry point for running performance benchmarks for opentui core components.
//
// Usage:
//   zig build bench              - Run all benchmarks
//   zig build bench -- --help    - Show help message with available options
//
// Options:
//   --mem              Show memory statistics after each benchmark
//   --filter, -f NAME  Run only benchmarks matching NAME (case-insensitive substring match)
//   --help, -h         Display help message and list available benchmarks
//
// Examples:
//   zig build bench -- --mem
//     Run all benchmarks with memory statistics
//
//   zig build bench -- --filter rope
//     Run only benchmarks with "rope" in their name (Rope Data Structure, Rope Marker Tracking)
//
//   zig build bench -- -f textbuffer --mem
//     Run TextBuffer benchmarks with memory statistics
//
//   zig build bench -- --filter "edit"
//     Run EditBuffer Operations benchmarks
//
// Available Benchmarks:
//   - TextBuffer: TextBuffer creation and text wrapping operations
//   - EditBuffer Operations: Insert, delete, and mixed editing operations
//   - Rope Data Structure: Rope insert, delete, bulk operations, and access patterns
//   - Rope Marker Tracking: Marker index rebuild and lookup performance
//   - TextBuffer Coordinate Conversion: Coordinate/offset conversion and line counting
//
// Adding New Benchmarks:
//   1. Create a new file in bench/ directory (e.g., bench/my_bench.zig)
//   2. Export `pub const benchName = "My Benchmark";`
//   3. Export `pub fn run(allocator: std.mem.Allocator, show_mem: bool) ![]BenchResult`
//   4. Import the module here and add it to the benchmark list in main()

const std = @import("std");
const bench_utils = @import("bench-utils.zig");
const gp = @import("grapheme.zig");

// Import all benchmark modules
const text_buffer_view_bench = @import("bench/text-buffer-view_bench.zig");
const edit_buffer_bench = @import("bench/edit-buffer_bench.zig");
const rope_bench = @import("bench/rope_bench.zig");
const rope_markers_bench = @import("bench/rope-markers_bench.zig");
const text_buffer_coords_bench = @import("bench/text-buffer-coords_bench.zig");
const styled_text_bench = @import("bench/styled-text_bench.zig");
const buffer_draw_text_buffer_bench = @import("bench/buffer-draw-text-buffer_bench.zig");

fn matchesFilter(bench_name: []const u8, filter: ?[]const u8) bool {
    if (filter == null) return true;
    const filter_str = filter.?;
    if (filter_str.len == 0) return true;

    // Case-insensitive substring match
    var i: usize = 0;
    while (i + filter_str.len <= bench_name.len) : (i += 1) {
        var matches = true;
        for (filter_str, 0..) |filter_char, j| {
            const bench_char = bench_name[i + j];
            const filter_lower = if (filter_char >= 'A' and filter_char <= 'Z') filter_char + 32 else filter_char;
            const bench_lower = if (bench_char >= 'A' and bench_char <= 'Z') bench_char + 32 else bench_char;
            if (filter_lower != bench_lower) {
                matches = false;
                break;
            }
        }
        if (matches) return true;
    }
    return false;
}

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    // Initialize global pool and unicode data ONCE with base GPA allocator
    // This ensures they persist across all benchmarks (even with arena allocators)
    _ = gp.initGlobalPool(allocator);
    defer gp.deinitGlobalPool();

    _ = gp.initGlobalUnicodeData(allocator);
    defer gp.deinitGlobalUnicodeData(allocator);

    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);

    var show_mem = false;
    var filter: ?[]const u8 = null;
    var i: usize = 1;
    while (i < args.len) : (i += 1) {
        const arg = args[i];
        if (std.mem.eql(u8, arg, "--mem")) {
            show_mem = true;
        } else if (std.mem.eql(u8, arg, "--filter") or std.mem.eql(u8, arg, "-f")) {
            if (i + 1 < args.len) {
                i += 1;
                filter = args[i];
            }
        } else if (std.mem.eql(u8, arg, "--help") or std.mem.eql(u8, arg, "-h")) {
            const stdout = std.io.getStdOut().writer();
            try stdout.print("Usage: bench [options]\n\n", .{});
            try stdout.print("Options:\n", .{});
            try stdout.print("  --mem              Show memory statistics\n", .{});
            try stdout.print("  --filter, -f NAME  Run only benchmarks matching NAME (case-insensitive substring)\n", .{});
            try stdout.print("  --help, -h         Show this help message\n\n", .{});
            try stdout.print("Available benchmarks:\n", .{});
            try stdout.print("  - {s}\n", .{text_buffer_view_bench.benchName});
            try stdout.print("  - {s}\n", .{edit_buffer_bench.benchName});
            try stdout.print("  - {s}\n", .{rope_bench.benchName});
            try stdout.print("  - {s}\n", .{rope_markers_bench.benchName});
            try stdout.print("  - {s}\n", .{text_buffer_coords_bench.benchName});
            try stdout.print("  - {s}\n", .{styled_text_bench.benchName});
            try stdout.print("  - {s}\n", .{buffer_draw_text_buffer_bench.benchName});
            return;
        }
    }

    const stdout = std.io.getStdOut().writer();

    if (filter) |f| {
        try stdout.print("Filtering benchmarks by: \"{s}\"\n", .{f});
    }

    var ran_any = false;

    // Run benchmarks (each with isolated arena allocator)
    if (matchesFilter(text_buffer_view_bench.benchName, filter)) {
        try stdout.print("\n=== {s} Benchmarks ===\n\n", .{text_buffer_view_bench.benchName});
        var arena = std.heap.ArenaAllocator.init(allocator);
        defer arena.deinit();
        const arena_allocator = arena.allocator();
        const text_buffer_view_results = try text_buffer_view_bench.run(arena_allocator, show_mem);
        try bench_utils.printResults(stdout, text_buffer_view_results);
        ran_any = true;
    }

    if (matchesFilter(edit_buffer_bench.benchName, filter)) {
        try stdout.print("\n=== {s} Benchmarks ===\n\n", .{edit_buffer_bench.benchName});
        var arena = std.heap.ArenaAllocator.init(allocator);
        defer arena.deinit();
        const arena_allocator = arena.allocator();
        const edit_buffer_results = try edit_buffer_bench.run(arena_allocator, show_mem);
        try bench_utils.printResults(stdout, edit_buffer_results);
        ran_any = true;
    }

    if (matchesFilter(rope_bench.benchName, filter)) {
        try stdout.print("\n=== {s} Benchmarks ===\n\n", .{rope_bench.benchName});
        var arena = std.heap.ArenaAllocator.init(allocator);
        defer arena.deinit();
        const arena_allocator = arena.allocator();
        const rope_results = try rope_bench.run(arena_allocator, show_mem);
        try bench_utils.printResults(stdout, rope_results);
        ran_any = true;
    }

    if (matchesFilter(rope_markers_bench.benchName, filter)) {
        try stdout.print("\n=== {s} Benchmarks ===\n\n", .{rope_markers_bench.benchName});
        var arena = std.heap.ArenaAllocator.init(allocator);
        defer arena.deinit();
        const arena_allocator = arena.allocator();
        const rope_markers_results = try rope_markers_bench.run(arena_allocator, show_mem);
        try bench_utils.printResults(stdout, rope_markers_results);
        ran_any = true;
    }

    if (matchesFilter(text_buffer_coords_bench.benchName, filter)) {
        try stdout.print("\n=== {s} Benchmarks ===\n\n", .{text_buffer_coords_bench.benchName});
        var arena = std.heap.ArenaAllocator.init(allocator);
        defer arena.deinit();
        const arena_allocator = arena.allocator();
        const coords_results = try text_buffer_coords_bench.run(arena_allocator, show_mem);
        try bench_utils.printResults(stdout, coords_results);
        ran_any = true;
    }

    if (matchesFilter(styled_text_bench.benchName, filter)) {
        try stdout.print("\n=== {s} Benchmarks ===\n\n", .{styled_text_bench.benchName});
        var arena = std.heap.ArenaAllocator.init(allocator);
        defer arena.deinit();
        const arena_allocator = arena.allocator();
        const styled_text_results = try styled_text_bench.run(arena_allocator, show_mem);
        try bench_utils.printResults(stdout, styled_text_results);
        ran_any = true;
    }

    if (matchesFilter(buffer_draw_text_buffer_bench.benchName, filter)) {
        try stdout.print("\n=== {s} Benchmarks ===\n\n", .{buffer_draw_text_buffer_bench.benchName});
        var arena = std.heap.ArenaAllocator.init(allocator);
        defer arena.deinit();
        const arena_allocator = arena.allocator();
        const buffer_draw_results = try buffer_draw_text_buffer_bench.run(arena_allocator, show_mem);
        try bench_utils.printResults(stdout, buffer_draw_results);
        ran_any = true;
    }

    if (!ran_any) {
        try stdout.print("\nNo benchmarks matched filter: \"{s}\"\n", .{filter.?});
        try stdout.print("Use --help to see available benchmarks.\n", .{});
        return;
    }

    try stdout.print("\n✓ Benchmarks complete\n", .{});
}
