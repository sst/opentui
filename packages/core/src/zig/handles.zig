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
};

const SlotState = enum(u8) {
    vacant,
    alive,
    destroying,
};

const VACANT: u8 = @intFromEnum(SlotState.vacant);
const ALIVE: u8 = @intFromEnum(SlotState.alive);
const DESTROYING: u8 = @intFromEnum(SlotState.destroying);

const ObjectSlot = struct {
    generation: u32 = 1,
    kind: u8 = 0,
    state: u8 = VACANT,
    ptr: usize = 0,
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
var slots: [MAX_SLOTS + 1]ObjectSlot = [_]ObjectSlot{.{}} ** (MAX_SLOTS + 1);
var slot_count: u32 = 1;
var free_indices: std.ArrayList(u16) = .empty;

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

fn atomicLoad(comptime T: type, value: *T) T {
    return @atomicLoad(T, value, .acquire);
}

fn atomicStore(comptime T: type, value: *T, new_value: T) void {
    @atomicStore(T, value, new_value, .release);
}

fn validateSlotLocked(handle: Handle, expected_kind: ObjectKind) ?u16 {
    if (handle == 0) return null;
    if (slotKind(handle) != @intFromEnum(expected_kind)) return null;

    const index_u32 = slotIndex(handle);
    if (index_u32 == 0 or index_u32 >= slot_count) return null;

    const index: u16 = @intCast(index_u32);
    const slot = &slots[index];
    if (atomicLoad(u32, &slot.generation) != slotGeneration(handle)) return null;
    if (atomicLoad(u8, &slot.kind) != @intFromEnum(expected_kind)) return null;
    if (atomicLoad(u8, &slot.state) != ALIVE) return null;
    if (atomicLoad(usize, &slot.ptr) == 0) return null;
    return index;
}

fn waitForInactiveLocked(slot: *ObjectSlot) void {
    while (atomicLoad(u32, &slot.active_calls) != 0) {
        mutex.unlock();
        std.Thread.yield() catch {};
        mutex.lock();
    }
}

fn vacateSlotLocked(index: u16) void {
    const slot = &slots[index];
    atomicStore(usize, &slot.ptr, 0);
    atomicStore(u32, &slot.active_calls, 0);
    slot.owner = 0;
    slot.owned = true;
    atomicStore(u8, &slot.kind, 0);
    atomicStore(u32, &slot.generation, nextGeneration(atomicLoad(u32, &slot.generation)));
    atomicStore(u8, &slot.state, VACANT);
    free_indices.append(allocator, index) catch unreachable;
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

    const raw_ptr = @intFromPtr(ptr_value);
    var index: usize = 1;
    while (index < slot_count) : (index += 1) {
        const slot = &slots[index];
        if (atomicLoad(u8, &slot.state) == ALIVE and
            atomicLoad(u8, &slot.kind) == @intFromEnum(kind) and
            atomicLoad(usize, &slot.ptr) == raw_ptr and
            slot.owner == owner)
        {
            return encode(@intCast(index), atomicLoad(u32, &slot.generation), kind);
        }
    }

    return insertWithOwnerLocked(kind, ptr_value, false, owner);
}

fn insertWithOwner(kind: ObjectKind, ptr_value: *anyopaque, owned: bool, owner: Handle) Error!Handle {
    mutex.lock();
    defer mutex.unlock();

    return insertWithOwnerLocked(kind, ptr_value, owned, owner);
}

fn insertWithOwnerLocked(kind: ObjectKind, ptr_value: *anyopaque, owned: bool, owner: Handle) Error!Handle {
    const index: u16 = if (free_indices.items.len > 0)
        free_indices.pop().?
    else blk: {
        if (slot_count > MAX_SLOTS) return Error.OutOfHandles;
        const new_index: u16 = @intCast(slot_count);
        slot_count += 1;
        break :blk new_index;
    };

    const slot = &slots[index];
    atomicStore(u32, &slot.active_calls, 0);
    slot.owned = owned;
    slot.owner = owner;
    atomicStore(u8, &slot.kind, @intFromEnum(kind));
    atomicStore(usize, &slot.ptr, @intFromPtr(ptr_value));
    atomicStore(u8, &slot.state, ALIVE);

    return encode(index, atomicLoad(u32, &slot.generation), kind);
}

pub fn acquire(handle: Handle, expected_kind: ObjectKind, comptime T: type) ?Guard(T) {
    if (handle == 0) return null;
    if (slotKind(handle) != @intFromEnum(expected_kind)) return null;

    const index_u32 = slotIndex(handle);
    if (index_u32 == 0 or index_u32 >= atomicLoad(u32, &slot_count)) return null;

    const slot = &slots[@intCast(index_u32)];
    if (atomicLoad(u32, &slot.generation) != slotGeneration(handle)) return null;
    if (atomicLoad(u8, &slot.kind) != @intFromEnum(expected_kind)) return null;
    if (atomicLoad(u8, &slot.state) != ALIVE) return null;

    _ = @atomicRmw(u32, &slot.active_calls, .Add, 1, .acq_rel);

    if (atomicLoad(u32, &slot.generation) != slotGeneration(handle) or
        atomicLoad(u8, &slot.kind) != @intFromEnum(expected_kind) or
        atomicLoad(u8, &slot.state) != ALIVE)
    {
        releaseHandle(handle);
        return null;
    }

    const raw_ptr = atomicLoad(usize, &slot.ptr);
    if (raw_ptr == 0) {
        releaseHandle(handle);
        return null;
    }

    const opaque_ptr: *anyopaque = @ptrFromInt(raw_ptr);
    const typed_ptr: *T = @ptrCast(@alignCast(opaque_ptr));
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
    const slot = &slots[index];
    if (!slot.owned) return null;
    if (@cmpxchgStrong(u8, &slot.state, ALIVE, DESTROYING, .acq_rel, .acquire) != null) return null;

    waitForInactiveLocked(slot);
    const raw_ptr = atomicLoad(usize, &slot.ptr);
    if (raw_ptr == 0) return null;
    const opaque_ptr: *anyopaque = @ptrFromInt(raw_ptr);
    const typed_ptr: *T = @ptrCast(@alignCast(opaque_ptr));
    return .{ .handle = handle, .ptr = typed_ptr };
}

pub fn pause(handle: Handle, expected_kind: ObjectKind, comptime T: type) ?DestroyToken(T) {
    mutex.lock();
    defer mutex.unlock();

    const index = validateSlotLocked(handle, expected_kind) orelse return null;
    const slot = &slots[index];
    if (@cmpxchgStrong(u8, &slot.state, ALIVE, DESTROYING, .acq_rel, .acquire) != null) return null;

    waitForInactiveLocked(slot);
    const raw_ptr = atomicLoad(usize, &slot.ptr);
    if (raw_ptr == 0) return null;
    const opaque_ptr: *anyopaque = @ptrFromInt(raw_ptr);
    const typed_ptr: *T = @ptrCast(@alignCast(opaque_ptr));
    return .{ .handle = handle, .ptr = typed_ptr };
}

pub fn unpause(handle: Handle) void {
    mutex.lock();
    defer mutex.unlock();

    if (handle == 0) return;
    const index_u32 = slotIndex(handle);
    if (index_u32 == 0 or index_u32 >= slot_count) return;
    const slot = &slots[@intCast(index_u32)];
    if (atomicLoad(u32, &slot.generation) != slotGeneration(handle) or
        atomicLoad(u8, &slot.state) != DESTROYING or
        atomicLoad(usize, &slot.ptr) == 0)
    {
        return;
    }
    atomicStore(u8, &slot.state, ALIVE);
}

pub fn finishDestroy(handle: Handle) void {
    mutex.lock();
    defer mutex.unlock();

    if (handle == 0) return;
    const index_u32 = slotIndex(handle);
    if (index_u32 == 0 or index_u32 >= slot_count) return;
    const index: u16 = @intCast(index_u32);
    const slot = &slots[index];
    if (atomicLoad(u32, &slot.generation) != slotGeneration(handle) or atomicLoad(u8, &slot.state) != DESTROYING) return;
    vacateSlotLocked(index);
}

pub fn isValid(handle: Handle, expected_kind: ObjectKind) bool {
    if (handle == 0) return false;
    if (slotKind(handle) != @intFromEnum(expected_kind)) return false;
    const index_u32 = slotIndex(handle);
    if (index_u32 == 0 or index_u32 >= atomicLoad(u32, &slot_count)) return false;
    const slot = &slots[@intCast(index_u32)];
    return atomicLoad(u32, &slot.generation) == slotGeneration(handle) and
        atomicLoad(u8, &slot.kind) == @intFromEnum(expected_kind) and
        atomicLoad(u8, &slot.state) == ALIVE and
        atomicLoad(usize, &slot.ptr) != 0;
}

pub fn invalidate(handle: Handle, expected_kind: ObjectKind) void {
    mutex.lock();
    defer mutex.unlock();

    const index = validateSlotLocked(handle, expected_kind) orelse return;
    const slot = &slots[index];
    if (@cmpxchgStrong(u8, &slot.state, ALIVE, DESTROYING, .acq_rel, .acquire) != null) return;
    waitForInactiveLocked(slot);
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
        var index: usize = 1;
        while (index < slot_count) : (index += 1) {
            const slot = &slots[index];
            if (atomicLoad(u8, &slot.state) != ALIVE or slot.owner != owner) continue;

            const child_handle = encode(@intCast(index), atomicLoad(u32, &slot.generation), @enumFromInt(atomicLoad(u8, &slot.kind)));
            if (@cmpxchgStrong(u8, &slot.state, ALIVE, DESTROYING, .acq_rel, .acquire) != null) continue;
            waitForInactiveLocked(slot);
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

    var index: usize = 1;
    while (index < slot_count) : (index += 1) {
        const slot = &slots[index];
        if (atomicLoad(u8, &slot.state) != ALIVE or slot.owner != owner) continue;
        const slot_kind: ObjectKind = @enumFromInt(atomicLoad(u8, &slot.kind));
        if (kind) |expected| {
            if (slot_kind != expected) continue;
        }
        try result.append(alloc, encode(@intCast(index), atomicLoad(u32, &slot.generation), slot_kind));
    }

    return result.toOwnedSlice(alloc);
}

pub fn collectByKind(kind: ObjectKind, alloc: std.mem.Allocator) Error![]Handle {
    mutex.lock();
    defer mutex.unlock();

    var result: std.ArrayList(Handle) = .empty;
    errdefer result.deinit(alloc);

    var index: usize = 1;
    while (index < slot_count) : (index += 1) {
        const slot = &slots[index];
        if (atomicLoad(u8, &slot.state) != ALIVE or atomicLoad(u8, &slot.kind) != @intFromEnum(kind)) continue;
        try result.append(alloc, encode(@intCast(index), atomicLoad(u32, &slot.generation), kind));
    }

    return result.toOwnedSlice(alloc);
}

pub fn liveCount(kind: ObjectKind) usize {
    var count: usize = 0;
    var index: usize = 1;
    while (index < atomicLoad(u32, &slot_count)) : (index += 1) {
        const slot = &slots[index];
        if (atomicLoad(u8, &slot.state) == ALIVE and atomicLoad(u8, &slot.kind) == @intFromEnum(kind)) count += 1;
    }
    return count;
}

fn releaseHandle(handle: Handle) void {
    if (handle == 0) return;
    const index_u32 = slotIndex(handle);
    if (index_u32 == 0 or index_u32 >= atomicLoad(u32, &slot_count)) return;
    const slot = &slots[@intCast(index_u32)];
    if (atomicLoad(u32, &slot.generation) != slotGeneration(handle)) return;
    _ = @atomicRmw(u32, &slot.active_calls, .Sub, 1, .acq_rel);
}

pub fn resetForTesting() void {
    mutex.lock();
    defer mutex.unlock();

    for (&slots) |*slot| {
        slot.* = .{};
    }
    slot_count = 1;
    free_indices.clearRetainingCapacity();
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

test "handles pause and unpause temporarily reject calls" {
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
