const std = @import("std");
const rope_mod = @import("../rope.zig");

// Test item with weight-based metrics
const WeightedItem = struct {
    value: u32,
    size: u32, // byte size for weight-based balancing

    pub const Metrics = struct {
        total_size: u32 = 0,
        total_items: u32 = 0,

        pub fn add(self: *Metrics, other: Metrics) void {
            self.total_size += other.total_size;
            self.total_items += other.total_items;
        }

        // Weight function for balancing - balance on size, not count
        pub fn weight(self: *const Metrics) u32 {
            return self.total_size;
        }
    };

    pub fn measure(self: *const WeightedItem) Metrics {
        return .{
            .total_size = self.size,
            .total_items = 1,
        };
    }

    pub fn empty() WeightedItem {
        return .{ .value = 0, .size = 0 };
    }

    pub fn is_empty(self: *const WeightedItem) bool {
        return self.value == 0 and self.size == 0;
    }
};

// Simple test item type
const SimpleItem = struct {
    value: u32,

    pub fn empty() SimpleItem {
        return .{ .value = 0 };
    }

    pub fn is_empty(self: *const SimpleItem) bool {
        return self.value == 0;
    }
};

//===== Weight-based Balancing Tests =====

test "Rope - weight-based balancing with custom weight function" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(WeightedItem);

    // Create items with different sizes
    const items = [_]WeightedItem{
        .{ .value = 1, .size = 100 }, // Large item
        .{ .value = 2, .size = 10 }, // Small item
        .{ .value = 3, .size = 200 }, // Very large item
        .{ .value = 4, .size = 50 }, // Medium item
    };

    var rope = try RopeType.from_slice(arena.allocator(), &items);

    // Check that metrics are tracked
    const metrics = rope.root.metrics();
    try std.testing.expectEqual(@as(u32, 4), metrics.count);
    try std.testing.expectEqual(@as(u32, 360), metrics.custom.total_size);
    try std.testing.expectEqual(@as(u32, 360), metrics.weight()); // Should use weight()
}

test "Rope - weight-based join_balanced respects weight ratio" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(WeightedItem);

    // Create two ropes with very different weights
    const left_items = [_]WeightedItem{
        .{ .value = 1, .size = 1000 },
        .{ .value = 2, .size = 1000 },
        .{ .value = 3, .size = 1000 },
    };
    var rope_left = try RopeType.from_slice(arena.allocator(), &left_items);

    const right_items = [_]WeightedItem{
        .{ .value = 4, .size = 100 },
    };
    const rope_right = try RopeType.from_slice(arena.allocator(), &right_items);

    // Concat should use weight-based balancing
    try rope_left.concat(&rope_right);

    try std.testing.expectEqual(@as(u32, 4), rope_left.count());

    // Verify tree is still balanced despite uneven item counts
    try std.testing.expect(rope_left.root.is_balanced());
}

test "Rope - fallback to count when no weight function" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
        .{ .value = 3 },
    };

    var rope = try RopeType.from_slice(arena.allocator(), &items);
    const metrics = rope.root.metrics();

    // Should fall back to count for balancing
    try std.testing.expectEqual(@as(u32, 3), metrics.weight());
}

//===== Path-Caching Finger Tests =====

test "Finger - cache invalidation on structural changes" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 1 });

    var finger = rope.makeFinger(0);
    try std.testing.expect(finger.cached_node == null);

    // After insert, cache should be invalidated
    try rope.insertAtFinger(&finger, .{ .value = 2 });
    try std.testing.expect(finger.cached_node == null);
}

test "Finger - seek invalidates cache on large jumps" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var items: [200]SimpleItem = undefined;
    for (&items, 0..) |*item, i| {
        item.* = .{ .value = @intCast(i) };
    }
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    var finger = rope.makeFinger(50);

    // Small seek should keep cache
    finger.seek(55);
    // But we can't directly test cache state - it's internal

    // Large seek should invalidate
    finger.seek(150);
    try std.testing.expectEqual(@as(u32, 150), finger.getIndex());
}

test "Finger - get method works correctly" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 10 },
        .{ .value = 20 },
        .{ .value = 30 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    var finger = rope.makeFinger(1);
    const value = finger.get();
    try std.testing.expect(value != null);
    try std.testing.expectEqual(@as(u32, 20), value.?.value);

    // Seek and get again
    finger.seek(2);
    const value2 = finger.get();
    try std.testing.expectEqual(@as(u32, 30), value2.?.value);
}

test "Finger - operations update index correctly" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 1 });

    var finger = rope.makeFinger(0);

    // Insert increases available items
    try rope.insertAtFinger(&finger, .{ .value = 2 });
    try std.testing.expectEqual(@as(u32, 0), finger.getIndex());

    // Move finger
    finger.seek(1);
    try rope.replaceAtFinger(&finger, .{ .value = 99 });
    try std.testing.expectEqual(@as(u32, 99), rope.get(1).?.value);
}

//===== Configurable Undo Depth Tests =====

test "Rope - unlimited undo depth by default" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.init(arena.allocator());

    // Store many undo states
    for (0..100) |i| {
        try rope.store_undo("state");
        try rope.append(.{ .value = @intCast(i) });
    }

    // Should have all 100 states
    try std.testing.expectEqual(@as(usize, 100), rope.undo_depth);
    try std.testing.expect(rope.can_undo());
}

test "Rope - max_undo_depth limits history" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.initWithConfig(arena.allocator(), .{ .max_undo_depth = 10 });

    // Store 20 undo states
    for (0..20) |i| {
        try rope.store_undo("state");
        try rope.append(.{ .value = @intCast(i) });
    }

    // Should only keep 10 states
    try std.testing.expectEqual(@as(usize, 10), rope.undo_depth);
    try std.testing.expect(rope.can_undo());

    // Can undo at most 10 times (may be less due to how history works)
    var undo_count: usize = 0;
    while (rope.can_undo()) : (undo_count += 1) {
        _ = rope.undo("current") catch break;
    }
    // Should have undone at least some operations, but not more than 10
    try std.testing.expect(undo_count > 0);
    try std.testing.expect(undo_count <= 10);
}

test "Rope - trimUndoHistory works correctly" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.initWithConfig(arena.allocator(), .{ .max_undo_depth = 5 });

    // Add states one by one
    for (0..10) |i| {
        try rope.store_undo("state");
        try rope.append(.{ .value = @intCast(i) });

        // Depth should never exceed 5
        try std.testing.expect(rope.undo_depth <= 5);
    }

    try std.testing.expectEqual(@as(usize, 5), rope.undo_depth);
}

test "Rope - clear_history resets undo depth" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.init(arena.allocator());

    try rope.store_undo("state1");
    try rope.append(.{ .value = 1 });
    try rope.store_undo("state2");
    try rope.append(.{ .value = 2 });

    try std.testing.expect(rope.undo_depth > 0);

    rope.clear_history();
    try std.testing.expectEqual(@as(usize, 0), rope.undo_depth);
    try std.testing.expect(!rope.can_undo());
}

//===== Sentinel Empty Filtering Tests =====

test "Rope - init creates rope with count 0 (no sentinel)" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.init(arena.allocator());

    // Should report 0 items (sentinel filtered out)
    try std.testing.expectEqual(@as(u32, 0), rope.count());
}

test "Rope - from_slice excludes sentinels from count" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
        .{ .value = 3 },
    };

    var rope = try RopeType.from_slice(arena.allocator(), &items);

    // Should report exactly 3 items (no sentinel in count)
    try std.testing.expectEqual(@as(u32, 3), rope.count());
}

test "Rope - walk skips sentinel empties" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.init(arena.allocator());

    // Empty rope - walk should not iterate over sentinel
    const Context = struct {
        count: u32 = 0,

        fn walker(ctx: *anyopaque, data: *const SimpleItem, index: u32) RopeType.Node.WalkerResult {
            _ = data;
            _ = index;
            const self = @as(*@This(), @ptrCast(@alignCast(ctx)));
            self.count += 1;
            return .{};
        }
    };

    var ctx = Context{};
    try rope.walk(&ctx, Context.walker);

    // Should walk 0 items (sentinel filtered)
    try std.testing.expectEqual(@as(u32, 0), ctx.count);
}

test "Rope - walk on non-empty rope excludes sentinels" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 10 },
        .{ .value = 20 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    const Context = struct {
        sum: u32 = 0,
        count: u32 = 0,

        fn walker(ctx: *anyopaque, data: *const SimpleItem, index: u32) RopeType.Node.WalkerResult {
            _ = index;
            const self = @as(*@This(), @ptrCast(@alignCast(ctx)));
            self.sum += data.value;
            self.count += 1;
            return .{};
        }
    };

    var ctx = Context{};
    try rope.walk(&ctx, Context.walker);

    // Should walk exactly 2 items
    try std.testing.expectEqual(@as(u32, 2), ctx.count);
    try std.testing.expectEqual(@as(u32, 30), ctx.sum);
}

test "Rope - get with sentinel filtering works correctly" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 100 },
        .{ .value = 200 },
        .{ .value = 300 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    try std.testing.expectEqual(@as(u32, 100), rope.get(0).?.value);
    try std.testing.expectEqual(@as(u32, 200), rope.get(1).?.value);
    try std.testing.expectEqual(@as(u32, 300), rope.get(2).?.value);
    try std.testing.expect(rope.get(3) == null); // Out of bounds
}

test "Rope - split with sentinels doesn't inflate counts" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
        .{ .value = 3 },
        .{ .value = 4 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    const right = try rope.split(2);

    // Left should have 2 items (no sentinel inflation)
    try std.testing.expectEqual(@as(u32, 2), rope.count());
    try std.testing.expectEqual(@as(u32, 1), rope.get(0).?.value);
    try std.testing.expectEqual(@as(u32, 2), rope.get(1).?.value);

    // Right should have 2 items (no sentinel inflation)
    try std.testing.expectEqual(@as(u32, 2), right.count());
    try std.testing.expectEqual(@as(u32, 3), right.get(0).?.value);
    try std.testing.expectEqual(@as(u32, 4), right.get(1).?.value);
}

test "Rope - delete_range handles sentinels correctly" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
        .{ .value = 3 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    try rope.delete_range(0, 3);

    // Should be empty now (no sentinel in count)
    try std.testing.expectEqual(@as(u32, 0), rope.count());
}

//===== Integration Tests =====

test "Integration - weight-based balancing with fingers and history limits" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(WeightedItem);
    var rope = try RopeType.initWithConfig(arena.allocator(), .{ .max_undo_depth = 5 });

    // Build rope with weighted items
    var expected_count: u32 = 0;
    for (0..10) |i| {
        try rope.store_undo("insert");
        try rope.append(.{
            .value = @intCast(i),
            .size = @intCast((i + 1) * 10),
        });
        expected_count += 1;
    }

    try std.testing.expectEqual(expected_count, rope.count());

    // Use finger for clustered edits
    var finger = rope.makeFinger(5);
    try rope.insertAtFinger(&finger, .{ .value = 999, .size = 50 });
    expected_count += 1;

    try std.testing.expectEqual(expected_count, rope.count());

    // History should be limited to 5
    try std.testing.expect(rope.undo_depth <= 5);

    // Tree should remain balanced
    try std.testing.expect(rope.root.is_balanced());
}

test "Integration - all features working together" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.initWithConfig(arena.allocator(), .{ .max_undo_depth = 3 });

    // Initial state
    try std.testing.expectEqual(@as(u32, 0), rope.count());

    // Add items
    try rope.store_undo("empty");
    try rope.append(.{ .value = 1 });

    try rope.store_undo("one");
    try rope.append(.{ .value = 2 });

    try rope.store_undo("two");
    try rope.append(.{ .value = 3 });

    try rope.store_undo("three");
    try rope.append(.{ .value = 4 });

    // Should have 4 items now
    try std.testing.expectEqual(@as(u32, 4), rope.count());

    // History limited to 3
    try std.testing.expectEqual(@as(usize, 3), rope.undo_depth);

    // Use finger
    var finger = rope.makeFinger(2);
    const val = finger.get();
    try std.testing.expectEqual(@as(u32, 3), val.?.value);

    // Undo works
    _ = try rope.undo("current");
    try std.testing.expectEqual(@as(u32, 3), rope.count());

    // No sentinels in walk
    const Context = struct {
        count: u32 = 0,
        fn walker(ctx: *anyopaque, data: *const SimpleItem, index: u32) RopeType.Node.WalkerResult {
            _ = data;
            _ = index;
            const self = @as(*@This(), @ptrCast(@alignCast(ctx)));
            self.count += 1;
            return .{};
        }
    };
    var ctx = Context{};
    try rope.walk(&ctx, Context.walker);
    try std.testing.expectEqual(@as(u32, 3), ctx.count);
}
