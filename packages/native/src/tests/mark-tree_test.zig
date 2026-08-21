const std = @import("std");
const MarkTree = @import("../mark-tree.zig").MarkTree;

const Gravity = MarkTree.Gravity;
const Mark = MarkTree.Mark;
const Point = MarkTree.Point;
const Range = MarkTree.Range;
const RangeInput = MarkTree.RangeInput;

fn testTree() MarkTree {
    return MarkTree.initWithSeed(std.testing.allocator, 0x6d61726b74726565);
}

fn expectRange(
    actual: ?Range,
    id: u64,
    start_byte: u32,
    end_byte: u32,
    start_gravity: Gravity,
    end_gravity: Gravity,
) !void {
    try std.testing.expectEqualDeep(Range{
        .id = id,
        .start_byte = start_byte,
        .end_byte = end_byte,
        .start_gravity = start_gravity,
        .end_gravity = end_gravity,
    }, actual.?);
}

fn expectPoint(actual: ?Point, id: u64, byte: u32, gravity: Gravity) !void {
    try std.testing.expectEqualDeep(Point{ .id = id, .byte = byte, .gravity = gravity }, actual.?);
}

test "MarkTree range and point CRUD preserves endpoint identity and stable IDs" {
    var tree = testTree();
    defer tree.deinit();

    const reversed = try tree.addRange(.{ .start_byte = 9, .end_byte = 3 });
    const point = try tree.addPoint(.{ .byte = 4, .gravity = .left });
    try std.testing.expectEqual(@as(u64, 1), reversed);
    try std.testing.expectEqual(@as(u64, 2), point);
    try expectRange(tree.getRange(reversed), reversed, 9, 3, .right, .left);
    try expectPoint(tree.getPoint(point), point, 4, .left);
    try std.testing.expectEqual(@as(?Point, null), tree.getPoint(reversed));
    try std.testing.expectEqual(@as(?Range, null), tree.getRange(point));

    try std.testing.expect(try tree.updateRange(reversed, .{
        .start_byte = 20,
        .end_byte = 12,
        .start_gravity = .left,
        .end_gravity = .right,
    }));
    try expectRange(tree.getRange(reversed), reversed, 20, 12, .left, .right);
    try std.testing.expect(!try tree.updateRange(point, .{ .start_byte = 0, .end_byte = 0 }));
    try std.testing.expect(try tree.updatePoint(point, .{ .byte = 7 }));
    try expectPoint(tree.getPoint(point), point, 7, .right);
    try std.testing.expect(try tree.remove(point));
    try std.testing.expect(!try tree.remove(point));
    const next = try tree.addRange(.{ .start_byte = 1, .end_byte = 2 });
    try std.testing.expectEqual(@as(u64, 3), next);
    try tree.validateIntegrity();
}

/// Independent endpoint oracle: model a replacement as deleting `old_len`
/// units from an endpoint's distance to the edit, then inserting `new_len`.
/// Endpoints consumed by the deletion attach to one insertion side by gravity.
fn oracleEndpoint(position: u32, gravity: Gravity, edit_start: u32, old_len: u32, new_len: u32) u32 {
    if (position < edit_start) return position;
    const distance = position - edit_start;
    if (distance > old_len) return edit_start + distance - old_len + new_len;
    const attachment: u32 = if (gravity == .right) new_len else 0;
    return edit_start + attachment;
}

test "MarkTree splice matches fixed Neovim-compatible endpoint boundary matrix" {
    const positions = [_]u32{ 9, 10, 12, 15, 16 };
    const gravities = [_]Gravity{ .left, .right };
    var tree = testTree();
    defer tree.deinit();
    var ids: [positions.len * gravities.len]u64 = undefined;
    var index: usize = 0;
    for (positions) |position| {
        for (gravities) |gravity| {
            ids[index] = try tree.addPoint(.{ .byte = position, .gravity = gravity });
            index += 1;
        }
    }

    try tree.splice(10, 5, 3);
    index = 0;
    for (positions) |position| {
        for (gravities) |gravity| {
            try expectPoint(tree.getPoint(ids[index]), ids[index], oracleEndpoint(position, gravity, 10, 5, 3), gravity);
            index += 1;
        }
    }
    try tree.validateIntegrity();
}

test "MarkTree mixed-gravity empty range crosses without swapping semantics" {
    var tree = testTree();
    defer tree.deinit();
    const default_range = try tree.addRange(.{ .start_byte = 10, .end_byte = 10 });
    const opposite = try tree.addRange(.{
        .start_byte = 10,
        .end_byte = 10,
        .start_gravity = .left,
        .end_gravity = .right,
    });

    try tree.splice(10, 0, 5);
    try expectRange(tree.getRange(default_range), default_range, 15, 10, .right, .left);
    try expectRange(tree.getRange(opposite), opposite, 10, 15, .left, .right);
    try tree.validateIntegrity();
}

const RangeCollector = struct {
    allocator: std.mem.Allocator,
    ranges: *std.ArrayList(Range),

    fn visit(self: *RangeCollector, range: Range) !void {
        try self.ranges.append(self.allocator, range);
    }
};

const PointCollector = struct {
    allocator: std.mem.Allocator,
    points: *std.ArrayList(Point),

    fn visit(self: *PointCollector, point: Point) !void {
        try self.points.append(self.allocator, point);
    }
};

test "MarkTree overlap excludes reversed ranges and points while start and point queries find them" {
    var tree = testTree();
    defer tree.deinit();
    const forward = try tree.addRange(.{ .start_byte = 5, .end_byte = 10 });
    const reversed = try tree.addRange(.{ .start_byte = 10, .end_byte = 5 });
    const empty = try tree.addRange(.{ .start_byte = 7, .end_byte = 7 });
    const point = try tree.addPoint(.{ .byte = 7 });

    var ranges: std.ArrayList(Range) = .empty;
    defer ranges.deinit(std.testing.allocator);
    var range_collector = RangeCollector{ .allocator = std.testing.allocator, .ranges = &ranges };
    try tree.visitOverlapping(6, 8, &range_collector, RangeCollector.visit);
    try std.testing.expectEqual(@as(usize, 1), ranges.items.len);
    try std.testing.expectEqual(forward, ranges.items[0].id);

    ranges.clearRetainingCapacity();
    try tree.visitStartingAt(10, &range_collector, RangeCollector.visit);
    try std.testing.expectEqual(@as(usize, 1), ranges.items.len);
    try std.testing.expectEqual(reversed, ranges.items[0].id);
    ranges.clearRetainingCapacity();
    try tree.visitStartingAt(7, &range_collector, RangeCollector.visit);
    try std.testing.expectEqual(empty, ranges.items[0].id);

    var points: std.ArrayList(Point) = .empty;
    defer points.deinit(std.testing.allocator);
    var point_collector = PointCollector{ .allocator = std.testing.allocator, .points = &points };
    try tree.visitPointsAt(7, &point_collector, PointCollector.visit);
    try std.testing.expectEqual(@as(usize, 1), points.items.len);
    try std.testing.expectEqual(point, points.items[0].id);
    try tree.validateIntegrity();
}

fn sortU64(values: []u64) void {
    std.mem.sort(u64, values, {}, std.sort.asc(u64));
}

test "MarkTree deletion report distinguishes exact whole partial and boundary marks" {
    var tree = testTree();
    defer tree.deinit();
    const exact = try tree.addRange(.{ .start_byte = 10, .end_byte = 20 });
    const whole = try tree.addRange(.{ .start_byte = 12, .end_byte = 18 });
    const partial_left = try tree.addRange(.{ .start_byte = 5, .end_byte = 15 });
    const partial_right = try tree.addRange(.{ .start_byte = 15, .end_byte = 25 });
    const surrounding = try tree.addRange(.{ .start_byte = 5, .end_byte = 25 });
    const outside = try tree.addRange(.{ .start_byte = 21, .end_byte = 30 });
    const starts_at_old_end = try tree.addRange(.{ .start_byte = 20, .end_byte = 25 });
    const old_end_point = try tree.addPoint(.{ .byte = 20, .gravity = .left });

    var affected_buffer: [16]u64 = undefined;
    var covered_buffer: [16]u64 = undefined;
    const report = try tree.spliceWithReport(10, 10, 2, &affected_buffer, &covered_buffer);
    sortU64(report.affected_ids);
    sortU64(report.covered_range_ids);
    var expected_affected = [_]u64{
        exact,
        whole,
        partial_left,
        partial_right,
        surrounding,
        starts_at_old_end,
        old_end_point,
    };
    var expected_covered = [_]u64{ exact, whole };
    sortU64(&expected_affected);
    sortU64(&expected_covered);
    try std.testing.expectEqualSlices(u64, &expected_affected, report.affected_ids);
    try std.testing.expectEqualSlices(u64, &expected_covered, report.covered_range_ids);
    try std.testing.expect(tree.getRange(outside) != null);
    try expectRange(tree.getRange(starts_at_old_end), starts_at_old_end, 12, 17, .right, .left);
    try expectPoint(tree.getPoint(old_end_point), old_end_point, 10, .left);
    try tree.validateIntegrity();
}

test "MarkTree report capacity and position overflow reject splice atomically" {
    var tree = testTree();
    defer tree.deinit();
    const covered = try tree.addRange(.{ .start_byte = 10, .end_byte = 20 });
    const high = try tree.addPoint(.{ .byte = std.math.maxInt(u32), .gravity = .right });
    const original_covered = tree.getRange(covered);
    const original_high = tree.getPoint(high);
    var no_ids: [0]u64 = .{};
    try std.testing.expectError(error.ReportBufferTooSmall, tree.spliceWithReport(10, 10, 0, &no_ids, &no_ids));
    try std.testing.expectEqualDeep(original_covered, tree.getRange(covered));
    try std.testing.expectError(error.PositionOverflow, tree.splice(0, 0, 1));
    try std.testing.expectEqualDeep(original_high, tree.getPoint(high));
    try std.testing.expectError(error.PositionOverflow, tree.splice(std.math.maxInt(u32), 1, 0));
    try tree.validateIntegrity();
}

test "MarkTree moveRegion preserves IDs and annotations inside moved text" {
    var tree = testTree();
    defer tree.deinit();
    const annotation = try tree.addRange(.{ .start_byte = 12, .end_byte = 18 });
    const exact = try tree.addRange(.{ .start_byte = 10, .end_byte = 20 });
    const inside_point = try tree.addPoint(.{ .byte = 14, .gravity = .left });
    const source_left = try tree.addPoint(.{ .byte = 10, .gravity = .left });
    const source_right = try tree.addPoint(.{ .byte = 10, .gravity = .right });
    const end_right = try tree.addPoint(.{ .byte = 20, .gravity = .right });
    const after = try tree.addPoint(.{ .byte = 25 });

    try tree.moveRegion(10, 10, 30);
    try expectRange(tree.getRange(annotation), annotation, 32, 38, .right, .left);
    try expectRange(tree.getRange(exact), exact, 30, 40, .right, .left);
    try expectPoint(tree.getPoint(inside_point), inside_point, 34, .left);
    try expectPoint(tree.getPoint(source_right), source_right, 30, .right);
    try expectPoint(tree.getPoint(source_left), source_left, 10, .left);
    try expectPoint(tree.getPoint(end_right), end_right, 10, .right);
    try expectPoint(tree.getPoint(after), after, 15, .right);
    try tree.validateIntegrity();
}

const MutationVisitor = struct {
    tree: *MarkTree,
    attempted: bool = false,

    fn visit(self: *MutationVisitor, range: Range) !void {
        self.attempted = true;
        try std.testing.expectError(error.MutationDuringVisit, self.tree.remove(range.id));
    }
};

test "MarkTree visitors reject mutation and iterators detect generation changes before dereference" {
    var tree = testTree();
    defer tree.deinit();
    const first = try tree.addRange(.{ .start_byte = 0, .end_byte = 10 });
    _ = try tree.addRange(.{ .start_byte = 20, .end_byte = 30 });
    var context = MutationVisitor{ .tree = &tree };
    try tree.visitOverlapping(2, 3, &context, MutationVisitor.visit);
    try std.testing.expect(context.attempted);
    try std.testing.expect(tree.getRange(first) != null);

    var iterator = tree.iterator();
    _ = (try iterator.next()).?;
    try tree.splice(0, 0, 1);
    try std.testing.expectError(error.IteratorInvalidated, iterator.next());
    try tree.validateIntegrity();
}

const Oracle = struct {
    allocator: std.mem.Allocator,
    marks: std.ArrayList(Mark) = .empty,
    next_id: u64 = 1,

    fn deinit(self: *Oracle) void {
        self.marks.deinit(self.allocator);
    }

    fn addRange(self: *Oracle, input: RangeInput) !u64 {
        const id = self.next_id;
        self.next_id += 1;
        try self.marks.append(self.allocator, .{ .range = .{
            .id = id,
            .start_byte = input.start_byte,
            .end_byte = input.end_byte,
            .start_gravity = input.start_gravity,
            .end_gravity = input.end_gravity,
        } });
        return id;
    }

    fn addPoint(self: *Oracle, byte: u32, gravity: Gravity) !u64 {
        const id = self.next_id;
        self.next_id += 1;
        try self.marks.append(self.allocator, .{ .point = .{ .id = id, .byte = byte, .gravity = gravity } });
        return id;
    }

    fn indexOf(self: *const Oracle, id: u64) ?usize {
        for (self.marks.items, 0..) |mark, index| if (mark.id() == id) return index;
        return null;
    }

    fn remove(self: *Oracle, id: u64) bool {
        const index = self.indexOf(id) orelse return false;
        _ = self.marks.swapRemove(index);
        return true;
    }

    fn splice(self: *Oracle, start_byte: u32, old_len: u32, new_len: u32) void {
        for (self.marks.items) |*mark| {
            switch (mark.*) {
                .range => |*range| {
                    range.start_byte = oracleEndpoint(range.start_byte, range.start_gravity, start_byte, old_len, new_len);
                    range.end_byte = oracleEndpoint(range.end_byte, range.end_gravity, start_byte, old_len, new_len);
                },
                .point => |*point| {
                    point.byte = oracleEndpoint(point.byte, point.gravity, start_byte, old_len, new_len);
                },
            }
        }
    }

    fn movedEndpoint(position: u32, gravity: Gravity, start: u32, len: u32, destination: u32) u32 {
        const end = start + len;
        const captured = (position > start and position < end) or
            (position == start and gravity == .right) or
            (position == end and gravity == .left);
        if (captured) return destination + position - start;
        const removed = oracleEndpoint(position, gravity, start, len, 0);
        return oracleEndpoint(removed, gravity, destination, 0, len);
    }

    fn moveRegion(self: *Oracle, start: u32, len: u32, destination: u32) void {
        if (len == 0) return;
        for (self.marks.items) |*mark| {
            switch (mark.*) {
                .range => |*range| {
                    range.start_byte = movedEndpoint(range.start_byte, range.start_gravity, start, len, destination);
                    range.end_byte = movedEndpoint(range.end_byte, range.end_gravity, start, len, destination);
                },
                .point => |*point| point.byte = movedEndpoint(point.byte, point.gravity, start, len, destination),
            }
        }
    }
};

fn markLower(mark: Mark) u32 {
    return switch (mark) {
        .range => |range| @min(range.start_byte, range.end_byte),
        .point => |point| point.byte,
    };
}

fn markLess(_: void, a: Mark, b: Mark) bool {
    return markLower(a) < markLower(b) or (markLower(a) == markLower(b) and a.id() < b.id());
}

fn rangeLess(_: void, a: Range, b: Range) bool {
    const lower_a = @min(a.start_byte, a.end_byte);
    const lower_b = @min(b.start_byte, b.end_byte);
    return lower_a < lower_b or (lower_a == lower_b and a.id < b.id);
}

fn compareTreeAndOracle(tree: *MarkTree, oracle: *const Oracle) !void {
    try std.testing.expectEqual(oracle.marks.items.len, tree.count());
    for (oracle.marks.items) |expected| {
        const actual = tree.get(expected.id()).?;
        try std.testing.expectEqualDeep(expected, actual);
    }

    const expected = try std.testing.allocator.dupe(Mark, oracle.marks.items);
    defer std.testing.allocator.free(expected);
    std.mem.sort(Mark, expected, {}, markLess);
    var iterator = tree.iterator();
    for (expected) |mark| try std.testing.expectEqualDeep(mark, (try iterator.next()).?);
    try std.testing.expectEqual(@as(?Mark, null), try iterator.next());
    try tree.validateIntegrity();
}

fn compareOverlap(tree: *MarkTree, oracle: *const Oracle, first: u32, second: u32) !void {
    try tree.validateIntegrity();
    var actual: std.ArrayList(Range) = .empty;
    defer actual.deinit(std.testing.allocator);
    var collector = RangeCollector{ .allocator = std.testing.allocator, .ranges = &actual };
    try tree.visitOverlapping(first, second, &collector, RangeCollector.visit);

    var expected: std.ArrayList(Range) = .empty;
    defer expected.deinit(std.testing.allocator);
    const start = @min(first, second);
    const end = @max(first, second);
    if (start != end) {
        for (oracle.marks.items) |mark| switch (mark) {
            .range => |range| if (range.start_byte < range.end_byte and range.start_byte < end and range.end_byte > start) {
                try expected.append(std.testing.allocator, range);
            },
            .point => {},
        };
    }
    std.mem.sort(Range, expected.items, {}, rangeLess);
    try std.testing.expectEqualDeep(expected.items, actual.items);
}

test "MarkTree randomized differential endpoint overlap iteration point and move model" {
    var tree = testTree();
    defer tree.deinit();
    var oracle = Oracle{ .allocator = std.testing.allocator };
    defer oracle.deinit();
    var document_len: u32 = 200;
    var prng = std.Random.DefaultPrng.init(0x4f7261636c654d54);
    const random = prng.random();

    for (0..6000) |step| {
        const operation = random.intRangeAtMost(u8, 0, 6);
        switch (operation) {
            0, 1 => {
                const input = RangeInput{
                    .start_byte = random.intRangeAtMost(u32, 0, document_len),
                    .end_byte = random.intRangeAtMost(u32, 0, document_len),
                    .start_gravity = if (random.boolean()) .left else .right,
                    .end_gravity = if (random.boolean()) .left else .right,
                };
                try std.testing.expectEqual(try oracle.addRange(input), try tree.addRange(input));
            },
            2 => {
                const byte = random.intRangeAtMost(u32, 0, document_len);
                const gravity: Gravity = if (random.boolean()) .left else .right;
                try std.testing.expectEqual(try oracle.addPoint(byte, gravity), try tree.addPoint(.{ .byte = byte, .gravity = gravity }));
            },
            3 => if (oracle.marks.items.len != 0) {
                const index = random.intRangeLessThan(usize, 0, oracle.marks.items.len);
                const id = oracle.marks.items[index].id();
                try std.testing.expectEqual(oracle.remove(id), try tree.remove(id));
            },
            4 => {
                const start = random.intRangeAtMost(u32, 0, document_len);
                const old_len = random.intRangeAtMost(u32, 0, document_len - start);
                const new_len = random.intRangeAtMost(u32, 0, 20);
                oracle.splice(start, old_len, new_len);
                try tree.splice(start, old_len, new_len);
                document_len = document_len - old_len + new_len;
            },
            5 => {
                const first = random.intRangeAtMost(u32, 0, document_len);
                const second = random.intRangeAtMost(u32, 0, document_len);
                try compareOverlap(&tree, &oracle, first, second);
            },
            6 => if (document_len != 0) {
                const start = random.intRangeAtMost(u32, 0, document_len);
                const len = random.intRangeAtMost(u32, 0, document_len - start);
                const destination = random.intRangeAtMost(u32, 0, document_len - len);
                oracle.moveRegion(start, len, destination);
                try tree.moveRegion(start, len, destination);
            },
            else => unreachable,
        }
        if (step % 41 == 0) try compareTreeAndOracle(&tree, &oracle);
    }
    try compareTreeAndOracle(&tree, &oracle);
}

test "MarkTree randomized priorities handle dense sequential insertion and suffix edits" {
    var tree = testTree();
    defer tree.deinit();
    var tracked_id: u64 = 0;
    for (0..20_000) |index| {
        const start_byte: u32 = @intCast(index * 8);
        tracked_id = try tree.addRange(.{ .start_byte = start_byte, .end_byte = start_byte + 4 });
    }
    for (0..2_000) |_| {
        try tree.splice(1, 0, 1);
        try tree.splice(1, 1, 0);
    }
    try expectRange(tree.getRange(tracked_id), tracked_id, 159_992, 159_996, .right, .left);
    try tree.validateIntegrity();
}
