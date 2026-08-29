#ifndef GPU_SHARING_THREE_PROTOCOL_H
#define GPU_SHARING_THREE_PROTOCOL_H
#include "protocol.h"

/* FRAME.modifier carries a validation digest, never pixels. REGISTER retains its DRM meaning. */
static uint64_t hash_rgba(const uint8_t *pixels, uint32_t row_bytes) {
    uint64_t hash = UINT64_C(14695981039346656037);
    for (uint32_t y = 0; y < height; y++) {
        for (uint32_t x = 0; x < width * 4; x++) {
            hash ^= pixels[(size_t)y * row_bytes + x];
            hash *= UINT64_C(1099511628211);
        }
    }
    return hash;
}
#endif
