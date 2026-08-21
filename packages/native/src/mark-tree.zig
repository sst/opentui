const std = @import("std");

const Allocator = std.mem.Allocator;

/// An edit-following interval index over UTF-8 byte offsets.
///
/// MarkTree is a deterministic treap rather than a B-tree. A treap keeps this
/// standalone implementation small while still providing expected O(log n)
/// add/remove/get/update, interval-tree overlap pruning, and O(log n) lazy
/// shifts for an unaffected suffix. Priorities are a fixed hash of the stable
/// ID, so shape and iteration order do not depend on a random seed.
///
/// Payloads intentionally live outside this type and can be keyed by Range.id.
pub const MarkTree = struct {
    const Self = @This();

    pub const Gravity = enum {
        left,
        right,
    };

    pub const RangeInput = struct {
        start_byte: u32,
        end_byte: u32,
        start_gravity: Gravity = .left,
        end_gravity: Gravity = .right,
    };

    pub const Range = struct {
        id: u64,
        start_byte: u32,
        end_byte: u32,
        start_gravity: Gravity,
        end_gravity: Gravity,
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
        range: Range,
        priority: u64,
        max_end_byte: u32,
        lazy_shift: i64 = 0,
        parent: ?*Node = null,
        left: ?*Node = null,
        right: ?*Node = null,
    };

    allocator: Allocator,
    root: ?*Node = null,
    ids: std.AutoHashMap(u64, *Node),
    next_id: u64 = 1,
    len: usize = 0,

    pub fn init(allocator: Allocator) Self {
        return .{
            .allocator = allocator,
            .ids = std.AutoHashMap(u64, *Node).init(allocator),
        };
    }

    pub fn deinit(self: *Self) void {
        self.destroySubtree(self.root);
        self.ids.deinit();
        self.* = undefined;
    }

    pub fn count(self: *const Self) usize {
        return self.len;
    }

    /// Adds a normalized half-open range and returns an ID that is never reused.
    /// Reversed input endpoints are exchanged together with their gravities.
    pub fn add(self: *Self, input: RangeInput) !u64 {
        if (self.next_id == 0) return error.IdExhausted;

        const id = self.next_id;
        const range = normalize(id, input);
        const node = try self.allocator.create(Node);
        errdefer self.allocator.destroy(node);
        node.* = .{
            .range = range,
            .priority = priorityFor(id),
            .max_end_byte = range.end_byte,
        };
        try self.ids.put(id, node);

        self.root = insert(self.root, node);
        if (self.root) |root| root.parent = null;
        self.next_id +%= 1;
        self.len += 1;
        return id;
    }

    /// Returns a range by stable ID. The value is copied so later edits cannot
    /// invalidate it.
    pub fn get(self: *Self, id: u64) ?Range {
        const node = self.ids.get(id) orelse return null;
        materialize(node);
        return node.range;
    }

    pub fn remove(self: *Self, id: u64) bool {
        const node = self.ids.get(id) orelse return false;
        materialize(node);
        self.root = erase(self.root, node.range.start_byte, id);
        if (self.root) |root| root.parent = null;
        _ = self.ids.remove(id);
        self.allocator.destroy(node);
        self.len -= 1;
        return true;
    }

    /// Replaces endpoints and gravities while retaining the range's ID.
    pub fn update(self: *Self, id: u64, input: RangeInput) bool {
        const node = self.ids.get(id) orelse return false;
        materialize(node);
        self.root = erase(self.root, node.range.start_byte, id);

        node.range = normalize(id, input);
        node.max_end_byte = node.range.end_byte;
        node.lazy_shift = 0;
        node.parent = null;
        node.left = null;
        node.right = null;
        self.root = insert(self.root, node);
        if (self.root) |root| root.parent = null;
        return true;
    }

    /// Applies one atomic replacement of [start_byte, start_byte + old_len)
    /// with new_len bytes. All arithmetic is checked before the tree changes.
    ///
    /// Insertion at an endpoint follows that endpoint's gravity. During a
    /// replacement, positions strictly inside the old range also choose the
    /// replacement's left or right edge by gravity. The old range's right
    /// boundary remains on the right of the replacement. If independently
    /// transformed endpoints cross (possible for a zero-length range), the
    /// range and its endpoint gravities are normalized again.
    pub fn splice(self: *Self, start_byte: u32, old_len: u32, new_len: u32) !void {
        const old_end = std.math.add(u32, start_byte, old_len) catch return error.PositionOverflow;
        const new_end = std.math.add(u32, start_byte, new_len) catch return error.PositionOverflow;

        if (new_len > old_len) {
            const growth = new_len - old_len;
            if (self.root) |root| {
                if (root.max_end_byte > old_end and root.max_end_byte > std.math.maxInt(u32) - growth) {
                    return error.PositionOverflow;
                }
            }
        }

        var before: ?*Node = null;
        var affected: ?*Node = null;
        var suffix: ?*Node = null;

        if (old_len == 0) {
            var at_or_after: ?*Node = null;
            splitStart(self.root, start_byte, &before, &at_or_after);
            if (start_byte == std.math.maxInt(u32)) {
                affected = at_or_after;
            } else {
                splitStart(at_or_after, start_byte + 1, &affected, &suffix);
            }
        } else {
            var at_or_after: ?*Node = null;
            splitStart(self.root, start_byte, &before, &at_or_after);
            splitStart(at_or_after, old_end, &affected, &suffix);
        }

        updateEndsBefore(&before, start_byte, old_end, new_end, old_len);

        var rebuilt: ?*Node = null;
        reindexSplice(affected, start_byte, old_end, new_end, old_len, &rebuilt);

        const delta = @as(i64, new_len) - @as(i64, old_len);
        if (suffix) |root| applyShift(root, delta);

        const middle_and_suffix = if (old_len == 0)
            merge(rebuilt, suffix)
        else
            unite(rebuilt, suffix);
        self.root = merge(before, middle_and_suffix);
        if (self.root) |root| root.parent = null;
    }

    /// Visits overlapping non-empty ranges in `(start_byte, id)` order.
    /// Empty query ranges and zero-length indexed ranges do not overlap.
    pub fn visitOverlapping(self: *Self, first_byte: u32, second_byte: u32, context: anytype, visitor: anytype) !void {
        const start_byte = @min(first_byte, second_byte);
        const end_byte = @max(first_byte, second_byte);
        if (start_byte == end_byte) return;
        try visitOverlapNode(self.root, start_byte, end_byte, context, visitor);
    }

    /// Iteration is invalidated by any mutation of the tree.
    pub fn iterator(self: *Self) Iterator {
        return .{ .next_node = leftmost(self.root) };
    }

    pub const Iterator = struct {
        next_node: ?*Node,

        pub fn next(self: *Iterator) ?Range {
            const node = self.next_node orelse return null;
            materialize(node);
            const result = node.range;

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

    /// Materializes lazy shifts and validates tree, interval, parent, and ID-map
    /// invariants. Intended for tests and diagnostics rather than hot paths.
    pub fn validateIntegrity(self: *Self) IntegrityError!void {
        if (self.root) |root| {
            if (root.parent != null) return error.BadRootParent;
        }
        var seen: usize = 0;
        _ = try self.validateNode(self.root, null, null, null, &seen);
        if (seen != self.len or self.ids.count() != self.len) return error.BadCount;

        var id_iterator = self.ids.iterator();
        while (id_iterator.next()) |entry| {
            if (entry.value_ptr.*.range.id != entry.key_ptr.*) return error.BadIdIndex;
        }
    }

    fn destroySubtree(self: *Self, maybe_node: ?*Node) void {
        const node = maybe_node orelse return;
        self.destroySubtree(node.left);
        self.destroySubtree(node.right);
        self.allocator.destroy(node);
    }

    fn normalize(id: u64, input: RangeInput) Range {
        if (input.start_byte <= input.end_byte) {
            return .{
                .id = id,
                .start_byte = input.start_byte,
                .end_byte = input.end_byte,
                .start_gravity = input.start_gravity,
                .end_gravity = input.end_gravity,
            };
        }
        return .{
            .id = id,
            .start_byte = input.end_byte,
            .end_byte = input.start_byte,
            .start_gravity = input.end_gravity,
            .end_gravity = input.start_gravity,
        };
    }

    fn normalizeRange(range: Range) Range {
        return normalize(range.id, .{
            .start_byte = range.start_byte,
            .end_byte = range.end_byte,
            .start_gravity = range.start_gravity,
            .end_gravity = range.end_gravity,
        });
    }

    fn priorityFor(id: u64) u64 {
        var value = id +% 0x9e3779b97f4a7c15;
        value = (value ^ (value >> 30)) *% 0xbf58476d1ce4e5b9;
        value = (value ^ (value >> 27)) *% 0x94d049bb133111eb;
        return value ^ (value >> 31);
    }

    fn keyLess(start_a: u32, id_a: u64, start_b: u32, id_b: u64) bool {
        return start_a < start_b or (start_a == start_b and id_a < id_b);
    }

    fn priorityBefore(a: *const Node, b: *const Node) bool {
        return a.priority < b.priority or (a.priority == b.priority and a.range.id < b.range.id);
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
        node.max_end_byte = node.range.end_byte;
        if (node.left) |left| node.max_end_byte = @max(node.max_end_byte, left.max_end_byte);
        if (node.right) |right| node.max_end_byte = @max(node.max_end_byte, right.max_end_byte);
    }

    fn shifted(position: u32, delta: i64) u32 {
        return @intCast(@as(i64, position) + delta);
    }

    fn applyShift(node: *Node, delta: i64) void {
        if (delta == 0) return;
        node.range.start_byte = shifted(node.range.start_byte, delta);
        node.range.end_byte = shifted(node.range.end_byte, delta);
        node.max_end_byte = shifted(node.max_end_byte, delta);
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

    fn splitKey(maybe_node: ?*Node, start_byte: u32, id: u64, less: *?*Node, greater: *?*Node) void {
        const node = maybe_node orelse {
            less.* = null;
            greater.* = null;
            return;
        };
        node.parent = null;
        push(node);

        if (keyLess(node.range.start_byte, node.range.id, start_byte, id)) {
            var middle: ?*Node = null;
            splitKey(node.right, start_byte, id, &middle, greater);
            setRight(node, middle);
            pull(node);
            less.* = node;
        } else {
            var middle: ?*Node = null;
            splitKey(node.left, start_byte, id, less, &middle);
            setLeft(node, middle);
            pull(node);
            greater.* = node;
        }
        if (less.*) |root| root.parent = null;
        if (greater.*) |root| root.parent = null;
    }

    fn splitStart(maybe_node: ?*Node, start_byte: u32, before: *?*Node, at_or_after: *?*Node) void {
        const node = maybe_node orelse {
            before.* = null;
            at_or_after.* = null;
            return;
        };
        node.parent = null;
        push(node);

        if (node.range.start_byte < start_byte) {
            var middle: ?*Node = null;
            splitStart(node.right, start_byte, &middle, at_or_after);
            setRight(node, middle);
            pull(node);
            before.* = node;
        } else {
            var middle: ?*Node = null;
            splitStart(node.left, start_byte, before, &middle);
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
            const child = merge(left.right, right);
            setRight(left, child);
            pull(left);
            left.parent = null;
            return left;
        }
        const child = merge(left, right.left);
        setLeft(right, child);
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
            splitKey(current, node.range.start_byte, node.range.id, &left, &right);
            setLeft(node, left);
            setRight(node, right);
            pull(node);
            node.parent = null;
            return node;
        }

        if (keyLess(node.range.start_byte, node.range.id, current.range.start_byte, current.range.id)) {
            setLeft(current, insert(current.left, node));
        } else {
            setRight(current, insert(current.right, node));
        }
        pull(current);
        current.parent = null;
        return current;
    }

    fn erase(root: ?*Node, start_byte: u32, id: u64) ?*Node {
        const node = root orelse return null;
        node.parent = null;
        push(node);

        if (node.range.start_byte == start_byte and node.range.id == id) {
            const replacement = merge(node.left, node.right);
            node.left = null;
            node.right = null;
            node.parent = null;
            node.lazy_shift = 0;
            node.max_end_byte = node.range.end_byte;
            return replacement;
        }

        if (keyLess(start_byte, id, node.range.start_byte, node.range.id)) {
            setLeft(node, erase(node.left, start_byte, id));
        } else {
            setRight(node, erase(node.right, start_byte, id));
        }
        pull(node);
        node.parent = null;
        return node;
    }

    fn unite(first_root: ?*Node, second_root: ?*Node) ?*Node {
        var first = first_root orelse {
            if (second_root) |root| root.parent = null;
            return second_root;
        };
        var second = second_root orelse {
            first.parent = null;
            return first;
        };
        first.parent = null;
        second.parent = null;
        push(first);
        push(second);

        if (priorityBefore(second, first)) {
            const temporary = first;
            first = second;
            second = temporary;
        }

        var less: ?*Node = null;
        var greater: ?*Node = null;
        splitKey(second, first.range.start_byte, first.range.id, &less, &greater);
        const old_left = first.left;
        const old_right = first.right;
        first.left = null;
        first.right = null;
        setLeft(first, unite(old_left, less));
        setRight(first, unite(old_right, greater));
        pull(first);
        first.parent = null;
        return first;
    }

    fn transformPosition(position: u32, gravity: Gravity, start_byte: u32, old_end: u32, new_end: u32, old_len: u32) u32 {
        if (position < start_byte) return position;
        if (position > old_end) return shifted(position, @as(i64, new_end) - @as(i64, old_end));
        if (old_len != 0 and position == old_end) return new_end;
        return if (gravity == .left) start_byte else new_end;
    }

    fn transformRange(range: Range, start_byte: u32, old_end: u32, new_end: u32, old_len: u32) Range {
        var result = range;
        result.start_byte = transformPosition(range.start_byte, range.start_gravity, start_byte, old_end, new_end, old_len);
        result.end_byte = transformPosition(range.end_byte, range.end_gravity, start_byte, old_end, new_end, old_len);
        return normalizeRange(result);
    }

    fn updateEndsBefore(root: *?*Node, start_byte: u32, old_end: u32, new_end: u32, old_len: u32) void {
        const node = root.* orelse return;
        if (node.max_end_byte < start_byte) return;
        push(node);

        if (node.left != null and node.left.?.max_end_byte >= start_byte) {
            updateEndsBefore(&node.left, start_byte, old_end, new_end, old_len);
            if (node.left) |left| left.parent = node;
        }
        if (node.range.end_byte >= start_byte) {
            node.range.end_byte = transformPosition(
                node.range.end_byte,
                node.range.end_gravity,
                start_byte,
                old_end,
                new_end,
                old_len,
            );
        }
        if (node.right != null and node.right.?.max_end_byte >= start_byte) {
            updateEndsBefore(&node.right, start_byte, old_end, new_end, old_len);
            if (node.right) |right| right.parent = node;
        }
        pull(node);
        node.parent = null;
        root.* = node;
    }

    fn reindexSplice(
        maybe_node: ?*Node,
        start_byte: u32,
        old_end: u32,
        new_end: u32,
        old_len: u32,
        rebuilt: *?*Node,
    ) void {
        const node = maybe_node orelse return;
        push(node);
        const left = node.left;
        const right = node.right;
        node.left = null;
        node.right = null;
        node.parent = null;
        node.lazy_shift = 0;

        reindexSplice(left, start_byte, old_end, new_end, old_len, rebuilt);
        reindexSplice(right, start_byte, old_end, new_end, old_len, rebuilt);

        node.range = transformRange(node.range, start_byte, old_end, new_end, old_len);
        node.max_end_byte = node.range.end_byte;
        rebuilt.* = insert(rebuilt.*, node);
    }

    fn visitOverlapNode(maybe_node: ?*Node, start_byte: u32, end_byte: u32, context: anytype, visitor: anytype) !void {
        const node = maybe_node orelse return;
        push(node);

        if (node.left) |left| {
            if (left.max_end_byte > start_byte) {
                try visitOverlapNode(left, start_byte, end_byte, context, visitor);
            }
        }
        if (node.range.start_byte < end_byte and node.range.end_byte > start_byte) {
            try visitor(context, node.range);
        }
        if (node.range.start_byte < end_byte) {
            try visitOverlapNode(node.right, start_byte, end_byte, context, visitor);
        }
    }

    const Key = struct {
        start_byte: u32,
        id: u64,
    };

    fn validateNode(
        self: *Self,
        maybe_node: ?*Node,
        expected_parent: ?*Node,
        lower: ?Key,
        upper: ?Key,
        seen: *usize,
    ) IntegrityError!u32 {
        const node = maybe_node orelse return 0;
        if (node.parent != expected_parent) return error.BadParent;
        push(node);

        const key = Key{ .start_byte = node.range.start_byte, .id = node.range.id };
        if (self.ids.get(node.range.id) != node) return error.BadIdIndex;
        if (lower) |bound| {
            if (!keyLess(bound.start_byte, bound.id, key.start_byte, key.id)) return error.BadOrder;
        }
        if (upper) |bound| {
            if (!keyLess(key.start_byte, key.id, bound.start_byte, bound.id)) return error.BadOrder;
        }
        if (node.range.start_byte > node.range.end_byte) return error.BadOrder;
        if (node.left) |left| {
            if (priorityBefore(left, node)) return error.BadPriority;
        }
        if (node.right) |right| {
            if (priorityBefore(right, node)) return error.BadPriority;
        }
        if (node.lazy_shift != 0) return error.BadMaximum;

        const left_max = try self.validateNode(node.left, node, lower, key, seen);
        const right_max = try self.validateNode(node.right, node, key, upper, seen);
        const expected_max = @max(node.range.end_byte, @max(left_max, right_max));
        if (node.max_end_byte != expected_max) return error.BadMaximum;
        seen.* += 1;
        return expected_max;
    }
};
