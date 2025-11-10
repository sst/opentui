import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer, type MockMouse, type MockInput } from "../../testing/test-renderer"
import { createTextareaRenderable } from "./renderable-test-utils"
import { RGBA } from "../../lib/RGBA"
import { OptimizedBuffer } from "../../buffer"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>
let currentMouse: MockMouse
let currentMockInput: MockInput

describe("Textarea - Stress Tests", () => {
  beforeEach(async () => {
    ;({
      renderer: currentRenderer,
      renderOnce,
      mockMouse: currentMouse,
      mockInput: currentMockInput,
    } = await createTestRenderer({
      width: 80,
      height: 24,
    }))
  })

  afterEach(() => {
    currentRenderer.destroy()
  })

  describe("Selection Support", () => {
    it("should support selection via mouse drag", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: true,
      })

      expect(editor.hasSelection()).toBe(false)

      await currentMouse.drag(editor.x, editor.y, editor.x + 5, editor.y)
      await renderOnce()

      expect(editor.hasSelection()).toBe(true)

      const sel = editor.getSelection()
      expect(sel).not.toBe(null)
      expect(sel!.start).toBe(0)
      expect(sel!.end).toBe(5)

      expect(editor.getSelectedText()).toBe("Hello")
    })

    it("should return selected text from multi-line content", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "AAAA\nBBBB\nCCCC",
        width: 40,
        height: 10,
        selectable: true,
      })

      // Select from line 0 col 2 to line 2 col 2
      await currentMouse.drag(editor.x + 2, editor.y, editor.x + 2, editor.y + 2)
      await renderOnce()

      const selectedText = editor.getSelectedText()
      expect(selectedText).toBe("AA\nBBBB\nCC")
    })

    it("should handle selection with viewport scrolling", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: Array.from({ length: 20 }, (_, i) => `Line ${i}`).join("\n"),
        width: 40,
        height: 5,
        selectable: true,
      })

      // Scroll down to line 10
      editor.gotoLine(10)
      await renderOnce() // Trigger viewport update

      const viewport = editor.editorView.getViewport()
      expect(viewport.offsetY).toBeGreaterThan(0)

      // Select in the scrolled viewport - coordinates are viewport-relative
      // Dragging from (editor.x, editor.y) to (editor.x + 4, editor.y + 2)
      // means selecting from viewport-local (0, 0) to (4, 2)
      // With viewport.offsetY > 0, this should select absolute lines starting from viewport.offsetY
      await currentMouse.drag(editor.x, editor.y, editor.x + 4, editor.y + 2)
      await renderOnce()

      expect(editor.hasSelection()).toBe(true)
      const selectedText = editor.getSelectedText()
      expect(selectedText.length).toBeGreaterThan(0)

      // Verify the selection is from the scrolled viewport, not from line 0
      // The selection should start from the line at viewport.offsetY
      expect(selectedText).not.toContain("Line 0")
      expect(selectedText).not.toContain("Line 1")
      expect(selectedText).toContain("Line")
    })

    it("should disable selection when selectable is false", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: false,
      })

      const shouldHandle = editor.shouldStartSelection(editor.x, editor.y)
      expect(shouldHandle).toBe(false)

      await currentMouse.drag(editor.x, editor.y, editor.x + 5, editor.y)
      await renderOnce()

      expect(editor.hasSelection()).toBe(false)
      expect(editor.getSelectedText()).toBe("")
    })

    it("should update selection when selectionBg/selectionFg changes", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: true,
        selectionBg: RGBA.fromValues(0, 0, 1, 1),
      })

      await currentMouse.drag(editor.x, editor.y, editor.x + 5, editor.y)
      await renderOnce()

      expect(editor.hasSelection()).toBe(true)

      // Change selection colors - should trigger update
      editor.selectionBg = RGBA.fromValues(1, 0, 0, 1)
      editor.selectionFg = RGBA.fromValues(1, 1, 1, 1)

      expect(editor.hasSelection()).toBe(true)
    })

    it("should clear selection", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: true,
      })

      await currentMouse.drag(editor.x, editor.y, editor.x + 5, editor.y)
      await renderOnce()

      expect(editor.hasSelection()).toBe(true)

      // Clear selection
      currentRenderer.clearSelection()
      await renderOnce()

      expect(editor.hasSelection()).toBe(false)
      expect(editor.getSelectedText()).toBe("")
    })

    it("should handle selection with wrapping enabled", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "ABCDEFGHIJKLMNOP",
        width: 10,
        height: 10,
        wrapMode: "word",
        selectable: true,
      })

      // Should wrap into 2 virtual lines
      const vlineCount = editor.editorView.getVirtualLineCount()
      expect(vlineCount).toBe(2)

      // Select from virtual line 0 col 2 to virtual line 1 col 3
      await currentMouse.drag(editor.x + 2, editor.y, editor.x + 3, editor.y + 1)
      await renderOnce()

      const sel = editor.getSelection()
      expect(sel).not.toBe(null)
      expect(sel!.start).toBe(2)
      expect(sel!.end).toBe(13)
    })

    it("should handle reverse selection (drag from end to start)", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: true,
      })

      await currentMouse.drag(editor.x + 11, editor.y, editor.x + 6, editor.y)
      await renderOnce()

      const sel = editor.getSelection()
      expect(sel).not.toBe(null)
      expect(sel!.start).toBe(6)
      expect(sel!.end).toBe(11)

      expect(editor.getSelectedText()).toBe("World")
    })

    it("should render selection properly when drawing to buffer", async () => {
      const buffer = OptimizedBuffer.create(80, 24, "wcwidth")

      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: true,
        selectionBg: RGBA.fromValues(0, 0, 1, 1), // Blue background
        selectionFg: RGBA.fromValues(1, 1, 1, 1), // White foreground
      })

      // Select "Hello"
      await currentMouse.drag(editor.x, editor.y, editor.x + 5, editor.y)
      await renderOnce()

      expect(editor.hasSelection()).toBe(true)
      expect(editor.getSelectedText()).toBe("Hello")

      // Draw to buffer - should render with selection highlighting
      buffer.clear(RGBA.fromValues(0, 0, 0, 1))
      buffer.drawEditorView(editor.editorView, editor.x, editor.y)

      // Verify selection is rendered (we can't easily verify colors, but we can verify it doesn't crash)
      const sel = editor.getSelection()
      expect(sel).not.toBe(null)
      expect(sel!.start).toBe(0)
      expect(sel!.end).toBe(5)

      buffer.destroy()
    })

    it("should handle viewport-aware selection correctly", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: Array.from({ length: 15 }, (_, i) => `Line ${i}`).join("\n"),
        width: 40,
        height: 5,
        selectable: true,
      })

      // Scroll to line 10
      editor.gotoLine(10)
      await renderOnce() // Trigger viewport update

      const viewport = editor.editorView.getViewport()
      expect(viewport.offsetY).toBeGreaterThan(0)

      // The viewport should show lines starting from viewport.offsetY
      // When we drag from (editor.x, editor.y) to (editor.x + 6, editor.y)
      // we're selecting viewport-local (0, 0) to (6, 0)
      // This should select the first line visible in the viewport at absolute line viewport.offsetY
      const expectedLineNumber = viewport.offsetY

      await currentMouse.drag(editor.x, editor.y, editor.x + 6, editor.y)
      await renderOnce()

      expect(editor.hasSelection()).toBe(true)
      const selectedText = editor.getSelectedText()

      // The selected text should be from the line visible at the top of the viewport
      // which is at absolute line viewport.offsetY
      // It should NOT be "Line 0" - it should be the line at the viewport offset
      expect(selectedText).not.toContain("Line 0")
      expect(selectedText).not.toContain("Line 1")

      // Should contain the line number that's at the viewport offset
      expect(selectedText).toContain(`Line ${expectedLineNumber}`)
    })

    it("should handle multi-line selection with viewport scrolling", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: Array.from({ length: 20 }, (_, i) => `AAAA${i}`).join("\n"),
        width: 40,
        height: 5,
        selectable: true,
      })

      // Scroll to line 8
      editor.gotoLine(8)
      await renderOnce()

      const viewport = editor.editorView.getViewport()
      expect(viewport.offsetY).toBeGreaterThan(0)

      // Select from viewport-local (0, 0) to (4, 2) - should span 3 visible lines
      await currentMouse.drag(editor.x, editor.y, editor.x + 4, editor.y + 2)
      await renderOnce()

      expect(editor.hasSelection()).toBe(true)
      const selectedText = editor.getSelectedText()

      // Should contain parts of the lines at viewport.offsetY, offsetY+1, offsetY+2
      const line1 = `AAAA${viewport.offsetY}`
      const line2 = `AAAA${viewport.offsetY + 1}`
      const line3 = `AAAA${viewport.offsetY + 2}`

      expect(selectedText).toContain(line1)
      expect(selectedText).toContain(line2)
      expect(selectedText).toContain(line3.substring(0, 4)) // First 4 chars of line 3
    })

    it("should handle horizontal scrolled selection without wrapping", async () => {
      const longLine = "A".repeat(100)
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: longLine,
        width: 20,
        height: 5,
        wrapMode: "none", // No wrapping - enables horizontal scrolling
        selectable: true,
      })

      // Move cursor far to the right to trigger horizontal scroll
      for (let i = 0; i < 50; i++) {
        editor.moveCursorRight()
      }
      await renderOnce()

      const viewport = editor.editorView.getViewport()
      expect(viewport.offsetX).toBeGreaterThan(0)

      // Select from viewport-local (0, 0) to (10, 0)
      // Should select 10 characters starting from column viewport.offsetX
      await currentMouse.drag(editor.x, editor.y, editor.x + 10, editor.y)
      await renderOnce()

      expect(editor.hasSelection()).toBe(true)
      const selectedText = editor.getSelectedText()

      // Should be 10 'A' characters
      expect(selectedText).toBe("A".repeat(10))

      // Verify the selection starts from the scrolled column, not from column 0
      const sel = editor.getSelection()
      expect(sel).not.toBe(null)
      expect(sel!.start).toBeGreaterThanOrEqual(viewport.offsetX)
    })

    it("RENDER TEST: selection highlighting appears at correct screen position with viewport scroll", async () => {
      const buffer = OptimizedBuffer.create(80, 24, "wcwidth")

      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: Array.from({ length: 15 }, (_, i) => `Line${i}`).join("\n"),
        width: 20,
        height: 5,
        selectable: true,
        selectionBg: RGBA.fromValues(1, 0, 0, 1), // Red background for selection
      })

      // Scroll to line 8
      editor.gotoLine(8)
      await renderOnce()

      const viewport = editor.editorView.getViewport()
      expect(viewport.offsetY).toBeGreaterThan(0)

      // Viewport should show lines starting from around line 6-8
      // Select viewport-local (0, 0) to (5, 0) - should select first line visible
      await currentMouse.drag(editor.x, editor.y, editor.x + 5, editor.y)
      await renderOnce()

      // Draw to buffer
      buffer.clear(RGBA.fromValues(0, 0, 0, 1))
      buffer.drawEditorView(editor.editorView, editor.x, editor.y)

      // Check that cells at the top-left of the editor have selection background
      // The selected text should be the first 5 chars of the line at viewport.offsetY
      const selectedText = editor.getSelectedText()
      expect(selectedText).toBe(`Line${viewport.offsetY}`.substring(0, 5))

      // Now verify that the cells at screen position (editor.x, editor.y) have red background
      // This validates that the selection is rendered at the correct position
      const { bg } = buffer.buffers
      const bufferWidth = buffer.width

      for (let cellX = editor.x; cellX < editor.x + 5; cellX++) {
        const bufferIdx = editor.y * bufferWidth + cellX
        const bgR = bg[bufferIdx * 4 + 0]
        const bgG = bg[bufferIdx * 4 + 1]
        const bgB = bg[bufferIdx * 4 + 2]

        // Check if background is red (selection color) - allow for small floating point differences
        expect(Math.abs(bgR - 1.0)).toBeLessThan(0.01) // Red channel
        expect(Math.abs(bgG - 0.0)).toBeLessThan(0.01) // Green channel
        expect(Math.abs(bgB - 0.0)).toBeLessThan(0.01) // Blue channel
      }

      buffer.destroy()
    })

    it("RENDER TEST: selection rendering with empty lines between", async () => {
      const buffer = OptimizedBuffer.create(80, 24, "wcwidth")

      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "AAAA\n\nBBBB\n\nCCCC",
        width: 40,
        height: 10,
        selectable: true,
        selectionBg: RGBA.fromValues(1, 0, 0, 1), // Red background for selection
      })

      // Select BBBB on line 2
      editor.focus()
      editor.gotoLine(2)

      // Select all 4 characters of BBBB
      for (let i = 0; i < 4; i++) {
        currentMockInput.pressArrow("right", { shift: true })
      }

      expect(editor.getSelectedText()).toBe("BBBB")

      // Draw to buffer
      buffer.clear(RGBA.fromValues(0, 0, 0, 1))
      buffer.drawEditorView(editor.editorView, 0, 0)

      // Verify that cells at row 2 (where BBBB is) have red background
      // Line 0: AAAA at row 0
      // Line 1: empty at row 1
      // Line 2: BBBB at row 2 <-- this should have red bg
      const { bg } = buffer.buffers
      const bufferWidth = buffer.width

      // Check first 4 cells of row 2 (BBBB)
      for (let cellX = 0; cellX < 4; cellX++) {
        const bufferIdx = 2 * bufferWidth + cellX
        const bgR = bg[bufferIdx * 4 + 0]
        const bgG = bg[bufferIdx * 4 + 1]
        const bgB = bg[bufferIdx * 4 + 2]

        // Check if background is red (selection color)
        expect(Math.abs(bgR - 1.0)).toBeLessThan(0.01) // Red channel
        expect(Math.abs(bgG - 0.0)).toBeLessThan(0.01) // Green channel
        expect(Math.abs(bgB - 0.0)).toBeLessThan(0.01) // Blue channel
      }

      buffer.destroy()
    })
  })

  describe("Shift+Arrow Key Selection", () => {
    it("should start selection with shift+right", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: true,
      })

      editor.focus()
      expect(editor.hasSelection()).toBe(false)

      // Press shift+right to start selection
      currentMockInput.pressArrow("right", { shift: true })

      expect(editor.hasSelection()).toBe(true)
      expect(editor.getSelectedText()).toBe("H")
    })

    it("should extend selection with shift+right", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: true,
      })

      editor.focus()

      // Select first 5 characters with shift+right
      for (let i = 0; i < 5; i++) {
        currentMockInput.pressArrow("right", { shift: true })
      }

      expect(editor.hasSelection()).toBe(true)
      expect(editor.getSelectedText()).toBe("Hello")
    })

    it("should handle shift+left selection", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: true,
      })

      editor.focus()
      const cursor = editor.logicalCursor
      editor.editBuffer.setCursorToLineCol(cursor.row, 9999) // Move to end of line // Move to end

      // Select backwards with shift+left
      for (let i = 0; i < 5; i++) {
        currentMockInput.pressArrow("left", { shift: true })
      }

      expect(editor.hasSelection()).toBe(true)
      expect(editor.getSelectedText()).toBe("World")
    })

    it("should select with shift+down", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
        selectable: true,
      })

      editor.focus()

      // Select down with shift+down - selects from start of line 1 to start of line 2
      currentMockInput.pressArrow("down", { shift: true })

      expect(editor.hasSelection()).toBe(true)
      const selectedText = editor.getSelectedText()
      // Should select "Line 1\n" (from position 0,0 to position 0,1)
      expect(selectedText).toBe("Line 1")
    })

    it("should select with shift+up", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
        selectable: true,
      })

      editor.focus()
      editor.gotoLine(2) // Move to line 3

      // Select up with shift+up
      currentMockInput.pressArrow("up", { shift: true })

      expect(editor.hasSelection()).toBe(true)
      const selectedText = editor.getSelectedText()
      expect(selectedText.includes("Line 2")).toBe(true)
    })

    it("should select to line start with shift+home", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: true,
      })

      editor.focus()
      // Move cursor to middle
      for (let i = 0; i < 6; i++) {
        editor.moveCursorRight()
      }

      // Select to start with shift+home
      // Cursor is at position 6 (after "Hello "), shift+home selects back to position 0
      // This includes the character at position 6, so "Hello W" (7 chars)
      currentMockInput.pressKey("HOME", { shift: true })

      expect(editor.hasSelection()).toBe(true)
      expect(editor.getSelectedText()).toBe("Hello W")
    })

    it("should select to line end with shift+end", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: true,
      })

      editor.focus()
      // Cursor at start

      // Select to end with shift+end
      currentMockInput.pressKey("END", { shift: true })

      expect(editor.hasSelection()).toBe(true)
      expect(editor.getSelectedText()).toBe("Hello World")
    })

    it("should clear selection when moving without shift", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: true,
      })

      editor.focus()

      // Start selection
      for (let i = 0; i < 5; i++) {
        currentMockInput.pressArrow("right", { shift: true })
      }

      expect(editor.hasSelection()).toBe(true)

      // Move without shift - should clear selection
      currentMockInput.pressArrow("right")

      expect(editor.hasSelection()).toBe(false)
    })

    it("should delete selected text with backspace", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: true,
      })

      editor.focus()

      // Select "Hello"
      for (let i = 0; i < 5; i++) {
        currentMockInput.pressArrow("right", { shift: true })
      }

      expect(editor.getSelectedText()).toBe("Hello")
      expect(editor.plainText).toBe("Hello World")

      // Backspace should delete the selected text
      currentMockInput.pressBackspace()

      expect(editor.hasSelection()).toBe(false)
      expect(editor.plainText).toBe(" World")
      expect(editor.logicalCursor.col).toBe(0)
    })

    it("should delete selected text with delete key", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: true,
      })

      editor.focus()

      // Select "World"
      const cursor = editor.logicalCursor
      editor.editBuffer.setCursorToLineCol(cursor.row, 9999) // Move to end of line
      for (let i = 0; i < 5; i++) {
        currentMockInput.pressArrow("left", { shift: true })
      }

      expect(editor.getSelectedText()).toBe("World")
      expect(editor.plainText).toBe("Hello World")

      // Delete should delete the selected text
      currentMockInput.pressKey("DELETE")

      expect(editor.hasSelection()).toBe(false)
      expect(editor.plainText).toBe("Hello ")
      expect(editor.logicalCursor.col).toBe(6)
    })

    it("should delete multi-line selection with backspace", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
        selectable: true,
      })

      editor.focus()

      // Select from start to middle of line 2
      for (let i = 0; i < 10; i++) {
        currentMockInput.pressArrow("right", { shift: true })
      }

      const selectedText = editor.getSelectedText()
      // Note: The visual selection may show more due to how selection bounds are calculated
      // but the actual byte-based selection is what matters for deletion
      expect(editor.plainText).toBe("Line 1\nLine 2\nLine 3")

      // Backspace should delete the selection (bytes 0-8, which is "Line 1\nLi")
      currentMockInput.pressBackspace()

      expect(editor.hasSelection()).toBe(false)
      expect(editor.plainText).toBe("e 2\nLine 3")
      expect(editor.logicalCursor.col).toBe(0)
      expect(editor.logicalCursor.row).toBe(0)
    })

    it("should delete entire line when selected with delete", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
        selectable: true,
      })

      editor.focus()
      editor.gotoLine(1)

      // Select entire line 2 (from start to start of line 3)
      currentMockInput.pressArrow("down", { shift: true })

      const selectedText = editor.getSelectedText()
      expect(selectedText).toBe("Line 2")

      currentMockInput.pressKey("DELETE")

      expect(editor.hasSelection()).toBe(false)
      expect(editor.plainText).toBe("Line 1\nLine 3")
      expect(editor.logicalCursor.row).toBe(1)
    })

    it("should replace selected text when typing", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: true,
      })

      editor.focus()

      // Select "Hello"
      for (let i = 0; i < 5; i++) {
        currentMockInput.pressArrow("right", { shift: true })
      }

      expect(editor.getSelectedText()).toBe("Hello")

      // Type to replace selected text
      currentMockInput.pressKey("H")
      currentMockInput.pressKey("i")

      expect(editor.hasSelection()).toBe(false)
      expect(editor.plainText).toBe("Hi World")
    })

    it("should delete selected text via native deleteSelectedText API", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: true,
      })

      editor.focus()

      // Select "Hello" using mouse drag
      await currentMouse.drag(editor.x, editor.y, editor.x + 5, editor.y)
      await renderOnce()

      expect(editor.hasSelection()).toBe(true)
      expect(editor.getSelectedText()).toBe("Hello")

      // Delete using native API directly
      editor.editorView.deleteSelectedText()
      currentRenderer.clearSelection()
      await renderOnce()

      // Verify text is " World"
      expect(editor.plainText).toBe(" World")

      // Verify cursor is at start of deleted range
      expect(editor.logicalCursor.row).toBe(0)
      expect(editor.logicalCursor.col).toBe(0)

      // Verify selection is cleared in EditorView
      expect(editor.editorView.hasSelection()).toBe(false)
    })
  })
})
