const std = @import("std");
const rope_mod = @import("../rope.zig");

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
    try std.testing.expectEqual(@as(u32, 1), rope.count());
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

    try std.testing.expectEqual(@as(u32, 4), rope.count()); // +1 for initial empty
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

    try std.testing.expectEqual(@as(u32, 51), rope.count()); // +1 for initial empty
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
        // Can't create rope without allocator
        return undefined;
    }

    pub fn is_empty(self: *const Line) bool {
        return self.chunks.count() == 0;
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

    // Create initial document structure
    var line_rope = try rope_mod.Rope(Line).init(allocator);

    // Add first line with chunks
    const chunks1 = [_]Chunk{
        .{ .data = "First ", .width = 6 },
        .{ .data = "line", .width = 4 },
    };
    const line1 = Line{
        .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks1),
        .line_id = 1,
    };
    try line_rope.insert(0, line1);

    // Add second line
    const chunks2 = [_]Chunk{.{ .data = "Second line", .width = 11 }};
    const line2 = Line{
        .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks2),
        .line_id = 2,
    };
    try line_rope.insert(1, line2);

    // Verify structure
    try std.testing.expectEqual(@as(u32, 3), line_rope.count()); // +1 for initial empty

    // Access specific chunk in specific line
    const first_line = line_rope.get(1).?; // Index 1 because 0 is empty
    try std.testing.expectEqual(@as(u32, 2), first_line.chunks.count());
    try std.testing.expectEqualStrings("First ", first_line.chunks.get(0).?.data);

    // Verify total metrics
    const metrics = line_rope.root.metrics();
    try std.testing.expectEqual(@as(u32, 3), metrics.count);
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

    // Start with empty document
    var document = try rope_mod.Rope(Line).init(allocator);

    // Add first line: "Hello World"
    const chunks1 = [_]Chunk{
        .{ .data = "Hello ", .width = 6 },
        .{ .data = "World", .width = 5 },
    };
    const line1 = Line{
        .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks1),
        .line_id = 1,
    };
    try document.insert(0, line1);

    // Add second line: "Goodbye"
    const chunks2 = [_]Chunk{.{ .data = "Goodbye", .width = 7 }};
    const line2 = Line{
        .chunks = try rope_mod.Rope(Chunk).from_slice(allocator, &chunks2),
        .line_id = 2,
    };
    try document.insert(1, line2);

    // Verify document structure
    try std.testing.expectEqual(@as(u32, 3), document.count()); // +1 for initial empty

    // Get line 1 and verify it has 2 chunks
    const retrieved_line1 = document.get(1).?;
    try std.testing.expectEqual(@as(u32, 2), retrieved_line1.chunks.count());

    // Get line 2 and verify it has 1 chunk
    const retrieved_line2 = document.get(2).?;
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

    // Empty line should have 1 chunk (the empty chunk)
    const empty = line_rope.get(0).?;
    try std.testing.expectEqual(@as(u32, 1), empty.chunks.count());

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
