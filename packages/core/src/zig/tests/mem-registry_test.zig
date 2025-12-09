const std = @import("std");
const mem_registry = @import("../mem-registry.zig");

const MemRegistry = mem_registry.MemRegistry;
const MemRegistryError = mem_registry.MemRegistryError;

test "MemRegistry - init and deinit" {
    var registry = MemRegistry.init(std.testing.allocator);
    defer registry.deinit();

    try std.testing.expectEqual(@as(usize, 0), registry.getUsedSlots());
    try std.testing.expectEqual(@as(usize, 255), registry.getFreeSlots());
}

test "MemRegistry - register owned memory" {
    var registry = MemRegistry.init(std.testing.allocator);
    defer registry.deinit();

    const text = try std.testing.allocator.dupe(u8, "Hello, World!");
    const id = try registry.register(text, true);

    try std.testing.expectEqual(@as(u8, 0), id);
    try std.testing.expectEqual(@as(usize, 1), registry.getUsedSlots());
    try std.testing.expectEqual(@as(usize, 254), registry.getFreeSlots());

    const retrieved = registry.get(id);
    try std.testing.expect(retrieved != null);
    try std.testing.expectEqualStrings("Hello, World!", retrieved.?);
}

test "MemRegistry - register non-owned memory" {
    var registry = MemRegistry.init(std.testing.allocator);
    defer registry.deinit();

    const text = "Hello, World!";
    const id = try registry.register(text, false);

    try std.testing.expectEqual(@as(u8, 0), id);
    try std.testing.expectEqual(@as(usize, 1), registry.getUsedSlots());

    const retrieved = registry.get(id);
    try std.testing.expect(retrieved != null);
    try std.testing.expectEqualStrings("Hello, World!", retrieved.?);
}

test "MemRegistry - register multiple buffers" {
    var registry = MemRegistry.init(std.testing.allocator);
    defer registry.deinit();

    const text1 = "First";
    const text2 = "Second";
    const text3 = "Third";

    const id1 = try registry.register(text1, false);
    const id2 = try registry.register(text2, false);
    const id3 = try registry.register(text3, false);

    try std.testing.expectEqual(@as(u8, 0), id1);
    try std.testing.expectEqual(@as(u8, 1), id2);
    try std.testing.expectEqual(@as(u8, 2), id3);
    try std.testing.expectEqual(@as(usize, 3), registry.getUsedSlots());
    try std.testing.expectEqual(@as(usize, 252), registry.getFreeSlots());

    try std.testing.expectEqualStrings("First", registry.get(id1).?);
    try std.testing.expectEqualStrings("Second", registry.get(id2).?);
    try std.testing.expectEqualStrings("Third", registry.get(id3).?);
}

test "MemRegistry - get invalid ID returns null" {
    var registry = MemRegistry.init(std.testing.allocator);
    defer registry.deinit();

    const text = "Test";
    _ = try registry.register(text, false);

    try std.testing.expect(registry.get(1) == null);
    try std.testing.expect(registry.get(5) == null);
    try std.testing.expect(registry.get(255) == null);
}

test "MemRegistry - replace owned buffer" {
    var registry = MemRegistry.init(std.testing.allocator);
    defer registry.deinit();

    const text1 = try std.testing.allocator.dupe(u8, "Original");
    const id = try registry.register(text1, true);

    const text2 = try std.testing.allocator.dupe(u8, "Replaced");
    try registry.replace(id, text2, true);

    const retrieved = registry.get(id);
    try std.testing.expect(retrieved != null);
    try std.testing.expectEqualStrings("Replaced", retrieved.?);
    try std.testing.expectEqual(@as(usize, 1), registry.getUsedSlots());
}

test "MemRegistry - replace non-owned buffer with owned" {
    var registry = MemRegistry.init(std.testing.allocator);
    defer registry.deinit();

    const text1 = "Original";
    const id = try registry.register(text1, false);

    const text2 = try std.testing.allocator.dupe(u8, "Replaced");
    try registry.replace(id, text2, true);

    const retrieved = registry.get(id);
    try std.testing.expect(retrieved != null);
    try std.testing.expectEqualStrings("Replaced", retrieved.?);
}

test "MemRegistry - replace with invalid ID" {
    var registry = MemRegistry.init(std.testing.allocator);
    defer registry.deinit();

    const text = "Test";
    const result = registry.replace(5, text, false);
    try std.testing.expectError(MemRegistryError.InvalidMemId, result);
}

test "MemRegistry - clear owned buffers" {
    var registry = MemRegistry.init(std.testing.allocator);
    defer registry.deinit();

    const text1 = try std.testing.allocator.dupe(u8, "First");
    const text2 = try std.testing.allocator.dupe(u8, "Second");
    _ = try registry.register(text1, true);
    _ = try registry.register(text2, true);

    try std.testing.expectEqual(@as(usize, 2), registry.getUsedSlots());

    registry.clear();

    try std.testing.expectEqual(@as(usize, 0), registry.getUsedSlots());
    try std.testing.expectEqual(@as(usize, 255), registry.getFreeSlots());
}

test "MemRegistry - clear non-owned buffers" {
    var registry = MemRegistry.init(std.testing.allocator);
    defer registry.deinit();

    const text1 = "First";
    const text2 = "Second";
    _ = try registry.register(text1, false);
    _ = try registry.register(text2, false);

    try std.testing.expectEqual(@as(usize, 2), registry.getUsedSlots());

    registry.clear();

    try std.testing.expectEqual(@as(usize, 0), registry.getUsedSlots());
}

test "MemRegistry - max capacity" {
    var registry = MemRegistry.init(std.testing.allocator);
    defer registry.deinit();

    var i: usize = 0;
    while (i < 255) : (i += 1) {
        const text = "test";
        _ = try registry.register(text, false);
    }

    try std.testing.expectEqual(@as(usize, 255), registry.getUsedSlots());
    try std.testing.expectEqual(@as(usize, 0), registry.getFreeSlots());

    const text = "overflow";
    const result = registry.register(text, false);
    try std.testing.expectError(MemRegistryError.OutOfMemory, result);
}

test "MemRegistry - clear and reuse" {
    var registry = MemRegistry.init(std.testing.allocator);
    defer registry.deinit();

    const text1 = "First";
    const id1 = try registry.register(text1, false);
    try std.testing.expectEqual(@as(u8, 0), id1);

    registry.clear();

    const text2 = "Second";
    const id2 = try registry.register(text2, false);
    try std.testing.expectEqual(@as(u8, 0), id2);
    try std.testing.expectEqualStrings("Second", registry.get(id2).?);
}

test "MemRegistry - mixed owned and non-owned buffers" {
    var registry = MemRegistry.init(std.testing.allocator);
    defer registry.deinit();

    const owned = try std.testing.allocator.dupe(u8, "Owned");
    const non_owned = "Not Owned";

    const id1 = try registry.register(owned, true);
    const id2 = try registry.register(non_owned, false);

    try std.testing.expectEqual(@as(usize, 2), registry.getUsedSlots());

    try std.testing.expectEqualStrings("Owned", registry.get(id1).?);
    try std.testing.expectEqualStrings("Not Owned", registry.get(id2).?);

    registry.clear();
    try std.testing.expectEqual(@as(usize, 0), registry.getUsedSlots());
}

test "MemRegistry - large buffer registration" {
    var registry = MemRegistry.init(std.testing.allocator);
    defer registry.deinit();

    const large_text = [_]u8{'A'} ** 10000;
    const id = try registry.register(&large_text, false);

    const retrieved = registry.get(id);
    try std.testing.expect(retrieved != null);
    try std.testing.expectEqual(@as(usize, 10000), retrieved.?.len);
}

test "MemRegistry - empty buffer registration" {
    var registry = MemRegistry.init(std.testing.allocator);
    defer registry.deinit();

    const empty = "";
    const id = try registry.register(empty, false);

    const retrieved = registry.get(id);
    try std.testing.expect(retrieved != null);
    try std.testing.expectEqual(@as(usize, 0), retrieved.?.len);
}

test "MemRegistry - sequential replace operations" {
    var registry = MemRegistry.init(std.testing.allocator);
    defer registry.deinit();

    const text1 = "First";
    const id = try registry.register(text1, false);

    const text2 = "Second";
    try registry.replace(id, text2, false);
    try std.testing.expectEqualStrings("Second", registry.get(id).?);

    const text3 = "Third";
    try registry.replace(id, text3, false);
    try std.testing.expectEqualStrings("Third", registry.get(id).?);

    try std.testing.expectEqual(@as(usize, 1), registry.getUsedSlots());
}

test "MemRegistry - replace owned with non-owned" {
    var registry = MemRegistry.init(std.testing.allocator);
    defer registry.deinit();

    const text1 = try std.testing.allocator.dupe(u8, "Owned");
    const id = try registry.register(text1, true);

    const text2 = "Not Owned";
    try registry.replace(id, text2, false);

    const retrieved = registry.get(id);
    try std.testing.expect(retrieved != null);
    try std.testing.expectEqualStrings("Not Owned", retrieved.?);
    try std.testing.expectEqual(@as(usize, 1), registry.getUsedSlots());
}

test "MemRegistry - stress test with many registrations and clears" {
    var registry = MemRegistry.init(std.testing.allocator);
    defer registry.deinit();

    var round: usize = 0;
    while (round < 10) : (round += 1) {
        var i: usize = 0;
        while (i < 50) : (i += 1) {
            const text = "test";
            _ = try registry.register(text, false);
        }
        try std.testing.expectEqual(@as(usize, 50), registry.getUsedSlots());
        registry.clear();
        try std.testing.expectEqual(@as(usize, 0), registry.getUsedSlots());
    }
}
