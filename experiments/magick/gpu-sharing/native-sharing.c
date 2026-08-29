#define _GNU_SOURCE
#define EGL_EGLEXT_PROTOTYPES
#define GL_GLEXT_PROTOTYPES
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES3/gl3.h>
#include <GLES2/gl2ext.h>
#include <drm_fourcc.h>
#include <gbm.h>
#include <vulkan/vulkan.h>
#include <fcntl.h>
#include <signal.h>
#include <stdint.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/sysmacros.h>
#include <sys/types.h>
#include <sys/wait.h>
#include "producer_spv.h"
#include "protocol.h"

static const uint64_t wait_ns = (uint64_t)WAIT_MS * 1000000;
static pid_t child_pid = -1;

#define VK(call)                                                                                                       \
    do {                                                                                                               \
        VkResult result_ = (call);                                                                                     \
        if (result_ != VK_SUCCESS)                                                                                     \
            fail(#call, result_);                                                                                      \
    } while (0)
#define EGL_CHECK(call)                                                                                                \
    do {                                                                                                               \
        if (!(call))                                                                                                   \
            fail(#call, eglGetError());                                                                                \
    } while (0)
#define GL_CHECK()                                                                                                     \
    do {                                                                                                               \
        GLenum error_ = glGetError();                                                                                  \
        if (error_ != GL_NO_ERROR)                                                                                     \
            fail("glGetError", error_);                                                                                \
    } while (0)

static void cleanup_process(void) {
    if (connection >= 0)
        close(connection);
    if (child_pid > 0) {
        if (kill(child_pid, SIGKILL) < 0 && errno != ESRCH)
            perror("kill child");
        while (waitpid(child_pid, NULL, 0) < 0 && errno == EINTR) {
        }
    }
}

struct vk_slot {
    VkImage image;
    VkDeviceMemory memory;
    VkImageView view;
    VkDescriptorSet descriptors;
    VkCommandBuffer commands;
    VkSemaphore ready, released;
    VkFence submitted;
    bool used;
    VkImageLayout released_old_layout, released_new_layout;
    struct packet registration;
};

struct producer {
    VkInstance instance;
    VkPhysicalDevice physical;
    VkDevice device;
    VkQueue queue;
    uint32_t family;
    uint32_t external_family, vendor_id, device_id;
    VkCommandPool command_pool;
    VkDescriptorSetLayout descriptor_layout;
    VkDescriptorPool descriptor_pool;
    VkPipelineLayout pipeline_layout;
    VkPipeline pipeline;
    struct vk_slot slots[SLOT_COUNT];
    char name[VK_MAX_PHYSICAL_DEVICE_NAME_SIZE];
    PFN_vkGetMemoryFdKHR get_memory_fd;
    PFN_vkGetSemaphoreFdKHR get_semaphore_fd;
    PFN_vkImportSemaphoreFdKHR import_semaphore_fd;
};

static void select_device(struct producer *p, const char *node) {
    VkApplicationInfo app = {.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO, .apiVersion = VK_API_VERSION_1_2};
    VkInstanceCreateInfo instance = {.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO, .pApplicationInfo = &app};
    VK(vkCreateInstance(&instance, NULL, &p->instance));
    uint32_t count = 0;
    VK(vkEnumeratePhysicalDevices(p->instance, &count, NULL));
    REQUIRE(count > 0 && count <= 16, "physical device count");
    VkPhysicalDevice devices[16];
    VK(vkEnumeratePhysicalDevices(p->instance, &count, devices));
    struct stat node_stat;
    REQUIRE(stat(node, &node_stat) == 0 && S_ISCHR(node_stat.st_mode), "render node stat");
    for (uint32_t i = 0; i < count; i++) {
        VkPhysicalDeviceDrmPropertiesEXT drm = {.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_DRM_PROPERTIES_EXT};
        VkPhysicalDeviceProperties2 properties = {.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PROPERTIES_2,
                                                  .pNext = &drm};
        vkGetPhysicalDeviceProperties2(devices[i], &properties);
        if (drm.hasRender && drm.renderMajor == major(node_stat.st_rdev) &&
            drm.renderMinor == minor(node_stat.st_rdev)) {
            p->physical = devices[i];
            memcpy(p->name, properties.properties.deviceName, sizeof(p->name));
            p->vendor_id = properties.properties.vendorID;
            p->device_id = properties.properties.deviceID;
            break;
        }
    }
    REQUIRE(p->physical != VK_NULL_HANDLE, "Vulkan render-node match");
    count = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(p->physical, &count, NULL);
    REQUIRE(count > 0 && count <= 32, "queue family count");
    VkQueueFamilyProperties families[32];
    vkGetPhysicalDeviceQueueFamilyProperties(p->physical, &count, families);
    p->family = UINT32_MAX;
    for (uint32_t i = 0; i < count; i++) {
        if (families[i].queueCount > 0 && (families[i].queueFlags & VK_QUEUE_COMPUTE_BIT)) {
            p->family = i;
            break;
        }
    }
    REQUIRE(p->family != UINT32_MAX, "compute queue");
    const char *extensions[] = {VK_KHR_EXTERNAL_MEMORY_FD_EXTENSION_NAME, VK_EXT_EXTERNAL_MEMORY_DMA_BUF_EXTENSION_NAME,
                                VK_EXT_IMAGE_DRM_FORMAT_MODIFIER_EXTENSION_NAME,
                                VK_KHR_EXTERNAL_SEMAPHORE_FD_EXTENSION_NAME,
                                VK_EXT_QUEUE_FAMILY_FOREIGN_EXTENSION_NAME};
    float priority = 1;
    VkDeviceQueueCreateInfo queue = {.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO,
                                     .queueFamilyIndex = p->family,
                                     .queueCount = 1,
                                     .pQueuePriorities = &priority};
    VkDeviceCreateInfo device = {.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO,
                                 .queueCreateInfoCount = 1,
                                 .pQueueCreateInfos = &queue,
                                 .enabledExtensionCount = sizeof(extensions) / sizeof(*extensions),
                                 .ppEnabledExtensionNames = extensions};
    VK(vkCreateDevice(p->physical, &device, NULL, &p->device));
    vkGetDeviceQueue(p->device, p->family, 0, &p->queue);
    p->get_memory_fd = (PFN_vkGetMemoryFdKHR)vkGetDeviceProcAddr(p->device, "vkGetMemoryFdKHR");
    p->get_semaphore_fd = (PFN_vkGetSemaphoreFdKHR)vkGetDeviceProcAddr(p->device, "vkGetSemaphoreFdKHR");
    p->import_semaphore_fd = (PFN_vkImportSemaphoreFdKHR)vkGetDeviceProcAddr(p->device, "vkImportSemaphoreFdKHR");
    REQUIRE(p->get_memory_fd && p->get_semaphore_fd && p->import_semaphore_fd, "Vulkan external fd entrypoints");
}

static void check_external_format(struct producer *p) {
    VkPhysicalDeviceImageDrmFormatModifierInfoEXT modifier = {
        .sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_IMAGE_DRM_FORMAT_MODIFIER_INFO_EXT,
        .drmFormatModifier = DRM_FORMAT_MOD_LINEAR,
        .sharingMode = VK_SHARING_MODE_EXCLUSIVE};
    VkPhysicalDeviceExternalImageFormatInfo external = {
        .sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_EXTERNAL_IMAGE_FORMAT_INFO,
        .pNext = &modifier,
        .handleType = VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT};
    VkPhysicalDeviceImageFormatInfo2 format = {.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_IMAGE_FORMAT_INFO_2,
                                               .pNext = &external,
                                               .format = VK_FORMAT_R8G8B8A8_UNORM,
                                               .type = VK_IMAGE_TYPE_2D,
                                               .tiling = VK_IMAGE_TILING_DRM_FORMAT_MODIFIER_EXT,
                                               .usage = VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_SAMPLED_BIT};
    VkExternalImageFormatProperties properties = {.sType = VK_STRUCTURE_TYPE_EXTERNAL_IMAGE_FORMAT_PROPERTIES};
    VkImageFormatProperties2 output = {.sType = VK_STRUCTURE_TYPE_IMAGE_FORMAT_PROPERTIES_2, .pNext = &properties};
    VK(vkGetPhysicalDeviceImageFormatProperties2(p->physical, &format, &output));
    REQUIRE(properties.externalMemoryProperties.externalMemoryFeatures & VK_EXTERNAL_MEMORY_FEATURE_EXPORTABLE_BIT,
            "linear RGBA8 DMA-BUF exportable");
    REQUIRE(width <= output.imageFormatProperties.maxExtent.width &&
                height <= output.imageFormatProperties.maxExtent.height,
            "external image dimensions");
    VkPhysicalDeviceExternalSemaphoreInfo semaphore = {.sType =
                                                           VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_EXTERNAL_SEMAPHORE_INFO,
                                                       .handleType = VK_EXTERNAL_SEMAPHORE_HANDLE_TYPE_SYNC_FD_BIT};
    VkExternalSemaphoreProperties semaphore_properties = {.sType = VK_STRUCTURE_TYPE_EXTERNAL_SEMAPHORE_PROPERTIES};
    vkGetPhysicalDeviceExternalSemaphoreProperties(p->physical, &semaphore, &semaphore_properties);
    VkExternalSemaphoreFeatureFlags required =
        VK_EXTERNAL_SEMAPHORE_FEATURE_EXPORTABLE_BIT | VK_EXTERNAL_SEMAPHORE_FEATURE_IMPORTABLE_BIT;
    REQUIRE((semaphore_properties.externalSemaphoreFeatures & required) == required, "sync_file import/export");
}

static void create_pipeline(struct producer *p) {
    VkCommandPoolCreateInfo pool = {.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO,
                                    .flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT,
                                    .queueFamilyIndex = p->family};
    VK(vkCreateCommandPool(p->device, &pool, NULL, &p->command_pool));
    VkDescriptorSetLayoutBinding binding = {.binding = 0,
                                            .descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_IMAGE,
                                            .descriptorCount = 1,
                                            .stageFlags = VK_SHADER_STAGE_COMPUTE_BIT};
    VkDescriptorSetLayoutCreateInfo layout = {
        .sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO, .bindingCount = 1, .pBindings = &binding};
    VK(vkCreateDescriptorSetLayout(p->device, &layout, NULL, &p->descriptor_layout));
    VkPushConstantRange push = {.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT, .size = sizeof(uint32_t)};
    VkPipelineLayoutCreateInfo pipeline_layout = {.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO,
                                                  .setLayoutCount = 1,
                                                  .pSetLayouts = &p->descriptor_layout,
                                                  .pushConstantRangeCount = 1,
                                                  .pPushConstantRanges = &push};
    VK(vkCreatePipelineLayout(p->device, &pipeline_layout, NULL, &p->pipeline_layout));
    VkShaderModuleCreateInfo shader_info = {
        .sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO, .codeSize = sizeof(producer_spv), .pCode = producer_spv};
    VkShaderModule shader;
    VK(vkCreateShaderModule(p->device, &shader_info, NULL, &shader));
    VkComputePipelineCreateInfo pipeline = {.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO,
                                            .stage = {.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO,
                                                      .stage = VK_SHADER_STAGE_COMPUTE_BIT,
                                                      .module = shader,
                                                      .pName = "main"},
                                            .layout = p->pipeline_layout};
    VkResult result = vkCreateComputePipelines(p->device, VK_NULL_HANDLE, 1, &pipeline, NULL, &p->pipeline);
    vkDestroyShaderModule(p->device, shader, NULL);
    if (result != VK_SUCCESS)
        fail("vkCreateComputePipelines", result);
    VkDescriptorPoolSize size = {.type = VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, .descriptorCount = SLOT_COUNT};
    VkDescriptorPoolCreateInfo descriptor_pool = {.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO,
                                                  .maxSets = SLOT_COUNT,
                                                  .poolSizeCount = 1,
                                                  .pPoolSizes = &size};
    VK(vkCreateDescriptorPool(p->device, &descriptor_pool, NULL, &p->descriptor_pool));
}

static void create_image(struct producer *p, struct vk_slot *slot, uint32_t index) {
    uint64_t linear = DRM_FORMAT_MOD_LINEAR;
    VkImageDrmFormatModifierListCreateInfoEXT modifier = {
        .sType = VK_STRUCTURE_TYPE_IMAGE_DRM_FORMAT_MODIFIER_LIST_CREATE_INFO_EXT,
        .drmFormatModifierCount = 1,
        .pDrmFormatModifiers = &linear};
    VkExternalMemoryImageCreateInfo external = {.sType = VK_STRUCTURE_TYPE_EXTERNAL_MEMORY_IMAGE_CREATE_INFO,
                                                .pNext = &modifier,
                                                .handleTypes = VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT};
    VkImageCreateInfo image = {.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO,
                               .pNext = &external,
                               .imageType = VK_IMAGE_TYPE_2D,
                               .format = VK_FORMAT_R8G8B8A8_UNORM,
                               .extent = {width, height, 1},
                               .mipLevels = 1,
                               .arrayLayers = 1,
                               .samples = VK_SAMPLE_COUNT_1_BIT,
                               .tiling = VK_IMAGE_TILING_DRM_FORMAT_MODIFIER_EXT,
                               .usage = VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_SAMPLED_BIT,
                               .sharingMode = VK_SHARING_MODE_EXCLUSIVE,
                               .initialLayout = VK_IMAGE_LAYOUT_UNDEFINED};
    VK(vkCreateImage(p->device, &image, NULL, &slot->image));
    VkMemoryRequirements requirements;
    vkGetImageMemoryRequirements(p->device, slot->image, &requirements);
    VkPhysicalDeviceMemoryProperties memory;
    vkGetPhysicalDeviceMemoryProperties(p->physical, &memory);
    uint32_t type = UINT32_MAX;
    for (uint32_t i = 0; i < memory.memoryTypeCount; i++) {
        if ((requirements.memoryTypeBits & (1u << i)) &&
            (memory.memoryTypes[i].propertyFlags & VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT)) {
            type = i;
            break;
        }
    }
    REQUIRE(type != UINT32_MAX, "device-local image memory");
    VkMemoryDedicatedAllocateInfo dedicated = {.sType = VK_STRUCTURE_TYPE_MEMORY_DEDICATED_ALLOCATE_INFO,
                                               .image = slot->image};
    VkExportMemoryAllocateInfo export = {.sType = VK_STRUCTURE_TYPE_EXPORT_MEMORY_ALLOCATE_INFO,
                                         .pNext = &dedicated,
                                         .handleTypes = VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT};
    VkMemoryAllocateInfo allocation = {.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,
                                       .pNext = &export,
                                       .allocationSize = requirements.size,
                                       .memoryTypeIndex = type};
    VK(vkAllocateMemory(p->device, &allocation, NULL, &slot->memory));
    VK(vkBindImageMemory(p->device, slot->image, slot->memory, 0));
    VkImageViewCreateInfo view = {.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO,
                                  .image = slot->image,
                                  .viewType = VK_IMAGE_VIEW_TYPE_2D,
                                  .format = VK_FORMAT_R8G8B8A8_UNORM,
                                  .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}};
    VK(vkCreateImageView(p->device, &view, NULL, &slot->view));
    VkImageSubresource plane = {.aspectMask = VK_IMAGE_ASPECT_MEMORY_PLANE_0_BIT_EXT};
    VkSubresourceLayout plane_layout;
    vkGetImageSubresourceLayout(p->device, slot->image, &plane, &plane_layout);
    REQUIRE(plane_layout.rowPitch >= width * 4 && plane_layout.rowPitch <= INT32_MAX &&
                plane_layout.offset <= INT32_MAX,
            "plane layout bounds");
    VkImageDrmFormatModifierPropertiesEXT actual = {.sType =
                                                        VK_STRUCTURE_TYPE_IMAGE_DRM_FORMAT_MODIFIER_PROPERTIES_EXT};
    PFN_vkGetImageDrmFormatModifierPropertiesEXT get_modifier =
        (PFN_vkGetImageDrmFormatModifierPropertiesEXT)vkGetDeviceProcAddr(p->device,
                                                                          "vkGetImageDrmFormatModifierPropertiesEXT");
    REQUIRE(get_modifier != NULL, "get DRM modifier entrypoint");
    VK(get_modifier(p->device, slot->image, &actual));
    REQUIRE(actual.drmFormatModifier == linear, "actual linear modifier");
    slot->registration = (struct packet){.kind = REGISTER,
                                         .slot = index,
                                         .width = width,
                                         .height = height,
                                         .fourcc = DRM_FORMAT_ABGR8888,
                                         .stride = (uint32_t)plane_layout.rowPitch,
                                         .offset = (uint32_t)plane_layout.offset,
                                         .modifier = actual.drmFormatModifier};
}

static void register_slot(struct producer *p, uint32_t index) {
    struct vk_slot *slot = &p->slots[index];
    create_image(p, slot, index);
    VkDescriptorSetAllocateInfo allocation = {.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO,
                                              .descriptorPool = p->descriptor_pool,
                                              .descriptorSetCount = 1,
                                              .pSetLayouts = &p->descriptor_layout};
    VK(vkAllocateDescriptorSets(p->device, &allocation, &slot->descriptors));
    VkDescriptorImageInfo image = {.imageView = slot->view, .imageLayout = VK_IMAGE_LAYOUT_GENERAL};
    VkWriteDescriptorSet write = {.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET,
                                  .dstSet = slot->descriptors,
                                  .dstBinding = 0,
                                  .descriptorCount = 1,
                                  .descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_IMAGE,
                                  .pImageInfo = &image};
    vkUpdateDescriptorSets(p->device, 1, &write, 0, NULL);
    VkCommandBufferAllocateInfo commands = {.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO,
                                            .commandPool = p->command_pool,
                                            .level = VK_COMMAND_BUFFER_LEVEL_PRIMARY,
                                            .commandBufferCount = 1};
    VK(vkAllocateCommandBuffers(p->device, &commands, &slot->commands));
    VkExportSemaphoreCreateInfo export = {.sType = VK_STRUCTURE_TYPE_EXPORT_SEMAPHORE_CREATE_INFO,
                                          .handleTypes = VK_EXTERNAL_SEMAPHORE_HANDLE_TYPE_SYNC_FD_BIT};
    VkSemaphoreCreateInfo semaphore = {.sType = VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO, .pNext = &export};
    VK(vkCreateSemaphore(p->device, &semaphore, NULL, &slot->ready));
    semaphore.pNext = NULL;
    VK(vkCreateSemaphore(p->device, &semaphore, NULL, &slot->released));
    VkFenceCreateInfo fence = {.sType = VK_STRUCTURE_TYPE_FENCE_CREATE_INFO};
    VK(vkCreateFence(p->device, &fence, NULL, &slot->submitted));
    VkMemoryGetFdInfoKHR fd_info = {.sType = VK_STRUCTURE_TYPE_MEMORY_GET_FD_INFO_KHR,
                                    .memory = slot->memory,
                                    .handleType = VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT};
    int fd = -1;
    VK(p->get_memory_fd(p->device, &fd_info, &fd));
    REQUIRE(fd >= 0, "export DMA-BUF fd");
    send_packet(slot->registration, fd);
    REQUIRE(close(fd) == 0, "close exported DMA-BUF");
    struct packet ack = receive_packet(REGISTER, false, NULL);
    REQUIRE(ack.slot == index, "register acknowledgement");
}

static void produce_frame(struct producer *p, uint32_t sequence) {
    uint32_t index = sequence % SLOT_COUNT;
    struct vk_slot *slot = &p->slots[index];
    if (slot->used) {
        /* This wait protects command-buffer reuse, not cross-API image acquisition. */
        VK(vkWaitForFences(p->device, 1, &slot->submitted, VK_TRUE, wait_ns));
        VK(vkResetFences(p->device, 1, &slot->submitted));
        VK(vkResetCommandBuffer(slot->commands, 0));
    }
    VkCommandBufferBeginInfo begin = {.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO,
                                      .flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT};
    VK(vkBeginCommandBuffer(slot->commands, &begin));
    VkImageMemoryBarrier acquire = {.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,
                                    .dstAccessMask = slot->used ? 0 : VK_ACCESS_SHADER_WRITE_BIT,
                                    .oldLayout = slot->used ? slot->released_old_layout : VK_IMAGE_LAYOUT_UNDEFINED,
                                    .newLayout = slot->used ? slot->released_new_layout : VK_IMAGE_LAYOUT_GENERAL,
                                    .srcQueueFamilyIndex = slot->used ? p->external_family : VK_QUEUE_FAMILY_IGNORED,
                                    .dstQueueFamilyIndex = slot->used ? p->family : VK_QUEUE_FAMILY_IGNORED,
                                    .image = slot->image,
                                    .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}};
    vkCmdPipelineBarrier(slot->commands, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT, 0, 0,
                         NULL, 0, NULL, 1, &acquire);
    if (slot->used) {
        /* Match the external release pair before transitioning for our own writes. */
        VkImageMemoryBarrier writable = {.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,
                                         .dstAccessMask = VK_ACCESS_SHADER_WRITE_BIT,
                                         .oldLayout = slot->released_new_layout,
                                         .newLayout = VK_IMAGE_LAYOUT_GENERAL,
                                         .srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
                                         .dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
                                         .image = slot->image,
                                         .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}};
        vkCmdPipelineBarrier(slot->commands, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                             0, 0, NULL, 0, NULL, 1, &writable);
    }
    vkCmdBindPipeline(slot->commands, VK_PIPELINE_BIND_POINT_COMPUTE, p->pipeline);
    vkCmdBindDescriptorSets(slot->commands, VK_PIPELINE_BIND_POINT_COMPUTE, p->pipeline_layout, 0, 1,
                            &slot->descriptors, 0, NULL);
    uint32_t pattern = sequence;
    if (getenv("GPU_SHARING_BAD_PATTERN") && sequence == 3)
        pattern--;
    vkCmdPushConstants(slot->commands, p->pipeline_layout, VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(pattern), &pattern);
    vkCmdDispatch(slot->commands, (width + 7) / 8, (height + 7) / 8, 1);
    VkImageMemoryBarrier release = {.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,
                                    .srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT,
                                    .oldLayout = VK_IMAGE_LAYOUT_GENERAL,
                                    .newLayout = VK_IMAGE_LAYOUT_GENERAL,
                                    .srcQueueFamilyIndex = p->family,
                                    .dstQueueFamilyIndex = p->external_family,
                                    .image = slot->image,
                                    .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}};
    vkCmdPipelineBarrier(slot->commands, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT, 0,
                         0, NULL, 0, NULL, 1, &release);
    VK(vkEndCommandBuffer(slot->commands));
    VkPipelineStageFlags stage = VK_PIPELINE_STAGE_ALL_COMMANDS_BIT;
    VkSubmitInfo submit = {.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO,
                           .waitSemaphoreCount = slot->used ? 1 : 0,
                           .pWaitSemaphores = &slot->released,
                           .pWaitDstStageMask = &stage,
                           .commandBufferCount = 1,
                           .pCommandBuffers = &slot->commands,
                           .signalSemaphoreCount = 1,
                           .pSignalSemaphores = &slot->ready};
    VK(vkQueueSubmit(p->queue, 1, &submit, slot->submitted));
    VkSemaphoreGetFdInfoKHR fd_info = {.sType = VK_STRUCTURE_TYPE_SEMAPHORE_GET_FD_INFO_KHR,
                                       .semaphore = slot->ready,
                                       .handleType = VK_EXTERNAL_SEMAPHORE_HANDLE_TYPE_SYNC_FD_BIT};
    int ready_fd = -1;
    VK(p->get_semaphore_fd(p->device, &fd_info, &ready_fd));
    REQUIRE(ready_fd >= 0, "export acquire sync_file");
    send_packet((struct packet){.kind = FRAME,
                                .slot = index,
                                .sequence = sequence,
                                .old_layout = VK_IMAGE_LAYOUT_GENERAL,
                                .new_layout = VK_IMAGE_LAYOUT_GENERAL},
                ready_fd);
    REQUIRE(close(ready_fd) == 0, "close acquire sync_file");
    int released_fd = -1;
    struct packet ack = receive_packet(RELEASE, true, &released_fd);
    REQUIRE(ack.slot == index && ack.sequence == sequence, "release slot/sequence");
    REQUIRE(
        (ack.new_layout == VK_IMAGE_LAYOUT_GENERAL || ack.new_layout == VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL) &&
            (ack.old_layout == VK_IMAGE_LAYOUT_GENERAL || ack.old_layout == VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL),
        "release Vulkan layouts");
    slot->released_old_layout = ack.old_layout;
    slot->released_new_layout = ack.new_layout;
    VkImportSemaphoreFdInfoKHR import = {.sType = VK_STRUCTURE_TYPE_IMPORT_SEMAPHORE_FD_INFO_KHR,
                                         .semaphore = slot->released,
                                         .flags = VK_SEMAPHORE_IMPORT_TEMPORARY_BIT,
                                         .handleType = VK_EXTERNAL_SEMAPHORE_HANDLE_TYPE_SYNC_FD_BIT,
                                         .fd = released_fd};
    VK(p->import_semaphore_fd(p->device, &import));
    slot->used = true;
}

static void destroy_producer(struct producer *p) {
    VkSemaphore releases[SLOT_COUNT] = {p->slots[0].released, p->slots[1].released};
    VkPipelineStageFlags stages[SLOT_COUNT] = {VK_PIPELINE_STAGE_ALL_COMMANDS_BIT, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT};
    VK(vkWaitForFences(p->device, 1, &p->slots[0].submitted, VK_TRUE, wait_ns));
    VK(vkResetFences(p->device, 1, &p->slots[0].submitted));
    VkSubmitInfo drain = {.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO,
                          .waitSemaphoreCount = SLOT_COUNT,
                          .pWaitSemaphores = releases,
                          .pWaitDstStageMask = stages};
    VK(vkQueueSubmit(p->queue, 1, &drain, p->slots[0].submitted));
    for (uint32_t i = 0; i < SLOT_COUNT; i++) {
        struct vk_slot *slot = &p->slots[i];
        VK(vkWaitForFences(p->device, 1, &slot->submitted, VK_TRUE, wait_ns));
        vkDestroyFence(p->device, slot->submitted, NULL);
        vkDestroySemaphore(p->device, slot->ready, NULL);
        vkDestroySemaphore(p->device, slot->released, NULL);
        vkDestroyImageView(p->device, slot->view, NULL);
        vkDestroyImage(p->device, slot->image, NULL);
        vkFreeMemory(p->device, slot->memory, NULL);
    }
    vkDestroyPipeline(p->device, p->pipeline, NULL);
    vkDestroyPipelineLayout(p->device, p->pipeline_layout, NULL);
    vkDestroyDescriptorPool(p->device, p->descriptor_pool, NULL);
    vkDestroyDescriptorSetLayout(p->device, p->descriptor_layout, NULL);
    vkDestroyCommandPool(p->device, p->command_pool, NULL);
    vkDestroyDevice(p->device, NULL);
    vkDestroyInstance(p->instance, NULL);
}

struct consumer {
    int node_fd;
    struct gbm_device *gbm;
    EGLDisplay display;
    EGLContext context;
    EGLImageKHR images[SLOT_COUNT];
    GLuint textures[SLOT_COUNT], output, framebuffer, program, vao;
    uint8_t *pixels;
    PFNEGLCREATEIMAGEKHRPROC create_image;
    PFNEGLDESTROYIMAGEKHRPROC destroy_image;
    PFNGLEGLIMAGETARGETTEXTURE2DOESPROC image_target;
    PFNEGLCREATESYNCKHRPROC create_sync;
    PFNEGLDESTROYSYNCKHRPROC destroy_sync;
    PFNEGLWAITSYNCKHRPROC wait_sync;
    PFNEGLDUPNATIVEFENCEFDANDROIDPROC dup_fence;
};

static bool has_extension(const char *extensions, const char *name) {
    if (!extensions)
        return false;
    size_t length = strlen(name);
    const char *match = extensions;
    while ((match = strstr(match, name))) {
        if ((match == extensions || match[-1] == ' ') && (match[length] == 0 || match[length] == ' '))
            return true;
        match += length;
    }
    return false;
}

static GLuint compile_shader(GLenum stage, const char *source) {
    GLuint shader = glCreateShader(stage);
    REQUIRE(shader != 0, "glCreateShader");
    glShaderSource(shader, 1, &source, NULL);
    glCompileShader(shader);
    GLint success = 0;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &success);
    if (!success) {
        char log[2048] = {0};
        glGetShaderInfoLog(shader, sizeof(log), NULL, log);
        fprintf(stderr, "%s\n", log);
        fail("GL shader compile", success);
    }
    return shader;
}

static void init_consumer(struct consumer *c, const char *node) {
    c->node_fd = open(node, O_RDWR | O_CLOEXEC);
    REQUIRE(c->node_fd >= 0, "open EGL render node");
    c->gbm = gbm_create_device(c->node_fd);
    REQUIRE(c->gbm != NULL, "gbm_create_device");
    c->display = eglGetPlatformDisplay(EGL_PLATFORM_GBM_KHR, c->gbm, NULL);
    EGL_CHECK(c->display != EGL_NO_DISPLAY);
    EGL_CHECK(eglInitialize(c->display, NULL, NULL));
    const char *extensions = eglQueryString(c->display, EGL_EXTENSIONS);
    const char *required[] = {"EGL_EXT_image_dma_buf_import_modifiers", "EGL_ANDROID_native_fence_sync",
                              "EGL_KHR_wait_sync", "EGL_KHR_surfaceless_context", "EGL_KHR_no_config_context"};
    for (uint32_t i = 0; i < sizeof(required) / sizeof(*required); i++) {
        REQUIRE(has_extension(extensions, required[i]), required[i]);
    }
    EGL_CHECK(eglBindAPI(EGL_OPENGL_ES_API));
    EGLint attributes[] = {EGL_CONTEXT_CLIENT_VERSION, 3, EGL_NONE};
    c->context = eglCreateContext(c->display, EGL_NO_CONFIG_KHR, EGL_NO_CONTEXT, attributes);
    EGL_CHECK(c->context != EGL_NO_CONTEXT);
    EGL_CHECK(eglMakeCurrent(c->display, EGL_NO_SURFACE, EGL_NO_SURFACE, c->context));
#define LOAD(member, type, name)                                                                                       \
    do {                                                                                                               \
        c->member = (type)eglGetProcAddress(name);                                                                     \
        REQUIRE(c->member != NULL, name);                                                                              \
    } while (0)
    LOAD(create_image, PFNEGLCREATEIMAGEKHRPROC, "eglCreateImageKHR");
    LOAD(destroy_image, PFNEGLDESTROYIMAGEKHRPROC, "eglDestroyImageKHR");
    LOAD(image_target, PFNGLEGLIMAGETARGETTEXTURE2DOESPROC, "glEGLImageTargetTexture2DOES");
    LOAD(create_sync, PFNEGLCREATESYNCKHRPROC, "eglCreateSyncKHR");
    LOAD(destroy_sync, PFNEGLDESTROYSYNCKHRPROC, "eglDestroySyncKHR");
    LOAD(wait_sync, PFNEGLWAITSYNCKHRPROC, "eglWaitSyncKHR");
    LOAD(dup_fence, PFNEGLDUPNATIVEFENCEFDANDROIDPROC, "eglDupNativeFenceFDANDROID");
#undef LOAD
    PFNEGLQUERYDMABUFMODIFIERSEXTPROC query =
        (PFNEGLQUERYDMABUFMODIFIERSEXTPROC)eglGetProcAddress("eglQueryDmaBufModifiersEXT");
    REQUIRE(query != NULL, "eglQueryDmaBufModifiersEXT");
    EGLint count = 0;
    EGL_CHECK(query(c->display, DRM_FORMAT_ABGR8888, 0, NULL, NULL, &count));
    REQUIRE(count > 0 && count <= 256, "EGL modifier count");
    EGLuint64KHR modifiers[256];
    EGLBoolean external_only[256];
    EGL_CHECK(query(c->display, DRM_FORMAT_ABGR8888, count, modifiers, external_only, &count));
    bool supported = false;
    for (EGLint i = 0; i < count; i++) {
        if (modifiers[i] == DRM_FORMAT_MOD_LINEAR && !external_only[i])
            supported = true;
    }
    REQUIRE(supported, "EGL ABGR8888 linear sampler2D support");
    send_packet((struct packet){.kind = HELLO,
                                .fourcc = DRM_FORMAT_ABGR8888,
                                .modifier = DRM_FORMAT_MOD_LINEAR,
                                .external_family = VK_QUEUE_FAMILY_FOREIGN_EXT},
                -1);
}

static void init_sampling(struct consumer *c) {
    const char *vertex = "#version 300 es\nvoid main(){vec2 "
                         "p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}";
    const char *fragment = "#version 300 es\nprecision highp float;uniform highp sampler2D source_image;out vec4 "
                           "color;void main(){color=texelFetch(source_image,ivec2(gl_FragCoord.xy),0);}";
    GLuint vertex_shader = compile_shader(GL_VERTEX_SHADER, vertex);
    GLuint fragment_shader = compile_shader(GL_FRAGMENT_SHADER, fragment);
    c->program = glCreateProgram();
    glAttachShader(c->program, vertex_shader);
    glAttachShader(c->program, fragment_shader);
    glLinkProgram(c->program);
    GLint linked = 0;
    glGetProgramiv(c->program, GL_LINK_STATUS, &linked);
    REQUIRE(linked, "GL program link");
    glDeleteShader(vertex_shader);
    glDeleteShader(fragment_shader);
    glUseProgram(c->program);
    GLint sampler = glGetUniformLocation(c->program, "source_image");
    REQUIRE(sampler >= 0, "sampler uniform");
    glUniform1i(sampler, 0);
    glGenVertexArrays(1, &c->vao);
    glBindVertexArray(c->vao);
    glGenTextures(1, &c->output);
    glBindTexture(GL_TEXTURE_2D, c->output);
    glTexStorage2D(GL_TEXTURE_2D, 1, GL_RGBA8, width, height);
    glGenFramebuffers(1, &c->framebuffer);
    glBindFramebuffer(GL_FRAMEBUFFER, c->framebuffer);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, c->output, 0);
    REQUIRE(glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE, "validation framebuffer complete");
    glViewport(0, 0, width, height);
    glDisable(GL_DITHER);
    c->pixels = malloc((size_t)width * height * 4);
    REQUIRE(c->pixels != NULL, "validation pixel allocation");
    GL_CHECK();
}

static void import_slot(struct consumer *c, uint32_t index) {
    int fd = -1;
    struct packet packet = receive_packet(REGISTER, true, &fd);
    REQUIRE(packet.slot == index && packet.width == width && packet.height == height, "registered slot dimensions");
    REQUIRE(packet.fourcc == DRM_FORMAT_ABGR8888 && packet.modifier == DRM_FORMAT_MOD_LINEAR &&
                packet.stride >= width * 4 && packet.stride <= INT32_MAX && packet.offset <= INT32_MAX,
            "registered format/plane layout");
    EGLint attributes[] = {EGL_WIDTH,
                           width,
                           EGL_HEIGHT,
                           height,
                           EGL_LINUX_DRM_FOURCC_EXT,
                           (EGLint)packet.fourcc,
                           EGL_DMA_BUF_PLANE0_FD_EXT,
                           fd,
                           EGL_DMA_BUF_PLANE0_OFFSET_EXT,
                           (EGLint)packet.offset,
                           EGL_DMA_BUF_PLANE0_PITCH_EXT,
                           (EGLint)packet.stride,
                           EGL_DMA_BUF_PLANE0_MODIFIER_LO_EXT,
                           (EGLint)packet.modifier,
                           EGL_DMA_BUF_PLANE0_MODIFIER_HI_EXT,
                           (EGLint)(packet.modifier >> 32),
                           EGL_NONE};
    c->images[index] = c->create_image(c->display, EGL_NO_CONTEXT, EGL_LINUX_DMA_BUF_EXT, NULL, attributes);
    EGL_CHECK(c->images[index] != EGL_NO_IMAGE_KHR);
    REQUIRE(close(fd) == 0, "close imported DMA-BUF fd");
    glGenTextures(1, &c->textures[index]);
    glBindTexture(GL_TEXTURE_2D, c->textures[index]);
    c->image_target(GL_TEXTURE_2D, c->images[index]);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    GL_CHECK();
    send_packet((struct packet){.kind = REGISTER, .slot = index}, -1);
}

static void consume_frame(struct consumer *c, uint32_t sequence) {
    int ready_fd = -1;
    struct packet packet = receive_packet(FRAME, true, &ready_fd);
    REQUIRE(packet.slot == sequence % SLOT_COUNT && packet.sequence == sequence, "frame slot/sequence");
    EGLint acquire[] = {EGL_SYNC_NATIVE_FENCE_FD_ANDROID, ready_fd, EGL_NONE};
    EGLSyncKHR ready = c->create_sync(c->display, EGL_SYNC_NATIVE_FENCE_ANDROID, acquire);
    EGL_CHECK(ready != EGL_NO_SYNC_KHR);
    /* EGL owns the imported descriptor. This is a GPU wait, not eglClientWaitSync. */
    EGL_CHECK(c->wait_sync(c->display, ready, 0));
    EGL_CHECK(c->destroy_sync(c->display, ready));
    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, c->textures[packet.slot]);
    glDrawArrays(GL_TRIANGLES, 0, 3);
    GL_CHECK();
    EGLint release[] = {EGL_SYNC_NATIVE_FENCE_FD_ANDROID, EGL_NO_NATIVE_FENCE_FD_ANDROID, EGL_NONE};
    EGLSyncKHR released = c->create_sync(c->display, EGL_SYNC_NATIVE_FENCE_ANDROID, release);
    EGL_CHECK(released != EGL_NO_SYNC_KHR);
    glFlush();
    int released_fd = c->dup_fence(c->display, released);
    EGL_CHECK(released_fd >= 0);
    EGL_CHECK(c->destroy_sync(c->display, released));
    /* Only the validation target is read. Neither process maps the shared images. */
    glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, c->pixels);
    GL_CHECK();
    verify_pixels(c->pixels, sequence);
    send_packet((struct packet){.kind = RELEASE,
                                .slot = packet.slot,
                                .sequence = sequence,
                                .old_layout = VK_IMAGE_LAYOUT_GENERAL,
                                .new_layout = VK_IMAGE_LAYOUT_GENERAL},
                released_fd);
    REQUIRE(close(released_fd) == 0, "close release sync_file");
}

static void run_consumer(const char *node) {
    struct consumer c = {0};
    init_consumer(&c, node);
    init_sampling(&c);
    for (uint32_t i = 0; i < SLOT_COUNT; i++)
        import_slot(&c, i);
    for (uint32_t sequence = 0; sequence < FRAME_COUNT; sequence++)
        consume_frame(&c, sequence);
    receive_packet(STOP, false, NULL);
    glDeleteTextures(SLOT_COUNT, c.textures);
    for (uint32_t i = 0; i < SLOT_COUNT; i++)
        EGL_CHECK(c.destroy_image(c.display, c.images[i]));
    glDeleteFramebuffers(1, &c.framebuffer);
    glDeleteTextures(1, &c.output);
    glDeleteProgram(c.program);
    glDeleteVertexArrays(1, &c.vao);
    GL_CHECK();
    free(c.pixels);
    EGL_CHECK(eglMakeCurrent(c.display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT));
    EGL_CHECK(eglDestroyContext(c.display, c.context));
    EGL_CHECK(eglTerminate(c.display));
    gbm_device_destroy(c.gbm);
    REQUIRE(close(c.node_fd) == 0, "close EGL render node");
    send_packet((struct packet){.kind = STOP, .sequence = FRAME_COUNT}, -1);
}

static uint32_t dimension(const char *argument) {
    char *end = NULL;
    errno = 0;
    unsigned long value = strtoul(argument, &end, 10);
    REQUIRE(!errno && end != argument && *end == 0 && value > 0 && value <= DIMENSION_MAX, "dimension 1..2048");
    return (uint32_t)value;
}

static void json_string(const char *value) {
    putchar('"');
    for (const unsigned char *p = (const unsigned char *)value; *p; p++) {
        if (*p < 32) {
            printf("\\u%04x", *p);
        } else {
            if (*p == '"' || *p == '\\')
                putchar('\\');
            putchar(*p);
        }
    }
    putchar('"');
}

int main(int argc, char **argv) {
    REQUIRE(argc == 4 || argc == 5, "usage: native-sharing render-node width height [dawn-consumer.ts]");
    width = dimension(argv[2]);
    height = dimension(argv[3]);
    struct rlimit core = {0};
    REQUIRE(setrlimit(RLIMIT_CORE, &core) == 0, "disable core dumps");
    REQUIRE(atexit(cleanup_process) == 0, "atexit");
    alarm(25);
    int sockets[2];
    REQUIRE(socketpair(AF_UNIX, SOCK_SEQPACKET | SOCK_CLOEXEC, 0, sockets) == 0, "socketpair");
    pid_t parent = getpid();
    child_pid = fork();
    REQUIRE(child_pid >= 0, "fork");
    if (child_pid == 0) {
        is_producer = false;
        REQUIRE(prctl(PR_SET_PDEATHSIG, SIGKILL) == 0, "parent-death signal");
        REQUIRE(getppid() == parent, "parent alive");
        alarm(20);
        REQUIRE(close(sockets[0]) == 0, "close producer socket");
        connection = sockets[1];
        if (argc == 5) {
            char fd_argument[16];
            snprintf(fd_argument, sizeof(fd_argument), "%d", connection);
            REQUIRE(fcntl(connection, F_SETFD, 0) == 0, "inherit consumer socket across exec");
            execlp("bun", "bun", argv[4], fd_argument, argv[2], argv[3], NULL);
            fail("exec bun consumer", errno);
        }
        run_consumer(argv[1]);
        return EXIT_SUCCESS;
    }
    REQUIRE(close(sockets[1]) == 0, "close consumer socket");
    connection = sockets[0];
    struct packet hello = receive_packet(HELLO, false, NULL);
    REQUIRE(hello.fourcc == DRM_FORMAT_ABGR8888 && hello.modifier == DRM_FORMAT_MOD_LINEAR, "format agreement");
    struct producer p = {0};
    p.external_family = argc == 5 ? VK_QUEUE_FAMILY_EXTERNAL : VK_QUEUE_FAMILY_FOREIGN_EXT;
    REQUIRE(hello.external_family == p.external_family, "external queue family agreement");
    select_device(&p, argv[1]);
    if (argc == 5)
        REQUIRE(hello.vendor_id == p.vendor_id && hello.device_id == p.device_id, "Dawn adapter vendor/device match");
    check_external_format(&p);
    create_pipeline(&p);
    for (uint32_t i = 0; i < SLOT_COUNT; i++)
        register_slot(&p, i);
    for (uint32_t sequence = 0; sequence < FRAME_COUNT; sequence++)
        produce_frame(&p, sequence);
    send_packet((struct packet){.kind = STOP}, -1);
    struct packet stopped = receive_packet(STOP, false, NULL);
    REQUIRE(stopped.sequence == FRAME_COUNT, "verified frame count");
    int child_status = 0;
    REQUIRE(waitpid(child_pid, &child_status, 0) == child_pid, "waitpid");
    child_pid = -1;
    REQUIRE(WIFEXITED(child_status) && WEXITSTATUS(child_status) == 0, "consumer exit");
    destroy_producer(&p);
    printf("{\"status\":\"pass\",\"producer\":\"Vulkan compute\",\"consumer\":\"%s\",\"device\":",
           argc == 5 ? "bun-webgpu Dawn native textureLoad" : "EGL GLES3 sampler2D");
    json_string(p.name);
    printf(",\"render_node\":");
    json_string(argv[1]);
    printf(",\"width\":%u,\"height\":%u,\"slots\":%u,\"frames\":%u,"
           "\"pixels_verified\":%" PRIu64 ",\"fourcc\":\"ABGR8888\",\"vk_format\":\"R8G8B8A8_UNORM\","
           "\"modifier\":\"0x0000000000000000\",\"stride\":%u,\"image_fd_registrations\":2,\"fence_fd_transfers\":16,"
           "\"last_release_layouts\":[%u,%u],\"planes\":1,\"samples\":1,"
           "\"synchronization\":\"bidirectional GPU sync_file\",\"external_queue_family\":\"%s\","
           "\"scheduling\":\"serialized validation with two alternating slots\",\"shared_image_cpu_maps\":0,"
           "\"cpu_pixel_transport_bytes\":0,\"validation_readback_bytes\":%" PRIu64 ",\"three_integration\":false}\n",
           width, height, SLOT_COUNT, FRAME_COUNT, (uint64_t)width * height * FRAME_COUNT,
           p.slots[0].registration.stride, p.slots[0].released_old_layout, p.slots[0].released_new_layout,
           argc == 5 ? "EXTERNAL" : "FOREIGN", (uint64_t)width * height * FRAME_COUNT * 4);
    REQUIRE(fflush(stdout) == 0, "flush result");
    return EXIT_SUCCESS;
}
