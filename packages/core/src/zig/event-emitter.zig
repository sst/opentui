const std = @import("std");
const Allocator = std.mem.Allocator;

pub fn EventListener(comptime CtxType: type) type {
    return struct {
        ctx: CtxType,
        handle: *const fn (ctx: CtxType) void,
    };
}

pub fn EventEmitter(comptime EventType: type) type {
    if (@typeInfo(EventType) != .@"enum") {
        @compileError("EventType must be an enum");
    }

    return struct {
        const Self = @This();

        allocator: Allocator,
        listeners: std.EnumMap(EventType, std.ArrayListUnmanaged(*const anyopaque)),

        pub fn init(allocator: Allocator) Self {
            return .{
                .allocator = allocator,
                .listeners = std.EnumMap(EventType, std.ArrayListUnmanaged(*const anyopaque)).init(.{}),
            };
        }

        pub fn deinit(self: *Self) void {
            var iter = self.listeners.iterator();
            while (iter.next()) |entry| {
                entry.value.deinit(self.allocator);
            }
        }

        pub fn on(self: *Self, event: EventType, listener: *const anyopaque) !void {
            const list_ptr = self.listeners.getPtr(event) orelse {
                self.listeners.put(event, .{});
                return self.on(event, listener);
            };

            try list_ptr.append(self.allocator, listener);
        }

        pub fn off(self: *Self, event: EventType, listener: *const anyopaque) void {
            const list_ptr = self.listeners.getPtr(event) orelse return;

            var i: usize = 0;
            while (i < list_ptr.items.len) {
                if (list_ptr.items[i] == listener) {
                    _ = list_ptr.swapRemove(i);
                } else {
                    i += 1;
                }
            }
        }

        pub fn emit(self: *Self, event: EventType, comptime ListenerType: type) void {
            const list_ptr = self.listeners.getPtr(event) orelse return;

            for (list_ptr.items) |opaque_listener| {
                const listener: *const ListenerType = @ptrCast(@alignCast(opaque_listener));
                listener.handle(listener.ctx);
            }
        }
    };
}
