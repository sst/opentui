const std = @import("std");
const Allocator = std.mem.Allocator;

pub const MemRegistryError = error{
    OutOfMemory,
    InvalidMemId,
};

/// Memory buffer reference in the registry
pub const MemBuffer = struct {
    data: []const u8,
    owned: bool,
};

/// Registry for multiple memory buffers
pub const MemRegistry = struct {
    buffers: std.ArrayListUnmanaged(MemBuffer),
    allocator: Allocator,

    pub fn init(allocator: Allocator) MemRegistry {
        return .{
            .buffers = .{},
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *MemRegistry) void {
        for (self.buffers.items) |mem_buf| {
            if (mem_buf.owned) {
                self.allocator.free(mem_buf.data);
            }
        }
        self.buffers.deinit(self.allocator);
    }

    pub fn register(self: *MemRegistry, data: []const u8, owned: bool) MemRegistryError!u8 {
        if (self.buffers.items.len >= 255) {
            return MemRegistryError.OutOfMemory;
        }
        const id: u8 = @intCast(self.buffers.items.len);
        try self.buffers.append(self.allocator, MemBuffer{
            .data = data,
            .owned = owned,
        });
        return id;
    }

    pub fn get(self: *const MemRegistry, id: u8) ?[]const u8 {
        if (id >= self.buffers.items.len) return null;
        return self.buffers.items[id].data;
    }

    pub fn replace(self: *MemRegistry, id: u8, data: []const u8, owned: bool) MemRegistryError!void {
        if (id >= self.buffers.items.len) return MemRegistryError.InvalidMemId;
        const prev = self.buffers.items[id];
        if (prev.owned) {
            self.allocator.free(prev.data);
        }
        self.buffers.items[id] = .{ .data = data, .owned = owned };
    }

    pub fn clear(self: *MemRegistry) void {
        for (self.buffers.items) |mem_buf| {
            if (mem_buf.owned) {
                self.allocator.free(mem_buf.data);
            }
        }
        self.buffers.clearRetainingCapacity();
    }

    pub fn getUsedSlots(self: *const MemRegistry) usize {
        return self.buffers.items.len;
    }

    pub fn getFreeSlots(self: *const MemRegistry) usize {
        return 255 - self.buffers.items.len;
    }
};
