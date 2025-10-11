import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { EditBuffer } from "./edit-buffer"
import { EditorView } from "./editor-view"
import { RGBA } from "./lib/RGBA"

describe("EditorView", () => {
  let buffer: EditBuffer
  let view: EditorView

  beforeEach(() => {
    buffer = EditBuffer.create("wcwidth")
    view = EditorView.create(buffer, 40, 10)
  })

  afterEach(() => {
    view.destroy()
    buffer.destroy()
  })

  describe("initialization", () => {
    it("should create view with specified viewport dimensions", () => {
      const viewport = view.getViewport()
      expect(viewport.width).toBe(40)
      expect(viewport.height).toBe(10)
      expect(viewport.offsetY).toBe(0)
      expect(viewport.offsetX).toBe(0)
    })

    it("should start with wrapping disabled", () => {
      expect(view.isWrappingEnabled()).toBe(false)
    })
  })

  describe("viewport management", () => {
    it("should update viewport size", () => {
      view.setViewportSize(80, 20)
      const viewport = view.getViewport()
      expect(viewport.width).toBe(80)
      expect(viewport.height).toBe(20)
    })

    it("should set scroll margin", () => {
      // Should not throw
      view.setScrollMargin(0.2)
      expect(true).toBe(true)
    })

    it("should return correct virtual line count for simple text", () => {
      buffer.setText("Line 1\nLine 2\nLine 3")
      expect(view.getVirtualLineCount()).toBe(3)
    })
  })

  describe("text wrapping", () => {
    it("should enable and disable wrapping", () => {
      // Create text that will wrap at narrow viewport
      buffer.setText("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRST")

      // Initially no wrapping
      expect(view.isWrappingEnabled()).toBe(false)
      expect(view.getVirtualLineCount()).toBe(1)

      // Enable wrapping (viewport is 40 columns)
      view.enableWrapping(true)
      expect(view.isWrappingEnabled()).toBe(true)
      expect(view.getVirtualLineCount()).toBeGreaterThan(1) // Should wrap to multiple lines

      // Disable wrapping
      view.enableWrapping(false)
      expect(view.isWrappingEnabled()).toBe(false)
      expect(view.getVirtualLineCount()).toBe(1)
    })

    it("should wrap at viewport width", () => {
      buffer.setText("ABCDEFGHIJKLMNOPQRST") // 20 chars

      view.enableWrapping(true)
      view.setViewportSize(10, 10) // 10 columns wide

      // Should wrap to 2 lines at 10 columns
      expect(view.getVirtualLineCount()).toBe(2)

      // Resize to 5 columns
      view.setViewportSize(5, 10)
      expect(view.getVirtualLineCount()).toBe(4)

      // Resize to 20 columns
      view.setViewportSize(20, 10)
      expect(view.getVirtualLineCount()).toBe(1)
    })

    it("should change wrap mode", () => {
      buffer.setText("Hello wonderful world")

      view.enableWrapping(true)
      view.setViewportSize(10, 10)

      // Test char mode
      view.setWrapMode("char")
      const charCount = view.getVirtualLineCount()
      expect(charCount).toBeGreaterThanOrEqual(2)

      // Test word mode
      view.setWrapMode("word")
      const wordCount = view.getVirtualLineCount()
      expect(wordCount).toBeGreaterThanOrEqual(2)
    })

    it("should preserve newlines when wrapping", () => {
      buffer.setText("Short\nAnother short line\nLast")

      view.enableWrapping(true)
      view.setViewportSize(50, 10)

      // Should still have 3 virtual lines (original newlines preserved)
      expect(view.getVirtualLineCount()).toBe(3)
    })

    it("should wrap long lines with enabled wrapping", () => {
      const longLine = "This is a very long line that will definitely wrap when the viewport is narrow"
      buffer.setText(longLine)

      view.enableWrapping(true)
      view.setViewportSize(20, 10)

      const vlineCount = view.getVirtualLineCount()
      expect(vlineCount).toBeGreaterThan(1)
    })
  })

  describe("integration with EditBuffer", () => {
    it("should reflect edits made to EditBuffer", () => {
      buffer.setText("Line 1\nLine 2\nLine 3")
      expect(view.getVirtualLineCount()).toBe(3)

      buffer.moveCursorToBufferEnd()
      buffer.newLine()
      buffer.insertText("Line 4")

      expect(view.getVirtualLineCount()).toBe(4)
    })

    it("should update after text deletion", () => {
      buffer.setText("Line 1\nLine 2\nLine 3")
      expect(view.getVirtualLineCount()).toBe(3)

      buffer.gotoLine(1)
      buffer.deleteLine()

      expect(view.getVirtualLineCount()).toBe(2)
    })

    it("should update after line join", () => {
      buffer.setText("Hello\nWorld")
      expect(view.getVirtualLineCount()).toBe(2)

      buffer.joinLines()

      expect(view.getVirtualLineCount()).toBe(1)
      expect(buffer.getText()).toBe("HelloWorld")
    })
  })

  describe("viewport with wrapping and editing", () => {
    it("should maintain wrapping after edits", () => {
      buffer.setText("Short line")

      view.enableWrapping(true)
      view.setViewportSize(20, 10)

      expect(view.getVirtualLineCount()).toBe(1)

      buffer.moveCursorToBufferEnd()
      buffer.insertText(" that becomes very long and should wrap now")

      expect(view.getVirtualLineCount()).toBeGreaterThan(1)
    })

    it("should handle viewport resize with wrapped content", () => {
      const longText = "This is a very long line that will wrap when the viewport is narrow"
      buffer.setText(longText)

      view.enableWrapping(true)
      view.setViewportSize(20, 10)

      const count20 = view.getVirtualLineCount()
      expect(count20).toBeGreaterThan(1)

      view.setViewportSize(40, 10)
      const count40 = view.getVirtualLineCount()
      expect(count40).toBeLessThan(count20)
    })
  })

  describe("selection", () => {
    it("should set and reset selection", () => {
      buffer.setText("Hello World")

      // Set selection
      view.setSelection(0, 5)
      // Can't directly check selection, but should not throw
      expect(true).toBe(true)

      // Reset selection
      view.resetSelection()
      expect(true).toBe(true)
    })

    it("should set selection with colors", () => {
      buffer.setText("Hello World")

      const bgColor = RGBA.fromValues(0, 0, 1, 0.3)
      const fgColor = RGBA.fromValues(1, 1, 1, 1)

      view.setSelection(0, 5, bgColor, fgColor)
      expect(true).toBe(true)
    })
  })

  describe("large content", () => {
    it("should handle many lines", () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}`).join("\n")
      buffer.setText(lines)

      expect(view.getVirtualLineCount()).toBe(100)
    })

    it("should handle very long single line with wrapping", () => {
      const longLine = "A".repeat(1000)
      buffer.setText(longLine)

      view.enableWrapping(true)
      view.setViewportSize(80, 24)

      const vlineCount = view.getVirtualLineCount()
      expect(vlineCount).toBeGreaterThan(10)
    })
  })

  describe("viewport slicing", () => {
    it("should show subset of content in viewport", () => {
      const lines = Array.from({ length: 20 }, (_, i) => `Line ${i}`).join("\n")
      buffer.setText(lines)

      // Create view with viewport showing 5 lines
      const smallView = EditorView.create(buffer, 40, 5)

      expect(smallView.getVirtualLineCount()).toBe(20) // Total line count

      smallView.destroy()
    })
  })

  describe("error handling", () => {
    it("should throw error when using destroyed view", () => {
      view.destroy()

      expect(() => view.getVirtualLineCount()).toThrow("EditorView is destroyed")
      expect(() => view.setViewportSize(80, 24)).toThrow("EditorView is destroyed")
      expect(() => view.enableWrapping(true)).toThrow("EditorView is destroyed")
    })
  })

  describe("Unicode edge cases", () => {
    it("should handle emoji with wrapping", () => {
      buffer.setText("🌟".repeat(20))

      view.enableWrapping(true)
      view.setViewportSize(10, 10)

      // Each emoji takes 2 cells, so 10 emojis = 20 cells, should wrap
      expect(view.getVirtualLineCount()).toBeGreaterThan(1)
    })

    it("should handle CJK characters with wrapping", () => {
      buffer.setText("测试文字处理功能")

      view.enableWrapping(true)
      view.setViewportSize(10, 10)

      // CJK chars are 2 cells each
      const vlineCount = view.getVirtualLineCount()
      expect(vlineCount).toBeGreaterThanOrEqual(1)
    })

    it("should handle mixed ASCII and wide characters", () => {
      buffer.setText("AB测试CD文字EF")

      view.enableWrapping(true)
      view.setViewportSize(8, 10)

      expect(view.getVirtualLineCount()).toBeGreaterThanOrEqual(1)
    })
  })
})
