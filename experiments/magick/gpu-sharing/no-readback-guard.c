#include <dawn/webgpu.h>
#include <GLES3/gl3.h>
#include <unistd.h>

uint32_t gpu_sharing_readback_guard(void) { return 1; }

/* LD_PRELOAD is scoped to test children. A forbidden call terminates the owning process. */
void glReadPixels(GLint x, GLint y, GLsizei width, GLsizei height, GLenum format, GLenum type, void *data) {
    (void)x;
    (void)y;
    (void)width;
    (void)height;
    (void)format;
    (void)type;
    (void)data;
    static const char message[] = "GPU_SHARING_READBACK_GUARD: glReadPixels\n";
    (void)write(STDERR_FILENO, message, sizeof(message) - 1);
    _exit(92);
}

WGPUFuture wgpuBufferMapAsync(WGPUBuffer buffer, WGPUMapMode mode, size_t offset, size_t size,
                              WGPUBufferMapCallbackInfo callback) {
    (void)buffer;
    (void)mode;
    (void)offset;
    (void)size;
    (void)callback;
    static const char message[] = "GPU_SHARING_READBACK_GUARD: wgpuBufferMapAsync\n";
    (void)write(STDERR_FILENO, message, sizeof(message) - 1);
    _exit(92);
}
