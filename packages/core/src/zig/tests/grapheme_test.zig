const std = @import("std");
const gp = @import("../grapheme.zig");

const GraphemePool = gp.GraphemePool;
const GraphemeTracker = gp.GraphemeTracker;

// ===== GraphemePool Basic Tests =====

test "GraphemePool - init and deinit" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    // Pool should be initialized successfully
    try std.testing.expect(pool.classes.len == 5);
}

test "GraphemePool - alloc and get small grapheme" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const text = "a";
    const id = try pool.alloc(text);

    const retrieved = try pool.get(id);
    try std.testing.expectEqualSlices(u8, text, retrieved);
}

test "GraphemePool - alloc and get emoji" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const emoji = "🌟";
    const id = try pool.alloc(emoji);

    const retrieved = try pool.get(id);
    try std.testing.expectEqualSlices(u8, emoji, retrieved);
}

test "GraphemePool - alloc and get multi-byte grapheme" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const grapheme = "é";
    const id = try pool.alloc(grapheme);

    const retrieved = try pool.get(id);
    try std.testing.expectEqualSlices(u8, grapheme, retrieved);
}

test "GraphemePool - alloc and get combining character grapheme" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const grapheme = "e\u{0301}"; // e with combining acute accent
    const id = try pool.alloc(grapheme);

    const retrieved = try pool.get(id);
    try std.testing.expectEqualSlices(u8, grapheme, retrieved);
}

test "GraphemePool - multiple allocations" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const text1 = "a";
    const text2 = "b";
    const text3 = "🌟";

    const id1 = try pool.alloc(text1);
    const id2 = try pool.alloc(text2);
    const id3 = try pool.alloc(text3);

    // All IDs should be different
    try std.testing.expect(id1 != id2);
    try std.testing.expect(id2 != id3);
    try std.testing.expect(id1 != id3);

    // All should be retrievable with correct content
    try std.testing.expectEqualSlices(u8, text1, try pool.get(id1));
    try std.testing.expectEqualSlices(u8, text2, try pool.get(id2));
    try std.testing.expectEqualSlices(u8, text3, try pool.get(id3));
}

test "GraphemePool - different size classes" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    // Test allocation in different size classes
    const small = "a"; // Class 0 (≤8 bytes)
    const medium = "0123456789"; // Class 1 (≤16 bytes)
    const large = "012345678901234567890123456789"; // Class 2 (≤32 bytes)

    const id_small = try pool.alloc(small);
    const id_medium = try pool.alloc(medium);
    const id_large = try pool.alloc(large);

    try std.testing.expectEqualSlices(u8, small, try pool.get(id_small));
    try std.testing.expectEqualSlices(u8, medium, try pool.get(id_medium));
    try std.testing.expectEqualSlices(u8, large, try pool.get(id_large));
}

test "GraphemePool - maximum size allocation" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    // Maximum size is 128 bytes (class 4)
    var buffer: [128]u8 = undefined;
    @memset(&buffer, 'X');

    const id = try pool.alloc(&buffer);
    const retrieved = try pool.get(id);

    try std.testing.expectEqual(@as(usize, 128), retrieved.len);
    try std.testing.expectEqualSlices(u8, &buffer, retrieved);
}

// ===== GraphemePool Reference Counting Tests =====

test "GraphemePool - incref increases refcount" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const text = "a";
    const id = try pool.alloc(text);

    // Initial refcount is 1, increment it
    try pool.incref(id);

    // Should still be accessible
    const retrieved = try pool.get(id);
    try std.testing.expectEqualSlices(u8, text, retrieved);
}

test "GraphemePool - decref once keeps data alive" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const text = "a";
    const id = try pool.alloc(text);

    try pool.incref(id);
    try pool.decref(id);

    // Should still be accessible (refcount is 1)
    const retrieved = try pool.get(id);
    try std.testing.expectEqualSlices(u8, text, retrieved);
}

test "GraphemePool - decref to zero allows slot reuse" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const text1 = "a";
    const id1 = try pool.alloc(text1);

    try pool.decref(id1);

    // Allocate again - should reuse the freed slot with new generation
    const text2 = "b";
    const id2 = try pool.alloc(text2);

    // Old ID should fail due to generation mismatch
    const result1 = pool.get(id1);
    try std.testing.expectError(gp.GraphemePoolError.InvalidId, result1);

    // New ID should work
    const retrieved = try pool.get(id2);
    try std.testing.expectEqualSlices(u8, text2, retrieved);

    try pool.decref(id2);
}

test "GraphemePool - multiple incref and decref" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const text = "test";
    const id = try pool.alloc(text);

    // Increment refcount multiple times
    try pool.incref(id);
    try pool.incref(id);
    try pool.incref(id);

    // Decrement twice
    try pool.decref(id);
    try pool.decref(id);

    // Should still be accessible (refcount is 2)
    const retrieved = try pool.get(id);
    try std.testing.expectEqualSlices(u8, text, retrieved);

    // Decrement to zero
    try pool.decref(id);
    try pool.decref(id);

    // Allocate something else to trigger reuse with new generation
    const new_text = "x";
    const new_id = try pool.alloc(new_text);

    // Old ID should now fail due to generation mismatch
    const result = pool.get(id);
    try std.testing.expectError(gp.GraphemePoolError.InvalidId, result);

    // Cleanup
    try pool.decref(new_id);
}

test "GraphemePool - slot reuse increments generation" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const text1 = "a";
    const text2 = "b";

    // Allocate and free a slot
    const id1 = try pool.alloc(text1);
    try pool.decref(id1);

    // Allocate again (should reuse the slot with new generation)
    const id2 = try pool.alloc(text2);

    // Old ID should fail (stale generation)
    const result = pool.get(id1);
    try std.testing.expectError(gp.GraphemePoolError.InvalidId, result);

    // New ID should work
    const retrieved = try pool.get(id2);
    try std.testing.expectEqualSlices(u8, text2, retrieved);
}

test "GraphemePool - stale ID with wrong generation fails" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const text = "test";
    const id = try pool.alloc(text);

    // Manually create a stale ID by modifying generation
    const stale_id = id ^ (1 << gp.SLOT_BITS); // XOR generation bits

    // Stale ID should fail
    const result = pool.get(stale_id);
    try std.testing.expectError(gp.GraphemePoolError.InvalidId, result);
}

test "GraphemePool - decref on zero refcount fails" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const text = "a";
    const id = try pool.alloc(text);

    try pool.decref(id);

    // Second decref should fail (refcount already 0)
    const result = pool.decref(id);
    try std.testing.expectError(gp.GraphemePoolError.InvalidId, result);
}

// ===== GraphemePool Stress Tests =====

test "GraphemePool - many allocations in same class" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const count = 1000;
    var ids: [count]u32 = undefined;

    // Allocate many graphemes
    for (0..count) |i| {
        var buffer: [8]u8 = undefined;
        const len = std.fmt.formatIntBuf(&buffer, i, 10, .lower, .{});
        ids[i] = try pool.alloc(buffer[0..len]);
    }

    // Verify all are accessible
    for (ids, 0..count) |id, i| {
        const retrieved = try pool.get(id);
        var buffer: [8]u8 = undefined;
        const len = std.fmt.formatIntBuf(&buffer, i, 10, .lower, .{});
        try std.testing.expectEqualSlices(u8, buffer[0..len], retrieved);
    }

    // Free all
    for (ids) |id| {
        try pool.decref(id);
    }
}

test "GraphemePool - allocation across multiple size classes" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    var ids = std.ArrayList(u32).init(std.testing.allocator);
    defer ids.deinit();

    // Allocate in each size class
    for (0..50) |i| {
        const size = (i % 5) * 16 + 5; // Vary sizes to hit different classes
        var buffer: [128]u8 = undefined;
        @memset(buffer[0..size], @intCast(i % 256));
        const id = try pool.alloc(buffer[0..size]);
        try ids.append(id);
    }

    // Verify all
    for (ids.items, 0..50) |id, i| {
        const size = (i % 5) * 16 + 5;
        const retrieved = try pool.get(id);
        try std.testing.expectEqual(size, retrieved.len);
        for (retrieved) |byte| {
            try std.testing.expectEqual(@as(u8, @intCast(i % 256)), byte);
        }
    }

    // Free all
    for (ids.items) |id| {
        try pool.decref(id);
    }
}

test "GraphemePool - reuse many slots" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    // Allocate and free repeatedly
    for (0..100) |i| {
        var buffer: [8]u8 = undefined;
        const len = std.fmt.formatIntBuf(&buffer, i, 10, .lower, .{});
        const id = try pool.alloc(buffer[0..len]);

        const retrieved = try pool.get(id);
        try std.testing.expectEqualSlices(u8, buffer[0..len], retrieved);

        try pool.decref(id);
    }
}

// ===== GraphemePool Bit Manipulation Tests =====

test "GraphemePool - bit manipulation functions" {
    // Test isGraphemeChar
    const grapheme_char = gp.CHAR_FLAG_GRAPHEME | 0x1234;
    try std.testing.expect(gp.isGraphemeChar(grapheme_char));
    try std.testing.expect(!gp.isGraphemeChar(0x41)); // Plain 'A'

    // Test isContinuationChar
    const cont_char = gp.CHAR_FLAG_CONTINUATION | 0x1234;
    try std.testing.expect(gp.isContinuationChar(cont_char));
    try std.testing.expect(!gp.isContinuationChar(0x41));

    // Test isClusterChar
    try std.testing.expect(gp.isClusterChar(grapheme_char));
    try std.testing.expect(gp.isClusterChar(cont_char));
    try std.testing.expect(!gp.isClusterChar(0x41));

    // Test graphemeIdFromChar
    const id: u32 = 0x12345;
    const packed_char = gp.CHAR_FLAG_GRAPHEME | id;
    try std.testing.expectEqual(id, gp.graphemeIdFromChar(packed_char));
}

test "GraphemePool - extent encoding and decoding" {
    // Test charRightExtent
    const right: u32 = 2;
    const char_with_right = (right << gp.CHAR_EXT_RIGHT_SHIFT) | gp.CHAR_FLAG_GRAPHEME;
    try std.testing.expectEqual(right, gp.charRightExtent(char_with_right));

    // Test charLeftExtent
    const left: u32 = 1;
    const char_with_left = (left << gp.CHAR_EXT_LEFT_SHIFT) | gp.CHAR_FLAG_GRAPHEME;
    try std.testing.expectEqual(left, gp.charLeftExtent(char_with_left));
}

test "GraphemePool - packGraphemeStart" {
    const gid: u32 = 0x1234;
    const width: u32 = 2;

    const packed_char = gp.packGraphemeStart(gid, width);

    // Should have grapheme flag
    try std.testing.expect(gp.isGraphemeChar(packed_char));

    // Should have correct ID
    try std.testing.expectEqual(gid, gp.graphemeIdFromChar(packed_char));

    // Should have correct right extent (width - 1)
    try std.testing.expectEqual(width - 1, gp.charRightExtent(packed_char));

    // Should have zero left extent
    try std.testing.expectEqual(@as(u32, 0), gp.charLeftExtent(packed_char));
}

test "GraphemePool - packContinuation" {
    const gid: u32 = 0x1234;
    const left: u32 = 1;
    const right: u32 = 2;

    const packed_char = gp.packContinuation(left, right, gid);

    // Should have continuation flag
    try std.testing.expect(gp.isContinuationChar(packed_char));

    // Should have correct ID
    try std.testing.expectEqual(gid, gp.graphemeIdFromChar(packed_char));

    // Should have correct extents
    try std.testing.expectEqual(left, gp.charLeftExtent(packed_char));
    try std.testing.expectEqual(right, gp.charRightExtent(packed_char));
}

test "GraphemePool - encodedCharWidth" {
    // Single-width character
    const single = @as(u32, 'A');
    try std.testing.expectEqual(@as(u32, 1), gp.encodedCharWidth(single));

    // Grapheme start with width 2
    const grapheme_2 = gp.packGraphemeStart(0x1234, 2);
    try std.testing.expectEqual(@as(u32, 2), gp.encodedCharWidth(grapheme_2));

    // Continuation with left=1, right=1 -> width=3
    const cont = gp.packContinuation(1, 1, 0x1234);
    try std.testing.expectEqual(@as(u32, 3), gp.encodedCharWidth(cont));
}

// ===== GraphemeTracker Tests =====

test "GraphemeTracker - init and deinit" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    var tracker = GraphemeTracker.init(std.testing.allocator, &pool);
    defer tracker.deinit();

    try std.testing.expect(!tracker.hasAny());
    try std.testing.expectEqual(@as(u32, 0), tracker.getGraphemeCount());
}

test "GraphemeTracker - add single grapheme" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const text = "a";
    const id = try pool.alloc(text);

    var tracker = GraphemeTracker.init(std.testing.allocator, &pool);
    defer tracker.deinit();

    tracker.add(id);

    try std.testing.expect(tracker.hasAny());
    try std.testing.expect(tracker.contains(id));
    try std.testing.expectEqual(@as(u32, 1), tracker.getGraphemeCount());
}

test "GraphemeTracker - add multiple graphemes" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const text1 = "a";
    const text2 = "b";
    const text3 = "🌟";

    const id1 = try pool.alloc(text1);
    const id2 = try pool.alloc(text2);
    const id3 = try pool.alloc(text3);

    var tracker = GraphemeTracker.init(std.testing.allocator, &pool);
    defer tracker.deinit();

    tracker.add(id1);
    tracker.add(id2);
    tracker.add(id3);

    try std.testing.expectEqual(@as(u32, 3), tracker.getGraphemeCount());
    try std.testing.expect(tracker.contains(id1));
    try std.testing.expect(tracker.contains(id2));
    try std.testing.expect(tracker.contains(id3));
}

test "GraphemeTracker - add same grapheme twice increfs once" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const text = "a";
    const id = try pool.alloc(text);

    {
        var tracker = GraphemeTracker.init(std.testing.allocator, &pool);
        defer tracker.deinit();

        tracker.add(id);
        tracker.add(id); // Should not incref again

        try std.testing.expectEqual(@as(u32, 1), tracker.getGraphemeCount());

        // After deinit (via defer), should decref once
    }

    // Decref the original allocation
    try pool.decref(id);

    // Allocate new item to trigger slot reuse
    const text2 = "b";
    const id2 = try pool.alloc(text2);

    // Old ID should now be invalid due to generation change
    const result = pool.get(id);
    try std.testing.expectError(gp.GraphemePoolError.InvalidId, result);

    // Cleanup
    try pool.decref(id2);
}

test "GraphemeTracker - remove grapheme" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const text = "a";
    const id = try pool.alloc(text);

    var tracker = GraphemeTracker.init(std.testing.allocator, &pool);
    defer tracker.deinit();

    tracker.add(id);
    try std.testing.expect(tracker.contains(id));

    tracker.remove(id);
    try std.testing.expect(!tracker.contains(id));
    try std.testing.expectEqual(@as(u32, 0), tracker.getGraphemeCount());
}

test "GraphemeTracker - remove non-existent grapheme is safe" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const text = "a";
    const id = try pool.alloc(text);

    var tracker = GraphemeTracker.init(std.testing.allocator, &pool);
    defer tracker.deinit();

    // Remove without adding - should be safe
    tracker.remove(id);

    try std.testing.expectEqual(@as(u32, 0), tracker.getGraphemeCount());
}

test "GraphemeTracker - clear removes all graphemes" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const text1 = "a";
    const text2 = "b";
    const id1 = try pool.alloc(text1);
    const id2 = try pool.alloc(text2);

    var tracker = GraphemeTracker.init(std.testing.allocator, &pool);
    defer tracker.deinit();

    tracker.add(id1);
    tracker.add(id2);
    try std.testing.expectEqual(@as(u32, 2), tracker.getGraphemeCount());

    tracker.clear();

    try std.testing.expectEqual(@as(u32, 0), tracker.getGraphemeCount());
    try std.testing.expect(!tracker.contains(id1));
    try std.testing.expect(!tracker.contains(id2));
    try std.testing.expect(!tracker.hasAny());
}

test "GraphemeTracker - getTotalGraphemeBytes" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const text1 = "a"; // 1 byte
    const text2 = "🌟"; // 4 bytes
    const text3 = "test"; // 4 bytes

    const id1 = try pool.alloc(text1);
    const id2 = try pool.alloc(text2);
    const id3 = try pool.alloc(text3);

    var tracker = GraphemeTracker.init(std.testing.allocator, &pool);
    defer tracker.deinit();

    tracker.add(id1);
    tracker.add(id2);
    tracker.add(id3);

    const total_bytes = tracker.getTotalGraphemeBytes();
    try std.testing.expectEqual(@as(u32, 1 + 4 + 4), total_bytes);
}

test "GraphemeTracker - tracker keeps graphemes alive" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const text = "test";
    const id = try pool.alloc(text);

    {
        var tracker = GraphemeTracker.init(std.testing.allocator, &pool);
        defer tracker.deinit();

        tracker.add(id);

        // Decref the original allocation
        try pool.decref(id);

        // Should still be accessible because tracker holds a reference
        const retrieved = try pool.get(id);
        try std.testing.expectEqualSlices(u8, text, retrieved);

        // After tracker deinit (via defer), refcount will be 0
    }

    // Allocate new item to trigger slot reuse with new generation
    const text2 = "x";
    const id2 = try pool.alloc(text2);

    // Old ID should fail due to generation mismatch
    const result = pool.get(id);
    try std.testing.expectError(gp.GraphemePoolError.InvalidId, result);

    // Cleanup
    try pool.decref(id2);
}

test "GraphemeTracker - multiple trackers share same grapheme" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const text = "shared";
    const id = try pool.alloc(text);

    {
        var tracker1 = GraphemeTracker.init(std.testing.allocator, &pool);
        defer tracker1.deinit();

        {
            var tracker2 = GraphemeTracker.init(std.testing.allocator, &pool);
            defer tracker2.deinit();

            tracker1.add(id);
            tracker2.add(id);

            // Both should see it
            try std.testing.expect(tracker1.contains(id));
            try std.testing.expect(tracker2.contains(id));

            // Decref original
            try pool.decref(id);

            // Should still be accessible (ref count is 2)
            const retrieved = try pool.get(id);
            try std.testing.expectEqualSlices(u8, text, retrieved);

            // tracker2 deinit via defer here
        }

        // Should still be accessible (ref count is 1)
        const retrieved2 = try pool.get(id);
        try std.testing.expectEqualSlices(u8, text, retrieved2);

        // tracker1 deinit via defer here
    }

    // Allocate new item to trigger slot reuse with new generation
    const text2 = "y";
    const id2 = try pool.alloc(text2);

    // Old ID should fail due to generation mismatch
    const result = pool.get(id);
    try std.testing.expectError(gp.GraphemePoolError.InvalidId, result);

    // Cleanup
    try pool.decref(id2);
}

test "GraphemeTracker - stress test many graphemes" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    var tracker = GraphemeTracker.init(std.testing.allocator, &pool);
    defer tracker.deinit();

    const count = 500;
    var ids: [count]u32 = undefined;

    // Add many graphemes
    for (0..count) |i| {
        var buffer: [8]u8 = undefined;
        const len = std.fmt.formatIntBuf(&buffer, i, 10, .lower, .{});
        ids[i] = try pool.alloc(buffer[0..len]);
        tracker.add(ids[i]);
    }

    try std.testing.expectEqual(@as(u32, count), tracker.getGraphemeCount());

    // Verify all are tracked
    for (ids) |id| {
        try std.testing.expect(tracker.contains(id));
    }

    // Clear should remove all
    tracker.clear();
    try std.testing.expectEqual(@as(u32, 0), tracker.getGraphemeCount());

    for (ids) |id| {
        try std.testing.expect(!tracker.contains(id));
    }
}

// ===== Global Pool Tests =====

test "GraphemePool - global pool init and deinit" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();

    const text = "test";
    const id = try pool.alloc(text);

    const retrieved = try pool.get(id);
    try std.testing.expectEqualSlices(u8, text, retrieved);

    try pool.decref(id);
}

test "GraphemePool - global pool reinitialization returns same instance" {
    const pool1 = gp.initGlobalPool(std.testing.allocator);
    const pool2 = gp.initGlobalPool(std.testing.allocator);

    // Should return the same pool
    try std.testing.expectEqual(pool1, pool2);

    gp.deinitGlobalPool();
}

test "GraphemePool - global unicode data init" {
    const gd = gp.initGlobalUnicodeData(std.testing.allocator);
    defer gp.deinitGlobalUnicodeData(std.testing.allocator);

    const graphemes_ptr, const display_width_ptr = gd;

    // Pointers should not be null (just verify they're returned)
    // We can't easily test their validity without using them
    _ = graphemes_ptr;
    _ = display_width_ptr;
}

// ===== Unowned Memory Tests =====

test "GraphemePool - allocUnowned basic" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    // External memory that we manage
    const external_text = "external";
    const id = try pool.allocUnowned(external_text);

    // Should be able to retrieve the same memory
    const retrieved = try pool.get(id);
    try std.testing.expectEqualSlices(u8, external_text, retrieved);

    // Verify it's actually pointing to the same memory location
    try std.testing.expectEqual(@intFromPtr(external_text.ptr), @intFromPtr(retrieved.ptr));

    try pool.decref(id);
}

test "GraphemePool - allocUnowned multiple references" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const external_text1 = "external1";
    const external_text2 = "external2";
    const external_text3 = "external3";

    const id1 = try pool.allocUnowned(external_text1);
    const id2 = try pool.allocUnowned(external_text2);
    const id3 = try pool.allocUnowned(external_text3);

    // All should be retrievable
    try std.testing.expectEqualSlices(u8, external_text1, try pool.get(id1));
    try std.testing.expectEqualSlices(u8, external_text2, try pool.get(id2));
    try std.testing.expectEqualSlices(u8, external_text3, try pool.get(id3));

    // Verify they point to original memory
    try std.testing.expectEqual(@intFromPtr(external_text1.ptr), @intFromPtr((try pool.get(id1)).ptr));
    try std.testing.expectEqual(@intFromPtr(external_text2.ptr), @intFromPtr((try pool.get(id2)).ptr));
    try std.testing.expectEqual(@intFromPtr(external_text3.ptr), @intFromPtr((try pool.get(id3)).ptr));

    try pool.decref(id1);
    try pool.decref(id2);
    try pool.decref(id3);
}

test "GraphemePool - allocUnowned with emoji" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const external_emoji = "🌟🎉🚀";
    const id = try pool.allocUnowned(external_emoji);

    const retrieved = try pool.get(id);
    try std.testing.expectEqualSlices(u8, external_emoji, retrieved);
    try std.testing.expectEqual(@intFromPtr(external_emoji.ptr), @intFromPtr(retrieved.ptr));

    try pool.decref(id);
}

test "GraphemePool - allocUnowned refcounting" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const external_text = "refcount_test";
    const id = try pool.allocUnowned(external_text);

    // Increment refcount
    try pool.incref(id);
    try pool.incref(id);

    // Should still be accessible
    try std.testing.expectEqualSlices(u8, external_text, try pool.get(id));

    // Decrement
    try pool.decref(id);
    try std.testing.expectEqualSlices(u8, external_text, try pool.get(id));

    try pool.decref(id);
    try std.testing.expectEqualSlices(u8, external_text, try pool.get(id));

    // Final decref
    try pool.decref(id);
}

test "GraphemePool - mix owned and unowned allocations" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const owned_text = "owned";
    const external_text = "unowned";

    const owned_id = try pool.alloc(owned_text);
    const unowned_id = try pool.allocUnowned(external_text);

    // Both should be retrievable
    const retrieved_owned = try pool.get(owned_id);
    const retrieved_unowned = try pool.get(unowned_id);

    try std.testing.expectEqualSlices(u8, owned_text, retrieved_owned);
    try std.testing.expectEqualSlices(u8, external_text, retrieved_unowned);

    // Owned should be different memory location (copy)
    try std.testing.expect(@intFromPtr(owned_text.ptr) != @intFromPtr(retrieved_owned.ptr));

    // Unowned should be same memory location (reference)
    try std.testing.expectEqual(@intFromPtr(external_text.ptr), @intFromPtr(retrieved_unowned.ptr));

    try pool.decref(owned_id);
    try pool.decref(unowned_id);
}

test "GraphemePool - allocUnowned slot reuse" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const text1 = "first";
    const id1 = try pool.allocUnowned(text1);
    try pool.decref(id1);

    // Allocate again - should reuse slot
    const text2 = "second";
    const id2 = try pool.allocUnowned(text2);

    // Old ID should fail
    const result = pool.get(id1);
    try std.testing.expectError(gp.GraphemePoolError.InvalidId, result);

    // New ID should work and point to new memory
    const retrieved = try pool.get(id2);
    try std.testing.expectEqualSlices(u8, text2, retrieved);
    try std.testing.expectEqual(@intFromPtr(text2.ptr), @intFromPtr(retrieved.ptr));

    try pool.decref(id2);
}

test "GraphemePool - allocUnowned large text" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    // Large external buffer
    var large_buffer: [1000]u8 = undefined;
    @memset(&large_buffer, 'X');
    const large_slice: []const u8 = &large_buffer;

    const id = try pool.allocUnowned(large_slice);

    const retrieved = try pool.get(id);
    try std.testing.expectEqual(@as(usize, 1000), retrieved.len);
    try std.testing.expectEqualSlices(u8, large_slice, retrieved);
    try std.testing.expectEqual(@intFromPtr(large_slice.ptr), @intFromPtr(retrieved.ptr));

    try pool.decref(id);
}

test "GraphemeTracker - with unowned allocations" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const text1 = "external1";
    const text2 = "external2";

    const id1 = try pool.allocUnowned(text1);
    const id2 = try pool.allocUnowned(text2);

    var tracker = GraphemeTracker.init(std.testing.allocator, &pool);
    defer tracker.deinit();

    tracker.add(id1);
    tracker.add(id2);

    try std.testing.expectEqual(@as(u32, 2), tracker.getGraphemeCount());
    try std.testing.expect(tracker.contains(id1));
    try std.testing.expect(tracker.contains(id2));

    // Should still get correct bytes
    try std.testing.expectEqualSlices(u8, text1, try pool.get(id1));
    try std.testing.expectEqualSlices(u8, text2, try pool.get(id2));
}

test "GraphemeTracker - mix owned and unowned" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const owned_text = "owned_data";
    const external_text = "external_data";

    const owned_id = try pool.alloc(owned_text);
    const unowned_id = try pool.allocUnowned(external_text);

    var tracker = GraphemeTracker.init(std.testing.allocator, &pool);
    defer tracker.deinit();

    tracker.add(owned_id);
    tracker.add(unowned_id);

    try std.testing.expectEqual(@as(u32, 2), tracker.getGraphemeCount());

    const total_bytes = tracker.getTotalGraphemeBytes();
    try std.testing.expectEqual(@as(u32, owned_text.len + external_text.len), total_bytes);

    // Both should be retrievable
    try std.testing.expectEqualSlices(u8, owned_text, try pool.get(owned_id));
    try std.testing.expectEqualSlices(u8, external_text, try pool.get(unowned_id));
}

test "GraphemePool - allocUnowned with stack memory" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    // Simulate stack-allocated buffer
    var stack_buffer: [50]u8 = undefined;
    @memcpy(stack_buffer[0..11], "stack_based");
    const stack_slice = stack_buffer[0..11];

    const id = try pool.allocUnowned(stack_slice);

    const retrieved = try pool.get(id);
    try std.testing.expectEqualSlices(u8, "stack_based", retrieved);
    try std.testing.expectEqual(@intFromPtr(stack_slice.ptr), @intFromPtr(retrieved.ptr));

    try pool.decref(id);
    // Note: In real usage, caller must ensure stack_buffer stays valid while ID is in use
}

test "GraphemePool - allocUnowned zero-length slice" {
    var pool = GraphemePool.init(std.testing.allocator);
    defer pool.deinit();

    const empty: []const u8 = "";
    const id = try pool.allocUnowned(empty);

    const retrieved = try pool.get(id);
    try std.testing.expectEqual(@as(usize, 0), retrieved.len);

    try pool.decref(id);
}
