const std = @import("std");

pub const Handle = u32;

const INDEX_BITS = 16;
const GENERATION_BITS = 12;
const KIND_BITS = 4;
const INDEX_MASK: u32 = (1 << INDEX_BITS) - 1;
const GENERATION_MASK: u32 = (1 << GENERATION_BITS) - 1;
const MAX_SLOTS: usize = INDEX_MASK;

comptime {
    std.debug.assert(INDEX_BITS + GENERATION_BITS + KIND_BITS == 32);
}

pub const ObjectKind = enum(u4) {
    renderer = 0,
    optimized_buffer = 1,
    text_buffer = 2,
    text_buffer_view = 3,
    edit_buffer = 4,
    editor_view = 5,
    syntax_style = 6,
    event_sink = 7,
    audio_engine = 8,
    native_span_feed = 9,
};

const SlotState = enum(u8) {
    vacant,
    alive,
    destroying,
};

const ObjectSlot = struct {
    generation: u32 = 1,
    kind: ObjectKind = .renderer,
    state: SlotState = .vacant,
    ptr: ?*anyopaque = null,
    owned: bool = true,
    owner: Handle = 0,
    active_calls: u32 = 0,
};

pub const Error = error{
    OutOfHandles,
    OutOfMemory,
};

pub fn Guard(comptime T: type) type {
    return struct {
        handle: Handle,
        ptr: *T,

        pub fn release(self: @This()) void {
            releaseHandle(self.handle);
        }
    };
}

pub fn DestroyToken(comptime T: type) type {
    return struct {
        handle: Handle,
        ptr: *T,
    };
}

const allocator = std.heap.page_allocator;
var mutex: std.Thread.Mutex = .{};
var condition: std.Thread.Condition = .{};
var slots: std.ArrayList(ObjectSlot) = .empty;
var free_indices: std.ArrayList(u16) = .empty;

fn ensureInitializedLocked() Error!void {
    if (slots.items.len != 0) return;
    try slots.append(allocator, .{});
}

fn encode(index: u32, generation: u32, kind: ObjectKind) Handle {
    return (@as(u32, @intFromEnum(kind)) << (INDEX_BITS + GENERATION_BITS)) |
        ((generation & GENERATION_MASK) << INDEX_BITS) |
        (index & INDEX_MASK);
}

fn slotIndex(handle: Handle) u32 {
    return handle & INDEX_MASK;
}

fn slotGeneration(handle: Handle) u32 {
    return (handle >> INDEX_BITS) & GENERATION_MASK;
}

fn slotKind(handle: Handle) u4 {
    return @intCast(handle >> (INDEX_BITS + GENERATION_BITS));
}

fn nextGeneration(generation: u32) u32 {
    const next = (generation + 1) & GENERATION_MASK;
    return if (next == 0) 1 else next;
}

fn validateSlotLocked(handle: Handle, expected_kind: ObjectKind) ?u16 {
    if (handle == 0) return null;
    if (slotKind(handle) != @intFromEnum(expected_kind)) return null;

    const index_u32 = slotIndex(handle);
    if (index_u32 == 0 or index_u32 >= slots.items.len) return null;

    const index: u16 = @intCast(index_u32);
    const slot = &slots.items[index];
    if (slot.generation != slotGeneration(handle)) return null;
    if (slot.kind != expected_kind) return null;
    if (slot.state != .alive) return null;
    if (slot.ptr == null) return null;
    return index;
}

fn vacateSlotLocked(index: u16) void {
    const slot = &slots.items[index];
    slot.ptr = null;
    slot.state = .vacant;
    slot.owner = 0;
    slot.owned = true;
    slot.active_calls = 0;
    slot.generation = nextGeneration(slot.generation);
    free_indices.append(allocator, index) catch unreachable;
    condition.broadcast();
}

pub fn insert(kind: ObjectKind, ptr_value: *anyopaque) Error!Handle {
    return insertWithOwner(kind, ptr_value, true, 0);
}

pub fn insertBorrowed(kind: ObjectKind, ptr_value: *anyopaque, owner: Handle) Error!Handle {
    return insertWithOwner(kind, ptr_value, false, owner);
}

pub fn insertOwnedChild(kind: ObjectKind, ptr_value: *anyopaque, owner: Handle) Error!Handle {
    return insertWithOwner(kind, ptr_value, true, owner);
}

pub fn getOrInsertBorrowed(kind: ObjectKind, ptr_value: *anyopaque, owner: Handle) Error!Handle {
    mutex.lock();
    defer mutex.unlock();

    try ensureInitializedLocked();
    for (slots.items, 0..) |*slot, index| {
        if (index == 0) continue;
        if (slot.state == .alive and slot.kind == kind and slot.ptr == ptr_value and slot.owner == owner) {
            return encode(@intCast(index), slot.generation, kind);
        }
    }

    return insertWithOwnerLocked(kind, ptr_value, false, owner);
}

fn insertWithOwner(kind: ObjectKind, ptr_value: *anyopaque, owned: bool, owner: Handle) Error!Handle {
    mutex.lock();
    defer mutex.unlock();

    try ensureInitializedLocked();
    return insertWithOwnerLocked(kind, ptr_value, owned, owner);
}

fn insertWithOwnerLocked(kind: ObjectKind, ptr_value: *anyopaque, owned: bool, owner: Handle) Error!Handle {
    const index: u16 = if (free_indices.items.len > 0)
        free_indices.pop().?
    else blk: {
        if (slots.items.len > MAX_SLOTS) return Error.OutOfHandles;
        const new_index: u16 = @intCast(slots.items.len);
        try slots.append(allocator, .{});
        break :blk new_index;
    };

    const slot = &slots.items[index];
    slot.kind = kind;
    slot.state = .alive;
    slot.ptr = ptr_value;
    slot.owned = owned;
    slot.owner = owner;
    slot.active_calls = 0;

    return encode(index, slot.generation, kind);
}

pub fn acquire(handle: Handle, expected_kind: ObjectKind, comptime T: type) ?Guard(T) {
    mutex.lock();
    defer mutex.unlock();

    const index = validateSlotLocked(handle, expected_kind) orelse return null;
    var slot = &slots.items[index];
    slot.active_calls += 1;
    const typed_ptr: *T = @ptrCast(@alignCast(slot.ptr.?));
    return .{ .handle = handle, .ptr = typed_ptr };
}

pub fn resolve(handle: Handle, expected_kind: ObjectKind, comptime T: type) ?*T {
    if (acquire(handle, expected_kind, T)) |guard| {
        defer guard.release();
        return guard.ptr;
    }
    return null;
}

pub fn beginDestroy(handle: Handle, expected_kind: ObjectKind, comptime T: type) ?DestroyToken(T) {
    mutex.lock();
    defer mutex.unlock();

    const index = validateSlotLocked(handle, expected_kind) orelse return null;
    var slot = &slots.items[index];
    if (!slot.owned) return null;

    slot.state = .destroying;
    while (slot.active_calls != 0) {
        condition.wait(&mutex);
        slot = &slots.items[index];
    }

    const typed_ptr: *T = @ptrCast(@alignCast(slot.ptr.?));
    return .{ .handle = handle, .ptr = typed_ptr };
}

pub fn pause(handle: Handle, expected_kind: ObjectKind, comptime T: type) ?DestroyToken(T) {
    mutex.lock();
    defer mutex.unlock();

    const index = validateSlotLocked(handle, expected_kind) orelse return null;
    var slot = &slots.items[index];
    slot.state = .destroying;
    while (slot.active_calls != 0) {
        condition.wait(&mutex);
        slot = &slots.items[index];
    }

    const typed_ptr: *T = @ptrCast(@alignCast(slot.ptr.?));
    return .{ .handle = handle, .ptr = typed_ptr };
}

pub fn unpause(handle: Handle) void {
    mutex.lock();
    defer mutex.unlock();

    if (handle == 0) return;
    const index_u32 = slotIndex(handle);
    if (index_u32 == 0 or index_u32 >= slots.items.len) return;
    const index: u16 = @intCast(index_u32);
    var slot = &slots.items[index];
    if (slot.generation != slotGeneration(handle) or slot.state != .destroying or slot.ptr == null) return;
    slot.state = .alive;
    condition.broadcast();
}

pub fn finishDestroy(handle: Handle) void {
    mutex.lock();
    defer mutex.unlock();

    if (handle == 0) return;
    const index_u32 = slotIndex(handle);
    if (index_u32 == 0 or index_u32 >= slots.items.len) return;
    const index: u16 = @intCast(index_u32);
    const slot = &slots.items[index];
    if (slot.generation != slotGeneration(handle) or slot.state != .destroying) return;
    vacateSlotLocked(index);
}

pub fn isValid(handle: Handle, expected_kind: ObjectKind) bool {
    mutex.lock();
    defer mutex.unlock();

    return validateSlotLocked(handle, expected_kind) != null;
}

pub fn invalidate(handle: Handle, expected_kind: ObjectKind) void {
    mutex.lock();
    defer mutex.unlock();

    const index = validateSlotLocked(handle, expected_kind) orelse return;
    var slot = &slots.items[index];
    slot.state = .destroying;
    while (slot.active_calls != 0) {
        condition.wait(&mutex);
        slot = &slots.items[index];
    }
    vacateSlotLocked(index);
}

pub fn invalidateChildren(owner: Handle) void {
    mutex.lock();
    defer mutex.unlock();

    invalidateChildrenLocked(owner);
}

fn invalidateChildrenLocked(owner: Handle) void {
    var changed = true;
    while (changed) {
        changed = false;
        for (slots.items, 0..) |*slot, index| {
            if (index == 0) continue;
            if (slot.state != .alive or slot.owner != owner) continue;

            const child_handle = encode(@intCast(index), slot.generation, slot.kind);
            slot.state = .destroying;
            while (slot.active_calls != 0) {
                condition.wait(&mutex);
            }
            invalidateChildrenLocked(child_handle);
            vacateSlotLocked(@intCast(index));
            changed = true;
            break;
        }
    }
}

pub fn collectChildren(owner: Handle, kind: ?ObjectKind, alloc: std.mem.Allocator) Error![]Handle {
    mutex.lock();
    defer mutex.unlock();

    var result: std.ArrayList(Handle) = .empty;
    errdefer result.deinit(alloc);

    for (slots.items, 0..) |*slot, index| {
        if (index == 0) continue;
        if (slot.state != .alive or slot.owner != owner) continue;
        if (kind) |expected| {
            if (slot.kind != expected) continue;
        }
        try result.append(alloc, encode(@intCast(index), slot.generation, slot.kind));
    }

    return result.toOwnedSlice(alloc);
}

pub fn collectByKind(kind: ObjectKind, alloc: std.mem.Allocator) Error![]Handle {
    mutex.lock();
    defer mutex.unlock();

    var result: std.ArrayList(Handle) = .empty;
    errdefer result.deinit(alloc);

    for (slots.items, 0..) |*slot, index| {
        if (index == 0) continue;
        if (slot.state != .alive or slot.kind != kind) continue;
        try result.append(alloc, encode(@intCast(index), slot.generation, slot.kind));
    }

    return result.toOwnedSlice(alloc);
}

pub fn liveCount(kind: ObjectKind) usize {
    mutex.lock();
    defer mutex.unlock();

    var count: usize = 0;
    for (slots.items) |slot| {
        if (slot.state == .alive and slot.kind == kind) count += 1;
    }
    return count;
}

fn releaseHandle(handle: Handle) void {
    mutex.lock();
    defer mutex.unlock();

    if (handle == 0) return;
    const index_u32 = slotIndex(handle);
    if (index_u32 == 0 or index_u32 >= slots.items.len) return;
    var slot = &slots.items[@intCast(index_u32)];
    if (slot.generation != slotGeneration(handle) or slot.active_calls == 0) return;
    slot.active_calls -= 1;
    if (slot.active_calls == 0) condition.broadcast();
}

pub fn resetForTesting() void {
    mutex.lock();
    defer mutex.unlock();

    slots.clearRetainingCapacity();
    free_indices.clearRetainingCapacity();
    slots.append(allocator, .{}) catch unreachable;
    condition.broadcast();
}

test "handles insert and resolve" {
    resetForTesting();
    var value: u32 = 42;
    const handle = try insert(.renderer, &value);
    try std.testing.expect(handle != 0);

    const resolved = resolve(handle, .renderer, u32) orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(@as(*u32, &value), resolved);
}

test "handles reject wrong kind and zero" {
    resetForTesting();
    var value: u32 = 42;
    const handle = try insert(.renderer, &value);

    try std.testing.expect(resolve(handle, .optimized_buffer, u32) == null);
    try std.testing.expect(resolve(0, .renderer, u32) == null);
}

test "handles double destroy is rejected" {
    resetForTesting();
    var value: u32 = 42;
    const handle = try insert(.renderer, &value);

    const token = beginDestroy(handle, .renderer, u32) orelse return error.TestUnexpectedResult;
    finishDestroy(token.handle);

    try std.testing.expect(beginDestroy(handle, .renderer, u32) == null);
}

test "handles reject stale generation after reuse" {
    resetForTesting();
    var first: u32 = 1;
    var second: u32 = 2;

    const stale = try insert(.renderer, &first);
    const token = beginDestroy(stale, .renderer, u32) orelse return error.TestUnexpectedResult;
    finishDestroy(token.handle);

    const fresh = try insert(.renderer, &second);
    try std.testing.expect(stale != fresh);
    try std.testing.expect(resolve(stale, .renderer, u32) == null);
    try std.testing.expectEqual(@as(*u32, &second), resolve(fresh, .renderer, u32).?);
}

test "handles mark destroying before destructor body" {
    resetForTesting();
    var value: u32 = 42;
    const handle = try insert(.renderer, &value);

    const token = beginDestroy(handle, .renderer, u32) orelse return error.TestUnexpectedResult;
    try std.testing.expect(resolve(handle, .renderer, u32) == null);
    finishDestroy(token.handle);
}

test "handles pause and resume temporarily reject calls" {
    resetForTesting();
    var value: u32 = 42;
    const handle = try insert(.renderer, &value);

    const token = pause(handle, .renderer, u32) orelse return error.TestUnexpectedResult;
    try std.testing.expect(resolve(handle, .renderer, u32) == null);
    unpause(token.handle);
    try std.testing.expect(resolve(handle, .renderer, u32) != null);
}

test "borrowed handles are stable and invalidated with owner" {
    resetForTesting();
    var owner_value: u32 = 1;
    var child_value: u32 = 2;
    const owner = try insert(.renderer, &owner_value);
    const child_a = try getOrInsertBorrowed(.optimized_buffer, &child_value, owner);
    const child_b = try getOrInsertBorrowed(.optimized_buffer, &child_value, owner);
    try std.testing.expectEqual(child_a, child_b);
    try std.testing.expect(isValid(child_a, .optimized_buffer));

    invalidateChildren(owner);
    try std.testing.expect(!isValid(child_a, .optimized_buffer));
}
