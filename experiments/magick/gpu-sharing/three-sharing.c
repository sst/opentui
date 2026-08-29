#define GPU_SHARING_NO_MAIN
#include "native-sharing.c"
#include "three-protocol.h"
#include <time.h>

static uint64_t monotonic_ns(void) {
    struct timespec now;
    REQUIRE(clock_gettime(CLOCK_MONOTONIC, &now) == 0, "performance monotonic clock");
    return (uint64_t)now.tv_sec * UINT64_C(1000000000) + (uint64_t)now.tv_nsec;
}

/* This bridge transfers ownership between Dawn's EXTERNAL and EGL's FOREIGN queues.
   It records barriers only: no draw, dispatch, copy, or mapping of shared images. */
static int transfer_ownership(struct producer *p, struct vk_slot *slot, int input_fd, uint32_t source_family,
                              VkImageLayout old_layout, VkImageLayout new_layout, uint32_t target_family) {
    REQUIRE((input_fd >= 0) == (source_family != VK_QUEUE_FAMILY_IGNORED), "ownership input fence invariant");
    if (slot->used) {
        VK(vkWaitForFences(p->device, 1, &slot->submitted, VK_TRUE, wait_ns));
        VK(vkResetFences(p->device, 1, &slot->submitted));
        VK(vkResetCommandBuffer(slot->commands, 0));
    }
    if (input_fd >= 0) {
        VkImportSemaphoreFdInfoKHR import = {.sType = VK_STRUCTURE_TYPE_IMPORT_SEMAPHORE_FD_INFO_KHR,
                                             .semaphore = slot->released,
                                             .flags = VK_SEMAPHORE_IMPORT_TEMPORARY_BIT,
                                             .handleType = VK_EXTERNAL_SEMAPHORE_HANDLE_TYPE_SYNC_FD_BIT,
                                             .fd = input_fd};
        VK(p->import_semaphore_fd(p->device, &import));
    }
    VkCommandBufferBeginInfo begin = {.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO,
                                      .flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT};
    VK(vkBeginCommandBuffer(slot->commands, &begin));
    VkImageMemoryBarrier acquire = {.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,
                                    .dstAccessMask = VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT,
                                    .oldLayout = old_layout,
                                    .newLayout = new_layout,
                                    .srcQueueFamilyIndex = source_family,
                                    .dstQueueFamilyIndex =
                                        source_family == VK_QUEUE_FAMILY_IGNORED ? VK_QUEUE_FAMILY_IGNORED : p->family,
                                    .image = slot->image,
                                    .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}};
    vkCmdPipelineBarrier(slot->commands, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT, 0, 0,
                         NULL, 0, NULL, 1, &acquire);
    if (new_layout != VK_IMAGE_LAYOUT_GENERAL) {
        VkImageMemoryBarrier general = {.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,
                                        .srcAccessMask = VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT,
                                        .dstAccessMask = VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT,
                                        .oldLayout = new_layout,
                                        .newLayout = VK_IMAGE_LAYOUT_GENERAL,
                                        .srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
                                        .dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
                                        .image = slot->image,
                                        .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}};
        vkCmdPipelineBarrier(slot->commands, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT, 0,
                             0, NULL, 0, NULL, 1, &general);
    }
    VkImageMemoryBarrier release = {.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,
                                    .srcAccessMask = VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT,
                                    .oldLayout = VK_IMAGE_LAYOUT_GENERAL,
                                    .newLayout = VK_IMAGE_LAYOUT_GENERAL,
                                    .srcQueueFamilyIndex = p->family,
                                    .dstQueueFamilyIndex = target_family,
                                    .image = slot->image,
                                    .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}};
    vkCmdPipelineBarrier(slot->commands, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT, 0, 0,
                         NULL, 0, NULL, 1, &release);
    VK(vkEndCommandBuffer(slot->commands));
    VkPipelineStageFlags stage = VK_PIPELINE_STAGE_ALL_COMMANDS_BIT;
    VkSubmitInfo submit = {.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO,
                           .waitSemaphoreCount = input_fd >= 0 ? 1 : 0,
                           .pWaitSemaphores = &slot->released,
                           .pWaitDstStageMask = &stage,
                           .commandBufferCount = 1,
                           .pCommandBuffers = &slot->commands,
                           .signalSemaphoreCount = 1,
                           .pSignalSemaphores = &slot->ready};
    VK(vkQueueSubmit(p->queue, 1, &submit, slot->submitted));
    VkSemaphoreGetFdInfoKHR export = {.sType = VK_STRUCTURE_TYPE_SEMAPHORE_GET_FD_INFO_KHR,
                                      .semaphore = slot->ready,
                                      .handleType = VK_EXTERNAL_SEMAPHORE_HANDLE_TYPE_SYNC_FD_BIT};
    int output_fd = -1;
    VK(p->get_semaphore_fd(p->device, &export, &output_fd));
    REQUIRE(output_fd >= 0, "ownership bridge sync_file");
    slot->used = true;
    return output_fd;
}

static int sample_three_frame(struct consumer *c, uint32_t sequence, int acquire_fd, bool validate, bool calibration,
                              uint64_t expected_hash, uint64_t *actual_hash) {
    EGLint acquire[] = {EGL_SYNC_NATIVE_FENCE_FD_ANDROID, acquire_fd, EGL_NONE};
    EGLSyncKHR ready = c->create_sync(c->display, EGL_SYNC_NATIVE_FENCE_ANDROID, acquire);
    EGL_CHECK(ready != EGL_NO_SYNC_KHR);
    EGL_CHECK(c->wait_sync(c->display, ready, 0));
    EGL_CHECK(c->destroy_sync(c->display, ready));
    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, c->textures[sequence % SLOT_COUNT]);
    glDrawArrays(GL_TRIANGLES, 0, 3);
    GL_CHECK();
    EGLint release[] = {EGL_SYNC_NATIVE_FENCE_FD_ANDROID, EGL_NO_NATIVE_FENCE_FD_ANDROID, EGL_NONE};
    EGLSyncKHR released = c->create_sync(c->display, EGL_SYNC_NATIVE_FENCE_ANDROID, release);
    EGL_CHECK(released != EGL_NO_SYNC_KHR);
    glFlush();
    int release_fd = c->dup_fence(c->display, released);
    EGL_CHECK(release_fd >= 0);
    EGL_CHECK(c->destroy_sync(c->display, released));
    if (validate) {
        glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, c->pixels);
        GL_CHECK();
        *actual_hash = hash_rgba(c->pixels, width * 4);
        if (*actual_hash != expected_hash) {
            fprintf(stderr, "Three hash mismatch sequence=%u expected=%016" PRIx64 " sampled=%016" PRIx64 "\n",
                    sequence, expected_hash, *actual_hash);
            fail("Three arena digest mismatch", sequence);
        }
        if (calibration) {
            const uint8_t colors[4][4] = {{255, 0, 0, 255}, {0, 255, 0, 255}, {0, 0, 255, 255}, {255, 255, 255, 255}};
            for (size_t pixel = 0; pixel < (size_t)width * height; pixel++) {
                REQUIRE(memcmp(c->pixels + pixel * 4, colors[sequence % 4], 4) == 0, "Three exact calibration RGBA");
            }
        }
    } else {
        REQUIRE(c->pixels == NULL && expected_hash == 0, "no-readback consumer invariant");
    }
    return release_fd;
}

int main(int argc, char **argv) {
    const struct three_run run = three_run_options();
    if (argc == 2 && strcmp(argv[1], "--perf-options") == 0) {
        printf("{\"performance\":%s,\"measured_frames\":%u,\"warmup_frames\":%u,\"pace_us\":%u,"
               "\"total_frames\":%u,\"timeout_seconds\":%u}\n",
               run.performance ? "true" : "false", run.measured_frames, run.warmup_frames, run.pace_us,
               run.total_frames, run.timeout_seconds);
        REQUIRE(fflush(stdout) == 0, "flush performance options");
        return EXIT_SUCCESS;
    }
    REQUIRE(argc == 5 || argc == 6, "usage: three-sharing render-node width height producer.ts [--no-readback]");
    width = dimension(argv[2]);
    height = dimension(argv[3]);
    bool validate = argc == 5;
    if (!validate)
        REQUIRE(strcmp(argv[5], "--no-readback") == 0, "Three mode");
    bool calibration = getenv("GPU_SHARING_CALIBRATION") != NULL;
    if (run.performance) {
        REQUIRE(!validate && !calibration && !getenv("GPU_SHARING_THREE_STALE"),
                "performance mode requires the no-readback arena without fault injection");
        three_require_readback_guard();
    }
    struct rlimit core = {0};
    REQUIRE(setrlimit(RLIMIT_CORE, &core) == 0, "disable core dumps");
    REQUIRE(atexit(cleanup_process) == 0, "atexit");
    alarm(run.timeout_seconds);
    int sockets[2];
    REQUIRE(socketpair(AF_UNIX, SOCK_SEQPACKET | SOCK_CLOEXEC, 0, sockets) == 0, "socketpair");
    pid_t parent = getpid();
    child_pid = fork();
    REQUIRE(child_pid >= 0, "fork Three producer");
    if (child_pid == 0) {
        REQUIRE(prctl(PR_SET_PDEATHSIG, SIGKILL) == 0 && getppid() == parent, "Three producer parent-death guard");
        alarm(run.timeout_seconds - 5);
        REQUIRE(close(sockets[0]) == 0, "close consumer socket");
        connection = sockets[1];
        char fd_argument[16];
        snprintf(fd_argument, sizeof(fd_argument), "%d", connection);
        REQUIRE(fcntl(connection, F_SETFD, 0) == 0, "inherit Three producer socket");
        execlp("bun", "bun", argv[4], fd_argument, argv[2], argv[3],
               run.performance ? "performance"
               : validate      ? "validate"
                               : "no-readback",
               NULL);
        fail("exec Three producer", errno);
    }
    is_producer = false;
    REQUIRE(close(sockets[1]) == 0, "close Three producer socket");
    connection = sockets[0];
    struct consumer c = {0};
    init_consumer(&c, argv[1]);
    init_sampling(&c, validate);
    struct packet hello = receive_packet(HELLO, false, NULL);
    struct producer p = {.image_usage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_SAMPLED_BIT |
                                        VK_IMAGE_USAGE_TRANSFER_SRC_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT};
    select_device(&p, argv[1]);
    REQUIRE(hello.vendor_id == p.vendor_id && hello.device_id == p.device_id &&
                hello.external_family == VK_QUEUE_FAMILY_EXTERNAL,
            "Three Vulkan adapter agreement");
    check_external_format(&p);
    VkCommandPoolCreateInfo pool = {.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO,
                                    .flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT,
                                    .queueFamilyIndex = p.family};
    VK(vkCreateCommandPool(p.device, &pool, NULL, &p.command_pool));
    int available[SLOT_COUNT] = {-1, -1};
    for (uint32_t i = 0; i < SLOT_COUNT; i++) {
        struct vk_slot *slot = &p.slots[i];
        create_image(&p, slot, i);
        create_slot_sync(&p, slot);
        VkMemoryGetFdInfoKHR export = {.sType = VK_STRUCTURE_TYPE_MEMORY_GET_FD_INFO_KHR,
                                       .memory = slot->memory,
                                       .handleType = VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT};
        int fd = -1;
        VK(p.get_memory_fd(p.device, &export, &fd));
        REQUIRE(fd >= 0, "export Three DMA-BUF");
        send_packet(slot->registration, fd);
        import_egl_image(&c, i, slot->registration, fd);
        struct packet ack = receive_packet(REGISTER, false, NULL);
        REQUIRE(ack.slot == i, "Three registration acknowledgement");
        available[i] = transfer_ownership(&p, slot, -1, VK_QUEUE_FAMILY_IGNORED, VK_IMAGE_LAYOUT_UNDEFINED,
                                          VK_IMAGE_LAYOUT_GENERAL, VK_QUEUE_FAMILY_EXTERNAL);
    }
    uint64_t hashes[FRAME_COUNT] = {0};
    uint64_t *durations = run.performance ? calloc(run.measured_frames, sizeof(*durations)) : NULL;
    REQUIRE(!run.performance || durations, "bounded performance duration allocation");
    uint64_t previous_grant_ns = 0;
    for (uint32_t sequence = 0; sequence < run.total_frames; sequence++) {
        uint32_t index = sequence % SLOT_COUNT;
        if (run.performance && run.pace_us && sequence > 0) {
            uint64_t deadline_ns = previous_grant_ns + (uint64_t)run.pace_us * 1000;
            struct timespec deadline = {.tv_sec = (time_t)(deadline_ns / 1000000000),
                                        .tv_nsec = (long)(deadline_ns % 1000000000)};
            int error = clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &deadline, NULL);
            if (error)
                fail("performance pacing", error);
        }
        uint64_t grant_ns = run.performance ? monotonic_ns() : 0;
        previous_grant_ns = grant_ns;
        send_packet((struct packet){.kind = RELEASE,
                                    .slot = index,
                                    .sequence = sequence,
                                    .old_layout = VK_IMAGE_LAYOUT_GENERAL,
                                    .new_layout = VK_IMAGE_LAYOUT_GENERAL},
                    available[index]);
        REQUIRE(close(available[index]) == 0, "close sent Three acquire fence");
        int produced_fd = -1;
        struct packet frame = receive_packet(FRAME, true, &produced_fd);
        REQUIRE(frame.slot == index && frame.sequence == sequence, "Three produced frame sequence");
        REQUIRE(frame.old_layout == VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL && frame.new_layout == frame.old_layout,
                "Three RenderAttachment release layout");
        int ready_fd = transfer_ownership(&p, &p.slots[index], produced_fd, VK_QUEUE_FAMILY_EXTERNAL, frame.old_layout,
                                          frame.new_layout, VK_QUEUE_FAMILY_FOREIGN_EXT);
        int sampled_fd = sample_three_frame(&c, sequence, ready_fd, validate, calibration, frame.modifier,
                                            validate ? &hashes[sequence] : NULL);
        if (validate && sequence > 0)
            REQUIRE(hashes[sequence] != hashes[sequence - 1], "Three frames must change");
        available[index] =
            transfer_ownership(&p, &p.slots[index], sampled_fd, VK_QUEUE_FAMILY_FOREIGN_EXT, VK_IMAGE_LAYOUT_GENERAL,
                               VK_IMAGE_LAYOUT_GENERAL, VK_QUEUE_FAMILY_EXTERNAL);
        if (run.performance) {
            /* This submission waits for EGL sampling, then completes the return to EXTERNAL ownership. */
            VK(vkWaitForFences(p.device, 1, &p.slots[index].submitted, VK_TRUE, wait_ns));
            uint64_t completed_ns = monotonic_ns();
            REQUIRE(completed_ns >= grant_ns, "performance clock ordering");
            if (sequence >= run.warmup_frames)
                durations[sequence - run.warmup_frames] = completed_ns - grant_ns;
        }
    }
    for (uint32_t i = 0; i < SLOT_COUNT; i++) {
        VK(vkWaitForFences(p.device, 1, &p.slots[i].submitted, VK_TRUE, wait_ns));
        REQUIRE(close(available[i]) == 0, "close final Three acquire fence");
    }
    send_packet((struct packet){.kind = STOP}, -1);
    struct packet stop = receive_packet(STOP, false, NULL);
    REQUIRE(stop.sequence == run.total_frames && stop.width == (validate ? FRAME_COUNT : 0),
            "Three reference readback count");
    int status;
    REQUIRE(waitpid(child_pid, &status, 0) == child_pid, "wait Three producer");
    child_pid = -1;
    REQUIRE(WIFEXITED(status) && WEXITSTATUS(status) == 0, "Three producer exit");
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
    REQUIRE(close(c.node_fd) == 0, "close Three EGL node");
    for (uint32_t i = 0; i < SLOT_COUNT; i++) {
        struct vk_slot *slot = &p.slots[i];
        vkDestroyFence(p.device, slot->submitted, NULL);
        vkDestroySemaphore(p.device, slot->ready, NULL);
        vkDestroySemaphore(p.device, slot->released, NULL);
        vkDestroyImageView(p.device, slot->view, NULL);
        vkDestroyImage(p.device, slot->image, NULL);
        vkFreeMemory(p.device, slot->memory, NULL);
    }
    vkDestroyCommandPool(p.device, p.command_pool, NULL);
    VkPhysicalDeviceDriverProperties driver = {.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_DRIVER_PROPERTIES};
    VkPhysicalDeviceIDProperties identity = {.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_ID_PROPERTIES,
                                             .pNext = &driver};
    if (run.performance) {
        VkPhysicalDeviceProperties2 properties = {.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PROPERTIES_2,
                                                  .pNext = &identity};
        vkGetPhysicalDeviceProperties2(p.physical, &properties);
    }
    vkDestroyDevice(p.device, NULL);
    vkDestroyInstance(p.instance, NULL);
    printf("{\"status\":\"pass\",\"producer\":\"Three.js WebGPURenderer\",\"consumer\":\"EGL GLES3 "
           "texelFetch\",\"device\":");
    json_string(p.name);
    printf(",\"mode\":\"%s\","
           "\"width\":%u,\"height\":%u,\"slots\":2,\"frames\":%u,\"three_render_attachment\":true,\"calibration\":%s,"
           "\"cpu_pixel_transport_bytes\":0,\"shared_image_cpu_maps\":0,\"bridge_pixel_copy_commands\":0,"
           "\"producer_reference_readbacks\":%u,\"consumer_readbacks\":%u,\"stride\":%u,\"image_fd_registrations\":2,"
           "\"cross_process_fence_transfers\":%u,\"ownership_bridge_submissions\":%u,\"format\":\"RGBA8 LINEAR\","
           "\"scheduling\":\"serial two-slot handshake\",\"hash_algorithm\":\"FNV1a64 RGBA\",\"hashes\":[",
           run.performance ? "performance"
           : validate      ? "validation"
                           : "no-readback",
           width, height, run.total_frames, calibration ? "true" : "false", stop.width, validate ? FRAME_COUNT : 0,
           p.slots[0].registration.stride, run.total_frames * 2, SLOT_COUNT + run.total_frames * 2);
    if (validate) {
        for (uint32_t i = 0; i < FRAME_COUNT; i++)
            printf("%s\"%016" PRIx64 "\"", i ? "," : "", hashes[i]);
    }
    printf("]");
    if (run.performance) {
        uint64_t sum_ns = 0;
        printf(",\"performance\":{\"warmup_frames\":%u,\"measured_frames\":%u,\"pace_us\":%u,"
               "\"clock\":\"CLOCK_MONOTONIC\",\"completion\":\"return bridge fence after EGL sampling and EXTERNAL "
               "release\","
               "\"explicit_host_wait_timeout_ms\":%u,\"pacing_included\":false,\"frame_service_ns\":[",
               run.warmup_frames, run.measured_frames, run.pace_us, WAIT_MS);
        for (uint32_t i = 0; i < run.measured_frames; i++) {
            printf("%s%" PRIu64, i ? "," : "", durations[i]);
            sum_ns += durations[i];
        }
        printf("],\"mean_service_ns\":%.3f,\"vendor_id\":%u,\"device_id\":%u,\"device_uuid\":\"",
               (double)sum_ns / run.measured_frames, p.vendor_id, p.device_id);
        for (uint32_t i = 0; i < VK_UUID_SIZE; i++)
            printf("%02x", identity.deviceUUID[i]);
        printf("\",\"driver_uuid\":\"");
        for (uint32_t i = 0; i < VK_UUID_SIZE; i++)
            printf("%02x", identity.driverUUID[i]);
        printf("\",\"driver_info\":");
        json_string(driver.driverInfo);
        printf("}");
    }
    free(durations);
    printf("}\n");
    REQUIRE(fflush(stdout) == 0, "flush Three result");
    return EXIT_SUCCESS;
}
