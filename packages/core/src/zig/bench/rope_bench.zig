const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const rope_mod = @import("../rope.zig");

const BenchResult = bench_utils.BenchResult;
const BenchStats = bench_utils.BenchStats;

pub const benchName = "Rope Data Structure";

// Simple test item type
const TestItem = struct {
    value: u32,

    pub fn empty() TestItem {
        return .{ .value = 0 };
    }

    pub fn is_empty(self: *const TestItem) bool {
        return self.value == 0;
    }
};

const RopeType = rope_mod.Rope(TestItem);

fn benchInsertOperations(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(allocator);

    // Sequential appends
    {
        var stats = BenchStats{};
        for (0..iterations) |_| {
            var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
            defer arena.deinit();

            var rope = try RopeType.init(arena.allocator());
            var timer = try std.time.Timer.start();
            for (0..10000) |i| {
                try rope.append(.{ .value = @intCast(i) });
            }
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = "Rope sequential append 10k items",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Sequential prepends
    {
        var stats = BenchStats{};
        for (0..iterations) |_| {
            var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
            defer arena.deinit();

            var rope = try RopeType.init(arena.allocator());
            var timer = try std.time.Timer.start();
            for (0..10000) |i| {
                try rope.prepend(.{ .value = @intCast(i) });
            }
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = "Rope sequential prepend 10k items",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Random inserts
    {
        var stats = BenchStats{};
        for (0..iterations) |_| {
            var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
            defer arena.deinit();

            var rope = try RopeType.init(arena.allocator());
            var prng = std.Random.DefaultPrng.init(42);
            const random = prng.random();
            var timer = try std.time.Timer.start();
            for (0..5000) |i| {
                const pos = if (rope.count() > 0)
                    random.intRangeAtMost(u32, 0, rope.count())
                else
                    0;
                try rope.insert(pos, .{ .value = @intCast(i) });
            }
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = "Rope random insert 5k items",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return results.toOwnedSlice(allocator);
}

fn benchDeleteOperations(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(allocator);

    var items: [10000]TestItem = undefined;
    for (&items, 0..) |*item, i| {
        item.* = .{ .value = @intCast(i) };
    }

    // Sequential deletes from end
    {
        var stats = BenchStats{};
        for (0..iterations) |_| {
            var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
            defer arena.deinit();

            var rope = try RopeType.from_slice(arena.allocator(), &items);
            var timer = try std.time.Timer.start();
            for (0..5000) |_| {
                try rope.delete(rope.count() - 1);
            }
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = "Rope sequential delete 5k from end",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Sequential deletes from beginning
    {
        var stats = BenchStats{};
        for (0..iterations) |_| {
            var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
            defer arena.deinit();

            var rope = try RopeType.from_slice(arena.allocator(), &items);
            var timer = try std.time.Timer.start();
            for (0..5000) |_| {
                try rope.delete(0);
            }
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = "Rope sequential delete 5k from beginning",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Random deletes
    {
        var stats = BenchStats{};
        for (0..iterations) |_| {
            var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
            defer arena.deinit();

            var rope = try RopeType.from_slice(arena.allocator(), &items);
            var prng = std.Random.DefaultPrng.init(42);
            const random = prng.random();
            var timer = try std.time.Timer.start();
            for (0..5000) |_| {
                const pos = random.intRangeAtMost(u32, 0, rope.count() - 1);
                try rope.delete(pos);
            }
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = "Rope random delete 5k items",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return results.toOwnedSlice(allocator);
}

fn benchBulkOperations(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(allocator);

    var items: [10000]TestItem = undefined;
    for (&items, 0..) |*item, i| {
        item.* = .{ .value = @intCast(i) };
    }

    // insert_slice
    {
        var stats = BenchStats{};
        for (0..iterations) |_| {
            var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
            defer arena.deinit();

            var rope = try RopeType.init(arena.allocator());
            var chunk: [1000]TestItem = undefined;
            for (&chunk, 0..) |*item, i| {
                item.* = .{ .value = @intCast(i) };
            }
            var timer = try std.time.Timer.start();
            for (0..10) |_| {
                try rope.insert_slice(rope.count(), &chunk);
            }
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = "Rope insert_slice 10x1k items",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // delete_range
    {
        var stats = BenchStats{};
        for (0..iterations) |_| {
            var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
            defer arena.deinit();

            var rope = try RopeType.from_slice(arena.allocator(), &items);
            var timer = try std.time.Timer.start();
            for (0..10) |_| {
                const start = if (rope.count() > 500) rope.count() - 500 else 0;
                const end = rope.count();
                try rope.delete_range(start, end);
            }
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = "Rope delete_range 10x500 items",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // split/concat
    {
        var stats = BenchStats{};
        for (0..iterations) |_| {
            var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
            defer arena.deinit();

            var rope = try RopeType.from_slice(arena.allocator(), &items);
            var timer = try std.time.Timer.start();
            for (0..100) |_| {
                const mid = rope.count() / 2;
                var right = try rope.split(mid);
                try rope.concat(&right);
            }
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = "Rope split/concat 100 cycles at midpoint",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // concat two ropes
    {
        var stats = BenchStats{};
        for (0..iterations) |_| {
            var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
            defer arena.deinit();

            var rope1 = try RopeType.from_slice(arena.allocator(), items[0..5000]);
            const rope2 = try RopeType.from_slice(arena.allocator(), items[5000..]);
            var timer = try std.time.Timer.start();
            try rope1.concat(&rope2);
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = "Rope concat two 5k-item ropes",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return results.toOwnedSlice(allocator);
}

fn benchAccessPatterns(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer results.deinit(allocator);

    var items: [10000]TestItem = undefined;
    for (&items, 0..) |*item, i| {
        item.* = .{ .value = @intCast(i) };
    }

    // Sequential get
    {
        var stats = BenchStats{};
        for (0..iterations) |_| {
            var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
            defer arena.deinit();

            const rope = try RopeType.from_slice(arena.allocator(), &items);
            var timer = try std.time.Timer.start();
            for (0..10000) |i| {
                _ = rope.get(@intCast(i));
            }
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = "Rope sequential get all 10k items",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Random get
    {
        var stats = BenchStats{};
        for (0..iterations) |_| {
            var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
            defer arena.deinit();

            const rope = try RopeType.from_slice(arena.allocator(), &items);
            var prng = std.Random.DefaultPrng.init(42);
            const random = prng.random();
            var timer = try std.time.Timer.start();
            for (0..10000) |_| {
                const pos = random.intRangeAtMost(u32, 0, 9999);
                _ = rope.get(pos);
            }
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = "Rope random get 10k accesses",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Walk
    {
        var stats = BenchStats{};
        for (0..iterations) |_| {
            var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
            defer arena.deinit();

            const rope = try RopeType.from_slice(arena.allocator(), &items);
            const Ctx = struct {
                sum: u64 = 0,
                fn walker(ctx: *anyopaque, data: *const TestItem, index: u32) RopeType.Node.WalkerResult {
                    _ = index;
                    const self = @as(*@This(), @ptrCast(@alignCast(ctx)));
                    self.sum += data.value;
                    return .{};
                }
            };
            var ctx = Ctx{};
            var timer = try std.time.Timer.start();
            try rope.walk(&ctx, Ctx.walker);
            stats.record(timer.read());
        }

        try results.append(allocator, BenchResult{
            .name = "Rope walk all 10k items",
            .min_ns = stats.min_ns,
            .avg_ns = stats.avg(),
            .max_ns = stats.max_ns,
            .total_ns = stats.total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return results.toOwnedSlice(allocator);
}

pub fn run(
    allocator: std.mem.Allocator,
    show_mem: bool,
) ![]BenchResult {
    _ = show_mem; // Rope benchmarks don't currently track memory

    var all_results: std.ArrayListUnmanaged(BenchResult) = .{};
    errdefer all_results.deinit(allocator);

    const iterations: usize = 10;

    // Run all benchmark categories
    const insert_results = try benchInsertOperations(allocator, iterations);
    try all_results.appendSlice(allocator, insert_results);

    const delete_results = try benchDeleteOperations(allocator, iterations);
    try all_results.appendSlice(allocator, delete_results);

    const bulk_results = try benchBulkOperations(allocator, iterations);
    try all_results.appendSlice(allocator, bulk_results);

    const access_results = try benchAccessPatterns(allocator, iterations);
    try all_results.appendSlice(allocator, access_results);

    return all_results.toOwnedSlice(allocator);
}
