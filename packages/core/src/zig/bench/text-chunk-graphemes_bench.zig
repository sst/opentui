const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const seg_mod = @import("../text-buffer-segment.zig");
const mem_registry_mod = @import("../mem-registry.zig");
const gp = @import("../grapheme.zig");
const utf8 = @import("../utf8.zig");

const TextChunk = seg_mod.TextChunk;
const MemRegistry = mem_registry_mod.MemRegistry;
const BenchResult = bench_utils.BenchResult;
const MemStat = bench_utils.MemStat;

pub const benchName = "TextChunk getGraphemes";

const TextType = enum { ascii, mixed, heavy_unicode };

fn generateTestText(allocator: std.mem.Allocator, size: usize, text_type: TextType) ![]u8 {
    var buffer = std.ArrayList(u8).init(allocator);
    errdefer buffer.deinit();

    switch (text_type) {
        .ascii => {
            // Pure ASCII text with tabs
            const patterns = [_][]const u8{
                "The quick brown fox jumps over the lazy dog. ",
                "Lorem ipsum dolor sit amet, consectetur elit. ",
                "function test() {\n\tconst x = 10;\n\treturn x;\n}\n",
                "Programming: Rust, Zig, Go, Python, JavaScript. ",
            };
            var pos: usize = 0;
            while (pos < size) {
                const pattern = patterns[pos % patterns.len];
                const to_add = @min(pattern.len, size - pos);
                try buffer.appendSlice(pattern[0..to_add]);
                pos += to_add;
            }
        },
        .mixed => {
            // Mix of ASCII and Unicode (realistic code/text)
            const patterns = [_][]const u8{
                "Hello, 世界! Unicode test. ",
                "Mixed: ASCII 中文 emoji 🌍 text. ",
                "Code: const x = 10; // comment\n",
                "Αυτό είναι ελληνικό. Это русский. ",
                "Numbers: 12345 symbols: !@#$% ",
                "\tTab\tseparated\tvalues\there. ",
            };
            var pos: usize = 0;
            while (pos < size) {
                const pattern = patterns[pos % patterns.len];
                const to_add = @min(pattern.len, size - pos);
                try buffer.appendSlice(pattern[0..to_add]);
                pos += to_add;
            }
        },
        .heavy_unicode => {
            // Heavy Unicode with emojis, combining marks, and wide chars
            const patterns = [_][]const u8{
                "世界中文字符測試文本。",
                "こんにちは、日本語テキスト。",
                "🌍🎉🚀🔥💻✨🌟⭐",
                "👋🏿👩‍🚀🇺🇸❤️",
                "café\u{0301} naïve résumé",
                "Ελληνικά Русский العربية",
            };
            var pos: usize = 0;
            while (pos < size) {
                const pattern = patterns[pos % patterns.len];
                const to_add = @min(pattern.len, size - pos);
                try buffer.appendSlice(pattern[0..to_add]);
                pos += to_add;
            }
        },
    }

    return try buffer.toOwnedSlice();
}

fn benchGetGraphemes(
    allocator: std.mem.Allocator,
    size: usize,
    text_type: TextType,
    iterations: usize,
    show_mem: bool,
) !BenchResult {
    // Generate test text
    const text = try generateTestText(allocator, size, text_type);
    defer allocator.free(text);

    // Create memory registry
    var registry = MemRegistry.init(allocator);
    defer registry.deinit();

    const mem_id = try registry.register(text, false);

    // Determine if ASCII-only
    const is_ascii = switch (text_type) {
        .ascii => true,
        else => false,
    };

    // Create TextChunk
    // Width is approximate - clamped to u16 max
    const approx_width: u16 = @intCast(@min(text.len, std.math.maxInt(u16)));
    var chunk = TextChunk{
        .mem_id = mem_id,
        .byte_start = 0,
        .byte_end = @intCast(text.len),
        .width = approx_width,
        .flags = if (is_ascii) TextChunk.Flags.ASCII_ONLY else 0,
    };

    var min_ns: u64 = std.math.maxInt(u64);
    var max_ns: u64 = 0;
    var total_ns: u64 = 0;
    var grapheme_count: usize = 0;
    var final_mem: usize = 0;

    var i: usize = 0;
    while (i < iterations) : (i += 1) {
        // Create a fresh arena for each iteration
        var arena = std.heap.ArenaAllocator.init(allocator);
        defer arena.deinit();
        const arena_alloc = arena.allocator();

        // Clear cached graphemes
        chunk.graphemes = null;

        var timer = try std.time.Timer.start();
        const graphemes = try chunk.getGraphemes(
            &registry,
            arena_alloc,
            4, // tab width
            .unicode,
        );
        const elapsed = timer.read();

        min_ns = @min(min_ns, elapsed);
        max_ns = @max(max_ns, elapsed);
        total_ns += elapsed;

        if (i == 0) {
            grapheme_count = graphemes.len;
        }

        if (i == iterations - 1 and show_mem) {
            // Estimate memory used for grapheme storage
            final_mem = graphemes.len * @sizeOf(seg_mod.GraphemeInfo);
        }
    }

    const type_str = switch (text_type) {
        .ascii => "ASCII",
        .mixed => "Mixed",
        .heavy_unicode => "Heavy Unicode",
    };

    const name = try std.fmt.allocPrint(
        allocator,
        "getGraphemes {s} ({d} bytes, {d} graphemes)",
        .{ type_str, size, grapheme_count },
    );

    const mem_stats: ?[]const MemStat = if (show_mem) blk: {
        const stats = try allocator.alloc(MemStat, 1);
        stats[0] = .{ .name = "Graphemes", .bytes = final_mem };
        break :blk stats;
    } else null;

    return BenchResult{
        .name = name,
        .min_ns = min_ns,
        .avg_ns = total_ns / iterations,
        .max_ns = max_ns,
        .total_ns = total_ns,
        .iterations = iterations,
        .mem_stats = mem_stats,
    };
}

pub fn run(
    allocator: std.mem.Allocator,
    show_mem: bool,
) ![]BenchResult {
    const stdout = std.io.getStdOut().writer();

    // Global pool and unicode data are initialized once in bench.zig
    const pool = gp.initGlobalPool(allocator);

    if (show_mem) {
        try stdout.print("Memory stats enabled\n", .{});
    }
    try stdout.print("\n", .{});

    var results = std.ArrayList(BenchResult).init(allocator);

    const iterations: usize = 100;

    // Test different chunk sizes: 100B, 1KB, 4KB, 16KB, 64KB
    const sizes = [_]usize{ 100, 1024, 4 * 1024, 16 * 1024, 64 * 1024 };
    const text_types = [_]TextType{ .ascii, .mixed, .heavy_unicode };

    _ = pool; // unused

    try stdout.print("Testing chunk sizes: ", .{});
    for (sizes) |size| {
        const kb = @as(f64, @floatFromInt(size)) / 1024.0;
        try stdout.print("{d:.1}KB ", .{kb});
    }
    try stdout.print("\n\n", .{});

    for (text_types) |text_type| {
        for (sizes) |size| {
            const result = try benchGetGraphemes(
                allocator,
                size,
                text_type,
                iterations,
                show_mem,
            );
            try results.append(result);
        }
    }

    return try results.toOwnedSlice();
}
