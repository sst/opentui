import { expect, test } from "bun:test"
import { managePixelGpu } from "./gpu-lifetime.js"

function fixture(failure?: "end" | "finish" | "finish-released" | "submit") {
  const native = { passes: 0, buffers: 0, encoders: 0, views: 0, submits: 0 }
  const texture = () =>
    ({
      createView() {
        let released = false
        return {
          destroy() {
            expect(released).toBe(false)
            released = true
            native.views++
          },
        }
      },
    }) as unknown as GPUTexture
  let current = texture()
  const context = { getCurrentTexture: () => current } as GPUCanvasContext
  const device = {
    createCommandEncoder() {
      return {
        _destroyed: false,
        beginRenderPass() {
          let released = false
          return {
            end() {
              expect(released).toBe(false)
              if (failure === "end") throw new Error("end failed")
            },
            destroy() {
              expect(released).toBe(false)
              released = true
              native.passes++
            },
          }
        },
        finish() {
          if (failure === "finish") throw new Error("finish failed")
          this._destroy()
          if (failure === "finish-released") throw new Error("finish-released failed")
          let released = false
          return {
            use() {
              expect(released).toBe(false)
            },
            _destroy() {
              expect(released).toBe(false)
              released = true
              native.buffers++
            },
          }
        },
        _destroy() {
          expect(this._destroyed).toBe(false)
          this._destroyed = true
          native.encoders++
        },
      }
    },
    queue: {
      submit(buffers: Iterable<GPUCommandBuffer & { use(): void }>) {
        for (const buffer of buffers) buffer.use()
        if (failure === "submit") throw new Error("submit failed")
        native.submits++
      },
    },
  } as unknown as GPUDevice
  return { device, context, native, texture, replaceTexture: () => (current = texture()) }
}

test("counts ownership without retaining frame histories", () => {
  const { device, context, native } = fixture()
  const createEncoder = device.createCommandEncoder
  const submit = device.queue.submit
  const getCurrentTexture = context.getCurrentTexture
  const lifetime = managePixelGpu(device, context)
  for (let frame = 0; frame < 1000; frame++) {
    for (let index = 0; index < 3; index++) {
      const encoder = device.createCommandEncoder()
      if (index < 2) encoder.beginRenderPass({ colorAttachments: [] }).end()
      device.queue.submit([encoder.finish()])
    }
    context.getCurrentTexture().createView()
    lifetime.discardPending()
  }
  expect(lifetime.snapshot()).toEqual({
    encodersCreated: 3000,
    encodersFinished: 3000,
    encodersReleased: 3000,
    passesCreated: 2000,
    passesEnded: 2000,
    passesReleased: 2000,
    commandBuffersCreated: 3000,
    commandBuffersSubmitted: 3000,
    commandBuffersReleased: 3000,
    canvasViewsCreated: 1,
    canvasViewsReleased: 0,
    pendingEncoders: 0,
    pendingPasses: 0,
    pendingCommandBuffers: 0,
    cachedCanvasViews: 1,
  })
  lifetime.dispose()
  lifetime.dispose()
  expect(native).toEqual({ encoders: 3000, passes: 2000, buffers: 3000, views: 1, submits: 3000 })
  expect(device.createCommandEncoder).toBe(createEncoder)
  expect(device.queue.submit).toBe(submit)
  expect(context.getCurrentTexture).toBe(getCurrentTexture)
})

test("canvas caching has one slot and does not release reusable offscreen views", () => {
  const { device, context, native, texture, replaceTexture } = fixture()
  const canvas = context.getCurrentTexture()
  const createView = canvas.createView
  const lifetime = managePixelGpu(device, context)
  const offscreen = texture().createView()
  const first = context.getCurrentTexture().createView()
  expect(context.getCurrentTexture()).toBe(canvas)
  expect(context.getCurrentTexture().createView()).toBe(first)
  expect(() => canvas.createView({})).toThrow("default descriptor")
  replaceTexture()
  expect(context.getCurrentTexture().createView()).not.toBe(first)
  expect(canvas.createView).toBe(createView)
  expect(native.views).toBe(1)
  lifetime.dispose()
  expect(native.views).toBe(2)
  expect(lifetime.snapshot().canvasViewsReleased).toBe(2)
  offscreen.destroy()
  expect(native.views).toBe(3)
})

for (const failure of ["end", "finish", "finish-released", "submit"] as const) {
  test(`cleanup releases abandoned handles after ${failure} failure`, () => {
    const { device, context, native } = fixture(failure)
    const lifetime = managePixelGpu(device, context)
    expect(() => {
      const encoder = device.createCommandEncoder()
      encoder.beginRenderPass({ colorAttachments: [] }).end()
      device.queue.submit([encoder.finish()])
    }).toThrow(`${failure} failed`)
    lifetime.discardPending()
    lifetime.dispose()
    const counts = lifetime.snapshot()
    expect(native.encoders).toBe(1)
    expect(native.passes).toBe(1)
    expect(counts.encodersReleased).toBe(counts.encodersCreated)
    expect(counts.commandBuffersReleased).toBe(counts.commandBuffersCreated)
    expect(counts.pendingEncoders + counts.pendingPasses + counts.pendingCommandBuffers).toBe(0)
  })
}

test("abandoning an open pass and an unsubmitted buffer releases each once", () => {
  const { device, context, native } = fixture()
  const lifetime = managePixelGpu(device, context)
  device.createCommandEncoder().finish()
  const pass = device.createCommandEncoder().beginRenderPass({ colorAttachments: [] })
  lifetime.discardPending()
  expect(() => pass.end()).toThrow("not pending")
  lifetime.dispose()
  expect(native).toEqual({ passes: 1, buffers: 1, encoders: 2, views: 0, submits: 0 })
})

test("submitted buffers cannot be released twice", () => {
  const { device, context, native } = fixture()
  const lifetime = managePixelGpu(device, context)
  const buffer = device.createCommandEncoder().finish()
  device.queue.submit(new Set([buffer]))
  expect(() => device.queue.submit([buffer])).toThrow("already submitted")
  lifetime.dispose()
  expect(native.buffers).toBe(1)
})

test("pending ownership is bounded and separate devices are untouched", () => {
  const first = fixture()
  const other = fixture()
  const original = other.device.createCommandEncoder
  const lifetime = managePixelGpu(first.device, first.context)
  expect(() => {
    for (let index = 0; index < 65; index++) first.device.createCommandEncoder()
  }).toThrow("pending GPU handles")
  lifetime.dispose()
  expect(first.native.encoders).toBe(64)
  expect(other.device.createCommandEncoder).toBe(original)
})
