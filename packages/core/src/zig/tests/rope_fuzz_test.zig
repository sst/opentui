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

/// Verify rope structural invariants
fn verifyInvariants(rope: *const rope_mod.Rope(TestItem)) !void {
    const count = rope.count();

    // Collect all items via walk
    var walked_count: u32 = 0;
    const Context = struct {
        count: *u32,
        last_seen: u32 = 0,

        fn walker(ctx: *anyopaque, data: *const TestItem, index: u32) rope_mod.Rope(TestItem).Node.WalkerResult {
            _ = index;
            _ = data;
            const self = @as(*@This(), @ptrCast(@alignCast(ctx)));
            self.count.* += 1;
            return .{};
        }
    };

    var ctx = Context{ .count = &walked_count };
    try rope.walk(&ctx, Context.walker);

    // Count must match walked count
    try std.testing.expectEqual(count, walked_count);

    // Verify depth is logarithmic (allow slack for imbalance and sequential inserts)
    const depth = rope.root.depth();
    const max_expected_depth: u32 = if (count <= 1) 1 else @as(u32, @intFromFloat(@ceil(@log2(@as(f64, @floatFromInt(count)))) * 4.5));
    if (depth > max_expected_depth) {
        std.debug.print("Depth check failed: depth={d}, max_expected={d}, count={d}\n", .{ depth, max_expected_depth, count });
    }
    try std.testing.expect(depth <= max_expected_depth);
}

test "Rope fuzz - random insert/delete sequence" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(TestItem);
    var rope = try RopeType.init(arena.allocator());

    var prng = std.Random.DefaultPrng.init(42);
    const random = prng.random();

    // Perform 100 random operations
    var i: usize = 0;
    while (i < 100) : (i += 1) {
        const op = random.intRangeAtMost(u8, 0, 2);
        const current_count = rope.count();

        switch (op) {
            0 => { // Insert
                const pos = if (current_count > 0) random.intRangeAtMost(u32, 0, current_count) else 0;
                const value = random.int(u32);
                try rope.insert(pos, .{ .value = value });
            },
            1 => { // Delete
                if (current_count > 1) { // Keep at least empty item
                    const pos = random.intRangeAtMost(u32, 0, current_count - 1);
                    try rope.delete(pos);
                }
            },
            2 => { // Replace
                if (current_count > 0) {
                    const pos = random.intRangeAtMost(u32, 0, current_count - 1);
                    const value = random.int(u32);
                    try rope.replace(pos, .{ .value = value });
                }
            },
            else => unreachable,
        }

        // Verify invariants every 10 operations
        if (i % 10 == 0) {
            try verifyInvariants(&rope);
        }
    }

    // Final verification
    try verifyInvariants(&rope);
}

test "Rope fuzz - random bulk operations" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(TestItem);
    var rope = try RopeType.init(arena.allocator());

    var prng = std.Random.DefaultPrng.init(123);
    const random = prng.random();

    // Perform 50 random bulk operations
    var i: usize = 0;
    while (i < 50) : (i += 1) {
        const op = random.intRangeAtMost(u8, 0, 3);
        const current_count = rope.count();

        switch (op) {
            0 => { // Insert slice
                const slice_len = random.intRangeAtMost(u8, 1, 10);
                var items: [10]TestItem = undefined;
                for (items[0..slice_len]) |*item| {
                    item.* = .{ .value = random.int(u32) };
                }
                const pos = if (current_count > 0) random.intRangeAtMost(u32, 0, current_count) else 0;
                try rope.insert_slice(pos, items[0..slice_len]);
            },
            1 => { // Delete range
                if (current_count > 2) {
                    const start = random.intRangeAtMost(u32, 0, current_count - 2);
                    const end = random.intRangeAtMost(u32, start + 1, current_count);
                    try rope.delete_range(start, end);
                }
            },
            2 => { // Split and concat
                if (current_count > 1) {
                    const split_pos = random.intRangeAtMost(u32, 1, current_count - 1);
                    var right_half = try rope.split(split_pos);
                    try rope.concat(&right_half);
                }
            },
            3 => { // Concat with new rope
                const new_len = random.intRangeAtMost(u8, 1, 5);
                var items: [5]TestItem = undefined;
                for (items[0..new_len]) |*item| {
                    item.* = .{ .value = random.int(u32) };
                }
                const new_rope = try RopeType.from_slice(arena.allocator(), items[0..new_len]);
                try rope.concat(&new_rope);
            },
            else => unreachable,
        }

        // Verify invariants every 5 operations
        if (i % 5 == 0) {
            try verifyInvariants(&rope);
        }
    }

    // Final verification
    try verifyInvariants(&rope);
}

test "Rope fuzz - stress test with many items" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(TestItem);
    var rope = try RopeType.init(arena.allocator());

    // Build up a large rope
    var i: u32 = 0;
    while (i < 1000) : (i += 1) {
        try rope.append(.{ .value = i });
    }

    try verifyInvariants(&rope);

    // Perform random operations on large rope
    var prng = std.Random.DefaultPrng.init(789);
    const random = prng.random();

    var j: usize = 0;
    while (j < 200) : (j += 1) {
        const op = random.intRangeAtMost(u8, 0, 1);
        const current_count = rope.count();

        switch (op) {
            0 => { // Random delete
                if (current_count > 100) {
                    const pos = random.intRangeAtMost(u32, 0, current_count - 1);
                    try rope.delete(pos);
                }
            },
            1 => { // Random insert
                const pos = random.intRangeAtMost(u32, 0, current_count);
                try rope.insert(pos, .{ .value = random.int(u32) });
            },
            else => unreachable,
        }
    }

    // Final verification
    try verifyInvariants(&rope);

    // Verify depth is still reasonable after many operations
    const depth = rope.root.depth();
    const count = rope.count();
    const max_expected_depth: u32 = @as(u32, @intFromFloat(@ceil(@log2(@as(f64, @floatFromInt(count)))) * 4.0));
    try std.testing.expect(depth <= max_expected_depth);
}

test "Rope fuzz - finger operations" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(TestItem);
    var rope = try RopeType.init(arena.allocator());

    // Build initial rope
    var i: u32 = 0;
    while (i < 50) : (i += 1) {
        try rope.append(.{ .value = i });
    }

    var prng = std.Random.DefaultPrng.init(456);
    const random = prng.random();

    // Create a finger and do operations near it
    var finger = rope.makeFinger(25);

    var j: usize = 0;
    while (j < 30) : (j += 1) {
        const op = random.intRangeAtMost(u8, 0, 2);

        switch (op) {
            0 => { // Insert at finger
                try rope.insertAtFinger(&finger, .{ .value = random.int(u32) });
                finger.seek(finger.getIndex() + 1); // Move past inserted item
            },
            1 => { // Delete at finger
                if (finger.getIndex() < rope.count()) {
                    try rope.deleteAtFinger(&finger);
                }
            },
            2 => { // Replace at finger
                if (finger.getIndex() < rope.count()) {
                    try rope.replaceAtFinger(&finger, .{ .value = random.int(u32) });
                }
            },
            else => unreachable,
        }

        // Occasionally move finger
        if (random.boolean()) {
            const new_pos = random.intRangeAtMost(u32, 0, rope.count() - 1);
            finger.seek(new_pos);
        }
    }

    try verifyInvariants(&rope);
}
