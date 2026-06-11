#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define WUFFS_IMPLEMENTATION
#define WUFFS_CONFIG__STATIC_FUNCTIONS
#define WUFFS_CONFIG__MODULES
#define WUFFS_CONFIG__MODULE__BASE
#define WUFFS_CONFIG__MODULE__ADLER32
#define WUFFS_CONFIG__MODULE__CRC32
#define WUFFS_CONFIG__MODULE__DEFLATE
#define WUFFS_CONFIG__MODULE__LZW
#define WUFFS_CONFIG__MODULE__ZLIB
#define WUFFS_CONFIG__MODULE__GIF
#define WUFFS_CONFIG__MODULE__PNG
#include "vendor/wuffs/wuffs-v0.3.c"

#define STB_IMAGE_IMPLEMENTATION
#define STB_IMAGE_STATIC
#define STBI_ONLY_JPEG
#define STBI_NO_STDIO
#define STBI_STRICT_JPEG
#include "vendor/stb/stb_image.h"

#define STB_IMAGE_RESIZE_IMPLEMENTATION
#define STB_IMAGE_RESIZE_STATIC
#include "vendor/stb/stb_image_resize2.h"

#include "src/webp/decode.h"

enum {
    OT_IMAGE_SHIM_OK = 0,
    OT_IMAGE_SHIM_INVALID = 1,
    OT_IMAGE_SHIM_OUT_OF_MEMORY = 2,
    OT_IMAGE_SHIM_OUTPUT_TOO_SMALL = 3,
    OT_IMAGE_SHIM_UNSUPPORTED = 4,
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

static int ot_image_init_gif_decoder(wuffs_gif__decoder *decoder) {
    wuffs_base__status status = wuffs_gif__decoder__initialize(
        decoder, sizeof(*decoder), WUFFS_VERSION, 0);
    if (!wuffs_base__status__is_ok(&status)) return OT_IMAGE_SHIM_INVALID;
    wuffs_gif__decoder__set_quirk_enabled(
        decoder, WUFFS_GIF__QUIRK_IMAGE_BOUNDS_ARE_STRICT, true);
    wuffs_gif__decoder__set_quirk_enabled(
        decoder, WUFFS_GIF__QUIRK_HONOR_BACKGROUND_COLOR, true);
    return OT_IMAGE_SHIM_OK;
}

static wuffs_base__color_u32_argb_premul ot_image_gif_background_color(
        const uint8_t *data, uint32_t data_len,
        wuffs_base__color_u32_argb_premul decoded_background) {
    if ((decoded_background >> 24) == 0 || data_len < 13 || (data[10] & 0x80) == 0) {
        return decoded_background;
    }

    uint32_t palette_entries = 2u << (data[10] & 0x07);
    uint32_t background_index = data[11];
    uint32_t palette_offset = 13u + (background_index * 3u);
    if (background_index >= palette_entries || palette_offset + 3u > data_len) {
        return decoded_background;
    }
    return 0xFF000000u | ((uint32_t)data[palette_offset] << 16) |
           ((uint32_t)data[palette_offset + 1] << 8) | data[palette_offset + 2];
}

int ot_image_gif_probe(const uint8_t *data, uint32_t data_len, uint32_t *width,
                       uint32_t *height, uint32_t *has_alpha) {
    if (!data || data_len == 0 || !width || !height || !has_alpha) return OT_IMAGE_SHIM_INVALID;

    wuffs_gif__decoder *decoder = malloc(sizeof(*decoder));
    if (!decoder) return OT_IMAGE_SHIM_OUT_OF_MEMORY;
    int result = ot_image_init_gif_decoder(decoder);
    if (result != OT_IMAGE_SHIM_OK) {
        free(decoder);
        return result;
    }

    wuffs_base__io_buffer src = wuffs_base__ptr_u8__reader((uint8_t *)data, data_len, true);
    wuffs_base__image_config config = wuffs_base__null_image_config();
    wuffs_base__status status = wuffs_gif__decoder__decode_image_config(decoder, &config, &src);
    if (!wuffs_base__status__is_ok(&status) || !wuffs_base__pixel_config__is_valid(&config.pixcfg)) {
        free(decoder);
        return OT_IMAGE_SHIM_INVALID;
    }

    *width = wuffs_base__pixel_config__width(&config.pixcfg);
    *height = wuffs_base__pixel_config__height(&config.pixcfg);
    *has_alpha = wuffs_base__image_config__first_frame_is_opaque(&config) ? 0u : 1u;
    free(decoder);
    return (*width > 0 && *height > 0) ? OT_IMAGE_SHIM_OK : OT_IMAGE_SHIM_INVALID;
}

int ot_image_gif_decode_first_frame(const uint8_t *data, uint32_t data_len, uint8_t *output,
                                    uint64_t output_len, uint32_t expected_width,
                                    uint32_t expected_height) {
    if (!data || data_len == 0 || !output || expected_width == 0 || expected_height == 0) {
        return OT_IMAGE_SHIM_INVALID;
    }
    uint64_t required = (uint64_t)expected_width * (uint64_t)expected_height * 4u;
    if (required > output_len || required > SIZE_MAX) return OT_IMAGE_SHIM_OUTPUT_TOO_SMALL;

    wuffs_gif__decoder *decoder = malloc(sizeof(*decoder));
    if (!decoder) return OT_IMAGE_SHIM_OUT_OF_MEMORY;
    int result = ot_image_init_gif_decoder(decoder);
    if (result != OT_IMAGE_SHIM_OK) {
        free(decoder);
        return result;
    }

    wuffs_base__io_buffer src = wuffs_base__ptr_u8__reader((uint8_t *)data, data_len, true);
    wuffs_base__image_config config = wuffs_base__null_image_config();
    wuffs_base__status status = wuffs_gif__decoder__decode_image_config(decoder, &config, &src);
    if (!wuffs_base__status__is_ok(&status) ||
        wuffs_base__pixel_config__width(&config.pixcfg) != expected_width ||
        wuffs_base__pixel_config__height(&config.pixcfg) != expected_height) {
        free(decoder);
        return OT_IMAGE_SHIM_INVALID;
    }

    wuffs_base__frame_config frame_config = wuffs_base__null_frame_config();
    status = wuffs_gif__decoder__decode_frame_config(decoder, &frame_config, &src);
    if (!wuffs_base__status__is_ok(&status)) {
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

    wuffs_base__color_u32_argb_premul background_color =
        wuffs_base__frame_config__background_color(&frame_config);
    background_color = ot_image_gif_background_color(data, data_len, background_color);
    if (!wuffs_base__color_u32_argb_premul__is_valid(background_color)) {
        free(decoder);
        return OT_IMAGE_SHIM_INVALID;
    }
    status = wuffs_base__pixel_buffer__set_color_u32_fill_rect(
        &pixel_buffer, wuffs_base__make_rect_ie_u32(0, 0, expected_width, expected_height), background_color);
    if (!wuffs_base__status__is_ok(&status)) {
        free(decoder);
        return OT_IMAGE_SHIM_INVALID;
    }
    wuffs_base__range_ii_u64 workbuf_range = wuffs_gif__decoder__workbuf_len(decoder);
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

    status = wuffs_gif__decoder__decode_frame(
        decoder, &pixel_buffer, &src, WUFFS_BASE__PIXEL_BLEND__SRC_OVER,
        wuffs_base__make_slice_u8(workbuf, (size_t)workbuf_len), NULL);
    free(workbuf);
    free(decoder);
    return wuffs_base__status__is_ok(&status) ? OT_IMAGE_SHIM_OK : OT_IMAGE_SHIM_INVALID;
}

static int ot_image_jpeg_has_complete_structure(const uint8_t *data, uint32_t data_len) {
    if (!data || data_len < 4 || data[0] != 0xFF || data[1] != 0xD8) return 0;

    uint32_t pos = 2;
    int entropy_data = 0;
    int saw_scan = 0;
    while (pos < data_len) {
        uint8_t marker = 0;
        if (entropy_data) {
            while (pos < data_len) {
                if (data[pos++] != 0xFF) continue;
                while (pos < data_len && data[pos] == 0xFF) ++pos;
                if (pos >= data_len) return 0;
                marker = data[pos++];
                if (marker == 0x00 || (marker >= 0xD0 && marker <= 0xD7)) continue;
                break;
            }
            if (marker == 0) return 0;
        } else {
            if (data[pos++] != 0xFF) return 0;
            while (pos < data_len && data[pos] == 0xFF) ++pos;
            if (pos >= data_len) return 0;
            marker = data[pos++];
            if (marker == 0x00 || marker == 0xD8) return 0;
        }

        if (marker == 0xD9) return saw_scan;
        if (marker == 0x01) continue;
        if (marker >= 0xD0 && marker <= 0xD7) {
            entropy_data = 0;
            continue;
        }
        if (pos + 2 > data_len) return 0;
        uint32_t segment_len = ((uint32_t)data[pos] << 8) | data[pos + 1];
        if (segment_len < 2 || segment_len > data_len - pos) return 0;
        pos += segment_len;
        if (marker == 0xDA) saw_scan = 1;
        entropy_data = marker == 0xDA || (entropy_data && marker == 0xDC);
    }
    return 0;
}

int ot_image_jpeg_header_probe(const uint8_t *data, uint32_t data_len, uint32_t *width, uint32_t *height) {
    if (!data || data_len == 0 || data_len > INT32_MAX || !width || !height) return OT_IMAGE_SHIM_INVALID;
    int w = 0;
    int h = 0;
    int channels = 0;
    if (!stbi_info_from_memory(data, (int)data_len, &w, &h, &channels) || w <= 0 || h <= 0) {
        return OT_IMAGE_SHIM_INVALID;
    }
    *width = (uint32_t)w;
    *height = (uint32_t)h;
    return OT_IMAGE_SHIM_OK;
}

int ot_image_jpeg_probe(const uint8_t *data, uint32_t data_len, uint32_t *width, uint32_t *height) {
    if (!data || data_len == 0 || data_len > INT32_MAX || !width || !height) return OT_IMAGE_SHIM_INVALID;
    if (!ot_image_jpeg_has_complete_structure(data, data_len)) return OT_IMAGE_SHIM_INVALID;
    int w = 0;
    int h = 0;
    int channels = 0;
    uint8_t *decoded = stbi_load_from_memory(data, (int)data_len, &w, &h, &channels, 4);
    if (!decoded) return OT_IMAGE_SHIM_INVALID;
    stbi_image_free(decoded);
    if (w <= 0 || h <= 0) return OT_IMAGE_SHIM_INVALID;
    *width = (uint32_t)w;
    *height = (uint32_t)h;
    return OT_IMAGE_SHIM_OK;
}

int ot_image_jpeg_decode(const uint8_t *data, uint32_t data_len, uint8_t *output,
                         uint64_t output_len, uint32_t expected_width, uint32_t expected_height) {
    if (!data || data_len == 0 || data_len > INT32_MAX || !output ||
        expected_width == 0 || expected_height == 0) return OT_IMAGE_SHIM_INVALID;
    uint64_t required = (uint64_t)expected_width * (uint64_t)expected_height * 4u;
    if (required > output_len || required > SIZE_MAX) return OT_IMAGE_SHIM_OUTPUT_TOO_SMALL;
    if (!ot_image_jpeg_has_complete_structure(data, data_len)) return OT_IMAGE_SHIM_INVALID;

    int width = 0;
    int height = 0;
    int channels = 0;
    uint8_t *decoded = stbi_load_from_memory(data, (int)data_len, &width, &height, &channels, 4);
    if (!decoded) return OT_IMAGE_SHIM_INVALID;
    if ((uint32_t)width != expected_width || (uint32_t)height != expected_height) {
        stbi_image_free(decoded);
        return OT_IMAGE_SHIM_INVALID;
    }
    memcpy(output, decoded, (size_t)required);
    stbi_image_free(decoded);
    return OT_IMAGE_SHIM_OK;
}

int ot_image_webp_probe(const uint8_t *data, uint32_t data_len, uint32_t *width,
                        uint32_t *height, uint32_t *has_alpha) {
    if (!data || data_len == 0 || !width || !height || !has_alpha) return OT_IMAGE_SHIM_INVALID;
    WebPBitstreamFeatures features;
    VP8StatusCode status = WebPGetFeatures(data, data_len, &features);
    if (status != VP8_STATUS_OK) return status == VP8_STATUS_OUT_OF_MEMORY ? OT_IMAGE_SHIM_OUT_OF_MEMORY : OT_IMAGE_SHIM_INVALID;
    if (features.has_animation) return OT_IMAGE_SHIM_UNSUPPORTED;
    if (features.width <= 0 || features.height <= 0) return OT_IMAGE_SHIM_INVALID;
    *width = (uint32_t)features.width;
    *height = (uint32_t)features.height;
    *has_alpha = features.has_alpha ? 1u : 0u;
    return OT_IMAGE_SHIM_OK;
}

int ot_image_webp_decode(const uint8_t *data, uint32_t data_len, uint8_t *output,
                         uint64_t output_len, uint32_t expected_width, uint32_t expected_height) {
    if (!data || data_len == 0 || !output || expected_width == 0 || expected_height == 0) {
        return OT_IMAGE_SHIM_INVALID;
    }
    uint64_t required = (uint64_t)expected_width * (uint64_t)expected_height * 4u;
    if (required > output_len || required > SIZE_MAX || expected_width > INT32_MAX) {
        return OT_IMAGE_SHIM_OUTPUT_TOO_SMALL;
    }

    WebPDecoderConfig config;
    if (!WebPInitDecoderConfig(&config)) return OT_IMAGE_SHIM_INVALID;
    VP8StatusCode status = WebPGetFeatures(data, data_len, &config.input);
    if (status != VP8_STATUS_OK) return status == VP8_STATUS_OUT_OF_MEMORY ? OT_IMAGE_SHIM_OUT_OF_MEMORY : OT_IMAGE_SHIM_INVALID;
    if (config.input.has_animation) return OT_IMAGE_SHIM_UNSUPPORTED;
    if ((uint32_t)config.input.width != expected_width || (uint32_t)config.input.height != expected_height) {
        return OT_IMAGE_SHIM_INVALID;
    }

    config.output.colorspace = MODE_RGBA;
    config.output.is_external_memory = 1;
    config.output.u.RGBA.rgba = output;
    config.output.u.RGBA.stride = (int)(expected_width * 4u);
    config.output.u.RGBA.size = (size_t)required;
    config.options.use_threads = 0;
    status = WebPDecode(data, data_len, &config);
    WebPFreeDecBuffer(&config.output);
    if (status == VP8_STATUS_OK) return OT_IMAGE_SHIM_OK;
    if (status == VP8_STATUS_OUT_OF_MEMORY) return OT_IMAGE_SHIM_OUT_OF_MEMORY;
    if (status == VP8_STATUS_UNSUPPORTED_FEATURE) return OT_IMAGE_SHIM_UNSUPPORTED;
    return OT_IMAGE_SHIM_INVALID;
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
