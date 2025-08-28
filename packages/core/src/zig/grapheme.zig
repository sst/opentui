const std = @import("std");

pub const GraphemePoolError = error{
    OutOfMemory,
    InvalidId,
};

// Encoding flags for char buffer entries (u32)
// Bits 31-30: encoding type
//   00xxxxxxxx: direct unicode scalar value (30 bits, as-is)
//   10xxxxxxxx: grapheme start cell with pool ID (26 bits total payload)
//   11xxxxxxxx: continuation cell marker for wide/grapheme rendering
pub const CHAR_FLAG_GRAPHEME: u32 = 0x8000_0000;
pub const CHAR_FLAG_CONTINUATION: u32 = 0xC000_0000;

// For grapheme start and continuation cells:
// Bits 29..28: right extent (u2), Bits 27..26: left extent (u2)
pub const CHAR_EXT_RIGHT_SHIFT: u5 = 28;
pub const CHAR_EXT_LEFT_SHIFT: u5 = 26;
pub const CHAR_EXT_MASK: u32 = 0x3;

// Low 26 bits carry the global grapheme ID payload for start cells
pub const GRAPHEME_ID_MASK: u32 = 0x03FF_FFFF;

/// Global slab-allocated pool for grapheme clusters (byte slices)
/// This is total overkill probably, but fun
/// ID layout (26-bit payload):
/// [ class (3 bits) | slot_index (23 bits) ]
pub const GraphemePool = struct {
    const MAX_CLASSES: u5 = 5; // 0..4 => 8,16,32,64,128
    const CLASS_SIZES = [_]u32{ 8, 16, 32, 64, 128 };
    const SLOTS_PER_PAGE = [_]u32{ 256, 128, 64, 16, 8 };
    const CLASS_BITS: u5 = 3;
    const SLOT_BITS: u5 = 23;
    const CLASS_MASK: u32 = (@as(u32, 1) << CLASS_BITS) - 1; // 0b111
    const SLOT_MASK: u32 = (@as(u32, 1) << SLOT_BITS) - 1;

    pub const IdPayload = u32;

    allocator: std.mem.Allocator,
    classes: [MAX_CLASSES]ClassPool,

    const SlotHeader = packed struct {
        len: u16,
        refcount: u32,
    };

    pub fn init(allocator: std.mem.Allocator) GraphemePool {
        var classes: [MAX_CLASSES]ClassPool = undefined;
        var i: usize = 0;
        while (i < MAX_CLASSES) : (i += 1) {
            classes[i] = ClassPool.init(allocator, CLASS_SIZES[i], SLOTS_PER_PAGE[i]);
        }
        return .{ .allocator = allocator, .classes = classes };
    }

    pub fn deinit(self: *GraphemePool) void {
        var i: usize = 0;
        while (i < MAX_CLASSES) : (i += 1) {
            self.classes[i].deinit();
        }
    }

    fn classForSize(size: usize) u32 {
        if (size <= 8) return 0;
        if (size <= 16) return 1;
        if (size <= 32) return 2;
        if (size <= 64) return 3;
        return 4; // up to 128
    }

    pub fn alloc(self: *GraphemePool, bytes: []const u8) GraphemePoolError!IdPayload {
        const class_id: u32 = classForSize(bytes.len);
        const slot_index = try self.classes[class_id].alloc(bytes);
        if (slot_index > SLOT_MASK) return GraphemePoolError.OutOfMemory;
        return (class_id << SLOT_BITS) | slot_index;
    }

    pub fn incref(self: *GraphemePool, id: IdPayload) void {
        const class_id: u32 = (id >> SLOT_BITS) & CLASS_MASK;
        const slot_index: u32 = id & SLOT_MASK;
        self.classes[class_id].incref(slot_index);
    }

    pub fn decref(self: *GraphemePool, id: IdPayload) GraphemePoolError!void {
        const class_id: u32 = (id >> SLOT_BITS) & CLASS_MASK;
        const slot_index: u32 = id & SLOT_MASK;
        try self.classes[class_id].decref(slot_index);
    }

    pub fn get(self: *GraphemePool, id: IdPayload) GraphemePoolError![]const u8 {
        const class_id: u32 = (id >> SLOT_BITS) & CLASS_MASK;
        const slot_index: u32 = id & SLOT_MASK;
        return self.classes[class_id].get(slot_index);
    }

    const ClassPool = struct {
        allocator: std.mem.Allocator,
        slot_capacity: u32,
        slots_per_page: u32,
        slot_size_bytes: usize,
        slots: std.ArrayListUnmanaged(u8),
        free_list: std.ArrayListUnmanaged(u32),
        num_slots: u32,

        pub fn init(allocator: std.mem.Allocator, slot_capacity: u32, slots_per_page: u32) ClassPool {
            const slot_size_bytes = @sizeOf(SlotHeader) + slot_capacity;
            return .{
                .allocator = allocator,
                .slot_capacity = slot_capacity,
                .slots_per_page = slots_per_page,
                .slot_size_bytes = slot_size_bytes,
                .slots = .{},
                .free_list = .{},
                .num_slots = 0,
            };
        }

        pub fn deinit(self: *ClassPool) void {
            self.slots.deinit(self.allocator);
            self.free_list.deinit(self.allocator);
        }

        fn grow(self: *ClassPool) GraphemePoolError!void {
            const add_bytes = self.slot_size_bytes * self.slots_per_page;

            try self.slots.ensureTotalCapacity(self.allocator, self.slots.items.len + add_bytes);
            try self.slots.appendNTimes(self.allocator, 0, add_bytes);

            var i: u32 = 0;
            while (i < self.slots_per_page) : (i += 1) {
                try self.free_list.append(self.allocator, self.num_slots + i);
            }
            self.num_slots += self.slots_per_page;
        }

        fn slotPtr(self: *ClassPool, slot_index: u32) *align(1) u8 {
            const offset: usize = @as(usize, slot_index) * self.slot_size_bytes;
            return &self.slots.items[offset];
        }

        pub fn alloc(self: *ClassPool, bytes: []const u8) GraphemePoolError!u32 {
            if (bytes.len > self.slot_capacity) {
                @panic("ClassPool.alloc: bytes.len > slot_capacity");
            }
            if (self.free_list.items.len == 0) try self.grow();

            const slot_index = self.free_list.pop().?;
            const p = self.slotPtr(slot_index);
            const header_ptr = @as(*SlotHeader, @ptrCast(@alignCast(p)));

            header_ptr.* = .{ .len = @intCast(@min(bytes.len, self.slot_capacity)), .refcount = 0 };

            const base_ptr = @as([*]u8, @ptrCast(p));
            const data_ptr = base_ptr + @sizeOf(SlotHeader);

            @memcpy(data_ptr[0..header_ptr.len], bytes[0..header_ptr.len]);

            return slot_index;
        }

        pub fn incref(self: *ClassPool, slot_index: u32) void {
            const p = self.slotPtr(slot_index);
            const header_ptr = @as(*SlotHeader, @ptrCast(@alignCast(p)));
            header_ptr.refcount +%= 1;
        }

        pub fn decref(self: *ClassPool, slot_index: u32) GraphemePoolError!void {
            const p = self.slotPtr(slot_index);
            const header_ptr = @as(*SlotHeader, @ptrCast(@alignCast(p)));

            if (header_ptr.refcount == 0) return GraphemePoolError.InvalidId;

            header_ptr.refcount -%= 1;

            if (header_ptr.refcount == 0) {
                try self.free_list.append(self.allocator, slot_index);
            }
        }

        pub fn get(self: *ClassPool, slot_index: u32) GraphemePoolError![]const u8 {
            if (slot_index >= self.num_slots) return GraphemePoolError.InvalidId;

            const p = self.slotPtr(slot_index);
            const header_ptr = @as(*SlotHeader, @ptrCast(@alignCast(p)));
            const base_ptr = @as([*]u8, @ptrCast(p));
            const data_ptr = base_ptr + @sizeOf(SlotHeader);

            return data_ptr[0..header_ptr.len];
        }
    };
};

// Bit manipulation functions for encoded char values

pub fn isGraphemeChar(c: u32) bool {
    return (c & 0xC000_0000) == CHAR_FLAG_GRAPHEME;
}

pub fn isContinuationChar(c: u32) bool {
    return (c & 0xC000_0000) == CHAR_FLAG_CONTINUATION;
}

pub fn isClusterChar(c: u32) bool {
    return (c & 0x8000_0000) == 0x8000_0000;
}

pub fn graphemeIdFromChar(c: u32) u32 {
    return c & GRAPHEME_ID_MASK;
}

pub fn charRightExtent(c: u32) u32 {
    return (c >> CHAR_EXT_RIGHT_SHIFT) & CHAR_EXT_MASK;
}

pub fn charLeftExtent(c: u32) u32 {
    return (c >> CHAR_EXT_LEFT_SHIFT) & CHAR_EXT_MASK;
}

pub fn packGraphemeStart(gid: u32, total_width: u32) u32 {
    const width_minus_one: u32 = if (total_width == 0) 0 else @intCast(@min(total_width - 1, 3));
    const right: u32 = width_minus_one;
    const left: u32 = 0;
    return CHAR_FLAG_GRAPHEME |
        ((right & CHAR_EXT_MASK) << CHAR_EXT_RIGHT_SHIFT) |
        ((left & CHAR_EXT_MASK) << CHAR_EXT_LEFT_SHIFT) |
        (gid & GRAPHEME_ID_MASK);
}

pub fn packContinuation(left: u32, right: u32, gid: u32) u32 {
    return CHAR_FLAG_CONTINUATION |
        ((@min(left, 3) & CHAR_EXT_MASK) << CHAR_EXT_LEFT_SHIFT) |
        ((@min(right, 3) & CHAR_EXT_MASK) << CHAR_EXT_RIGHT_SHIFT) |
        (gid & GRAPHEME_ID_MASK);
}

pub fn encodedCharWidth(c: u32) u32 {
    if (isContinuationChar(c)) {
        const left = charLeftExtent(c);
        const right = charRightExtent(c);
        return left + 1 + right;
    } else if (isGraphemeChar(c)) {
        return charRightExtent(c) + 1;
    } else {
        return 1;
    }
}

var GLOBAL_POOL_STORAGE: ?GraphemePool = null;

pub fn initGlobalPool(allocator: std.mem.Allocator) *GraphemePool {
    if (GLOBAL_POOL_STORAGE == null) {
        GLOBAL_POOL_STORAGE = GraphemePool.init(allocator);
    }
    return &GLOBAL_POOL_STORAGE.?;
}

pub fn deinitGlobalPool() void {
    if (GLOBAL_POOL_STORAGE) |*p| {
        p.deinit();
        GLOBAL_POOL_STORAGE = null;
    }
}

pub const GraphemeTracker = struct {
    pool: *GraphemePool,
    used_ids: std.AutoHashMap(u32, void),

    pub fn init(allocator: std.mem.Allocator, pool: *GraphemePool) GraphemeTracker {
        return .{
            .pool = pool,
            .used_ids = std.AutoHashMap(u32, void).init(allocator),
        };
    }

    fn decRefAll(self: *GraphemeTracker) void {
        var it = self.used_ids.keyIterator();
        while (it.next()) |idp| {
            self.pool.decref(idp.*) catch {};
        }
    }

    pub fn deinit(self: *GraphemeTracker) void {
        self.decRefAll();
        self.used_ids.deinit();
    }

    pub fn clear(self: *GraphemeTracker) void {
        self.decRefAll();
        self.used_ids.clearRetainingCapacity();
    }

    pub fn add(self: *GraphemeTracker, id: u32) void {
        const res = self.used_ids.getOrPut(id) catch |err| {
            std.debug.panic("GraphemeTracker.add failed: {}\n", .{err});
        };
        if (!res.found_existing) {
            self.pool.incref(id);
        }
    }

    pub fn remove(self: *GraphemeTracker, id: u32) void {
        if (self.used_ids.remove(id)) {
            self.pool.decref(id) catch {};
        }
    }

    pub fn contains(self: *const GraphemeTracker, id: u32) bool {
        return self.used_ids.contains(id);
    }

    pub fn hasAny(self: *const GraphemeTracker) bool {
        return self.used_ids.count() > 0;
    }
};
