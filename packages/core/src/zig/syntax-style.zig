const std = @import("std");
const Allocator = std.mem.Allocator;
const buffer = @import("buffer.zig");
const events = @import("event-emitter.zig");

pub const RGBA = buffer.RGBA;

/// Foreground, background, and text attributes for a syntax highlight style.
/// Color intent (rgb, indexed, default) is embedded in the RGBA values.
pub const StyleDefinition = struct {
    fg: ?RGBA,
    bg: ?RGBA,
    attributes: u32,
};

pub const SyntaxStyleError = error{
    OutOfMemory,
    InvalidId,
    StyleNotFound,
};

pub const Event = enum { Destroy };

pub const SyntaxStyle = struct {
    allocator: Allocator,
    global_allocator: Allocator,
    arena: *std.heap.ArenaAllocator,

    name_to_id: std.StringHashMapUnmanaged(u32),
    id_to_style: std.AutoHashMapUnmanaged(u32, StyleDefinition),
    next_id: u32,

    merged_cache: std.StringHashMapUnmanaged(StyleDefinition),

    emitter: events.EventEmitter(Event),

    pub fn init(global_allocator: Allocator) SyntaxStyleError!*SyntaxStyle {
        const self = global_allocator.create(SyntaxStyle) catch return SyntaxStyleError.OutOfMemory;
        errdefer global_allocator.destroy(self);

        const internal_arena = global_allocator.create(std.heap.ArenaAllocator) catch return SyntaxStyleError.OutOfMemory;
        errdefer global_allocator.destroy(internal_arena);
        internal_arena.* = std.heap.ArenaAllocator.init(global_allocator);

        const internal_allocator = internal_arena.allocator();

        self.* = .{
            .allocator = internal_allocator,
            .global_allocator = global_allocator,
            .arena = internal_arena,
            .name_to_id = .{},
            .id_to_style = .{},
            .next_id = 1, // Start from 1, 0 can be used as "invalid"
            .merged_cache = .{},
            .emitter = events.EventEmitter(Event).init(internal_allocator),
        };

        return self;
    }

    pub fn deinit(self: *SyntaxStyle) void {
        const global_allocator = self.global_allocator;
        defer global_allocator.destroy(self);

        self.emitter.emit(.Destroy);
        self.emitter.deinit();
        var name_iterator = self.name_to_id.keyIterator();
        while (name_iterator.next()) |name| {
            global_allocator.free(@constCast(name.*));
        }
        self.arena.deinit();
        global_allocator.destroy(self.arena);
        self.* = undefined;
    }

    fn putStyle(self: *SyntaxStyle, name: []const u8, definition: StyleDefinition) SyntaxStyleError!u32 {
        if (self.name_to_id.get(name)) |existing_id| {
            try self.id_to_style.put(self.allocator, existing_id, definition);
            self.clearCache();
            return existing_id;
        }

        const id = self.next_id;
        const owned_name = self.global_allocator.dupe(u8, name) catch return SyntaxStyleError.OutOfMemory;
        errdefer self.global_allocator.free(owned_name);

        try self.name_to_id.put(self.allocator, owned_name, id);
        errdefer std.debug.assert(self.name_to_id.remove(owned_name));
        try self.id_to_style.put(self.allocator, id, definition);
        self.next_id += 1;

        return id;
    }

    pub fn registerStyle(self: *SyntaxStyle, name: []const u8, fg: ?RGBA, bg: ?RGBA, attributes: u32) SyntaxStyleError!u32 {
        return self.registerStyleDefinition(name, .{
            .fg = fg,
            .bg = bg,
            .attributes = attributes,
        });
    }

    pub fn registerStyleDefinition(self: *SyntaxStyle, name: []const u8, definition: StyleDefinition) SyntaxStyleError!u32 {
        return self.putStyle(name, definition);
    }

    pub fn removeStyle(self: *SyntaxStyle, name: []const u8) void {
        const removed = self.name_to_id.fetchRemove(name) orelse return;
        std.debug.assert(self.id_to_style.remove(removed.value));
        self.global_allocator.free(removed.key);
        self.clearCache();
    }

    pub fn resolveById(self: *const SyntaxStyle, id: u32) ?StyleDefinition {
        return self.id_to_style.get(id);
    }

    pub fn resolveByName(self: *const SyntaxStyle, name: []const u8) ?u32 {
        return self.name_to_id.get(name);
    }

    pub fn getStyleByName(self: *const SyntaxStyle, name: []const u8) ?StyleDefinition {
        const id = self.resolveByName(name) orelse return null;
        return self.resolveById(id);
    }

    pub fn mergeStyles(self: *SyntaxStyle, ids: []const u32) SyntaxStyleError!StyleDefinition {
        var cache_key_buffer: [512]u8 = undefined;
        var cache_key_stream = std.io.fixedBufferStream(&cache_key_buffer);
        const writer = cache_key_stream.writer();

        for (ids, 0..) |id, i| {
            if (i > 0) writer.writeByte(':') catch return SyntaxStyleError.OutOfMemory;
            writer.print("{d}", .{id}) catch return SyntaxStyleError.OutOfMemory;
        }

        const cache_key = cache_key_stream.getWritten();

        if (self.merged_cache.get(cache_key)) |cached| {
            return cached;
        }

        var merged: StyleDefinition = .{
            .fg = null,
            .bg = null,
            .attributes = 0,
        };

        for (ids) |id| {
            if (self.resolveById(id)) |style| {
                if (style.fg) |fg| {
                    merged.fg = fg;
                }
                if (style.bg) |bg| {
                    merged.bg = bg;
                }
                // Attributes are OR'd together
                merged.attributes |= style.attributes;
            }
        }

        const owned_cache_key = self.allocator.dupe(u8, cache_key) catch return SyntaxStyleError.OutOfMemory;
        self.merged_cache.put(self.allocator, owned_cache_key, merged) catch return SyntaxStyleError.OutOfMemory;

        return merged;
    }

    pub fn clearCache(self: *SyntaxStyle) void {
        self.merged_cache.clearRetainingCapacity();
    }

    pub fn getCacheSize(self: *const SyntaxStyle) usize {
        return self.merged_cache.count();
    }

    pub fn getStyleCount(self: *const SyntaxStyle) usize {
        return self.id_to_style.count();
    }

    pub fn onDestroy(self: *SyntaxStyle, ctx: *anyopaque, handle: *const fn (*anyopaque) void) SyntaxStyleError!void {
        self.emitter.on(.Destroy, .{ .ctx = ctx, .handle = handle }) catch return SyntaxStyleError.OutOfMemory;
    }

    pub fn offDestroy(self: *SyntaxStyle, ctx: *anyopaque, handle: *const fn (*anyopaque) void) void {
        self.emitter.off(.Destroy, .{ .ctx = ctx, .handle = handle });
    }
};
