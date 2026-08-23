const std = @import("std");
const Allocator = std.mem.Allocator;

/// This is a persistent/immutable rope - operations create new nodes without
/// freeing old ones. Use an ArenaAllocator to avoid manual memory management:
///
///   var arena = std.heap.ArenaAllocator.init(allocator);
///   defer arena.deinit();
///   var rope = try Rope(T).init(arena.allocator());
///
/// TODO: Needs a startTransaction and endTransaction to track changes
/// -> used to trigger a change event _after_ a batch of changes is complete (group as operation)
/// -> used to group history operations (undo/redo), so not everything is a single history entry
///
pub fn Rope(comptime T: type) type {
    return struct {
        const Self = @This();

        pub const max_imbalance = 7;

        pub const Config = struct {
            max_undo_depth: ?usize = null, // null = unlimited
        };

        const marker_enabled = @typeInfo(T) == .@"union" and @hasDecl(T, "MarkerTypes");
        const MarkerTagCount = if (marker_enabled) T.MarkerTypes.len else 0;

        const boundary_enabled = @hasDecl(T, "BoundaryAction");
        pub const BoundaryAction = if (boundary_enabled) T.BoundaryAction else struct {
            delete_left: bool = false,
            delete_right: bool = false,
            insert_between: []const T = &[_]T{},
        };

        pub const MarkerPosition = struct {
            leaf_index: u32,
            global_weight: u32,
        };
        pub const MarkerCache = if (marker_enabled) struct {
            // Flat arrays of positions for each marker type
            positions: std.AutoHashMap(std.meta.Tag(T), std.ArrayListUnmanaged(MarkerPosition)),
            version: u64, // Rope version when cache was built
            allocator: Allocator,

            pub fn init(allocator: Allocator) MarkerCache {
                return .{
                    .positions = std.AutoHashMap(std.meta.Tag(T), std.ArrayListUnmanaged(MarkerPosition)).init(allocator),
                    .version = std.math.maxInt(u64), // Sentinel: cache is invalid until first rebuild
                    .allocator = allocator,
                };
            }

            pub fn deinit(self: *MarkerCache) void {
                var iter = self.positions.valueIterator();
                while (iter.next()) |list| {
                    list.deinit(self.allocator);
                }
                self.positions.deinit();
            }

            fn clear(self: *MarkerCache) void {
                var iter = self.positions.valueIterator();
                while (iter.next()) |list| {
                    list.clearRetainingCapacity();
                }
            }
        } else struct {
            pub fn init(_: Allocator) @This() {
                return .{};
            }
            pub fn deinit(_: *@This()) void {}
            fn clear(_: *@This()) void {}
        };

        pub const Metrics = struct {
            count: u32 = 0,
            depth: u32 = 1,
            custom: if (@hasDecl(T, "Metrics")) T.Metrics else void = if (@hasDecl(T, "Metrics")) .{} else {},

            marker_counts: if (marker_enabled) [MarkerTagCount]u32 else void = if (marker_enabled) [_]u32{0} ** MarkerTagCount else {},

            pub fn add(self: *Metrics, other: Metrics) void {
                self.count += other.count;
                self.depth = @max(self.depth, other.depth);

                if (@hasDecl(T, "Metrics")) {
                    if (@hasDecl(T.Metrics, "add")) {
                        self.custom.add(other.custom);
                    }
                }

                if (marker_enabled) {
                    inline for (&self.marker_counts, 0..) |*dst, i| {
                        dst.* += other.marker_counts[i];
                    }
                }
            }

            pub fn weight(self: *const Metrics) u32 {
                if (@hasDecl(T, "Metrics")) {
                    if (@hasDecl(T.Metrics, "weight")) {
                        return self.custom.weight();
                    }
                }
                return self.count;
            }
        };

        pub const Branch = struct {
            left: *const Node,
            right: *const Node,
            left_metrics: Metrics,
            total_metrics: Metrics,

            fn is_balanced(self: *const Branch) bool {
                const left_weight = self.left.metrics().weight();
                const right_weight = self.right.metrics().weight();
                const total_weight = left_weight +| right_weight;

                if (total_weight == 0) return true;

                const max_side: u32 = @intCast((@as(u64, total_weight) * 3) / 4);
                return left_weight <= max_side and right_weight <= max_side;
            }
        };

        pub const Leaf = struct {
            data: T,
            is_sentinel: bool = false,

            fn metrics(self: *const Leaf) Metrics {
                var m = Metrics{
                    .count = if (self.is_sentinel) 0 else 1,
                    .depth = 1,
                };

                if (@hasDecl(T, "Metrics")) {
                    if (@hasDecl(T, "measure")) {
                        m.custom = self.data.measure();
                    }
                }

                if (!self.is_sentinel and marker_enabled) {
                    const tag = std.meta.activeTag(self.data);
                    inline for (T.MarkerTypes, 0..) |mt, i| {
                        if (tag == mt) {
                            m.marker_counts[i] = 1;
                            break;
                        }
                    }
                }

                return m;
            }
        };

        pub const Node = union(enum) {
            branch: Branch,
            leaf: Leaf,

            pub fn metrics(self: *const Node) Metrics {
                return switch (self.*) {
                    .branch => |*b| b.total_metrics,
                    .leaf => |*l| l.metrics(),
                };
            }

            pub fn depth(self: *const Node) u32 {
                return self.metrics().depth;
            }

            pub fn count(self: *const Node) u32 {
                return self.metrics().count;
            }

            pub fn is_balanced(self: *const Node) bool {
                return switch (self.*) {
                    .branch => |*b| b.is_balanced(),
                    .leaf => true,
                };
            }

            pub fn is_empty(self: *const Node) bool {
                return switch (self.*) {
                    .branch => |*b| b.left.is_empty() and b.right.is_empty(),
                    .leaf => |*l| {
                        if (@hasDecl(T, "is_empty")) {
                            return l.data.is_empty();
                        }
                        return false;
                    },
                };
            }

            pub fn is_sentinel(self: *const Node, empty_leaf: *const Node) bool {
                return self == empty_leaf;
            }

            pub fn new_branch(allocator: Allocator, left: *const Node, right: *const Node) !*const Node {
                const node = try allocator.create(Node);
                errdefer allocator.destroy(node);

                const left_metrics = left.metrics();
                var total_metrics = Metrics{};
                total_metrics.add(left_metrics);
                total_metrics.add(right.metrics());
                total_metrics.depth += 1;

                node.* = .{ .branch = .{
                    .left = left,
                    .right = right,
                    .left_metrics = left_metrics,
                    .total_metrics = total_metrics,
                } };

                return node;
            }

            pub fn new_leaf(allocator: Allocator, data: T) !*const Node {
                const node = try allocator.create(Node);
                errdefer allocator.destroy(node);

                node.* = .{ .leaf = .{ .data = data } };
                return node;
            }

            pub fn get(self: *const Node, index: u32) ?*const T {
                return switch (self.*) {
                    .branch => |*b| {
                        const left_count = b.left_metrics.count;
                        if (index < left_count) {
                            return b.left.get(index);
                        }
                        return b.right.get(index - left_count);
                    },
                    .leaf => |*l| if (index == 0) &l.data else null,
                };
            }

            pub const WalkerFn = *const fn (ctx: *anyopaque, data: *const T, index: u32) WalkerResult;

            pub const WalkerResult = struct {
                keep_walking: bool = true,
                err: ?anyerror = null,
            };

            pub fn walk(self: *const Node, ctx: *anyopaque, f: WalkerFn, current_index: *u32) WalkerResult {
                return switch (self.*) {
                    .branch => |*b| {
                        const left_result = b.left.walk(ctx, f, current_index);
                        if (!left_result.keep_walking or left_result.err != null) {
                            return left_result;
                        }
                        return b.right.walk(ctx, f, current_index);
                    },
                    .leaf => |*l| {
                        const result = f(ctx, &l.data, current_index.*);
                        current_index.* += 1;
                        return result;
                    },
                };
            }

            pub fn walk_from(self: *const Node, start_index: u32, ctx: *anyopaque, f: WalkerFn) WalkerResult {
                var current_index: u32 = start_index;
                return self.walk_from_internal(start_index, ctx, f, &current_index);
            }

            fn walk_from_internal(self: *const Node, start_index: u32, ctx: *anyopaque, f: WalkerFn, current_index: *u32) WalkerResult {
                return switch (self.*) {
                    .branch => |*b| {
                        const left_count = b.left_metrics.count;
                        if (start_index >= left_count) {
                            return b.right.walk_from_internal(start_index - left_count, ctx, f, current_index);
                        }

                        const left_result = b.left.walk_from_internal(start_index, ctx, f, current_index);
                        if (!left_result.keep_walking or left_result.err != null) {
                            return left_result;
                        }
                        return b.right.walk(ctx, f, current_index);
                    },
                    .leaf => |*l| {
                        if (start_index == 0) {
                            const result = f(ctx, &l.data, current_index.*);
                            current_index.* += 1;
                            return result;
                        }
                        return .{};
                    },
                };
            }

            fn collect(self: *const Node, list: *std.ArrayListUnmanaged(*const Node), allocator: Allocator) !void {
                switch (self.*) {
                    .branch => |*b| {
                        try b.left.collect(list, allocator);
                        try b.right.collect(list, allocator);
                    },
                    .leaf => try list.append(allocator, self),
                }
            }

            fn merge_leaves(leaves: []*const Node, allocator: Allocator) error{OutOfMemory}!*const Node {
                const len = leaves.len;
                if (len == 0) return error.OutOfMemory; // Should not happen
                if (len == 1) return leaves[0];
                if (len == 2) return try Node.new_branch(allocator, leaves[0], leaves[1]);

                const mid = len / 2;
                return try Node.new_branch(
                    allocator,
                    try merge_leaves(leaves[0..mid], allocator),
                    try merge_leaves(leaves[mid..], allocator),
                );
            }

            pub fn rebalance(self: *const Node, allocator: Allocator, tmp_allocator: Allocator) !*const Node {
                if (self.is_balanced()) return self;

                var leaves: std.ArrayListUnmanaged(*const Node) = .empty;
                defer leaves.deinit(tmp_allocator);

                try leaves.ensureTotalCapacity(tmp_allocator, self.count());
                try self.collect(&leaves, tmp_allocator);

                return try merge_leaves(leaves.items, allocator);
            }

            /// Structural split at index - returns (left, right) without flattening
            pub fn split_at(node: *const Node, index: u32, allocator: Allocator, empty_leaf: *const Node) error{OutOfMemory}!struct { left: *const Node, right: *const Node } {
                return switch (node.*) {
                    .leaf => {
                        if (index == 0) {
                            return .{ .left = empty_leaf, .right = node };
                        } else {
                            return .{ .left = node, .right = empty_leaf };
                        }
                    },
                    .branch => |*b| {
                        const left_count = b.left_metrics.count;
                        if (index < left_count) {
                            const result = try split_at(b.left, index, allocator, empty_leaf);
                            const new_right = try join_balanced(result.right, b.right, allocator);
                            return .{ .left = result.left, .right = new_right };
                        } else if (index > left_count) {
                            const result = try split_at(b.right, index - left_count, allocator, empty_leaf);
                            const new_left = try join_balanced(b.left, result.left, allocator);
                            return .{ .left = new_left, .right = result.right };
                        } else {
                            return .{ .left = b.left, .right = b.right };
                        }
                    },
                };
            }

            pub fn join_balanced(left: *const Node, right: *const Node, allocator: Allocator) error{OutOfMemory}!*const Node {
                const left_count = left.metrics().count;
                const right_count = right.metrics().count;

                if (left_count == 0) return right;
                if (right_count == 0) return left;

                const left_weight = left.metrics().weight();
                const right_weight = right.metrics().weight();
                const total_weight = left_weight +| right_weight;

                if (total_weight > 0) {
                    const max_side: u32 = @intCast((@as(u64, total_weight) * 3) / 4);
                    if (left_weight <= max_side and right_weight <= max_side) {
                        return try new_branch(allocator, left, right);
                    }
                }

                if (@as(u64, left_weight) > @as(u64, right_weight) * 3) {
                    return switch (left.*) {
                        .leaf => try new_branch(allocator, left, right),
                        .branch => |*b| {
                            const new_right = try join_balanced(b.right, right, allocator);
                            return try new_branch(allocator, b.left, new_right);
                        },
                    };
                }

                return switch (right.*) {
                    .leaf => try new_branch(allocator, left, right),
                    .branch => |*b| {
                        const new_left = try join_balanced(left, b.left, allocator);
                        return try new_branch(allocator, new_left, b.right);
                    },
                };
            }

            pub const LeafSplitResult = struct { left: T, right: T };

            pub const LeafSplitFn = struct {
                ctx: ?*anyopaque = null,
                splitFn: *const fn (allocator: Allocator, ctx: ?*anyopaque, leaf: *const T, weight_in_leaf: u32) error{ OutOfBounds, OutOfMemory }!LeafSplitResult,

                pub fn call(self: *const @This(), allocator: Allocator, leaf: *const T, weight: u32) error{ OutOfBounds, OutOfMemory }!LeafSplitResult {
                    return self.splitFn(allocator, self.ctx, leaf, weight);
                }
            };

            /// Split policy for a coordinate derived from aggregated subtree metrics.
            /// Zero-metric leaves at a boundary have right affinity: they stay with
            /// the content beginning at that coordinate.
            pub const MetricSplitFn = struct {
                ctx: ?*anyopaque = null,
                metricFn: *const fn (metrics: Metrics) u32,
                splitFn: *const fn (allocator: Allocator, ctx: ?*anyopaque, leaf: *const T, metric_in_leaf: u32) error{ OutOfBounds, OutOfMemory }!LeafSplitResult,

                pub fn metric(self: *const @This(), measured: Metrics) u32 {
                    return self.metricFn(measured);
                }

                pub fn splitLeaf(self: *const @This(), allocator: Allocator, leaf: *const T, position: u32) error{ OutOfBounds, OutOfMemory }!LeafSplitResult {
                    return self.splitFn(allocator, self.ctx, leaf, position);
                }
            };

            pub fn split_at_metric(
                node: *const Node,
                target: u32,
                allocator: Allocator,
                empty_leaf: *const Node,
                splitter: *const MetricSplitFn,
            ) error{ OutOfMemory, OutOfBounds }!struct { left: *const Node, right: *const Node } {
                const node_metric = splitter.metric(node.metrics());
                if (target > node_metric) return error.OutOfBounds;

                return switch (node.*) {
                    .leaf => |*leaf| {
                        // This ordering gives zero-metric leaves right affinity.
                        if (target == 0) return .{ .left = empty_leaf, .right = node };
                        if (target == node_metric) return .{ .left = node, .right = empty_leaf };

                        const leaf_split = try splitter.splitLeaf(allocator, &leaf.data, target);
                        return .{
                            .left = try new_leaf(allocator, leaf_split.left),
                            .right = try new_leaf(allocator, leaf_split.right),
                        };
                    },
                    .branch => |*branch| {
                        const left_metric = splitter.metric(branch.left_metrics);
                        if (target < left_metric) {
                            const subtree_split = try split_at_metric(branch.left, target, allocator, empty_leaf, splitter);
                            return .{
                                .left = subtree_split.left,
                                .right = try join_balanced(subtree_split.right, branch.right, allocator),
                            };
                        }
                        if (target > left_metric) {
                            const subtree_split = try split_at_metric(branch.right, target - left_metric, allocator, empty_leaf, splitter);
                            return .{
                                .left = try join_balanced(branch.left, subtree_split.left, allocator),
                                .right = subtree_split.right,
                            };
                        }

                        // Move trailing zero-metric leaves from the left subtree to
                        // the right side instead of making tree shape define affinity.
                        const subtree_split = try split_at_metric(branch.left, target, allocator, empty_leaf, splitter);
                        return .{
                            .left = subtree_split.left,
                            .right = try join_balanced(subtree_split.right, branch.right, allocator),
                        };
                    },
                };
            }

            pub fn split_at_weight(
                node: *const Node,
                target_weight: u32,
                allocator: Allocator,
                empty_leaf: *const Node,
                split_leaf_fn: *const LeafSplitFn,
            ) error{ OutOfMemory, OutOfBounds }!struct { left: *const Node, right: *const Node } {
                return switch (node.*) {
                    .leaf => |*l| {
                        const leaf_weight = node.metrics().weight();

                        if (target_weight == 0) {
                            return .{ .left = empty_leaf, .right = node };
                        } else if (target_weight >= leaf_weight) {
                            return .{ .left = node, .right = empty_leaf };
                        }

                        const split_result = try split_leaf_fn.call(allocator, &l.data, target_weight);
                        const left_node = try new_leaf(allocator, split_result.left);
                        const right_node = try new_leaf(allocator, split_result.right);
                        return .{ .left = left_node, .right = right_node };
                    },
                    .branch => |*b| {
                        const left_weight = b.left_metrics.weight();

                        if (target_weight < left_weight) {
                            const result = try split_at_weight(b.left, target_weight, allocator, empty_leaf, split_leaf_fn);
                            const new_right = try join_balanced(result.right, b.right, allocator);
                            return .{ .left = result.left, .right = new_right };
                        } else if (target_weight > left_weight) {
                            const result = try split_at_weight(b.right, target_weight - left_weight, allocator, empty_leaf, split_leaf_fn);
                            const new_left = try join_balanced(b.left, result.left, allocator);
                            return .{ .left = new_left, .right = result.right };
                        } else {
                            return .{ .left = b.left, .right = b.right };
                        }
                    },
                };
            }
        };

        pub const HistoryPayload = struct {
            ptr: ?*anyopaque = null,
            deinit_fn: ?*const fn (*anyopaque) void = null,

            pub fn init(ptr: *anyopaque, deinit_fn: *const fn (*anyopaque) void) HistoryPayload {
                return .{ .ptr = ptr, .deinit_fn = deinit_fn };
            }

            pub fn deinit(self: *HistoryPayload) void {
                if (self.ptr) |ptr| self.deinit_fn.?(ptr);
                self.* = .{};
            }

            pub fn take(self: *HistoryPayload) HistoryPayload {
                const result = self.*;
                self.* = .{};
                return result;
            }
        };

        pub const UndoNode = struct {
            root: *const Node,
            next: ?*UndoNode = null,
            branches: ?*UndoBranch = null,
            meta: []const u8,
            payload: HistoryPayload = .{},
        };

        pub const UndoBranch = struct {
            redo: *UndoNode,
            next: ?*UndoBranch,
        };

        root: *const Node,
        allocator: Allocator,
        empty_leaf: *const Node,
        undo_history: ?*UndoNode = null,
        redo_history: ?*UndoNode = null,
        curr_history: ?*UndoNode = null,
        config: Config = .{},
        undo_depth: usize = 0,
        version: u64 = 0,
        marker_cache: MarkerCache,

        pub fn init(allocator: Allocator) error{OutOfMemory}!Self {
            return initWithConfig(allocator, .{});
        }

        pub fn initWithConfig(allocator: Allocator, config: Config) error{OutOfMemory}!Self {
            const empty_data = if (@hasDecl(T, "empty"))
                T.empty()
            else
                std.mem.zeroes(T);

            const node = try allocator.create(Node);
            node.* = .{ .leaf = .{ .data = empty_data, .is_sentinel = true } };

            var self = Self{
                .root = node,
                .allocator = allocator,
                .empty_leaf = node,
                .config = config,
                .marker_cache = MarkerCache.init(allocator),
            };

            try self.applyEndsInvariant();

            return self;
        }

        pub const CloneItemFn = *const fn (ctx: ?*anyopaque, item: *const T) anyerror!T;

        pub const RetainedItemFn = *const fn (ctx: *anyopaque, item: *const T) void;

        fn walkItemsInNode(node: *const Node, ctx: *anyopaque, callback: RetainedItemFn) void {
            switch (node.*) {
                .branch => |*branch| {
                    walkItemsInNode(branch.left, ctx, callback);
                    walkItemsInNode(branch.right, ctx, callback);
                },
                .leaf => |*leaf| if (!leaf.is_sentinel) callback(ctx, &leaf.data),
            }
        }

        fn walkItemsInBranches(branch: ?*UndoBranch, ctx: *anyopaque, callback: RetainedItemFn) void {
            var current = branch;
            while (current) |value| : (current = value.next) walkItemsInHistory(value.redo, ctx, callback);
        }

        fn walkItemsInHistory(first: ?*UndoNode, ctx: *anyopaque, callback: RetainedItemFn) void {
            var current = first;
            while (current) |value| : (current = value.next) {
                walkItemsInNode(value.root, ctx, callback);
                walkItemsInBranches(value.branches, ctx, callback);
            }
        }

        pub fn walkCurrentItems(self: *const Self, ctx: *anyopaque, callback: RetainedItemFn) void {
            walkItemsInNode(self.root, ctx, callback);
        }

        pub fn walkHistoryItems(self: *const Self, ctx: *anyopaque, callback: RetainedItemFn) void {
            walkItemsInHistory(self.undo_history, ctx, callback);
            walkItemsInHistory(self.redo_history, ctx, callback);
            walkItemsInHistory(self.curr_history, ctx, callback);
        }

        pub fn walkRetainedItems(self: *const Self, ctx: *anyopaque, callback: RetainedItemFn) void {
            self.walkCurrentItems(ctx, callback);
            self.walkHistoryItems(ctx, callback);
        }

        /// Clone only the published current root. History roots remain borrowed
        /// from their immutable arenas and retain their existing backing IDs.
        pub fn cloneCurrent(
            self: *const Self,
            allocator: Allocator,
            temporary_allocator: Allocator,
            ctx: ?*anyopaque,
            clone_item: CloneItemFn,
        ) !Self {
            var nodes = std.AutoHashMap(*const Node, *const Node).init(temporary_allocator);
            defer nodes.deinit();
            const Cloner = struct {
                allocator: Allocator,
                nodes: *std.AutoHashMap(*const Node, *const Node),
                ctx: ?*anyopaque,
                clone_item: CloneItemFn,

                fn node(cloner: *@This(), source: *const Node) !*const Node {
                    if (cloner.nodes.get(source)) |existing| return existing;
                    const target = try cloner.allocator.create(Node);
                    try cloner.nodes.put(source, target);
                    target.* = switch (source.*) {
                        .leaf => |leaf| .{ .leaf = .{
                            .data = try cloner.clone_item(cloner.ctx, &leaf.data),
                            .is_sentinel = leaf.is_sentinel,
                        } },
                        .branch => |branch| .{ .branch = .{
                            .left = try cloner.node(branch.left),
                            .right = try cloner.node(branch.right),
                            .left_metrics = branch.left_metrics,
                            .total_metrics = branch.total_metrics,
                        } },
                    };
                    return target;
                }
            };
            var cloner: Cloner = .{ .allocator = allocator, .nodes = &nodes, .ctx = ctx, .clone_item = clone_item };
            return .{
                .root = try cloner.node(self.root),
                .allocator = allocator,
                .empty_leaf = try cloner.node(self.empty_leaf),
                .undo_history = self.undo_history,
                .redo_history = self.redo_history,
                .curr_history = self.curr_history,
                .config = self.config,
                .undo_depth = self.undo_depth,
                .version = self.version,
                .marker_cache = MarkerCache.init(allocator),
            };
        }

        /// Clone every root retained by the Rope, including undo/redo branches.
        /// Node identity and sharing are preserved within the clone.
        pub fn cloneRetained(
            self: *const Self,
            allocator: Allocator,
            temporary_allocator: Allocator,
            ctx: ?*anyopaque,
            clone_item: CloneItemFn,
        ) !Self {
            var nodes = std.AutoHashMap(*const Node, *const Node).init(temporary_allocator);
            defer nodes.deinit();
            var histories = std.AutoHashMap(*const UndoNode, *UndoNode).init(temporary_allocator);
            defer histories.deinit();

            const Cloner = struct {
                allocator: Allocator,
                nodes: *std.AutoHashMap(*const Node, *const Node),
                histories: *std.AutoHashMap(*const UndoNode, *UndoNode),
                ctx: ?*anyopaque,
                clone_item: CloneItemFn,

                fn node(cloner: *@This(), source: *const Node) !*const Node {
                    if (cloner.nodes.get(source)) |existing| return existing;
                    const target = try cloner.allocator.create(Node);
                    try cloner.nodes.put(source, target);
                    target.* = switch (source.*) {
                        .leaf => |leaf| .{ .leaf = .{
                            .data = try cloner.clone_item(cloner.ctx, &leaf.data),
                            .is_sentinel = leaf.is_sentinel,
                        } },
                        .branch => |tree_branch| .{ .branch = .{
                            .left = try cloner.node(tree_branch.left),
                            .right = try cloner.node(tree_branch.right),
                            .left_metrics = tree_branch.left_metrics,
                            .total_metrics = tree_branch.total_metrics,
                        } },
                    };
                    return target;
                }

                fn branch(cloner: *@This(), source: ?*UndoBranch) anyerror!?*UndoBranch {
                    const value = source orelse return null;
                    const target = try cloner.allocator.create(UndoBranch);
                    target.* = .{
                        .redo = try cloner.history(value.redo),
                        .next = try cloner.branch(value.next),
                    };
                    return target;
                }

                fn history(cloner: *@This(), source: *const UndoNode) anyerror!*UndoNode {
                    if (cloner.histories.get(source)) |existing| return existing;
                    const target = try cloner.allocator.create(UndoNode);
                    try cloner.histories.put(source, target);
                    target.* = .{
                        .root = try cloner.node(source.root),
                        .next = null,
                        .branches = null,
                        .meta = try cloner.allocator.dupe(u8, source.meta),
                        // Type-erased transaction journals are move-only. A
                        // retained Rope clone intentionally excludes them.
                        .payload = .{},
                    };
                    target.next = if (source.next) |next| try cloner.history(next) else null;
                    target.branches = try cloner.branch(source.branches);
                    return target;
                }

                fn optionalHistory(cloner: *@This(), source: ?*UndoNode) !?*UndoNode {
                    return if (source) |value| try cloner.history(value) else null;
                }
            };

            var cloner: Cloner = .{
                .allocator = allocator,
                .nodes = &nodes,
                .histories = &histories,
                .ctx = ctx,
                .clone_item = clone_item,
            };
            return .{
                .root = try cloner.node(self.root),
                .allocator = allocator,
                .empty_leaf = try cloner.node(self.empty_leaf),
                .undo_history = try cloner.optionalHistory(self.undo_history),
                .redo_history = try cloner.optionalHistory(self.redo_history),
                .curr_history = try cloner.optionalHistory(self.curr_history),
                .config = self.config,
                .undo_depth = self.undo_depth,
                .version = self.version,
                .marker_cache = MarkerCache.init(allocator),
            };
        }

        pub fn from_item(allocator: Allocator, data: T) !Self {
            return from_itemWithConfig(allocator, data, .{});
        }

        pub fn from_itemWithConfig(allocator: Allocator, data: T, config: Config) !Self {
            const root = try Node.new_leaf(allocator, data);
            const empty_data = if (@hasDecl(T, "empty"))
                T.empty()
            else
                std.mem.zeroes(T);

            const empty_node = try allocator.create(Node);
            empty_node.* = .{ .leaf = .{ .data = empty_data, .is_sentinel = true } };

            return .{
                .root = root,
                .allocator = allocator,
                .empty_leaf = empty_node,
                .config = config,
                .marker_cache = MarkerCache.init(allocator),
            };
        }

        pub fn from_slice(allocator: Allocator, items: []const T) !Self {
            return from_sliceWithConfig(allocator, items, .{});
        }

        pub fn from_sliceWithConfig(allocator: Allocator, items: []const T, config: Config) !Self {
            if (items.len == 0) {
                return try initWithConfig(allocator, config);
            }

            var leaves: std.ArrayListUnmanaged(*const Node) = .empty;
            defer leaves.deinit(allocator);
            try leaves.ensureTotalCapacity(allocator, items.len);

            for (items) |item| {
                const leaf = try Node.new_leaf(allocator, item);
                try leaves.append(allocator, leaf);
            }

            const root = try Node.merge_leaves(leaves.items, allocator);
            const empty_data = if (@hasDecl(T, "empty"))
                T.empty()
            else
                std.mem.zeroes(T);

            const empty_node = try allocator.create(Node);
            empty_node.* = .{ .leaf = .{ .data = empty_data, .is_sentinel = true } };

            return .{
                .root = root,
                .allocator = allocator,
                .empty_leaf = empty_node,
                .config = config,
                .marker_cache = MarkerCache.init(allocator),
            };
        }

        pub fn count(self: *const Self) u32 {
            return self.root.count();
        }

        pub fn get(self: *const Self, index: u32) ?*const T {
            return self.root.get(index);
        }

        /// Finds the Nth marker directly from subtree aggregates without
        /// rebuilding the whole marker cache.
        pub fn findMarker(self: *const Self, marker_type: std.meta.Tag(T), marker_index: u32) ?MarkerPosition {
            if (!marker_enabled) return null;
            var type_index: ?usize = null;
            inline for (T.MarkerTypes, 0..) |candidate, index| {
                if (marker_type == candidate) type_index = index;
            }
            return findMarkerInNode(self.root, type_index orelse return null, marker_index, 0, 0);
        }

        fn findMarkerInNode(node: *const Node, type_index: usize, marker_index: u32, leaves_before: u32, weight_before: u32) ?MarkerPosition {
            return switch (node.*) {
                .branch => |*branch| blk: {
                    const left_count = branch.left_metrics.marker_counts[type_index];
                    if (marker_index < left_count) {
                        break :blk findMarkerInNode(branch.left, type_index, marker_index, leaves_before, weight_before);
                    }
                    break :blk findMarkerInNode(
                        branch.right,
                        type_index,
                        marker_index - left_count,
                        leaves_before + branch.left_metrics.count,
                        weight_before + branch.left_metrics.weight(),
                    );
                },
                .leaf => |*leaf| if (!leaf.is_sentinel and leaf.metrics().marker_counts[type_index] != 0 and marker_index == 0)
                    .{ .leaf_index = leaves_before, .global_weight = weight_before }
                else
                    null,
            };
        }

        pub fn walk(self: *const Self, ctx: *anyopaque, f: Node.WalkerFn) !void {
            var index: u32 = 0;
            const result = self.walkNode(self.root, ctx, f, &index);
            if (result.err) |e| return e;
        }

        fn walkNode(self: *const Self, node: *const Node, ctx: *anyopaque, f: Node.WalkerFn, current_index: *u32) Node.WalkerResult {
            return switch (node.*) {
                .branch => |*b| {
                    const left_result = self.walkNode(b.left, ctx, f, current_index);
                    if (!left_result.keep_walking or left_result.err != null) {
                        return left_result;
                    }
                    return self.walkNode(b.right, ctx, f, current_index);
                },
                .leaf => |*l| {
                    if (node.count() == 0) {
                        return .{};
                    }
                    const result = f(ctx, &l.data, current_index.*);
                    current_index.* += 1;
                    return result;
                },
            };
        }

        pub fn walk_from(self: *const Self, start_index: u32, ctx: *anyopaque, f: Node.WalkerFn) !void {
            var current_index: u32 = 0;
            const result = self.walkFromNode(self.root, start_index, ctx, f, &current_index);
            if (result.err) |e| return e;
        }

        fn walkFromNode(self: *const Self, node: *const Node, start_index: u32, ctx: *anyopaque, f: Node.WalkerFn, current_index: *u32) Node.WalkerResult {
            return switch (node.*) {
                .branch => |*b| {
                    const left_count = b.left_metrics.count;
                    if (start_index >= left_count) {
                        return self.walkFromNode(b.right, start_index - left_count, ctx, f, current_index);
                    }

                    const left_result = self.walkFromNode(b.left, start_index, ctx, f, current_index);
                    if (!left_result.keep_walking or left_result.err != null) {
                        return left_result;
                    }
                    return self.walkNode(b.right, ctx, f, current_index);
                },
                .leaf => |*l| {
                    if (node.count() == 0) {
                        return .{};
                    }
                    if (start_index == 0) {
                        const result = f(ctx, &l.data, current_index.*);
                        current_index.* += 1;
                        return result;
                    }
                    return .{};
                },
            };
        }

        pub fn rebalance(self: *Self, tmp_allocator: Allocator) !void {
            self.root = try self.root.rebalance(self.allocator, tmp_allocator);
        }

        pub fn insert(self: *Self, index: u32, data: T) !void {
            try self.insert_slice(index, &[_]T{data});
        }

        pub fn delete(self: *Self, index: u32) !void {
            try self.delete_range(index, index + 1);
        }

        pub fn replace(self: *Self, index: u32, data: T) !void {
            if (index >= self.count()) return;

            try self.delete_range(index, index + 1);
            try self.insert_slice(index, &[_]T{data});
        }

        pub fn append(self: *Self, data: T) !void {
            try self.insert(self.count(), data);
        }

        pub fn prepend(self: *Self, data: T) !void {
            try self.insert(0, data);
        }

        pub fn concat(self: *Self, other: *const Self) !void {
            self.root = try self.joinWithBoundary(self.root, other.root);
            self.version += 1;
        }

        pub fn split(self: *Self, index: u32) !Self {
            const result = try Node.split_at(self.root, index, self.allocator, self.empty_leaf);
            self.root = result.left;
            self.version += 1;
            return Self{
                .root = result.right,
                .allocator = self.allocator,
                .empty_leaf = self.empty_leaf,
                .undo_history = null,
                .redo_history = null,
                .curr_history = null,
                .marker_cache = MarkerCache.init(self.allocator),
            };
        }

        pub fn slice(self: *const Self, start: u32, end: u32, allocator: Allocator) ![]T {
            if (start >= end) return &[_]T{};

            const SliceContext = struct {
                items: std.ArrayListUnmanaged(T),
                allocator: Allocator,
                start: u32,
                end: u32,
                current_index: u32 = 0,

                fn walker(ctx: *anyopaque, data: *const T, idx: u32) Node.WalkerResult {
                    _ = idx;
                    const context = @as(*@This(), @ptrCast(@alignCast(ctx)));
                    if (context.current_index >= context.start and context.current_index < context.end) {
                        context.items.append(context.allocator, data.*) catch |e| return .{ .err = e };
                    }
                    context.current_index += 1;
                    if (context.current_index >= context.end) {
                        return .{ .keep_walking = false };
                    }
                    return .{};
                }
            };

            var context = SliceContext{
                .items = .empty,
                .allocator = allocator,
                .start = start,
                .end = end,
            };
            errdefer context.items.deinit(allocator);

            try self.walk(&context, SliceContext.walker);
            return context.items.toOwnedSlice(allocator);
        }

        pub fn delete_range(self: *Self, start: u32, end: u32) !void {
            if (start >= end) return;

            const first_split = try Node.split_at(self.root, start, self.allocator, self.empty_leaf);
            const second_split = try Node.split_at(first_split.right, end - start, self.allocator, self.empty_leaf);

            self.root = try self.joinWithBoundary(first_split.left, second_split.right);

            self.version += 1;
            try self.applyEndsInvariant();
        }

        pub fn insert_slice(self: *Self, index: u32, items: []const T) !void {
            if (items.len == 0) return;

            const insert_rope = try Self.from_slice(self.allocator, items);

            const split_result = try Node.split_at(self.root, index, self.allocator, self.empty_leaf);

            const left_joined = try self.joinWithBoundary(split_result.left, insert_rope.root);
            self.root = try self.joinWithBoundary(left_joined, split_result.right);

            self.version += 1;
            try self.applyEndsInvariant();
        }

        pub fn to_array(self: *const Self, allocator: Allocator) ![]T {
            const ToArrayContext = struct {
                items: std.ArrayListUnmanaged(T),
                allocator: Allocator,

                fn walker(ctx: *anyopaque, data: *const T, idx: u32) Node.WalkerResult {
                    _ = idx;
                    const context = @as(*@This(), @ptrCast(@alignCast(ctx)));
                    context.items.append(context.allocator, data.*) catch |e| return .{ .err = e };
                    return .{};
                }
            };

            var context = ToArrayContext{
                .items = .empty,
                .allocator = allocator,
            };
            errdefer context.items.deinit(allocator);

            try self.walk(&context, ToArrayContext.walker);
            return context.items.toOwnedSlice(allocator);
        }

        pub fn toText(self: *const Self, allocator: Allocator) ![]u8 {
            var buffer: std.Io.Writer.Allocating = .init(allocator);
            defer buffer.deinit();

            try buffer.writer.writeAll("[root");
            try nodeToText(self.root, &buffer.writer);
            try buffer.writer.writeByte(']');

            return buffer.toOwnedSlice();
        }

        fn nodeToText(node: *const Node, writer: *std.Io.Writer) !void {
            switch (node.*) {
                .branch => |*b| {
                    try writer.writeAll("[branch");
                    try nodeToText(b.left, writer);
                    try nodeToText(b.right, writer);
                    try writer.writeByte(']');
                },
                .leaf => |*l| {
                    if (l.is_sentinel) {
                        try writer.writeAll("[empty]");
                        return;
                    }

                    if (@typeInfo(T) == .@"union") {
                        const tag = std.meta.activeTag(l.data);
                        const tag_name = @tagName(tag);

                        try writer.writeByte('[');
                        try writer.writeAll(tag_name);

                        if (@hasDecl(T, "Metrics")) {
                            const metrics = l.metrics();
                            try writer.writeByte(':');
                            try writer.print("w{d}", .{metrics.weight()});

                            if (@hasDecl(T.Metrics, "total_width")) {
                                try writer.print(",tw{d}", .{metrics.custom.total_width});
                            }
                            if (@hasDecl(T.Metrics, "total_bytes")) {
                                try writer.print(",b{d}", .{metrics.custom.total_bytes});
                            }
                        }

                        try writer.writeByte(']');
                    } else {
                        try writer.writeAll("[leaf");
                        if (@hasDecl(T, "Metrics")) {
                            const metrics = l.metrics();
                            try writer.writeByte(':');
                            try writer.print("w{d}", .{metrics.weight()});
                        }
                        try writer.writeByte(']');
                    }
                },
            }
        }

        pub fn totalWeight(self: *const Self) u32 {
            return self.root.metrics().weight();
        }

        pub fn splitByWeight(self: *Self, weight: u32, split_leaf_fn: *const Node.LeafSplitFn) !Self {
            const result = try Node.split_at_weight(self.root, weight, self.allocator, self.empty_leaf, split_leaf_fn);
            self.root = result.left;
            self.version += 1;
            return Self{
                .root = result.right,
                .allocator = self.allocator,
                .empty_leaf = self.empty_leaf,
                .undo_history = null,
                .redo_history = null,
                .curr_history = null,
                .marker_cache = MarkerCache.init(self.allocator),
            };
        }

        fn getLastLeaf(self: *const Self) ?*const T {
            if (self.count() == 0) return null;
            return self.get(self.count() - 1);
        }

        fn getFirstLeaf(self: *const Self) ?*const T {
            if (self.count() == 0) return null;
            return self.get(0);
        }

        fn getFirstLeafIn(node: *const Node) ?*const T {
            return switch (node.*) {
                .branch => |*b| getFirstLeafIn(b.left),
                .leaf => |*l| if (node.count() == 0) null else &l.data,
            };
        }

        fn getLastLeafIn(node: *const Node) ?*const T {
            return switch (node.*) {
                .branch => |*b| getLastLeafIn(b.right),
                .leaf => |*l| if (node.count() == 0) null else &l.data,
            };
        }

        fn dropFirst(node: *const Node, allocator: Allocator, empty_leaf: *const Node) error{OutOfMemory}!*const Node {
            if (node.count() == 0) return node;
            const split_result = try Node.split_at(node, 1, allocator, empty_leaf);
            return split_result.right;
        }

        fn dropLast(node: *const Node, allocator: Allocator, empty_leaf: *const Node) error{OutOfMemory}!*const Node {
            const cnt = node.count();
            if (cnt == 0) return node;
            const split_result = try Node.split_at(node, cnt - 1, allocator, empty_leaf);
            return split_result.left;
        }

        fn joinWithBoundary(self: *Self, left: *const Node, right: *const Node) error{OutOfMemory}!*const Node {
            if (!boundary_enabled or !@hasDecl(T, "rewriteBoundary")) {
                return try Node.join_balanced(left, right, self.allocator);
            }

            const l_last = getLastLeafIn(left);
            const r_first = getFirstLeafIn(right);

            if (@hasDecl(T, "canMerge") and @hasDecl(T, "merge")) {
                if (l_last != null and r_first != null) {
                    if (T.canMerge(l_last.?, r_first.?)) {
                        const merged = T.merge(self.allocator, l_last.?, r_first.?);
                        const merged_leaf = try Node.new_leaf(self.allocator, merged);

                        const L = try dropLast(left, self.allocator, self.empty_leaf);
                        const R = try dropFirst(right, self.allocator, self.empty_leaf);

                        const left_with_merged = try Node.join_balanced(L, merged_leaf, self.allocator);
                        return try Node.join_balanced(left_with_merged, R, self.allocator);
                    }
                }
            }

            const action = try T.rewriteBoundary(self.allocator, l_last, r_first);

            var L = left;
            var R = right;

            if (action.delete_left) {
                L = try dropLast(L, self.allocator, self.empty_leaf);
            }
            if (action.delete_right) {
                R = try dropFirst(R, self.allocator, self.empty_leaf);
            }

            if (action.insert_between.len > 0) {
                const insert_rope = try Self.from_slice(self.allocator, action.insert_between);
                const left_with_insert = try Node.join_balanced(L, insert_rope.root, self.allocator);
                return try Node.join_balanced(left_with_insert, R, self.allocator);
            }

            return try Node.join_balanced(L, R, self.allocator);
        }

        fn rootWithEndsInvariant(self: *Self, initial_root: *const Node) !*const Node {
            if (!boundary_enabled or !@hasDecl(T, "rewriteEnds")) return initial_root;

            var root = initial_root;
            const first = if (root.count() == 0) null else getFirstLeafIn(root);
            const last = if (root.count() == 0) null else getLastLeafIn(root);
            const action = try T.rewriteEnds(self.allocator, first, last);

            // Handle deletion operations first
            if (action.delete_left and root.count() > 0) {
                const split_result = try Node.split_at(root, 1, self.allocator, self.empty_leaf);
                root = split_result.right;
            }
            if (action.delete_right and root.count() > 0) {
                const cnt = root.count();
                const split_result = try Node.split_at(root, cnt - 1, self.allocator, self.empty_leaf);
                root = split_result.left;
            }

            // Handle insertion
            if (action.insert_between.len > 0) {
                var leaves: std.ArrayListUnmanaged(*const Node) = .empty;
                defer leaves.deinit(self.allocator);
                try leaves.ensureTotalCapacity(self.allocator, action.insert_between.len);

                for (action.insert_between) |item| {
                    const leaf = try Node.new_leaf(self.allocator, item);
                    try leaves.append(self.allocator, leaf);
                }

                const insert_root = try Node.merge_leaves(leaves.items, self.allocator);
                root = try Node.join_balanced(insert_root, root, self.allocator);
            }

            return root;
        }

        fn applyEndsInvariant(self: *Self) !void {
            self.root = try self.rootWithEndsInvariant(self.root);
        }

        pub fn deleteRangeByWeight(self: *Self, start: u32, end: u32, split_leaf_fn: *const Node.LeafSplitFn) !void {
            if (start >= end) return;

            const first_split = try Node.split_at_weight(self.root, start, self.allocator, self.empty_leaf, split_leaf_fn);
            const second_split = try Node.split_at_weight(first_split.right, end - start, self.allocator, self.empty_leaf, split_leaf_fn);

            self.root = try self.joinWithBoundary(first_split.left, second_split.right);

            self.version += 1;
            try self.applyEndsInvariant();
        }

        pub fn insertSliceByWeight(self: *Self, weight: u32, items: []const T, split_leaf_fn: *const Node.LeafSplitFn) !void {
            if (items.len == 0) return;

            const insert_rope = try Self.from_slice(self.allocator, items);

            const split_result = try Node.split_at_weight(self.root, weight, self.allocator, self.empty_leaf, split_leaf_fn);

            const left_joined = try self.joinWithBoundary(split_result.left, insert_rope.root);
            self.root = try self.joinWithBoundary(left_joined, split_result.right);

            self.version += 1;
            try self.applyEndsInvariant();
        }

        /// Atomically replace a weighted range. The published root and version are
        /// unchanged if any split, join, or invariant allocation fails.
        pub fn replaceRangeByWeight(self: *Self, start: u32, end: u32, items: []const T, split_leaf_fn: *const Node.LeafSplitFn) !void {
            const total_weight = self.totalWeight();
            if (start > end or end > total_weight) return error.OutOfBounds;
            if (start == end and items.len == 0) return;

            const first_split = try Node.split_at_weight(self.root, start, self.allocator, self.empty_leaf, split_leaf_fn);
            const second_split = try Node.split_at_weight(first_split.right, end - start, self.allocator, self.empty_leaf, split_leaf_fn);

            var next_root = first_split.left;
            if (items.len > 0) {
                const insert_rope = try Self.from_slice(self.allocator, items);
                next_root = try self.joinWithBoundary(next_root, insert_rope.root);
            }
            next_root = try self.joinWithBoundary(next_root, second_split.right);
            next_root = try self.rootWithEndsInvariant(next_root);

            self.root = next_root;
            self.version += 1;
        }

        pub const PreparedRoot = struct {
            root: *const Node,
        };

        /// Build a replacement root without publishing it. Failed preparation may
        /// consume arena storage but cannot change the logical rope or its version.
        pub fn prepareReplaceRangeByMetric(
            self: *Self,
            start: u32,
            end: u32,
            items: []const T,
            splitter: *const Node.MetricSplitFn,
        ) error{ OutOfMemory, OutOfBounds }!PreparedRoot {
            const total = splitter.metric(self.root.metrics());
            if (start > end or end > total) return error.OutOfBounds;

            const first = try Node.split_at_metric(self.root, start, self.allocator, self.empty_leaf, splitter);
            const second = try Node.split_at_metric(first.right, end - start, self.allocator, self.empty_leaf, splitter);

            var next_root = first.left;
            if (items.len > 0) {
                const insert_rope = try Self.from_slice(self.allocator, items);
                next_root = try self.joinWithBoundary(next_root, insert_rope.root);
            }
            next_root = try self.joinWithBoundary(next_root, second.right);
            next_root = try self.rootWithEndsInvariant(next_root);
            return .{ .root = next_root };
        }

        /// Build a root with `[start, start + len)` moved to `destination`, where
        /// destination is measured after removing the source. Existing subtrees
        /// are retained; only split and join paths are allocated.
        pub fn prepareMoveRegionByMetric(
            self: *Self,
            start: u32,
            len: u32,
            destination: u32,
            splitter: *const Node.MetricSplitFn,
        ) error{ OutOfMemory, OutOfBounds }!PreparedRoot {
            const total = splitter.metric(self.root.metrics());
            const end = std.math.add(u32, start, len) catch return error.OutOfBounds;
            if (end > total or destination > total - len) return error.OutOfBounds;
            if (len == 0 or destination == start) return .{ .root = self.root };

            const source_start = try Node.split_at_metric(self.root, start, self.allocator, self.empty_leaf, splitter);
            const source_end = try Node.split_at_metric(source_start.right, len, self.allocator, self.empty_leaf, splitter);
            const without_source = try self.joinWithBoundary(source_start.left, source_end.right);
            const insertion = try Node.split_at_metric(without_source, destination, self.allocator, self.empty_leaf, splitter);
            var next_root = try self.joinWithBoundary(insertion.left, source_end.left);
            next_root = try self.joinWithBoundary(next_root, insertion.right);
            next_root = try self.rootWithEndsInvariant(next_root);
            return .{ .root = next_root };
        }

        pub fn commitPreparedRoot(self: *Self, prepared: PreparedRoot) void {
            self.root = prepared.root;
            self.version += 1;
        }

        pub const WeightFindResult = struct { leaf: *const T, start_weight: u32 };

        pub fn findByWeight(self: *const Self, weight: u32) ?WeightFindResult {
            return self.findByWeightInNode(self.root, weight, 0);
        }

        fn findByWeightInNode(self: *const Self, node: *const Node, target_weight: u32, current_weight: u32) ?WeightFindResult {
            return switch (node.*) {
                .branch => |*b| {
                    const left_weight = b.left_metrics.weight();
                    if (target_weight < current_weight + left_weight) {
                        return self.findByWeightInNode(b.left, target_weight, current_weight);
                    }
                    return self.findByWeightInNode(b.right, target_weight, current_weight + left_weight);
                },
                .leaf => |*l| {
                    const leaf_weight = node.metrics().weight();
                    if (target_weight < current_weight + leaf_weight) {
                        return .{ .leaf = &l.data, .start_weight = current_weight };
                    }
                    return null;
                },
            };
        }

        /// Undo/Redo operations
        pub const PreparedUndo = struct {
            owner: *Self,
            undo_node: *UndoNode,
            branch: ?*UndoBranch,
            expected_undo: ?*UndoNode,
            expected_redo: ?*UndoNode,
            expected_current: ?*UndoNode,
            committed: bool = false,

            pub fn deinit(self: *PreparedUndo) void {
                if (!self.committed) {
                    if (self.branch) |branch| self.owner.allocator.destroy(branch);
                    self.owner.destroyHistoryNode(self.undo_node);
                }
                self.* = undefined;
            }

            pub fn setPayload(self: *PreparedUndo, payload: HistoryPayload) void {
                std.debug.assert(!self.committed and self.undo_node.payload.ptr == null);
                self.undo_node.payload = payload;
            }
        };

        pub fn prepare_store_undo(self: *Self, meta: []const u8) !PreparedUndo {
            const undo_node = try self.create_undo_node(self.root, meta);
            errdefer {
                self.allocator.free(@constCast(undo_node.meta));
                self.allocator.destroy(undo_node);
            }
            return .{
                .owner = self,
                .undo_node = undo_node,
                .branch = null,
                .expected_undo = self.undo_history,
                .expected_redo = self.redo_history,
                .expected_current = self.curr_history,
            };
        }

        pub fn commit_store_undo(self: *Self, prepared: *PreparedUndo) void {
            std.debug.assert(prepared.owner == self and !prepared.committed);
            std.debug.assert(self.undo_history == prepared.expected_undo);
            std.debug.assert(self.redo_history == prepared.expected_redo);
            std.debug.assert(self.curr_history == prepared.expected_current);
            self.destroyHistory(self.redo_history);
            self.destroyHistory(self.curr_history);
            self.push_undo(prepared.undo_node);
            self.curr_history = null;
            self.redo_history = null;
            prepared.committed = true;
        }

        pub fn store_undo(self: *Self, meta: []const u8) !void {
            var prepared = try self.prepare_store_undo(meta);
            defer prepared.deinit();
            self.commit_store_undo(&prepared);
        }

        fn create_undo_node(self: *const Self, root: *const Node, meta_: []const u8) !*UndoNode {
            const undo_node = try self.allocator.create(UndoNode);
            errdefer self.allocator.destroy(undo_node);
            const meta = try self.allocator.dupe(u8, meta_);
            undo_node.* = UndoNode{
                .root = root,
                .meta = meta,
            };
            return undo_node;
        }

        fn destroyHistoryNode(self: *Self, node: *UndoNode) void {
            node.payload.deinit();
            self.allocator.free(@constCast(node.meta));
            self.allocator.destroy(node);
        }

        fn destroyHistory(self: *Self, first: ?*UndoNode) void {
            var current = first;
            while (current) |node| {
                const next = node.next;
                node.next = null;
                self.destroyHistoryNode(node);
                current = next;
            }
        }

        fn push_undo(self: *Self, undo_node: *UndoNode) void {
            const next = self.undo_history;
            self.undo_history = undo_node;
            undo_node.next = next;
            self.undo_depth += 1;

            // Trim history if we exceed max_undo_depth
            if (self.config.max_undo_depth) |max_depth| {
                if (self.undo_depth > max_depth) {
                    self.trimUndoHistory(max_depth);
                }
            }
        }

        fn trimUndoHistory(self: *Self, max_depth: usize) void {
            if (max_depth == 0) {
                self.destroyHistory(self.undo_history);
                self.undo_history = null;
                self.undo_depth = 0;
                return;
            }
            var current = self.undo_history;
            var depth_count: usize = 0;

            while (current) |node| {
                depth_count += 1;
                if (depth_count == max_depth) {
                    const removed = node.next;
                    node.next = null;
                    self.destroyHistory(removed);
                    self.undo_depth = max_depth;
                    return;
                }
                current = node.next;
            }
            self.undo_depth = depth_count;
        }

        pub fn setMaxUndoDepth(self: *Self, max_depth: ?usize) void {
            self.config.max_undo_depth = max_depth;
            if (max_depth) |depth| {
                if (depth == 0) {
                    self.clear_history();
                } else {
                    if (self.undo_depth > depth) self.trimUndoHistory(depth);
                    self.trimRedoHistory(depth);
                }
            }
        }

        fn trimRedoHistory(self: *Self, max_depth: usize) void {
            var current = self.redo_history;
            var depth: usize = 0;
            while (current) |node| {
                depth += 1;
                if (depth == max_depth) {
                    const removed = node.next;
                    node.next = null;
                    self.destroyHistory(removed);
                    return;
                }
                current = node.next;
            }
        }

        pub fn undoDepth(self: *const Self) usize {
            return self.undo_depth;
        }

        pub fn redoDepth(self: *const Self) usize {
            var current = self.redo_history;
            var depth: usize = 0;
            while (current) |node| : (current = node.next) depth += 1;
            return depth;
        }

        pub fn getMaxUndoDepth(self: *const Self) ?usize {
            return self.config.max_undo_depth;
        }

        fn push_redo(self: *Self, undo_node: *UndoNode) void {
            const next = self.redo_history;
            self.redo_history = undo_node;
            undo_node.next = next;
        }

        pub fn undo(self: *Self, meta: []const u8) ![]const u8 {
            var prepared = try self.prepareUndo(meta);
            defer prepared.deinit();
            return self.commitUndo(&prepared);
        }

        pub const PreparedUndoMove = struct {
            owner: *Self,
            current: *UndoNode,
            previous: *UndoNode,
            current_owned: bool,
            expected_undo: ?*UndoNode,
            expected_redo: ?*UndoNode,
            expected_current: ?*UndoNode,
            committed: bool = false,

            pub fn deinit(self: *PreparedUndoMove) void {
                if (!self.committed and self.current_owned) {
                    self.owner.destroyHistoryNode(self.current);
                }
                self.* = undefined;
            }
        };

        pub fn prepareUndo(self: *Self, meta: []const u8) !PreparedUndoMove {
            const h = self.undo_history orelse return error.Stop;
            const current_owned = self.curr_history == null;
            const current = self.curr_history orelse try self.create_undo_node(self.root, meta);
            return .{
                .owner = self,
                .current = current,
                .previous = h,
                .current_owned = current_owned,
                .expected_undo = self.undo_history,
                .expected_redo = self.redo_history,
                .expected_current = self.curr_history,
            };
        }

        pub fn commitUndo(self: *Self, prepared: *PreparedUndoMove) []const u8 {
            std.debug.assert(prepared.owner == self and !prepared.committed);
            std.debug.assert(self.undo_history == prepared.expected_undo);
            std.debug.assert(self.redo_history == prepared.expected_redo);
            std.debug.assert(self.curr_history == prepared.expected_current);
            const r = prepared.current;
            const h = prepared.previous;
            self.undo_history = h.next;
            h.next = null;
            self.curr_history = h;
            self.root = h.root;
            self.version += 1;
            self.push_redo(r);
            if (self.undo_depth > 0) self.undo_depth -= 1;
            prepared.committed = true;
            return h.meta;
        }

        pub fn redo(self: *Self) ![]const u8 {
            const u = self.curr_history orelse return error.Stop;
            const h = self.redo_history orelse return error.Stop;
            if (u.root != self.root) return error.Stop;
            self.redo_history = h.next;
            h.next = null;
            self.curr_history = h;
            self.root = h.root;
            self.version += 1;
            self.push_undo(u);
            return h.meta;
        }

        pub fn can_undo(self: *const Self) bool {
            return self.undo_history != null;
        }

        pub fn can_redo(self: *const Self) bool {
            return self.redo_history != null and self.curr_history != null;
        }

        pub fn has_history(self: *const Self) bool {
            return self.undo_history != null or self.redo_history != null or self.curr_history != null;
        }

        pub fn undoPayload(self: *Self) ?*anyopaque {
            return if (self.undo_history) |node| node.payload.ptr else null;
        }

        pub fn currentPayload(self: *Self) ?*anyopaque {
            return if (self.curr_history) |node| node.payload.ptr else null;
        }

        pub const HistoryPayloadVisitor = *const fn (ctx: *anyopaque, payload: *anyopaque) void;

        pub fn walkHistoryPayloads(self: *Self, ctx: *anyopaque, visitor: HistoryPayloadVisitor) void {
            walkPayloads(self.undo_history, ctx, visitor);
            walkPayloads(self.redo_history, ctx, visitor);
            walkPayloads(self.curr_history, ctx, visitor);
        }

        fn walkPayloads(first: ?*UndoNode, ctx: *anyopaque, visitor: HistoryPayloadVisitor) void {
            var current = first;
            while (current) |node| : (current = node.next) if (node.payload.ptr) |payload| visitor(ctx, payload);
        }

        /// Transfers move-only payload ownership after cloneRetained succeeds.
        pub fn moveHistoryPayloadsTo(self: *Self, target: *Self) void {
            movePayloadList(self.undo_history, target.undo_history);
            movePayloadList(self.redo_history, target.redo_history);
            movePayloadList(self.curr_history, target.curr_history);
        }

        fn movePayloadList(source_first: ?*UndoNode, target_first: ?*UndoNode) void {
            var source = source_first;
            var target = target_first;
            while (source) |source_node| {
                const target_node = target orelse unreachable;
                target_node.payload = source_node.payload.take();
                movePayloadBranches(source_node.branches, target_node.branches);
                source = source_node.next;
                target = target_node.next;
            }
            std.debug.assert(target == null);
        }

        fn movePayloadBranches(source_first: ?*UndoBranch, target_first: ?*UndoBranch) void {
            var source = source_first;
            var target = target_first;
            while (source) |source_branch| {
                const target_branch = target orelse unreachable;
                movePayloadList(source_branch.redo, target_branch.redo);
                source = source_branch.next;
                target = target_branch.next;
            }
            std.debug.assert(target == null);
        }

        pub fn clear_history(self: *Self) void {
            self.destroyHistory(self.undo_history);
            self.destroyHistory(self.redo_history);
            self.destroyHistory(self.curr_history);
            self.undo_history = null;
            self.redo_history = null;
            self.curr_history = null;
            self.undo_depth = 0;
        }

        pub fn clear(self: *Self) void {
            self.root = self.empty_leaf;
            self.version += 1;
            self.applyEndsInvariant() catch {};
        }

        pub fn clearToPreallocatedRoot(self: *Self, empty_root: *const Node, empty_leaf: *const Node) void {
            self.root = empty_root;
            self.empty_leaf = empty_leaf;
            self.version += 1;
        }

        /// Replace the rope content with new items, using same structure as from_slice
        /// This is useful for repeated setText operations without creating a new rope instance
        pub fn setSegments(self: *Self, items: []const T) !void {
            if (items.len == 0) {
                self.root = self.empty_leaf;
                self.version += 1;
                try self.applyEndsInvariant();
                return;
            }

            var leaves: std.ArrayListUnmanaged(*const Node) = .empty;
            defer leaves.deinit(self.allocator);
            try leaves.ensureTotalCapacity(self.allocator, items.len);

            for (items) |item| {
                const leaf = try Node.new_leaf(self.allocator, item);
                try leaves.append(self.allocator, leaf);
            }

            self.root = try Node.merge_leaves(leaves.items, self.allocator);
            self.version += 1;
        }

        fn rebuildMarkerCache(self: *Self) !void {
            if (!marker_enabled) return;

            self.marker_cache.clear();

            const RebuildContext = struct {
                cache: *MarkerCache,
                current_leaf: u32 = 0,
                current_weight: u32 = 0,

                fn walker(ctx: *anyopaque, data: *const T, idx: u32) Node.WalkerResult {
                    _ = idx;
                    const context = @as(*@This(), @ptrCast(@alignCast(ctx)));

                    const tag = std.meta.activeTag(data.*);

                    var is_marker = false;
                    inline for (T.MarkerTypes) |mt| {
                        if (tag == mt) {
                            is_marker = true;
                            break;
                        }
                    }

                    const leaf_weight = if (@hasDecl(T, "Metrics")) blk: {
                        if (@hasDecl(T, "measure")) {
                            const metrics = data.measure();
                            break :blk if (@hasDecl(T.Metrics, "weight")) metrics.weight() else 1;
                        }
                        break :blk 1;
                    } else 1;

                    if (is_marker) {
                        const gop = context.cache.positions.getOrPut(tag) catch |e| {
                            return .{ .keep_walking = false, .err = e };
                        };
                        if (!gop.found_existing) {
                            gop.value_ptr.* = .empty;
                        }

                        gop.value_ptr.append(context.cache.allocator, .{
                            .leaf_index = context.current_leaf,
                            .global_weight = context.current_weight,
                        }) catch |e| {
                            return .{ .keep_walking = false, .err = e };
                        };
                    }

                    context.current_leaf += 1;
                    context.current_weight +|= leaf_weight;
                    return .{};
                }
            };

            var ctx = RebuildContext{ .cache = &self.marker_cache };
            try self.walk(&ctx, RebuildContext.walker);

            self.marker_cache.version = self.version;
        }

        pub fn markerCount(self: *const Self, tag: std.meta.Tag(T)) u32 {
            const owner = @constCast(self);
            if (!marker_enabled) return 0;

            if (self.marker_cache.version != self.version) {
                owner.rebuildMarkerCache() catch return 0;
            }

            const list = self.marker_cache.positions.get(tag) orelse return 0;
            return @intCast(list.items.len);
        }

        pub fn getMarker(self: *const Self, tag: std.meta.Tag(T), occurrence: u32) ?MarkerPosition {
            const owner = @constCast(self);
            if (!marker_enabled) return null;

            if (self.marker_cache.version != self.version) {
                owner.rebuildMarkerCache() catch return null;
            }

            const list = self.marker_cache.positions.get(tag) orelse return null;
            if (occurrence >= list.items.len) return null;
            return list.items[occurrence];
        }
    };
}
