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
    try testing.expectEqual(@as(u32, 10), metrics.max_line_width);
    try testing.expect(metrics.ascii_only);
}

test "Segment.measure - break" {
    const seg = Segment{ .brk = {} };
    const metrics = seg.measure();

    try testing.expectEqual(@as(u32, 0), metrics.total_width);
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
        .max_line_width = 10,
        .ascii_only = true,
    };

    const right = Segment.Metrics{
        .total_width = 5,
        .max_line_width = 5,
        .ascii_only = true,
    };

    left.add(right);

    try testing.expectEqual(@as(u32, 15), left.total_width);
    try testing.expectEqual(@as(u32, 10), left.max_line_width);
    try testing.expect(left.ascii_only);
}

test "Metrics.add - text, break, text" {
    var left = Segment.Metrics{
        .total_width = 10,
        .max_line_width = 10,
        .ascii_only = true,
    };

    const middle = Segment.Metrics{
        .total_width = 0,
        .max_line_width = 0,
        .ascii_only = true,
    };

    left.add(middle);

    try testing.expectEqual(@as(u32, 10), left.total_width);
    try testing.expectEqual(@as(u32, 10), left.max_line_width);

    const right = Segment.Metrics{
        .total_width = 5,
        .max_line_width = 5,
        .ascii_only = true,
    };

    left.add(right);

    try testing.expectEqual(@as(u32, 15), left.total_width);
    try testing.expectEqual(@as(u32, 10), left.max_line_width);
}

test "Metrics.add - multiple breaks" {
    var metrics = Segment.Metrics{
        .total_width = 10,
        .max_line_width = 10,
        .ascii_only = true,
    };

    metrics.add(Segment.Metrics{
        .total_width = 0,
        .max_line_width = 0,
        .ascii_only = true,
    });

    metrics.add(Segment.Metrics{
        .total_width = 20,
        .max_line_width = 20,
        .ascii_only = true,
    });

    try testing.expectEqual(@as(u32, 30), metrics.total_width);
    try testing.expectEqual(@as(u32, 20), metrics.max_line_width);

    metrics.add(Segment.Metrics{
        .total_width = 0,
        .max_line_width = 0,
        .ascii_only = true,
    });

    metrics.add(Segment.Metrics{
        .total_width = 5,
        .max_line_width = 5,
        .ascii_only = true,
    });

    try testing.expectEqual(@as(u32, 35), metrics.total_width);
    try testing.expectEqual(@as(u32, 20), metrics.max_line_width);
}

test "Metrics.add - non-ASCII propagation" {
    var left = Segment.Metrics{
        .total_width = 10,
        .max_line_width = 10,
        .ascii_only = true,
    };

    const right = Segment.Metrics{
        .total_width = 5,
        .max_line_width = 5,
        .ascii_only = false,
    };

    left.add(right);
    try testing.expect(!left.ascii_only);
}

test "UnifiedRope - basic operations" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

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

    const metrics = rope.root.metrics();
    try testing.expectEqual(@as(u32, 5), rope.count());
    try testing.expectEqual(@as(u32, 15), metrics.custom.total_width);
    try testing.expectEqual(@as(u32, 10), metrics.custom.max_line_width);
}

test "UnifiedRope - empty rope metrics" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    const rope = try UnifiedRope.init(allocator);
    const metrics = rope.root.metrics();

    try testing.expectEqual(@as(u32, 1), rope.count());
    try testing.expectEqual(@as(u32, 0), metrics.custom.total_width);
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
    try testing.expectEqual(@as(u32, 2), rope.count());
    try testing.expectEqual(@as(u32, 20), metrics.custom.total_width);
    try testing.expectEqual(@as(u32, 20), metrics.custom.max_line_width);
}

test "UnifiedRope - multiple lines with varying widths" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var rope = try UnifiedRope.init(allocator);

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
    try testing.expectEqual(@as(u32, 8), rope.count());
    try testing.expectEqual(@as(u32, 55), metrics.custom.total_width);
    try testing.expectEqual(@as(u32, 30), metrics.custom.max_line_width);
}

fn combineMetrics(left: Segment.Metrics, right: Segment.Metrics) Segment.Metrics {
    var result = left;
    result.add(right);
    return result;
}

test "combineMetrics helper function" {
    const left = Segment.Metrics{
        .total_width = 10,
        .max_line_width = 10,
        .ascii_only = true,
    };

    const right = Segment.Metrics{
        .total_width = 5,
        .max_line_width = 5,
        .ascii_only = true,
    };

    const combined = combineMetrics(left, right);

    try testing.expectEqual(@as(u32, 15), combined.total_width);
    try testing.expectEqual(@as(u32, 10), combined.max_line_width);
    try testing.expect(combined.ascii_only);
}
