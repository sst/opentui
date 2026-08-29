#define GPU_SHARING_NO_DAWN_CONSUMER
#include "dawn-consumer.c"
#include "three-protocol.h"
#include <dlfcn.h>

/* Reuse the tested import, callback, and error-scope implementation without a public API. */
static struct dawn_consumer producer;
static bool opened, active, validation, stopped;
static uint32_t next_sequence, reference_readbacks;
static struct three_run run;

const char *three_library_path(void) {
    Dl_info library;
    REQUIRE(dladdr((void *)wgpuDeviceHasFeature, &library) != 0, "Dawn linked library identity");
    return library.dli_fname;
}

uint32_t three_open(WGPUDevice device, WGPUInstance instance, int32_t socket, uint32_t image_width,
                    uint32_t image_height, uint32_t validate) {
    REQUIRE(!opened && device && instance && socket >= 0, "Three bridge initialization");
    run = three_run_options();
    if (run.performance) {
        REQUIRE(!validate, "performance mode cannot read back");
        three_require_readback_guard();
    }
    is_producer = true;
    width = image_width;
    height = image_height;
    connection = socket;
    validation = validate != 0;
    REQUIRE(width > 0 && height > 0 && width <= DIMENSION_MAX && height <= DIMENSION_MAX, "Three image dimensions");
    producer.device = device;
    producer.instance = instance;
    producer.queue = wgpuDeviceGetQueue(device);
    REQUIRE(wgpuDeviceHasFeature(device, WGPUFeatureName_SharedTextureMemoryDmaBuf), "native DmaBuf feature enabled");
    REQUIRE(wgpuDeviceHasFeature(device, WGPUFeatureName_SharedFenceSyncFD), "native SyncFD feature enabled");
    struct packet hello = receive_packet(HELLO, false, NULL);
    REQUIRE(hello.fourcc == DRM_FORMAT_ABGR8888 && hello.modifier == DRM_FORMAT_MOD_LINEAR &&
                hello.external_family == VK_QUEUE_FAMILY_FOREIGN_EXT,
            "Three EGL format agreement");
    WGPUAdapterInfo adapter = WGPU_ADAPTER_INFO_INIT;
    DAWN(wgpuDeviceGetAdapterInfo(device, &adapter));
    REQUIRE(adapter.backendType == WGPUBackendType_Vulkan, "Three Dawn Vulkan backend");
    send_packet((struct packet){.kind = HELLO,
                                .vendor_id = adapter.vendorID,
                                .device_id = adapter.deviceID,
                                .external_family = VK_QUEUE_FAMILY_EXTERNAL},
                -1);
    wgpuAdapterInfoFreeMembers(adapter);
    for (uint32_t i = 0; i < SLOT_COUNT; i++) {
        int fd = -1;
        struct packet registration = receive_packet(REGISTER, true, &fd);
        import_dawn_image(&producer, i, registration, fd, WGPUTextureUsage_RenderAttachment | WGPUTextureUsage_CopySrc);
        send_packet((struct packet){.kind = REGISTER, .slot = i}, -1);
    }
    if (validation) {
        wgpuDevicePushErrorScope(device, WGPUErrorFilter_Validation);
        uint32_t stride = (width * 4 + 255) & ~255u;
        producer.pixel_bytes = (size_t)stride * height;
        WGPUBufferDescriptor buffer = WGPU_BUFFER_DESCRIPTOR_INIT;
        buffer.size = producer.pixel_bytes;
        buffer.usage = WGPUBufferUsage_CopyDst | WGPUBufferUsage_MapRead;
        producer.readback = wgpuDeviceCreateBuffer(device, &buffer);
        check_errors(&producer);
    }
    opened = true;
    return run.total_frames;
}

WGPUTexture three_texture(uint32_t index) {
    REQUIRE(opened && index < SLOT_COUNT, "Three texture index");
    return producer.slots[index].texture;
}

void three_begin(uint32_t sequence) {
    REQUIRE(opened && !active && sequence == next_sequence && sequence < run.total_frames, "Three begin sequence");
    int fd = -1;
    struct packet acquire = receive_packet(RELEASE, true, &fd);
    REQUIRE(acquire.slot == sequence % SLOT_COUNT && acquire.sequence == sequence &&
                acquire.old_layout == VK_IMAGE_LAYOUT_GENERAL && acquire.new_layout == VK_IMAGE_LAYOUT_GENERAL,
            "Three acquire slot/layout");
    wgpuDevicePushErrorScope(producer.device, WGPUErrorFilter_Validation);
    WGPUSharedFenceSyncFDDescriptor sync_fd = WGPU_SHARED_FENCE_SYNC_FD_DESCRIPTOR_INIT;
    sync_fd.handle = fd;
    WGPUSharedFenceDescriptor descriptor = WGPU_SHARED_FENCE_DESCRIPTOR_INIT;
    descriptor.nextInChain = &sync_fd.chain;
    WGPUSharedFence fence = wgpuDeviceImportSharedFence(producer.device, &descriptor);
    REQUIRE(close(fd) == 0, "close Three acquire fd");
    WGPUSharedTextureMemoryVkImageLayoutBeginState layout = WGPU_SHARED_TEXTURE_MEMORY_VK_IMAGE_LAYOUT_BEGIN_STATE_INIT;
    layout.oldLayout = acquire.old_layout;
    layout.newLayout = acquire.new_layout;
    uint64_t signaled = 1;
    WGPUSharedTextureMemoryBeginAccessDescriptor begin = WGPU_SHARED_TEXTURE_MEMORY_BEGIN_ACCESS_DESCRIPTOR_INIT;
    begin.nextInChain = &layout.chain;
    begin.initialized = sequence >= SLOT_COUNT;
    begin.fenceCount = 1;
    begin.fences = &fence;
    begin.signaledValues = &signaled;
    struct dawn_slot *slot = &producer.slots[sequence % SLOT_COUNT];
    DAWN(wgpuSharedTextureMemoryBeginAccess(slot->memory, slot->texture, &begin));
    wgpuSharedFenceRelease(fence);
    active = true;
}

uint64_t three_reference_hash(WGPUTexture reference) {
    REQUIRE(opened && active && validation && reference_readbacks == next_sequence,
            "validation-only reference readback");
    for (uint32_t i = 0; i < SLOT_COUNT; i++)
        REQUIRE(reference != producer.slots[i].texture, "reference must not be shared");
    uint32_t stride = (width * 4 + 255) & ~255u;
    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(producer.device, NULL);
    WGPUTexelCopyTextureInfo source = WGPU_TEXEL_COPY_TEXTURE_INFO_INIT;
    source.texture = reference;
    WGPUTexelCopyBufferInfo target = WGPU_TEXEL_COPY_BUFFER_INFO_INIT;
    target.buffer = producer.readback;
    target.layout.bytesPerRow = stride;
    target.layout.rowsPerImage = height;
    WGPUExtent3D extent = {width, height, 1};
    wgpuCommandEncoderCopyTextureToBuffer(encoder, &source, &target, &extent);
    WGPUCommandBuffer commands = wgpuCommandEncoderFinish(encoder, NULL);
    wgpuCommandEncoderRelease(encoder);
    wgpuQueueSubmit(producer.queue, 1, &commands);
    wgpuCommandBufferRelease(commands);
    check_errors(&producer);
    bool mapped = false;
    WGPUBufferMapCallbackInfo callback = WGPU_BUFFER_MAP_CALLBACK_INFO_INIT;
    callback.mode = WGPUCallbackMode_AllowProcessEvents;
    callback.callback = map_callback;
    callback.userdata1 = &mapped;
    wgpuBufferMapAsync(producer.readback, WGPUMapMode_Read, 0, producer.pixel_bytes, callback);
    wait_callback(&producer, &mapped);
    const uint8_t *pixels = wgpuBufferGetConstMappedRange(producer.readback, 0, producer.pixel_bytes);
    REQUIRE(pixels != NULL, "Three reference mapped range");
    uint64_t hash = hash_rgba(pixels, stride);
    wgpuBufferUnmap(producer.readback);
    reference_readbacks++;
    wgpuDevicePushErrorScope(producer.device, WGPUErrorFilter_Validation);
    return hash;
}

void three_end(uint32_t sequence, uint64_t reference_hash) {
    REQUIRE(opened && active && sequence == next_sequence, "Three end sequence");
    REQUIRE(!validation || reference_readbacks == sequence + 1, "Three reference frame count");
    REQUIRE(validation || reference_hash == 0, "no-readback digest must be absent");
    struct dawn_slot *slot = &producer.slots[sequence % SLOT_COUNT];
    WGPUSharedTextureMemoryVkImageLayoutEndState layout = WGPU_SHARED_TEXTURE_MEMORY_VK_IMAGE_LAYOUT_END_STATE_INIT;
    WGPUSharedTextureMemoryEndAccessState end = WGPU_SHARED_TEXTURE_MEMORY_END_ACCESS_STATE_INIT;
    end.nextInChain = &layout.chain;
    DAWN(wgpuSharedTextureMemoryEndAccess(slot->memory, slot->texture, &end));
    REQUIRE(end.initialized && end.fenceCount == 1 && end.signaledValues[0] == 1, "Three end access state");
    WGPUSharedFenceSyncFDExportInfo sync_fd = WGPU_SHARED_FENCE_SYNC_FD_EXPORT_INFO_INIT;
    WGPUSharedFenceExportInfo export = WGPU_SHARED_FENCE_EXPORT_INFO_INIT;
    export.nextInChain = &sync_fd.chain;
    wgpuSharedFenceExportInfo(end.fences[0], &export);
    REQUIRE(export.type == WGPUSharedFenceType_SyncFD && sync_fd.handle >= 0, "Three exported sync_file");
    check_errors(&producer);
    send_packet((struct packet){.kind = FRAME,
                                .slot = sequence % SLOT_COUNT,
                                .sequence = sequence,
                                .old_layout = layout.oldLayout,
                                .new_layout = layout.newLayout,
                                .modifier = reference_hash},
                sync_fd.handle);
    wgpuSharedTextureMemoryEndAccessStateFreeMembers(end);
    active = false;
    next_sequence++;
}

void three_wait_stop(void) {
    REQUIRE(opened && !active && next_sequence == run.total_frames && !stopped, "Three stop state");
    receive_packet(STOP, false, NULL);
    stopped = true;
}

void three_close(void) {
    REQUIRE(opened && stopped && !active, "Three close state");
    for (uint32_t i = 0; i < SLOT_COUNT; i++) {
        wgpuTextureRelease(producer.slots[i].texture);
        wgpuSharedTextureMemoryRelease(producer.slots[i].memory);
    }
    if (producer.readback)
        wgpuBufferRelease(producer.readback);
    wgpuQueueRelease(producer.queue);
    send_packet((struct packet){.kind = STOP, .sequence = next_sequence, .width = reference_readbacks}, -1);
    REQUIRE(close(connection) == 0, "close Three producer connection");
    connection = -1;
    opened = false;
}
