const std = @import("std");
const rope_mod = @import("../rope.zig");

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

test "Rope perf - insert operations" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(TestItem);

    std.debug.print("\n=== Insert Performance ===\n", .{});

    // Sequential inserts at end
    {
        var rope = try RopeType.init(arena.allocator());
        var timer = try std.time.Timer.start();
        var i: u32 = 0;
        while (i < 1000) : (i += 1) {
            try rope.append(.{ .value = i });
        }
        const elapsed = timer.read();
        const elapsed_ms = @as(f64, @floatFromInt(elapsed)) / 1_000_000.0;
        std.debug.print("Sequential append 1000 items: {d:.2}ms\n", .{elapsed_ms});
        try std.testing.expectEqual(@as(u32, 1001), rope.count());
    }

    // Sequential inserts at beginning
    {
        var rope = try RopeType.init(arena.allocator());
        var timer = try std.time.Timer.start();
        var i: u32 = 0;
        while (i < 1000) : (i += 1) {
            try rope.prepend(.{ .value = i });
        }
        const elapsed = timer.read();
        const elapsed_ms = @as(f64, @floatFromInt(elapsed)) / 1_000_000.0;
        std.debug.print("Sequential prepend 1000 items: {d:.2}ms\n", .{elapsed_ms});
        try std.testing.expectEqual(@as(u32, 1001), rope.count());
    }

    // Random inserts
    {
        var rope = try RopeType.init(arena.allocator());
        var prng = std.Random.DefaultPrng.init(42);
        const random = prng.random();
        var timer = try std.time.Timer.start();
        var i: u32 = 0;
        while (i < 1000) : (i += 1) {
            const pos = if (rope.count() > 0)
                random.intRangeAtMost(u32, 0, rope.count())
            else
                0;
            try rope.insert(pos, .{ .value = i });
        }
        const elapsed = timer.read();
        const elapsed_ms = @as(f64, @floatFromInt(elapsed)) / 1_000_000.0;
        std.debug.print("Random insert 1000 items: {d:.2}ms\n", .{elapsed_ms});
        try std.testing.expectEqual(@as(u32, 1001), rope.count());
    }
}

test "Rope perf - delete operations" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(TestItem);

    std.debug.print("\n=== Delete Performance ===\n", .{});

    var items: [1000]TestItem = undefined;
    for (&items, 0..) |*item, i| {
        item.* = .{ .value = @intCast(i) };
    }

    // Sequential deletes from end
    {
        var rope = try RopeType.from_slice(arena.allocator(), &items);
        var timer = try std.time.Timer.start();
        var i: u32 = 0;
        while (i < 500) : (i += 1) {
            try rope.delete(rope.count() - 1);
        }
        const elapsed = timer.read();
        const elapsed_ms = @as(f64, @floatFromInt(elapsed)) / 1_000_000.0;
        std.debug.print("Sequential delete 500 from end: {d:.2}ms\n", .{elapsed_ms});
        try std.testing.expectEqual(@as(u32, 500), rope.count());
    }

    // Sequential deletes from beginning
    {
        var rope = try RopeType.from_slice(arena.allocator(), &items);
        var timer = try std.time.Timer.start();
        var i: u32 = 0;
        while (i < 500) : (i += 1) {
            try rope.delete(0);
        }
        const elapsed = timer.read();
        const elapsed_ms = @as(f64, @floatFromInt(elapsed)) / 1_000_000.0;
        std.debug.print("Sequential delete 500 from beginning: {d:.2}ms\n", .{elapsed_ms});
        try std.testing.expectEqual(@as(u32, 500), rope.count());
    }

    // Random deletes
    {
        var rope = try RopeType.from_slice(arena.allocator(), &items);
        var prng = std.Random.DefaultPrng.init(42);
        const random = prng.random();
        var timer = try std.time.Timer.start();
        var i: u32 = 0;
        while (i < 500) : (i += 1) {
            const pos = random.intRangeAtMost(u32, 0, rope.count() - 1);
            try rope.delete(pos);
        }
        const elapsed = timer.read();
        const elapsed_ms = @as(f64, @floatFromInt(elapsed)) / 1_000_000.0;
        std.debug.print("Random delete 500 items: {d:.2}ms\n", .{elapsed_ms});
        try std.testing.expectEqual(@as(u32, 500), rope.count());
    }
}

test "Rope perf - bulk operations" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(TestItem);

    std.debug.print("\n=== Bulk Operations Performance ===\n", .{});

    var items: [1000]TestItem = undefined;
    for (&items, 0..) |*item, i| {
        item.* = .{ .value = @intCast(i) };
    }

    // insert_slice
    {
        var rope = try RopeType.init(arena.allocator());
        var chunk: [100]TestItem = undefined;
        for (&chunk, 0..) |*item, i| {
            item.* = .{ .value = @intCast(i) };
        }
        var timer = try std.time.Timer.start();
        var i: u32 = 0;
        while (i < 10) : (i += 1) {
            try rope.insert_slice(rope.count(), &chunk);
        }
        const elapsed = timer.read();
        const elapsed_ms = @as(f64, @floatFromInt(elapsed)) / 1_000_000.0;
        std.debug.print("insert_slice 10x100 items: {d:.2}ms\n", .{elapsed_ms});
        try std.testing.expectEqual(@as(u32, 1001), rope.count()); // 10*100 + initial empty
    }

    // delete_range
    {
        var rope = try RopeType.from_slice(arena.allocator(), &items);
        var timer = try std.time.Timer.start();
        var i: u32 = 0;
        while (i < 10) : (i += 1) {
            const start = if (rope.count() > 50) rope.count() - 50 else 0;
            const end = rope.count();
            try rope.delete_range(start, end);
        }
        const elapsed = timer.read();
        const elapsed_ms = @as(f64, @floatFromInt(elapsed)) / 1_000_000.0;
        std.debug.print("delete_range 10x50 items: {d:.2}ms\n", .{elapsed_ms});
        try std.testing.expectEqual(@as(u32, 500), rope.count());
    }

    // split
    {
        var rope = try RopeType.from_slice(arena.allocator(), &items);
        var timer = try std.time.Timer.start();
        var i: u32 = 0;
        while (i < 10) : (i += 1) {
            const mid = rope.count() / 2;
            var right = try rope.split(mid);
            try rope.concat(&right);
        }
        const elapsed = timer.read();
        const elapsed_ms = @as(f64, @floatFromInt(elapsed)) / 1_000_000.0;
        std.debug.print("split 10 times at midpoint: {d:.2}ms\n", .{elapsed_ms});
        try std.testing.expectEqual(@as(u32, 1000), rope.count());
    }

    // concat
    {
        var rope1 = try RopeType.from_slice(arena.allocator(), items[0..500]);
        const rope2 = try RopeType.from_slice(arena.allocator(), items[500..]);
        var timer = try std.time.Timer.start();
        try rope1.concat(&rope2);
        const elapsed = timer.read();
        const elapsed_ms = @as(f64, @floatFromInt(elapsed)) / 1_000_000.0;
        std.debug.print("concat two 500-item ropes: {d:.2}ms\n", .{elapsed_ms});
        try std.testing.expectEqual(@as(u32, 1000), rope1.count());
    }
}

test "Rope perf - finger locality" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(TestItem);

    std.debug.print("\n=== Finger Locality Performance ===\n", .{});

    var items: [1000]TestItem = undefined;
    for (&items, 0..) |*item, i| {
        item.* = .{ .value = @intCast(i) };
    }
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    // Clustered edits with finger
    {
        var finger = rope.makeFinger(500);
        var timer = try std.time.Timer.start();
        var i: u32 = 0;
        while (i < 100) : (i += 1) {
            try rope.insertAtFinger(&finger, .{ .value = i + 1000 });
            finger.seek(finger.getIndex() + 1);
        }
        const elapsed = timer.read();
        const elapsed_ms = @as(f64, @floatFromInt(elapsed)) / 1_000_000.0;
        std.debug.print("100 finger-based inserts near position 500: {d:.2}ms\n", .{elapsed_ms});
        try std.testing.expectEqual(@as(u32, 1100), rope.count());
    }

    // Compare with non-finger inserts
    {
        var rope2 = try RopeType.from_slice(arena.allocator(), &items);
        var timer = try std.time.Timer.start();
        var i: u32 = 0;
        while (i < 100) : (i += 1) {
            try rope2.insert(500 + i, .{ .value = i + 1000 });
        }
        const elapsed = timer.read();
        const elapsed_ms = @as(f64, @floatFromInt(elapsed)) / 1_000_000.0;
        std.debug.print("100 regular inserts near position 500: {d:.2}ms\n", .{elapsed_ms});
        try std.testing.expectEqual(@as(u32, 1100), rope2.count());
    }
}

test "Rope perf - access patterns" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(TestItem);

    std.debug.print("\n=== Access Pattern Performance ===\n", .{});

    var items: [1000]TestItem = undefined;
    for (&items, 0..) |*item, i| {
        item.* = .{ .value = @intCast(i) };
    }
    const rope = try RopeType.from_slice(arena.allocator(), &items);

    // Sequential get
    {
        var timer = try std.time.Timer.start();
        var i: u32 = 0;
        while (i < 1000) : (i += 1) {
            _ = rope.get(i);
        }
        const elapsed = timer.read();
        const elapsed_ms = @as(f64, @floatFromInt(elapsed)) / 1_000_000.0;
        std.debug.print("Sequential get all 1000 items: {d:.2}ms\n", .{elapsed_ms});
    }

    // Random get
    {
        var prng = std.Random.DefaultPrng.init(42);
        const random = prng.random();
        var timer = try std.time.Timer.start();
        var i: u32 = 0;
        while (i < 1000) : (i += 1) {
            const pos = random.intRangeAtMost(u32, 0, 999);
            _ = rope.get(pos);
        }
        const elapsed = timer.read();
        const elapsed_ms = @as(f64, @floatFromInt(elapsed)) / 1_000_000.0;
        std.debug.print("Random get 1000 accesses: {d:.2}ms\n", .{elapsed_ms});
    }

    // Walk
    {
        const Ctx = struct {
            sum: u32 = 0,
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
        const elapsed_ms = @as(f64, @floatFromInt(elapsed)) / 1_000_000.0;
        std.debug.print("Walk all 1000 items: {d:.2}ms\n", .{elapsed_ms});
    }
}

test "Rope perf - depth analysis" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(TestItem);

    std.debug.print("\n=== Depth Analysis ===\n", .{});

    // Build rope with sequential appends
    {
        var rope = try RopeType.init(arena.allocator());
        var i: u32 = 0;
        while (i < 1000) : (i += 1) {
            try rope.append(.{ .value = i });
        }
        const depth = rope.root.depth();
        const count = rope.count();
        const theoretical_min = @ceil(@log2(@as(f64, @floatFromInt(count))));
        std.debug.print("Sequential append: count={d}, depth={d}, theoretical_min={d:.1}\n", .{ count, depth, theoretical_min });
    }

    // Build rope with balanced insert pattern
    {
        var items: [1000]TestItem = undefined;
        for (&items, 0..) |*item, i| {
            item.* = .{ .value = @intCast(i) };
        }
        const rope = try RopeType.from_slice(arena.allocator(), &items);
        const depth = rope.root.depth();
        const count = rope.count();
        const theoretical_min = @ceil(@log2(@as(f64, @floatFromInt(count))));
        std.debug.print("from_slice: count={d}, depth={d}, theoretical_min={d:.1}\n", .{ count, depth, theoretical_min });
    }

    // Build rope with many split/concat operations
    {
        var items: [1000]TestItem = undefined;
        for (&items, 0..) |*item, i| {
            item.* = .{ .value = @intCast(i) };
        }
        var rope = try RopeType.from_slice(arena.allocator(), &items);

        // Do 20 split/concat cycles
        var i: u32 = 0;
        while (i < 20) : (i += 1) {
            const mid = rope.count() / 2;
            var right = try rope.split(mid);
            try rope.concat(&right);
        }

        const depth = rope.root.depth();
        const count = rope.count();
        const theoretical_min = @ceil(@log2(@as(f64, @floatFromInt(count))));
        std.debug.print("After 20 split/concat cycles: count={d}, depth={d}, theoretical_min={d:.1}\n", .{ count, depth, theoretical_min });
    }
}
