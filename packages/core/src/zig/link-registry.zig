const std = @import("std");
const Allocator = std.mem.Allocator;

pub const LinkRegistryError = error{
    OutOfMemory,
    InvalidLinkId,
};

/// A link entry in the registry
pub const LinkEntry = struct {
    uri: []const u8,
    active: bool,
};

/// Registry for hyperlink URLs
/// Uses u16 IDs (0 = no link, 1-65535 = valid link IDs)
pub const LinkRegistry = struct {
    links: std.ArrayListUnmanaged(LinkEntry),
    free_slots: std.ArrayListUnmanaged(u16),
    allocator: Allocator,
    /// Deduplication map: URI hash -> link_id
    uri_to_id: std.StringHashMapUnmanaged(u16),

    pub fn init(allocator: Allocator) LinkRegistry {
        return .{
            .links = .{},
            .free_slots = .{},
            .allocator = allocator,
            .uri_to_id = .{},
        };
    }

    pub fn deinit(self: *LinkRegistry) void {
        for (self.links.items) |entry| {
            if (entry.active) {
                self.allocator.free(entry.uri);
            }
        }
        self.links.deinit(self.allocator);
        self.free_slots.deinit(self.allocator);
        self.uri_to_id.deinit(self.allocator);
    }

    /// Register a URI and return its link ID (1-based)
    /// Deduplicates URIs - returns existing ID if URI already registered
    pub fn register(self: *LinkRegistry, uri: []const u8) LinkRegistryError!u16 {
        // Check for existing registration (deduplication)
        if (self.uri_to_id.get(uri)) |existing_id| {
            return existing_id;
        }

        // Copy the URI to owned memory
        const owned_uri = self.allocator.dupe(u8, uri) catch return LinkRegistryError.OutOfMemory;
        errdefer self.allocator.free(owned_uri);

        var id: u16 = undefined;

        // Try to reuse a free slot first
        if (self.free_slots.items.len > 0) {
            id = self.free_slots.items[self.free_slots.items.len - 1];
            _ = self.free_slots.pop();
            self.links.items[id - 1] = LinkEntry{
                .uri = owned_uri,
                .active = true,
            };
        } else {
            // No free slots, allocate a new one
            if (self.links.items.len >= 65534) {
                self.allocator.free(owned_uri);
                return LinkRegistryError.OutOfMemory;
            }
            id = @intCast(self.links.items.len + 1); // 1-based
            self.links.append(self.allocator, LinkEntry{
                .uri = owned_uri,
                .active = true,
            }) catch {
                self.allocator.free(owned_uri);
                return LinkRegistryError.OutOfMemory;
            };
        }

        // Add to dedup map
        self.uri_to_id.put(self.allocator, owned_uri, id) catch {
            // Rollback: mark slot as inactive
            self.links.items[id - 1].active = false;
            self.free_slots.append(self.allocator, id) catch {};
            self.allocator.free(owned_uri);
            return LinkRegistryError.OutOfMemory;
        };

        return id;
    }

    /// Get URI for a link ID (1-based, 0 returns null)
    pub fn get(self: *const LinkRegistry, id: u16) ?[]const u8 {
        if (id == 0) return null;
        const idx = id - 1;
        if (idx >= self.links.items.len) return null;
        const entry = self.links.items[idx];
        if (!entry.active) return null;
        return entry.uri;
    }

    /// Unregister a link by ID
    pub fn unregister(self: *LinkRegistry, id: u16) LinkRegistryError!void {
        if (id == 0) return LinkRegistryError.InvalidLinkId;
        const idx = id - 1;
        if (idx >= self.links.items.len) return LinkRegistryError.InvalidLinkId;

        var entry = &self.links.items[idx];
        if (!entry.active) return LinkRegistryError.InvalidLinkId;

        // Remove from dedup map
        _ = self.uri_to_id.remove(entry.uri);

        // Free the URI
        self.allocator.free(entry.uri);

        // Mark slot as inactive
        entry.active = false;
        entry.uri = &[_]u8{};

        // Add to free slots list
        self.free_slots.append(self.allocator, id) catch return LinkRegistryError.OutOfMemory;
    }

    /// Clear all links
    pub fn clear(self: *LinkRegistry) void {
        for (self.links.items) |entry| {
            if (entry.active) {
                self.allocator.free(entry.uri);
            }
        }
        self.links.clearRetainingCapacity();
        self.free_slots.clearRetainingCapacity();
        self.uri_to_id.clearRetainingCapacity();
    }

    /// Get number of active links
    pub fn getActiveCount(self: *const LinkRegistry) usize {
        var count: usize = 0;
        for (self.links.items) |entry| {
            if (entry.active) count += 1;
        }
        return count;
    }
};
