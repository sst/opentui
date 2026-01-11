import { test, expect } from "bun:test"
import { Renderable } from "../Renderable"
import type { OptimizedBuffer } from "../buffer"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"

class DestroyingRenderable extends Renderable {
  protected renderSelf(_buffer: OptimizedBuffer, _deltaTime: number): void {}
}

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
