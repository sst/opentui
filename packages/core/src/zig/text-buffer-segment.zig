const std = @import("std");
const Allocator = std.mem.Allocator;
const tb = @import("text-buffer-nested.zig");
const rope_mod = @import("rope.zig");

/// A segment in the unified rope - either text content or a line break marker
pub const Segment = union(enum) {
    text: tb.TextChunk,
    brk: void,

    /// Metrics for aggregation in the rope tree
    /// These enable O(log n) row/col coordinate mapping and efficient line queries
    pub const Metrics = struct {
        /// Total display width (sum of all text segments, breaks contribute 0)
        total_width: u32 = 0,

        /// Number of line break markers in the subtree
        break_count: u32 = 0,

        /// Display width from start of subtree to first break (or total if no breaks)
        first_line_width: u32 = 0,

        /// Display width from last break to end of subtree (or total if no breaks)
        last_line_width: u32 = 0,

        /// Maximum line width in the entire subtree
        /// For internal nodes, this is max(left.max, right.max, left.last + right.first)
        max_line_width: u32 = 0,

        /// Whether all text segments in subtree are ASCII-only (for fast wrapping paths)
        ascii_only: bool = true,

        /// Combine metrics from two child nodes
        /// This is called when building internal rope nodes
        pub fn add(self: *Metrics, other: Metrics) void {
            // Save original state for boundary calculation
            const left_break_count = self.break_count;
            const left_last_width = self.last_line_width;
            const right_first_width = other.first_line_width;

            self.total_width += other.total_width;
            self.break_count += other.break_count;

            // first_line_width: if left has no breaks, combine left + right first line
            // Otherwise, left's first line is already complete
            if (left_break_count == 0) {
                self.first_line_width = self.first_line_width + other.first_line_width;
            }
            // else: self.first_line_width stays as is (left's first line ends at left's first break)

            // last_line_width: if right has breaks, use right's last line width
            // Otherwise, combine left's last line with right's total width
            if (other.break_count > 0) {
                self.last_line_width = other.last_line_width;
            } else {
                self.last_line_width = self.last_line_width + other.last_line_width;
            }

            // max_line_width: max of left's max, right's max, and potentially the combined/boundary width
            if (left_break_count == 0 and other.break_count == 0) {
                // No breaks anywhere - single line, use combined width
                self.max_line_width = self.first_line_width; // Already combined above
            } else {
                // At least one break exists - check boundary
                const boundary_width = if (left_break_count > 0)
                    left_last_width + right_first_width
                else
                    0; // Left has no breaks, so no boundary to join

                self.max_line_width = @max(
                    @max(self.max_line_width, other.max_line_width),
                    boundary_width,
                );
            }

            // ascii_only: only true if both subtrees are ASCII-only
            self.ascii_only = self.ascii_only and other.ascii_only;
        }

        /// Get the balancing weight for the rope
        /// We use total_width as the weight metric
        pub fn weight(self: *const Metrics) u32 {
            return self.total_width;
        }
    };

    /// Measure this segment to produce its metrics
    pub fn measure(self: *const Segment) Metrics {
        return switch (self.*) {
            .text => |chunk| blk: {
                const is_ascii = (chunk.flags & tb.TextChunk.Flags.ASCII_ONLY) != 0;
                break :blk Metrics{
                    .total_width = chunk.width,
                    .break_count = 0,
                    .first_line_width = chunk.width,
                    .last_line_width = chunk.width,
                    .max_line_width = chunk.width,
                    .ascii_only = is_ascii,
                };
            },
            .brk => Metrics{
                .total_width = 0,
                .break_count = 1,
                .first_line_width = 0,
                .last_line_width = 0,
                .max_line_width = 0,
                .ascii_only = true,
            },
        };
    }

    /// Create an empty segment (used by rope for initialization)
    pub fn empty() Segment {
        return .{ .text = tb.TextChunk.empty() };
    }

    /// Check if this segment is empty
    pub fn is_empty(self: *const Segment) bool {
        return switch (self.*) {
            .text => |chunk| chunk.is_empty(),
            .brk => false, // Breaks are never "empty" - they represent a line boundary
        };
    }

    /// Get the bytes for this segment (empty for breaks)
    pub fn getBytes(self: *const Segment, mem_registry: *const tb.MemRegistry) []const u8 {
        return switch (self.*) {
            .text => |chunk| chunk.getBytes(mem_registry),
            .brk => &[_]u8{},
        };
    }

    /// Check if this is a break segment
    pub fn isBreak(self: *const Segment) bool {
        return switch (self.*) {
            .brk => true,
            else => false,
        };
    }

    /// Check if this is a text segment
    pub fn isText(self: *const Segment) bool {
        return switch (self.*) {
            .text => true,
            else => false,
        };
    }

    /// Get the text chunk if this is a text segment, null otherwise
    pub fn asText(self: *const Segment) ?*const tb.TextChunk {
        return switch (self.*) {
            .text => |*chunk| chunk,
            else => null,
        };
    }
};

/// Helper to combine metrics (same logic as Metrics.add but pure function)
pub fn combineMetrics(left: Segment.Metrics, right: Segment.Metrics) Segment.Metrics {
    var result = left;
    result.add(right);
    return result;
}

/// Unified rope type for text buffer - stores text segments and break markers in a single tree
pub const UnifiedRope = rope_mod.Rope(Segment);

// Tests
const testing = std.testing;

test "Segment.measure - text chunk" {
    const chunk = tb.TextChunk{
        .mem_id = 0,
        .byte_start = 0,
        .byte_end = 10,
        .width = 10,
        .flags = tb.TextChunk.Flags.ASCII_ONLY,
    };
    const seg = Segment{ .text = chunk };
    const metrics = seg.measure();

    try testing.expectEqual(@as(u32, 10), metrics.total_width);
    try testing.expectEqual(@as(u32, 0), metrics.break_count);
    try testing.expectEqual(@as(u32, 10), metrics.first_line_width);
    try testing.expectEqual(@as(u32, 10), metrics.last_line_width);
    try testing.expectEqual(@as(u32, 10), metrics.max_line_width);
    try testing.expect(metrics.ascii_only);
}

test "Segment.measure - break" {
    const seg = Segment{ .brk = {} };
    const metrics = seg.measure();

    try testing.expectEqual(@as(u32, 0), metrics.total_width);
    try testing.expectEqual(@as(u32, 1), metrics.break_count);
    try testing.expectEqual(@as(u32, 0), metrics.first_line_width);
    try testing.expectEqual(@as(u32, 0), metrics.last_line_width);
    try testing.expectEqual(@as(u32, 0), metrics.max_line_width);
    try testing.expect(metrics.ascii_only);
}

test "Metrics.add - two text segments" {
    var left = Segment.Metrics{
        .total_width = 10,
        .break_count = 0,
        .first_line_width = 10,
        .last_line_width = 10,
        .max_line_width = 10,
        .ascii_only = true,
    };

    const right = Segment.Metrics{
        .total_width = 5,
        .break_count = 0,
        .first_line_width = 5,
        .last_line_width = 5,
        .max_line_width = 5,
        .ascii_only = true,
    };

    left.add(right);

    try testing.expectEqual(@as(u32, 15), left.total_width);
    try testing.expectEqual(@as(u32, 0), left.break_count);
    try testing.expectEqual(@as(u32, 15), left.first_line_width); // Combined
    try testing.expectEqual(@as(u32, 15), left.last_line_width); // Combined
    try testing.expectEqual(@as(u32, 15), left.max_line_width);
    try testing.expect(left.ascii_only);
}

test "Metrics.add - text, break, text" {
    // Simulate: [text(10)] + [break] + [text(5)]
    var left = Segment.Metrics{
        .total_width = 10,
        .break_count = 0,
        .first_line_width = 10,
        .last_line_width = 10,
        .max_line_width = 10,
        .ascii_only = true,
    };

    const middle = Segment.Metrics{
        .total_width = 0,
        .break_count = 1,
        .first_line_width = 0,
        .last_line_width = 0,
        .max_line_width = 0,
        .ascii_only = true,
    };

    left.add(middle);

    // After adding break: first_line stays 10, last_line becomes 0
    try testing.expectEqual(@as(u32, 10), left.total_width);
    try testing.expectEqual(@as(u32, 1), left.break_count);
    try testing.expectEqual(@as(u32, 10), left.first_line_width); // First line ends at break
    try testing.expectEqual(@as(u32, 0), left.last_line_width); // After break, nothing yet

    const right = Segment.Metrics{
        .total_width = 5,
        .break_count = 0,
        .first_line_width = 5,
        .last_line_width = 5,
        .max_line_width = 5,
        .ascii_only = true,
    };

    left.add(right);

    // Final: two lines (10 width and 5 width)
    try testing.expectEqual(@as(u32, 15), left.total_width);
    try testing.expectEqual(@as(u32, 1), left.break_count);
    try testing.expectEqual(@as(u32, 10), left.first_line_width); // First line still 10
    try testing.expectEqual(@as(u32, 5), left.last_line_width); // Second line is 5
    try testing.expectEqual(@as(u32, 10), left.max_line_width); // Max is 10
}

test "Metrics.add - multiple breaks" {
    // Simulate: [text(10)] + [break] + [text(20)] + [break] + [text(5)]
    var metrics = Segment.Metrics{
        .total_width = 10,
        .break_count = 0,
        .first_line_width = 10,
        .last_line_width = 10,
        .max_line_width = 10,
        .ascii_only = true,
    };

    // Add break
    metrics.add(Segment.Metrics{
        .total_width = 0,
        .break_count = 1,
        .first_line_width = 0,
        .last_line_width = 0,
        .max_line_width = 0,
        .ascii_only = true,
    });

    // Add text(20)
    metrics.add(Segment.Metrics{
        .total_width = 20,
        .break_count = 0,
        .first_line_width = 20,
        .last_line_width = 20,
        .max_line_width = 20,
        .ascii_only = true,
    });

    try testing.expectEqual(@as(u32, 30), metrics.total_width);
    try testing.expectEqual(@as(u32, 1), metrics.break_count);
    try testing.expectEqual(@as(u32, 10), metrics.first_line_width);
    try testing.expectEqual(@as(u32, 20), metrics.last_line_width);
    try testing.expectEqual(@as(u32, 20), metrics.max_line_width);

    // Add another break
    metrics.add(Segment.Metrics{
        .total_width = 0,
        .break_count = 1,
        .first_line_width = 0,
        .last_line_width = 0,
        .max_line_width = 0,
        .ascii_only = true,
    });

    // Add text(5)
    metrics.add(Segment.Metrics{
        .total_width = 5,
        .break_count = 0,
        .first_line_width = 5,
        .last_line_width = 5,
        .max_line_width = 5,
        .ascii_only = true,
    });

    // Final: three lines (10, 20, 5)
    try testing.expectEqual(@as(u32, 35), metrics.total_width);
    try testing.expectEqual(@as(u32, 2), metrics.break_count);
    try testing.expectEqual(@as(u32, 10), metrics.first_line_width);
    try testing.expectEqual(@as(u32, 5), metrics.last_line_width);
    try testing.expectEqual(@as(u32, 20), metrics.max_line_width); // Middle line is max
}

test "UnifiedRope - basic operations" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Create a simple rope: [text(10)] + [break] + [text(5)]
    var rope = try UnifiedRope.init(allocator);

    const text1 = Segment{
        .text = tb.TextChunk{
            .mem_id = 0,
            .byte_start = 0,
            .byte_end = 10,
            .width = 10,
            .flags = tb.TextChunk.Flags.ASCII_ONLY,
        },
    };
    try rope.append(text1);

    const brk = Segment{ .brk = {} };
    try rope.append(brk);

    const text2 = Segment{
        .text = tb.TextChunk{
            .mem_id = 0,
            .byte_start = 10,
            .byte_end = 15,
            .width = 5,
            .flags = tb.TextChunk.Flags.ASCII_ONLY,
        },
    };
    try rope.append(text2);

    // Check metrics
    const metrics = rope.root.metrics();
    try testing.expectEqual(@as(u32, 3), rope.count()); // 3 segments
    try testing.expectEqual(@as(u32, 15), metrics.custom.total_width);
    try testing.expectEqual(@as(u32, 1), metrics.custom.break_count);
    try testing.expectEqual(@as(u32, 10), metrics.custom.first_line_width);
    try testing.expectEqual(@as(u32, 5), metrics.custom.last_line_width);
    try testing.expectEqual(@as(u32, 10), metrics.custom.max_line_width);
}
