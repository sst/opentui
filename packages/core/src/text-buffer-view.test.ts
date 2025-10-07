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
      view.markDirty()

      const lineInfo = view.lineInfo
      expect(lineInfo.lineStarts).toEqual([0])
      expect(lineInfo.lineWidths).toEqual([0])
    })

    it("should return single line info for simple text without newlines", () => {
      const styledText = stringToStyledText("Hello World")
      buffer.setStyledText(styledText)
      view.markDirty()

      const lineInfo = view.lineInfo
      expect(lineInfo.lineStarts).toEqual([0])
      expect(lineInfo.lineWidths.length).toBe(1)
      expect(lineInfo.lineWidths[0]).toBeGreaterThan(0)
    })

    it("should handle single newline correctly", () => {
      const styledText = stringToStyledText("Hello\nWorld")
      buffer.setStyledText(styledText)
      view.markDirty()

      const lineInfo = view.lineInfo
      expect(lineInfo.lineStarts).toEqual([0, 5])
      expect(lineInfo.lineWidths.length).toBe(2)
      expect(lineInfo.lineWidths[0]).toBeGreaterThan(0)
      expect(lineInfo.lineWidths[1]).toBeGreaterThan(0)
    })

    it("should return virtual line info when text wrapping is enabled", () => {
      const longText = "This is a very long text that should wrap when the text wrapping is enabled."
      const styledText = stringToStyledText(longText)
      buffer.setStyledText(styledText)
      view.markDirty()

      const unwrappedInfo = view.lineInfo
      expect(unwrappedInfo.lineStarts).toEqual([0])
      expect(unwrappedInfo.lineWidths.length).toBe(1)
      expect(unwrappedInfo.lineWidths[0]).toBe(76)

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
      view.markDirty()

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
      view.markDirty()

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
      view.markDirty()

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
      view.markDirty()

      const originalInfo = view.lineInfo
      expect(originalInfo.lineStarts).toEqual([0, 6, 12])

      view.setWrapWidth(5)

      const wrappedInfo = view.lineInfo
      expect(wrappedInfo.lineStarts.length).toBeGreaterThan(3)

      view.setWrapWidth(null)

      const unwrappedInfo = view.lineInfo
      expect(unwrappedInfo.lineStarts).toEqual([0, 6, 12])
    })
  })

  describe("getSelectedText", () => {
    it("should return empty string when no selection", () => {
      const styledText = stringToStyledText("Hello World")
      buffer.setStyledText(styledText)
      view.markDirty()

      const selectedText = view.getSelectedText()
      expect(selectedText).toBe("")
    })

    it("should return selected text for simple selection", () => {
      const styledText = stringToStyledText("Hello World")
      buffer.setStyledText(styledText)
      view.markDirty()

      view.setSelection(6, 11)
      const selectedText = view.getSelectedText()
      expect(selectedText).toBe("World")
    })

    it("should return selected text with newlines", () => {
      const styledText = stringToStyledText("Line 1\nLine 2\nLine 3")
      buffer.setStyledText(styledText)
      view.markDirty()

      view.setSelection(0, 9)
      const selectedText = view.getSelectedText()
      expect(selectedText).toBe("Line 1\nLin")
    })

    it("should handle Unicode characters in selection", () => {
      const styledText = stringToStyledText("Hello 世界 🌟")
      buffer.setStyledText(styledText)
      view.markDirty()

      view.setSelection(6, 12)
      const selectedText = view.getSelectedText()
      expect(selectedText).toBe("世界 🌟")
    })

    it("should handle selection reset", () => {
      const styledText = stringToStyledText("Hello World")
      buffer.setStyledText(styledText)
      view.markDirty()

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
      view.markDirty()

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
      view.markDirty()

      const plainText = view.getPlainText()
      expect(plainText).toBe("")
    })

    it("should return plain text without styling", () => {
      const styledText = stringToStyledText("Hello World")
      buffer.setStyledText(styledText)
      view.markDirty()

      const plainText = view.getPlainText()
      expect(plainText).toBe("Hello World")
    })

    it("should handle text with newlines", () => {
      const styledText = stringToStyledText("Line 1\nLine 2\nLine 3")
      buffer.setStyledText(styledText)
      view.markDirty()

      const plainText = view.getPlainText()
      expect(plainText).toBe("Line 1\nLine 2\nLine 3")
    })
  })
})
