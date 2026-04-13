import { test, expect } from "bun:test"
import { Readable } from "node:stream"
import { Renderable } from "../Renderable.js"
import type { OptimizedBuffer } from "../buffer.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"

class DestroyingRenderable extends Renderable {
  protected renderSelf(_buffer: OptimizedBuffer, _deltaTime: number): void {}
}

test("destroying renderer during frame callback should synchronously clean up terminal state", async () => {
  const rawModeCalls: boolean[] = []
  const stdin = new Readable({ read() {} }) as NodeJS.ReadStream & {
    setRawMode: (enabled: boolean) => NodeJS.ReadStream
  }
  stdin.setRawMode = (enabled) => {
    rawModeCalls.push(enabled)
    return stdin
  }

  const { renderer } = await createTestRenderer({ stdin })
  const lib = (renderer as any).lib as { suspendRenderer: (rendererPtr: unknown) => void }
  const originalSuspendRenderer = lib.suspendRenderer.bind(lib)
  let suspendCalls = 0
  let cleanupObserved = false

  lib.suspendRenderer = (rendererPtr: unknown) => {
    suspendCalls++
    originalSuspendRenderer(rendererPtr)
  }

  renderer.setFrameCallback(async () => {
    renderer.destroy()
    cleanupObserved = true

    expect(rawModeCalls.at(-1)).toBe(false)
    expect(suspendCalls).toBe(1)
  })

  renderer.start()

  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(cleanupObserved).toBe(true)
})

test("destroying renderer during frame callback should not crash", async () => {
  const { renderer } = await createTestRenderer({})

  let destroyedDuringRender = false

  renderer.setFrameCallback(async () => {
    destroyedDuringRender = true
    renderer.destroy()
  })

  renderer.start()

  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(destroyedDuringRender).toBe(true)

  // If we got here without a segfault, the test passes
})

test("destroying renderer during post-process should not crash", async () => {
  const { renderer } = await createTestRenderer({})

  let destroyedDuringPostProcess = false

  renderer.addPostProcessFn(() => {
    destroyedDuringPostProcess = true
    renderer.destroy()
  })

  renderer.start()

  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(destroyedDuringPostProcess).toBe(true)

  // If we got here without a segfault, the test passes
})

test("destroying renderer during root render should not crash", async () => {
  const { renderer } = await createTestRenderer({})

  let destroyedDuringRender = false

  // Override the root's render method to destroy the renderer
  const originalRender = renderer.root.render.bind(renderer.root)
  renderer.root.render = (buffer, deltaTime) => {
    originalRender(buffer, deltaTime)
    if (!destroyedDuringRender) {
      destroyedDuringRender = true
      renderer.destroy()
    }
  }

  renderer.start()

  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(destroyedDuringRender).toBe(true)

  // If we got here without a segfault, the test passes
})

test("destroying renderer during requestAnimationFrame should not crash", async () => {
  const { renderer } = await createTestRenderer({})

  let destroyedDuringAnimationFrame = false

  requestAnimationFrame(() => {
    destroyedDuringAnimationFrame = true
    renderer.destroy()
  })

  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(destroyedDuringAnimationFrame).toBe(true)
})

test("destroying renderer during renderBefore should not crash", async () => {
  const { renderer } = await createTestRenderer({})

  let destroyedDuringRenderBefore = false

  const renderable = new DestroyingRenderable(renderer, {
    id: "destroy-render-before",
    width: 10,
    height: 1,
    renderBefore() {
      if (!destroyedDuringRenderBefore) {
        destroyedDuringRenderBefore = true
        renderer.destroy()
      }
    },
  })

  renderer.root.add(renderable)
  renderer.start()

  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(destroyedDuringRenderBefore).toBe(true)
})
