import { expect, test } from "bun:test"
import { Renderable } from "../Renderable.js"
import type { OptimizedBuffer } from "../buffer.js"
import { CliRenderEvents } from "../renderer.js"
import { createTestRenderer } from "../testing.js"

class ThrowingRenderable extends Renderable {
  public shouldThrow = true

  protected renderSelf(_buffer: OptimizedBuffer, _deltaTime: number): void {
    if (this.shouldThrow) throw new Error("render failed")
  }
}

test("emits render errors and continues rendering", async () => {
  const { renderer, waitFor } = await createTestRenderer({})
  const target = new ThrowingRenderable(renderer, { width: 1, height: 1 })
  const errors: unknown[] = []

  try {
    renderer.root.add(target)
    renderer.on(CliRenderEvents.RENDER_ERROR, (error) => {
      errors.push(error)
      target.shouldThrow = false
    })

    renderer.start()
    await waitFor(() => errors.length === 1 && renderer.getStats().nativeFrameCount > 0)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toEqual(new Error("render failed"))
  } finally {
    renderer.destroy()
  }
})
