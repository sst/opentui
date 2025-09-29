import { test, expect } from "bun:test"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"

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
