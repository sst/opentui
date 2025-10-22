import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { TextBuffer } from "./text-buffer"
import { TextBufferView } from "./text-buffer-view"
import { StyledText, stringToStyledText } from "./lib/styled-text"
import { RGBA } from "./lib/RGBA"

describe("TextBufferView", () => {
  let buffer: TextBuffer
  let view: TextBufferView

  beforeEach(() => {
    buffer = TextBuffer.create("wcwidth")
    view = TextBufferView.create(buffer)
  })

  afterEach(() => {
    view.destroy()
    buffer.destroy()
  })

  describe("lineInfo getter with wrapping", () => {
    it("should return line info for empty buffer", () => {
      const emptyText = stringToStyledText("")
      buffer.setStyledText(emptyText)

      const lineInfo = view.lineInfo
      expect(lineInfo.lineStarts).toEqual([0])
      expect(lineInfo.lineWidths).toEqual([0])
    })

    it("should return single line info for simple text without newlines", () => {
      const styledText = stringToStyledText("Hello World")
      buffer.setStyledText(styledText)

      const lineInfo = view.lineInfo
      expect(lineInfo.lineStarts).toEqual([0])
      expect(lineInfo.lineWidths.length).toBe(1)
      expect(lineInfo.lineWidths[0]).toBeGreaterThan(0)
    })

    it("should handle single newline correctly", () => {
      const styledText = stringToStyledText("Hello\nWorld")
      buffer.setStyledText(styledText)

      const lineInfo = view.lineInfo
      // With newline-aware offsets: "Hello" (0-4) + newline (5) + "World" starts at 6
      expect(lineInfo.lineStarts).toEqual([0, 6])
      expect(lineInfo.lineWidths.length).toBe(2)
      expect(lineInfo.lineWidths[0]).toBeGreaterThan(0)
      expect(lineInfo.lineWidths[1]).toBeGreaterThan(0)
    })

    it("should return virtual line info when text wrapping is enabled", () => {
      const longText = "This is a very long text that should wrap when the text wrapping is enabled."
      const styledText = stringToStyledText(longText)
      buffer.setStyledText(styledText)

      const unwrappedInfo = view.lineInfo
      expect(unwrappedInfo.lineStarts).toEqual([0])
      expect(unwrappedInfo.lineWidths.length).toBe(1)
      expect(unwrappedInfo.lineWidths[0]).toBe(76)

      view.setWrapMode("char") // Enable wrapping
      view.setWrapWidth(20)

      const wrappedInfo = view.lineInfo

      expect(wrappedInfo.lineStarts.length).toBeGreaterThan(1)
      expect(wrappedInfo.lineWidths.length).toBeGreaterThan(1)

      for (const width of wrappedInfo.lineWidths) {
        expect(width).toBeLessThanOrEqual(20)
      }

      for (let i = 1; i < wrappedInfo.lineStarts.length; i++) {
        expect(wrappedInfo.lineStarts[i]).toBeGreaterThan(wrappedInfo.lineStarts[i - 1])
      }
    })

    it("should return correct lineInfo for word wrapping", () => {
      const text = "Hello world this is a test"
      const styledText = stringToStyledText(text)
      buffer.setStyledText(styledText)

      view.setWrapMode("word")
      view.setWrapWidth(12)

      const lineInfo = view.lineInfo

      expect(lineInfo.lineStarts.length).toBeGreaterThan(1)

      for (const width of lineInfo.lineWidths) {
        expect(width).toBeLessThanOrEqual(12)
      }
    })

    it("should return correct lineInfo for char wrapping", () => {
      const text = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
      const styledText = stringToStyledText(text)
      buffer.setStyledText(styledText)

      view.setWrapMode("char")
      view.setWrapWidth(10)

      const lineInfo = view.lineInfo

      expect(lineInfo.lineStarts).toEqual([0, 10, 20])
      expect(lineInfo.lineWidths).toEqual([10, 10, 6])
    })

    it("should update lineInfo when wrap width changes", () => {
      const text = "The quick brown fox jumps over the lazy dog"
      const styledText = stringToStyledText(text)
      buffer.setStyledText(styledText)

      view.setWrapMode("char") // Enable wrapping
      view.setWrapWidth(15)

      const lineInfo1 = view.lineInfo
      const lineCount1 = lineInfo1.lineStarts.length

      view.setWrapWidth(30)

      const lineInfo2 = view.lineInfo
      const lineCount2 = lineInfo2.lineStarts.length

      expect(lineCount2).toBeLessThan(lineCount1)
    })

    it("should return original lineInfo when wrap is disabled", () => {
      const text = "Line 1\nLine 2\nLine 3"
      const styledText = stringToStyledText(text)
      buffer.setStyledText(styledText)

      const originalInfo = view.lineInfo
      // With newline-aware offsets: Line 0 (0-5) + newline (6) + Line 1 (7-12) + newline (13) + Line 2 (14-19)
      expect(originalInfo.lineStarts).toEqual([0, 7, 14])

      view.setWrapMode("char") // Enable wrapping
      view.setWrapWidth(5)

      const wrappedInfo = view.lineInfo
      expect(wrappedInfo.lineStarts.length).toBeGreaterThan(3)

      view.setWrapMode("none") // Disable wrapping
      view.setWrapWidth(null)

      const unwrappedInfo = view.lineInfo
      expect(unwrappedInfo.lineStarts).toEqual([0, 7, 14])
    })
  })

  describe("getSelectedText", () => {
    it("should return empty string when no selection", () => {
      const styledText = stringToStyledText("Hello World")
      buffer.setStyledText(styledText)

      const selectedText = view.getSelectedText()
      expect(selectedText).toBe("")
    })

    it("should return selected text for simple selection", () => {
      const styledText = stringToStyledText("Hello World")
      buffer.setStyledText(styledText)

      view.setSelection(6, 11)
      const selectedText = view.getSelectedText()
      expect(selectedText).toBe("World")
    })

    it("should return selected text with newlines", () => {
      const styledText = stringToStyledText("Line 1\nLine 2\nLine 3")
      buffer.setStyledText(styledText)

      // Rope offsets: "Line 1" (0-5) + newline (6) + "Line 2" (7-12) + newline (13) + "Line 3" (14-19)
      // Selection [0, 9) = "Line 1" (0-5) + newline (6) + "Li" (7-8) = 9 chars
      view.setSelection(0, 9)
      const selectedText = view.getSelectedText()
      expect(selectedText).toBe("Line 1\nLi")
    })

    it("should handle Unicode characters in selection", () => {
      const styledText = stringToStyledText("Hello 世界 🌟")
      buffer.setStyledText(styledText)

      view.setSelection(6, 12)
      const selectedText = view.getSelectedText()
      expect(selectedText).toBe("世界 🌟")
    })

    it("should handle selection reset", () => {
      const styledText = stringToStyledText("Hello World")
      buffer.setStyledText(styledText)

      view.setSelection(6, 11)
      expect(view.getSelectedText()).toBe("World")

      view.resetSelection()
      expect(view.getSelectedText()).toBe("")
    })
  })

  describe("selection state", () => {
    it("should track selection state", () => {
      const styledText = stringToStyledText("Hello World")
      buffer.setStyledText(styledText)

      expect(view.hasSelection()).toBe(false)

      view.setSelection(0, 5)
      expect(view.hasSelection()).toBe(true)

      const selection = view.getSelection()
      expect(selection).toEqual({ start: 0, end: 5 })

      view.resetSelection()
      expect(view.hasSelection()).toBe(false)
    })
  })

  describe("getPlainText", () => {
    it("should return empty string for empty buffer", () => {
      const emptyText = stringToStyledText("")
      buffer.setStyledText(emptyText)

      const plainText = view.getPlainText()
      expect(plainText).toBe("")
    })

    it("should return plain text without styling", () => {
      const styledText = stringToStyledText("Hello World")
      buffer.setStyledText(styledText)

      const plainText = view.getPlainText()
      expect(plainText).toBe("Hello World")
    })

    it("should handle text with newlines", () => {
      const styledText = stringToStyledText("Line 1\nLine 2\nLine 3")
      buffer.setStyledText(styledText)

      const plainText = view.getPlainText()
      expect(plainText).toBe("Line 1\nLine 2\nLine 3")
    })
  })

  describe("wrapped view offset stability", () => {
    it("should maintain stable char offsets with ASCII wrapping", () => {
      const text = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
      const styledText = stringToStyledText(text)
      buffer.setStyledText(styledText)

      view.setWrapMode("char")
      view.setWrapWidth(10)

      const lineInfo = view.lineInfo
      // Offsets should be in display width units
      expect(lineInfo.lineStarts).toEqual([0, 10, 20])
      expect(lineInfo.lineWidths).toEqual([10, 10, 6])
    })

    it("should maintain stable char offsets with wide characters", () => {
      const text = "A世B界C" // A(1) 世(2) B(1) 界(2) C(1) = 7 total width
      const styledText = stringToStyledText(text)
      buffer.setStyledText(styledText)

      view.setWrapMode("char")
      view.setWrapWidth(4)

      const lineInfo = view.lineInfo
      // Should wrap at display width boundaries
      expect(lineInfo.lineStarts[0]).toBe(0)
      expect(lineInfo.lineStarts.length).toBeGreaterThan(1)

      // Each line should respect wrap width in display columns
      for (const width of lineInfo.lineWidths) {
        expect(width).toBeLessThanOrEqual(4)
      }
    })

    it("should maintain stable selection with wrapped wide characters", () => {
      const text = "世界世界世界" // 6 CJK characters = 12 display width
      const styledText = stringToStyledText(text)
      buffer.setStyledText(styledText)

      view.setWrapMode("char")
      view.setWrapWidth(6)

      // Select first 3 CJK characters (6 display width)
      view.setSelection(0, 6)
      const selected = view.getSelectedText()
      expect(selected).toBe("世界世")
    })

    it("should handle tabs correctly in wrapped view", () => {
      const text = "A\tB\tC"
      const styledText = stringToStyledText(text)
      buffer.setStyledText(styledText)

      view.setWrapMode("char")
      view.setWrapWidth(10)

      const lineInfo = view.lineInfo
      // Tabs expand to display width, offsets should account for this
      expect(lineInfo.lineStarts.length).toBeGreaterThanOrEqual(1)
    })

    it("should handle emoji in wrapped view", () => {
      const text = "🌟🌟🌟🌟🌟" // 5 emoji = 10 display width (assuming 2 each)
      const styledText = stringToStyledText(text)
      buffer.setStyledText(styledText)

      view.setWrapMode("char")
      view.setWrapWidth(6)

      const lineInfo = view.lineInfo
      expect(lineInfo.lineStarts.length).toBeGreaterThan(1)

      // Each wrapped line should respect display width limits
      for (const width of lineInfo.lineWidths) {
        expect(width).toBeLessThanOrEqual(6)
      }
    })

    it("should maintain selection across wrapped lines", () => {
      const text = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
      const styledText = stringToStyledText(text)
      buffer.setStyledText(styledText)

      view.setWrapMode("char")
      view.setWrapWidth(10)

      // Select across wrap boundary: chars 8-12 (IJK)
      view.setSelection(8, 13)
      const selected = view.getSelectedText()
      expect(selected).toBe("IJKLM")
    })
  })
})
