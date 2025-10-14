const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const rope_mod = @import("../rope.zig");

const BenchResult = bench_utils.BenchResult;
const MemStats = bench_utils.MemStats;

// Test union type with markers (like Segment with .brk)
const Token = union(enum) {
    text: u32, // Text segments (width)
    marker: void, // Line markers

    pub const MarkerTypes = &[_]std.meta.Tag(Token){.marker};

    pub const Metrics = struct {
        width: u32 = 0,

        pub fn add(self: *Metrics, other: Metrics) void {
            self.width += other.width;
        }

        pub fn weight(self: *const Metrics) u32 {
            return self.width;
        }
    };

    pub fn measure(self: *const Token) Metrics {
        return switch (self.*) {
            .text => |w| .{ .width = w },
            .marker => .{ .width = 0 },
        };
    }

    pub fn empty() Token {
        return .{ .text = 0 };
    }

    pub fn is_empty(self: *const Token) bool {
        return switch (self.*) {
            .text => |w| w == 0,
            else => false,
        };
    }
};

const RopeType = rope_mod.Rope(Token);

/// Create a rope with specific marker density
/// marker_every: insert a marker every N text tokens
fn createRope(allocator: std.mem.Allocator, text_count: u32, marker_every: u32) !RopeType {
    var tokens = std.ArrayList(Token).init(allocator);
    defer tokens.deinit();

    var i: u32 = 0;
    while (i < text_count) : (i += 1) {
        try tokens.append(.{ .text = 10 }); // Each text segment has width 10
        if ((i + 1) % marker_every == 0) {
            try tokens.append(.{ .marker = {} });
        }
    }

    return try RopeType.from_slice(allocator, tokens.items);
}

fn benchRebuildMarkerIndex(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    // Small rope, high marker density (every 10 tokens)
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try createRope(arena.allocator(), 1000, 10);
            var timer = try std.time.Timer.start();
            try rope.rebuildMarkerIndex();
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Rebuild index: 1k tokens, marker every 10 (~100 markers)", .{});
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

    // Small rope, low marker density (every 100 tokens)
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try createRope(arena.allocator(), 1000, 100);
            var timer = try std.time.Timer.start();
            try rope.rebuildMarkerIndex();
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Rebuild index: 1k tokens, marker every 100 (~10 markers)", .{});
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

    // Medium rope, high marker density
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try createRope(arena.allocator(), 10000, 10);
            var timer = try std.time.Timer.start();
            try rope.rebuildMarkerIndex();
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Rebuild index: 10k tokens, marker every 10 (~1k markers)", .{});
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

    // Medium rope, low marker density
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try createRope(arena.allocator(), 10000, 100);
            var timer = try std.time.Timer.start();
            try rope.rebuildMarkerIndex();
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Rebuild index: 10k tokens, marker every 100 (~100 markers)", .{});
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

    // Large rope, text-editor-like density (marker every 50 = ~50 chars/line)
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try createRope(arena.allocator(), 50000, 50);
            var timer = try std.time.Timer.start();
            try rope.rebuildMarkerIndex();
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Rebuild index: 50k tokens, marker every 50 (~1k markers, text-editor-like)", .{});
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

    // Very large rope, sparse markers
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try createRope(arena.allocator(), 100000, 200);
            var timer = try std.time.Timer.start();
            try rope.rebuildMarkerIndex();
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Rebuild index: 100k tokens, marker every 200 (~500 markers)", .{});
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

fn benchMarkerLookup(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    // O(1) lookup in small rope
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try createRope(arena.allocator(), 1000, 10);
            try rope.rebuildMarkerIndex();

            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 100) : (i += 1) {
                _ = rope.getMarker(.marker, i % rope.markerCount(.marker));
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "O(1) lookup: 100 random marker accesses, ~100 markers", .{});
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

    // O(1) lookup in medium rope
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try createRope(arena.allocator(), 10000, 50);
            try rope.rebuildMarkerIndex();

            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 1000) : (i += 1) {
                _ = rope.getMarker(.marker, i % rope.markerCount(.marker));
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "O(1) lookup: 1k random marker accesses, ~200 markers", .{});
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

    // O(1) lookup in large rope (text-editor scenario)
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try createRope(arena.allocator(), 50000, 50);
            try rope.rebuildMarkerIndex();
            const marker_count = rope.markerCount(.marker);

            var prng = std.Random.DefaultPrng.init(42);
            const random = prng.random();

            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 10000) : (i += 1) {
                const line = random.intRangeAtMost(u32, 0, marker_count - 1);
                _ = rope.getMarker(.marker, line);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "O(1) lookup: 10k random line jumps, ~1k lines (text-editor)", .{});
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

    // Sequential marker access (best case)
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try createRope(arena.allocator(), 10000, 50);
            try rope.rebuildMarkerIndex();
            const marker_count = rope.markerCount(.marker);

            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < marker_count) : (i += 1) {
                _ = rope.getMarker(.marker, i);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "O(1) lookup: Sequential access to all ~200 markers", .{});
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

fn benchMarkerCount(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    // Count markers - should be O(1) hash lookup
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try createRope(arena.allocator(), 10000, 50);
            try rope.rebuildMarkerIndex();

            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 100000) : (i += 1) {
                _ = rope.markerCount(.marker);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "markerCount: 100k calls (should be ~O(1))", .{});
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

fn benchDepthVsPerformance(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    // Shallow tree (from_slice creates balanced tree)
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try createRope(arena.allocator(), 10000, 50);
            var timer = try std.time.Timer.start();
            try rope.rebuildMarkerIndex();
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Rebuild on BALANCED tree: 10k tokens, ~200 markers", .{});
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

    // Deep tree (built by sequential appends)
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            // Build unbalanced tree through sequential operations
            var rope = try RopeType.init(arena.allocator());
            var i: u32 = 0;
            while (i < 10000) : (i += 1) {
                try rope.append(.{ .text = 10 });
                if ((i + 1) % 50 == 0) {
                    try rope.append(.{ .marker = {} });
                }
            }

            var timer = try std.time.Timer.start();
            try rope.rebuildMarkerIndex();
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Rebuild on UNBALANCED tree: 10k tokens, ~200 markers", .{});
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

fn benchEditThenRebuild(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    // Typical edit workflow: build, edit, rebuild
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try createRope(arena.allocator(), 10000, 50);
            try rope.rebuildMarkerIndex();

            var timer = try std.time.Timer.start();
            // Simulate typing at line 50
            const line50_marker = rope.getMarker(.marker, 50).?;
            const insert_pos = line50_marker.leaf_index + 1;

            // Insert some text
            try rope.insert(insert_pos, .{ .text = 10 });
            try rope.insert(insert_pos + 1, .{ .text = 10 });
            try rope.insert(insert_pos + 2, .{ .text = 10 });

            // Rebuild index after edit
            try rope.rebuildMarkerIndex();
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Edit workflow: 3 inserts + rebuild (~200 markers)", .{});
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

    // Insert new line (adds marker)
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try createRope(arena.allocator(), 10000, 50);
            try rope.rebuildMarkerIndex();

            var timer = try std.time.Timer.start();
            // Insert new line (marker) at position 100
            try rope.insert(100, .{ .marker = {} });
            try rope.rebuildMarkerIndex();
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Insert newline: insert marker + rebuild (~200 markers)", .{});
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

    // Delete line (removes marker)
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try createRope(arena.allocator(), 10000, 50);
            try rope.rebuildMarkerIndex();

            var timer = try std.time.Timer.start();
            // Delete marker at position
            const marker_pos = rope.getMarker(.marker, 50).?.leaf_index;
            try rope.delete(marker_pos);
            try rope.rebuildMarkerIndex();
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Delete line: remove marker + rebuild (~200 markers)", .{});
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

fn benchMemoryUsage(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    // Memory comparison: with vs without marker index
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            const rope = try createRope(arena.allocator(), 50000, 50);
            // Don't rebuild index - just measure rope creation
            _ = rope;

            const elapsed: u64 = 0; // Placeholder for memory measurement

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Memory: 50k tokens WITHOUT marker index", .{});
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

    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try createRope(arena.allocator(), 50000, 50);
            try rope.rebuildMarkerIndex();

            const elapsed: u64 = 0; // Placeholder for memory measurement

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Memory: 50k tokens WITH marker index (~1k markers)", .{});
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

    const iterations: usize = 10;

    // Rebuild index benchmarks
    const rebuild_results = try benchRebuildMarkerIndex(allocator, iterations);
    defer allocator.free(rebuild_results);
    try all_results.appendSlice(rebuild_results);

    // Marker lookup benchmarks
    const lookup_results = try benchMarkerLookup(allocator, iterations);
    defer allocator.free(lookup_results);
    try all_results.appendSlice(lookup_results);

    // Marker count benchmarks
    const count_results = try benchMarkerCount(allocator, iterations);
    defer allocator.free(count_results);
    try all_results.appendSlice(count_results);

    // Tree depth impact
    const depth_results = try benchDepthVsPerformance(allocator, iterations);
    defer allocator.free(depth_results);
    try all_results.appendSlice(depth_results);

    // Edit workflows
    const edit_results = try benchEditThenRebuild(allocator, iterations);
    defer allocator.free(edit_results);
    try all_results.appendSlice(edit_results);

    // Memory usage comparison
    const memory_results = try benchMemoryUsage(allocator, iterations);
    defer allocator.free(memory_results);
    try all_results.appendSlice(memory_results);

    return try all_results.toOwnedSlice();
}
