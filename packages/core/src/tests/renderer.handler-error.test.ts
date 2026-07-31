import { expect, test } from "bun:test"
import { Renderable } from "../Renderable.js"
import { CliRenderEvents } from "../renderer.js"
import { createTestRenderer } from "../testing.js"

test("emits mouse handler errors without resetting input", async () => {
  const { renderer, mockMouse, renderOnce } = await createTestRenderer({ width: 20, height: 10 })
  const target = new Renderable(renderer, {
    position: "absolute",
    left: 1,
    top: 1,
    width: 4,
    height: 2,
  })
  const error = new Error("handler failed")
  const errors: unknown[] = []
  let handled = false

  try {
    renderer.root.add(target)
    await renderOnce()
    renderer.on(CliRenderEvents.HANDLER_ERROR, (value) => errors.push(value))
    target.onMouseUp = () => {
      throw error
    }

    await mockMouse.click(target.x, target.y)

    target.onMouseUp = () => {
      handled = true
    }
    await mockMouse.click(target.x, target.y)

    expect(errors).toEqual([error])
    expect(handled).toBe(true)
  } finally {
    renderer.destroy()
  }
})
