const std = @import("std");
const rope_mod = @import("../rope.zig");
const array_rope_mod = @import("../array-rope.zig");

// Test with a simple type
const SimpleItem = struct {
    value: u32,

    pub fn empty() SimpleItem {
        return .{ .value = 0 };
    }

    pub fn is_empty(self: *const SimpleItem) bool {
        return self.value == 0;
    }
};

// Test with a type that has custom metrics
const ItemWithMetrics = struct {
    value: u32,
    size: u32,

    pub const Metrics = struct {
        total_size: u32 = 0,

        pub fn add(self: *Metrics, other: Metrics) void {
            self.total_size += other.total_size;
        }
    };

    pub fn measure(self: *const ItemWithMetrics) Metrics {
        return .{ .total_size = self.size };
    }

    pub fn empty() ItemWithMetrics {
        return .{ .value = 0, .size = 0 };
    }

    pub fn is_empty(self: *const ItemWithMetrics) bool {
        return self.value == 0 and self.size == 0;
    }
};

//===== Basic Rope Tests =====

test "Rope - can initialize with arena allocator" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.init(arena.allocator());
    try std.testing.expectEqual(@as(u32, 0), rope.count()); // Sentinel filtered
}

test "Rope - from_item creates single item rope" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 42 });

    try std.testing.expectEqual(@as(u32, 1), rope.count());
    const item = rope.get(0);
    try std.testing.expect(item != null);
    try std.testing.expectEqual(@as(u32, 42), item.?.value);
}

test "Rope - from_slice creates rope from multiple items" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
        .{ .value = 3 },
    };

    var rope = try RopeType.from_slice(arena.allocator(), &items);
    try std.testing.expectEqual(@as(u32, 3), rope.count());

    // Verify all items are accessible
    try std.testing.expectEqual(@as(u32, 1), rope.get(0).?.value);
    try std.testing.expectEqual(@as(u32, 2), rope.get(1).?.value);
    try std.testing.expectEqual(@as(u32, 3), rope.get(2).?.value);
}

test "Rope - get with out of bounds returns null" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 1 });

    try std.testing.expect(rope.get(100) == null);
}

//===== Insert Tests =====

test "Rope - insert at beginning" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 1 });

    try rope.insert(0, .{ .value = 0 });

    try std.testing.expectEqual(@as(u32, 2), rope.count());
    try std.testing.expectEqual(@as(u32, 0), rope.get(0).?.value);
    try std.testing.expectEqual(@as(u32, 1), rope.get(1).?.value);
}

test "Rope - insert at end" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 1 });

    try rope.insert(1, .{ .value = 2 });

    try std.testing.expectEqual(@as(u32, 2), rope.count());
    try std.testing.expectEqual(@as(u32, 1), rope.get(0).?.value);
    try std.testing.expectEqual(@as(u32, 2), rope.get(1).?.value);
}

test "Rope - multiple inserts" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.init(arena.allocator());

    try rope.insert(0, .{ .value = 1 });
    try rope.insert(1, .{ .value = 2 });
    try rope.insert(2, .{ .value = 3 });

    try std.testing.expectEqual(@as(u32, 3), rope.count()); // Sentinel filtered
}

//===== Delete Tests =====

test "Rope - delete at beginning" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
        .{ .value = 3 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    try rope.delete(0);

    try std.testing.expectEqual(@as(u32, 2), rope.count());
    try std.testing.expectEqual(@as(u32, 2), rope.get(0).?.value);
}

test "Rope - delete in middle" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
        .{ .value = 3 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    try rope.delete(1);

    try std.testing.expectEqual(@as(u32, 2), rope.count());
    try std.testing.expectEqual(@as(u32, 1), rope.get(0).?.value);
    try std.testing.expectEqual(@as(u32, 3), rope.get(1).?.value);
}

//===== Walk Tests =====

test "Rope - walk all items" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 10 },
        .{ .value = 20 },
        .{ .value = 30 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    const Context = struct {
        sum: u32 = 0,

        fn walker(ctx: *anyopaque, data: *const SimpleItem, index: u32) RopeType.Node.WalkerResult {
            _ = index;
            const self = @as(*@This(), @ptrCast(@alignCast(ctx)));
            self.sum += data.value;
            return .{};
        }
    };

    var ctx = Context{};
    try rope.walk(&ctx, Context.walker);

    try std.testing.expectEqual(@as(u32, 60), ctx.sum);
}

test "Rope - walk with early exit" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
        .{ .value = 3 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    const Context = struct {
        count: u32 = 0,

        fn walker(ctx: *anyopaque, data: *const SimpleItem, index: u32) RopeType.Node.WalkerResult {
            _ = index;
            const self = @as(*@This(), @ptrCast(@alignCast(ctx)));
            self.count += 1;
            if (data.value == 2) {
                return .{ .keep_walking = false };
            }
            return .{};
        }
    };

    var ctx = Context{};
    try rope.walk(&ctx, Context.walker);

    try std.testing.expectEqual(@as(u32, 2), ctx.count);
}

//===== Metrics Tests =====

test "Rope - custom metrics are tracked" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(ItemWithMetrics);
    const items = [_]ItemWithMetrics{
        .{ .value = 1, .size = 10 },
        .{ .value = 2, .size = 20 },
        .{ .value = 3, .size = 30 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    const metrics = rope.root.metrics();
    try std.testing.expectEqual(@as(u32, 3), metrics.count);
    try std.testing.expectEqual(@as(u32, 60), metrics.custom.total_size);
}

test "Rope - rebalance maintains data" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var items: [20]SimpleItem = undefined;
    for (&items, 0..) |*item, i| {
        item.* = .{ .value = @intCast(i) };
    }
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    try rope.rebalance(arena.allocator());

    // Data should be preserved
    try std.testing.expectEqual(@as(u32, 20), rope.count());
    try std.testing.expectEqual(@as(u32, 0), rope.get(0).?.value);
    try std.testing.expectEqual(@as(u32, 10), rope.get(10).?.value);
    try std.testing.expectEqual(@as(u32, 19), rope.get(19).?.value);
}

//===== Stress Tests =====

test "Rope - large number of items" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var items: [100]SimpleItem = undefined;
    for (&items, 0..) |*item, i| {
        item.* = .{ .value = @intCast(i) };
    }

    var rope = try RopeType.from_slice(arena.allocator(), &items);

    try std.testing.expectEqual(@as(u32, 100), rope.count());
    try std.testing.expectEqual(@as(u32, 0), rope.get(0).?.value);
    try std.testing.expectEqual(@as(u32, 50), rope.get(50).?.value);
    try std.testing.expectEqual(@as(u32, 99), rope.get(99).?.value);
}

test "Rope - many insert operations" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.init(arena.allocator());

    // Insert 50 items
    for (0..50) |i| {
        try rope.insert(@intCast(i), .{ .value = @intCast(i) });
    }

    try std.testing.expectEqual(@as(u32, 50), rope.count()); // Sentinel filtered
}

//===== Nested Rope Tests (Lines→Chunks Pattern) =====

// Chunk type similar to what would be used in text buffer
const Chunk = struct {
    data: []const u8,
    width: u32,

    pub const Metrics = struct {
        total_width: u32 = 0,
        total_bytes: u32 = 0,

        pub fn add(self: *Metrics, other: Metrics) void {
            self.total_width += other.total_width;
            self.total_bytes += other.total_bytes;
        }
    };

    pub fn measure(self: *const Chunk) Metrics {
        return .{
            .total_width = self.width,
            .total_bytes = @intCast(self.data.len),
        };
    }

    pub fn empty() Chunk {
        return .{ .data = "", .width = 0 };
    }

    pub fn is_empty(self: *const Chunk) bool {
        return self.data.len == 0;
    }
};

// Static empty chunk rope node for Line.empty()
const empty_chunk_leaf_node = rope_mod.Rope(Chunk).Node{
    .leaf = .{
        .data = Chunk.empty(),
    },
};

// Line type containing a rope of chunks
const Line = struct {
    chunks: rope_mod.Rope(Chunk),
    line_id: u32,

    pub const Metrics = struct {
        total_width: u32 = 0,
        total_lines: u32 = 1,

        pub fn add(self: *Metrics, other: Metrics) void {
            self.total_width += other.total_width;
            self.total_lines += other.total_lines;
        }
    };

    pub fn measure(self: *const Line) Metrics {
        const chunk_metrics = self.chunks.root.metrics();
        return .{
            .total_width = chunk_metrics.custom.total_width,
            .total_lines = 1,
        };
    }

    pub fn empty() Line {
        // Use static empty chunk rope - safe because it's immutable
        return .{
            .chunks = .{
                .root = &empty_chunk_leaf_node,
                .allocator = undefined, // Never used for empty
                .empty_leaf = &empty_chunk_leaf_node,
            },
            .line_id = 0,
        };
    }

    pub fn is_empty(self: *const Line) bool {
        return self.line_id == 0 and self.chunks.count() == 1;
    }
};

test "Nested Rope - create line with chunks" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Create chunks
    const chunks = [_]Chunk{
        .{ .data = "Hello ", .width = 6 },
        .{ .data = "World", .width = 5 },
    };

    // Create a rope of chunks
    const chunk_rope = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks);

    // Create a line containing the chunk rope
    const line = Line{
        .chunks = chunk_rope,
        .line_id = 1,
    };

    // Verify chunks are accessible
    try std.testing.expectEqual(@as(u32, 2), line.chunks.count());
    try std.testing.expectEqualStrings("Hello ", line.chunks.get(0).?.data);
    try std.testing.expectEqualStrings("World", line.chunks.get(1).?.data);

    // Verify metrics propagate
    const metrics = line.measure();
    try std.testing.expectEqual(@as(u32, 11), metrics.total_width); // 6 + 5
}

test "Nested Rope - rope of lines with chunks" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Create line 1 with chunks
    const chunks1 = [_]Chunk{
        .{ .data = "Line ", .width = 5 },
        .{ .data = "One", .width = 3 },
    };
    const line1 = Line{
        .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks1),
        .line_id = 1,
    };

    // Create line 2 with chunks
    const chunks2 = [_]Chunk{
        .{ .data = "Line ", .width = 5 },
        .{ .data = "Two", .width = 3 },
    };
    const line2 = Line{
        .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks2),
        .line_id = 2,
    };

    // Create rope of lines
    const lines = [_]Line{ line1, line2 };
    var line_rope = try rope_mod.Rope(Line).from_slice(allocator, &lines);

    // Verify structure
    try std.testing.expectEqual(@as(u32, 2), line_rope.count());

    // Access nested data
    const first_line = line_rope.get(0).?;
    try std.testing.expectEqual(@as(u32, 1), first_line.line_id);
    try std.testing.expectEqual(@as(u32, 2), first_line.chunks.count());
    try std.testing.expectEqualStrings("Line ", first_line.chunks.get(0).?.data);

    const second_line = line_rope.get(1).?;
    try std.testing.expectEqual(@as(u32, 2), second_line.line_id);
    try std.testing.expectEqualStrings("Two", second_line.chunks.get(1).?.data);
}

test "Nested Rope - insert chunk into line" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Create line with initial chunks
    const chunks = [_]Chunk{
        .{ .data = "Hello ", .width = 6 },
        .{ .data = "World", .width = 5 },
    };
    var chunk_rope = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks);

    // Insert a chunk in the middle
    try chunk_rope.insert(1, .{ .data = "Beautiful ", .width = 10 });

    try std.testing.expectEqual(@as(u32, 3), chunk_rope.count());
    try std.testing.expectEqualStrings("Hello ", chunk_rope.get(0).?.data);
    try std.testing.expectEqualStrings("Beautiful ", chunk_rope.get(1).?.data);
    try std.testing.expectEqualStrings("World", chunk_rope.get(2).?.data);

    // Verify metrics
    const metrics = chunk_rope.root.metrics();
    try std.testing.expectEqual(@as(u32, 21), metrics.custom.total_width); // 6 + 10 + 5
}

test "Nested Rope - delete chunk from line" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    const chunks = [_]Chunk{
        .{ .data = "A ", .width = 2 },
        .{ .data = "B ", .width = 2 },
        .{ .data = "C", .width = 1 },
    };
    var chunk_rope = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks);

    // Delete middle chunk
    try chunk_rope.delete(1);

    try std.testing.expectEqual(@as(u32, 2), chunk_rope.count());
    try std.testing.expectEqualStrings("A ", chunk_rope.get(0).?.data);
    try std.testing.expectEqualStrings("C", chunk_rope.get(1).?.data);

    // Verify metrics updated
    const metrics = chunk_rope.root.metrics();
    try std.testing.expectEqual(@as(u32, 3), metrics.custom.total_width); // 2 + 1
}

test "Nested Rope - walk through lines and chunks" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Create 3 lines with chunks
    const chunks1 = [_]Chunk{.{ .data = "Line1", .width = 5 }};
    const chunks2 = [_]Chunk{.{ .data = "Line2", .width = 5 }};
    const chunks3 = [_]Chunk{.{ .data = "Line3", .width = 5 }};

    const lines = [_]Line{
        .{ .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks1), .line_id = 1 },
        .{ .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks2), .line_id = 2 },
        .{ .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks3), .line_id = 3 },
    };
    var line_rope = try rope_mod.Rope(Line).from_slice(allocator, &lines);

    // Walk through lines
    const LineContext = struct {
        total_lines: u32 = 0,
        total_width: u32 = 0,

        fn walker(ctx: *anyopaque, line: *const Line, index: u32) rope_mod.Rope(Line).Node.WalkerResult {
            _ = index;
            const self = @as(*@This(), @ptrCast(@alignCast(ctx)));
            self.total_lines += 1;

            const metrics = line.chunks.root.metrics();
            self.total_width += metrics.custom.total_width;
            return .{};
        }
    };

    var ctx = LineContext{};
    try line_rope.walk(&ctx, LineContext.walker);

    try std.testing.expectEqual(@as(u32, 3), ctx.total_lines);
    try std.testing.expectEqual(@as(u32, 15), ctx.total_width); // 5 + 5 + 5
}

test "Nested Rope - complex line and chunk operations" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Add first line with chunks
    const chunks1 = [_]Chunk{
        .{ .data = "First ", .width = 6 },
        .{ .data = "line", .width = 4 },
    };
    const line1 = Line{
        .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks1),
        .line_id = 1,
    };

    // Create initial document structure with first line
    var line_rope = try rope_mod.Rope(Line).from_item(allocator, line1);

    // Add second line
    const chunks2 = [_]Chunk{.{ .data = "Second line", .width = 11 }};
    const line2 = Line{
        .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks2),
        .line_id = 2,
    };
    try line_rope.append(line2);

    // Verify structure
    try std.testing.expectEqual(@as(u32, 2), line_rope.count());

    // Access specific chunk in specific line
    const first_line = line_rope.get(0).?;
    try std.testing.expectEqual(@as(u32, 2), first_line.chunks.count());
    try std.testing.expectEqualStrings("First ", first_line.chunks.get(0).?.data);

    // Verify total metrics
    const metrics = line_rope.root.metrics();
    try std.testing.expectEqual(@as(u32, 2), metrics.count);
}

test "Nested Rope - metrics propagate through all levels" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Create lines with varying chunk counts
    const chunks1 = [_]Chunk{
        .{ .data = "abc", .width = 3 },
        .{ .data = "def", .width = 3 },
    };
    const chunks2 = [_]Chunk{
        .{ .data = "12345", .width = 5 },
    };
    const chunks3 = [_]Chunk{
        .{ .data = "x", .width = 1 },
        .{ .data = "y", .width = 1 },
        .{ .data = "z", .width = 1 },
    };

    const lines = [_]Line{
        .{ .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks1), .line_id = 1 },
        .{ .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks2), .line_id = 2 },
        .{ .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks3), .line_id = 3 },
    };
    var line_rope = try rope_mod.Rope(Line).from_slice(allocator, &lines);

    // Check that metrics correctly aggregate
    const line_metrics = line_rope.root.metrics();
    try std.testing.expectEqual(@as(u32, 3), line_metrics.count);

    // Verify individual line metrics
    const line1 = line_rope.get(0).?;
    const line1_metrics = line1.measure();
    try std.testing.expectEqual(@as(u32, 6), line1_metrics.total_width); // 3 + 3

    const line2 = line_rope.get(1).?;
    const line2_metrics = line2.measure();
    try std.testing.expectEqual(@as(u32, 5), line2_metrics.total_width);

    const line3 = line_rope.get(2).?;
    const line3_metrics = line3.measure();
    try std.testing.expectEqual(@as(u32, 3), line3_metrics.total_width); // 1 + 1 + 1
}

test "Nested Rope - simulate text buffer edit: insert within line" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Initial state: "Hello World"
    const initial_chunks = [_]Chunk{
        .{ .data = "Hello ", .width = 6 },
        .{ .data = "World", .width = 5 },
    };
    var chunk_rope = try rope_mod.Rope(Chunk).from_slice(allocator, &initial_chunks);

    // Insert "Beautiful " between chunks (simulating cursor at position 6)
    try chunk_rope.insert(1, .{ .data = "Beautiful ", .width = 10 });

    // Result should be: "Hello Beautiful World"
    try std.testing.expectEqual(@as(u32, 3), chunk_rope.count());

    // Verify order
    try std.testing.expectEqualStrings("Hello ", chunk_rope.get(0).?.data);
    try std.testing.expectEqualStrings("Beautiful ", chunk_rope.get(1).?.data);
    try std.testing.expectEqualStrings("World", chunk_rope.get(2).?.data);

    // Total width should be 21
    const metrics = chunk_rope.root.metrics();
    try std.testing.expectEqual(@as(u32, 21), metrics.custom.total_width);
}

test "Nested Rope - simulate text buffer edit: delete within line" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Initial: "Hello Beautiful World"
    const initial_chunks = [_]Chunk{
        .{ .data = "Hello ", .width = 6 },
        .{ .data = "Beautiful ", .width = 10 },
        .{ .data = "World", .width = 5 },
    };
    var chunk_rope = try rope_mod.Rope(Chunk).from_slice(allocator, &initial_chunks);

    // Delete "Beautiful " (middle chunk)
    try chunk_rope.delete(1);

    // Result: "Hello World"
    try std.testing.expectEqual(@as(u32, 2), chunk_rope.count());
    try std.testing.expectEqualStrings("Hello ", chunk_rope.get(0).?.data);
    try std.testing.expectEqualStrings("World", chunk_rope.get(1).?.data);

    const metrics = chunk_rope.root.metrics();
    try std.testing.expectEqual(@as(u32, 11), metrics.custom.total_width);
}

test "Nested Rope - insert line into document" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Create initial document with 2 lines
    const chunks1 = [_]Chunk{.{ .data = "Line 1", .width = 6 }};
    const chunks3 = [_]Chunk{.{ .data = "Line 3", .width = 6 }};

    const initial_lines = [_]Line{
        .{ .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks1), .line_id = 1 },
        .{ .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks3), .line_id = 3 },
    };
    var line_rope = try rope_mod.Rope(Line).from_slice(allocator, &initial_lines);

    // Insert line 2 in the middle
    const chunks2 = [_]Chunk{.{ .data = "Line 2", .width = 6 }};
    const line2 = Line{
        .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks2),
        .line_id = 2,
    };
    try line_rope.insert(1, line2);

    // Verify we have 3 lines in correct order
    try std.testing.expectEqual(@as(u32, 3), line_rope.count());
    try std.testing.expectEqual(@as(u32, 1), line_rope.get(0).?.line_id);
    try std.testing.expectEqual(@as(u32, 2), line_rope.get(1).?.line_id);
    try std.testing.expectEqual(@as(u32, 3), line_rope.get(2).?.line_id);
}

test "Nested Rope - delete line from document" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Create document with 3 lines
    const chunks1 = [_]Chunk{.{ .data = "Line 1", .width = 6 }};
    const chunks2 = [_]Chunk{.{ .data = "Line 2", .width = 6 }};
    const chunks3 = [_]Chunk{.{ .data = "Line 3", .width = 6 }};

    const lines = [_]Line{
        .{ .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks1), .line_id = 1 },
        .{ .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks2), .line_id = 2 },
        .{ .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks3), .line_id = 3 },
    };
    var line_rope = try rope_mod.Rope(Line).from_slice(allocator, &lines);

    // Delete middle line
    try line_rope.delete(1);

    try std.testing.expectEqual(@as(u32, 2), line_rope.count());
    try std.testing.expectEqual(@as(u32, 1), line_rope.get(0).?.line_id);
    try std.testing.expectEqual(@as(u32, 3), line_rope.get(1).?.line_id);
}

test "Nested Rope - modify chunks within a specific line" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Create line with chunks
    const initial_chunks = [_]Chunk{
        .{ .data = "Hello", .width = 5 },
    };
    var chunk_rope = try rope_mod.Rope(Chunk).from_slice(allocator, &initial_chunks);

    // Simulate typing: insert " World" at end
    try chunk_rope.insert(1, .{ .data = " World", .width = 6 });

    const line = Line{
        .chunks = chunk_rope,
        .line_id = 1,
    };

    // Create document
    const lines = [_]Line{line};
    var line_rope = try rope_mod.Rope(Line).from_slice(allocator, &lines);

    // Access the line and verify chunks
    const retrieved_line = line_rope.get(0).?;
    try std.testing.expectEqual(@as(u32, 2), retrieved_line.chunks.count());
    try std.testing.expectEqualStrings("Hello", retrieved_line.chunks.get(0).?.data);
    try std.testing.expectEqualStrings(" World", retrieved_line.chunks.get(1).?.data);

    // Total line width should be 11
    const line_metrics = retrieved_line.measure();
    try std.testing.expectEqual(@as(u32, 11), line_metrics.total_width);
}

test "Nested Rope - walk all chunks in all lines" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Create 2 lines with multiple chunks each
    const chunks1 = [_]Chunk{
        .{ .data = "A", .width = 1 },
        .{ .data = "B", .width = 1 },
    };
    const chunks2 = [_]Chunk{
        .{ .data = "C", .width = 1 },
        .{ .data = "D", .width = 1 },
        .{ .data = "E", .width = 1 },
    };

    const lines = [_]Line{
        .{ .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks1), .line_id = 1 },
        .{ .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks2), .line_id = 2 },
    };
    var line_rope = try rope_mod.Rope(Line).from_slice(allocator, &lines);

    // Walk through all lines and all chunks
    var total_chunks: u32 = 0;
    var total_bytes: u32 = 0;

    const LineWalker = struct {
        fn walk(ctx: *anyopaque, line: *const Line, index: u32) rope_mod.Rope(Line).Node.WalkerResult {
            _ = index;
            const counters = @as(*[2]u32, @ptrCast(@alignCast(ctx)));

            // Count chunks in this line
            const ChunkWalker = struct {
                fn walk(chunk_ctx: *anyopaque, chunk: *const Chunk, chunk_idx: u32) rope_mod.Rope(Chunk).Node.WalkerResult {
                    _ = chunk_idx;
                    const chunk_counters = @as(*[2]u32, @ptrCast(@alignCast(chunk_ctx)));
                    chunk_counters[0] += 1; // total_chunks
                    chunk_counters[1] += @intCast(chunk.data.len); // total_bytes
                    return .{};
                }
            };

            line.chunks.walk(counters, ChunkWalker.walk) catch {};
            return .{};
        }
    };

    var counters = [2]u32{ total_chunks, total_bytes };
    try line_rope.walk(&counters, LineWalker.walk);
    total_chunks = counters[0];
    total_bytes = counters[1];

    try std.testing.expectEqual(@as(u32, 5), total_chunks); // 2 + 3
    try std.testing.expectEqual(@as(u32, 5), total_bytes); // All single char chunks
}

test "Nested Rope - simulate full text buffer workflow" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Add first line: "Hello World"
    const chunks1 = [_]Chunk{
        .{ .data = "Hello ", .width = 6 },
        .{ .data = "World", .width = 5 },
    };
    const line1 = Line{
        .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks1),
        .line_id = 1,
    };

    // Start with document containing first line
    var document = try rope_mod.Rope(Line).from_item(allocator, line1);

    // Add second line: "Goodbye"
    const chunks2 = [_]Chunk{.{ .data = "Goodbye", .width = 7 }};
    const line2 = Line{
        .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks2),
        .line_id = 2,
    };
    try document.append(line2);

    // Verify document structure
    try std.testing.expectEqual(@as(u32, 2), document.count());

    // Get line 1 and verify it has 2 chunks
    const retrieved_line1 = document.get(0).?;
    try std.testing.expectEqual(@as(u32, 2), retrieved_line1.chunks.count());

    // Get line 2 and verify it has 1 chunk
    const retrieved_line2 = document.get(1).?;
    try std.testing.expectEqual(@as(u32, 1), retrieved_line2.chunks.count());

    // Now simulate editing: insert a chunk into line 1
    // We need to recreate the line since ropes are persistent
    var modified_chunks = retrieved_line1.chunks;
    try modified_chunks.insert(1, .{ .data = "Beautiful ", .width = 10 });

    // Create new line with modified chunks
    const modified_line = Line{
        .chunks = modified_chunks,
        .line_id = 1,
    };

    // Note: In a real text buffer, you'd replace the line in the document
    // For now, just verify the modified line has the new chunk
    try std.testing.expectEqual(@as(u32, 3), modified_line.chunks.count());
    try std.testing.expectEqualStrings("Beautiful ", modified_line.chunks.get(1).?.data);
}

test "Nested Rope - empty lines with no chunks" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Create an empty line (no chunks)
    const empty_chunks: []const Chunk = &[_]Chunk{};
    const empty_line = Line{
        .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, empty_chunks),
        .line_id = 1,
    };

    // Create line with content
    const chunks = [_]Chunk{.{ .data = "Content", .width = 7 }};
    const content_line = Line{
        .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks),
        .line_id = 2,
    };

    const lines = [_]Line{ empty_line, content_line };
    var line_rope = try rope_mod.Rope(Line).from_slice(allocator, &lines);

    try std.testing.expectEqual(@as(u32, 2), line_rope.count());

    // Empty line should have 0 chunks (sentinel filtered)
    const empty = line_rope.get(0).?;
    try std.testing.expectEqual(@as(u32, 0), empty.chunks.count());

    // Content line should have 1 chunk
    const content = line_rope.get(1).?;
    try std.testing.expectEqual(@as(u32, 1), content.chunks.count());
    try std.testing.expectEqualStrings("Content", content.chunks.get(0).?.data);
}

test "Nested Rope - large document with many lines and chunks" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Create 20 lines, each with 3 chunks
    var lines_array: [20]Line = undefined;
    for (&lines_array, 0..) |*line, line_idx| {
        var chunks_array: [3]Chunk = undefined;
        for (&chunks_array, 0..) |*chunk, chunk_idx| {
            chunk.* = .{
                .data = "X",
                .width = 1,
            };
            _ = chunk_idx;
        }
        line.* = Line{
            .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks_array),
            .line_id = @intCast(line_idx),
        };
    }

    var document = try rope_mod.Rope(Line).from_slice(allocator, &lines_array);

    // Verify structure
    try std.testing.expectEqual(@as(u32, 20), document.count());

    // Random access to lines
    const line_5 = document.get(5).?;
    try std.testing.expectEqual(@as(u32, 5), line_5.line_id);
    try std.testing.expectEqual(@as(u32, 3), line_5.chunks.count());

    const line_15 = document.get(15).?;
    try std.testing.expectEqual(@as(u32, 15), line_15.line_id);

    // Access chunk within a line
    try std.testing.expectEqualStrings("X", line_5.chunks.get(0).?.data);
}

test "Nested Rope - walk_from specific line" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Create 5 lines
    var lines_array: [5]Line = undefined;
    for (&lines_array, 0..) |*line, i| {
        const chunks = [_]Chunk{.{ .data = "X", .width = 1 }};
        line.* = Line{
            .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks),
            .line_id = @intCast(i),
        };
    }
    var document = try rope_mod.Rope(Line).from_slice(allocator, &lines_array);

    // Walk from line 3
    const Context = struct {
        count: u32 = 0,
        first_id: ?u32 = null,

        fn walker(ctx: *anyopaque, line: *const Line, index: u32) rope_mod.Rope(Line).Node.WalkerResult {
            _ = index;
            const self = @as(*@This(), @ptrCast(@alignCast(ctx)));
            if (self.first_id == null) {
                self.first_id = line.line_id;
            }
            self.count += 1;
            return .{};
        }
    };

    var ctx = Context{};
    try document.walk_from(3, &ctx, Context.walker);

    // Should walk lines 3 and 4 (indices 3 and 4)
    try std.testing.expectEqual(@as(u32, 2), ctx.count);
    try std.testing.expectEqual(@as(u32, 3), ctx.first_id.?);
}

test "Nested Rope - metrics aggregate correctly through all levels" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Line 1: 3 chunks, total width 10
    const chunks1 = [_]Chunk{
        .{ .data = "abc", .width = 3 },
        .{ .data = "def", .width = 3 },
        .{ .data = "ghij", .width = 4 },
    };

    // Line 2: 2 chunks, total width 15
    const chunks2 = [_]Chunk{
        .{ .data = "12345", .width = 5 },
        .{ .data = "6789012345", .width = 10 },
    };

    const lines = [_]Line{
        .{ .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks1), .line_id = 1 },
        .{ .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks2), .line_id = 2 },
    };
    var document = try rope_mod.Rope(Line).from_slice(allocator, &lines);

    // Check chunk-level metrics
    const line1 = document.get(0).?;
    const chunk_metrics1 = line1.chunks.root.metrics();
    try std.testing.expectEqual(@as(u32, 3), chunk_metrics1.count);
    try std.testing.expectEqual(@as(u32, 10), chunk_metrics1.custom.total_width);
    try std.testing.expectEqual(@as(u32, 10), chunk_metrics1.custom.total_bytes);

    const line2 = document.get(1).?;
    const chunk_metrics2 = line2.chunks.root.metrics();
    try std.testing.expectEqual(@as(u32, 2), chunk_metrics2.count);
    try std.testing.expectEqual(@as(u32, 15), chunk_metrics2.custom.total_width);
    try std.testing.expectEqual(@as(u32, 15), chunk_metrics2.custom.total_bytes);

    // Check line-level metrics
    const line1_metrics = line1.measure();
    try std.testing.expectEqual(@as(u32, 10), line1_metrics.total_width);

    // Check document-level metrics
    const doc_metrics = document.root.metrics();
    try std.testing.expectEqual(@as(u32, 2), doc_metrics.count); // 2 lines
}

test "Nested Rope - O(log n) access to deeply nested data" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Create a document with 100 lines, each with 5 chunks
    var lines_array: [100]Line = undefined;
    for (&lines_array, 0..) |*line, line_idx| {
        var chunks_array: [5]Chunk = undefined;
        for (&chunks_array, 0..) |*chunk, chunk_idx| {
            chunk.* = .{
                .data = "c",
                .width = 1,
            };
            _ = chunk_idx;
        }
        line.* = Line{
            .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks_array),
            .line_id = @intCast(line_idx),
        };
    }

    var document = try rope_mod.Rope(Line).from_slice(allocator, &lines_array);

    // Access line 50, chunk 3 (deep in the tree)
    // This tests O(log lines) + O(log chunks) access
    const line_50 = document.get(50).?;
    try std.testing.expectEqual(@as(u32, 50), line_50.line_id);

    const chunk_3 = line_50.chunks.get(3).?;
    try std.testing.expectEqualStrings("c", chunk_3.data);

    // Verify tree depth is logarithmic
    const doc_depth = document.root.depth();
    try std.testing.expect(doc_depth < 20); // log2(100) ≈ 7, with some buffer

    const line_depth = line_50.chunks.root.depth();
    try std.testing.expect(line_depth < 10); // log2(5) ≈ 3, with buffer
}

//===== ArrayRope Tests (API Compatibility) =====

test "ArrayRope - same interface as Rope: from_slice" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
        .{ .value = 3 },
    };

    // ArrayRope should work the same as Rope
    var array_rope = try array_rope_mod.ArrayRope(SimpleItem).from_slice(allocator, &items);

    try std.testing.expectEqual(@as(u32, 3), array_rope.count());
    try std.testing.expectEqual(@as(u32, 1), array_rope.get(0).?.value);
    try std.testing.expectEqual(@as(u32, 2), array_rope.get(1).?.value);
    try std.testing.expectEqual(@as(u32, 3), array_rope.get(2).?.value);
}

test "ArrayRope - same interface as Rope: get" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var array_rope = try array_rope_mod.ArrayRope(SimpleItem).from_item(allocator, .{ .value = 42 });

    try std.testing.expectEqual(@as(u32, 1), array_rope.count());
    const item = array_rope.get(0);
    try std.testing.expect(item != null);
    try std.testing.expectEqual(@as(u32, 42), item.?.value);
}

test "ArrayRope - same interface as Rope: walk" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    const items = [_]SimpleItem{
        .{ .value = 10 },
        .{ .value = 20 },
        .{ .value = 30 },
    };
    var array_rope = try array_rope_mod.ArrayRope(SimpleItem).from_slice(allocator, &items);

    const Context = struct {
        sum: u32 = 0,

        fn walker(ctx: *anyopaque, data: *const SimpleItem, index: u32) array_rope_mod.ArrayRope(SimpleItem).Node.WalkerResult {
            _ = index;
            const self = @as(*@This(), @ptrCast(@alignCast(ctx)));
            self.sum += data.value;
            return .{};
        }
    };

    var ctx = Context{};
    try array_rope.walk(&ctx, Context.walker);

    try std.testing.expectEqual(@as(u32, 60), ctx.sum);
}

test "ArrayRope - same interface as Rope: metrics" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    const items = [_]ItemWithMetrics{
        .{ .value = 1, .size = 10 },
        .{ .value = 2, .size = 20 },
        .{ .value = 3, .size = 30 },
    };
    var array_rope = try array_rope_mod.ArrayRope(ItemWithMetrics).from_slice(allocator, &items);

    const metrics = array_rope.root().metrics();
    try std.testing.expectEqual(@as(u32, 3), metrics.count);
    try std.testing.expectEqual(@as(u32, 60), metrics.custom.total_size);
}

test "ArrayRope - O(1) access (much faster than Rope)" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Create 1000 items
    var items: [1000]SimpleItem = undefined;
    for (&items, 0..) |*item, i| {
        item.* = .{ .value = @intCast(i) };
    }

    var array_rope = try array_rope_mod.ArrayRope(SimpleItem).from_slice(allocator, &items);

    // All accesses are O(1) - no tree traversal!
    try std.testing.expectEqual(@as(u32, 0), array_rope.get(0).?.value);
    try std.testing.expectEqual(@as(u32, 500), array_rope.get(500).?.value);
    try std.testing.expectEqual(@as(u32, 999), array_rope.get(999).?.value);
}

test "ArrayRope vs Rope - interchangeable for read-only" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
        .{ .value = 3 },
    };

    // Both should work the same for reading
    var real_rope = try rope_mod.Rope(SimpleItem).from_slice(allocator, &items);
    var array_rope = try array_rope_mod.ArrayRope(SimpleItem).from_slice(allocator, &items);

    // Same count
    try std.testing.expectEqual(real_rope.count(), array_rope.count());

    // Same data access
    try std.testing.expectEqual(real_rope.get(0).?.value, array_rope.get(0).?.value);
    try std.testing.expectEqual(real_rope.get(1).?.value, array_rope.get(1).?.value);
    try std.testing.expectEqual(real_rope.get(2).?.value, array_rope.get(2).?.value);
}

test "ArrayRope - nested with chunks (rendering use case)" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Line using ArrayRope for read-only chunk access
    const LineWithArrayChunks = struct {
        chunks: array_rope_mod.ArrayRope(Chunk),
        line_id: u32,

        pub const Metrics = struct {
            total_width: u32 = 0,
            pub fn add(self: *Metrics, other: Metrics) void {
                self.total_width += other.total_width;
            }
        };

        pub fn measure(self: *const @This()) Metrics {
            const chunk_metrics = self.chunks.root().metrics();
            return .{ .total_width = chunk_metrics.custom.total_width };
        }
    };

    // Create line with chunks using ArrayRope
    const chunks = [_]Chunk{
        .{ .data = "Hello ", .width = 6 },
        .{ .data = "World", .width = 5 },
    };

    const line = LineWithArrayChunks{
        .chunks = try array_rope_mod.ArrayRope(Chunk).from_slice(allocator, &chunks),
        .line_id = 1,
    };

    // O(1) access to chunks - no tree traversal!
    try std.testing.expectEqual(@as(u32, 2), line.chunks.count());
    try std.testing.expectEqualStrings("Hello ", line.chunks.get(0).?.data);
    try std.testing.expectEqualStrings("World", line.chunks.get(1).?.data);

    // Metrics work the same
    const metrics = line.measure();
    try std.testing.expectEqual(@as(u32, 11), metrics.total_width);
}

test "Rope - replace item at index" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
        .{ .value = 3 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    try rope.replace(1, .{ .value = 20 });

    try std.testing.expectEqual(@as(u32, 3), rope.count());
    try std.testing.expectEqual(@as(u32, 1), rope.get(0).?.value);
    try std.testing.expectEqual(@as(u32, 20), rope.get(1).?.value);
    try std.testing.expectEqual(@as(u32, 3), rope.get(2).?.value);
}

test "Rope - append item" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 1 });

    try rope.append(.{ .value = 2 });
    try rope.append(.{ .value = 3 });

    try std.testing.expectEqual(@as(u32, 3), rope.count());
    try std.testing.expectEqual(@as(u32, 1), rope.get(0).?.value);
    try std.testing.expectEqual(@as(u32, 2), rope.get(1).?.value);
    try std.testing.expectEqual(@as(u32, 3), rope.get(2).?.value);
}

test "Rope - prepend item" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 3 });

    try rope.prepend(.{ .value = 2 });
    try rope.prepend(.{ .value = 1 });

    try std.testing.expectEqual(@as(u32, 3), rope.count());
    try std.testing.expectEqual(@as(u32, 1), rope.get(0).?.value);
    try std.testing.expectEqual(@as(u32, 2), rope.get(1).?.value);
    try std.testing.expectEqual(@as(u32, 3), rope.get(2).?.value);
}

test "Rope - concatenate two ropes" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);

    const items1 = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
    };
    var rope1 = try RopeType.from_slice(arena.allocator(), &items1);

    const items2 = [_]SimpleItem{
        .{ .value = 3 },
        .{ .value = 4 },
    };
    const rope2 = try RopeType.from_slice(arena.allocator(), &items2);

    try rope1.concat(&rope2);

    try std.testing.expectEqual(@as(u32, 4), rope1.count());
    try std.testing.expectEqual(@as(u32, 1), rope1.get(0).?.value);
    try std.testing.expectEqual(@as(u32, 2), rope1.get(1).?.value);
    try std.testing.expectEqual(@as(u32, 3), rope1.get(2).?.value);
    try std.testing.expectEqual(@as(u32, 4), rope1.get(3).?.value);
}

//===== Undo/Redo Tests =====

test "Rope - basic undo operation" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 1 });

    // Store initial state
    try rope.store_undo("initial");

    // Modify
    try rope.insert(1, .{ .value = 2 });
    try std.testing.expectEqual(@as(u32, 2), rope.count());

    // Undo
    const meta = try rope.undo("before undo");
    try std.testing.expectEqualStrings("initial", meta);
    try std.testing.expectEqual(@as(u32, 1), rope.count());
}

test "Rope - basic redo operation" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 1 });

    // Store and modify
    try rope.store_undo("initial");
    try rope.insert(1, .{ .value = 2 });

    // Undo then redo
    _ = try rope.undo("before undo");
    try std.testing.expectEqual(@as(u32, 1), rope.count());

    const meta = try rope.redo();
    try std.testing.expectEqualStrings("before undo", meta);
    try std.testing.expectEqual(@as(u32, 2), rope.count());
}

test "Rope - multiple undo/redo operations" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 1 });

    // Build up history
    try rope.store_undo("state1");
    try rope.append(.{ .value = 2 });

    try rope.store_undo("state2");
    try rope.append(.{ .value = 3 });

    try rope.store_undo("state3");
    try rope.append(.{ .value = 4 });

    try std.testing.expectEqual(@as(u32, 4), rope.count());

    // Undo twice
    _ = try rope.undo("current");
    try std.testing.expectEqual(@as(u32, 3), rope.count());

    _ = try rope.undo("current");
    try std.testing.expectEqual(@as(u32, 2), rope.count());

    // Redo once
    _ = try rope.redo();
    try std.testing.expectEqual(@as(u32, 3), rope.count());
}

test "Rope - undo/redo with delete operations" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
        .{ .value = 3 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    try rope.store_undo("before delete");
    try rope.delete(1); // Delete middle item

    try std.testing.expectEqual(@as(u32, 2), rope.count());
    try std.testing.expectEqual(@as(u32, 1), rope.get(0).?.value);
    try std.testing.expectEqual(@as(u32, 3), rope.get(1).?.value);

    // Undo delete
    _ = try rope.undo("after delete");
    try std.testing.expectEqual(@as(u32, 3), rope.count());
    try std.testing.expectEqual(@as(u32, 2), rope.get(1).?.value);
}

test "Rope - undo/redo with replace operations" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 10 });

    try rope.store_undo("original");
    try rope.replace(0, .{ .value = 20 });
    try std.testing.expectEqual(@as(u32, 20), rope.get(0).?.value);

    _ = try rope.undo("after replace");
    try std.testing.expectEqual(@as(u32, 10), rope.get(0).?.value);

    _ = try rope.redo();
    try std.testing.expectEqual(@as(u32, 20), rope.get(0).?.value);
}

test "Rope - can_undo and can_redo" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 1 });

    // Initially no undo/redo available
    try std.testing.expect(!rope.can_undo());
    try std.testing.expect(!rope.can_redo());

    // After storing undo
    try rope.store_undo("state1");
    try std.testing.expect(rope.can_undo());
    try std.testing.expect(!rope.can_redo());

    // After undo
    _ = try rope.undo("current");
    try std.testing.expect(!rope.can_undo()); // No more undo (only one state)
    try std.testing.expect(rope.can_redo());
}

test "Rope - clear history" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 1 });

    try rope.store_undo("state1");
    try rope.append(.{ .value = 2 });
    try rope.store_undo("state2");

    try std.testing.expect(rope.can_undo());

    rope.clear_history();
    try std.testing.expect(!rope.can_undo());
    try std.testing.expect(!rope.can_redo());
}

test "Rope - undo fails when no history" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 1 });

    // No history stored, undo should fail
    const result = rope.undo("current");
    try std.testing.expectError(error.Stop, result);
}

test "Rope - redo fails when no redo history" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 1 });

    // No redo history, redo should fail
    const result = rope.redo();
    try std.testing.expectError(error.Stop, result);
}

test "Rope - complex undo/redo workflow" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.init(arena.allocator());

    // Build up a sequence of operations
    try rope.store_undo("empty");
    try rope.insert(0, .{ .value = 1 });

    try rope.store_undo("one item");
    try rope.append(.{ .value = 2 });

    try rope.store_undo("two items");
    try rope.append(.{ .value = 3 });

    try rope.store_undo("three items");
    try rope.delete(1); // Remove middle

    // State: [1, 3]
    try std.testing.expectEqual(@as(u32, 2), rope.count()); // Sentinel filtered

    // Undo delete
    _ = try rope.undo("current");
    try std.testing.expectEqual(@as(u32, 3), rope.count());

    // Undo append
    _ = try rope.undo("current");
    try std.testing.expectEqual(@as(u32, 2), rope.count());

    // Redo append
    _ = try rope.redo();
    try std.testing.expectEqual(@as(u32, 3), rope.count());
}

test "Rope - undo/redo with metadata tracking" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 1 });

    try rope.store_undo("insert operation");
    try rope.append(.{ .value = 2 });

    try rope.store_undo("delete operation");
    try rope.delete(0);

    // Undo and check metadata
    const meta1 = try rope.undo("current state");
    try std.testing.expectEqualStrings("delete operation", meta1);

    const meta2 = try rope.undo("current state");
    try std.testing.expectEqualStrings("insert operation", meta2);
}

test "Rope - undo invalidates redo after new operation" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 1 });

    try rope.store_undo("state1");
    try rope.append(.{ .value = 2 });

    try rope.store_undo("state2");
    try rope.append(.{ .value = 3 });

    // Undo once
    _ = try rope.undo("current");
    try std.testing.expect(rope.can_redo());

    // Make a new change - this stores the old redo as a branch and clears redo
    try rope.store_undo("new branch");
    try rope.append(.{ .value = 99 });

    // Redo should NOT work anymore (it was saved as a branch)
    try std.testing.expect(!rope.can_redo());

    // But we can still undo
    try std.testing.expect(rope.can_undo());
}

test "Rope - undo/redo with nested ropes" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Create first line
    const chunks1 = [_]Chunk{.{ .data = "Line 1", .width = 6 }};
    const line1 = Line{
        .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks1),
        .line_id = 1,
    };

    const RopeType = rope_mod.Rope(Line);
    var rope = try RopeType.from_item(allocator, line1);

    try rope.store_undo("before append");

    // Add second line
    const chunks2 = [_]Chunk{.{ .data = "Line 2", .width = 6 }};
    const line2 = Line{
        .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks2),
        .line_id = 2,
    };
    try rope.append(line2);

    try std.testing.expectEqual(@as(u32, 2), rope.count());

    // Undo
    _ = try rope.undo("after append");
    try std.testing.expectEqual(@as(u32, 1), rope.count());

    // Redo
    _ = try rope.redo();
    try std.testing.expectEqual(@as(u32, 2), rope.count());
}

test "Rope - stress test undo/redo with many operations" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.init(arena.allocator());

    // Perform 20 operations
    for (0..20) |i| {
        try rope.store_undo("operation");
        try rope.append(.{ .value = @intCast(i) });
    }

    try std.testing.expectEqual(@as(u32, 20), rope.count()); // Sentinel filtered

    // Undo 10 operations
    for (0..10) |_| {
        _ = try rope.undo("current");
    }
    try std.testing.expectEqual(@as(u32, 10), rope.count());

    // Redo 5 operations
    for (0..5) |_| {
        _ = try rope.redo();
    }
    try std.testing.expectEqual(@as(u32, 15), rope.count());
}

//===== Bulk/Range Operations Tests =====

test "Rope - split at beginning" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
        .{ .value = 3 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    const right = try rope.split(0);

    try std.testing.expectEqual(@as(u32, 0), rope.count()); // Sentinel filtered
    try std.testing.expectEqual(@as(u32, 3), right.count());
    try std.testing.expectEqual(@as(u32, 1), right.get(0).?.value);
}

test "Rope - split at middle" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
        .{ .value = 3 },
        .{ .value = 4 },
        .{ .value = 5 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    const right = try rope.split(2);

    try std.testing.expectEqual(@as(u32, 2), rope.count());
    try std.testing.expectEqual(@as(u32, 1), rope.get(0).?.value);
    try std.testing.expectEqual(@as(u32, 2), rope.get(1).?.value);

    try std.testing.expectEqual(@as(u32, 3), right.count());
    try std.testing.expectEqual(@as(u32, 3), right.get(0).?.value);
    try std.testing.expectEqual(@as(u32, 4), right.get(1).?.value);
    try std.testing.expectEqual(@as(u32, 5), right.get(2).?.value);
}

test "Rope - split at end" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
        .{ .value = 3 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    const right = try rope.split(3);

    try std.testing.expectEqual(@as(u32, 3), rope.count());
    try std.testing.expectEqual(@as(u32, 0), right.count()); // Sentinel filtered
}

test "Rope - slice full range" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
        .{ .value = 3 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    const sliced = try rope.slice(0, 3, arena.allocator());
    defer arena.allocator().free(sliced);

    try std.testing.expectEqual(@as(usize, 3), sliced.len);
    try std.testing.expectEqual(@as(u32, 1), sliced[0].value);
    try std.testing.expectEqual(@as(u32, 2), sliced[1].value);
    try std.testing.expectEqual(@as(u32, 3), sliced[2].value);
}

test "Rope - slice partial range" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 10 },
        .{ .value = 20 },
        .{ .value = 30 },
        .{ .value = 40 },
        .{ .value = 50 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    const sliced = try rope.slice(1, 4, arena.allocator());
    defer arena.allocator().free(sliced);

    try std.testing.expectEqual(@as(usize, 3), sliced.len);
    try std.testing.expectEqual(@as(u32, 20), sliced[0].value);
    try std.testing.expectEqual(@as(u32, 30), sliced[1].value);
    try std.testing.expectEqual(@as(u32, 40), sliced[2].value);
}

test "Rope - slice empty range" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    const sliced = try rope.slice(1, 1, arena.allocator());
    defer arena.allocator().free(sliced);

    try std.testing.expectEqual(@as(usize, 0), sliced.len);
}

test "Rope - delete_range at beginning" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
        .{ .value = 3 },
        .{ .value = 4 },
        .{ .value = 5 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    try rope.delete_range(0, 2);

    try std.testing.expectEqual(@as(u32, 3), rope.count());
    try std.testing.expectEqual(@as(u32, 3), rope.get(0).?.value);
    try std.testing.expectEqual(@as(u32, 4), rope.get(1).?.value);
    try std.testing.expectEqual(@as(u32, 5), rope.get(2).?.value);
}

test "Rope - delete_range in middle" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
        .{ .value = 3 },
        .{ .value = 4 },
        .{ .value = 5 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    try rope.delete_range(1, 4);

    try std.testing.expectEqual(@as(u32, 2), rope.count());
    try std.testing.expectEqual(@as(u32, 1), rope.get(0).?.value);
    try std.testing.expectEqual(@as(u32, 5), rope.get(1).?.value);
}

test "Rope - delete_range at end" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
        .{ .value = 3 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    try rope.delete_range(1, 3);

    try std.testing.expectEqual(@as(u32, 1), rope.count());
    try std.testing.expectEqual(@as(u32, 1), rope.get(0).?.value);
}

test "Rope - delete_range empty (same indices)" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    try rope.delete_range(1, 1);

    try std.testing.expectEqual(@as(u32, 2), rope.count());
}

test "Rope - insert_slice at beginning" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 3 });

    const to_insert = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
    };
    try rope.insert_slice(0, &to_insert);

    try std.testing.expectEqual(@as(u32, 3), rope.count());
    try std.testing.expectEqual(@as(u32, 1), rope.get(0).?.value);
    try std.testing.expectEqual(@as(u32, 2), rope.get(1).?.value);
    try std.testing.expectEqual(@as(u32, 3), rope.get(2).?.value);
}

test "Rope - insert_slice in middle" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 4 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    const to_insert = [_]SimpleItem{
        .{ .value = 2 },
        .{ .value = 3 },
    };
    try rope.insert_slice(1, &to_insert);

    try std.testing.expectEqual(@as(u32, 4), rope.count());
    try std.testing.expectEqual(@as(u32, 1), rope.get(0).?.value);
    try std.testing.expectEqual(@as(u32, 2), rope.get(1).?.value);
    try std.testing.expectEqual(@as(u32, 3), rope.get(2).?.value);
    try std.testing.expectEqual(@as(u32, 4), rope.get(3).?.value);
}

test "Rope - insert_slice at end" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    const to_insert = [_]SimpleItem{
        .{ .value = 3 },
        .{ .value = 4 },
    };
    try rope.insert_slice(2, &to_insert);

    try std.testing.expectEqual(@as(u32, 4), rope.count());
    try std.testing.expectEqual(@as(u32, 3), rope.get(2).?.value);
    try std.testing.expectEqual(@as(u32, 4), rope.get(3).?.value);
}

test "Rope - insert_slice empty array" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 1 });

    const to_insert: []const SimpleItem = &[_]SimpleItem{};
    try rope.insert_slice(0, to_insert);

    try std.testing.expectEqual(@as(u32, 1), rope.count());
}

test "Rope - to_array with simple items" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 10 },
        .{ .value = 20 },
        .{ .value = 30 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    const array = try rope.to_array(arena.allocator());
    defer arena.allocator().free(array);

    try std.testing.expectEqual(@as(usize, 3), array.len);
    try std.testing.expectEqual(@as(u32, 10), array[0].value);
    try std.testing.expectEqual(@as(u32, 20), array[1].value);
    try std.testing.expectEqual(@as(u32, 30), array[2].value);
}

test "Rope - to_array empty rope" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.init(arena.allocator());

    const array = try rope.to_array(arena.allocator());
    defer arena.allocator().free(array);

    try std.testing.expectEqual(@as(usize, 0), array.len); // Sentinel filtered
}

test "Rope - combined bulk operations" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
        .{ .value = 3 },
        .{ .value = 4 },
        .{ .value = 5 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    // Delete middle range
    try rope.delete_range(2, 4);
    try std.testing.expectEqual(@as(u32, 3), rope.count());

    // Insert slice in middle
    const to_insert = [_]SimpleItem{
        .{ .value = 30 },
        .{ .value = 40 },
    };
    try rope.insert_slice(1, &to_insert);
    try std.testing.expectEqual(@as(u32, 5), rope.count());

    // Verify final state
    const array = try rope.to_array(arena.allocator());
    defer arena.allocator().free(array);

    try std.testing.expectEqual(@as(u32, 1), array[0].value);
    try std.testing.expectEqual(@as(u32, 30), array[1].value);
    try std.testing.expectEqual(@as(u32, 40), array[2].value);
    try std.testing.expectEqual(@as(u32, 2), array[3].value);
    try std.testing.expectEqual(@as(u32, 5), array[4].value);
}

test "Rope - undo/redo with bulk operations" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
        .{ .value = 3 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    // Store state
    try rope.store_undo("before bulk");

    // Bulk insert
    const to_insert = [_]SimpleItem{
        .{ .value = 10 },
        .{ .value = 20 },
    };
    try rope.insert_slice(1, &to_insert);
    try std.testing.expectEqual(@as(u32, 5), rope.count());

    // Undo
    _ = try rope.undo("after bulk");
    try std.testing.expectEqual(@as(u32, 3), rope.count());

    // Redo
    _ = try rope.redo();
    try std.testing.expectEqual(@as(u32, 5), rope.count());
}

//===== Edge Case Tests =====

test "Rope - slice with start > end returns empty" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
        .{ .value = 3 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    const sliced = try rope.slice(2, 1, arena.allocator());
    defer arena.allocator().free(sliced);

    try std.testing.expectEqual(@as(usize, 0), sliced.len);
}

test "Rope - slice beyond bounds" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    // Should only get items that exist
    const sliced = try rope.slice(0, 100, arena.allocator());
    defer arena.allocator().free(sliced);

    try std.testing.expectEqual(@as(usize, 2), sliced.len);
}

test "Rope - delete_range with start > end does nothing" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    try rope.delete_range(2, 1);

    try std.testing.expectEqual(@as(u32, 2), rope.count());
}

test "Rope - insert_slice beyond count appends" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 1 });

    const to_insert = [_]SimpleItem{
        .{ .value = 2 },
        .{ .value = 3 },
    };
    try rope.insert_slice(100, &to_insert);

    try std.testing.expectEqual(@as(u32, 3), rope.count());
    try std.testing.expectEqual(@as(u32, 2), rope.get(1).?.value);
    try std.testing.expectEqual(@as(u32, 3), rope.get(2).?.value);
}

test "Rope - replace at out of bounds does nothing" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 1 });

    try rope.replace(100, .{ .value = 999 });

    try std.testing.expectEqual(@as(u32, 1), rope.count());
    try std.testing.expectEqual(@as(u32, 1), rope.get(0).?.value);
}

test "Rope - delete at out of bounds" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 1 });

    // This should handle gracefully (delete beyond bounds)
    try rope.delete(100);

    // Count unchanged
    try std.testing.expectEqual(@as(u32, 1), rope.count());
}

test "Rope - split at zero creates empty left" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    const right = try rope.split(0);

    try std.testing.expectEqual(@as(u32, 0), rope.count()); // Sentinel filtered
    try std.testing.expectEqual(@as(u32, 2), right.count());
}

test "Rope - split beyond count" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    const items = [_]SimpleItem{
        .{ .value = 1 },
        .{ .value = 2 },
    };
    var rope = try RopeType.from_slice(arena.allocator(), &items);

    const right = try rope.split(100);

    try std.testing.expectEqual(@as(u32, 2), rope.count());
    try std.testing.expectEqual(@as(u32, 0), right.count()); // Sentinel filtered
}

test "Rope - multiple undo without operations" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 1 });

    try rope.store_undo("state1");
    try rope.store_undo("state2");

    // Two undos back to back
    _ = try rope.undo("current");
    _ = try rope.undo("current");

    // Should fail on third
    const result = rope.undo("current");
    try std.testing.expectError(error.Stop, result);
}

test "Rope - stress test with 1000 items" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var items: [1000]SimpleItem = undefined;
    for (&items, 0..) |*item, i| {
        item.* = .{ .value = @intCast(i) };
    }

    var rope = try RopeType.from_slice(arena.allocator(), &items);

    try std.testing.expectEqual(@as(u32, 1000), rope.count());
    try std.testing.expectEqual(@as(u32, 0), rope.get(0).?.value);
    try std.testing.expectEqual(@as(u32, 500), rope.get(500).?.value);
    try std.testing.expectEqual(@as(u32, 999), rope.get(999).?.value);

    // Test that tree is reasonably balanced
    const depth = rope.root.depth();
    try std.testing.expect(depth < 20); // log2(1000) ≈ 10, allow some slack
}

test "Rope - delete_range entire rope" {
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

    // Should be empty (sentinel filtered)
    try std.testing.expectEqual(@as(u32, 0), rope.count());
}

test "Rope - to_array single item" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 42 });

    const array = try rope.to_array(arena.allocator());
    defer arena.allocator().free(array);

    try std.testing.expectEqual(@as(usize, 1), array.len);
    try std.testing.expectEqual(@as(u32, 42), array[0].value);
}

test "Rope - concat with empty rope" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope1 = try RopeType.from_item(arena.allocator(), .{ .value = 1 });
    const rope2 = try RopeType.init(arena.allocator());

    try rope1.concat(&rope2);

    try std.testing.expectEqual(@as(u32, 1), rope1.count()); // original only (empty filtered)
}

test "Rope - redo after modifying tree fails" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.from_item(arena.allocator(), .{ .value = 1 });

    try rope.store_undo("state1");
    try rope.append(.{ .value = 2 });

    _ = try rope.undo("current");

    // Manually modify the rope (breaking the redo contract)
    try rope.append(.{ .value = 3 });

    // Redo should fail because tree was modified
    const result = rope.redo();
    try std.testing.expectError(error.Stop, result);
}

test "Rope - rebalance extremely unbalanced tree" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const RopeType = rope_mod.Rope(SimpleItem);
    var rope = try RopeType.init(arena.allocator());

    // Create unbalanced tree by inserting at end repeatedly
    for (0..50) |i| {
        try rope.append(.{ .value = @intCast(i) });
    }

    const depth_before = rope.root.depth();

    // Rebalance
    try rope.rebalance(arena.allocator());

    const depth_after = rope.root.depth();

    // Should be more balanced now
    try std.testing.expect(depth_after <= depth_before);
    try std.testing.expect(depth_after < 15); // log2(50) ≈ 6

    // Data should be preserved
    try std.testing.expectEqual(@as(u32, 50), rope.count());
    try std.testing.expectEqual(@as(u32, 0), rope.get(0).?.value); // Fixed index
}

//===== Weight-aware Tests =====

// Type with custom weight for testing weight-based operations
const WeightedItem = struct {
    value: u32,
    weight: u32,

    pub const Metrics = struct {
        total_weight: u32 = 0,

        pub fn add(self: *Metrics, other: Metrics) void {
            self.total_weight += other.total_weight;
        }

        pub fn weight(self: *const Metrics) u32 {
            return self.total_weight;
        }
    };

    pub fn measure(self: *const WeightedItem) Metrics {
        return .{ .total_weight = self.weight };
    }

    pub fn empty() WeightedItem {
        return .{ .value = 0, .weight = 0 };
    }

    pub fn is_empty(self: *const WeightedItem) bool {
        return self.value == 0 and self.weight == 0;
    }
};

// Leaf split function for testing (callback format)
const WeightedRope = rope_mod.Rope(WeightedItem);

fn splitWeightedItemCallback(
    ctx: ?*anyopaque,
    allocator: std.mem.Allocator,
    leaf: *const WeightedItem,
    weight_in_leaf: u32,
) error{ OutOfBounds, OutOfMemory }!WeightedRope.Node.LeafSplitResult {
    _ = ctx;
    _ = allocator;
    if (weight_in_leaf == 0) {
        return .{
            .left = WeightedItem.empty(),
            .right = leaf.*,
        };
    } else if (weight_in_leaf >= leaf.weight) {
        return .{
            .left = leaf.*,
            .right = WeightedItem.empty(),
        };
    }

    // Split proportionally
    return .{
        .left = .{ .value = leaf.value, .weight = weight_in_leaf },
        .right = .{ .value = leaf.value + 1000, .weight = leaf.weight - weight_in_leaf },
    };
}

// Helper to create the callback struct
fn makeWeightedSplitter() WeightedRope.Node.LeafSplitFn {
    return .{
        .ctx = null,
        .splitFn = splitWeightedItemCallback,
    };
}

test "Rope - totalWeight returns correct weight" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const items = [_]WeightedItem{
        .{ .value = 1, .weight = 10 },
        .{ .value = 2, .weight = 20 },
        .{ .value = 3, .weight = 30 },
    };

    var rope = try WeightedRope.from_slice(arena.allocator(), &items);
    try std.testing.expectEqual(@as(u32, 60), rope.totalWeight());
}

test "Rope - split_at_weight at boundary" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const items = [_]WeightedItem{
        .{ .value = 1, .weight = 10 },
        .{ .value = 2, .weight = 20 },
        .{ .value = 3, .weight = 30 },
    };

    const rope = try WeightedRope.from_slice(arena.allocator(), &items);

    // Split at weight 30 (boundary between second and third item)
    const splitter = makeWeightedSplitter();
    const result = try WeightedRope.Node.split_at_weight(rope.root, 30, arena.allocator(), rope.empty_leaf, &splitter);

    // Left should have weight 30 (first two items)
    try std.testing.expectEqual(@as(u32, 30), result.left.metrics().weight());

    // Right should have weight 30 (third item)
    try std.testing.expectEqual(@as(u32, 30), result.right.metrics().weight());
}

test "Rope - split_at_weight inside leaf" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const rope = try WeightedRope.from_item(arena.allocator(), .{ .value = 1, .weight = 100 });

    // Split at weight 40 (inside the single leaf)
    const splitter = makeWeightedSplitter();
    const result = try WeightedRope.Node.split_at_weight(rope.root, 40, arena.allocator(), rope.empty_leaf, &splitter);

    // Left should have weight 40
    try std.testing.expectEqual(@as(u32, 40), result.left.metrics().weight());

    // Right should have weight 60
    try std.testing.expectEqual(@as(u32, 60), result.right.metrics().weight());
}

test "Rope - splitByWeight" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const items = [_]WeightedItem{
        .{ .value = 1, .weight = 10 },
        .{ .value = 2, .weight = 20 },
        .{ .value = 3, .weight = 30 },
    };

    var rope = try WeightedRope.from_slice(arena.allocator(), &items);
    try std.testing.expectEqual(@as(u32, 60), rope.totalWeight());

    // Split at weight 30
    const splitter = makeWeightedSplitter();
    const right_half = try rope.splitByWeight(30, &splitter);

    // Left half should have weight 30
    try std.testing.expectEqual(@as(u32, 30), rope.totalWeight());

    // Right half should have weight 30
    try std.testing.expectEqual(@as(u32, 30), right_half.totalWeight());
}

test "Rope - deleteRangeByWeight" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const items = [_]WeightedItem{
        .{ .value = 1, .weight = 10 },
        .{ .value = 2, .weight = 20 },
        .{ .value = 3, .weight = 30 },
        .{ .value = 4, .weight = 40 },
    };

    var rope = try WeightedRope.from_slice(arena.allocator(), &items);
    try std.testing.expectEqual(@as(u32, 100), rope.totalWeight());

    // Delete weight range [10, 30) - removes the second item (weight 20)
    const splitter = makeWeightedSplitter();
    try rope.deleteRangeByWeight(10, 30, &splitter);

    // Should have removed weight 20
    try std.testing.expectEqual(@as(u32, 80), rope.totalWeight());
}

test "Rope - insertSliceByWeight" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const items = [_]WeightedItem{
        .{ .value = 1, .weight = 10 },
        .{ .value = 3, .weight = 30 },
    };

    var rope = try WeightedRope.from_slice(arena.allocator(), &items);
    try std.testing.expectEqual(@as(u32, 40), rope.totalWeight());

    // Insert at weight 10 (after first item)
    const insert_items = [_]WeightedItem{
        .{ .value = 2, .weight = 20 },
    };
    const splitter = makeWeightedSplitter();
    try rope.insertSliceByWeight(10, &insert_items, &splitter);

    // Should have added weight 20
    try std.testing.expectEqual(@as(u32, 60), rope.totalWeight());
}

test "Rope - findByWeight" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const items = [_]WeightedItem{
        .{ .value = 1, .weight = 10 },
        .{ .value = 2, .weight = 20 },
        .{ .value = 3, .weight = 30 },
    };

    var rope = try WeightedRope.from_slice(arena.allocator(), &items);

    // Find leaf containing weight 0 (first item)
    const result0 = rope.findByWeight(0);
    try std.testing.expect(result0 != null);
    try std.testing.expectEqual(@as(u32, 1), result0.?.leaf.value);
    try std.testing.expectEqual(@as(u32, 0), result0.?.start_weight);

    // Find leaf containing weight 15 (second item)
    const result15 = rope.findByWeight(15);
    try std.testing.expect(result15 != null);
    try std.testing.expectEqual(@as(u32, 2), result15.?.leaf.value);
    try std.testing.expectEqual(@as(u32, 10), result15.?.start_weight);

    // Find leaf containing weight 35 (third item)
    const result35 = rope.findByWeight(35);
    try std.testing.expect(result35 != null);
    try std.testing.expectEqual(@as(u32, 3), result35.?.leaf.value);
    try std.testing.expectEqual(@as(u32, 30), result35.?.start_weight);

    // Out of bounds
    const result100 = rope.findByWeight(100);
    try std.testing.expect(result100 == null);
}

test "Rope - WeightFinger basic operations" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const items = [_]WeightedItem{
        .{ .value = 1, .weight = 10 },
        .{ .value = 2, .weight = 20 },
        .{ .value = 3, .weight = 30 },
    };

    var rope = try WeightedRope.from_slice(arena.allocator(), &items);

    // Create finger at weight 15
    var finger = rope.makeWeightFinger(15);
    try std.testing.expectEqual(@as(u32, 15), finger.getWeight());

    // Seek to different weight
    finger.seekWeight(35);
    try std.testing.expectEqual(@as(u32, 35), finger.getWeight());

    // Invalidate
    finger.invalidate();
    try std.testing.expect(finger.cached_node == null);
}

test "Rope - insertSliceAtWeightFinger" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const items = [_]WeightedItem{
        .{ .value = 1, .weight = 10 },
        .{ .value = 3, .weight = 30 },
    };

    var rope = try WeightedRope.from_slice(arena.allocator(), &items);

    var finger = rope.makeWeightFinger(10);

    const insert_items = [_]WeightedItem{
        .{ .value = 2, .weight = 20 },
    };
    const splitter = makeWeightedSplitter();
    try rope.insertSliceAtWeightFinger(&finger, &insert_items, &splitter);

    try std.testing.expectEqual(@as(u32, 60), rope.totalWeight());
}

test "Rope - deleteRangeByWeightWith" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const items = [_]WeightedItem{
        .{ .value = 1, .weight = 10 },
        .{ .value = 2, .weight = 20 },
        .{ .value = 3, .weight = 30 },
        .{ .value = 4, .weight = 40 },
    };

    var rope = try WeightedRope.from_slice(arena.allocator(), &items);

    var start_finger = rope.makeWeightFinger(10);
    var end_finger = rope.makeWeightFinger(30);

    const splitter = makeWeightedSplitter();
    try rope.deleteRangeByWeightWith(&start_finger, &end_finger, &splitter);

    // Should have removed weight 20
    try std.testing.expectEqual(@as(u32, 80), rope.totalWeight());
}
