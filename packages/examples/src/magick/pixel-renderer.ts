import { GPUCanvasContextMock, setupGlobals } from "bun-webgpu"
import { toArrayBuffer } from "bun:ffi"
import { NoToneMapping, SRGBColorSpace, type Camera, type Scene } from "three"
import { WebGPURenderer } from "three/webgpu"

export interface PixelFrame {
  data: Uint8Array
  width: number
  height: number
  stride: number
  format: "rgba8" | "bgra8"
}

export function packRgba(frame: PixelFrame, destination: Uint8Array): void {
  for (let y = 0; y < frame.height; y++) {
    if (frame.format === "rgba8") {
      destination.set(frame.data.subarray(y * frame.stride, y * frame.stride + frame.width * 4), y * frame.width * 4)
      continue
    }
    for (let x = 0; x < frame.width; x++) {
      const source = y * frame.stride + x * 4
      const target = (y * frame.width + x) * 4
      destination[target] = frame.data[source + 2]
      destination[target + 1] = frame.data[source + 1]
      destination[target + 2] = frame.data[source]
      destination[target + 3] = frame.data[source + 3]
    }
  }
}

export async function createPixelRenderer(width: number, height: number, mapping: "view" | "pointer" = "view") {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > 3840 * 2160
  ) {
    throw new RangeError("Framebuffer must be positive integers and at most 3840 * 2160 pixels")
  }
  globalThis.requestAnimationFrame ??= (callback) =>
    Number(setTimeout(() => callback(performance.now()), 1000 / 60).unref())
  globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id)
  await setupGlobals()
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" })
  if (!adapter) throw new Error("No WebGPU adapter")
  const device = await adapter.requestDevice()
  const canvas = { width, height, getContext: () => context, addEventListener() {}, removeEventListener() {} }
  const context = new GPUCanvasContextMock(canvas as unknown as HTMLCanvasElement, width, height)
  const renderer = new WebGPURenderer({
    canvas: canvas as unknown as HTMLCanvasElement,
    device,
    alpha: false,
    antialias: false,
  })
  const stride = Math.ceil((width * 4) / 256) * 256
  let readback: GPUBuffer
  try {
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = NoToneMapping
    renderer.setSize(width, height, false)
    await renderer.init()
    readback = device.createBuffer({ size: stride * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
  } catch (error) {
    renderer.dispose()
    context.unconfigure()
    device.destroy()
    throw error
  }
  let busy = false
  let destroyed = false
  return {
    adapter: adapter.info,
    async draw<T>(scene: Scene, camera: Camera, consume: (frame: PixelFrame) => T) {
      if (busy || destroyed) throw new Error("Pixel renderer is busy or disposed")
      busy = true
      const start = performance.now()
      try {
        renderer.render(scene, camera)
        const submitted = performance.now()
        const texture = context.getCurrentTexture()
        const encoder = device.createCommandEncoder()
        encoder.copyTextureToBuffer(
          { texture },
          { buffer: readback, bytesPerRow: stride, rowsPerImage: height },
          { width, height },
        )
        device.queue.submit([encoder.finish()])
        await readback.mapAsync(GPUMapMode.READ)
        const mapped = performance.now()
        let value: T
        try {
          // The consumer is synchronous: it cannot retain this view past unmap.
          const mappedBytes =
            mapping === "pointer"
              ? toArrayBuffer(readback.getMappedRangePtr(), 0, readback.size)
              : readback.getMappedRange()
          value = consume({
            data: new Uint8Array(mappedBytes),
            width,
            height,
            stride,
            format: texture.format === "bgra8unorm" ? "bgra8" : "rgba8",
          })
        } finally {
          readback.unmap()
        }
        return {
          submitMs: submitted - start,
          readbackMs: mapped - submitted,
          consumeMs: performance.now() - mapped,
          value,
        }
      } finally {
        busy = false
      }
    },
    dispose() {
      if (busy) throw new Error("Cannot dispose a pending readback")
      if (destroyed) return
      destroyed = true
      readback.destroy()
      renderer.dispose()
      context.unconfigure()
      renderer.onDeviceLost = () => {}
      device.destroy()
    },
  }
}
