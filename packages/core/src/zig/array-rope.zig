const std = @import("std");
const Allocator = std.mem.Allocator;

/// ArrayRope - A read-only rope wrapper around ArrayListUnmanaged
/// Provides the same interface as Rope(T) but with zero overhead for read-only access
/// Perfect for rendering paths in text-buffer-view.zig and buffer.zig
///
/// Memory: Just the array - no tree overhead!
/// Access: O(1) instead of O(log n)
/// Trade-off: Not suitable for frequent edits (use real Rope for that)
pub fn ArrayRope(comptime T: type) type {
    return struct {
        const Self = @This();

        /// Same Metrics structure as Rope(T)
        pub const Metrics = struct {
            count: u32 = 0,
            depth: u32 = 1,
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

        /// Fake Node structure for API compatibility
        pub const Node = struct {
            // We don't actually use this, but it's needed for type compatibility
            metrics_cache: Metrics,

            pub fn metrics(self: *const Node) Metrics {
                return self.metrics_cache;
            }

            pub const WalkerFn = *const fn (ctx: *anyopaque, data: *const T, index: u32) WalkerResult;

            pub const WalkerResult = struct {
                keep_walking: bool = true,
                err: ?anyerror = null,
            };
        };

        items: std.ArrayListUnmanaged(T),
        allocator: Allocator,
        cached_metrics: Metrics,

        pub fn init(allocator: Allocator) !Self {
            return .{
                .items = .{},
                .allocator = allocator,
                .cached_metrics = .{},
            };
        }

        pub fn from_item(allocator: Allocator, data: T) !Self {
            var self = Self{
                .items = .{},
                .allocator = allocator,
                .cached_metrics = .{},
            };
            try self.items.append(allocator, data);
            self.update_metrics();
            return self;
        }

        pub fn from_slice(allocator: Allocator, slice: []const T) !Self {
            var self = Self{
                .items = .{},
                .allocator = allocator,
                .cached_metrics = .{},
            };
            try self.items.appendSlice(allocator, slice);
            self.update_metrics();
            return self;
        }

        fn update_metrics(self: *Self) void {
            self.cached_metrics = .{
                .count = @intCast(self.items.items.len),
                .depth = 1, // Array is "flat" - depth 1
            };

            // Aggregate custom metrics if T has them
            if (@hasDecl(T, "Metrics") and @hasDecl(T, "measure")) {
                self.cached_metrics.custom = .{};
                for (self.items.items) |*item| {
                    const item_metrics = item.measure();
                    if (@hasDecl(T.Metrics, "add")) {
                        self.cached_metrics.custom.add(item_metrics);
                    }
                }
            }
        }

        /// Get item count - O(1)
        pub fn count(self: *const Self) u32 {
            return @intCast(self.items.items.len);
        }

        /// Get item by index - O(1)! No tree traversal!
        pub fn get(self: *const Self, index: u32) ?*const T {
            if (index >= self.items.items.len) return null;
            return &self.items.items[index];
        }

        /// Walk all items - O(n) but with simple array iteration
        pub fn walk(self: *const Self, ctx: *anyopaque, f: Node.WalkerFn) !void {
            for (self.items.items, 0..) |*item, i| {
                const result = f(ctx, item, @intCast(i));
                if (result.err) |e| return e;
                if (!result.keep_walking) break;
            }
        }

        /// Walk from specific index - O(n - start_index)
        pub fn walk_from(self: *const Self, start_index: u32, ctx: *anyopaque, f: Node.WalkerFn) !void {
            if (start_index >= self.items.items.len) return;

            for (self.items.items[start_index..], start_index..) |*item, i| {
                const result = f(ctx, item, @intCast(i));
                if (result.err) |e| return e;
                if (!result.keep_walking) break;
            }
        }

        /// Append - O(1) amortized
        pub fn append(self: *Self, data: T) !void {
            try self.items.append(self.allocator, data);
            self.update_metrics();
        }

        /// Insert - O(n) due to array shifting (use real Rope if this is frequent!)
        pub fn insert(self: *Self, index: u32, data: T) !void {
            if (index > self.items.items.len) return error.OutOfBounds;
            try self.items.insert(self.allocator, index, data);
            self.update_metrics();
        }

        /// Delete - O(n) due to array shifting (use real Rope if this is frequent!)
        pub fn delete(self: *Self, index: u32) !void {
            if (index >= self.items.items.len) return error.OutOfBounds;
            _ = self.items.orderedRemove(index);
            self.update_metrics();
        }

        /// Rebalance - no-op for array (already "balanced")
        pub fn rebalance(self: *Self, tmp_allocator: Allocator) !void {
            _ = self;
            _ = tmp_allocator;
            // No-op: arrays don't need rebalancing
        }

        /// Fake root node for API compatibility
        /// Returns a node that provides metrics() interface
        pub fn root_node(self: *const Self) Node {
            return Node{
                .metrics_cache = self.cached_metrics,
            };
        }

        /// For compatibility with code that accesses .root.metrics()
        pub const root_accessor = struct {
            parent: *const Self,

            pub fn metrics(self: @This()) Metrics {
                return self.parent.cached_metrics;
            }
        };

        pub fn root(self: *const Self) root_accessor {
            return .{ .parent = self };
        }
    };
}
