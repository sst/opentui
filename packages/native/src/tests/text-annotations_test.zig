const std = @import("std");
const TextAnnotations = @import("../text-annotations.zig").TextAnnotations;

const Annotation = TextAnnotations.Annotation;
const Mark = TextAnnotations.Mark;
const PayloadInput = TextAnnotations.PayloadInput;

fn testAnnotations() TextAnnotations {
    return TextAnnotations.initWithSeed(std.testing.allocator, 0x74657874616e6e6f);
}

fn payload(namespace: u32, style_id: u32, priority: u8) PayloadInput {
    return .{ .namespace = namespace, .style_id = style_id, .priority = priority };
}

fn expectRange(owner: *TextAnnotations, id: u64, start: u32, end: u32, style_id: u32) !void {
    const value = owner.get(id).?;
    try std.testing.expectEqual(style_id, value.payload.style_id);
    switch (value.mark) {
        .range => |range| {
            try std.testing.expectEqual(start, range.start_byte);
            try std.testing.expectEqual(end, range.end_byte);
        },
        .point => return error.ExpectedRange,
    }
}

fn expectPoint(owner: *TextAnnotations, id: u64, byte: u32, kind_flags: u32) !void {
    const value = owner.get(id).?;
    try std.testing.expectEqual(kind_flags, value.payload.kind_flags);
    switch (value.mark) {
        .point => |point| try std.testing.expectEqual(byte, point.byte),
        .range => return error.ExpectedPoint,
    }
}

test "TextAnnotations CRUD keeps payload and position identity" {
    var owner = testAnnotations();
    defer owner.deinit();

    const reversed = try owner.addRange(.{ .start_byte = 12, .end_byte = 3 }, .{
        .namespace = 7,
        .style_id = 41,
        .priority = 9,
        .internal = true,
        .kind_flags = 0x12,
        .splice_policy = .invalidate,
    });
    const point = try owner.addPoint(.{ .byte = 8, .gravity = .left }, .{
        .namespace = 8,
        .kind_flags = 0x80,
    });

    try expectRange(&owner, reversed, 12, 3, 41);
    try expectPoint(&owner, point, 8, 0x80);
    try std.testing.expectEqual(@as(u64, 1), owner.get(reversed).?.payload.sequence);
    try std.testing.expectEqual(@as(u64, 2), owner.get(point).?.payload.sequence);
    try std.testing.expect(owner.get(reversed).?.payload.internal);
    try std.testing.expectEqual(TextAnnotations.SplicePolicy.invalidate, owner.get(reversed).?.payload.splice_policy);

    try std.testing.expect(try owner.updateRange(reversed, .{ .start_byte = 20, .end_byte = 10 }));
    try std.testing.expect(!try owner.updatePoint(reversed, .{ .byte = 1 }));
    try std.testing.expect(try owner.updatePoint(point, .{ .byte = 9 }));
    try expectRange(&owner, reversed, 20, 10, 41);
    try expectPoint(&owner, point, 9, 0x80);
    try std.testing.expect(try owner.remove(point));
    try std.testing.expect(!try owner.remove(point));
    try std.testing.expectEqual(@as(usize, 1), owner.count());
    try owner.validateIntegrity();
}

test "TextAnnotations payload updates preserve sequence and MarkTree generation" {
    var owner = testAnnotations();
    defer owner.deinit();
    const id = try owner.addRange(.{ .start_byte = 2, .end_byte = 6 }, payload(1, 10, 3));
    const position_generation = owner.positionGeneration();
    const sequence = owner.get(id).?.payload.sequence;

    try std.testing.expect(try owner.updateStyle(id, 20));
    try std.testing.expectEqual(position_generation, owner.positionGeneration());
    try std.testing.expect(try owner.updatePayload(id, .{
        .namespace = 2,
        .style_id = 30,
        .priority = 7,
        .internal = true,
        .kind_flags = 4,
        .splice_policy = .delete_when_covered,
    }));
    const updated = owner.get(id).?.payload;
    try std.testing.expectEqual(position_generation, owner.positionGeneration());
    try std.testing.expectEqual(sequence, updated.sequence);
    try std.testing.expectEqual(@as(u32, 2), updated.namespace);
    try std.testing.expectEqual(@as(u32, 30), updated.style_id);
    try std.testing.expectEqual(@as(u8, 7), updated.priority);
    try std.testing.expect(updated.internal);
    try std.testing.expectEqual(@as(u32, 4), updated.kind_flags);
    try owner.validateIntegrity();
}

test "TextAnnotations splice applies retain invalidate and covered policies" {
    var owner = testAnnotations();
    defer owner.deinit();
    const retained = try owner.addRange(.{ .start_byte = 12, .end_byte = 18 }, .{
        .namespace = 1,
        .splice_policy = .retain,
    });
    const invalidated = try owner.addRange(.{ .start_byte = 5, .end_byte = 15 }, .{
        .namespace = 1,
        .splice_policy = .invalidate,
    });
    const covered = try owner.addRange(.{ .start_byte = 11, .end_byte = 19 }, .{
        .namespace = 1,
        .splice_policy = .delete_when_covered,
    });
    const partial = try owner.addRange(.{ .start_byte = 5, .end_byte = 15 }, .{
        .namespace = 1,
        .splice_policy = .delete_when_covered,
    });
    const outside = try owner.addRange(.{ .start_byte = 21, .end_byte = 25 }, .{
        .namespace = 1,
        .splice_policy = .invalidate,
    });
    const invalidated_point = try owner.addPoint(.{ .byte = 14 }, .{
        .namespace = 1,
        .kind_flags = 1,
        .splice_policy = .invalidate,
    });
    const covered_point = try owner.addPoint(.{ .byte = 14 }, .{
        .namespace = 1,
        .kind_flags = 2,
        .splice_policy = .delete_when_covered,
    });

    try owner.splice(10, 10, 2);
    try expectRange(&owner, retained, 12, 10, 0);
    try std.testing.expect(owner.get(invalidated) == null);
    try std.testing.expect(owner.get(covered) == null);
    try expectRange(&owner, partial, 5, 10, 0);
    try expectRange(&owner, outside, 13, 17, 0);
    try std.testing.expect(owner.get(invalidated_point) == null);
    try expectPoint(&owner, covered_point, 12, 2);
    try owner.validateIntegrity();
}

test "TextAnnotations insertion splice and move preserve payload association" {
    var owner = testAnnotations();
    defer owner.deinit();
    const range = try owner.addRange(.{ .start_byte = 10, .end_byte = 20 }, payload(1, 99, 0));
    const point = try owner.addPoint(.{ .byte = 14, .gravity = .left }, .{ .namespace = 1, .kind_flags = 7 });

    try owner.splice(10, 0, 5);
    try expectRange(&owner, range, 15, 25, 99);
    try expectPoint(&owner, point, 19, 7);
    try owner.moveRegion(15, 10, 30);
    try expectRange(&owner, range, 30, 40, 99);
    try expectPoint(&owner, point, 34, 7);
    try owner.validateIntegrity();
}

test "TextAnnotations namespace clear is selective and safely invalidates iterators" {
    var owner = testAnnotations();
    defer owner.deinit();
    const first = try owner.addRange(.{ .start_byte = 1, .end_byte = 2 }, payload(4, 1, 0));
    const second = try owner.addPoint(.{ .byte = 2 }, payload(5, 2, 0));
    const third = try owner.addRange(.{ .start_byte = 3, .end_byte = 4 }, payload(4, 3, 0));
    var iterator = owner.iterator();
    _ = (try iterator.next()).?;

    try std.testing.expectEqual(@as(usize, 2), try owner.clearOwner(4));
    try std.testing.expectError(error.IteratorInvalidated, iterator.next());
    try std.testing.expect(owner.get(first) == null);
    try std.testing.expect(owner.get(third) == null);
    try std.testing.expect(owner.get(second) != null);
    try std.testing.expectEqual(@as(usize, 0), try owner.clearNamespace(99));
    try owner.validateIntegrity();
}

const Collector = struct {
    allocator: std.mem.Allocator,
    values: *std.ArrayList(Annotation),

    fn visit(self: *Collector, annotation: Annotation) !void {
        try self.values.append(self.allocator, annotation);
    }
};

test "TextAnnotations visitors return deterministic priority and stable sequence order" {
    var owner = testAnnotations();
    defer owner.deinit();
    const old_equal = try owner.addRange(.{ .start_byte = 5, .end_byte = 10 }, payload(1, 1, 7));
    const high = try owner.addRange(.{ .start_byte = 5, .end_byte = 10 }, payload(1, 2, 9));
    const new_equal = try owner.addRange(.{ .start_byte = 5, .end_byte = 10 }, payload(1, 3, 7));
    const point_old = try owner.addPoint(.{ .byte = 5 }, payload(1, 0, 4));
    const point_new = try owner.addPoint(.{ .byte = 5 }, payload(1, 0, 4));
    _ = try owner.addRange(.{ .start_byte = 10, .end_byte = 5 }, payload(1, 4, 20));

    var values: std.ArrayList(Annotation) = .empty;
    defer values.deinit(std.testing.allocator);
    var collector = Collector{ .allocator = std.testing.allocator, .values = &values };
    try owner.visitOverlapping(6, 7, &collector, Collector.visit);
    try std.testing.expectEqualSlices(u64, &.{ high, old_equal, new_equal }, &.{
        values.items[0].id(),
        values.items[1].id(),
        values.items[2].id(),
    });

    values.clearRetainingCapacity();
    try owner.visitStartingAt(5, &collector, Collector.visit);
    try std.testing.expectEqualSlices(u64, &.{ high, old_equal, new_equal }, &.{
        values.items[0].id(),
        values.items[1].id(),
        values.items[2].id(),
    });

    values.clearRetainingCapacity();
    try owner.visitPointsAt(5, &collector, Collector.visit);
    try std.testing.expectEqualSlices(u64, &.{ point_old, point_new }, &.{
        values.items[0].id(),
        values.items[1].id(),
    });
}

const MutationVisitor = struct {
    owner: *TextAnnotations,
    id: u64,
    attempts: usize = 0,

    fn visit(self: *MutationVisitor, _: Annotation) !void {
        self.attempts += 1;
        try std.testing.expectError(error.MutationDuringVisit, self.owner.remove(self.id));
        try std.testing.expectError(error.MutationDuringVisit, self.owner.updateStyle(self.id, 100));
        try std.testing.expectError(error.MutationDuringVisit, self.owner.clearNamespace(1));
        try std.testing.expectError(error.DeinitDuringVisit, self.owner.tryDeinit());
    }
};

test "TextAnnotations visitor mutation is rejected for positions payloads and clear" {
    var owner = testAnnotations();
    defer owner.deinit();
    const id = try owner.addRange(.{ .start_byte = 2, .end_byte = 8 }, payload(1, 1, 1));
    var context = MutationVisitor{ .owner = &owner, .id = id };
    try owner.visitOverlapping(3, 4, &context, MutationVisitor.visit);
    try std.testing.expectEqual(@as(usize, 1), context.attempts);
    try owner.validateIntegrity();
}

test "TextAnnotations failed adds never leave a mark or payload alone" {
    var saw_failure = false;
    var saw_success = false;
    for (0..8) |fail_index| {
        var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = fail_index });
        var owner = TextAnnotations.initWithSeed(failing.allocator(), 1);
        defer owner.deinit();
        const result = owner.addRange(.{ .start_byte = 1, .end_byte = 2 }, payload(1, 1, 1));
        if (result) |id| {
            saw_success = true;
            try std.testing.expect(owner.get(id) != null);
        } else |err| {
            try std.testing.expectEqual(error.OutOfMemory, err);
            saw_failure = true;
            try std.testing.expectEqual(@as(usize, 0), owner.count());
        }
        try owner.validateIntegrity();
    }
    try std.testing.expect(saw_failure);
    try std.testing.expect(saw_success);
}

test "TextAnnotations splice scratch allocation failure preserves both structures" {
    for (0..2) |allocation_offset| {
        var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
        var owner = TextAnnotations.initWithSeed(failing.allocator(), 1);
        defer owner.deinit();
        const id = try owner.addRange(.{ .start_byte = 10, .end_byte = 20 }, .{
            .namespace = 1,
            .style_id = 8,
            .splice_policy = .invalidate,
        });
        failing.fail_index = failing.alloc_index + allocation_offset;

        try std.testing.expectError(error.OutOfMemory, owner.splice(10, 10, 0));
        try expectRange(&owner, id, 10, 20, 8);
        try owner.validateIntegrity();
    }
}

test "TextAnnotations namespace clear allocation failure preserves both structures" {
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    var owner = TextAnnotations.initWithSeed(failing.allocator(), 1);
    defer owner.deinit();
    const first = try owner.addRange(.{ .start_byte = 1, .end_byte = 2 }, payload(1, 10, 0));
    const second = try owner.addRange(.{ .start_byte = 3, .end_byte = 4 }, payload(2, 20, 0));
    failing.fail_index = failing.alloc_index;

    try std.testing.expectError(error.OutOfMemory, owner.clearNamespace(1));
    try expectRange(&owner, first, 1, 2, 10);
    try expectRange(&owner, second, 3, 4, 20);
    try owner.validateIntegrity();
}

test "TextAnnotations position overflow preserves both structures" {
    var owner = testAnnotations();
    defer owner.deinit();
    const range = try owner.addRange(.{ .start_byte = 2, .end_byte = 4 }, payload(1, 10, 0));
    const high = try owner.addPoint(.{ .byte = std.math.maxInt(u32) }, .{ .namespace = 1, .kind_flags = 9 });

    try std.testing.expectError(error.PositionOverflow, owner.splice(0, 0, 1));
    try expectRange(&owner, range, 2, 4, 10);
    try expectPoint(&owner, high, std.math.maxInt(u32), 9);
    try owner.validateIntegrity();
}

const ModelEntry = struct {
    mark: Mark,
    payload: TextAnnotations.Payload,
};

fn endpoint(position: u32, gravity: TextAnnotations.Gravity, start: u32, old_len: u32, new_len: u32) u32 {
    if (position < start) return position;
    const distance = position - start;
    if (distance > old_len) return start + distance - old_len + new_len;
    return start + if (gravity == .right) new_len else 0;
}

fn compareModel(owner: *TextAnnotations, entries: []const ModelEntry) !void {
    try std.testing.expectEqual(entries.len, owner.count());
    for (entries) |entry| {
        const actual = owner.get(entry.mark.id()).?;
        try std.testing.expectEqualDeep(entry.mark, actual.mark);
        try std.testing.expectEqualDeep(entry.payload, actual.payload);
    }
    var iterator = owner.iterator();
    var seen: usize = 0;
    while (try iterator.next()) |_| seen += 1;
    try std.testing.expectEqual(entries.len, seen);
    try owner.validateIntegrity();
}

test "TextAnnotations randomized differential tree and payload map consistency" {
    var owner = testAnnotations();
    defer owner.deinit();
    var model: std.ArrayList(ModelEntry) = .empty;
    defer model.deinit(std.testing.allocator);
    var random_state = std.Random.DefaultPrng.init(0x616e6e6f74617465);
    const random = random_state.random();
    var document_len: u32 = 100;

    for (0..2500) |step| {
        switch (random.intRangeAtMost(u8, 0, 5)) {
            0, 1 => {
                const input = TextAnnotations.RangeInput{
                    .start_byte = random.intRangeAtMost(u32, 0, document_len),
                    .end_byte = random.intRangeAtMost(u32, 0, document_len),
                    .start_gravity = if (random.boolean()) .left else .right,
                    .end_gravity = if (random.boolean()) .left else .right,
                };
                const id = try owner.addRange(input, payload(random.intRangeAtMost(u32, 0, 3), random.int(u32), random.int(u8)));
                try model.append(std.testing.allocator, .{ .mark = owner.get(id).?.mark, .payload = owner.get(id).?.payload });
            },
            2 => {
                const input = TextAnnotations.PointInput{
                    .byte = random.intRangeAtMost(u32, 0, document_len),
                    .gravity = if (random.boolean()) .left else .right,
                };
                const id = try owner.addPoint(input, .{ .namespace = random.intRangeAtMost(u32, 0, 3), .kind_flags = random.int(u32) });
                try model.append(std.testing.allocator, .{ .mark = owner.get(id).?.mark, .payload = owner.get(id).?.payload });
            },
            3 => if (model.items.len != 0) {
                const index = random.intRangeLessThan(usize, 0, model.items.len);
                try std.testing.expect(try owner.remove(model.items[index].mark.id()));
                _ = model.swapRemove(index);
            },
            4 => {
                const start = random.intRangeAtMost(u32, 0, document_len);
                const old_len = random.intRangeAtMost(u32, 0, document_len - start);
                const new_len = random.intRangeAtMost(u32, 0, 8);
                try owner.splice(start, old_len, new_len);
                for (model.items) |*entry| switch (entry.mark) {
                    .range => |*range| {
                        range.start_byte = endpoint(range.start_byte, range.start_gravity, start, old_len, new_len);
                        range.end_byte = endpoint(range.end_byte, range.end_gravity, start, old_len, new_len);
                    },
                    .point => |*point| point.byte = endpoint(point.byte, point.gravity, start, old_len, new_len),
                };
                document_len = document_len - old_len + new_len;
            },
            5 => if (model.items.len != 0) {
                const index = random.intRangeLessThan(usize, 0, model.items.len);
                const style = random.int(u32);
                const id = model.items[index].mark.id();
                try std.testing.expect(try owner.updateStyle(id, style));
                model.items[index].payload.style_id = style;
            },
            else => unreachable,
        }
        if (step % 37 == 0) try compareModel(&owner, model.items);
    }
    try compareModel(&owner, model.items);
}
