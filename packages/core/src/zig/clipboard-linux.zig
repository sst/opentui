const std = @import("std");

pub const Environment = struct {
    is_wsl: bool,
    has_wayland_display: bool,
    has_x11_display: bool,

    pub fn fromMap(env: *const std.process.EnvMap) Environment {
        return .{
            .is_wsl = env.get("WSL_DISTRO_NAME") != null or env.get("WSL_INTEROP") != null,
            .has_wayland_display = hasNonEmptyValue(env, "WAYLAND_DISPLAY"),
            .has_x11_display = hasNonEmptyValue(env, "DISPLAY"),
        };
    }

    pub fn detect(env: *const std.process.EnvMap) Environment {
        var result = fromMap(env);
        if (!result.is_wsl) {
            const uts = std.posix.uname();
            result.is_wsl = isWslKernelRelease(std.mem.sliceTo(&uts.release, 0));
        }
        return result;
    }
};

pub const Libraries = struct {
    wayland: bool = false,
    x11: bool = false,
};

pub const Route = union(enum) {
    unsupported,
    linux: Libraries,
};

pub const Mechanism = enum { wayland, x11 };
pub const MechanismOutcome = enum { unavailable, unsupported, failed, cancelled, timed_out, limit_exceeded };

pub const WlDisplay = opaque {};
pub const WlProxy = opaque {};
pub const WlInterface = extern struct {
    name: [*:0]const u8,
    version: c_int,
    method_count: c_int,
    methods: ?[*]const WlMessage,
    event_count: c_int,
    events: ?[*]const WlMessage,
};
pub const WlMessage = extern struct {
    name: [*:0]const u8,
    signature: [*:0]const u8,
    types: ?[*]const ?*const WlInterface,
};
pub const WlArgument = extern union {
    i: i32,
    u: u32,
    f: i32,
    s: ?[*:0]const u8,
    o: ?*WlProxy,
    n: u32,
    a: ?*anyopaque,
    h: i32,
};

const LibraryKind = enum { wayland, x11 };
const LoadLibraryFn = *const fn (context: *anyopaque, kind: LibraryKind) bool;
pub const MIN_WAYLAND_CLIENT_VERSION = "1.25.0";

pub const WaylandSymbols = struct {
    wl_display_connect: *const fn (?[*:0]const u8) callconv(.c) ?*WlDisplay,
    wl_display_disconnect: *const fn (*WlDisplay) callconv(.c) void,
    wl_display_get_fd: *const fn (*WlDisplay) callconv(.c) c_int,
    wl_display_dispatch_pending: *const fn (*WlDisplay) callconv(.c) c_int,
    // Required to preserve the one-callback-per-work-unit bound.
    wl_display_dispatch_pending_single: *const fn (*WlDisplay) callconv(.c) c_int,
    wl_display_flush: *const fn (*WlDisplay) callconv(.c) c_int,
    wl_display_prepare_read: *const fn (*WlDisplay) callconv(.c) c_int,
    wl_display_read_events: *const fn (*WlDisplay) callconv(.c) c_int,
    wl_display_cancel_read: *const fn (*WlDisplay) callconv(.c) void,
    wl_proxy_marshal_array_flags: *const fn (*WlProxy, u32, ?*const WlInterface, u32, u32, [*]WlArgument) callconv(.c) ?*WlProxy,
    wl_proxy_add_listener: *const fn (*WlProxy, [*]const *const anyopaque, ?*anyopaque) callconv(.c) c_int,
    wl_proxy_destroy: *const fn (*WlProxy) callconv(.c) void,
    wl_proxy_get_version: *const fn (*WlProxy) callconv(.c) u32,
    wl_display_interface: *const WlInterface,
    wl_registry_interface: *const WlInterface,
    wl_callback_interface: *const WlInterface,
    wl_seat_interface: *const WlInterface,
};

pub const XcbSymbols = struct {
    xcb_connect: *const anyopaque,
    xcb_connection_has_error: *const anyopaque,
    xcb_disconnect: *const anyopaque,
    xcb_get_file_descriptor: *const anyopaque,
    xcb_poll_for_event: *const anyopaque,
    xcb_flush: *const anyopaque,
    xcb_generate_id: *const anyopaque,
    xcb_create_window: *const anyopaque,
    xcb_destroy_window: *const anyopaque,
    xcb_intern_atom: *const anyopaque,
    xcb_intern_atom_reply: *const anyopaque,
    xcb_get_property: *const anyopaque,
    xcb_get_property_reply: *const anyopaque,
    xcb_change_property: *const anyopaque,
    xcb_delete_property: *const anyopaque,
    xcb_convert_selection: *const anyopaque,
    xcb_set_selection_owner: *const anyopaque,
    xcb_get_selection_owner: *const anyopaque,
    xcb_get_selection_owner_reply: *const anyopaque,
    xcb_send_event: *const anyopaque,
};

fn CachedLibrary(comptime Symbols: type) type {
    return struct {
        attempted: bool = false,
        library: ?std.DynLib = null,
        symbols: ?Symbols = null,
    };
}

var cache_mutex: std.Thread.Mutex = .{};
var wayland_cache: CachedLibrary(WaylandSymbols) = .{};
var xcb_cache: CachedLibrary(XcbSymbols) = .{};
var production_context: u8 = 0;

pub fn initialize(env: Environment) Route {
    if (env.is_wsl) return .unsupported;
    return selectLibraries(env, &production_context, loadProductionLibrary);
}

pub fn waylandSymbols() ?*const WaylandSymbols {
    cache_mutex.lock();
    defer cache_mutex.unlock();
    if (wayland_cache.symbols) |*symbols| return symbols;
    return null;
}

pub fn xcbSymbols() ?*const XcbSymbols {
    cache_mutex.lock();
    defer cache_mutex.unlock();
    if (xcb_cache.symbols) |*symbols| return symbols;
    return null;
}

fn selectLibraries(env: Environment, context: *anyopaque, load_library: LoadLibraryFn) Route {
    if (env.is_wsl) return .unsupported;

    var libraries: Libraries = .{};
    if (env.has_wayland_display) libraries.wayland = load_library(context, .wayland);
    if (env.has_x11_display) libraries.x11 = load_library(context, .x11);
    return .{ .linux = libraries };
}

fn loadProductionLibrary(_: *anyopaque, kind: LibraryKind) bool {
    cache_mutex.lock();
    defer cache_mutex.unlock();

    return switch (kind) {
        .wayland => loadCachedLibrary(
            WaylandSymbols,
            &wayland_cache,
            &.{"libwayland-client.so.0"},
        ),
        .x11 => loadCachedLibrary(
            XcbSymbols,
            &xcb_cache,
            &.{"libxcb.so.1"},
        ),
    };
}

fn loadCachedLibrary(
    comptime Symbols: type,
    cache: *CachedLibrary(Symbols),
    names: []const []const u8,
) bool {
    if (cache.attempted) return cache.symbols != null;
    cache.attempted = true;

    for (names) |name| {
        const library = std.DynLib.open(name) catch continue;
        cache.library = library;
        cache.symbols = loadSymbols(Symbols, &cache.library.?);
        return cache.symbols != null;
    }
    return false;
}

fn loadSymbols(comptime Symbols: type, library: *std.DynLib) ?Symbols {
    var symbols: Symbols = undefined;
    inline for (@typeInfo(Symbols).@"struct".fields) |field| {
        @field(symbols, field.name) = library.lookup(field.type, field.name) orelse return null;
    }
    return symbols;
}

fn hasNonEmptyValue(env: *const std.process.EnvMap, name: []const u8) bool {
    const value = env.get(name) orelse return false;
    return value.len > 0;
}

fn isWslKernelRelease(release: []const u8) bool {
    return std.ascii.indexOfIgnoreCase(release, "microsoft") != null or
        std.ascii.indexOfIgnoreCase(release, "wsl") != null;
}

pub fn firstMechanism(libraries: Libraries) ?Mechanism {
    if (libraries.wayland) return .wayland;
    if (libraries.x11) return .x11;
    return null;
}

pub fn fallbackMechanism(libraries: Libraries, current: Mechanism, outcome: MechanismOutcome) ?Mechanism {
    if (current != .wayland or !libraries.x11) return null;
    return switch (outcome) {
        .unavailable, .unsupported => .x11,
        .failed, .cancelled, .timed_out, .limit_exceeded => null,
    };
}

const FakeLoader = struct {
    wayland_available: bool = false,
    x11_available: bool = false,
    wayland_attempts: u32 = 0,
    x11_attempts: u32 = 0,

    fn load(context: *anyopaque, kind: LibraryKind) bool {
        const self: *FakeLoader = @ptrCast(@alignCast(context));
        return switch (kind) {
            .wayland => blk: {
                self.wayland_attempts += 1;
                break :blk self.wayland_available;
            },
            .x11 => blk: {
                self.x11_attempts += 1;
                break :blk self.x11_available;
            },
        };
    }
};

fn expectLibraries(route: Route, wayland: bool, x11: bool) !void {
    switch (route) {
        .unsupported => return error.UnexpectedUnsupportedRoute,
        .linux => |libraries| {
            try std.testing.expectEqual(wayland, libraries.wayland);
            try std.testing.expectEqual(x11, libraries.x11);
        },
    }
}

test "clipboard linux routing rejects WSL before loading desktop libraries" {
    var loader: FakeLoader = .{ .wayland_available = true, .x11_available = true };
    const route = selectLibraries(.{
        .is_wsl = true,
        .has_wayland_display = true,
        .has_x11_display = true,
    }, &loader, FakeLoader.load);

    try std.testing.expect(route == .unsupported);
    try std.testing.expectEqual(@as(u32, 0), loader.wayland_attempts);
    try std.testing.expectEqual(@as(u32, 0), loader.x11_attempts);
}

test "clipboard linux routing loads only libraries for applicable displays" {
    var headless_loader: FakeLoader = .{ .wayland_available = true, .x11_available = true };
    try expectLibraries(selectLibraries(.{
        .is_wsl = false,
        .has_wayland_display = false,
        .has_x11_display = false,
    }, &headless_loader, FakeLoader.load), false, false);
    try std.testing.expectEqual(@as(u32, 0), headless_loader.wayland_attempts);
    try std.testing.expectEqual(@as(u32, 0), headless_loader.x11_attempts);

    var wayland_loader: FakeLoader = .{ .wayland_available = true };
    try expectLibraries(selectLibraries(.{
        .is_wsl = false,
        .has_wayland_display = true,
        .has_x11_display = false,
    }, &wayland_loader, FakeLoader.load), true, false);
    try std.testing.expectEqual(@as(u32, 1), wayland_loader.wayland_attempts);
    try std.testing.expectEqual(@as(u32, 0), wayland_loader.x11_attempts);

    var x11_loader: FakeLoader = .{ .x11_available = true };
    try expectLibraries(selectLibraries(.{
        .is_wsl = false,
        .has_wayland_display = false,
        .has_x11_display = true,
    }, &x11_loader, FakeLoader.load), false, true);
    try std.testing.expectEqual(@as(u32, 0), x11_loader.wayland_attempts);
    try std.testing.expectEqual(@as(u32, 1), x11_loader.x11_attempts);
}

test "clipboard linux routing preserves independent Wayland and X11 load results" {
    var loader: FakeLoader = .{ .x11_available = true };
    try expectLibraries(selectLibraries(.{
        .is_wsl = false,
        .has_wayland_display = true,
        .has_x11_display = true,
    }, &loader, FakeLoader.load), false, true);
    try std.testing.expectEqual(@as(u32, 1), loader.wayland_attempts);
    try std.testing.expectEqual(@as(u32, 1), loader.x11_attempts);
}

test "clipboard linux routing falls back from Wayland only for unavailable or unsupported outcomes" {
    const libraries: Libraries = .{ .wayland = true, .x11 = true };
    try std.testing.expectEqual(Mechanism.wayland, firstMechanism(libraries).?);
    try std.testing.expectEqual(Mechanism.x11, fallbackMechanism(libraries, .wayland, .unavailable).?);
    try std.testing.expectEqual(Mechanism.x11, fallbackMechanism(libraries, .wayland, .unsupported).?);
    try std.testing.expectEqual(null, fallbackMechanism(libraries, .wayland, .failed));
    try std.testing.expectEqual(null, fallbackMechanism(libraries, .wayland, .cancelled));
    try std.testing.expectEqual(null, fallbackMechanism(libraries, .wayland, .timed_out));
    try std.testing.expectEqual(null, fallbackMechanism(libraries, .wayland, .limit_exceeded));
    try std.testing.expectEqual(null, fallbackMechanism(libraries, .x11, .unsupported));
}

test "clipboard linux environment treats display variables as nonempty and WSL as presence based" {
    var env = std.process.EnvMap.init(std.testing.allocator);
    defer env.deinit();
    try env.put("WAYLAND_DISPLAY", "");
    try env.put("DISPLAY", ":0");
    try env.put("WSL_INTEROP", "");

    const detected = Environment.fromMap(&env);
    try std.testing.expect(detected.is_wsl);
    try std.testing.expect(!detected.has_wayland_display);
    try std.testing.expect(detected.has_x11_display);
}

test "clipboard linux environment recognizes WSL kernel releases without environment markers" {
    try std.testing.expect(isWslKernelRelease("4.4.0-19041-Microsoft"));
    try std.testing.expect(isWslKernelRelease("5.15.153.1-microsoft-standard-WSL2"));
    try std.testing.expect(!isWslKernelRelease("6.12.31-1-lts"));
}

test "clipboard Wayland backend declares the minimum bounded-dispatch library version" {
    try std.testing.expectEqualStrings("1.25.0", MIN_WAYLAND_CLIENT_VERSION);
    try std.testing.expect(@typeInfo(@FieldType(WaylandSymbols, "wl_display_dispatch_pending_single")) != .optional);
}
