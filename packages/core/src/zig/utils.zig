const ansi = @import("ansi.zig");

/// RGBA color type (5 f32 values: r, g, b, a, colorMeta)
pub const RGBA = ansi.RGBA;

/// Convert a pointer to 5 f32 values into an RGBA color
pub fn f32PtrToRGBA(ptr: [*]const f32) RGBA {
    return .{ ptr[0], ptr[1], ptr[2], ptr[3], ptr[4] };
}
