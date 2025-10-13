//! ASCII-Only Detection Library
//!
//! This library provides various methods for checking if a byte slice contains
//! only printable ASCII characters (32..126).
//!
//! ## Methods
//!
//! - `isAsciiOnlyBaseline`: Simple byte-by-byte iteration (reference implementation)
//! - `isAsciiOnlySIMD16`: Manual SIMD vectorization with 16-byte vectors (SSE2/NEON)
//! - `isAsciiOnlySIMD32`: Manual SIMD vectorization with 32-byte vectors (AVX2)
//! - `isAsciiOnlySIMD64`: Manual SIMD vectorization with 64-byte vectors (AVX-512)
//! - `isAsciiOnlyBitmask`: Bitmask approach for checking ranges
//! - `isAsciiOnlyBitwiseOr`: Bitwise OR accumulation approach
//!
//! ## Usage
//!
//! ```zig
//! const ascii = @import("ascii-check.zig");
//!
//! const text = "Hello, World!";
//! if (ascii.isAsciiOnlySIMD16(text)) {
//!     std.debug.print("Text is printable ASCII!\n", .{});
//! }
//! ```

const std = @import("std");

// Method enum for easy parametrization
pub const Method = enum {
    baseline,
    simd16,
    simd32,
    simd64,
    bitmask,
    bitwise_or,
};

/// Method 1: Baseline pure loop - linear scan checking each byte
pub fn isAsciiOnlyBaseline(text: []const u8) bool {
    if (text.len == 0) return false;

    for (text) |b| {
        if (b < 32 or b > 126) {
            return false;
        }
    }
    return true;
}

/// Method 2: SIMD with 16-byte vectors (SSE2/NEON compatible)
pub fn isAsciiOnlySIMD16(text: []const u8) bool {
    if (text.len == 0) return false;

    const vector_len = 16;
    const Vec = @Vector(vector_len, u8);

    const min_printable: Vec = @splat(32);
    const max_printable: Vec = @splat(126);

    var pos: usize = 0;

    // Process full 16-byte vectors
    while (pos + vector_len <= text.len) {
        const chunk: Vec = text[pos..][0..vector_len].*;

        // Check if all bytes are in [32, 126]
        const too_low = chunk < min_printable;
        const too_high = chunk > max_printable;

        // Check if any byte is out of range
        if (@reduce(.Or, too_low) or @reduce(.Or, too_high)) {
            return false;
        }

        pos += vector_len;
    }

    // Handle remaining bytes with scalar code
    while (pos < text.len) : (pos += 1) {
        const b = text[pos];
        if (b < 32 or b > 126) {
            return false;
        }
    }

    return true;
}

/// Method 3: SIMD with 32-byte vectors (AVX2 compatible)
pub fn isAsciiOnlySIMD32(text: []const u8) bool {
    if (text.len == 0) return false;

    const vector_len = 32;
    const Vec = @Vector(vector_len, u8);

    const min_printable: Vec = @splat(32);
    const max_printable: Vec = @splat(126);

    var pos: usize = 0;

    // Process full 32-byte vectors
    while (pos + vector_len <= text.len) {
        const chunk: Vec = text[pos..][0..vector_len].*;

        const too_low = chunk < min_printable;
        const too_high = chunk > max_printable;

        if (@reduce(.Or, too_low) or @reduce(.Or, too_high)) {
            return false;
        }

        pos += vector_len;
    }

    // Handle remaining bytes with scalar code
    while (pos < text.len) : (pos += 1) {
        const b = text[pos];
        if (b < 32 or b > 126) {
            return false;
        }
    }

    return true;
}

/// Method 4: SIMD with 64-byte vectors (AVX-512 compatible)
pub fn isAsciiOnlySIMD64(text: []const u8) bool {
    if (text.len == 0) return false;

    const vector_len = 64;
    const Vec = @Vector(vector_len, u8);

    const min_printable: Vec = @splat(32);
    const max_printable: Vec = @splat(126);

    var pos: usize = 0;

    // Process full 64-byte vectors
    while (pos + vector_len <= text.len) {
        const chunk: Vec = text[pos..][0..vector_len].*;

        const too_low = chunk < min_printable;
        const too_high = chunk > max_printable;

        if (@reduce(.Or, too_low) or @reduce(.Or, too_high)) {
            return false;
        }

        pos += vector_len;
    }

    // Handle remaining bytes with scalar code
    while (pos < text.len) : (pos += 1) {
        const b = text[pos];
        if (b < 32 or b > 126) {
            return false;
        }
    }

    return true;
}

/// Method 5: Bitmask approach - check multiple bytes using bitmask
pub fn isAsciiOnlyBitmask(text: []const u8) bool {
    if (text.len == 0) return false;

    const chunk_size = 64;
    var pos: usize = 0;

    while (pos < text.len) {
        const end = @min(pos + chunk_size, text.len);
        const chunk = text[pos..end];

        // Check each byte in the chunk
        for (chunk) |b| {
            // Use bitmask to check range [32, 126]
            // This is equivalent to: b >= 32 && b <= 126
            const in_range = (b -% 32) <= (126 - 32);
            if (!in_range) {
                return false;
            }
        }

        pos = end;
    }

    return true;
}

/// Method 6: Bitwise OR accumulation - accumulate all bytes and check at end
pub fn isAsciiOnlyBitwiseOr(text: []const u8) bool {
    if (text.len == 0) return false;

    // First pass: check if all bytes have high bit clear (< 128)
    var accumulator: u8 = 0;
    for (text) |b| {
        accumulator |= b;
    }

    // If high bit is set anywhere, we have non-ASCII
    if (accumulator >= 128) {
        return false;
    }

    // Second pass: check exact range [32, 126]
    for (text) |b| {
        if (b < 32 or b > 126) {
            return false;
        }
    }

    return true;
}

/// Method 7: SIMD16 with single comparison (optimized range check)
pub fn isAsciiOnlySIMD16SingleCmp(text: []const u8) bool {
    if (text.len == 0) return false;

    const vector_len = 16;
    const Vec = @Vector(vector_len, u8);

    // Offset to bring [32, 126] range to [0, 94]
    const offset: Vec = @splat(32);
    const max_offset: Vec = @splat(94);

    var pos: usize = 0;

    // Process full 16-byte vectors
    while (pos + vector_len <= text.len) {
        const chunk: Vec = text[pos..][0..vector_len].*;

        // Subtract 32, then check if result > 94
        const shifted = chunk -% offset;
        const out_of_range = shifted > max_offset;

        if (@reduce(.Or, out_of_range)) {
            return false;
        }

        pos += vector_len;
    }

    // Handle remaining bytes with scalar code
    while (pos < text.len) : (pos += 1) {
        const b = text[pos];
        if (b < 32 or b > 126) {
            return false;
        }
    }

    return true;
}

/// Method 8: SIMD32 with single comparison (optimized range check)
pub fn isAsciiOnlySIMD32SingleCmp(text: []const u8) bool {
    if (text.len == 0) return false;

    const vector_len = 32;
    const Vec = @Vector(vector_len, u8);

    const offset: Vec = @splat(32);
    const max_offset: Vec = @splat(94);

    var pos: usize = 0;

    while (pos + vector_len <= text.len) {
        const chunk: Vec = text[pos..][0..vector_len].*;
        const shifted = chunk -% offset;
        const out_of_range = shifted > max_offset;

        if (@reduce(.Or, out_of_range)) {
            return false;
        }

        pos += vector_len;
    }

    while (pos < text.len) : (pos += 1) {
        const b = text[pos];
        if (b < 32 or b > 126) {
            return false;
        }
    }

    return true;
}

/// Method 9: Unrolled SIMD16 (process 2 vectors per iteration)
pub fn isAsciiOnlySIMD16Unrolled(text: []const u8) bool {
    if (text.len == 0) return false;

    const vector_len = 16;
    const Vec = @Vector(vector_len, u8);

    const min_printable: Vec = @splat(32);
    const max_printable: Vec = @splat(126);

    var pos: usize = 0;

    // Process two 16-byte vectors per iteration (32 bytes total)
    while (pos + vector_len * 2 <= text.len) {
        const chunk1: Vec = text[pos..][0..vector_len].*;
        const chunk2: Vec = text[pos + vector_len ..][0..vector_len].*;

        const too_low1 = chunk1 < min_printable;
        const too_high1 = chunk1 > max_printable;
        const too_low2 = chunk2 < min_printable;
        const too_high2 = chunk2 > max_printable;

        if (@reduce(.Or, too_low1) or @reduce(.Or, too_high1) or
            @reduce(.Or, too_low2) or @reduce(.Or, too_high2))
        {
            return false;
        }

        pos += vector_len * 2;
    }

    // Process remaining vector
    if (pos + vector_len <= text.len) {
        const chunk: Vec = text[pos..][0..vector_len].*;
        const too_low = chunk < min_printable;
        const too_high = chunk > max_printable;

        if (@reduce(.Or, too_low) or @reduce(.Or, too_high)) {
            return false;
        }

        pos += vector_len;
    }

    // Handle remaining bytes with scalar code
    while (pos < text.len) : (pos += 1) {
        const b = text[pos];
        if (b < 32 or b > 126) {
            return false;
        }
    }

    return true;
}

