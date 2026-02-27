use crate::ansi::RGBA;

/// Convert a raw `*const f32` pointer (4 contiguous floats) to an RGBA array.
///
/// # Safety
/// Caller must ensure `ptr` points to at least 4 readable `f32` values.
#[inline]
pub unsafe fn f32_ptr_to_rgba(ptr: *const f32) -> RGBA {
    [*ptr, *ptr.add(1), *ptr.add(2), *ptr.add(3)]
}

/// Blend two RGBA colors together with perceptual alpha blending.
pub fn blend_colors(overlay: RGBA, text: RGBA) -> RGBA {
    if overlay[3] == 1.0 {
        return overlay;
    }

    if text[3] == 0.0 {
        let alpha = overlay[3];
        let r = overlay[0] * alpha;
        let g = overlay[1] * alpha;
        let b = overlay[2] * alpha;
        if r < 0.01 && g < 0.01 && b < 0.01 {
            return [0.0, 0.0, 0.0, 0.0];
        }
        return [r, g, b, alpha];
    }

    let alpha = overlay[3];
    let perceptual_alpha = if alpha > 0.8 {
        let normalized = (alpha - 0.8) * 5.0;
        let curved = normalized.powf(0.2);
        0.8 + (curved * 0.2)
    } else {
        alpha.powf(0.9)
    };

    let r = overlay[0] * perceptual_alpha + text[0] * (1.0 - perceptual_alpha);
    let g = overlay[1] * perceptual_alpha + text[1] * (1.0 - perceptual_alpha);
    let b = overlay[2] * perceptual_alpha + text[2] * (1.0 - perceptual_alpha);
    let result_alpha = alpha + text[3] * (1.0 - alpha);

    [r, g, b, result_alpha]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_blend_fully_opaque() {
        let overlay = [1.0, 0.0, 0.0, 1.0];
        let text = [0.0, 1.0, 0.0, 1.0];
        assert_eq!(blend_colors(overlay, text), overlay);
    }

    #[test]
    fn test_blend_transparent_overlay() {
        let overlay = [0.0, 0.0, 0.0, 0.0];
        let text = [1.0, 1.0, 1.0, 1.0];
        let result = blend_colors(overlay, text);
        // Very low alpha overlay on white text -> near white
        assert!((result[0] - 1.0).abs() < 0.01);
    }
}
