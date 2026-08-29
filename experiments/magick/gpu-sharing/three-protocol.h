#ifndef GPU_SHARING_THREE_PROTOCOL_H
#define GPU_SHARING_THREE_PROTOCOL_H
#include "protocol.h"
#include <dlfcn.h>

enum { THREE_PERF_FRAMES_MAX = 10000, THREE_PERF_WARMUP_MAX = 1000, THREE_PERF_PACE_US_MAX = 100000 };

struct three_run {
    bool performance;
    uint32_t measured_frames, warmup_frames, pace_us, total_frames, timeout_seconds;
};

static uint32_t three_option(const char *name, uint32_t fallback, uint32_t maximum) {
    const char *text = getenv(name);
    if (!text)
        return fallback;
    size_t length = strnlen(text, 11);
    REQUIRE(length > 0 && length <= 10, name);
    for (size_t i = 0; i < length; i++)
        REQUIRE(text[i] >= '0' && text[i] <= '9', name);
    errno = 0;
    char *end;
    unsigned long value = strtoul(text, &end, 10);
    REQUIRE(errno == 0 && *end == 0 && value <= maximum, name);
    return (uint32_t)value;
}

static struct three_run three_run_options(void) {
    struct three_run run = {.measured_frames = FRAME_COUNT, .total_frames = FRAME_COUNT, .timeout_seconds = 55};
    if (!getenv("GPU_SHARING_PERF_FRAMES")) {
        REQUIRE(!getenv("GPU_SHARING_PERF_WARMUP") && !getenv("GPU_SHARING_PERF_PACE_US"),
                "performance options require GPU_SHARING_PERF_FRAMES");
        return run;
    }
    run.performance = true;
    run.measured_frames = three_option("GPU_SHARING_PERF_FRAMES", 0, THREE_PERF_FRAMES_MAX);
    REQUIRE(run.measured_frames > 0, "GPU_SHARING_PERF_FRAMES must be positive");
    run.warmup_frames = three_option("GPU_SHARING_PERF_WARMUP", 60, THREE_PERF_WARMUP_MAX);
    run.pace_us = three_option("GPU_SHARING_PERF_PACE_US", 0, THREE_PERF_PACE_US_MAX);
    run.total_frames = run.measured_frames + run.warmup_frames;
    /* A 60-second service/startup budget plus the maximum requested pacing time. */
    run.timeout_seconds = 60 + (uint32_t)(((uint64_t)run.total_frames * run.pace_us + 999999) / 1000000);
    return run;
}

static void three_require_readback_guard(void) {
    uint32_t (*guard)(void) = (uint32_t (*)(void))dlsym(RTLD_DEFAULT, "gpu_sharing_readback_guard");
    REQUIRE(guard && guard() == 1, "performance mode requires the no-readback preload guard");
}

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
