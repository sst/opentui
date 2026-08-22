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

test "TextAnnotations splice policy merge handles scrambled IDs and deletion boundaries" {
    var owner = testAnnotations();
    defer owner.deinit();

    const outside = try owner.addRange(.{ .start_byte = 40, .end_byte = 50 }, .{
        .namespace = 1,
        .splice_policy = .invalidate,
    });
    const covered = try owner.addRange(.{ .start_byte = 12, .end_byte = 18 }, .{
        .namespace = 1,
        .splice_policy = .delete_when_covered,
    });
    const boundary = try owner.addRange(.{ .start_byte = 5, .end_byte = 10 }, .{
        .namespace = 1,
        .splice_policy = .delete_when_covered,
    });
    const reversed_covered = try owner.addRange(.{ .start_byte = 19, .end_byte = 11 }, .{
        .namespace = 1,
        .splice_policy = .delete_when_covered,
    });
    const reversed_partial = try owner.addRange(.{ .start_byte = 25, .end_byte = 15 }, .{
        .namespace = 1,
        .splice_policy = .delete_when_covered,
    });
    const boundary_point = try owner.addPoint(.{ .byte = 20 }, .{
        .namespace = 1,
        .splice_policy = .invalidate,
    });
    const retained_point = try owner.addPoint(.{ .byte = 15 }, .{
        .namespace = 1,
        .kind_flags = 9,
        .splice_policy = .delete_when_covered,
    });

    try owner.splice(10, 10, 2);
    try expectRange(&owner, outside, 32, 42, 0);
    try std.testing.expect(owner.get(covered) == null);
    try expectRange(&owner, boundary, 5, 10, 0);
    try std.testing.expect(owner.get(reversed_covered) == null);
    try expectRange(&owner, reversed_partial, 17, 10, 0);
    try std.testing.expect(owner.get(boundary_point) == null);
    try expectPoint(&owner, retained_point, 12, 9);
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
    try std.testing.expectEqualSlices(u64, &.{ high, new_equal, old_equal }, &.{
        values.items[0].id(),
        values.items[1].id(),
        values.items[2].id(),
    });

    values.clearRetainingCapacity();
    try owner.visitStartingAt(5, &collector, Collector.visit);
    try std.testing.expectEqualSlices(u64, &.{ high, new_equal, old_equal }, &.{
        values.items[0].id(),
        values.items[1].id(),
        values.items[2].id(),
    });

    values.clearRetainingCapacity();
    try owner.visitPointsAt(5, &collector, Collector.visit);
    try std.testing.expectEqualSlices(u64, &.{ point_new, point_old }, &.{
        values.items[0].id(),
        values.items[1].id(),
    });
}

test "TextAnnotations retained splits preserve sequence without consuming caller order" {
    var owner = testAnnotations();
    defer owner.deinit();
    const retained = try owner.addRange(.{ .start_byte = 0, .end_byte = 12 }, payload(1, 1, 7));
    const newer = try owner.addRange(.{ .start_byte = 0, .end_byte = 12 }, payload(2, 2, 7));
    const retained_sequence = owner.get(retained).?.payload.sequence;

    try owner.clipOwnerRange(1, 4, 8);
    try owner.clipOwnerRange(1, 9, 10);

    var retained_count: usize = 0;
    var iterator = owner.iterator();
    while (try iterator.next()) |annotation| {
        if (annotation.payload.namespace != 1) continue;
        retained_count += 1;
        try std.testing.expectEqual(retained_sequence, annotation.payload.sequence);
    }
    try std.testing.expectEqual(@as(usize, 3), retained_count);

    const fresh_inputs = [_]TextAnnotations.RangeInput{
        .{ .start_byte = 0, .end_byte = 12 },
        .{ .start_byte = 0, .end_byte = 12 },
    };
    const fresh_payloads = [_]PayloadInput{ payload(3, 3, 7), payload(4, 4, 7) };
    var fresh_ranges = try owner.prepareAddRanges(&fresh_inputs, &fresh_payloads);
    defer fresh_ranges.deinit();
    const fresh = fresh_ranges.idAt(0);
    const freshest = fresh_ranges.idAt(1);
    try owner.commitPreparedRanges(&fresh_ranges);
    try std.testing.expectEqual(@as(u64, 3), owner.get(fresh).?.payload.sequence);
    try std.testing.expectEqual(@as(u64, 4), owner.get(freshest).?.payload.sequence);
    const following = try owner.addPoint(.{ .byte = 11 }, payload(5, 5, 7));
    try std.testing.expectEqual(@as(u64, 5), owner.get(following).?.payload.sequence);

    var values: std.ArrayList(Annotation) = .empty;
    defer values.deinit(std.testing.allocator);
    var collector = Collector{ .allocator = std.testing.allocator, .values = &values };
    try owner.visitOverlapping(10, 11, &collector, Collector.visit);
    try std.testing.expectEqualSlices(u64, &.{ freshest, fresh, newer }, &.{
        values.items[0].id(),
        values.items[1].id(),
        values.items[2].id(),
    });
    try std.testing.expectEqual(retained_sequence, values.items[3].payload.sequence);
    try owner.validateIntegrity();
}

test "TextAnnotations preserved sequence preparation validates ownership and staleness" {
    var owner = testAnnotations();
    defer owner.deinit();
    const source = try owner.addRange(.{ .start_byte = 0, .end_byte = 2 }, payload(1, 1, 1));
    const source_sequence = owner.get(source).?.payload.sequence;
    const inputs = [_]TextAnnotations.RangeInput{.{ .start_byte = 3, .end_byte = 4 }};
    const payloads = [_]PayloadInput{payload(1, 1, 1)};

    try std.testing.expectError(
        error.InvalidSequence,
        owner.prepareAddRangesWithSequences(&inputs, &payloads, &.{source_sequence + 1}),
    );
    const mismatched_payloads = [_]PayloadInput{payload(1, 2, 1)};
    try std.testing.expectError(
        error.InvalidSequence,
        owner.prepareAddRangesWithSequences(&inputs, &mismatched_payloads, &.{source_sequence}),
    );
    const duplicate_inputs = [_]TextAnnotations.RangeInput{
        .{ .start_byte = 3, .end_byte = 4 },
        .{ .start_byte = 4, .end_byte = 5 },
    };
    const duplicate_payloads = [_]PayloadInput{ payload(1, 1, 1), payload(1, 1, 1) };
    try std.testing.expectError(
        error.InvalidSequence,
        owner.prepareAddRangesWithSequences(
            &duplicate_inputs,
            &duplicate_payloads,
            &.{ source_sequence, source_sequence },
        ),
    );
    var prepared = try owner.prepareAddRangesWithSequences(&inputs, &payloads, &.{source_sequence});
    defer prepared.deinit();
    _ = try owner.addPoint(.{ .byte = 5 }, payload(2, 2, 1));
    try std.testing.expectError(error.StalePreparation, owner.commitPreparedRanges(&prepared));
    try std.testing.expectEqual(@as(usize, 2), owner.count());
    try owner.validateIntegrity();
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

test "TextAnnotations absent and sparse namespace clears allocate only for matches" {
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    var owner = TextAnnotations.initWithSeed(failing.allocator(), 1);
    defer owner.deinit();

    _ = try owner.addPoint(.{ .byte = 0 }, payload(1, 0, 0));
    try std.testing.expectEqual(@as(usize, 1), try owner.clearNamespace(1));
    for (0..300) |index| {
        _ = try owner.addPoint(.{ .byte = @intCast(index) }, payload(2, @intCast(index), 0));
    }
    const sparse = try owner.addPoint(.{ .byte = 300 }, payload(1, 999, 0));

    failing.fail_index = failing.alloc_index;
    const allocation_index = failing.alloc_index;
    try std.testing.expectEqual(@as(usize, 0), try owner.clearOwner(99));
    try std.testing.expectEqual(allocation_index, failing.alloc_index);
    try std.testing.expectEqual(@as(usize, 1), try owner.clearNamespace(1));
    try std.testing.expectEqual(allocation_index, failing.alloc_index);
    try std.testing.expect(owner.get(sparse) == null);
    try owner.validateIntegrity();
}

test "TextAnnotations destructive clear and splice release scratch high-water storage" {
    var owner = testAnnotations();
    defer owner.deinit();

    _ = try owner.addPoint(.{ .byte = 0 }, payload(2, 0, 0));
    for (0..600) |index| {
        _ = try owner.addPoint(.{ .byte = @intCast(index) }, payload(1, @intCast(index), 0));
    }
    try std.testing.expectEqual(@as(usize, 600), try owner.clearNamespace(1));
    try std.testing.expectEqual(@as(usize, 0), owner.affected_scratch.capacity);

    for (0..600) |index| {
        _ = try owner.addRange(.{ .start_byte = 10, .end_byte = 20 }, .{
            .namespace = 3,
            .style_id = @intCast(index),
            .splice_policy = .invalidate,
        });
    }
    try owner.splice(10, 10, 0);
    try std.testing.expectEqual(@as(usize, 0), owner.affected_scratch.capacity);
    try std.testing.expectEqual(@as(usize, 0), owner.covered_scratch.capacity);
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

test "TextAnnotations rejects prepared operations after any source mutation" {
    var owner = testAnnotations();
    defer owner.deinit();
    const id = try owner.addRange(.{ .start_byte = 1, .end_byte = 3 }, payload(1, 7, 1));
    var prepared = try owner.prepareSplice(1, 1, 0);
    defer prepared.deinit();
    try std.testing.expect(try owner.updateStyle(id, 8));
    try std.testing.expectError(error.StalePreparation, owner.commitPreparedSplice(&prepared));
    try expectRange(&owner, id, 1, 3, 8);
}

const ModelEntry = struct {
    mark: Mark,
    payload: TextAnnotations.Payload,
};

const DeletionClassification = struct { affected: bool, covered: bool };

fn endpoint(position: u32, gravity: TextAnnotations.Gravity, start: u32, old_len: u32, new_len: u32) u32 {
    if (position < start) return position;
    const distance = position - start;
    if (distance > old_len) return start + distance - old_len + new_len;
    return start + if (gravity == .right) new_len else 0;
}

fn classifyDeletion(mark: Mark, start: u32, old_len: u32) DeletionClassification {
    if (old_len == 0) return .{ .affected = false, .covered = false };
    const old_end = start + old_len;
    return switch (mark) {
        .point => |point| .{
            .affected = point.byte >= start and point.byte <= old_end,
            .covered = false,
        },
        .range => |range| blk: {
            const lower = @min(range.start_byte, range.end_byte);
            const upper = @max(range.start_byte, range.end_byte);
            const endpoint_affected = (range.start_byte >= start and range.start_byte <= old_end) or
                (range.end_byte >= start and range.end_byte <= old_end);
            const overlaps = range.start_byte < range.end_byte and range.start_byte < old_end and range.end_byte > start;
            break :blk .{
                .affected = endpoint_affected or overlaps,
                .covered = lower >= start and upper <= old_end,
            };
        },
    };
}

fn applyModelSplice(entries: *std.ArrayList(ModelEntry), start: u32, old_len: u32, new_len: u32) void {
    var index: usize = 0;
    while (index < entries.items.len) {
        const classification = classifyDeletion(entries.items[index].mark, start, old_len);
        const policy = entries.items[index].payload.splice_policy;
        if ((policy == .invalidate and classification.affected) or
            (policy == .delete_when_covered and classification.covered))
        {
            _ = entries.swapRemove(index);
            continue;
        }
        switch (entries.items[index].mark) {
            .range => |*range| {
                range.start_byte = endpoint(range.start_byte, range.start_gravity, start, old_len, new_len);
                range.end_byte = endpoint(range.end_byte, range.end_gravity, start, old_len, new_len);
            },
            .point => |*point| point.byte = endpoint(point.byte, point.gravity, start, old_len, new_len),
        }
        index += 1;
    }
}

fn movedEndpoint(position: u32, gravity: TextAnnotations.Gravity, start: u32, len: u32, destination: u32) u32 {
    const end = start + len;
    const captured = (position > start and position < end) or
        (position == start and gravity == .right) or
        (position == end and gravity == .left);
    if (captured) return destination + position - start;
    const removed = endpoint(position, gravity, start, len, 0);
    return endpoint(removed, gravity, destination, 0, len);
}

fn applyModelMove(entries: []ModelEntry, start: u32, len: u32, destination: u32) void {
    if (len == 0) return;
    for (entries) |*entry| switch (entry.mark) {
        .range => |*range| {
            range.start_byte = movedEndpoint(range.start_byte, range.start_gravity, start, len, destination);
            range.end_byte = movedEndpoint(range.end_byte, range.end_gravity, start, len, destination);
        },
        .point => |*point| point.byte = movedEndpoint(point.byte, point.gravity, start, len, destination),
    };
}

fn randomPolicy(random: std.Random) TextAnnotations.SplicePolicy {
    return switch (random.intRangeAtMost(u8, 0, 2)) {
        0 => .retain,
        1 => .invalidate,
        2 => .delete_when_covered,
        else => unreachable,
    };
}

fn randomPayload(random: std.Random, namespace: u32) PayloadInput {
    return .{
        .namespace = namespace,
        .style_id = random.int(u32),
        .priority = random.int(u8),
        .internal = random.boolean(),
        .kind_flags = random.int(u32),
        .splice_policy = randomPolicy(random),
    };
}

fn modelPayload(input: PayloadInput, sequence: u64) TextAnnotations.Payload {
    return .{
        .namespace = input.namespace,
        .style_id = input.style_id,
        .priority = input.priority,
        .sequence = sequence,
        .internal = input.internal,
        .kind_flags = input.kind_flags,
        .splice_policy = input.splice_policy,
    };
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

test "TextAnnotations randomized differential owner operations and iterator invalidation" {
    var owner = testAnnotations();
    defer owner.deinit();
    var model: std.ArrayList(ModelEntry) = .empty;
    defer model.deinit(std.testing.allocator);
    var random_state = std.Random.DefaultPrng.init(0x616e6e6f74617465);
    const random = random_state.random();
    var document_len: u32 = 100;

    for (0..5000) |step| {
        var iterator = owner.iterator();
        var mutated = false;
        switch (random.intRangeAtMost(u8, 0, 9)) {
            0 => {
                const input = TextAnnotations.RangeInput{
                    .start_byte = random.intRangeAtMost(u32, 0, document_len),
                    .end_byte = random.intRangeAtMost(u32, 0, document_len),
                    .start_gravity = if (random.boolean()) .left else .right,
                    .end_gravity = if (random.boolean()) .left else .right,
                };
                const id = try owner.addRange(input, randomPayload(random, random.intRangeAtMost(u32, 0, 5)));
                try model.append(std.testing.allocator, .{ .mark = owner.get(id).?.mark, .payload = owner.get(id).?.payload });
                mutated = true;
            },
            1 => {
                const input = TextAnnotations.PointInput{
                    .byte = random.intRangeAtMost(u32, 0, document_len),
                    .gravity = if (random.boolean()) .left else .right,
                };
                const id = try owner.addPoint(input, randomPayload(random, random.intRangeAtMost(u32, 0, 5)));
                try model.append(std.testing.allocator, .{ .mark = owner.get(id).?.mark, .payload = owner.get(id).?.payload });
                mutated = true;
            },
            2 => if (model.items.len != 0) {
                const index = random.intRangeLessThan(usize, 0, model.items.len);
                try std.testing.expect(try owner.remove(model.items[index].mark.id()));
                _ = model.swapRemove(index);
                mutated = true;
            },
            3 => {
                const start = random.intRangeAtMost(u32, 0, document_len);
                const old_len = random.intRangeAtMost(u32, 0, document_len - start);
                const new_len = random.intRangeAtMost(u32, 0, 8);
                try owner.splice(start, old_len, new_len);
                applyModelSplice(&model, start, old_len, new_len);
                document_len = document_len - old_len + new_len;
                mutated = old_len != 0 or new_len != 0;
            },
            4 => {
                const namespace = random.intRangeAtMost(u32, 0, 5);
                var index: usize = 0;
                var removed: usize = 0;
                while (index < model.items.len) {
                    if (model.items[index].payload.namespace == namespace) {
                        _ = model.swapRemove(index);
                        removed += 1;
                    } else {
                        index += 1;
                    }
                }
                try std.testing.expectEqual(removed, try owner.clearNamespace(namespace));
                mutated = removed != 0;
            },
            5 => if (model.items.len != 0) {
                const index = random.intRangeLessThan(usize, 0, model.items.len);
                const id = model.items[index].mark.id();
                const input = TextAnnotations.RangeInput{
                    .start_byte = random.intRangeAtMost(u32, 0, document_len),
                    .end_byte = random.intRangeAtMost(u32, 0, document_len),
                    .start_gravity = if (random.boolean()) .left else .right,
                    .end_gravity = if (random.boolean()) .left else .right,
                };
                switch (model.items[index].mark) {
                    .range => {
                        const replacement: Mark = .{ .range = .{
                            .id = id,
                            .start_byte = input.start_byte,
                            .end_byte = input.end_byte,
                            .start_gravity = input.start_gravity,
                            .end_gravity = input.end_gravity,
                        } };
                        mutated = !std.meta.eql(model.items[index].mark, replacement);
                        try std.testing.expect(try owner.updateRange(id, input));
                        model.items[index].mark = replacement;
                    },
                    .point => try std.testing.expect(!try owner.updateRange(id, input)),
                }
            },
            6 => if (model.items.len != 0) {
                const index = random.intRangeLessThan(usize, 0, model.items.len);
                const id = model.items[index].mark.id();
                const input = TextAnnotations.PointInput{
                    .byte = random.intRangeAtMost(u32, 0, document_len),
                    .gravity = if (random.boolean()) .left else .right,
                };
                switch (model.items[index].mark) {
                    .point => {
                        const replacement: Mark = .{ .point = .{ .id = id, .byte = input.byte, .gravity = input.gravity } };
                        mutated = !std.meta.eql(model.items[index].mark, replacement);
                        try std.testing.expect(try owner.updatePoint(id, input));
                        model.items[index].mark = replacement;
                    },
                    .range => try std.testing.expect(!try owner.updatePoint(id, input)),
                }
            },
            7 => if (model.items.len != 0) {
                const index = random.intRangeLessThan(usize, 0, model.items.len);
                const input = randomPayload(random, random.intRangeAtMost(u32, 0, 5));
                const replacement = modelPayload(input, model.items[index].payload.sequence);
                mutated = !std.meta.eql(model.items[index].payload, replacement);
                try std.testing.expect(try owner.updatePayload(model.items[index].mark.id(), input));
                model.items[index].payload = replacement;
            },
            8 => {
                const start = random.intRangeAtMost(u32, 0, document_len);
                const len = random.intRangeAtMost(u32, 0, document_len - start);
                const destination = random.intRangeAtMost(u32, 0, document_len - len);
                try owner.moveRegion(start, len, destination);
                applyModelMove(model.items, start, len, destination);
                mutated = len != 0 and destination != start;
            },
            9 => if (model.items.len != 0) {
                const index = random.intRangeLessThan(usize, 0, model.items.len);
                const style = random.int(u32);
                mutated = model.items[index].payload.style_id != style;
                try std.testing.expect(try owner.updateStyle(model.items[index].mark.id(), style));
                model.items[index].payload.style_id = style;
            },
            else => unreachable,
        }
        if (mutated) {
            try std.testing.expectError(error.IteratorInvalidated, iterator.next());
        } else {
            _ = try iterator.next();
        }
        if (step % 37 == 0) try compareModel(&owner, model.items);
    }
    try compareModel(&owner, model.items);
}
