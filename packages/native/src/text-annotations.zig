const std = @import("std");
const MarkTree = @import("mark-tree.zig").MarkTree;

const Allocator = std.mem.Allocator;
var next_annotation_nonce = std.atomic.Value(u32).init(1);

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

    pub const PreparedSplice = struct {
        owner: *Self,
        start_byte: u32,
        old_len: u32,
        new_len: u32,
        tree_splice: MarkTree.PreparedSplice,
        affected_storage: []u64,
        covered_storage: []u64,
        delete_storage: []u64,
        delete_ids: []u64,
        source_generation: u64,
        committed: bool = false,

        pub fn deinit(self: *PreparedSplice) void {
            if (self.affected_storage.len != 0) self.owner.allocator.free(self.affected_storage);
            if (self.covered_storage.len != 0) self.owner.allocator.free(self.covered_storage);
            if (self.delete_storage.len != 0) self.owner.allocator.free(self.delete_storage);
            self.* = undefined;
        }
    };

    pub const PreparedRanges = struct {
        owner: *Self,
        tree_ranges: MarkTree.PreparedRanges,
        payloads: []Payload,
        next_sequence: u64,
        source_generation: u64,
        committed: bool = false,

        pub fn idAt(self: *const PreparedRanges, index: usize) u64 {
            return self.tree_ranges.idAt(index);
        }

        pub fn deinit(self: *PreparedRanges) void {
            self.tree_ranges.deinit();
            self.owner.allocator.free(self.payloads);
            self.* = undefined;
        }
    };

    allocator: Allocator,
    tree: MarkTree,
    payloads: std.AutoHashMap(u64, Payload),
    // Report storage is retained across ordinary edits. After deletions, a
    // buffer above both 256 IDs and four times the remaining count is released.
    affected_scratch: std.ArrayList(u64) = .empty,
    covered_scratch: std.ArrayList(u64) = .empty,
    non_retaining_policy_count: usize = 0,
    next_sequence: u64 = 1,
    generation: u64 = 0,
    active_visits: usize = 0,

    pub fn init(allocator: Allocator) Self {
        const nonce = next_annotation_nonce.fetchAdd(1, .monotonic);
        if (nonce == std.math.maxInt(u32)) @panic("TextAnnotations ID generations exhausted");
        return .{
            .allocator = allocator,
            .tree = MarkTree.initWithSeedAndNonce(allocator, @as(u64, nonce) *% 0x9e3779b97f4a7c15, nonce),
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

    pub fn clone(self: *Self, allocator: Allocator) !Self {
        var tree = try self.tree.clone(allocator);
        errdefer tree.deinit();
        var payloads = std.AutoHashMap(u64, Payload).init(allocator);
        errdefer payloads.deinit();
        try payloads.ensureTotalCapacity(@intCast(self.payloads.count()));
        var payload_iterator = self.payloads.iterator();
        while (payload_iterator.next()) |entry| payloads.putAssumeCapacity(entry.key_ptr.*, entry.value_ptr.*);
        return .{
            .allocator = allocator,
            .tree = tree,
            .payloads = payloads,
            .non_retaining_policy_count = self.non_retaining_policy_count,
            .next_sequence = self.next_sequence,
            .generation = self.generation,
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
        self.non_retaining_policy_count += @intFromBool(payload.splice_policy != .retain);
        self.finishAdd();
        return id;
    }

    pub fn prepareAddRanges(self: *Self, inputs: []const RangeInput, payload_inputs: []const PayloadInput) !PreparedRanges {
        return self.prepareAddRangesInternal(inputs, payload_inputs, null);
    }

    /// Prepares retained fragments with their original logical insertion
    /// sequences. Each sequence/payload pair must still belong to this owner;
    /// fresh insertion sequences remain globally unique and monotonic.
    pub fn prepareAddRangesWithSequences(
        self: *Self,
        inputs: []const RangeInput,
        payload_inputs: []const PayloadInput,
        sequences: []const u64,
    ) !PreparedRanges {
        return self.prepareAddRangesInternal(inputs, payload_inputs, sequences);
    }

    fn prepareAddRangesInternal(
        self: *Self,
        inputs: []const RangeInput,
        payload_inputs: []const PayloadInput,
        preserved_sequences: ?[]const u64,
    ) !PreparedRanges {
        if (inputs.len != payload_inputs.len) return error.CountMismatch;
        try self.checkCanMutate(inputs.len);
        if (preserved_sequences) |sequences| {
            if (inputs.len != sequences.len) return error.CountMismatch;
            var available = std.AutoHashMap(Payload, usize).init(self.allocator);
            defer available.deinit();
            try available.ensureTotalCapacity(@intCast(self.payloads.count()));
            var payload_iterator = self.payloads.valueIterator();
            while (payload_iterator.next()) |payload| {
                const entry = available.getOrPutAssumeCapacity(payload.*);
                if (entry.found_existing) {
                    entry.value_ptr.* += 1;
                } else {
                    entry.value_ptr.* = 1;
                }
            }
            for (sequences, payload_inputs) |sequence, payload| {
                const available_count = available.getPtr(payloadFromInput(payload, sequence)) orelse return error.InvalidSequence;
                if (available_count.* == 0) return error.InvalidSequence;
                available_count.* -= 1;
            }
        }
        const next_sequence = if (preserved_sequences == null) blk: {
            const count_u64 = std.math.cast(u64, inputs.len) orelse return error.SequenceExhausted;
            if (self.next_sequence == 0 or count_u64 > std.math.maxInt(u64) - self.next_sequence) return error.SequenceExhausted;
            break :blk self.next_sequence + count_u64;
        } else self.next_sequence;
        const additional_count = std.math.cast(u32, inputs.len) orelse return error.SequenceExhausted;
        try self.payloads.ensureUnusedCapacity(additional_count);
        var tree_ranges = try self.tree.prepareAddRanges(inputs);
        errdefer tree_ranges.deinit();
        const payloads = try self.allocator.alloc(Payload, inputs.len);
        errdefer self.allocator.free(payloads);
        for (payload_inputs, 0..) |payload, index| {
            const sequence = if (preserved_sequences) |sequences|
                sequences[index]
            else
                self.next_sequence + @as(u64, @intCast(index));
            payloads[index] = payloadFromInput(payload, sequence);
        }
        return .{
            .owner = self,
            .tree_ranges = tree_ranges,
            .payloads = payloads,
            .next_sequence = next_sequence,
            .source_generation = self.generation,
        };
    }

    pub fn commitPreparedRanges(self: *Self, prepared: *PreparedRanges) !void {
        std.debug.assert(prepared.owner == self and !prepared.committed);
        if (prepared.source_generation != self.generation) return error.StalePreparation;
        try self.tree.commitPreparedRanges(&prepared.tree_ranges);
        for (prepared.payloads, 0..) |payload, index| {
            self.payloads.putAssumeCapacity(prepared.idAt(index), payload);
            self.non_retaining_policy_count += @intFromBool(payload.splice_policy != .retain);
        }
        self.next_sequence = prepared.next_sequence;
        if (prepared.payloads.len != 0) self.finishMutation();
        prepared.committed = true;
    }

    pub fn addPoint(self: *Self, input: PointInput, payload: PayloadInput) !u64 {
        try self.prepareAdd();
        const id = try self.tree.addPoint(input);
        self.payloads.putAssumeCapacity(id, payloadFromInput(payload, self.next_sequence));
        self.non_retaining_policy_count += @intFromBool(payload.splice_policy != .retain);
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
        self.non_retaining_policy_count -= @intFromBool(payload.splice_policy != .retain);
        self.non_retaining_policy_count += @intFromBool(replacement.splice_policy != .retain);
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

    /// Reserves the annotation generations needed by an infallible prepared
    /// style publication. Positions and MarkTree generations are unchanged.
    pub fn prepareStyleUpdates(self: *const Self, update_count: usize) !void {
        if (self.active_visits != 0) return error.MutationDuringVisit;
        const update_count_u64 = std.math.cast(u64, update_count) orelse return error.GenerationExhausted;
        if (update_count_u64 > std.math.maxInt(u64) - self.generation) return error.GenerationExhausted;
    }

    pub fn commitPreparedStyle(self: *Self, id: u64, style_id: u32, kind_flags: u32) void {
        const payload = self.payloads.getPtr(id) orelse unreachable;
        std.debug.assert(payload.style_id != style_id or payload.kind_flags != kind_flags);
        payload.style_id = style_id;
        payload.kind_flags = kind_flags;
        self.finishMutation();
    }

    pub fn remove(self: *Self, id: u64) !bool {
        const payload = self.payloads.get(id) orelse return false;
        try self.checkCanMutate(1);
        if (!try self.tree.remove(id)) return false;
        self.non_retaining_policy_count -= @intFromBool(payload.splice_policy != .retain);
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
            const payload = self.payloads.get(id).?;
            const removed = try self.tree.remove(id);
            std.debug.assert(removed);
            self.non_retaining_policy_count -= @intFromBool(payload.splice_policy != .retain);
            _ = self.payloads.remove(id);
        }
        self.finishMutation();
        self.finishScratchUse(true);
        return match_count;
    }

    pub fn clearOwner(self: *Self, owner: u32) !usize {
        return self.clearNamespace(owner);
    }

    /// Removes the owner's visual coverage in [start_byte, end_byte). Ranges
    /// crossing one edge are clipped; ranges crossing both edges are split.
    /// The left fragment retains the old ID and the right fragment gets a new
    /// ID. Call this on a transaction candidate to publish the result atomically.
    pub fn clipOwnerRange(self: *Self, owner: u32, start_byte: u32, end_byte: u32) !void {
        return self.clipRangeInternal(owner, start_byte, end_byte);
    }

    pub fn clipRange(self: *Self, start_byte: u32, end_byte: u32) !void {
        return self.clipRangeInternal(null, start_byte, end_byte);
    }

    fn clipRangeInternal(self: *Self, owner: ?u32, start_byte: u32, end_byte: u32) !void {
        if (start_byte >= end_byte) return;
        var matches: std.ArrayList(Annotation) = .empty;
        defer matches.deinit(self.allocator);
        var split_count: usize = 0;
        var it = self.iterator();
        while (try it.next()) |annotation| {
            if ((owner != null and annotation.payload.namespace != owner.?) or annotation.mark != .range) continue;
            const range = annotation.mark.range;
            if (range.start_byte >= range.end_byte or range.start_byte >= end_byte or range.end_byte <= start_byte) continue;
            try matches.append(self.allocator, annotation);
            split_count += @intFromBool(range.start_byte < start_byte and range.end_byte > end_byte);
        }

        var split_inputs = try self.allocator.alloc(RangeInput, split_count);
        defer self.allocator.free(split_inputs);
        var split_payloads = try self.allocator.alloc(PayloadInput, split_count);
        defer self.allocator.free(split_payloads);
        var split_sequences = try self.allocator.alloc(u64, split_count);
        defer self.allocator.free(split_sequences);
        var split_index: usize = 0;
        for (matches.items) |annotation| {
            const range = annotation.mark.range;
            if (range.start_byte < start_byte and range.end_byte > end_byte) {
                split_inputs[split_index] = .{
                    .start_byte = end_byte,
                    .end_byte = range.end_byte,
                    .start_gravity = range.start_gravity,
                    .end_gravity = range.end_gravity,
                };
                split_payloads[split_index] = inputFromPayload(annotation.payload);
                split_sequences[split_index] = annotation.payload.sequence;
                split_index += 1;
            }
        }
        if (split_count != 0) {
            var prepared = try self.prepareAddRangesWithSequences(split_inputs, split_payloads, split_sequences);
            defer prepared.deinit();
            try self.commitPreparedRanges(&prepared);
        }

        for (matches.items) |annotation| {
            const range = annotation.mark.range;
            if (range.start_byte < start_byte and range.end_byte > end_byte) {
                _ = try self.updateRange(annotation.id(), .{
                    .start_byte = range.start_byte,
                    .end_byte = start_byte,
                    .start_gravity = range.start_gravity,
                    .end_gravity = range.end_gravity,
                });
            } else if (range.start_byte < start_byte) {
                _ = try self.updateRange(annotation.id(), .{
                    .start_byte = range.start_byte,
                    .end_byte = start_byte,
                    .start_gravity = range.start_gravity,
                    .end_gravity = range.end_gravity,
                });
            } else if (range.end_byte > end_byte) {
                _ = try self.updateRange(annotation.id(), .{
                    .start_byte = end_byte,
                    .end_byte = range.end_byte,
                    .start_gravity = range.start_gravity,
                    .end_gravity = range.end_gravity,
                });
            } else {
                _ = try self.remove(annotation.id());
            }
        }
    }

    pub fn splice(self: *Self, start_byte: u32, old_len: u32, new_len: u32) !void {
        var prepared = try self.prepareSplice(start_byte, old_len, new_len);
        defer prepared.deinit();
        try self.commitPreparedSplice(&prepared);
    }

    pub fn prepareSplice(self: *Self, start_byte: u32, old_len: u32, new_len: u32) !PreparedSplice {
        try self.checkCanMutate(0);
        if (self.non_retaining_policy_count == 0) {
            const tree_splice = try self.tree.prepareSplice(start_byte, old_len, new_len);
            return .{
                .owner = self,
                .start_byte = start_byte,
                .old_len = old_len,
                .new_len = new_len,
                .tree_splice = tree_splice,
                .affected_storage = &.{},
                .covered_storage = &.{},
                .delete_storage = &.{},
                .delete_ids = &.{},
                .source_generation = self.generation,
            };
        }
        const scratch_len = if (old_len == 0) 0 else self.count();
        const affected = try self.allocator.alloc(u64, scratch_len);
        errdefer self.allocator.free(affected);
        const covered = try self.allocator.alloc(u64, scratch_len);
        errdefer self.allocator.free(covered);
        const delete_ids = try self.allocator.alloc(u64, scratch_len);
        errdefer self.allocator.free(delete_ids);

        const generation_budget = if (old_len == 0 and new_len == 0)
            0
        else
            std.math.add(usize, self.count(), 1) catch return error.GenerationExhausted;
        try self.checkTreeGenerations(generation_budget);
        const tree_splice = try self.tree.prepareSpliceWithReport(start_byte, old_len, new_len, affected, covered);

        sortIds(tree_splice.affected_ids);
        sortIds(tree_splice.covered_range_ids);
        var covered_index: usize = 0;
        var delete_count: usize = 0;
        for (tree_splice.affected_ids) |id| {
            while (covered_index < tree_splice.covered_range_ids.len and tree_splice.covered_range_ids[covered_index] < id) {
                covered_index += 1;
            }
            const is_covered = covered_index < tree_splice.covered_range_ids.len and tree_splice.covered_range_ids[covered_index] == id;
            if (is_covered) covered_index += 1;
            const payload = self.payloads.get(id).?;
            const should_delete = payload.splice_policy == .invalidate or
                (payload.splice_policy == .delete_when_covered and is_covered);
            if (should_delete) {
                delete_ids[delete_count] = id;
                delete_count += 1;
            }
        }
        return .{
            .owner = self,
            .start_byte = start_byte,
            .old_len = old_len,
            .new_len = new_len,
            .tree_splice = tree_splice,
            .affected_storage = affected,
            .covered_storage = covered,
            .delete_storage = delete_ids,
            .delete_ids = delete_ids[0..delete_count],
            .source_generation = self.generation,
        };
    }

    pub fn commitPreparedSplice(self: *Self, prepared: *PreparedSplice) !void {
        std.debug.assert(prepared.owner == self and !prepared.committed);
        if (prepared.source_generation != self.generation) return error.StalePreparation;
        const before = self.tree.generation;
        try self.tree.commitPreparedSplice(prepared.start_byte, prepared.old_len, prepared.new_len, prepared.tree_splice);
        for (prepared.delete_ids) |id| {
            const payload = self.payloads.get(id).?;
            const removed = self.tree.remove(id) catch unreachable;
            std.debug.assert(removed);
            self.non_retaining_policy_count -= @intFromBool(payload.splice_policy != .retain);
            _ = self.payloads.remove(id);
        }
        if (self.tree.generation != before) self.finishMutation();
        prepared.committed = true;
    }

    pub fn moveRegion(self: *Self, start_byte: u32, len: u32, destination_byte: u32) !void {
        try self.checkCanMutate(1);
        const before = self.tree.generation;
        try self.tree.moveRegion(start_byte, len, destination_byte);
        if (self.tree.generation != before) self.finishMutation();
    }

    /// Applies one move to a detached annotation snapshot. Document ranges that
    /// enclose the complete affected window retain their explicit parent extent.
    pub fn transformMoveSnapshot(
        annotations: []Annotation,
        target_id: u64,
        start_byte: u32,
        len: u32,
        destination_byte: u32,
        affected_start: u32,
        affected_end: u32,
        preserve_kind_flags: u32,
    ) !void {
        const end_byte = std.math.add(u32, start_byte, len) catch return error.PositionOverflow;
        for (annotations) |*annotation| {
            if (annotation.id() != target_id and annotation.payload.kind_flags & preserve_kind_flags != 0 and annotation.mark == .range) {
                const range = annotation.mark.range;
                if (range.start_byte <= affected_start and range.end_byte >= affected_end) continue;
            }
            annotation.mark = try MarkTree.movedMark(annotation.mark, start_byte, end_byte, len, destination_byte);
        }
    }

    /// Publishes positions from a complete detached snapshot in one MarkTree
    /// rebuild. Payloads and membership remain unchanged.
    pub fn replaceSnapshotMarks(self: *Self, annotations: []const Annotation) !void {
        try self.checkCanMutate(1);
        if (annotations.len != self.count()) return error.CountMismatch;
        const marks = try self.allocator.alloc(Mark, annotations.len);
        defer self.allocator.free(marks);
        for (annotations, marks) |annotation, *mark| mark.* = annotation.mark;
        try self.tree.replaceMarks(marks);
        self.finishMutation();
    }

    /// Visits highest priority first; newer equal-priority annotations win.
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

    /// Visits highest priority first; newer equal-priority annotations win.
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

    /// Visits highest priority first; newer equal-priority annotations win.
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

    pub const UnorderedVisitMode = enum { overlapping, starting, points };

    /// Visits directly in tree order for callers that sort complete output themselves.
    pub fn visitUnordered(self: *Self, mode: UnorderedVisitMode, first_byte: u32, second_byte: u32, context: anytype, visitor: anytype) !void {
        const Adapter = struct {
            owner: *Self,
            target: @TypeOf(context),

            fn range(adapter: *@This(), value: MarkTree.Range) !void {
                const annotation: Annotation = .{
                    .mark = .{ .range = value },
                    .payload = adapter.owner.payloads.get(value.id).?,
                };
                try visitor(adapter.target, annotation);
            }

            fn point(adapter: *@This(), value: MarkTree.Point) !void {
                const annotation: Annotation = .{
                    .mark = .{ .point = value },
                    .payload = adapter.owner.payloads.get(value.id).?,
                };
                try visitor(adapter.target, annotation);
            }
        };
        var adapter: Adapter = .{ .owner = self, .target = context };
        self.active_visits += 1;
        defer self.active_visits -= 1;
        switch (mode) {
            .overlapping => try self.tree.visitOverlapping(first_byte, second_byte, &adapter, Adapter.range),
            .starting => try self.tree.visitStartingAt(first_byte, &adapter, Adapter.range),
            .points => try self.tree.visitPointsAt(first_byte, &adapter, Adapter.point),
        }
    }

    /// Finds the highest-precedence overlapping range with any requested kind
    /// without allocating query storage.
    pub fn findOverlappingKind(self: *Self, first_byte: u32, second_byte: u32, kind_mask: u32) ?Annotation {
        const Finder = struct {
            owner: *Self,
            kind_mask: u32,
            best: ?Annotation = null,

            fn visit(finder: *@This(), range: MarkTree.Range) !void {
                const annotation: Annotation = .{
                    .mark = .{ .range = range },
                    .payload = finder.owner.payloads.get(range.id).?,
                };
                if (annotation.payload.kind_flags & finder.kind_mask == 0) return;
                const best = finder.best orelse {
                    finder.best = annotation;
                    return;
                };
                if (annotation.payload.priority > best.payload.priority or
                    (annotation.payload.priority == best.payload.priority and annotation.payload.sequence > best.payload.sequence) or
                    (annotation.payload.priority == best.payload.priority and annotation.payload.sequence == best.payload.sequence and annotation.id() > best.id()))
                {
                    finder.best = annotation;
                }
            }
        };
        var finder: Finder = .{ .owner = self, .kind_mask = kind_mask };
        self.tree.visitOverlapping(first_byte, second_byte, &finder, Finder.visit) catch unreachable;
        return finder.best;
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

    fn inputFromPayload(payload: Payload) PayloadInput {
        return .{
            .namespace = payload.namespace,
            .style_id = payload.style_id,
            .priority = payload.priority,
            .internal = payload.internal,
            .kind_flags = payload.kind_flags,
            .splice_policy = payload.splice_policy,
        };
    }

    fn sortByPrecedence(annotations: []Annotation) void {
        std.mem.sort(Annotation, annotations, {}, struct {
            fn lessThan(_: void, a: Annotation, b: Annotation) bool {
                if (a.payload.priority != b.payload.priority) return a.payload.priority > b.payload.priority;
                if (a.payload.sequence != b.payload.sequence) return a.payload.sequence > b.payload.sequence;
                return a.id() > b.id();
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
