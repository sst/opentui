#include <stdint.h>
#include <stdlib.h>
#include <string.h>

// stb_image_resize2 lives in its own translation unit: its sRGB conversion
// intentionally biases a static table pointer out of bounds
// (fp32_to_srgb8_tab4 - (127-13)*8) and rebalances it with large indices.
// That idiom is correct at runtime but trips UBSan's bounds check, so this
// file is compiled with the bounds sanitizers disabled while the decoders in
// image-shim.c keep full sanitization for untrusted input.
#define STB_IMAGE_RESIZE_IMPLEMENTATION
#define STB_IMAGE_RESIZE_STATIC
#include "vendor/stb/stb_image_resize2.h"

enum {
    OT_IMAGE_RESIZE_SHIM_OK = 0,
    OT_IMAGE_RESIZE_SHIM_INVALID = 1,
    OT_IMAGE_RESIZE_SHIM_OUT_OF_MEMORY = 2,
};

int ot_image_resize_rgba(const uint8_t *input, uint32_t input_width, uint32_t input_height,
                         uint32_t input_stride, uint8_t *output, uint32_t output_width,
                         uint32_t output_height, uint32_t output_stride, uint32_t filter) {
    if (!input || !output || input_width == 0 || input_height == 0 ||
        output_width == 0 || output_height == 0 || input_width > INT32_MAX ||
        input_height > INT32_MAX || output_width > INT32_MAX || output_height > INT32_MAX ||
        input_stride > INT32_MAX || output_stride > INT32_MAX || filter > STBIR_FILTER_POINT_SAMPLE) {
        return OT_IMAGE_RESIZE_SHIM_INVALID;
    }

    void *result = stbir_resize(
        input, (int)input_width, (int)input_height, (int)input_stride,
        output, (int)output_width, (int)output_height, (int)output_stride,
        STBIR_RGBA, STBIR_TYPE_UINT8_SRGB, STBIR_EDGE_CLAMP, (stbir_filter)filter);
    return result ? OT_IMAGE_RESIZE_SHIM_OK : OT_IMAGE_RESIZE_SHIM_OUT_OF_MEMORY;
}
