const std = @import("std");
const mark_tree = @import("../mark-tree.zig");

const MarkTree = mark_tree.MarkTree;
const Gravity = MarkTree.Gravity;
const Range = MarkTree.Range;
const RangeInput = MarkTree.RangeInput;

fn expectRange(actual: ?Range, id: u64, start_byte: u32, end_byte: u32, start_gravity: Gravity, end_gravity: Gravity) !void {
    try std.testing.expectEqualDeep(Range{
        .id = id,
        .start_byte = start_byte,
        .end_byte = end_byte,
        .start_gravity = start_gravity,
        .end_gravity = end_gravity,
    }, actual.?);
}

test "MarkTree add, normalize, update, remove, and stable IDs" {
    var tree = MarkTree.init(std.testing.allocator);
    defer tree.deinit();

    const first = try tree.add(.{
        .start_byte = 9,
        .end_byte = 3,
        .start_gravity = .right,
        .end_gravity = .left,
    });
    const second = try tree.add(.{ .start_byte = 4, .end_byte = 4 });

    try std.testing.expectEqual(@as(u64, 1), first);
    try std.testing.expectEqual(@as(u64, 2), second);
    try expectRange(tree.get(first), first, 3, 9, .left, .right);
    try std.testing.expect(tree.update(first, .{
        .start_byte = 20,
        .end_byte = 12,
        .start_gravity = .left,
        .end_gravity = .right,
    }));
    try expectRange(tree.get(first), first, 12, 20, .right, .left);
    try std.testing.expect(!tree.update(999, .{ .start_byte = 0, .end_byte = 0 }));
    try std.testing.expect(tree.remove(second));
    try std.testing.expect(!tree.remove(second));
    try std.testing.expectEqual(@as(?Range, null), tree.get(second));

    const third = try tree.add(.{ .start_byte = 1, .end_byte = 2 });
    try std.testing.expectEqual(@as(u64, 3), third);
    try std.testing.expectEqual(@as(usize, 2), tree.count());
    try tree.validateIntegrity();
}

test "MarkTree insertion honors every zero-length gravity combination" {
    const gravities = [_]Gravity{ .left, .right };

    for (gravities) |start_gravity| {
        for (gravities) |end_gravity| {
            var tree = MarkTree.init(std.testing.allocator);
            defer tree.deinit();
            const id = try tree.add(.{
                .start_byte = 10,
                .end_byte = 10,
                .start_gravity = start_gravity,
                .end_gravity = end_gravity,
            });

            try tree.splice(10, 0, 5);
            const actual = tree.get(id).?;
            const transformed_start: u32 = if (start_gravity == .left) 10 else 15;
            const transformed_end: u32 = if (end_gravity == .left) 10 else 15;
            try std.testing.expectEqual(@min(transformed_start, transformed_end), actual.start_byte);
            try std.testing.expectEqual(@max(transformed_start, transformed_end), actual.end_byte);
            try tree.validateIntegrity();
        }
    }
}

test "MarkTree endpoint gravity, replacement boundaries, and suffix shifts" {
    var tree = MarkTree.init(std.testing.allocator);
    defer tree.deinit();

    const before = try tree.add(.{ .start_byte = 1, .end_byte = 4 });
    const crossing = try tree.add(.{
        .start_byte = 3,
        .end_byte = 8,
        .end_gravity = .left,
    });
    const left_inside = try tree.add(.{
        .start_byte = 5,
        .end_byte = 6,
        .start_gravity = .left,
        .end_gravity = .left,
    });
    const right_inside = try tree.add(.{
        .start_byte = 5,
        .end_byte = 6,
        .start_gravity = .right,
        .end_gravity = .right,
    });
    const right_boundary = try tree.add(.{ .start_byte = 8, .end_byte = 10 });
    const suffix = try tree.add(.{ .start_byte = 20, .end_byte = 30 });

    try tree.splice(4, 4, 2);
    try expectRange(tree.get(before), before, 1, 6, .left, .right);
    try expectRange(tree.get(crossing), crossing, 3, 6, .left, .left);
    try expectRange(tree.get(left_inside), left_inside, 4, 4, .left, .left);
    try expectRange(tree.get(right_inside), right_inside, 6, 6, .right, .right);
    try expectRange(tree.get(right_boundary), right_boundary, 6, 8, .left, .right);
    try expectRange(tree.get(suffix), suffix, 18, 28, .left, .right);

    try tree.splice(0, 0, 3);
    try expectRange(tree.get(suffix), suffix, 21, 31, .left, .right);
    try tree.splice(25, 4, 0);
    try expectRange(tree.get(suffix), suffix, 21, 27, .left, .right);
    try tree.validateIntegrity();
}

const CollectContext = struct {
    allocator: std.mem.Allocator,
    ranges: *std.ArrayList(Range),

    fn visit(self: *CollectContext, range: Range) !void {
        try self.ranges.append(self.allocator, range);
    }
};

test "MarkTree overlap query is half-open and ordered" {
    var tree = MarkTree.init(std.testing.allocator);
    defer tree.deinit();

    const a = try tree.add(.{ .start_byte = 0, .end_byte = 5 });
    _ = try tree.add(.{ .start_byte = 5, .end_byte = 5 });
    const c = try tree.add(.{ .start_byte = 5, .end_byte = 10 });
    const d = try tree.add(.{ .start_byte = 7, .end_byte = 12 });
    _ = try tree.add(.{ .start_byte = 12, .end_byte = 15 });

    var found: std.ArrayList(Range) = .empty;
    defer found.deinit(std.testing.allocator);
    var context = CollectContext{ .allocator = std.testing.allocator, .ranges = &found };
    try tree.visitOverlapping(5, 8, &context, CollectContext.visit);
    try std.testing.expectEqual(@as(usize, 2), found.items.len);
    try std.testing.expectEqual(c, found.items[0].id);
    try std.testing.expectEqual(d, found.items[1].id);

    found.clearRetainingCapacity();
    try tree.visitOverlapping(5, 0, &context, CollectContext.visit);
    try std.testing.expectEqual(@as(usize, 1), found.items.len);
    try std.testing.expectEqual(a, found.items[0].id);

    found.clearRetainingCapacity();
    try tree.visitOverlapping(7, 7, &context, CollectContext.visit);
    try std.testing.expectEqual(@as(usize, 0), found.items.len);
    try tree.validateIntegrity();
}

test "MarkTree iteration has deterministic start then ID order after edits" {
    var tree = MarkTree.init(std.testing.allocator);
    defer tree.deinit();

    const first = try tree.add(.{ .start_byte = 9, .end_byte = 12 });
    const second = try tree.add(.{ .start_byte = 2, .end_byte = 50 });
    const third = try tree.add(.{ .start_byte = 9, .end_byte = 10 });
    const fourth = try tree.add(.{ .start_byte = 3, .end_byte = 4 });
    try tree.splice(3, 6, 0);

    var iterator = tree.iterator();
    try std.testing.expectEqual(second, iterator.next().?.id);
    try std.testing.expectEqual(first, iterator.next().?.id);
    try std.testing.expectEqual(third, iterator.next().?.id);
    try std.testing.expectEqual(fourth, iterator.next().?.id);
    try std.testing.expectEqual(@as(?Range, null), iterator.next());
    try tree.validateIntegrity();
}

test "MarkTree splice overflow is rejected without mutation" {
    var tree = MarkTree.init(std.testing.allocator);
    defer tree.deinit();

    const id = try tree.add(.{ .start_byte = std.math.maxInt(u32) - 2, .end_byte = std.math.maxInt(u32) });
    const original = tree.get(id);
    try std.testing.expectError(error.PositionOverflow, tree.splice(std.math.maxInt(u32), 1, 0));
    try std.testing.expectError(error.PositionOverflow, tree.splice(0, 0, 1));
    try std.testing.expectEqualDeep(original, tree.get(id));
    try tree.validateIntegrity();
}

const Shadow = struct {
    allocator: std.mem.Allocator,
    ranges: std.ArrayList(Range) = .empty,
    next_id: u64 = 1,

    fn deinit(self: *Shadow) void {
        self.ranges.deinit(self.allocator);
    }

    fn normalize(id: u64, input: RangeInput) Range {
        if (input.start_byte <= input.end_byte) return .{
            .id = id,
            .start_byte = input.start_byte,
            .end_byte = input.end_byte,
            .start_gravity = input.start_gravity,
            .end_gravity = input.end_gravity,
        };
        return .{
            .id = id,
            .start_byte = input.end_byte,
            .end_byte = input.start_byte,
            .start_gravity = input.end_gravity,
            .end_gravity = input.start_gravity,
        };
    }

    fn add(self: *Shadow, input: RangeInput) !u64 {
        const id = self.next_id;
        self.next_id += 1;
        try self.ranges.append(self.allocator, normalize(id, input));
        return id;
    }

    fn indexOf(self: *const Shadow, id: u64) ?usize {
        for (self.ranges.items, 0..) |range, index| {
            if (range.id == id) return index;
        }
        return null;
    }

    fn get(self: *const Shadow, id: u64) ?Range {
        const index = self.indexOf(id) orelse return null;
        return self.ranges.items[index];
    }

    fn remove(self: *Shadow, id: u64) bool {
        const index = self.indexOf(id) orelse return false;
        _ = self.ranges.swapRemove(index);
        return true;
    }

    fn update(self: *Shadow, id: u64, input: RangeInput) bool {
        const index = self.indexOf(id) orelse return false;
        self.ranges.items[index] = normalize(id, input);
        return true;
    }

    fn position(position_byte: u32, gravity: Gravity, start_byte: u32, old_end: u32, new_end: u32, old_len: u32) u32 {
        if (position_byte < start_byte) return position_byte;
        if (position_byte > old_end) {
            return @intCast(@as(i64, position_byte) + @as(i64, new_end) - @as(i64, old_end));
        }
        if (old_len != 0 and position_byte == old_end) return new_end;
        return if (gravity == .left) start_byte else new_end;
    }

    fn splice(self: *Shadow, start_byte: u32, old_len: u32, new_len: u32) void {
        const old_end = start_byte + old_len;
        const new_end = start_byte + new_len;
        for (self.ranges.items) |*range| {
            const transformed = RangeInput{
                .start_byte = position(range.start_byte, range.start_gravity, start_byte, old_end, new_end, old_len),
                .end_byte = position(range.end_byte, range.end_gravity, start_byte, old_end, new_end, old_len),
                .start_gravity = range.start_gravity,
                .end_gravity = range.end_gravity,
            };
            range.* = normalize(range.id, transformed);
        }
    }
};

fn rangeLess(_: void, a: Range, b: Range) bool {
    return a.start_byte < b.start_byte or (a.start_byte == b.start_byte and a.id < b.id);
}

fn compareTreeAndShadow(tree: *MarkTree, shadow: *const Shadow) !void {
    try std.testing.expectEqual(shadow.ranges.items.len, tree.count());
    for (shadow.ranges.items) |expected| {
        try std.testing.expectEqualDeep(expected, tree.get(expected.id).?);
    }

    const expected = try std.testing.allocator.dupe(Range, shadow.ranges.items);
    defer std.testing.allocator.free(expected);
    std.mem.sort(Range, expected, {}, rangeLess);
    var iterator = tree.iterator();
    for (expected) |range| {
        try std.testing.expectEqualDeep(range, iterator.next().?);
    }
    try std.testing.expectEqual(@as(?Range, null), iterator.next());
    try tree.validateIntegrity();
}

test "MarkTree randomized differential shadow model" {
    var tree = MarkTree.init(std.testing.allocator);
    defer tree.deinit();
    var shadow = Shadow{ .allocator = std.testing.allocator };
    defer shadow.deinit();
    var document_len: u32 = 200;
    var prng = std.Random.DefaultPrng.init(0x6d61726b74726565);
    const random = prng.random();

    for (0..5000) |step| {
        const operation = random.intRangeAtMost(u8, 0, 5);
        switch (operation) {
            0, 1 => {
                const input = RangeInput{
                    .start_byte = random.intRangeAtMost(u32, 0, document_len),
                    .end_byte = random.intRangeAtMost(u32, 0, document_len),
                    .start_gravity = if (random.boolean()) .left else .right,
                    .end_gravity = if (random.boolean()) .left else .right,
                };
                try std.testing.expectEqual(try shadow.add(input), try tree.add(input));
            },
            2 => if (shadow.ranges.items.len != 0) {
                const index = random.intRangeLessThan(usize, 0, shadow.ranges.items.len);
                const id = shadow.ranges.items[index].id;
                try std.testing.expectEqual(shadow.remove(id), tree.remove(id));
            },
            3 => if (shadow.ranges.items.len != 0) {
                const index = random.intRangeLessThan(usize, 0, shadow.ranges.items.len);
                const id = shadow.ranges.items[index].id;
                const input = RangeInput{
                    .start_byte = random.intRangeAtMost(u32, 0, document_len),
                    .end_byte = random.intRangeAtMost(u32, 0, document_len),
                    .start_gravity = if (random.boolean()) .left else .right,
                    .end_gravity = if (random.boolean()) .left else .right,
                };
                try std.testing.expectEqual(shadow.update(id, input), tree.update(id, input));
            },
            4 => {
                const start_byte = random.intRangeAtMost(u32, 0, document_len);
                const old_len = random.intRangeAtMost(u32, 0, document_len - start_byte);
                const new_len = random.intRangeAtMost(u32, 0, 24);
                shadow.splice(start_byte, old_len, new_len);
                try tree.splice(start_byte, old_len, new_len);
                document_len = document_len - old_len + new_len;
            },
            5 => {
                const first = random.intRangeAtMost(u32, 0, document_len);
                const second = random.intRangeAtMost(u32, 0, document_len);
                const query_start = @min(first, second);
                const query_end = @max(first, second);
                var actual: std.ArrayList(Range) = .empty;
                defer actual.deinit(std.testing.allocator);
                var context = CollectContext{ .allocator = std.testing.allocator, .ranges = &actual };
                try tree.visitOverlapping(first, second, &context, CollectContext.visit);

                var expected: std.ArrayList(Range) = .empty;
                defer expected.deinit(std.testing.allocator);
                if (query_start != query_end) {
                    for (shadow.ranges.items) |range| {
                        if (range.start_byte < query_end and range.end_byte > query_start) {
                            try expected.append(std.testing.allocator, range);
                        }
                    }
                }
                std.mem.sort(Range, expected.items, {}, rangeLess);
                try std.testing.expectEqualDeep(expected.items, actual.items);
            },
            else => unreachable,
        }

        if (step % 37 == 0) try compareTreeAndShadow(&tree, &shadow);
    }
    try compareTreeAndShadow(&tree, &shadow);
}

test "MarkTree stress many ranges and repeated suffix edits" {
    var tree = MarkTree.init(std.testing.allocator);
    defer tree.deinit();

    var tracked_id: u64 = 0;
    for (0..20_000) |index| {
        const start_byte: u32 = @intCast(index * 8);
        const id = try tree.add(.{ .start_byte = start_byte, .end_byte = start_byte + 4 });
        if (index == 19_999) tracked_id = id;
    }
    for (0..2_000) |_| try tree.splice(1, 0, 1);

    try expectRange(tree.get(tracked_id), tracked_id, 161_992, 161_996, .left, .right);
    try std.testing.expect(tree.remove(10_000));
    try std.testing.expect(tree.update(15_000, .{ .start_byte = 0, .end_byte = 0 }));
    try tree.validateIntegrity();
}
