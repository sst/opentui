const std = @import("std");

/// RGBA color type (4 f32 values)
pub const RGBA = @Vector(4, f32);

/// Convert a pointer to 4 f32 values into an RGBA color
pub fn f32PtrToRGBA(ptr: [*]const f32) RGBA {
    return .{ ptr[0], ptr[1], ptr[2], ptr[3] };
}
