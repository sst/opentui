const std = @import("std");
const Allocator = std.mem.Allocator;

/// Generic rope data structure that can be nested
/// T is the leaf data type (e.g., Chunk, Line, etc.)
///
/// This is a persistent/immutable rope - operations create new nodes without
/// freeing old ones. Use an ArenaAllocator to avoid manual memory management:
///
///   var arena = std.heap.ArenaAllocator.init(allocator);
///   defer arena.deinit();
///   var rope = try Rope(T).init(arena.allocator());
///
pub fn Rope(comptime T: type) type {
    return struct {
        const Self = @This();

        pub const max_imbalance = 7;

        /// Configuration for rope behavior
        pub const Config = struct {
            max_undo_depth: ?usize = null, // null = unlimited
        };

        /// Metrics tracked by the rope
        pub const Metrics = struct {
            count: u32 = 0, // Number of items (leaves) - default 0, leaves set to 1
            depth: u32 = 1, // Tree depth

            // T can provide additional metrics via measure() function
            custom: if (@hasDecl(T, "Metrics")) T.Metrics else void = if (@hasDecl(T, "Metrics")) .{} else {},

            pub fn add(self: *Metrics, other: Metrics) void {
                self.count += other.count;
                self.depth = @max(self.depth, other.depth);

                if (@hasDecl(T, "Metrics")) {
                    if (@hasDecl(T.Metrics, "add")) {
                        self.custom.add(other.custom);
                    }
                }
            }

            /// Get balancing weight - uses T.Metrics.weight() if available, else falls back to count
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
            left_metrics: Metrics, // Metrics of left subtree
            total_metrics: Metrics, // Total metrics of this subtree

            fn is_balanced(self: *const Branch) bool {
                // Balance on weight (size/bytes) if available, else depth
                const left_weight = self.left.metrics().weight();
                const right_weight = self.right.metrics().weight();
                const total_weight = left_weight + right_weight;

                if (total_weight == 0) return true;

                // Ensure neither side is more than 75% of total (3:1 ratio)
                const max_side = (total_weight * 3) / 4;
                return left_weight <= max_side and right_weight <= max_side;
            }
        };

        pub const Leaf = struct {
            data: T,

            fn metrics(self: *const Leaf) Metrics {
                var m = Metrics{
                    .count = 1, // Leaves count as 1 item
                    .depth = 1,
                };

                // Allow T to provide custom metrics
                if (@hasDecl(T, "Metrics")) {
                    if (@hasDecl(T, "measure")) {
                        m.custom = self.data.measure();
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

            /// Check if this node is the sentinel empty leaf (by pointer equality)
            pub fn is_sentinel(self: *const Node, empty_leaf: *const Node) bool {
                return self == empty_leaf;
            }

            /// Create a new branch node
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

            /// Create a new leaf node
            pub fn new_leaf(allocator: Allocator, data: T) !*const Node {
                const node = try allocator.create(Node);
                errdefer allocator.destroy(node);

                node.* = .{ .leaf = .{ .data = data } };
                return node;
            }

            /// Get leaf data at index
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

            /// Walker callback type
            pub const WalkerFn = *const fn (ctx: *anyopaque, data: *const T, index: u32) WalkerResult;

            pub const WalkerResult = struct {
                keep_walking: bool = true,
                err: ?anyerror = null,
            };

            /// Walk all leaves in order
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

            /// Walk from a specific index
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

            /// Collect all leaves into an array
            fn collect(self: *const Node, list: *std.ArrayList(*const Node)) !void {
                switch (self.*) {
                    .branch => |*b| {
                        try b.left.collect(list);
                        try b.right.collect(list);
                    },
                    .leaf => try list.append(self),
                }
            }

            /// Merge leaves into a balanced tree
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

            /// Rebalance the tree if needed
            pub fn rebalance(self: *const Node, allocator: Allocator, tmp_allocator: Allocator) !*const Node {
                if (self.is_balanced()) return self;

                var leaves = std.ArrayList(*const Node).init(tmp_allocator);
                defer leaves.deinit();

                try leaves.ensureTotalCapacity(self.count());
                try self.collect(&leaves);

                return try merge_leaves(leaves.items, allocator);
            }

            /// Structural split at index - returns (left, right) without flattening
            /// O(log n) operation that reuses subtrees
            pub fn split_at(node: *const Node, index: u32, allocator: Allocator, empty_leaf: *const Node) error{OutOfMemory}!struct { left: *const Node, right: *const Node } {
                return switch (node.*) {
                    .leaf => {
                        // At leaf level, split is trivial
                        if (index == 0) {
                            return .{ .left = empty_leaf, .right = node };
                        } else {
                            return .{ .left = node, .right = empty_leaf };
                        }
                    },
                    .branch => |*b| {
                        const left_count = b.left_metrics.count;
                        if (index < left_count) {
                            // Split point is in left subtree
                            const result = try split_at(b.left, index, allocator, empty_leaf);
                            const new_right = try join_balanced(result.right, b.right, allocator);
                            return .{ .left = result.left, .right = new_right };
                        } else if (index > left_count) {
                            // Split point is in right subtree
                            const result = try split_at(b.right, index - left_count, allocator, empty_leaf);
                            const new_left = try join_balanced(b.left, result.left, allocator);
                            return .{ .left = new_left, .right = result.right };
                        } else {
                            // Split point is exactly at the boundary
                            return .{ .left = b.left, .right = b.right };
                        }
                    },
                };
            }

            /// Weight-aware join that maintains balance
            /// O(log |weight difference|) operation
            /// Balances on weight (bytes/chars) if T provides weight(), else on count
            pub fn join_balanced(left: *const Node, right: *const Node, allocator: Allocator) error{OutOfMemory}!*const Node {
                const left_weight = left.metrics().weight();
                const right_weight = right.metrics().weight();
                const total_weight = left_weight + right_weight;

                // If weights are balanced (neither side > 75%), just create a branch
                if (total_weight > 0) {
                    const max_side = (total_weight * 3) / 4;
                    if (left_weight <= max_side and right_weight <= max_side) {
                        return try new_branch(allocator, left, right);
                    }
                }

                // If left is much heavier, attach right to a node deep in left's right spine
                if (left_weight > right_weight * 3) {
                    return switch (left.*) {
                        .leaf => try new_branch(allocator, left, right), // shouldn't happen but handle it
                        .branch => |*b| {
                            const new_right = try join_balanced(b.right, right, allocator);
                            return try new_branch(allocator, b.left, new_right);
                        },
                    };
                }

                // If right is much heavier, attach left to a node deep in right's left spine
                return switch (right.*) {
                    .leaf => try new_branch(allocator, left, right), // shouldn't happen but handle it
                    .branch => |*b| {
                        const new_left = try join_balanced(left, b.left, allocator);
                        return try new_branch(allocator, new_left, b.right);
                    },
                };
            }

            /// Result type for leaf splitting operations
            pub const LeafSplitResult = struct { left: T, right: T };

            /// Leaf-splitting callback for weight-based splits
            /// Supports optional context for accessing external data during splits
            pub const LeafSplitFn = struct {
                ctx: ?*anyopaque = null,
                splitFn: *const fn (ctx: ?*anyopaque, allocator: Allocator, leaf: *const T, weight_in_leaf: u32) error{ OutOfBounds, OutOfMemory }!LeafSplitResult,

                pub fn call(self: *const @This(), allocator: Allocator, leaf: *const T, weight: u32) error{ OutOfBounds, OutOfMemory }!LeafSplitResult {
                    return self.splitFn(self.ctx, allocator, leaf, weight);
                }
            };

            /// Structural split at weight - returns (left, right) without flattening
            /// O(log n) operation that reuses subtrees
            /// When split point falls inside a leaf, calls split_leaf_fn callback to split the data
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

                        // Boundary cases: split before or after this leaf
                        if (target_weight == 0) {
                            return .{ .left = empty_leaf, .right = node };
                        } else if (target_weight >= leaf_weight) {
                            return .{ .left = node, .right = empty_leaf };
                        }

                        // Split inside the leaf using callback
                        const split_result = try split_leaf_fn.call(allocator, &l.data, target_weight);
                        const left_node = try new_leaf(allocator, split_result.left);
                        const right_node = try new_leaf(allocator, split_result.right);
                        return .{ .left = left_node, .right = right_node };
                    },
                    .branch => |*b| {
                        const left_weight = b.left_metrics.weight();

                        if (target_weight < left_weight) {
                            // Split point is in left subtree
                            const result = try split_at_weight(b.left, target_weight, allocator, empty_leaf, split_leaf_fn);
                            const new_right = try join_balanced(result.right, b.right, allocator);
                            return .{ .left = result.left, .right = new_right };
                        } else if (target_weight > left_weight) {
                            // Split point is in right subtree
                            const result = try split_at_weight(b.right, target_weight - left_weight, allocator, empty_leaf, split_leaf_fn);
                            const new_left = try join_balanced(b.left, result.left, allocator);
                            return .{ .left = new_left, .right = result.right };
                        } else {
                            // Split point is exactly at the boundary
                            return .{ .left = b.left, .right = b.right };
                        }
                    },
                };
            }
        };

        pub const UndoNode = struct {
            root: *const Node,
            next: ?*UndoNode = null,
            branches: ?*UndoBranch = null,
            meta: []const u8,
        };

        pub const UndoBranch = struct {
            redo: *UndoNode,
            next: ?*UndoBranch,
        };

        /// The rope handle
        root: *const Node,
        allocator: Allocator,
        empty_leaf: *const Node, // Shared empty leaf for structural operations
        undo_history: ?*UndoNode = null,
        redo_history: ?*UndoNode = null,
        curr_history: ?*UndoNode = null,
        config: Config = .{},
        undo_depth: usize = 0, // Current undo stack depth

        pub fn init(allocator: Allocator) !Self {
            return initWithConfig(allocator, .{});
        }

        pub fn initWithConfig(allocator: Allocator, config: Config) !Self {
            // Create empty root - if T has an empty() function, use it
            const empty_data = if (@hasDecl(T, "empty"))
                T.empty()
            else
                std.mem.zeroes(T);

            // Use same empty_leaf for both root and split operations
            // This allows sentinel filtering to work correctly
            const empty_leaf = try Node.new_leaf(allocator, empty_data);
            return .{
                .root = empty_leaf,
                .allocator = allocator,
                .empty_leaf = empty_leaf,
                .config = config,
            };
        }

        /// Create from a single item
        pub fn from_item(allocator: Allocator, data: T) !Self {
            const root = try Node.new_leaf(allocator, data);
            const empty_data = if (@hasDecl(T, "empty"))
                T.empty()
            else
                std.mem.zeroes(T);
            const empty_leaf = try Node.new_leaf(allocator, empty_data);
            return .{
                .root = root,
                .allocator = allocator,
                .empty_leaf = empty_leaf,
            };
        }

        /// Create from a slice of items
        pub fn from_slice(allocator: Allocator, items: []const T) !Self {
            if (items.len == 0) {
                return try init(allocator);
            }

            var leaves = try std.ArrayList(*const Node).initCapacity(allocator, items.len);
            defer leaves.deinit();

            for (items) |item| {
                const leaf = try Node.new_leaf(allocator, item);
                try leaves.append(leaf);
            }

            const root = try Node.merge_leaves(leaves.items, allocator);
            const empty_data = if (@hasDecl(T, "empty"))
                T.empty()
            else
                std.mem.zeroes(T);
            const empty_leaf = try Node.new_leaf(allocator, empty_data);
            return .{
                .root = root,
                .allocator = allocator,
                .empty_leaf = empty_leaf,
            };
        }

        pub fn count(self: *const Self) u32 {
            return self.countExcludingSentinel();
        }

        /// Count items excluding sentinel empties
        fn countExcludingSentinel(self: *const Self) u32 {
            return self.countNodeExcludingSentinel(self.root);
        }

        fn countNodeExcludingSentinel(self: *const Self, node: *const Node) u32 {
            if (node.is_sentinel(self.empty_leaf)) {
                return 0;
            }

            return switch (node.*) {
                .branch => |*b| {
                    return self.countNodeExcludingSentinel(b.left) +
                        self.countNodeExcludingSentinel(b.right);
                },
                .leaf => 1,
            };
        }

        pub fn get(self: *const Self, index: u32) ?*const T {
            return self.getFromNode(self.root, index);
        }

        fn getFromNode(self: *const Self, node: *const Node, index: u32) ?*const T {
            // Skip sentinel empties
            if (node.is_sentinel(self.empty_leaf)) {
                return null;
            }

            return switch (node.*) {
                .branch => |*b| {
                    const left_count = self.countNodeExcludingSentinel(b.left);
                    if (index < left_count) {
                        return self.getFromNode(b.left, index);
                    }
                    return self.getFromNode(b.right, index - left_count);
                },
                .leaf => |*l| if (index == 0) &l.data else null,
            };
        }

        pub fn walk(self: *const Self, ctx: *anyopaque, f: Node.WalkerFn) !void {
            var index: u32 = 0;
            const result = self.walkNode(self.root, ctx, f, &index);
            if (result.err) |e| return e;
        }

        fn walkNode(self: *const Self, node: *const Node, ctx: *anyopaque, f: Node.WalkerFn, current_index: *u32) Node.WalkerResult {
            // Skip sentinel empties
            if (node.is_sentinel(self.empty_leaf)) {
                return .{};
            }

            return switch (node.*) {
                .branch => |*b| {
                    const left_result = self.walkNode(b.left, ctx, f, current_index);
                    if (!left_result.keep_walking or left_result.err != null) {
                        return left_result;
                    }
                    return self.walkNode(b.right, ctx, f, current_index);
                },
                .leaf => |*l| {
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
            // Skip sentinel empties
            if (node.is_sentinel(self.empty_leaf)) {
                return .{};
            }

            return switch (node.*) {
                .branch => |*b| {
                    const left_count = self.countNodeExcludingSentinel(b.left);
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

        /// Insert item at index
        /// Uses structural split/join for O(log n) performance with auto-balancing
        pub fn insert(self: *Self, index: u32, data: T) !void {
            try self.insert_slice(index, &[_]T{data});
        }

        /// Delete item at index
        /// Uses structural split/join for O(log n) performance with auto-balancing
        pub fn delete(self: *Self, index: u32) !void {
            try self.delete_range(index, index + 1);
        }

        pub fn replace(self: *Self, index: u32, data: T) !void {
            // Check bounds
            if (index >= self.count()) return;

            // Efficient replace via delete + insert using structural operations
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
            // Filter empty sentinels during concat
            if (self.root.is_sentinel(self.empty_leaf)) {
                self.root = other.root;
            } else if (other.root.is_sentinel(other.empty_leaf)) {
                // Keep self.root as is
            } else {
                self.root = try Node.join_balanced(self.root, other.root, self.allocator);
            }
        }

        /// Split rope into two at index (returns right half, modifies self to be left half)
        /// O(log n) structural split without flattening
        pub fn split(self: *Self, index: u32) !Self {
            const result = try Node.split_at(self.root, index, self.allocator, self.empty_leaf);
            self.root = result.left;
            return Self{
                .root = result.right,
                .allocator = self.allocator,
                .empty_leaf = self.empty_leaf,
                .undo_history = null,
                .redo_history = null,
                .curr_history = null,
            };
        }

        /// Extract items in range [start, end) into an array
        pub fn slice(self: *const Self, start: u32, end: u32, allocator: Allocator) ![]T {
            if (start >= end) return &[_]T{};

            const SliceContext = struct {
                items: std.ArrayList(T),
                start: u32,
                end: u32,
                current_index: u32 = 0,

                fn walker(ctx: *anyopaque, data: *const T, idx: u32) Node.WalkerResult {
                    _ = idx;
                    const context = @as(*@This(), @ptrCast(@alignCast(ctx)));
                    if (context.current_index >= context.start and context.current_index < context.end) {
                        context.items.append(data.*) catch |e| return .{ .err = e };
                    }
                    context.current_index += 1;
                    if (context.current_index >= context.end) {
                        return .{ .keep_walking = false };
                    }
                    return .{};
                }
            };

            var context = SliceContext{
                .items = std.ArrayList(T).init(allocator),
                .start = start,
                .end = end,
            };
            errdefer context.items.deinit();

            try self.walk(&context, SliceContext.walker);
            return context.items.toOwnedSlice();
        }

        /// Delete range of items [start, end)
        /// O(log n) structural operation
        pub fn delete_range(self: *Self, start: u32, end: u32) !void {
            if (start >= end) return;

            // Split at start, then split the right part at (end - start)
            const first_split = try Node.split_at(self.root, start, self.allocator, self.empty_leaf);
            const second_split = try Node.split_at(first_split.right, end - start, self.allocator, self.empty_leaf);

            // Join left part with the part after the deleted range
            // Filter split-boundary empties
            if (first_split.left == self.empty_leaf) {
                self.root = second_split.right;
            } else if (second_split.right == self.empty_leaf) {
                self.root = first_split.left;
            } else {
                self.root = try Node.join_balanced(first_split.left, second_split.right, self.allocator);
            }
        }

        /// Insert multiple items at index efficiently
        /// O(log n + k) structural operation where k is items.len
        pub fn insert_slice(self: *Self, index: u32, items: []const T) !void {
            if (items.len == 0) return;

            // Create a rope from the items to insert
            const insert_rope = try Self.from_slice(self.allocator, items);

            // Split at index: (left, right)
            const split_result = try Node.split_at(self.root, index, self.allocator, self.empty_leaf);

            // Join: left + insert + right
            // Filter split-boundary empties (pointer equality with self.empty_leaf)
            const left_filtered = if (split_result.left == self.empty_leaf)
                insert_rope.root
            else
                try Node.join_balanced(split_result.left, insert_rope.root, self.allocator);

            self.root = if (split_result.right == self.empty_leaf)
                left_filtered
            else
                try Node.join_balanced(left_filtered, split_result.right, self.allocator);
        }

        /// Convert entire rope to array
        pub fn to_array(self: *const Self, allocator: Allocator) ![]T {
            const ToArrayContext = struct {
                items: std.ArrayList(T),

                fn walker(ctx: *anyopaque, data: *const T, idx: u32) Node.WalkerResult {
                    _ = idx;
                    const context = @as(*@This(), @ptrCast(@alignCast(ctx)));
                    context.items.append(data.*) catch |e| return .{ .err = e };
                    return .{};
                }
            };

            var context = ToArrayContext{
                .items = std.ArrayList(T).init(allocator),
            };
            errdefer context.items.deinit();

            try self.walk(&context, ToArrayContext.walker);
            return context.items.toOwnedSlice();
        }

        /// Get total weight of the rope
        /// Uses T.Metrics.weight() if available, else falls back to count
        pub fn totalWeight(self: *const Self) u32 {
            return self.root.metrics().weight();
        }

        /// Split rope into two at weight (returns right half, modifies self to be left half)
        /// O(log n) structural split without flattening
        /// Calls split_leaf_fn callback when split point falls inside a leaf
        pub fn splitByWeight(self: *Self, weight: u32, split_leaf_fn: *const Node.LeafSplitFn) !Self {
            const result = try Node.split_at_weight(self.root, weight, self.allocator, self.empty_leaf, split_leaf_fn);
            self.root = result.left;
            return Self{
                .root = result.right,
                .allocator = self.allocator,
                .empty_leaf = self.empty_leaf,
                .undo_history = null,
                .redo_history = null,
                .curr_history = null,
            };
        }

        /// Delete range by weight [start, end)
        /// O(log n) structural operation
        /// Calls split_leaf_fn callback when split points fall inside leaves
        pub fn deleteRangeByWeight(self: *Self, start: u32, end: u32, split_leaf_fn: *const Node.LeafSplitFn) !void {
            if (start >= end) return;

            // Split at start, then split the right part at (end - start)
            const first_split = try Node.split_at_weight(self.root, start, self.allocator, self.empty_leaf, split_leaf_fn);
            const second_split = try Node.split_at_weight(first_split.right, end - start, self.allocator, self.empty_leaf, split_leaf_fn);

            // Join left part with the part after the deleted range
            // Filter split-boundary empties
            if (first_split.left == self.empty_leaf) {
                self.root = second_split.right;
            } else if (second_split.right == self.empty_leaf) {
                self.root = first_split.left;
            } else {
                self.root = try Node.join_balanced(first_split.left, second_split.right, self.allocator);
            }
        }

        /// Insert multiple items at weight position efficiently
        /// O(log n + k) structural operation where k is items.len
        /// Calls split_leaf_fn callback when split point falls inside a leaf
        pub fn insertSliceByWeight(self: *Self, weight: u32, items: []const T, split_leaf_fn: *const Node.LeafSplitFn) !void {
            if (items.len == 0) return;

            // Create a rope from the items to insert
            const insert_rope = try Self.from_slice(self.allocator, items);

            // Split at weight: (left, right)
            const split_result = try Node.split_at_weight(self.root, weight, self.allocator, self.empty_leaf, split_leaf_fn);

            // Join: left + insert + right
            // Filter split-boundary empties (pointer equality with self.empty_leaf)
            const left_filtered = if (split_result.left == self.empty_leaf)
                insert_rope.root
            else
                try Node.join_balanced(split_result.left, insert_rope.root, self.allocator);

            self.root = if (split_result.right == self.empty_leaf)
                left_filtered
            else
                try Node.join_balanced(left_filtered, split_result.right, self.allocator);
        }

        /// Result type for weight-based find operations
        pub const WeightFindResult = struct { leaf: *const T, start_weight: u32 };

        /// Find leaf containing the given weight
        /// Returns the leaf data and its starting weight in the rope
        pub fn findByWeight(self: *const Self, weight: u32) ?WeightFindResult {
            return self.findByWeightInNode(self.root, weight, 0);
        }

        fn findByWeightInNode(self: *const Self, node: *const Node, target_weight: u32, current_weight: u32) ?WeightFindResult {
            // Skip sentinel empties
            if (node.is_sentinel(self.empty_leaf)) {
                return null;
            }

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
        pub fn store_undo(self: *Self, meta: []const u8) !void {
            const undo_node = try self.create_undo_node(self.root, meta);
            self.push_undo(undo_node);
            self.curr_history = null;
            try self.push_redo_branch();
        }

        fn create_undo_node(self: *const Self, root: *const Node, meta_: []const u8) !*UndoNode {
            const undo_node = try self.allocator.create(UndoNode);
            const meta = try self.allocator.dupe(u8, meta_);
            undo_node.* = UndoNode{
                .root = root,
                .meta = meta,
            };
            return undo_node;
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
            var current = self.undo_history;
            var depth_count: usize = 0;
            var prev: ?*UndoNode = null;

            while (current) |node| {
                depth_count += 1;
                if (depth_count >= max_depth) {
                    // Cut off the rest of the history
                    if (prev) |p| {
                        p.next = null;
                    }
                    self.undo_depth = max_depth;
                    return;
                }
                prev = node;
                current = node.next;
            }
        }

        fn push_redo(self: *Self, undo_node: *UndoNode) void {
            const next = self.redo_history;
            self.redo_history = undo_node;
            undo_node.next = next;
        }

        fn push_redo_branch(self: *Self) !void {
            const r = self.redo_history orelse return;
            const u = self.undo_history orelse return;
            const next = u.branches;
            const b = try self.allocator.create(UndoBranch);
            b.* = .{
                .redo = r,
                .next = next,
            };
            u.branches = b;
            self.redo_history = null;
        }

        pub fn undo(self: *Self, meta: []const u8) ![]const u8 {
            const r = self.curr_history orelse try self.create_undo_node(self.root, meta);
            const h = self.undo_history orelse return error.Stop;
            self.undo_history = h.next;
            self.curr_history = h;
            self.root = h.root;
            self.push_redo(r);
            if (self.undo_depth > 0) self.undo_depth -= 1;
            return h.meta;
        }

        pub fn redo(self: *Self) ![]const u8 {
            const u = self.curr_history orelse return error.Stop;
            const h = self.redo_history orelse return error.Stop;
            if (u.root != self.root) return error.Stop;
            self.redo_history = h.next;
            self.curr_history = h;
            self.root = h.root;
            self.push_undo(u);
            return h.meta;
        }

        pub fn can_undo(self: *const Self) bool {
            return self.undo_history != null;
        }

        pub fn can_redo(self: *const Self) bool {
            return self.redo_history != null and self.curr_history != null;
        }

        pub fn clear_history(self: *Self) void {
            self.undo_history = null;
            self.redo_history = null;
            self.curr_history = null;
            self.undo_depth = 0;
        }
    };
}
