const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const rope_mod = @import("../rope.zig");

const BenchResult = bench_utils.BenchResult;
const MemStats = bench_utils.MemStats;

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

const BenchData = struct {
    min_ns: u64,
    avg_ns: u64,
    max_ns: u64,
    total_ns: u64,
};

fn benchInsertOperations(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    // Sequential appends
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try RopeType.init(arena.allocator());
            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 10000) : (i += 1) {
                try rope.append(.{ .value = i });
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Rope sequential append 10k items", .{});
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

    // Sequential prepends
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try RopeType.init(arena.allocator());
            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 10000) : (i += 1) {
                try rope.prepend(.{ .value = i });
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Rope sequential prepend 10k items", .{});
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

    // Random inserts
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try RopeType.init(arena.allocator());
            var prng = std.Random.DefaultPrng.init(42);
            const random = prng.random();
            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 5000) : (i += 1) {
                const pos = if (rope.count() > 0)
                    random.intRangeAtMost(u32, 0, rope.count())
                else
                    0;
                try rope.insert(pos, .{ .value = i });
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Rope random insert 5k items", .{});
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

fn benchDeleteOperations(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    var items: [10000]TestItem = undefined;
    for (&items, 0..) |*item, i| {
        item.* = .{ .value = @intCast(i) };
    }

    // Sequential deletes from end
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try RopeType.from_slice(arena.allocator(), &items);
            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 5000) : (i += 1) {
                try rope.delete(rope.count() - 1);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Rope sequential delete 5k from end", .{});
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

    // Sequential deletes from beginning
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try RopeType.from_slice(arena.allocator(), &items);
            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 5000) : (i += 1) {
                try rope.delete(0);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Rope sequential delete 5k from beginning", .{});
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

    // Random deletes
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try RopeType.from_slice(arena.allocator(), &items);
            var prng = std.Random.DefaultPrng.init(42);
            const random = prng.random();
            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 5000) : (i += 1) {
                const pos = random.intRangeAtMost(u32, 0, rope.count() - 1);
                try rope.delete(pos);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Rope random delete 5k items", .{});
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

fn benchBulkOperations(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    var items: [10000]TestItem = undefined;
    for (&items, 0..) |*item, i| {
        item.* = .{ .value = @intCast(i) };
    }

    // insert_slice
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try RopeType.init(arena.allocator());
            var chunk: [1000]TestItem = undefined;
            for (&chunk, 0..) |*item, i| {
                item.* = .{ .value = @intCast(i) };
            }
            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 10) : (i += 1) {
                try rope.insert_slice(rope.count(), &chunk);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Rope insert_slice 10x1k items", .{});
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

    // delete_range
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try RopeType.from_slice(arena.allocator(), &items);
            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 10) : (i += 1) {
                const start = if (rope.count() > 500) rope.count() - 500 else 0;
                const end = rope.count();
                try rope.delete_range(start, end);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Rope delete_range 10x500 items", .{});
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

    // split/concat
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try RopeType.from_slice(arena.allocator(), &items);
            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 100) : (i += 1) {
                const mid = rope.count() / 2;
                var right = try rope.split(mid);
                try rope.concat(&right);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Rope split/concat 100 cycles at midpoint", .{});
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

    // concat two ropes
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope1 = try RopeType.from_slice(arena.allocator(), items[0..5000]);
            const rope2 = try RopeType.from_slice(arena.allocator(), items[5000..]);
            var timer = try std.time.Timer.start();
            try rope1.concat(&rope2);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Rope concat two 5k-item ropes", .{});
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

fn benchFingerLocality(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    var items: [10000]TestItem = undefined;
    for (&items, 0..) |*item, i| {
        item.* = .{ .value = @intCast(i) };
    }

    // Clustered edits with finger
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try RopeType.from_slice(arena.allocator(), &items);
            var finger = rope.makeFinger(5000);
            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 1000) : (i += 1) {
                try rope.insertAtFinger(&finger, .{ .value = i + 10000 });
                finger.seek(finger.getIndex() + 1);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Rope 1k finger-based inserts near pos 5k", .{});
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

    // Compare with non-finger inserts
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            var rope = try RopeType.from_slice(arena.allocator(), &items);
            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 1000) : (i += 1) {
                try rope.insert(5000 + i, .{ .value = i + 10000 });
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Rope 1k regular inserts near pos 5k", .{});
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

fn benchAccessPatterns(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    var items: [10000]TestItem = undefined;
    for (&items, 0..) |*item, i| {
        item.* = .{ .value = @intCast(i) };
    }

    // Sequential get
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            const rope = try RopeType.from_slice(arena.allocator(), &items);
            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 10000) : (i += 1) {
                _ = rope.get(i);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Rope sequential get all 10k items", .{});
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

    // Random get
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            const rope = try RopeType.from_slice(arena.allocator(), &items);
            var prng = std.Random.DefaultPrng.init(42);
            const random = prng.random();
            var timer = try std.time.Timer.start();
            var i: u32 = 0;
            while (i < 10000) : (i += 1) {
                const pos = random.intRangeAtMost(u32, 0, 9999);
                _ = rope.get(pos);
            }
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Rope random get 10k accesses", .{});
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

    // Walk
    {
        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var arena = std.heap.ArenaAllocator.init(allocator);
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
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "Rope walk all 10k items", .{});
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
    _ = show_mem; // Rope benchmarks don't currently track memory

    var all_results = std.ArrayList(BenchResult).init(allocator);

    const iterations: usize = 10;

    // Run all benchmark categories
    const insert_results = try benchInsertOperations(allocator, iterations);
    defer allocator.free(insert_results);
    try all_results.appendSlice(insert_results);

    const delete_results = try benchDeleteOperations(allocator, iterations);
    defer allocator.free(delete_results);
    try all_results.appendSlice(delete_results);

    const bulk_results = try benchBulkOperations(allocator, iterations);
    defer allocator.free(bulk_results);
    try all_results.appendSlice(bulk_results);

    const finger_results = try benchFingerLocality(allocator, iterations);
    defer allocator.free(finger_results);
    try all_results.appendSlice(finger_results);

    const access_results = try benchAccessPatterns(allocator, iterations);
    defer allocator.free(access_results);
    try all_results.appendSlice(access_results);

    return try all_results.toOwnedSlice();
}
