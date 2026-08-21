const std = @import("std");
const MarkTree = @import("mark-tree.zig").MarkTree;

const Allocator = std.mem.Allocator;

/// Owns edit-following annotation positions and their non-owning style metadata.
/// Payloads are POD values: dropping, replacing, or clearing one requires no
/// caller callback and never owns the object identified by `style_id`.
pub const TextAnnotations = struct {
    const Self = @This();

    pub const Gravity = MarkTree.Gravity;
    pub const RangeInput = MarkTree.RangeInput;
    pub const PointInput = MarkTree.PointInput;
    pub const Mark = MarkTree.Mark;

    pub const SplicePolicy = enum {
        /// Keep the annotation and let MarkTree collapse or move its endpoints.
        retain,
        /// Delete when removed text affects an endpoint or intersects a range.
        invalidate,
        /// Delete only when a range is wholly covered by removed text.
        delete_when_covered,
    };

    pub const PayloadInput = struct {
        namespace: u32,
        style_id: u32 = 0,
        priority: u8 = 0,
        internal: bool = false,
        kind_flags: u32 = 0,
        splice_policy: SplicePolicy = .retain,
    };

    pub const Payload = struct {
        namespace: u32,
        style_id: u32,
        priority: u8,
        sequence: u64,
        internal: bool,
        kind_flags: u32,
        splice_policy: SplicePolicy,
    };

    pub const Annotation = struct {
        mark: Mark,
        payload: Payload,

        pub fn id(self: Annotation) u64 {
            return self.mark.id();
        }
    };

    pub const IntegrityError = MarkTree.IntegrityError || error{
        MissingMark,
        CountMismatch,
    };

    allocator: Allocator,
    tree: MarkTree,
    payloads: std.AutoHashMap(u64, Payload),
    // Report storage is retained across ordinary edits. After deletions, a
    // buffer above both 256 IDs and four times the remaining count is released.
    affected_scratch: std.ArrayList(u64) = .empty,
    covered_scratch: std.ArrayList(u64) = .empty,
    next_sequence: u64 = 1,
    generation: u64 = 0,
    active_visits: usize = 0,

    pub fn init(allocator: Allocator) Self {
        return .{
            .allocator = allocator,
            .tree = MarkTree.init(allocator),
            .payloads = std.AutoHashMap(u64, Payload).init(allocator),
        };
    }

    pub fn initWithSeed(allocator: Allocator, seed: u64) Self {
        return .{
            .allocator = allocator,
            .tree = MarkTree.initWithSeed(allocator, seed),
            .payloads = std.AutoHashMap(u64, Payload).init(allocator),
        };
    }

    pub fn deinit(self: *Self) void {
        self.tryDeinit() catch @panic("TextAnnotations.deinit called during an active visit");
    }

    pub fn tryDeinit(self: *Self) !void {
        if (self.active_visits != 0) return error.DeinitDuringVisit;
        try self.tree.tryDeinit();
        self.payloads.deinit();
        self.affected_scratch.deinit(self.allocator);
        self.covered_scratch.deinit(self.allocator);
        self.* = undefined;
    }

    pub fn count(self: *const Self) usize {
        return self.payloads.count();
    }

    /// The MarkTree generation changes only when positions or membership change.
    pub fn positionGeneration(self: *const Self) u64 {
        return self.tree.generation;
    }

    pub fn addRange(self: *Self, input: RangeInput, payload: PayloadInput) !u64 {
        try self.prepareAdd();
        const id = try self.tree.addRange(input);
        self.payloads.putAssumeCapacity(id, payloadFromInput(payload, self.next_sequence));
        self.finishAdd();
        return id;
    }

    pub fn addPoint(self: *Self, input: PointInput, payload: PayloadInput) !u64 {
        try self.prepareAdd();
        const id = try self.tree.addPoint(input);
        self.payloads.putAssumeCapacity(id, payloadFromInput(payload, self.next_sequence));
        self.finishAdd();
        return id;
    }

    pub fn get(self: *Self, id: u64) ?Annotation {
        const payload = self.payloads.get(id) orelse return null;
        const mark = self.tree.get(id) orelse return null;
        return .{ .mark = mark, .payload = payload };
    }

    pub fn updateRange(self: *Self, id: u64, input: RangeInput) !bool {
        if (!self.payloads.contains(id)) return false;
        try self.checkCanMutate(1);
        const before = self.tree.generation;
        if (!try self.tree.updateRange(id, input)) return false;
        if (self.tree.generation != before) self.finishMutation();
        return true;
    }

    pub fn updatePoint(self: *Self, id: u64, input: PointInput) !bool {
        if (!self.payloads.contains(id)) return false;
        try self.checkCanMutate(1);
        const before = self.tree.generation;
        if (!try self.tree.updatePoint(id, input)) return false;
        if (self.tree.generation != before) self.finishMutation();
        return true;
    }

    /// Replaces metadata while preserving the stable sequence and all positions.
    pub fn updatePayload(self: *Self, id: u64, input: PayloadInput) !bool {
        const payload = self.payloads.getPtr(id) orelse return false;
        try self.checkCanMutate(0);
        const replacement = payloadFromInput(input, payload.sequence);
        if (std.meta.eql(payload.*, replacement)) return true;
        payload.* = replacement;
        self.finishMutation();
        return true;
    }

    pub fn updateStyle(self: *Self, id: u64, style_id: u32) !bool {
        const payload = self.payloads.getPtr(id) orelse return false;
        try self.checkCanMutate(0);
        if (payload.style_id == style_id) return true;
        payload.style_id = style_id;
        self.finishMutation();
        return true;
    }

    pub fn remove(self: *Self, id: u64) !bool {
        if (!self.payloads.contains(id)) return false;
        try self.checkCanMutate(1);
        if (!try self.tree.remove(id)) return false;
        _ = self.payloads.remove(id);
        self.finishMutation();
        return true;
    }

    /// Removes a namespace atomically with respect to allocation and preflight errors.
    pub fn clearNamespace(self: *Self, namespace: u32) !usize {
        try self.checkCanMutate(0);
        var match_count: usize = 0;
        var count_iterator = self.payloads.valueIterator();
        while (count_iterator.next()) |value| {
            match_count += @intFromBool(value.namespace == namespace);
        }
        if (match_count == 0) return 0;

        try self.checkTreeGenerations(match_count);
        try self.affected_scratch.ensureTotalCapacity(self.allocator, match_count);
        self.affected_scratch.clearRetainingCapacity();
        var payload_iterator = self.payloads.iterator();
        while (payload_iterator.next()) |entry| {
            if (entry.value_ptr.namespace == namespace) self.affected_scratch.appendAssumeCapacity(entry.key_ptr.*);
        }

        for (self.affected_scratch.items) |id| {
            const removed = try self.tree.remove(id);
            std.debug.assert(removed);
            _ = self.payloads.remove(id);
        }
        self.finishMutation();
        self.finishScratchUse(true);
        return match_count;
    }

    pub fn clearOwner(self: *Self, owner: u32) !usize {
        return self.clearNamespace(owner);
    }

    pub fn splice(self: *Self, start_byte: u32, old_len: u32, new_len: u32) !void {
        try self.checkCanMutate(0);
        const scratch_len = if (old_len == 0) 0 else self.count();
        try self.affected_scratch.resize(self.allocator, scratch_len);
        try self.covered_scratch.resize(self.allocator, scratch_len);
        var deleted_count: usize = 0;
        defer self.finishScratchUse(deleted_count != 0);
        const generation_budget = if (old_len == 0 and new_len == 0)
            0
        else
            std.math.add(usize, self.count(), 1) catch return error.GenerationExhausted;
        try self.checkTreeGenerations(generation_budget);

        const tree_generation = self.tree.generation;
        const report = try self.tree.spliceWithReport(
            start_byte,
            old_len,
            new_len,
            self.affected_scratch.items,
            self.covered_scratch.items,
        );

        sortIds(report.affected_ids);
        sortIds(report.covered_range_ids);
        var covered_index: usize = 0;
        for (report.affected_ids) |id| {
            while (covered_index < report.covered_range_ids.len and report.covered_range_ids[covered_index] < id) {
                covered_index += 1;
            }
            const covered = covered_index < report.covered_range_ids.len and report.covered_range_ids[covered_index] == id;
            if (covered) covered_index += 1;
            const payload = self.payloads.get(id).?;
            const should_delete = payload.splice_policy == .invalidate or
                (payload.splice_policy == .delete_when_covered and covered);
            if (should_delete) {
                const removed = try self.tree.remove(id);
                std.debug.assert(removed);
                _ = self.payloads.remove(id);
                deleted_count += 1;
            }
        }
        if (self.tree.generation != tree_generation) self.finishMutation();
    }

    pub fn moveRegion(self: *Self, start_byte: u32, len: u32, destination_byte: u32) !void {
        try self.checkCanMutate(1);
        const before = self.tree.generation;
        try self.tree.moveRegion(start_byte, len, destination_byte);
        if (self.tree.generation != before) self.finishMutation();
    }

    /// Visits highest priority first; equal priorities retain insertion order.
    pub fn visitOverlapping(self: *Self, first_byte: u32, second_byte: u32, context: anytype, visitor: anytype) !void {
        var annotations: std.ArrayList(Annotation) = .empty;
        defer annotations.deinit(self.allocator);
        var collector = Collector{ .owner = self, .annotations = &annotations };
        self.active_visits += 1;
        defer self.active_visits -= 1;
        try self.tree.visitOverlapping(first_byte, second_byte, &collector, Collector.range);
        sortByPrecedence(annotations.items);
        for (annotations.items) |annotation| try visitor(context, annotation);
    }

    /// Visits highest priority first; equal priorities retain insertion order.
    pub fn visitStartingAt(self: *Self, byte: u32, context: anytype, visitor: anytype) !void {
        var annotations: std.ArrayList(Annotation) = .empty;
        defer annotations.deinit(self.allocator);
        var collector = Collector{ .owner = self, .annotations = &annotations };
        self.active_visits += 1;
        defer self.active_visits -= 1;
        try self.tree.visitStartingAt(byte, &collector, Collector.range);
        sortByPrecedence(annotations.items);
        for (annotations.items) |annotation| try visitor(context, annotation);
    }

    /// Visits highest priority first; equal priorities retain insertion order.
    pub fn visitPointsAt(self: *Self, byte: u32, context: anytype, visitor: anytype) !void {
        var annotations: std.ArrayList(Annotation) = .empty;
        defer annotations.deinit(self.allocator);
        var collector = Collector{ .owner = self, .annotations = &annotations };
        self.active_visits += 1;
        defer self.active_visits -= 1;
        try self.tree.visitPointsAt(byte, &collector, Collector.point);
        sortByPrecedence(annotations.items);
        for (annotations.items) |annotation| try visitor(context, annotation);
    }

    /// Iterates by derived lower position then stable ID. Any annotation mutation
    /// invalidates the iterator, including a payload-only change or namespace clear.
    pub fn iterator(self: *Self) Iterator {
        return .{
            .owner = self,
            .tree_iterator = self.tree.iterator(),
            .generation = self.generation,
        };
    }

    pub const Iterator = struct {
        owner: *Self,
        tree_iterator: MarkTree.Iterator,
        generation: u64,

        pub fn next(self: *Iterator) !?Annotation {
            if (self.generation != self.owner.generation) return error.IteratorInvalidated;
            const mark = try self.tree_iterator.next() orelse return null;
            return .{ .mark = mark, .payload = self.owner.payloads.get(mark.id()).? };
        }
    };

    pub fn validateIntegrity(self: *Self) IntegrityError!void {
        try self.tree.validateIntegrity();
        if (self.tree.count() != self.payloads.count()) return error.CountMismatch;
        var payload_iterator = self.payloads.keyIterator();
        while (payload_iterator.next()) |id| {
            if (self.tree.get(id.*) == null) return error.MissingMark;
        }
    }

    const Collector = struct {
        owner: *Self,
        annotations: *std.ArrayList(Annotation),

        fn range(self: *Collector, value: MarkTree.Range) !void {
            try self.annotations.append(self.owner.allocator, .{
                .mark = .{ .range = value },
                .payload = self.owner.payloads.get(value.id).?,
            });
        }

        fn point(self: *Collector, value: MarkTree.Point) !void {
            try self.annotations.append(self.owner.allocator, .{
                .mark = .{ .point = value },
                .payload = self.owner.payloads.get(value.id).?,
            });
        }
    };

    fn prepareAdd(self: *Self) !void {
        try self.checkCanMutate(1);
        if (self.next_sequence == 0 or self.next_sequence == std.math.maxInt(u64)) return error.SequenceExhausted;
        try self.payloads.ensureUnusedCapacity(1);
    }

    fn finishAdd(self: *Self) void {
        self.next_sequence += 1;
        self.finishMutation();
    }

    fn checkCanMutate(self: *const Self, tree_generations: usize) !void {
        if (self.active_visits != 0) return error.MutationDuringVisit;
        if (self.generation == std.math.maxInt(u64)) return error.GenerationExhausted;
        try self.checkTreeGenerations(tree_generations);
    }

    fn checkTreeGenerations(self: *const Self, needed: usize) !void {
        const available = std.math.maxInt(u64) - self.tree.generation;
        const needed_u64 = std.math.cast(u64, needed) orelse return error.GenerationExhausted;
        if (needed_u64 > available) return error.GenerationExhausted;
    }

    fn finishMutation(self: *Self) void {
        self.generation += 1;
    }

    fn finishScratchUse(self: *Self, destructive: bool) void {
        self.affected_scratch.clearRetainingCapacity();
        self.covered_scratch.clearRetainingCapacity();
        if (!destructive) return;
        self.trimScratch(&self.affected_scratch);
        self.trimScratch(&self.covered_scratch);
    }

    fn trimScratch(self: *Self, scratch: *std.ArrayList(u64)) void {
        const proportional_limit = std.math.mul(usize, self.count(), 4) catch std.math.maxInt(usize);
        const retained_limit = @max(@as(usize, 256), proportional_limit);
        if (scratch.capacity > retained_limit) scratch.clearAndFree(self.allocator);
    }

    fn payloadFromInput(input: PayloadInput, sequence: u64) Payload {
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

    fn sortByPrecedence(annotations: []Annotation) void {
        std.mem.sort(Annotation, annotations, {}, struct {
            fn lessThan(_: void, a: Annotation, b: Annotation) bool {
                if (a.payload.priority != b.payload.priority) return a.payload.priority > b.payload.priority;
                return a.payload.sequence < b.payload.sequence;
            }
        }.lessThan);
    }

    fn sortIds(ids: []u64) void {
        std.mem.sort(u64, ids, {}, struct {
            fn lessThan(_: void, a: u64, b: u64) bool {
                return a < b;
            }
        }.lessThan);
    }
};
