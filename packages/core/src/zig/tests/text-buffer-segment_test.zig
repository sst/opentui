const std = @import("std");
const testing = std.testing;
const seg_mod = @import("../text-buffer-segment.zig");

const Segment = seg_mod.Segment;
const UnifiedRope = seg_mod.UnifiedRope;
const TextChunk = seg_mod.TextChunk;

test "Segment.measure - text chunk" {
    const chunk = TextChunk{
        .mem_id = 0,
        .byte_start = 0,
        .byte_end = 10,
        .width = 10,
        .flags = TextChunk.Flags.ASCII_ONLY,
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

test "Segment.empty and is_empty" {
    const seg = Segment.empty();
    try testing.expect(seg.is_empty());
}

test "Segment.isBreak and isText" {
    const text_seg = Segment{
        .text = TextChunk{
            .mem_id = 0,
            .byte_start = 0,
            .byte_end = 10,
            .width = 10,
            .flags = 0,
        },
    };
    try testing.expect(text_seg.isText());
    try testing.expect(!text_seg.isBreak());

    const brk_seg = Segment{ .brk = {} };
    try testing.expect(brk_seg.isBreak());
    try testing.expect(!brk_seg.isText());
}

test "Segment.asText" {
    const chunk = TextChunk{
        .mem_id = 0,
        .byte_start = 0,
        .byte_end = 10,
        .width = 10,
        .flags = 0,
    };
    const text_seg = Segment{ .text = chunk };
    const retrieved = text_seg.asText();
    try testing.expect(retrieved != null);
    try testing.expectEqual(@as(u32, 10), retrieved.?.width);

    const brk_seg = Segment{ .brk = {} };
    try testing.expect(brk_seg.asText() == null);
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

test "Metrics.add - non-ASCII propagation" {
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
        .ascii_only = false, // Non-ASCII
    };

    left.add(right);
    try testing.expect(!left.ascii_only); // Should be false
}

test "UnifiedRope - basic operations" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Create a simple rope: [text(10)] + [break] + [text(5)]
    var rope = try UnifiedRope.init(allocator);

    const text1 = Segment{
        .text = TextChunk{
            .mem_id = 0,
            .byte_start = 0,
            .byte_end = 10,
            .width = 10,
            .flags = TextChunk.Flags.ASCII_ONLY,
        },
    };
    try rope.append(text1);

    const brk = Segment{ .brk = {} };
    try rope.append(brk);

    const text2 = Segment{
        .text = TextChunk{
            .mem_id = 0,
            .byte_start = 10,
            .byte_end = 15,
            .width = 5,
            .flags = TextChunk.Flags.ASCII_ONLY,
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

test "UnifiedRope - empty rope metrics" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    const rope = try UnifiedRope.init(allocator);
    const metrics = rope.root.metrics();

    try testing.expectEqual(@as(u32, 0), rope.count());
    try testing.expectEqual(@as(u32, 0), metrics.custom.total_width);
    try testing.expectEqual(@as(u32, 0), metrics.custom.break_count);
}

test "UnifiedRope - single text segment" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var rope = try UnifiedRope.init(allocator);
    try rope.append(Segment{
        .text = TextChunk{
            .mem_id = 0,
            .byte_start = 0,
            .byte_end = 20,
            .width = 20,
            .flags = 0,
        },
    });

    const metrics = rope.root.metrics();
    try testing.expectEqual(@as(u32, 1), rope.count());
    try testing.expectEqual(@as(u32, 20), metrics.custom.total_width);
    try testing.expectEqual(@as(u32, 0), metrics.custom.break_count);
    try testing.expectEqual(@as(u32, 20), metrics.custom.first_line_width);
    try testing.expectEqual(@as(u32, 20), metrics.custom.last_line_width);
    try testing.expectEqual(@as(u32, 20), metrics.custom.max_line_width);
}

test "UnifiedRope - multiple lines with varying widths" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var rope = try UnifiedRope.init(allocator);

    // Line 1: width 10
    try rope.append(Segment{
        .text = TextChunk{
            .mem_id = 0,
            .byte_start = 0,
            .byte_end = 10,
            .width = 10,
            .flags = 0,
        },
    });
    try rope.append(Segment{ .brk = {} });

    // Line 2: width 30 (should be max)
    try rope.append(Segment{
        .text = TextChunk{
            .mem_id = 0,
            .byte_start = 10,
            .byte_end = 40,
            .width = 30,
            .flags = 0,
        },
    });
    try rope.append(Segment{ .brk = {} });

    // Line 3: width 15
    try rope.append(Segment{
        .text = TextChunk{
            .mem_id = 0,
            .byte_start = 40,
            .byte_end = 55,
            .width = 15,
            .flags = 0,
        },
    });

    const metrics = rope.root.metrics();
    try testing.expectEqual(@as(u32, 5), rope.count()); // 3 text + 2 breaks
    try testing.expectEqual(@as(u32, 55), metrics.custom.total_width); // 10 + 30 + 15
    try testing.expectEqual(@as(u32, 2), metrics.custom.break_count);
    try testing.expectEqual(@as(u32, 10), metrics.custom.first_line_width);
    try testing.expectEqual(@as(u32, 15), metrics.custom.last_line_width);
    try testing.expectEqual(@as(u32, 30), metrics.custom.max_line_width); // Line 2 is max
}

test "combineMetrics helper function" {
    const left = Segment.Metrics{
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

    const combined = seg_mod.combineMetrics(left, right);

    try testing.expectEqual(@as(u32, 15), combined.total_width);
    try testing.expectEqual(@as(u32, 0), combined.break_count);
    try testing.expectEqual(@as(u32, 15), combined.first_line_width);
    try testing.expectEqual(@as(u32, 15), combined.last_line_width);
    try testing.expectEqual(@as(u32, 15), combined.max_line_width);
    try testing.expect(combined.ascii_only);
}
