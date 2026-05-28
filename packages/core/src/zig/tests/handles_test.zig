const std = @import("std");
const handles = @import("../handles.zig");

test "handles insert and resolve" {
    handles.resetForTesting();
    var value: u32 = 42;
    const handle = try handles.insert(.renderer, &value);
    try std.testing.expect(handle != 0);

    const resolved = handles.resolve(handle, .renderer, u32) orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(@as(*u32, &value), resolved);
}

test "handles reject wrong kind and zero" {
    handles.resetForTesting();
    var value: u32 = 42;
    const handle = try handles.insert(.renderer, &value);

    try std.testing.expect(handles.resolve(handle, .optimized_buffer, u32) == null);
    try std.testing.expect(handles.resolve(0, .renderer, u32) == null);
}

test "handles double destroy is rejected" {
    handles.resetForTesting();
    var value: u32 = 42;
    const handle = try handles.insert(.renderer, &value);

    const token = handles.beginDestroy(handle, .renderer, u32) orelse return error.TestUnexpectedResult;
    handles.finishDestroy(token.handle);

    try std.testing.expect(handles.beginDestroy(handle, .renderer, u32) == null);
}

test "handles reject stale generation after reuse" {
    handles.resetForTesting();
    var first: u32 = 1;
    var second: u32 = 2;

    const stale = try handles.insert(.renderer, &first);
    const token = handles.beginDestroy(stale, .renderer, u32) orelse return error.TestUnexpectedResult;
    handles.finishDestroy(token.handle);

    const fresh = try handles.insert(.renderer, &second);
    try std.testing.expect(stale != fresh);
    try std.testing.expect(handles.resolve(stale, .renderer, u32) == null);
    try std.testing.expectEqual(@as(*u32, &second), handles.resolve(fresh, .renderer, u32).?);

    const fresh_token = handles.beginDestroy(fresh, .renderer, u32) orelse return error.TestUnexpectedResult;
    handles.finishDestroy(fresh_token.handle);
}

test "handles mark destroying before destructor body" {
    handles.resetForTesting();
    var value: u32 = 42;
    const handle = try handles.insert(.renderer, &value);

    const token = handles.beginDestroy(handle, .renderer, u32) orelse return error.TestUnexpectedResult;
    try std.testing.expect(handles.resolve(handle, .renderer, u32) == null);
    handles.finishDestroy(token.handle);
}

test "handles pause and unpause temporarily reject calls" {
    handles.resetForTesting();
    var value: u32 = 42;
    const handle = try handles.insert(.renderer, &value);

    const token = handles.pause(handle, .renderer, u32) orelse return error.TestUnexpectedResult;
    try std.testing.expect(handles.resolve(handle, .renderer, u32) == null);
    handles.unpause(token.handle);
    try std.testing.expect(handles.resolve(handle, .renderer, u32) != null);
}

test "borrowed handles are stable and invalidated with owner" {
    handles.resetForTesting();
    var owner_value: u32 = 1;
    var child_value: u32 = 2;
    const owner = try handles.insert(.renderer, &owner_value);
    const child_a = try handles.getOrInsertBorrowed(.optimized_buffer, &child_value, owner);
    const child_b = try handles.getOrInsertBorrowed(.optimized_buffer, &child_value, owner);
    try std.testing.expectEqual(child_a, child_b);
    try std.testing.expect(handles.isValid(child_a, .optimized_buffer));
    try std.testing.expect(!handles.isOwned(child_a, .optimized_buffer));

    handles.invalidateChildren(owner);
    try std.testing.expect(!handles.isValid(child_a, .optimized_buffer));
}
