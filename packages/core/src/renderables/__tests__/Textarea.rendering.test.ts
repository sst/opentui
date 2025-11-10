import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer, type MockInput } from "../../testing/test-renderer"
import { createTextareaRenderable } from "./renderable-test-utils"
import { RGBA } from "../../lib/RGBA"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>
let currentMockInput: MockInput
let captureFrame: () => string

describe("Textarea - Rendering Tests", () => {
  beforeEach(async () => {
    ;({
      renderer: currentRenderer,
      renderOnce,
      captureCharFrame: captureFrame,
      mockInput: currentMockInput,
    } = await createTestRenderer({
      width: 80,
      height: 24,
    }))
  })

  afterEach(() => {
    currentRenderer.destroy()
  })

  describe("Wrapping", () => {
    it("should handle wrap mode property", async () => {
      const longText = "A".repeat(100)
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: longText,
        width: 20,
        height: 10,
        wrapMode: "word",
      })

      expect(editor.wrapMode).toBe("word")
      const wrappedCount = editor.editorView.getVirtualLineCount()
      expect(wrappedCount).toBeGreaterThan(1)

      editor.wrapMode = "none"
      expect(editor.wrapMode).toBe("none")
      const unwrappedCount = editor.editorView.getVirtualLineCount()
      expect(unwrappedCount).toBe(1)
    })

    it("should handle wrapMode changes", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello wonderful world",
        width: 12,
        height: 10,
        wrapMode: "char",
      })

      expect(editor.wrapMode).toBe("char")

      editor.wrapMode = "word"
      expect(editor.wrapMode).toBe("word")
    })

    it("should render with tab indicator correctly", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Line 1\tTabbed\nLine 2\t\tDouble tab",
        tabIndicator: "→",
        tabIndicatorColor: RGBA.fromValues(0.5, 0.5, 0.5, 1),
        width: 40,
        height: 10,
      })

      await renderOnce()
      const frame = captureFrame()
      expect(frame).toMatchSnapshot()
    })
  })

  describe("Height and Width Measurement", () => {
    it("should grow height for multiline text without wrapping", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Line 1\nLine 2\nLine 3\nLine 4\nLine 5",
        wrapMode: "none",
        width: 40,
      })

      await renderOnce()

      expect(editor.height).toBe(5)
      expect(editor.width).toBeGreaterThanOrEqual(6)
    })

    it("should grow height for wrapped text when wrapping enabled", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "This is a very long line that will definitely wrap to multiple lines",
        wrapMode: "word",
        width: 15,
      })

      await renderOnce()

      expect(editor.height).toBeGreaterThan(1)
      expect(editor.width).toBeLessThanOrEqual(15)
    })

    it("should measure full width when wrapping is disabled and not constrained by parent", async () => {
      const longLine = "This is a very long line that would wrap but wrapping is disabled"
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: longLine,
        wrapMode: "none",
        position: "absolute",
      })

      await renderOnce()

      expect(editor.height).toBe(1)
      expect(editor.width).toBe(longLine.length)
    })

    it("should shrink height when deleting lines via value setter", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Line 1\nLine 2\nLine 3\nLine 4\nLine 5",
        width: 40,
        wrapMode: "none",
      })

      editor.focus()
      await renderOnce()
      expect(editor.height).toBe(5)

      // Remove lines by setting new value
      editor.setText("Line 1\nLine 2")
      await renderOnce()

      expect(editor.height).toBe(2)
      expect(editor.plainText).toBe("Line 1\nLine 2")
    })

    it("should update height when content changes from single to multiline", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Single line",
        wrapMode: "none",
      })

      await renderOnce()
      expect(editor.height).toBe(1)

      editor.setText("Line 1\nLine 2\nLine 3")
      await renderOnce()

      expect(editor.height).toBe(3)
    })

    it("should grow height when pressing Enter to add newlines", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Single line",
        width: 40,
        wrapMode: "none",
      })

      // Add a second textarea below to verify layout reflow
      const { textarea: belowEditor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Below",
        width: 40,
      })

      await renderOnce()
      expect(editor.height).toBe(1)
      const initialHeight = editor.height
      const initialBelowY = belowEditor.y

      editor.focus()
      editor.gotoLine(9999) // Move to end

      // Press Enter 3 times to add 3 newlines
      currentMockInput.pressEnter()
      expect(editor.plainText).toBe("Single line\n")
      await renderOnce() // Wait for layout recalculation

      currentMockInput.pressEnter()
      expect(editor.plainText).toBe("Single line\n\n")
      await renderOnce() // Wait for layout recalculation

      currentMockInput.pressEnter()
      expect(editor.plainText).toBe("Single line\n\n\n")
      await renderOnce() // Wait for layout recalculation

      // The editor should have grown
      expect(editor.height).toBeGreaterThan(initialHeight)
      expect(editor.height).toBe(4) // 1 original line + 3 new lines
      expect(editor.plainText).toBe("Single line\n\n\n")

      // The element below should have moved down
      expect(belowEditor.y).toBeGreaterThan(initialBelowY)
      expect(belowEditor.y).toBe(4) // After the 4-line editor
    })
  })

  describe("Unicode Support", () => {
    it("should handle emoji insertion", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end
      editor.insertText(" 🌟")

      expect(editor.plainText).toBe("Hello 🌟")
    })

    it("should handle CJK characters", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end
      editor.insertText(" 世界")

      expect(editor.plainText).toBe("Hello 世界")
    })

    it("should handle emoji cursor movement", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "A🌟B",
        width: 40,
        height: 10,
      })

      editor.focus()
      expect(editor.logicalCursor.col).toBe(0)

      currentMockInput.pressArrow("right") // Move past A
      expect(editor.logicalCursor.col).toBe(1)

      currentMockInput.pressArrow("right") // Move past emoji (2 cells)
      expect(editor.logicalCursor.col).toBe(3)

      currentMockInput.pressArrow("right") // Move past B
      expect(editor.logicalCursor.col).toBe(4)
    })
  })
})
