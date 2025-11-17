import { test, expect, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"
import { TextRenderable } from "../renderables/Text"

let renderer: TestRenderer
let renderOnce: () => void

beforeEach(async () => {
  ;({ renderer, renderOnce } = await createTestRenderer({}))
})

afterEach(() => {
  renderer.destroy()
})

test("selection on destroyed renderable should not throw", () => {
  const text = new TextRenderable(renderer, {
    content: "Hello World",
    width: 20,
    height: 1,
  })

  renderer.root.add(text)
  renderOnce()

  // Start selection
  renderer.startSelection(text, 0, 0)

  // Update selection - this should not throw
  renderer.updateSelection(text, 5, 1)

  expect(renderer.getSelection()).not.toBeNull()

  // Destroy the text renderable
  text.destroy()

  expect(text.isDestroyed).toBe(true)

  // Get selection - this should not throw
  expect(renderer.getSelection()!.getSelectedText()).toBe("")

  // Update selection - this should not throw
  renderer.updateSelection(text, 8, 1)

  // Clear selection - this should not throw
  renderer.clearSelection()

  expect(renderer.getSelection()).toBeNull()
})
