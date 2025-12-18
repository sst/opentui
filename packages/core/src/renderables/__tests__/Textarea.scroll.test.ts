import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer, type MockMouse } from "../../testing/test-renderer"
import { createTextareaRenderable } from "./renderable-test-utils"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>
let currentMouse: MockMouse

describe("Textarea - Scroll Tests", () => {
  beforeEach(async () => {
    ;({
      renderer: currentRenderer,
      renderOnce,
      mockMouse: currentMouse,
    } = await createTestRenderer({
      width: 80,
      height: 24,
    }))
  })

  afterEach(() => {
    currentRenderer.destroy()
  })

  describe("Mouse Selection Auto-Scroll", () => {
    it("should auto-scroll down when dragging selection below viewport", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: Array.from({ length: 50 }, (_, i) => `Line ${i}`).join("\n"),
        width: 40,
        height: 10,
        selectable: true,
      })

      // Position at top
      editor.editBuffer.gotoLine(0)
      await renderOnce()

      const viewportBefore = editor.editorView.getViewport()
      console.log("Initial viewport:", viewportBefore)
      expect(viewportBefore.offsetY).toBe(0)

      // Start renderer to enable auto-scroll with actual deltaTime
      currentRenderer.start()

      // Start dragging from top
      await currentMouse.pressDown(editor.x, editor.y)

      console.log("After mouse down - has selection:", editor.hasSelection())

      // Move to bottom edge to trigger auto-scroll (keep button pressed)
      await currentMouse.moveTo(editor.x + 5, editor.y + editor.height - 1)

      console.log("After move to bottom - has selection:", editor.hasSelection())
      console.log("After move to bottom - cursor:", editor.logicalCursor)
      console.log("After move to bottom - viewport:", editor.editorView.getViewport())

      // Wait 1 second for auto-scroll to happen
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const viewportAfter = editor.editorView.getViewport()
      console.log("Final viewport after 1 second:", viewportAfter)

      // Release mouse
      await currentMouse.release(editor.x + 5, editor.y + editor.height - 1)

      currentRenderer.pause()

      // Viewport should have scrolled down significantly
      expect(viewportAfter.offsetY).toBeGreaterThan(viewportBefore.offsetY)

      editor.destroy()
    })

    it("should set cursor to selection focus when selecting", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: Array.from({ length: 50 }, (_, i) => `Line ${i}`).join("\n"),
        width: 40,
        height: 10,
        selectable: true,
      })

      editor.editBuffer.gotoLine(0)
      await renderOnce()

      const cursorBefore = editor.logicalCursor
      console.log("Cursor before selection:", cursorBefore)

      // Start selection and drag
      await currentMouse.drag(editor.x, editor.y, editor.x + 10, editor.y + 5)
      await renderOnce()

      const cursorAfter = editor.logicalCursor
      console.log("Cursor after selection:", cursorAfter)
      console.log("Has selection:", editor.hasSelection())
      console.log("Selection:", editor.getSelection())

      // Cursor should have moved to the selection focus position
      expect(cursorAfter.row).toBeGreaterThan(cursorBefore.row)

      editor.destroy()
    })
  })
})
