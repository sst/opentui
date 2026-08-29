#define _GNU_SOURCE
#include <dawn/webgpu.h>
#include <drm_fourcc.h>
#include <vulkan/vulkan.h>
#include <fcntl.h>
#include <time.h>
#include "protocol.h"

#define DAWN(call)                                                                                                     \
    do {                                                                                                               \
        WGPUStatus status_ = (call);                                                                                   \
        if (status_ != WGPUStatus_Success)                                                                             \
            fail(#call, status_);                                                                                      \
    } while (0)

struct dawn_slot {
    WGPUSharedTextureMemory memory;
    WGPUTexture texture;
    WGPUTextureView view;
    WGPUBindGroup bindings;
};

struct dawn_consumer {
    WGPUDevice device;
    WGPUInstance instance;
    WGPUQueue queue;
    WGPUComputePipeline pipeline;
    WGPUBindGroupLayout layout;
    WGPUBuffer output, readback;
    struct dawn_slot slots[SLOT_COUNT];
    size_t pixel_bytes;
};

static void map_callback(WGPUMapAsyncStatus status, WGPUStringView message, void *userdata, void *unused) {
    (void)unused;
    if (status != WGPUMapAsyncStatus_Success) {
        fprintf(stderr, "Dawn map: %.*s\n", (int)message.length, message.data);
        fail("wgpuBufferMapAsync", status);
    }
    *(bool *)userdata = true;
}

static void error_callback(WGPUPopErrorScopeStatus status, WGPUErrorType type, WGPUStringView message, void *userdata,
                           void *unused) {
    (void)unused;
    if (status != WGPUPopErrorScopeStatus_Success || type != WGPUErrorType_NoError) {
        fprintf(stderr, "Dawn validation: %.*s\n", (int)message.length, message.data);
        fail("Dawn error scope", type);
    }
    *(bool *)userdata = true;
}

static void wait_callback(struct dawn_consumer *c, bool *done) {
    /* ProcessEvents callbacks run on this thread, including during a Bun FFI call. */
    for (uint32_t attempt = 0; attempt < WAIT_MS; attempt++) {
        wgpuInstanceProcessEvents(c->instance);
        if (*done)
            return;
        struct timespec delay = {.tv_nsec = 1000000};
        REQUIRE(nanosleep(&delay, NULL) == 0, "Dawn callback sleep");
    }
    fail("Dawn callback timeout", WAIT_MS);
}

static void check_errors(struct dawn_consumer *c) {
    bool done = false;
    WGPUPopErrorScopeCallbackInfo info = WGPU_POP_ERROR_SCOPE_CALLBACK_INFO_INIT;
    info.mode = WGPUCallbackMode_AllowProcessEvents;
    info.callback = error_callback;
    info.userdata1 = &done;
    wgpuDevicePopErrorScope(c->device, info);
    wait_callback(c, &done);
}

static void init_dawn(struct dawn_consumer *c) {
    REQUIRE(wgpuDeviceHasFeature(c->device, WGPUFeatureName_SharedTextureMemoryDmaBuf),
            "native DmaBuf feature enabled");
    REQUIRE(wgpuDeviceHasFeature(c->device, WGPUFeatureName_SharedFenceSyncFD), "native SyncFD feature enabled");
    WGPUAdapterInfo adapter = WGPU_ADAPTER_INFO_INIT;
    DAWN(wgpuDeviceGetAdapterInfo(c->device, &adapter));
    REQUIRE(adapter.backendType == WGPUBackendType_Vulkan, "Dawn Vulkan backend");
    send_packet((struct packet){.kind = HELLO,
                                .fourcc = DRM_FORMAT_ABGR8888,
                                .modifier = DRM_FORMAT_MOD_LINEAR,
                                .external_family = VK_QUEUE_FAMILY_EXTERNAL,
                                .vendor_id = adapter.vendorID,
                                .device_id = adapter.deviceID},
                -1);
    wgpuAdapterInfoFreeMembers(adapter);
    wgpuDevicePushErrorScope(c->device, WGPUErrorFilter_Validation);
    c->queue = wgpuDeviceGetQueue(c->device);
    const char *code = "@group(0) @binding(0) var source_image: texture_2d<f32>;"
                       "@group(0) @binding(1) var<storage,read_write> pixels: array<u32>;"
                       "@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) p: vec3<u32>){"
                       "let size=textureDimensions(source_image); if(any(p.xy>=size)){return;}"
                       "pixels[p.y*size.x+p.x]=pack4x8unorm(textureLoad(source_image,vec2<i32>(p.xy),0));}";
    WGPUShaderSourceWGSL wgsl = WGPU_SHADER_SOURCE_WGSL_INIT;
    wgsl.code = (WGPUStringView){code, strlen(code)};
    WGPUShaderModuleDescriptor shader_descriptor = WGPU_SHADER_MODULE_DESCRIPTOR_INIT;
    shader_descriptor.nextInChain = &wgsl.chain;
    WGPUShaderModule shader = wgpuDeviceCreateShaderModule(c->device, &shader_descriptor);
    WGPUComputePipelineDescriptor pipeline = WGPU_COMPUTE_PIPELINE_DESCRIPTOR_INIT;
    pipeline.compute.module = shader;
    pipeline.compute.entryPoint = (WGPUStringView){"main", 4};
    c->pipeline = wgpuDeviceCreateComputePipeline(c->device, &pipeline);
    wgpuShaderModuleRelease(shader);
    c->layout = wgpuComputePipelineGetBindGroupLayout(c->pipeline, 0);
    c->pixel_bytes = (size_t)width * height * 4;
    WGPUBufferDescriptor buffer = WGPU_BUFFER_DESCRIPTOR_INIT;
    buffer.size = c->pixel_bytes;
    buffer.usage = WGPUBufferUsage_Storage | WGPUBufferUsage_CopySrc;
    c->output = wgpuDeviceCreateBuffer(c->device, &buffer);
    buffer.usage = WGPUBufferUsage_CopyDst | WGPUBufferUsage_MapRead;
    c->readback = wgpuDeviceCreateBuffer(c->device, &buffer);
    check_errors(c);
}

static void dawn_import_slot(struct dawn_consumer *c, uint32_t index) {
    int fd = -1;
    struct packet packet = receive_packet(REGISTER, true, &fd);
    REQUIRE(packet.slot == index && packet.width == width && packet.height == height, "Dawn slot dimensions");
    REQUIRE(packet.fourcc == DRM_FORMAT_ABGR8888 && packet.modifier == DRM_FORMAT_MOD_LINEAR &&
                packet.stride >= width * 4 && packet.stride <= INT32_MAX && packet.offset <= INT32_MAX,
            "Dawn format/plane");
    wgpuDevicePushErrorScope(c->device, WGPUErrorFilter_Validation);
    WGPUSharedTextureMemoryDmaBufPlane plane = {.fd = fd, .offset = packet.offset, .stride = packet.stride};
    WGPUSharedTextureMemoryDmaBufDescriptor dma_buf = WGPU_SHARED_TEXTURE_MEMORY_DMA_BUF_DESCRIPTOR_INIT;
    dma_buf.size = (WGPUExtent3D){width, height, 1};
    dma_buf.drmFormat = packet.fourcc;
    dma_buf.drmModifier = packet.modifier;
    dma_buf.planeCount = 1;
    dma_buf.planes = &plane;
    WGPUSharedTextureMemoryDescriptor descriptor = WGPU_SHARED_TEXTURE_MEMORY_DESCRIPTOR_INIT;
    descriptor.nextInChain = &dma_buf.chain;
    struct dawn_slot *slot = &c->slots[index];
    slot->memory = wgpuDeviceImportSharedTextureMemory(c->device, &descriptor);
    REQUIRE(slot->memory != NULL, "wgpuDeviceImportSharedTextureMemory");
    check_errors(c);
    REQUIRE(close(fd) == 0, "close Dawn imported DMA-BUF");
    wgpuDevicePushErrorScope(c->device, WGPUErrorFilter_Validation);
    WGPUSharedTextureMemoryProperties properties = WGPU_SHARED_TEXTURE_MEMORY_PROPERTIES_INIT;
    DAWN(wgpuSharedTextureMemoryGetProperties(slot->memory, &properties));
    REQUIRE(properties.format == WGPUTextureFormat_RGBA8Unorm && properties.size.width == width &&
                properties.size.height == height && properties.size.depthOrArrayLayers == 1 &&
                (properties.usage & WGPUTextureUsage_TextureBinding),
            "Dawn imported texture properties");
    WGPUTextureDescriptor texture = WGPU_TEXTURE_DESCRIPTOR_INIT;
    texture.dimension = WGPUTextureDimension_2D;
    texture.size = properties.size;
    texture.format = properties.format;
    texture.usage = WGPUTextureUsage_TextureBinding;
    slot->texture = wgpuSharedTextureMemoryCreateTexture(slot->memory, &texture);
    slot->view = wgpuTextureCreateView(slot->texture, NULL);
    WGPUBindGroupEntry entries[2] = {WGPU_BIND_GROUP_ENTRY_INIT, WGPU_BIND_GROUP_ENTRY_INIT};
    entries[0].binding = 0;
    entries[0].textureView = slot->view;
    entries[1].binding = 1;
    entries[1].buffer = c->output;
    entries[1].size = c->pixel_bytes;
    WGPUBindGroupDescriptor bindings = WGPU_BIND_GROUP_DESCRIPTOR_INIT;
    bindings.layout = c->layout;
    bindings.entryCount = 2;
    bindings.entries = entries;
    slot->bindings = wgpuDeviceCreateBindGroup(c->device, &bindings);
    check_errors(c);
    send_packet((struct packet){.kind = REGISTER, .slot = index}, -1);
}

static void dawn_consume_frame(struct dawn_consumer *c, uint32_t sequence) {
    int fd = -1;
    struct packet packet = receive_packet(FRAME, true, &fd);
    REQUIRE(packet.slot == sequence % SLOT_COUNT && packet.sequence == sequence, "Dawn frame sequence");
    REQUIRE(packet.old_layout == VK_IMAGE_LAYOUT_GENERAL && packet.new_layout == VK_IMAGE_LAYOUT_GENERAL,
            "Dawn acquire layouts");
    struct dawn_slot *slot = &c->slots[packet.slot];
    wgpuDevicePushErrorScope(c->device, WGPUErrorFilter_Validation);
    WGPUSharedFenceSyncFDDescriptor sync_fd = WGPU_SHARED_FENCE_SYNC_FD_DESCRIPTOR_INIT;
    sync_fd.handle = fd;
    WGPUSharedFenceDescriptor fence_descriptor = WGPU_SHARED_FENCE_DESCRIPTOR_INIT;
    fence_descriptor.nextInChain = &sync_fd.chain;
    WGPUSharedFence fence = wgpuDeviceImportSharedFence(c->device, &fence_descriptor);
    REQUIRE(close(fd) == 0, "close Dawn imported sync_file");
    WGPUSharedTextureMemoryVkImageLayoutBeginState layout = WGPU_SHARED_TEXTURE_MEMORY_VK_IMAGE_LAYOUT_BEGIN_STATE_INIT;
    layout.oldLayout = packet.old_layout;
    layout.newLayout = packet.new_layout;
    uint64_t signaled = 1;
    WGPUSharedTextureMemoryBeginAccessDescriptor begin = WGPU_SHARED_TEXTURE_MEMORY_BEGIN_ACCESS_DESCRIPTOR_INIT;
    begin.nextInChain = &layout.chain;
    begin.initialized = true;
    begin.fenceCount = 1;
    begin.fences = &fence;
    begin.signaledValues = &signaled;
    DAWN(wgpuSharedTextureMemoryBeginAccess(slot->memory, slot->texture, &begin));
    wgpuSharedFenceRelease(fence);
    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(c->device, NULL);
    WGPUComputePassEncoder pass = wgpuCommandEncoderBeginComputePass(encoder, NULL);
    wgpuComputePassEncoderSetPipeline(pass, c->pipeline);
    wgpuComputePassEncoderSetBindGroup(pass, 0, slot->bindings, 0, NULL);
    wgpuComputePassEncoderDispatchWorkgroups(pass, (width + 7) / 8, (height + 7) / 8, 1);
    wgpuComputePassEncoderEnd(pass);
    wgpuComputePassEncoderRelease(pass);
    wgpuCommandEncoderCopyBufferToBuffer(encoder, c->output, 0, c->readback, 0, c->pixel_bytes);
    WGPUCommandBuffer commands = wgpuCommandEncoderFinish(encoder, NULL);
    wgpuCommandEncoderRelease(encoder);
    wgpuQueueSubmit(c->queue, 1, &commands);
    wgpuCommandBufferRelease(commands);
    WGPUSharedTextureMemoryVkImageLayoutEndState end_layout = WGPU_SHARED_TEXTURE_MEMORY_VK_IMAGE_LAYOUT_END_STATE_INIT;
    WGPUSharedTextureMemoryEndAccessState end = WGPU_SHARED_TEXTURE_MEMORY_END_ACCESS_STATE_INIT;
    end.nextInChain = &end_layout.chain;
    DAWN(wgpuSharedTextureMemoryEndAccess(slot->memory, slot->texture, &end));
    REQUIRE(end.initialized && end.fenceCount == 1 && end.signaledValues[0] == 1, "Dawn release state");
    WGPUSharedFenceSyncFDExportInfo sync_export = WGPU_SHARED_FENCE_SYNC_FD_EXPORT_INFO_INIT;
    WGPUSharedFenceExportInfo export = WGPU_SHARED_FENCE_EXPORT_INFO_INIT;
    export.nextInChain = &sync_export.chain;
    wgpuSharedFenceExportInfo(end.fences[0], &export);
    REQUIRE(export.type == WGPUSharedFenceType_SyncFD && sync_export.handle >= 0, "Dawn export sync_file");
    /* ExportInfo borrows the handle; own a duplicate across FreeMembers. */
    int release_fd = fcntl(sync_export.handle, F_DUPFD_CLOEXEC, 0);
    REQUIRE(release_fd >= 0, "duplicate Dawn release sync_file");
    wgpuSharedTextureMemoryEndAccessStateFreeMembers(end);
    check_errors(c);
    bool mapped = false;
    WGPUBufferMapCallbackInfo map = WGPU_BUFFER_MAP_CALLBACK_INFO_INIT;
    map.mode = WGPUCallbackMode_AllowProcessEvents;
    map.callback = map_callback;
    map.userdata1 = &mapped;
    wgpuBufferMapAsync(c->readback, WGPUMapMode_Read, 0, c->pixel_bytes, map);
    wait_callback(c, &mapped);
    const uint8_t *pixels = wgpuBufferGetConstMappedRange(c->readback, 0, c->pixel_bytes);
    REQUIRE(pixels != NULL, "Dawn validation mapped range");
    verify_pixels(pixels, sequence);
    wgpuBufferUnmap(c->readback);
    send_packet((struct packet){.kind = RELEASE,
                                .slot = packet.slot,
                                .sequence = sequence,
                                .old_layout = end_layout.oldLayout,
                                .new_layout = end_layout.newLayout},
                release_fd);
    REQUIRE(close(release_fd) == 0, "close Dawn release sync_file");
}

void dawn_consume(WGPUDevice device, WGPUInstance instance, int32_t socket, uint32_t image_width,
                  uint32_t image_height) {
    is_producer = false;
    connection = socket;
    width = image_width;
    height = image_height;
    REQUIRE(device && instance && socket >= 0 && width > 0 && height > 0 && width <= DIMENSION_MAX &&
                height <= DIMENSION_MAX,
            "Dawn consumer arguments");
    struct dawn_consumer c = {.device = device, .instance = instance};
    init_dawn(&c);
    for (uint32_t i = 0; i < SLOT_COUNT; i++)
        dawn_import_slot(&c, i);
    for (uint32_t sequence = 0; sequence < FRAME_COUNT; sequence++)
        dawn_consume_frame(&c, sequence);
    receive_packet(STOP, false, NULL);
    for (uint32_t i = 0; i < SLOT_COUNT; i++) {
        wgpuBindGroupRelease(c.slots[i].bindings);
        wgpuTextureViewRelease(c.slots[i].view);
        wgpuTextureRelease(c.slots[i].texture);
        wgpuSharedTextureMemoryRelease(c.slots[i].memory);
    }
    wgpuBufferRelease(c.output);
    wgpuBufferRelease(c.readback);
    wgpuBindGroupLayoutRelease(c.layout);
    wgpuComputePipelineRelease(c.pipeline);
    wgpuQueueRelease(c.queue);
    send_packet((struct packet){.kind = STOP, .sequence = FRAME_COUNT}, -1);
    REQUIRE(close(connection) == 0, "close Dawn connection");
    connection = -1;
}
