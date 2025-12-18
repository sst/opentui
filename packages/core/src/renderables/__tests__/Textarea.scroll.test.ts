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
      expect(viewportBefore.offsetY).toBe(0)

      // Start renderer to enable auto-scroll with actual deltaTime
      currentRenderer.start()

      // Start dragging from top
      await currentMouse.pressDown(editor.x, editor.y)

      // Move to bottom edge to trigger auto-scroll (keep button pressed)
      await currentMouse.moveTo(editor.x + 5, editor.y + editor.height - 1)

      // Wait 1 second for auto-scroll to happen
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const viewportAfter = editor.editorView.getViewport()

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

      // Start selection and drag
      await currentMouse.drag(editor.x, editor.y, editor.x + 10, editor.y + 5)
      await renderOnce()

      const cursorAfter = editor.logicalCursor

      // Cursor should have moved to the selection focus position
      expect(cursorAfter.row).toBeGreaterThan(cursorBefore.row)

      editor.destroy()
    })
  })

  describe("Mouse Click Cursor Positioning", () => {
    it("should set cursor when clicking without dragging", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Line 0\nLine 1\nLine 2\nLine 3\nLine 4",
        width: 40,
        height: 10,
        selectable: true,
      })

      editor.editBuffer.gotoLine(0)
      await renderOnce()

      const cursorBefore = editor.logicalCursor
      expect(cursorBefore.row).toBe(0)
      expect(cursorBefore.col).toBe(0)

      // Click on line 2, column 3
      await currentMouse.click(editor.x + 3, editor.y + 2)
      await renderOnce()

      const cursorAfter = editor.logicalCursor
      expect(cursorAfter.row).toBe(2)
      expect(cursorAfter.col).toBe(3)

      editor.destroy()
    })

    it("should set cursor when clicking on empty line", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Line 0\n\nLine 2\n\nLine 4",
        width: 40,
        height: 10,
        selectable: true,
      })

      await renderOnce()

      // Click on empty line 1
      await currentMouse.click(editor.x + 5, editor.y + 1)
      await renderOnce()

      const cursor1 = editor.logicalCursor
      expect(cursor1.row).toBe(1)
      expect(cursor1.col).toBe(0) // Empty line, cursor at column 0

      // Click on empty line 3
      await currentMouse.click(editor.x + 10, editor.y + 3)
      await renderOnce()

      const cursor2 = editor.logicalCursor
      expect(cursor2.row).toBe(3)
      expect(cursor2.col).toBe(0)

      editor.destroy()
    })

    it("should clamp cursor when clicking beyond line end", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Short\nMedium line\nVery long line here",
        width: 40,
        height: 10,
        selectable: true,
      })

      await renderOnce()

      // Click way beyond the end of "Short" (5 chars)
      await currentMouse.click(editor.x + 20, editor.y)
      await renderOnce()

      const cursor = editor.logicalCursor
      expect(cursor.row).toBe(0)
      expect(cursor.col).toBeLessThanOrEqual(5) // Clamped to line end

      editor.destroy()
    })

    it("should set cursor when clicking with scrolled viewport", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: Array.from({ length: 50 }, (_, i) => `Line ${i}`).join("\n"),
        width: 40,
        height: 10,
        selectable: true,
      })

      // Scroll to middle
      editor.editBuffer.gotoLine(25)
      await renderOnce()

      const viewport = editor.editorView.getViewport()
      expect(viewport.offsetY).toBeGreaterThan(10)

      const offsetYBefore = viewport.offsetY

      // Click on first visible line (which is line offsetY in absolute terms)
      await currentMouse.click(editor.x + 3, editor.y)
      await renderOnce()

      const cursor = editor.logicalCursor
      expect(cursor.row).toBe(offsetYBefore) // Should be the first visible line
      expect(cursor.col).toBe(3)

      editor.destroy()
    })
  })
})
