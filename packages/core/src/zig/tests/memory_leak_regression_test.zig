const std = @import("std");
const gp = @import("../grapheme.zig");

const GraphemePool = gp.GraphemePool;
const GraphemePoolError = gp.GraphemePoolError;

test "GraphemePool - invalid class_id returns InvalidId" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    // class_id 5, 6, 7 are invalid (valid are 0-4)
    for ([_]u32{ 5, 6, 7 }) |invalid_class_id| {
        const invalid_id = (invalid_class_id << (gp.GENERATION_BITS + gp.SLOT_BITS));

        try std.testing.expectError(GraphemePoolError.InvalidId, pool.incref(invalid_id));
        try std.testing.expectError(GraphemePoolError.InvalidId, pool.decref(invalid_id));
        try std.testing.expectError(GraphemePoolError.InvalidId, pool.get(invalid_id));
        try std.testing.expectError(GraphemePoolError.InvalidId, pool.getRefcount(invalid_id));
    }
}

test "GraphemePool - defer cleanup on failure path" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    var allocated_ids = std.ArrayList(u32).init(std.testing.allocator);
    defer allocated_ids.deinit();

    for (0..5) |i| {
        var buffer: [8]u8 = undefined;
        const len = std.fmt.formatIntBuf(&buffer, i, 10, .lower, .{});
        const gid = try pool.alloc(buffer[0..len]);
        try pool.incref(gid);
        try allocated_ids.append(gid);
    }

    // Simulate failure cleanup
    for (allocated_ids.items) |id| {
        try pool.decref(id);
    }

    // Force slot reuse
    for (0..5) |_| {
        _ = try pool.alloc("reuse");
    }

    for (allocated_ids.items) |id| {
        try std.testing.expectError(GraphemePoolError.WrongGeneration, pool.get(id));
    }
}

test "GraphemePool - pending grapheme cleanup on failure" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    var result_graphemes = std.ArrayList(u32).init(std.testing.allocator);
    defer result_graphemes.deinit();

    var pending_gid: ?u32 = null;
    var success = false;

    defer {
        if (!success) {
            if (pending_gid) |pgid| {
                pool.decref(pgid) catch {};
            }
            for (result_graphemes.items) |gid| {
                pool.decref(gid) catch {};
            }
        }
    }

    const gid1 = try pool.alloc("grapheme1");
    pending_gid = gid1;
    try pool.incref(gid1);
    try result_graphemes.append(gid1);
    pending_gid = null;

    const gid2 = try pool.alloc("grapheme2");
    pending_gid = gid2;
    try pool.incref(gid2);
    // Simulate failure before storing - pending_gid remains set
}

test "encodeUnicode - cleanup on mid-operation failure" {
    const simulateEncodeUnicode = struct {
        fn run(pool: *GraphemePool, should_fail: bool) bool {
            var success = false;
            var pending_gid: ?u32 = null;
            var stored_ids: [8]u32 = undefined;
            var stored_count: usize = 0;

            defer {
                if (!success) {
                    if (pending_gid) |pgid| {
                        pool.decref(pgid) catch {};
                    }
                    for (stored_ids[0..stored_count]) |gid| {
                        pool.decref(gid) catch {};
                    }
                }
            }

            const gid1 = pool.alloc("emoji1") catch return false;
            pending_gid = gid1;
            pool.incref(gid1) catch return false;
            stored_ids[stored_count] = gid1;
            stored_count += 1;
            pending_gid = null;

            const gid2 = pool.alloc("emoji2") catch return false;
            pending_gid = gid2;
            pool.incref(gid2) catch return false;

            if (should_fail) {
                return false;
            }

            stored_ids[stored_count] = gid2;
            stored_count += 1;
            pending_gid = null;

            success = true;
            return true;
        }
    }.run;

    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const result = simulateEncodeUnicode(&pool, true);
    try std.testing.expect(!result);
}
