#include <stdint.h>
#include <stdlib.h>

#define WUFFS_IMPLEMENTATION
#define WUFFS_CONFIG__STATIC_FUNCTIONS
#define WUFFS_CONFIG__MODULES
#define WUFFS_CONFIG__MODULE__BASE
#define WUFFS_CONFIG__MODULE__ADLER32
#define WUFFS_CONFIG__MODULE__CRC32
#define WUFFS_CONFIG__MODULE__DEFLATE
#define WUFFS_CONFIG__MODULE__ZLIB
#define WUFFS_CONFIG__MODULE__PNG
#include "vendor/wuffs/wuffs-v0.3.c"

#define STB_IMAGE_RESIZE_IMPLEMENTATION
#define STB_IMAGE_RESIZE_STATIC
#include "vendor/stb/stb_image_resize2.h"

enum {
    OT_IMAGE_SHIM_OK = 0,
    OT_IMAGE_SHIM_INVALID = 1,
    OT_IMAGE_SHIM_OUT_OF_MEMORY = 2,
    OT_IMAGE_SHIM_OUTPUT_TOO_SMALL = 3,
};

static int ot_image_init_png_decoder(wuffs_png__decoder *decoder) {
    wuffs_base__status status = wuffs_png__decoder__initialize(
        decoder, sizeof(*decoder), WUFFS_VERSION, 0);
    return wuffs_base__status__is_ok(&status) ? OT_IMAGE_SHIM_OK : OT_IMAGE_SHIM_INVALID;
}

int ot_image_png_probe(const uint8_t *data, uint32_t data_len, uint32_t *width, uint32_t *height) {
    if (!data || data_len == 0 || !width || !height) return OT_IMAGE_SHIM_INVALID;

    wuffs_png__decoder *decoder = malloc(sizeof(*decoder));
    if (!decoder) return OT_IMAGE_SHIM_OUT_OF_MEMORY;

    int result = ot_image_init_png_decoder(decoder);
    if (result != OT_IMAGE_SHIM_OK) {
        free(decoder);
        return result;
    }

    wuffs_base__io_buffer src = wuffs_base__ptr_u8__reader((uint8_t *)data, data_len, true);
    wuffs_base__image_config config = wuffs_base__null_image_config();
    wuffs_base__status status = wuffs_png__decoder__decode_image_config(decoder, &config, &src);
    if (!wuffs_base__status__is_ok(&status) || !wuffs_base__pixel_config__is_valid(&config.pixcfg)) {
        free(decoder);
        return OT_IMAGE_SHIM_INVALID;
    }

    *width = wuffs_base__pixel_config__width(&config.pixcfg);
    *height = wuffs_base__pixel_config__height(&config.pixcfg);
    free(decoder);
    return (*width > 0 && *height > 0) ? OT_IMAGE_SHIM_OK : OT_IMAGE_SHIM_INVALID;
}

int ot_image_png_decode(const uint8_t *data, uint32_t data_len, uint8_t *output,
                        uint64_t output_len, uint32_t expected_width, uint32_t expected_height) {
    if (!data || data_len == 0 || !output || expected_width == 0 || expected_height == 0) {
        return OT_IMAGE_SHIM_INVALID;
    }

    uint64_t required = (uint64_t)expected_width * (uint64_t)expected_height * 4u;
    if (required > output_len || required > SIZE_MAX) return OT_IMAGE_SHIM_OUTPUT_TOO_SMALL;

    wuffs_png__decoder *decoder = malloc(sizeof(*decoder));
    if (!decoder) return OT_IMAGE_SHIM_OUT_OF_MEMORY;

    int result = ot_image_init_png_decoder(decoder);
    if (result != OT_IMAGE_SHIM_OK) {
        free(decoder);
        return result;
    }

    wuffs_base__io_buffer src = wuffs_base__ptr_u8__reader((uint8_t *)data, data_len, true);
    wuffs_base__image_config config = wuffs_base__null_image_config();
    wuffs_base__status status = wuffs_png__decoder__decode_image_config(decoder, &config, &src);
    if (!wuffs_base__status__is_ok(&status) ||
        wuffs_base__pixel_config__width(&config.pixcfg) != expected_width ||
        wuffs_base__pixel_config__height(&config.pixcfg) != expected_height) {
        free(decoder);
        return OT_IMAGE_SHIM_INVALID;
    }

    wuffs_base__pixel_config output_config = wuffs_base__null_pixel_config();
    wuffs_base__pixel_config__set(&output_config, WUFFS_BASE__PIXEL_FORMAT__RGBA_NONPREMUL,
                                  WUFFS_BASE__PIXEL_SUBSAMPLING__NONE,
                                  expected_width, expected_height);
    wuffs_base__pixel_buffer pixel_buffer;
    status = wuffs_base__pixel_buffer__set_from_slice(
        &pixel_buffer, &output_config, wuffs_base__make_slice_u8(output, (size_t)required));
    if (!wuffs_base__status__is_ok(&status)) {
        free(decoder);
        return OT_IMAGE_SHIM_INVALID;
    }

    wuffs_base__range_ii_u64 workbuf_range = wuffs_png__decoder__workbuf_len(decoder);
    uint64_t workbuf_len = workbuf_range.max_incl;
    if (workbuf_len > SIZE_MAX) {
        free(decoder);
        return OT_IMAGE_SHIM_OUT_OF_MEMORY;
    }

    uint8_t *workbuf = workbuf_len ? malloc((size_t)workbuf_len) : NULL;
    if (workbuf_len && !workbuf) {
        free(decoder);
        return OT_IMAGE_SHIM_OUT_OF_MEMORY;
    }

    status = wuffs_png__decoder__decode_frame(
        decoder, &pixel_buffer, &src, WUFFS_BASE__PIXEL_BLEND__SRC,
        wuffs_base__make_slice_u8(workbuf, (size_t)workbuf_len), NULL);
    free(workbuf);
    free(decoder);
    return wuffs_base__status__is_ok(&status) ? OT_IMAGE_SHIM_OK : OT_IMAGE_SHIM_INVALID;
}

int ot_image_resize_rgba(const uint8_t *input, uint32_t input_width, uint32_t input_height,
                         uint32_t input_stride, uint8_t *output, uint32_t output_width,
                         uint32_t output_height, uint32_t output_stride, uint32_t filter) {
    if (!input || !output || input_width == 0 || input_height == 0 ||
        output_width == 0 || output_height == 0 || input_width > INT32_MAX ||
        input_height > INT32_MAX || output_width > INT32_MAX || output_height > INT32_MAX ||
        input_stride > INT32_MAX || output_stride > INT32_MAX || filter > STBIR_FILTER_POINT_SAMPLE) {
        return OT_IMAGE_SHIM_INVALID;
    }

    void *result = stbir_resize(
        input, (int)input_width, (int)input_height, (int)input_stride,
        output, (int)output_width, (int)output_height, (int)output_stride,
        STBIR_RGBA, STBIR_TYPE_UINT8_SRGB, STBIR_EDGE_CLAMP, (stbir_filter)filter);
    return result ? OT_IMAGE_SHIM_OK : OT_IMAGE_SHIM_OUT_OF_MEMORY;
}
