import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer, type MockInput } from "../../testing/test-renderer"
import { createTextareaRenderable } from "./renderable-test-utils"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>
let currentMockInput: MockInput

describe("Textarea - Undo/Redo Tests", () => {
  beforeEach(async () => {
    ;({
      renderer: currentRenderer,
      renderOnce,
      mockInput: currentMockInput,
    } = await createTestRenderer({
      width: 80,
      height: 24,
    }))
  })

  afterEach(() => {
    currentRenderer.destroy()
  })

  describe("Undo/Redo", () => {
    it("should delete multiple selected ranges and restore with undo", async () => {
      const initialText = "Hello World Test"
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: initialText,
        width: 40,
        height: 10,
      })

      editor.focus()

      editor.editBuffer.setCursor(0, 0)
      for (let i = 0; i < 5; i++) {
        currentMockInput.pressArrow("right", { shift: true })
      }
      expect(editor.hasSelection()).toBe(true)
      expect(editor.getSelectedText()).toBe("Hello")

      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe(" World Test")
      expect(editor.hasSelection()).toBe(false)

      editor.editBuffer.setCursor(0, 0)
      for (let i = 0; i < 6; i++) {
        currentMockInput.pressArrow("right", { shift: true })
      }
      expect(editor.hasSelection()).toBe(true)
      expect(editor.getSelectedText()).toBe(" World")

      currentMockInput.pressKey("DELETE")
      expect(editor.plainText).toBe(" Test")
      expect(editor.hasSelection()).toBe(false)

      editor.editBuffer.setCursor(0, 0)
      for (let i = 0; i < 5; i++) {
        currentMockInput.pressArrow("right", { shift: true })
      }
      expect(editor.hasSelection()).toBe(true)
      expect(editor.getSelectedText()).toBe(" Test")

      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("")
      expect(editor.hasSelection()).toBe(false)

      currentMockInput.pressKey("z", { ctrl: true })
      expect(editor.plainText).toBe(" Test")

      currentMockInput.pressKey("z", { ctrl: true })
      expect(editor.plainText).toBe(" World Test")

      currentMockInput.pressKey("z", { ctrl: true })
      expect(editor.plainText).toBe(initialText)
    })
  })
})
