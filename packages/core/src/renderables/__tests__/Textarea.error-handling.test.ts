import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer } from "../../testing/test-renderer"
import { createTextareaRenderable } from "./renderable-test-utils"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>

describe("Textarea - Error Handling Tests", () => {
  beforeEach(async () => {
    ;({ renderer: currentRenderer, renderOnce } = await createTestRenderer({
      width: 80,
      height: 24,
    }))
  })

  afterEach(() => {
    currentRenderer.destroy()
  })

  describe("Error Handling", () => {
    it("should throw error when using destroyed editor", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Test",
        width: 40,
        height: 10,
      })

      editor.destroy()

      expect(() => editor.plainText).toThrow("EditBuffer is destroyed")
      expect(() => editor.insertText("x")).toThrow("EditorView is destroyed")
      expect(() => editor.moveCursorLeft()).toThrow("EditorView is destroyed")
    })
  })
})
