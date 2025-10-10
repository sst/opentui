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
        };

        pub const Branch = struct {
            left: *const Node,
            right: *const Node,
            left_metrics: Metrics, // Metrics of left subtree
            total_metrics: Metrics, // Total metrics of this subtree

            fn is_balanced(self: *const Branch) bool {
                const left: isize = @intCast(self.left.metrics().depth);
                const right: isize = @intCast(self.right.metrics().depth);
                return @abs(left - right) < max_imbalance;
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
        undo_history: ?*UndoNode = null,
        redo_history: ?*UndoNode = null,
        curr_history: ?*UndoNode = null,

        pub fn init(allocator: Allocator) !Self {
            // Create empty root - if T has an empty() function, use it
            const empty_data = if (@hasDecl(T, "empty"))
                T.empty()
            else
                std.mem.zeroes(T);

            const root = try Node.new_leaf(allocator, empty_data);
            return .{
                .root = root,
                .allocator = allocator,
            };
        }

        /// Create from a single item
        pub fn from_item(allocator: Allocator, data: T) !Self {
            const root = try Node.new_leaf(allocator, data);
            return .{
                .root = root,
                .allocator = allocator,
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
            return .{
                .root = root,
                .allocator = allocator,
            };
        }

        pub fn count(self: *const Self) u32 {
            return self.root.count();
        }

        pub fn get(self: *const Self, index: u32) ?*const T {
            return self.root.get(index);
        }

        pub fn walk(self: *const Self, ctx: *anyopaque, f: Node.WalkerFn) !void {
            var index: u32 = 0;
            const result = self.root.walk(ctx, f, &index);
            if (result.err) |e| return e;
        }

        pub fn walk_from(self: *const Self, start_index: u32, ctx: *anyopaque, f: Node.WalkerFn) !void {
            const result = self.root.walk_from(start_index, ctx, f);
            if (result.err) |e| return e;
        }

        pub fn rebalance(self: *Self, tmp_allocator: Allocator) !void {
            self.root = try self.root.rebalance(self.allocator, tmp_allocator);
        }

        /// Insert item at index
        pub fn insert(self: *Self, index: u32, data: T) !void {
            const new_leaf = try Node.new_leaf(self.allocator, data);
            self.root = try self.insert_node(self.root, index, new_leaf);
        }

        fn insert_node(self: *Self, node: *const Node, index: u32, new_node: *const Node) error{OutOfMemory}!*const Node {
            return switch (node.*) {
                .branch => |*b| {
                    const left_count = b.left_metrics.count;
                    if (index <= left_count) {
                        const new_left = try self.insert_node(b.left, index, new_node);
                        return try Node.new_branch(self.allocator, new_left, b.right);
                    } else {
                        const new_right = try self.insert_node(b.right, index - left_count, new_node);
                        return try Node.new_branch(self.allocator, b.left, new_right);
                    }
                },
                .leaf => {
                    if (index == 0) {
                        return try Node.new_branch(self.allocator, new_node, node);
                    } else {
                        return try Node.new_branch(self.allocator, node, new_node);
                    }
                },
            };
        }

        /// Delete item at index
        pub fn delete(self: *Self, index: u32) !void {
            self.root = try self.delete_node(self.root, index, self.allocator);
        }

        fn delete_node(_: *Self, node: *const Node, index: u32, allocator: Allocator) error{OutOfMemory}!*const Node {
            return switch (node.*) {
                .branch => |*b| {
                    const left_count = b.left_metrics.count;
                    if (index < left_count) {
                        const new_left = try delete_node(undefined, b.left, index, allocator);
                        if (new_left.is_empty()) return b.right;
                        return try Node.new_branch(allocator, new_left, b.right);
                    } else {
                        const new_right = try delete_node(undefined, b.right, index - left_count, allocator);
                        if (new_right.is_empty()) return b.left;
                        return try Node.new_branch(allocator, b.left, new_right);
                    }
                },
                .leaf => {
                    // Return an empty node (caller should handle)
                    if (@hasDecl(T, "empty")) {
                        return Node.new_leaf(allocator, T.empty()) catch node;
                    }
                    return node; // Can't delete if no empty representation
                },
            };
        }

        pub fn replace(self: *Self, index: u32, data: T) !void {
            self.root = try self.replace_node(self.root, index, data);
        }

        fn replace_node(self: *Self, node: *const Node, index: u32, data: T) error{OutOfMemory}!*const Node {
            return switch (node.*) {
                .branch => |*b| {
                    const left_count = b.left_metrics.count;
                    if (index < left_count) {
                        const new_left = try self.replace_node(b.left, index, data);
                        return try Node.new_branch(self.allocator, new_left, b.right);
                    } else {
                        const new_right = try self.replace_node(b.right, index - left_count, data);
                        return try Node.new_branch(self.allocator, b.left, new_right);
                    }
                },
                .leaf => {
                    if (index == 0) {
                        return try Node.new_leaf(self.allocator, data);
                    }
                    return node;
                },
            };
        }

        pub fn append(self: *Self, data: T) !void {
            try self.insert(self.count(), data);
        }

        pub fn prepend(self: *Self, data: T) !void {
            try self.insert(0, data);
        }

        pub fn concat(self: *Self, other: *const Self) !void {
            self.root = try Node.new_branch(self.allocator, self.root, other.root);
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
        }
    };
}
