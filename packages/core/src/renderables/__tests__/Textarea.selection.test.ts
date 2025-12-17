import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer, type MockMouse, type MockInput } from "../../testing/test-renderer"
import { createTextareaRenderable } from "./renderable-test-utils"
import { RGBA } from "../../lib/RGBA"
import { OptimizedBuffer } from "../../buffer"
import { TextRenderable } from "../Text"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>
let currentMouse: MockMouse
let currentMockInput: MockInput

describe("Textarea - Selection Tests", () => {
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

    it("should handle shift+arrow selection with viewport scrolling - scrolled down", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: Array.from({ length: 20 }, (_, i) => `Line${i}`).join("\n"),
        width: 40,
        height: 5,
        selectable: true,
      })

      editor.focus()

      // Scroll to line 15 (near the end)
      editor.gotoLine(15)
      await renderOnce()

      const viewport = editor.editorView.getViewport()
      expect(viewport.offsetY).toBeGreaterThan(10) // Should be scrolled significantly

      // Now select 5 characters using shift+right
      for (let i = 0; i < 5; i++) {
        currentMockInput.pressArrow("right", { shift: true })
      }

      expect(editor.hasSelection()).toBe(true)
      const selectedText = editor.getSelectedText()

      // Should select "Line1" from Line15
      expect(selectedText).toBe("Line1")

      // Verify selection range
      const sel = editor.getSelection()
      expect(sel).not.toBe(null)
      expect(sel!.end - sel!.start).toBe(5)
    })

    it("should handle mouse drag selection with scrolled viewport - correct offset", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: Array.from({ length: 30 }, (_, i) => `AAAA${i}`).join("\n"),
        width: 40,
        height: 5,
        selectable: true,
      })

      // Scroll to line 20
      editor.gotoLine(20)
      await renderOnce()

      const viewport = editor.editorView.getViewport()
      expect(viewport.offsetY).toBeGreaterThan(15)

      // Mouse drag from (editor.x, editor.y) to (editor.x + 4, editor.y)
      // This should select the first 4 characters of the FIRST VISIBLE LINE in the viewport
      await currentMouse.drag(editor.x, editor.y, editor.x + 4, editor.y)
      await renderOnce()

      expect(editor.hasSelection()).toBe(true)
      const selectedText = editor.getSelectedText()

      // Should select "AAAA" from the line at viewport.offsetY (which should be around line 18-20)
      // NOT from line 0
      expect(selectedText).not.toContain("AAAA0")
      expect(selectedText).not.toContain("AAAA1")

      // Should be the first 4 chars of the line visible at the top of the viewport
      const firstVisibleLineIdx = viewport.offsetY
      const expectedText = `AAAA${firstVisibleLineIdx}`.substring(0, 4)
      expect(selectedText).toBe(expectedText)
    })

    it("should handle multi-line mouse drag with scrolled viewport", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: Array.from({ length: 30 }, (_, i) => `Line${i}`).join("\n"),
        width: 40,
        height: 5,
        selectable: true,
      })

      // Scroll to line 12
      editor.gotoLine(12)
      await renderOnce()

      const viewport = editor.editorView.getViewport()
      expect(viewport.offsetY).toBeGreaterThan(7)

      // Drag from (editor.x, editor.y) to (editor.x + 5, editor.y + 2)
      // Should select viewport-local rows 0-2 (which are absolute rows viewport.offsetY to viewport.offsetY+2)
      await currentMouse.drag(editor.x, editor.y, editor.x + 5, editor.y + 2)
      await renderOnce()

      expect(editor.hasSelection()).toBe(true)
      const selectedText = editor.getSelectedText()

      // Should NOT start with Line0, Line1, Line2 (those are way above the viewport)
      expect(selectedText.startsWith("Line0")).toBe(false)
      expect(selectedText.startsWith("Line1")).toBe(false)
      expect(selectedText.startsWith("Line2")).toBe(false)

      // Should contain lines starting from viewport.offsetY
      const line1 = `Line${viewport.offsetY}`
      const line2 = `Line${viewport.offsetY + 1}`
      const line3 = `Line${viewport.offsetY + 2}`

      expect(selectedText).toContain(line1)
      expect(selectedText).toContain(line2)
      expect(selectedText).toContain(line3.substring(0, 5))
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
        initialValue: "Hello World!",
        width: 40,
        height: 10,
        selectable: true,
      })

      editor.focus()

      const cursor = editor.logicalCursor
      editor.editBuffer.setCursorToLineCol(cursor.row, 9999)
      for (let i = 0; i < 6; i++) {
        currentMockInput.pressArrow("left", { shift: true })
      }

      expect(editor.getSelectedText()).toBe("World!")
      expect(editor.plainText).toBe("Hello World!")

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
    it("should maintain correct selection start when scrolling down with shift+down", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: Array.from({ length: 20 }, (_, i) => `Line ${i}`).join("\n"),
        width: 20,
        height: 5,
        selectable: true,
      })

      editor.focus()

      // Select down 8 times. Since height is 5, this should scroll.
      for (let i = 0; i < 8; i++) {
        currentMockInput.pressArrow("down", { shift: true })
        await renderOnce()
      }

      const viewport = editor.editorView.getViewport()
      expect(viewport.offsetY).toBeGreaterThan(0)

      const sel = editor.getSelection()
      expect(sel).not.toBe(null)
      // Should start at 0 (Line 0)
      expect(sel!.start).toBe(0)
    })

    it("BUG REPRO: should NOT start selection in textarea when clicking in text renderable below after scrolling", async () => {
      // Create a textarea with many lines, scrolled down
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: Array.from({ length: 20 }, (_, i) => `Textarea Line ${i}`).join("\n"),
        width: 40,
        height: 5,
        selectable: true,
        top: 0,
      })

      // Create a TextRenderable below the textarea
      const textBelow = new TextRenderable(currentRenderer, {
        id: "text-below",
        content: "This is text below the textarea",
        selectable: true,
        top: 5, // Position it right below the textarea (textarea has height 5)
        left: 0,
        width: 40,
        height: 1,
      })
      currentRenderer.root.add(textBelow)

      editor.focus()

      // Scroll the textarea down to the end
      editor.gotoBufferEnd()
      await renderOnce()

      const viewport = editor.editorView.getViewport()
      expect(viewport.offsetY).toBeGreaterThan(10) // Should be scrolled significantly

      // Start selection in the TextRenderable below
      await currentMouse.drag(textBelow.x, textBelow.y, textBelow.x + 10, textBelow.y)
      await renderOnce()

      // EXPECTED: textarea should NOT have selection
      expect(editor.hasSelection()).toBe(false)
      expect(editor.getSelectedText()).toBe("")

      // EXPECTED: textBelow should have selection
      expect(textBelow.hasSelection()).toBe(true)
      expect(textBelow.getSelectedText()).toBe("This is te")

      textBelow.destroy()
    })

    it("should maintain selection in text-below when dragging up into textarea", async () => {
      // Create a textarea with many lines, scrolled down
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: Array.from({ length: 20 }, (_, i) => `Textarea Line ${i}`).join("\n"),
        width: 40,
        height: 5,
        selectable: true,
        top: 0,
      })

      // Create a TextRenderable below the textarea
      const textBelow = new TextRenderable(currentRenderer, {
        id: "text-below",
        content: "This is text below the textarea",
        selectable: true,
        top: 5, // Position it right below the textarea (textarea has height 5)
        left: 0,
        width: 40,
        height: 1,
      })
      currentRenderer.root.add(textBelow)

      editor.focus()

      // Scroll the textarea down to the end
      editor.gotoBufferEnd()
      await renderOnce()

      const viewport = editor.editorView.getViewport()
      expect(viewport.offsetY).toBeGreaterThan(10)

      // Start selection in text-below and drag UP into the textarea
      const startX = textBelow.x + 5
      const startY = textBelow.y // Y=5 (in text-below, which is positioned at Y=5 with height 1, so it occupies Y=5)
      const endX = editor.x + 15
      const endY = editor.y + 3 // Y=3 (in textarea)

      await currentMouse.drag(startX, startY, endX, endY)
      await renderOnce()

      // EXPECTED: Both should have selection since the selection spans both renderables
      // The selection was anchored in text-below at (5, 5) and dragged to (15, 3) in textarea
      // So the selection region spans from Y=3 to Y=5, covering both renderables

      // Text-below should have selection from the anchor point to its top edge
      expect(textBelow.hasSelection()).toBe(true)
      const textBelowSelection = textBelow.getSelectedText()
      expect(textBelowSelection.length).toBeGreaterThan(0)

      // Textarea should have selection from Y=3 to its bottom edge (Y=5)
      expect(editor.hasSelection()).toBe(true)
      const textareaSelection = editor.getSelectedText()
      expect(textareaSelection.length).toBeGreaterThan(0)

      textBelow.destroy()
    })

    it("BUG: should handle cross-renderable selection from bottom-left text to top-right text correctly", async () => {
      const { BoxRenderable } = await import("../Box")

      // Recreate a simplified version of text-selection-demo.ts layout
      // Bottom text on the left, code box with multiple texts on the right

      // Create bottom-left text (like "Click and drag..." in the demo)
      const bottomText = new TextRenderable(currentRenderer, {
        id: "bottom-instructions",
        content: "Click and drag to select text across any elements",
        left: 5,
        top: 20,
        width: 50,
        height: 1,
        selectable: true,
      })
      currentRenderer.root.add(bottomText)

      // Create a box on the right side (like "Code Example" box)
      const rightBox = new BoxRenderable(currentRenderer, {
        id: "right-box",
        left: 50,
        top: 5,
        width: 30,
        height: 10,
        padding: 1,
        flexDirection: "column",
      })
      currentRenderer.root.add(rightBox)

      // Add multiple text renderables inside the right box (like code lines)
      const codeText1 = new TextRenderable(currentRenderer, {
        id: "code-line-1",
        content: "function handleSelection() {",
        selectable: true,
      })
      rightBox.add(codeText1)

      const codeText2 = new TextRenderable(currentRenderer, {
        id: "code-line-2",
        content: "  const selected = getText()",
        selectable: true,
      })
      rightBox.add(codeText2)

      const codeText3 = new TextRenderable(currentRenderer, {
        id: "code-line-3",
        content: "  console.log(selected)",
        selectable: true,
      })
      rightBox.add(codeText3)

      const codeText4 = new TextRenderable(currentRenderer, {
        id: "code-line-4",
        content: "}",
        selectable: true,
      })
      rightBox.add(codeText4)

      await renderOnce()

      console.log(`Layout after render:`)
      console.log(`  bottomText: (${bottomText.x}, ${bottomText.y}, ${bottomText.width}, ${bottomText.height})`)
      console.log(`  rightBox: (${rightBox.x}, ${rightBox.y}, ${rightBox.width}, ${rightBox.height})`)
      console.log(`  codeText1: (${codeText1.x}, ${codeText1.y}, ${codeText1.width}, ${codeText1.height})`)
      console.log(`  codeText2: (${codeText2.x}, ${codeText2.y}, ${codeText2.width}, ${codeText2.height})`)
      console.log(`  codeText3: (${codeText3.x}, ${codeText3.y}, ${codeText3.width}, ${codeText3.height})`)
      console.log(`  codeText4: (${codeText4.x}, ${codeText4.y}, ${codeText4.width}, ${codeText4.height})`)

      // Start selection at the beginning of bottom text "Click and drag..."
      // Drag up and to the right into the code box, ending in the middle of codeText2
      const startX = bottomText.x + 10 // "Click and "
      const startY = bottomText.y // Y=20
      const endX = codeText2.x + 15 // Middle of codeText2
      const endY = codeText2.y // Should be around Y=7 (inside rightBox)

      console.log(`Selection drag: from (${startX}, ${startY}) to (${endX}, ${endY})`)

      await currentMouse.drag(startX, startY, endX, endY)
      await renderOnce()

      console.log(`After selection:`)
      console.log(`  bottomText has selection: ${bottomText.hasSelection()}`)
      if (bottomText.hasSelection()) {
        console.log(`    bottomText selected: "${bottomText.getSelectedText()}"`)
      }
      console.log(`  codeText1 has selection: ${codeText1.hasSelection()}`)
      if (codeText1.hasSelection()) {
        console.log(`    codeText1 selected: "${codeText1.getSelectedText()}"`)
      }
      console.log(`  codeText2 has selection: ${codeText2.hasSelection()}`)
      if (codeText2.hasSelection()) {
        console.log(`    codeText2 selected: "${codeText2.getSelectedText()}"`)
        console.log(`    codeText2 selection range: ${JSON.stringify(codeText2.getSelection())}`)
      }
      console.log(`  codeText3 has selection: ${codeText3.hasSelection()}`)
      console.log(`  codeText4 has selection: ${codeText4.hasSelection()}`)

      // Let's analyze what actually got selected and if it makes sense

      // 1. bottomText: Started at X=15 ("Click and [d]rag..."), dragged up
      //    Should select from anchor (X=15) backwards to the start
      expect(bottomText.hasSelection()).toBe(true)
      const bottomSelected = bottomText.getSelectedText()
      console.log(`  bottomText selected "${bottomSelected}" - checking if this makes sense...`)
      // The global selection anchor is at (15, 20), so local to bottomText at (15-5=10, 20-20=0)
      // Focus is at (66, 8), so local to bottomText at (66-5=61, 8-20=-12)
      // Since focus.y < 0, the selection should go from anchor backwards
      // Expected: chars 0-10 of "Click and drag..." = "Click and "
      expect(bottomSelected).toBe("Click and ")

      // 2. codeText1 at Y=7 is ABOVE the selection bounds (Y=8-21), so it should NOT be selected
      expect(codeText1.hasSelection()).toBe(false)

      // 3. codeText2 at Y=8: This is where it gets interesting
      //    Global anchor: (15, 20), Global focus: (66, 8)
      //    Local to codeText2 (at position 51, 8):
      //      anchor: (15-51=-36, 20-8=12)
      //      focus: (66-51=15, 8-8=0)
      //
      //    Since anchor.x=-36 (LEFT of renderable), it gets clamped to position 0
      //    Since focus.x=15, focus.y=0 (inside), it maps to character position 15
      //    So the selection is from 0 to 15
      //
      //    Content: "  const selected = getText()" (29 chars)
      //    Expected: chars 0-15 = "  const selecte"

      expect(codeText2.hasSelection()).toBe(true)
      const codeText2Selected = codeText2.getSelectedText()
      console.log(`  codeText2 selected: "${codeText2Selected}"`)
      const codeText2FullContent = codeText2.content.toString()
      console.log(`  codeText2 full content: "${codeText2FullContent}"`)
      console.log(`  codeText2 content length: ${codeText2FullContent.length}`)
      console.log(`  codeText2 local anchor: (${15 - codeText2.x}, ${20 - codeText2.y})`)
      console.log(`  codeText2 local focus: (${66 - codeText2.x}, ${8 - codeText2.y})`)
      console.log(`  Since anchor.x < 0, anchor maps to position 0`)
      console.log(`  Since focus is inside at (15, 0), focus maps to position 15`)
      console.log(`  Expected selection: indices 0 to 15`)
      console.log(`  Actual selection: indices ${codeText2.getSelection()?.start} to ${codeText2.getSelection()?.end}`)

      // The selection correctly goes from start (0) to position 15
      const codeText2Content = "  const selected = getText()"
      expect(codeText2Selected).toBe(codeText2Content.substring(0, 15))

      // 4. codeText3 and codeText4 are at Y=9 and Y=10, within selection bounds Y=8-21
      //    So they should have some selection too!
      //    But the focus point Y=8 is above them, so they might not be included depending on bounds
      console.log(`  codeText3 has selection: ${codeText3.hasSelection()}`)
      console.log(`  codeText4 has selection: ${codeText4.hasSelection()}`)

      bottomText.destroy()
      rightBox.destroy()
    })
  })
})
