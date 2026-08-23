const std = @import("std");

const Allocator = std.mem.Allocator;
var next_seed = std.atomic.Value(u64).init(0x6d61726b74726565);

/// An edit-following mark index over UTF-8 byte positions.
///
/// Paired ranges retain semantic start/end identity even when edits make the
/// start follow the end. Payloads intentionally live outside this type and can
/// be keyed by a stable mark ID.
pub const MarkTree = struct {
    const Self = @This();

    pub const Gravity = enum {
        left,
        right,
    };

    pub const RangeInput = struct {
        start_byte: u32,
        end_byte: u32,
        start_gravity: Gravity = .right,
        end_gravity: Gravity = .left,
    };

    pub const PointInput = struct {
        byte: u32,
        gravity: Gravity = .right,
    };

    pub const Range = struct {
        id: u64,
        start_byte: u32,
        end_byte: u32,
        start_gravity: Gravity,
        end_gravity: Gravity,
    };

    pub const Point = struct {
        id: u64,
        byte: u32,
        gravity: Gravity,
    };

    pub const Mark = union(enum) {
        range: Range,
        point: Point,

        pub fn id(self: Mark) u64 {
            return switch (self) {
                .range => |range| range.id,
                .point => |point| point.id,
            };
        }
    };

    pub const SpliceReport = struct {
        affected_ids: []u64,
        covered_range_ids: []u64,
    };

    pub const PreparedSplice = struct {
        source_generation: u64,
        old_end: u32,
        new_end: u32,
        affected_ids: []u64,
        covered_range_ids: []u64,
    };

    pub const SpliceReportCounts = struct {
        affected: usize,
        covered: usize,
    };

    pub const PreparedSpliceReport = struct {
        source_generation: u64,
        old_end: u32,
        new_end: u32,
        counts: SpliceReportCounts,
    };

    pub const PreparedHistoryRestore = struct {
        owner: *Self,
        splice: PreparedSplice,
        node_storage: []*Node,
        nodes: []*Node,
        next_priority_state: u64,
        source_generation: u64,
        committed: bool = false,

        pub fn deinit(self: *PreparedHistoryRestore) void {
            if (!self.committed) for (self.nodes) |node| self.owner.allocator.destroy(node);
            self.owner.allocator.free(self.node_storage);
            self.* = undefined;
        }
    };

    pub const PreparedRanges = struct {
        owner: *Self,
        nodes: []*Node,
        next_priority_state: u64,
        source_generation: u64,
        committed: bool = false,

        pub fn idAt(self: *const PreparedRanges, index: usize) u64 {
            return self.nodes[index].mark.id();
        }

        pub fn deinit(self: *PreparedRanges) void {
            if (!self.committed) {
                for (self.nodes) |node| self.owner.allocator.destroy(node);
            }
            self.owner.allocator.free(self.nodes);
            self.* = undefined;
        }
    };

    pub const IntegrityError = error{
        BadRootParent,
        BadParent,
        BadOrder,
        BadPriority,
        BadMaximum,
        BadCount,
        BadIdIndex,
    };

    const Node = struct {
        mark: Mark,
        priority: u64,
        max_byte: u32,
        max_overlap_end_byte: u32,
        lazy_shift: i64 = 0,
        parent: ?*Node = null,
        left: ?*Node = null,
        right: ?*Node = null,
    };

    allocator: Allocator,
    root: ?*Node = null,
    ids: std.AutoHashMap(u64, *Node),
    next_id: u64 = 1,
    priority_state: u64,
    id_nonce: u32,
    len: usize = 0,
    generation: u64 = 0,
    active_visits: usize = 0,

    /// Uses a process-unique seed so independent trees do not share priorities.
    pub fn init(allocator: Allocator) Self {
        const seed = next_seed.fetchAdd(0x9e3779b97f4a7c15, .monotonic);
        return initWithSeedAndNonce(allocator, seed, @truncate(seed ^ (seed >> 32)));
    }

    /// Deterministic construction for tests and reproducible benchmarks.
    pub fn initWithSeed(allocator: Allocator, seed: u64) Self {
        return initWithSeedAndNonce(allocator, seed, 0);
    }

    pub fn initWithSeedAndNonce(allocator: Allocator, seed: u64, nonce: u32) Self {
        return .{
            .allocator = allocator,
            .ids = std.AutoHashMap(u64, *Node).init(allocator),
            .priority_state = seed,
            .id_nonce = nonce,
        };
    }

    /// Creates an independent tree with identical IDs, positions, and mutation
    /// counters. This is used to prepare compound Rope/annotation transactions
    /// without exposing a partially-mutated mark index.
    pub fn clone(self: *Self, allocator: Allocator) !Self {
        var result = initWithSeedAndNonce(allocator, self.priority_state, self.id_nonce);
        errdefer result.deinit();
        result.id_nonce = self.id_nonce;
        try result.ids.ensureTotalCapacity(@intCast(self.len));

        var it = self.iterator();
        while (try it.next()) |mark| try result.addMarkWithId(mark);
        result.next_id = self.next_id;
        result.priority_state = self.priority_state;
        result.generation = self.generation;
        return result;
    }

    /// Releases all storage, panicking if called from an active visitor.
    pub fn deinit(self: *Self) void {
        self.tryDeinit() catch @panic("MarkTree.deinit called during an active visit");
    }

    /// Releases all storage, or reports a visitor that still retains tree nodes.
    pub fn tryDeinit(self: *Self) !void {
        if (self.active_visits != 0) return error.DeinitDuringVisit;
        self.destroyAllNodes();
        self.ids.deinit();
        self.* = undefined;
    }

    pub fn count(self: *const Self) usize {
        return self.len;
    }

    pub fn addRange(self: *Self, input: RangeInput) !u64 {
        try self.checkCanMutate();
        const id = try self.reserveId();
        try self.addMark(.{ .range = rangeFromInput(id, input) });
        self.finishMutation();
        return id;
    }

    pub fn prepareAddRanges(self: *Self, inputs: []const RangeInput) !PreparedRanges {
        try self.checkCanMutate();
        if (inputs.len > std.math.maxInt(u64) - self.generation) return error.GenerationExhausted;
        const count_u64 = std.math.cast(u64, inputs.len) orelse return error.IdExhausted;
        if (self.next_id == 0 or count_u64 > std.math.maxInt(u32) + 1 - self.next_id) return error.IdExhausted;
        const additional_count = std.math.cast(u32, inputs.len) orelse return error.IdExhausted;
        try self.ids.ensureUnusedCapacity(additional_count);

        const nodes = try self.allocator.alloc(*Node, inputs.len);
        errdefer self.allocator.free(nodes);
        var initialized: usize = 0;
        errdefer for (nodes[0..initialized]) |node| self.allocator.destroy(node);

        var priority_state = self.priority_state;
        for (inputs, 0..) |input, index| {
            const node = try self.allocator.create(Node);
            const id = self.makeId(self.next_id + @as(u64, @intCast(index)));
            node.* = .{
                .mark = .{ .range = rangeFromInput(id, input) },
                .priority = nextPriorityValue(&priority_state),
                .max_byte = @max(input.start_byte, input.end_byte),
                .max_overlap_end_byte = if (input.start_byte < input.end_byte) input.end_byte else 0,
            };
            nodes[index] = node;
            initialized += 1;
        }
        return .{ .owner = self, .nodes = nodes, .next_priority_state = priority_state, .source_generation = self.generation };
    }

    pub fn commitPreparedRanges(self: *Self, prepared: *PreparedRanges) !void {
        std.debug.assert(prepared.owner == self and !prepared.committed);
        if (prepared.source_generation != self.generation) return error.StalePreparation;
        for (prepared.nodes) |node| {
            self.ids.putAssumeCapacity(node.mark.id(), node);
            self.root = insert(self.root, node);
            if (self.root) |root| root.parent = null;
        }
        self.next_id += @intCast(prepared.nodes.len);
        self.len += prepared.nodes.len;
        self.priority_state = prepared.next_priority_state;
        self.generation += @intCast(prepared.nodes.len);
        prepared.committed = true;
    }

    pub fn addPoint(self: *Self, input: PointInput) !u64 {
        try self.checkCanMutate();
        const id = try self.reserveId();
        try self.addMark(.{ .point = .{ .id = id, .byte = input.byte, .gravity = input.gravity } });
        self.finishMutation();
        return id;
    }

    pub fn get(self: *Self, id: u64) ?Mark {
        const node = self.ids.get(id) orelse return null;
        materialize(node);
        return node.mark;
    }

    pub fn getRange(self: *Self, id: u64) ?Range {
        const mark = self.get(id) orelse return null;
        return switch (mark) {
            .range => |range| range,
            .point => null,
        };
    }

    pub fn getPoint(self: *Self, id: u64) ?Point {
        const mark = self.get(id) orelse return null;
        return switch (mark) {
            .range => null,
            .point => |point| point,
        };
    }

    pub fn remove(self: *Self, id: u64) !bool {
        try self.checkCanMutate();
        const node = self.ids.get(id) orelse return false;
        materialize(node);
        self.root = erase(self.root, lowerByte(node.mark), id);
        if (self.root) |root| root.parent = null;
        _ = self.ids.remove(id);
        self.allocator.destroy(node);
        self.len -= 1;
        self.finishMutation();
        return true;
    }

    pub fn updateRange(self: *Self, id: u64, input: RangeInput) !bool {
        const node = self.ids.get(id) orelse return false;
        if (node.mark != .range) return false;
        try self.checkCanMutate();
        materialize(node);
        const mark: Mark = .{ .range = rangeFromInput(id, input) };
        if (std.meta.eql(node.mark, mark)) return true;
        try self.reindexNode(node, mark);
        self.finishMutation();
        return true;
    }

    pub fn updatePoint(self: *Self, id: u64, input: PointInput) !bool {
        const node = self.ids.get(id) orelse return false;
        if (node.mark != .point) return false;
        try self.checkCanMutate();
        materialize(node);
        const mark: Mark = .{ .point = .{ .id = id, .byte = input.byte, .gravity = input.gravity } };
        if (std.meta.eql(node.mark, mark)) return true;
        try self.reindexNode(node, mark);
        self.finishMutation();
        return true;
    }

    /// Applies one atomic replacement of `[start_byte, start_byte + old_len)`.
    /// Endpoint movement follows Neovim marktree gravity at both boundaries:
    /// every endpoint in the closed interval `[start, old_end]` chooses the
    /// replacement's left or right edge using its own gravity.
    pub fn splice(self: *Self, start_byte: u32, old_len: u32, new_len: u32) !void {
        try self.checkCanMutate();
        const ends = try self.preflightSplice(start_byte, old_len, new_len);
        if (old_len == 0 and new_len == 0) return;
        self.spliceUnchecked(start_byte, ends.old_end, ends.new_end);
        self.finishMutation();
    }

    /// Preflights a splice without collecting lifecycle reports. Callers whose
    /// payload policy retains every mark can avoid count-sized report buffers.
    pub fn prepareSplice(self: *Self, start_byte: u32, old_len: u32, new_len: u32) !PreparedSplice {
        try self.checkCanMutate();
        const ends = try self.preflightSplice(start_byte, old_len, new_len);
        return .{
            .source_generation = self.generation,
            .old_end = ends.old_end,
            .new_end = ends.new_end,
            .affected_ids = &.{},
            .covered_range_ids = &.{},
        };
    }

    /// Applies a splice and reports deletion lifecycle candidates without
    /// allocating or applying owner policy. `affected_ids` includes ranges
    /// intersecting deleted text and marks with endpoints on either boundary.
    /// `covered_range_ids` is the subset whose two endpoints are wholly within
    /// the closed deletion extent. Insufficient buffers reject the operation
    /// before either output or tree is modified. Overlapping used portions of
    /// the output buffers are rejected for the same reason.
    pub fn spliceWithReport(
        self: *Self,
        start_byte: u32,
        old_len: u32,
        new_len: u32,
        affected_buffer: []u64,
        covered_buffer: []u64,
    ) !SpliceReport {
        const prepared = try self.prepareSpliceWithReport(start_byte, old_len, new_len, affected_buffer, covered_buffer);
        try self.commitPreparedSplice(start_byte, old_len, new_len, prepared);
        return .{
            .affected_ids = prepared.affected_ids,
            .covered_range_ids = prepared.covered_range_ids,
        };
    }

    /// Performs every fallible splice check and fills lifecycle reports without
    /// changing the tree. The returned slices borrow the caller's buffers until
    /// commit.
    pub fn prepareSpliceWithReport(
        self: *Self,
        start_byte: u32,
        old_len: u32,
        new_len: u32,
        affected_buffer: []u64,
        covered_buffer: []u64,
    ) !PreparedSplice {
        const report = try self.prepareSpliceReport(start_byte, old_len, new_len);
        return self.fillPreparedSpliceReport(start_byte, old_len, report, affected_buffer, covered_buffer);
    }

    pub fn prepareSpliceReport(self: *Self, start_byte: u32, old_len: u32, new_len: u32) !PreparedSpliceReport {
        try self.checkCanMutate();
        const ends = try self.preflightSplice(start_byte, old_len, new_len);
        const counts = countDeletion(self.root, start_byte, ends.old_end, old_len, 0);
        return .{
            .source_generation = self.generation,
            .old_end = ends.old_end,
            .new_end = ends.new_end,
            .counts = .{ .affected = counts.affected, .covered = counts.covered },
        };
    }

    pub fn fillPreparedSpliceReport(
        self: *Self,
        start_byte: u32,
        old_len: u32,
        report: PreparedSpliceReport,
        affected_buffer: []u64,
        covered_buffer: []u64,
    ) !PreparedSplice {
        try self.checkCanMutate();
        if (report.source_generation != self.generation) return error.StalePreparation;
        const counts = report.counts;
        if (affected_buffer.len < counts.affected or covered_buffer.len < counts.covered) {
            return error.ReportBufferTooSmall;
        }
        const affected_output = affected_buffer[0..counts.affected];
        const covered_output = covered_buffer[0..counts.covered];
        if (slicesOverlap(affected_output, covered_output)) return error.ReportBuffersOverlap;

        var affected_len: usize = 0;
        var covered_len: usize = 0;
        if (old_len != 0) {
            fillDeletion(
                self.root,
                start_byte,
                report.old_end,
                old_len,
                affected_buffer,
                covered_buffer,
                &affected_len,
                &covered_len,
            );
        }
        return .{
            .source_generation = self.generation,
            .old_end = report.old_end,
            .new_end = report.new_end,
            .affected_ids = affected_buffer[0..affected_len],
            .covered_range_ids = covered_buffer[0..covered_len],
        };
    }

    pub fn spliceReportCounts(self: *Self, start_byte: u32, old_len: u32, new_len: u32) !SpliceReportCounts {
        return (try self.prepareSpliceReport(start_byte, old_len, new_len)).counts;
    }

    pub fn splicedMark(mark: Mark, start_byte: u32, old_len: u32, new_len: u32) !Mark {
        const old_end = std.math.add(u32, start_byte, old_len) catch return error.PositionOverflow;
        const new_end = std.math.add(u32, start_byte, new_len) catch return error.PositionOverflow;
        return switch (mark) {
            .range => |value| .{ .range = .{
                .id = value.id,
                .start_byte = try transformPositionChecked(value.start_byte, value.start_gravity, start_byte, old_end, new_end),
                .end_byte = try transformPositionChecked(value.end_byte, value.end_gravity, start_byte, old_end, new_end),
                .start_gravity = value.start_gravity,
                .end_gravity = value.end_gravity,
            } },
            .point => |value| .{ .point = .{
                .id = value.id,
                .byte = try transformPositionChecked(value.byte, value.gravity, start_byte, old_end, new_end),
                .gravity = value.gravity,
            } },
        };
    }

    /// Prepares an ordinary positional splice followed by exact restoration of
    /// a sparse set of marks. Missing marks and kind changes receive detached
    /// nodes now so publication cannot allocate.
    pub fn prepareHistoryRestore(
        self: *Self,
        start_byte: u32,
        old_len: u32,
        new_len: u32,
        targets: anytype,
        comptime markFor: anytype,
    ) !PreparedHistoryRestore {
        try self.checkCanMutate();
        const prepared_splice = try self.prepareSplice(start_byte, old_len, new_len);
        try self.ids.ensureUnusedCapacity(@intCast(targets.len));
        const nodes = try self.allocator.alloc(*Node, targets.len);
        errdefer self.allocator.free(nodes);
        var initialized: usize = 0;
        errdefer for (nodes[0..initialized]) |node| self.allocator.destroy(node);
        var priority_state = self.priority_state;
        for (targets) |target| {
            const mark: Mark = markFor(target);
            const existing = self.get(mark.id());
            if (existing != null and std.meta.activeTag(existing.?) == std.meta.activeTag(mark)) continue;
            const node = try self.allocator.create(Node);
            node.* = .{
                .mark = mark,
                .priority = nextPriorityValue(&priority_state),
                .max_byte = upperByte(mark),
                .max_overlap_end_byte = overlapEndByte(mark),
            };
            nodes[initialized] = node;
            initialized += 1;
        }
        return .{
            .owner = self,
            .splice = prepared_splice,
            .node_storage = nodes,
            .nodes = nodes[0..initialized],
            .next_priority_state = priority_state,
            .source_generation = self.generation,
        };
    }

    pub fn commitHistoryRestore(
        self: *Self,
        start_byte: u32,
        old_len: u32,
        new_len: u32,
        targets: anytype,
        comptime markFor: anytype,
        remove_ids: []const u64,
        prepared: *PreparedHistoryRestore,
    ) void {
        std.debug.assert(prepared.owner == self and !prepared.committed and prepared.source_generation == self.generation);
        self.commitPreparedSplice(start_byte, old_len, new_len, prepared.splice) catch unreachable;
        for (remove_ids) |id| _ = self.remove(id) catch unreachable;
        var node_index: usize = 0;
        for (targets) |target| {
            const mark: Mark = markFor(target);
            if (self.get(mark.id())) |existing| {
                std.debug.assert(std.meta.activeTag(existing) == std.meta.activeTag(mark));
                switch (mark) {
                    .range => |value| _ = self.updateRange(value.id, .{
                        .start_byte = value.start_byte,
                        .end_byte = value.end_byte,
                        .start_gravity = value.start_gravity,
                        .end_gravity = value.end_gravity,
                    }) catch unreachable,
                    .point => |value| _ = self.updatePoint(value.id, .{ .byte = value.byte, .gravity = value.gravity }) catch unreachable,
                }
            } else {
                const node = prepared.nodes[node_index];
                node_index += 1;
                std.debug.assert(node.mark.id() == mark.id());
                self.ids.putAssumeCapacity(mark.id(), node);
                self.root = insert(self.root, node);
                if (self.root) |root| root.parent = null;
                self.len += 1;
                self.generation += 1;
            }
        }
        std.debug.assert(node_index == prepared.nodes.len);
        self.priority_state = prepared.next_priority_state;
        prepared.committed = true;
    }

    /// Publishes a splice previously prepared against the current tree. No
    /// allocation or error is possible between the position update and the
    /// generation change.
    pub fn commitPreparedSplice(self: *Self, start_byte: u32, old_len: u32, new_len: u32, prepared: PreparedSplice) !void {
        if (prepared.source_generation != self.generation) return error.StalePreparation;
        if (old_len == 0 and new_len == 0) return;
        self.spliceUnchecked(start_byte, prepared.old_end, prepared.new_end);
        self.finishMutation();
    }

    /// Moves `[start_byte, start_byte + len)` to `destination_byte`, where the
    /// destination is measured after removing the source. Endpoints inside the
    /// moved text retain their relative offsets, IDs, kinds, and gravities.
    pub fn moveRegion(self: *Self, start_byte: u32, len: u32, destination_byte: u32) !void {
        try self.checkCanMutate();
        const end_byte = std.math.add(u32, start_byte, len) catch return error.PositionOverflow;
        _ = std.math.add(u32, destination_byte, len) catch return error.PositionOverflow;
        if (len == 0 or destination_byte == start_byte) return;

        // Preflight every transformed endpoint and reserve rebuild storage before
        // changing any mark. The sorted Cartesian rebuild below is infallible.
        var id_iterator = self.ids.iterator();
        while (id_iterator.next()) |entry| {
            const node = entry.value_ptr.*;
            materialize(node);
            _ = try movedMark(node.mark, start_byte, end_byte, len, destination_byte);
        }
        const nodes = try self.allocator.alloc(*Node, self.len);
        defer self.allocator.free(nodes);

        id_iterator = self.ids.iterator();
        var node_index: usize = 0;
        while (id_iterator.next()) |entry| : (node_index += 1) {
            const node = entry.value_ptr.*;
            node.mark = movedMark(node.mark, start_byte, end_byte, len, destination_byte) catch unreachable;
            resetDetached(node);
            nodes[node_index] = node;
        }
        std.debug.assert(node_index == nodes.len);
        std.mem.sort(*Node, nodes, {}, movedNodeLessThan);
        self.root = rebuildSortedNodes(nodes);
        self.finishMutation();
    }

    /// Replaces every mark value while retaining IDs, priorities, and nodes.
    /// Storage and membership are prepared before the infallible sorted rebuild.
    pub fn replaceMarks(self: *Self, marks: []const Mark) !void {
        try self.checkCanMutate();
        if (marks.len != self.len) return error.CountMismatch;
        const nodes = try self.allocator.alloc(*Node, marks.len);
        defer self.allocator.free(nodes);
        for (marks, 0..) |mark, index| {
            nodes[index] = self.ids.get(mark.id()) orelse return error.InvalidId;
        }
        for (marks, nodes) |mark, node| {
            node.mark = mark;
            resetDetached(node);
        }
        std.mem.sort(*Node, nodes, {}, movedNodeLessThan);
        self.root = rebuildSortedNodes(nodes);
        self.finishMutation();
    }

    /// Visits forward, non-empty paired ranges overlapping the half-open query.
    /// Reversed/crossed ranges are visually empty and never overlap.
    pub fn visitOverlapping(self: *Self, first_byte: u32, second_byte: u32, context: anytype, visitor: anytype) !void {
        const start_byte = @min(first_byte, second_byte);
        const end_byte = @max(first_byte, second_byte);
        if (start_byte == end_byte) return;
        self.active_visits += 1;
        defer self.active_visits -= 1;
        try visitOverlapNode(self.root, start_byte, end_byte, context, visitor);
    }

    /// Visits paired ranges whose semantic start endpoint equals `byte`.
    pub fn visitStartingAt(self: *Self, byte: u32, context: anytype, visitor: anytype) !void {
        self.active_visits += 1;
        defer self.active_visits -= 1;
        try visitStartingNode(self.root, byte, context, visitor);
    }

    /// Visits unpaired point marks exactly at `byte`.
    pub fn visitPointsAt(self: *Self, byte: u32, context: anytype, visitor: anytype) !void {
        self.active_visits += 1;
        defer self.active_visits -= 1;
        try visitPointsNode(self.root, byte, context, visitor);
    }

    /// Iterates by derived lower byte then stable ID. A mutation invalidates the
    /// iterator, and `next` reports that before dereferencing retained nodes.
    pub fn iterator(self: *Self) Iterator {
        return .{ .tree = self, .generation = self.generation, .next_node = leftmost(self.root) };
    }

    pub const Iterator = struct {
        tree: *Self,
        generation: u64,
        next_node: ?*Node,

        pub fn next(self: *Iterator) !?Mark {
            if (self.generation != self.tree.generation) return error.IteratorInvalidated;
            const node = self.next_node orelse return null;
            materialize(node);
            const result = node.mark;

            if (node.right) |right| {
                self.next_node = leftmost(right);
            } else {
                var child = node;
                var ancestor = node.parent;
                while (ancestor) |parent| {
                    if (parent.left == child) break;
                    child = parent;
                    ancestor = parent.parent;
                }
                self.next_node = ancestor;
            }
            return result;
        }
    };

    /// Materializes lazy shifts and validates ordering, aggregate, parent, and
    /// ID-map invariants. Intended for tests and diagnostics.
    pub fn validateIntegrity(self: *Self) IntegrityError!void {
        if (self.root) |root| {
            if (root.parent != null) return error.BadRootParent;
        }
        var seen: usize = 0;
        _ = try self.validateNode(self.root, null, null, null, &seen);
        if (seen != self.len or self.ids.count() != self.len) return error.BadCount;

        var id_iterator = self.ids.iterator();
        while (id_iterator.next()) |entry| {
            if (entry.value_ptr.*.mark.id() != entry.key_ptr.*) return error.BadIdIndex;
        }
    }

    fn checkCanMutate(self: *const Self) !void {
        if (self.active_visits != 0) return error.MutationDuringVisit;
        if (self.generation == std.math.maxInt(u64)) return error.GenerationExhausted;
    }

    fn finishMutation(self: *Self) void {
        self.generation += 1;
    }

    fn reserveId(self: *const Self) !u64 {
        if (self.next_id == 0 or self.next_id > std.math.maxInt(u32)) return error.IdExhausted;
        return self.makeId(self.next_id);
    }

    fn makeId(self: *const Self, local_id: u64) u64 {
        return (@as(u64, self.id_nonce) << 32) | local_id;
    }

    fn addMarkWithId(self: *Self, mark: Mark) !void {
        const node = try self.allocator.create(Node);
        errdefer self.allocator.destroy(node);
        node.* = .{
            .mark = mark,
            .priority = self.nextPriority(),
            .max_byte = upperByte(mark),
            .max_overlap_end_byte = overlapEndByte(mark),
        };
        self.ids.putAssumeCapacity(mark.id(), node);
        self.root = insert(self.root, node);
        if (self.root) |root| root.parent = null;
        self.len += 1;
    }

    fn addMark(self: *Self, mark: Mark) !void {
        const priority_state = self.priority_state;
        errdefer self.priority_state = priority_state;
        const node = try self.allocator.create(Node);
        errdefer self.allocator.destroy(node);
        node.* = .{
            .mark = mark,
            .priority = self.nextPriority(),
            .max_byte = upperByte(mark),
            .max_overlap_end_byte = overlapEndByte(mark),
        };
        try self.ids.put(mark.id(), node);
        self.root = insert(self.root, node);
        if (self.root) |root| root.parent = null;
        self.next_id += 1;
        self.len += 1;
    }

    fn reindexNode(self: *Self, node: *Node, mark: Mark) !void {
        materialize(node);
        self.root = erase(self.root, lowerByte(node.mark), node.mark.id());
        node.mark = mark;
        resetDetached(node);
        self.root = insert(self.root, node);
        if (self.root) |root| root.parent = null;
    }

    fn nextPriority(self: *Self) u64 {
        return nextPriorityValue(&self.priority_state);
    }

    fn nextPriorityValue(state: *u64) u64 {
        state.* +%= 0x9e3779b97f4a7c15;
        var value = state.*;
        value = (value ^ (value >> 30)) *% 0xbf58476d1ce4e5b9;
        value = (value ^ (value >> 27)) *% 0x94d049bb133111eb;
        return value ^ (value >> 31);
    }

    fn preflightSplice(self: *Self, start_byte: u32, old_len: u32, new_len: u32) !struct { old_end: u32, new_end: u32 } {
        const old_end = std.math.add(u32, start_byte, old_len) catch return error.PositionOverflow;
        const new_end = std.math.add(u32, start_byte, new_len) catch return error.PositionOverflow;
        if (new_len > old_len) {
            const growth = new_len - old_len;
            if (self.root) |root| {
                if (root.max_byte > old_end and root.max_byte > std.math.maxInt(u32) - growth) {
                    return error.PositionOverflow;
                }
            }
        }
        return .{ .old_end = old_end, .new_end = new_end };
    }

    fn spliceUnchecked(self: *Self, start_byte: u32, old_end: u32, new_end: u32) void {
        var before: ?*Node = null;
        var affected: ?*Node = null;
        var suffix: ?*Node = null;
        var at_or_after: ?*Node = null;
        splitLower(self.root, start_byte, &before, &at_or_after);
        if (old_end == std.math.maxInt(u32)) {
            affected = at_or_after;
        } else {
            splitLower(at_or_after, old_end + 1, &affected, &suffix);
        }

        updateCrossingPrefix(&before, start_byte, old_end, new_end);
        var rebuilt: ?*Node = null;
        reindexSplice(affected, start_byte, old_end, new_end, &rebuilt);

        const delta = @as(i64, new_end) - @as(i64, old_end);
        if (suffix) |root| applyShift(root, delta);
        self.root = merge(before, merge(rebuilt, suffix));
        if (self.root) |root| root.parent = null;
    }

    fn destroyAllNodes(self: *Self) void {
        var current = self.root;
        while (current) |node| {
            if (node.left) |left| {
                current = left;
            } else if (node.right) |right| {
                current = right;
            } else {
                const parent = node.parent;
                if (parent) |value| {
                    if (value.left == node) value.left = null else value.right = null;
                }
                self.allocator.destroy(node);
                current = parent;
            }
        }
        self.root = null;
    }

    fn rangeFromInput(id: u64, input: RangeInput) Range {
        return .{
            .id = id,
            .start_byte = input.start_byte,
            .end_byte = input.end_byte,
            .start_gravity = input.start_gravity,
            .end_gravity = input.end_gravity,
        };
    }

    fn lowerByte(mark: Mark) u32 {
        return switch (mark) {
            .range => |range| @min(range.start_byte, range.end_byte),
            .point => |point| point.byte,
        };
    }

    fn upperByte(mark: Mark) u32 {
        return switch (mark) {
            .range => |range| @max(range.start_byte, range.end_byte),
            .point => |point| point.byte,
        };
    }

    fn overlapEndByte(mark: Mark) u32 {
        return switch (mark) {
            .range => |range| if (range.start_byte < range.end_byte) range.end_byte else 0,
            .point => 0,
        };
    }

    fn keyLess(byte_a: u32, id_a: u64, byte_b: u32, id_b: u64) bool {
        return byte_a < byte_b or (byte_a == byte_b and id_a < id_b);
    }

    fn priorityBefore(a: *const Node, b: *const Node) bool {
        return a.priority < b.priority or (a.priority == b.priority and a.mark.id() < b.mark.id());
    }

    fn setLeft(node: *Node, child: ?*Node) void {
        node.left = child;
        if (child) |value| value.parent = node;
    }

    fn setRight(node: *Node, child: ?*Node) void {
        node.right = child;
        if (child) |value| value.parent = node;
    }

    fn pull(node: *Node) void {
        node.max_byte = upperByte(node.mark);
        node.max_overlap_end_byte = overlapEndByte(node.mark);
        if (node.left) |left| {
            node.max_byte = @max(node.max_byte, left.max_byte);
            node.max_overlap_end_byte = @max(node.max_overlap_end_byte, left.max_overlap_end_byte);
        }
        if (node.right) |right| {
            node.max_byte = @max(node.max_byte, right.max_byte);
            node.max_overlap_end_byte = @max(node.max_overlap_end_byte, right.max_overlap_end_byte);
        }
    }

    fn shifted(position: u32, delta: i64) u32 {
        return @intCast(@as(i64, position) + delta);
    }

    fn shiftMark(mark: *Mark, delta: i64) void {
        switch (mark.*) {
            .range => |*range| {
                range.start_byte = shifted(range.start_byte, delta);
                range.end_byte = shifted(range.end_byte, delta);
            },
            .point => |*point| point.byte = shifted(point.byte, delta),
        }
    }

    fn applyShift(node: *Node, delta: i64) void {
        if (delta == 0) return;
        shiftMark(&node.mark, delta);
        node.max_byte = shifted(node.max_byte, delta);
        if (node.max_overlap_end_byte != 0) node.max_overlap_end_byte = shifted(node.max_overlap_end_byte, delta);
        node.lazy_shift += delta;
    }

    fn push(node: *Node) void {
        if (node.lazy_shift == 0) return;
        if (node.left) |left| applyShift(left, node.lazy_shift);
        if (node.right) |right| applyShift(right, node.lazy_shift);
        node.lazy_shift = 0;
    }

    fn materialize(node: *Node) void {
        if (node.parent) |parent| {
            materialize(parent);
            push(parent);
        }
    }

    fn leftmost(maybe_node: ?*Node) ?*Node {
        var node = maybe_node orelse return null;
        while (true) {
            push(node);
            node = node.left orelse return node;
        }
    }

    fn splitKey(maybe_node: ?*Node, byte: u32, id: u64, less: *?*Node, greater: *?*Node) void {
        const node = maybe_node orelse {
            less.* = null;
            greater.* = null;
            return;
        };
        node.parent = null;
        push(node);
        if (keyLess(lowerByte(node.mark), node.mark.id(), byte, id)) {
            var middle: ?*Node = null;
            splitKey(node.right, byte, id, &middle, greater);
            setRight(node, middle);
            pull(node);
            less.* = node;
        } else {
            var middle: ?*Node = null;
            splitKey(node.left, byte, id, less, &middle);
            setLeft(node, middle);
            pull(node);
            greater.* = node;
        }
        if (less.*) |root| root.parent = null;
        if (greater.*) |root| root.parent = null;
    }

    fn splitLower(maybe_node: ?*Node, byte: u32, before: *?*Node, at_or_after: *?*Node) void {
        const node = maybe_node orelse {
            before.* = null;
            at_or_after.* = null;
            return;
        };
        node.parent = null;
        push(node);
        if (lowerByte(node.mark) < byte) {
            var middle: ?*Node = null;
            splitLower(node.right, byte, &middle, at_or_after);
            setRight(node, middle);
            pull(node);
            before.* = node;
        } else {
            var middle: ?*Node = null;
            splitLower(node.left, byte, before, &middle);
            setLeft(node, middle);
            pull(node);
            at_or_after.* = node;
        }
        if (before.*) |root| root.parent = null;
        if (at_or_after.*) |root| root.parent = null;
    }

    fn merge(left_root: ?*Node, right_root: ?*Node) ?*Node {
        const left = left_root orelse {
            if (right_root) |root| root.parent = null;
            return right_root;
        };
        const right = right_root orelse {
            left.parent = null;
            return left;
        };
        left.parent = null;
        right.parent = null;
        push(left);
        push(right);
        if (priorityBefore(left, right)) {
            setRight(left, merge(left.right, right));
            pull(left);
            left.parent = null;
            return left;
        }
        setLeft(right, merge(left, right.left));
        pull(right);
        right.parent = null;
        return right;
    }

    fn insert(root: ?*Node, node: *Node) ?*Node {
        const current = root orelse return node;
        current.parent = null;
        push(current);
        if (priorityBefore(node, current)) {
            var left: ?*Node = null;
            var right: ?*Node = null;
            splitKey(current, lowerByte(node.mark), node.mark.id(), &left, &right);
            setLeft(node, left);
            setRight(node, right);
            pull(node);
            node.parent = null;
            return node;
        }
        if (keyLess(lowerByte(node.mark), node.mark.id(), lowerByte(current.mark), current.mark.id())) {
            setLeft(current, insert(current.left, node));
        } else {
            setRight(current, insert(current.right, node));
        }
        pull(current);
        current.parent = null;
        return current;
    }

    fn erase(root: ?*Node, byte: u32, id: u64) ?*Node {
        const node = root orelse return null;
        node.parent = null;
        push(node);
        if (lowerByte(node.mark) == byte and node.mark.id() == id) {
            const replacement = merge(node.left, node.right);
            node.left = null;
            node.right = null;
            node.parent = null;
            node.lazy_shift = 0;
            return replacement;
        }
        if (keyLess(byte, id, lowerByte(node.mark), node.mark.id())) {
            setLeft(node, erase(node.left, byte, id));
        } else {
            setRight(node, erase(node.right, byte, id));
        }
        pull(node);
        node.parent = null;
        return node;
    }

    fn resetDetached(node: *Node) void {
        node.max_byte = upperByte(node.mark);
        node.max_overlap_end_byte = overlapEndByte(node.mark);
        node.lazy_shift = 0;
        node.parent = null;
        node.left = null;
        node.right = null;
    }

    fn transformPosition(position: u32, gravity: Gravity, start_byte: u32, old_end: u32, new_end: u32) u32 {
        if (position < start_byte) return position;
        if (position <= old_end) return if (gravity == .left) start_byte else new_end;
        return shifted(position, @as(i64, new_end) - @as(i64, old_end));
    }

    fn transformPositionChecked(position: u32, gravity: Gravity, start_byte: u32, old_end: u32, new_end: u32) !u32 {
        if (position < start_byte) return position;
        if (position <= old_end) return if (gravity == .left) start_byte else new_end;
        if (new_end >= old_end) {
            return std.math.add(u32, position, new_end - old_end) catch error.PositionOverflow;
        }
        return position - (old_end - new_end);
    }

    fn transformMark(mark: Mark, start_byte: u32, old_end: u32, new_end: u32) Mark {
        var result = mark;
        switch (result) {
            .range => |*range| {
                range.start_byte = transformPosition(range.start_byte, range.start_gravity, start_byte, old_end, new_end);
                range.end_byte = transformPosition(range.end_byte, range.end_gravity, start_byte, old_end, new_end);
            },
            .point => |*point| {
                point.byte = transformPosition(point.byte, point.gravity, start_byte, old_end, new_end);
            },
        }
        return result;
    }

    fn updateCrossingPrefix(root: *?*Node, start_byte: u32, old_end: u32, new_end: u32) void {
        const node = root.* orelse return;
        if (node.max_byte < start_byte) return;
        push(node);
        if (node.left != null and node.left.?.max_byte >= start_byte) {
            updateCrossingPrefix(&node.left, start_byte, old_end, new_end);
            if (node.left) |left| left.parent = node;
        }
        if (upperByte(node.mark) >= start_byte) {
            const old_lower = lowerByte(node.mark);
            node.mark = transformMark(node.mark, start_byte, old_end, new_end);
            std.debug.assert(lowerByte(node.mark) == old_lower);
        }
        if (node.right != null and node.right.?.max_byte >= start_byte) {
            updateCrossingPrefix(&node.right, start_byte, old_end, new_end);
            if (node.right) |right| right.parent = node;
        }
        pull(node);
        node.parent = null;
        root.* = node;
    }

    fn reindexSplice(maybe_node: ?*Node, start_byte: u32, old_end: u32, new_end: u32, rebuilt: *?*Node) void {
        const node = maybe_node orelse return;
        push(node);
        const left = node.left;
        const right = node.right;
        node.left = null;
        node.right = null;
        node.parent = null;
        reindexSplice(left, start_byte, old_end, new_end, rebuilt);
        reindexSplice(right, start_byte, old_end, new_end, rebuilt);
        node.mark = transformMark(node.mark, start_byte, old_end, new_end);
        resetDetached(node);
        rebuilt.* = insert(rebuilt.*, node);
    }

    fn endpointInsideMove(position: u32, gravity: Gravity, start_byte: u32, end_byte: u32) bool {
        return (position > start_byte and position < end_byte) or
            (position == start_byte and gravity == .right) or
            (position == end_byte and gravity == .left);
    }

    fn movedPosition(
        position: u32,
        gravity: Gravity,
        start_byte: u32,
        end_byte: u32,
        len: u32,
        destination_byte: u32,
    ) !u32 {
        if (endpointInsideMove(position, gravity, start_byte, end_byte)) {
            const offset = position - start_byte;
            return std.math.add(u32, destination_byte, offset) catch error.PositionOverflow;
        }
        const after_remove = try transformPositionChecked(position, gravity, start_byte, end_byte, start_byte);
        const destination_end = std.math.add(u32, destination_byte, len) catch return error.PositionOverflow;
        return transformPositionChecked(after_remove, gravity, destination_byte, destination_byte, destination_end);
    }

    pub fn movedMark(mark: Mark, start_byte: u32, end_byte: u32, len: u32, destination_byte: u32) !Mark {
        var result = mark;
        switch (result) {
            .range => |*range| {
                range.start_byte = try movedPosition(
                    range.start_byte,
                    range.start_gravity,
                    start_byte,
                    end_byte,
                    len,
                    destination_byte,
                );
                range.end_byte = try movedPosition(
                    range.end_byte,
                    range.end_gravity,
                    start_byte,
                    end_byte,
                    len,
                    destination_byte,
                );
            },
            .point => |*point| {
                point.byte = try movedPosition(
                    point.byte,
                    point.gravity,
                    start_byte,
                    end_byte,
                    len,
                    destination_byte,
                );
            },
        }
        return result;
    }

    fn movedNodeLessThan(_: void, left: *Node, right: *Node) bool {
        return keyLess(lowerByte(left.mark), left.mark.id(), lowerByte(right.mark), right.mark.id());
    }

    /// Build the unique treap for sorted keys and existing priorities in linear
    /// time. Parent pointers temporarily form the Cartesian stack.
    fn rebuildSortedNodes(nodes: []*Node) ?*Node {
        var top: ?*Node = null;
        for (nodes) |node| {
            var last: ?*Node = null;
            while (top) |current| {
                if (!priorityBefore(node, current)) break;
                top = current.parent;
                pull(current);
                last = current;
            }
            setLeft(node, last);
            if (top) |current| setRight(current, node) else node.parent = null;
            top = node;
        }

        var root: ?*Node = null;
        while (top) |current| {
            top = current.parent;
            pull(current);
            root = current;
        }
        if (root) |value| value.parent = null;
        return root;
    }

    fn deletionClassification(mark: Mark, start_byte: u32, old_end: u32, old_len: u32) struct { affected: bool, covered: bool } {
        if (old_len == 0) return .{ .affected = false, .covered = false };
        return switch (mark) {
            .point => |point| .{
                .affected = point.byte >= start_byte and point.byte <= old_end,
                .covered = false,
            },
            .range => |range| blk: {
                const lower = @min(range.start_byte, range.end_byte);
                const upper = @max(range.start_byte, range.end_byte);
                const endpoint_affected = (range.start_byte >= start_byte and range.start_byte <= old_end) or
                    (range.end_byte >= start_byte and range.end_byte <= old_end);
                const overlaps = range.start_byte < range.end_byte and
                    range.start_byte < old_end and range.end_byte > start_byte;
                break :blk .{
                    .affected = endpoint_affected or overlaps,
                    .covered = if (lower == upper)
                        lower > start_byte and upper < old_end
                    else
                        lower >= start_byte and upper <= old_end,
                };
            },
        };
    }

    const DeletionCounts = struct { affected: usize = 0, covered: usize = 0 };

    fn slicesOverlap(a: []const u64, b: []const u64) bool {
        if (a.len == 0 or b.len == 0) return false;
        const a_start = @intFromPtr(a.ptr);
        const b_start = @intFromPtr(b.ptr);
        if (a_start <= b_start) return b_start - a_start < a.len * @sizeOf(u64);
        return a_start - b_start < b.len * @sizeOf(u64);
    }

    fn countDeletion(
        maybe_node: ?*const Node,
        start_byte: u32,
        old_end: u32,
        old_len: u32,
        inherited_shift: i64,
    ) DeletionCounts {
        const node = maybe_node orelse return .{};
        if (old_len == 0 or shifted(node.max_byte, inherited_shift) < start_byte) return .{};
        const child_shift = inherited_shift + node.lazy_shift;
        var result = countDeletion(node.left, start_byte, old_end, old_len, child_shift);
        var mark = node.mark;
        shiftMark(&mark, inherited_shift);
        if (lowerByte(mark) <= old_end) {
            const classification = deletionClassification(mark, start_byte, old_end, old_len);
            result.affected += @intFromBool(classification.affected);
            result.covered += @intFromBool(classification.covered);
            const right = countDeletion(node.right, start_byte, old_end, old_len, child_shift);
            result.affected += right.affected;
            result.covered += right.covered;
        }
        return result;
    }

    fn fillDeletion(
        maybe_node: ?*Node,
        start_byte: u32,
        old_end: u32,
        old_len: u32,
        affected: []u64,
        covered: []u64,
        affected_len: *usize,
        covered_len: *usize,
    ) void {
        const node = maybe_node orelse return;
        if (old_len == 0 or node.max_byte < start_byte) return;
        push(node);
        fillDeletion(node.left, start_byte, old_end, old_len, affected, covered, affected_len, covered_len);
        if (lowerByte(node.mark) <= old_end) {
            const classification = deletionClassification(node.mark, start_byte, old_end, old_len);
            if (classification.affected) {
                affected[affected_len.*] = node.mark.id();
                affected_len.* += 1;
            }
            if (classification.covered) {
                covered[covered_len.*] = node.mark.id();
                covered_len.* += 1;
            }
            fillDeletion(node.right, start_byte, old_end, old_len, affected, covered, affected_len, covered_len);
        }
    }

    fn visitOverlapNode(maybe_node: ?*Node, start_byte: u32, end_byte: u32, context: anytype, visitor: anytype) !void {
        const node = maybe_node orelse return;
        push(node);
        if (node.left) |left| {
            if (left.max_overlap_end_byte > start_byte) {
                try visitOverlapNode(left, start_byte, end_byte, context, visitor);
            }
        }
        switch (node.mark) {
            .range => |range| {
                if (range.start_byte < range.end_byte and range.start_byte < end_byte and range.end_byte > start_byte) {
                    try visitor(context, range);
                }
            },
            .point => {},
        }
        if (lowerByte(node.mark) < end_byte) {
            try visitOverlapNode(node.right, start_byte, end_byte, context, visitor);
        }
    }

    fn visitStartingNode(maybe_node: ?*Node, byte: u32, context: anytype, visitor: anytype) !void {
        const node = maybe_node orelse return;
        if (node.max_byte < byte) return;
        push(node);
        try visitStartingNode(node.left, byte, context, visitor);
        if (lowerByte(node.mark) <= byte) {
            switch (node.mark) {
                .range => |range| if (range.start_byte == byte) try visitor(context, range),
                .point => {},
            }
            try visitStartingNode(node.right, byte, context, visitor);
        }
    }

    fn visitPointsNode(maybe_node: ?*Node, byte: u32, context: anytype, visitor: anytype) !void {
        const node = maybe_node orelse return;
        push(node);
        const lower = lowerByte(node.mark);
        if (lower >= byte) try visitPointsNode(node.left, byte, context, visitor);
        if (lower == byte) {
            switch (node.mark) {
                .range => {},
                .point => |point| try visitor(context, point),
            }
        }
        if (lower <= byte) try visitPointsNode(node.right, byte, context, visitor);
    }

    const Key = struct {
        byte: u32,
        id: u64,
    };

    const Maximums = struct {
        byte: u32 = 0,
        overlap_end_byte: u32 = 0,
    };

    fn validateNode(
        self: *Self,
        maybe_node: ?*Node,
        expected_parent: ?*Node,
        lower: ?Key,
        upper: ?Key,
        seen: *usize,
    ) IntegrityError!Maximums {
        const node = maybe_node orelse return .{};
        if (node.parent != expected_parent) return error.BadParent;
        push(node);
        const key = Key{ .byte = lowerByte(node.mark), .id = node.mark.id() };
        if (self.ids.get(node.mark.id()) != node) return error.BadIdIndex;
        if (lower) |bound| {
            if (!keyLess(bound.byte, bound.id, key.byte, key.id)) return error.BadOrder;
        }
        if (upper) |bound| {
            if (!keyLess(key.byte, key.id, bound.byte, bound.id)) return error.BadOrder;
        }
        if (node.left) |left| if (priorityBefore(left, node)) return error.BadPriority;
        if (node.right) |right| if (priorityBefore(right, node)) return error.BadPriority;
        if (node.lazy_shift != 0) return error.BadMaximum;

        const left = try self.validateNode(node.left, node, lower, key, seen);
        const right = try self.validateNode(node.right, node, key, upper, seen);
        const expected = Maximums{
            .byte = @max(upperByte(node.mark), @max(left.byte, right.byte)),
            .overlap_end_byte = @max(overlapEndByte(node.mark), @max(left.overlap_end_byte, right.overlap_end_byte)),
        };
        if (node.max_byte != expected.byte or node.max_overlap_end_byte != expected.overlap_end_byte) {
            return error.BadMaximum;
        }
        seen.* += 1;
        return expected;
    }
};
