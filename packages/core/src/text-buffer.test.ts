import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { TextBuffer } from "./text-buffer"
import { StyledText, stringToStyledText } from "./lib/styled-text"
import { RGBA } from "./lib/RGBA"

describe("TextBuffer", () => {
  let buffer: TextBuffer

  beforeEach(() => {
    buffer = TextBuffer.create("wcwidth")
  })

  afterEach(() => {
    buffer.destroy()
  })

  describe("setText and setStyledText", () => {
    it("should set text content", () => {
      const text = "Hello World"
      buffer.setText(text)

      expect(buffer.length).toBe(11)
      expect(buffer.byteSize).toBeGreaterThan(0)
    })

    it("should set styled text", () => {
      const styledText = stringToStyledText("Hello World")
      buffer.setStyledText(styledText)

      expect(buffer.length).toBe(11)
    })

    it("should handle empty text", () => {
      const emptyText = stringToStyledText("")
      buffer.setStyledText(emptyText)

      expect(buffer.length).toBe(0)
    })

    it("should handle text with newlines", () => {
      const text = "Line 1\nLine 2\nLine 3"
      buffer.setText(text)

      expect(buffer.length).toBe(18) // 6 + 6 + 6 chars (newlines not counted)
    })
  })

  describe("getPlainText", () => {
    it("should return empty string for empty buffer", () => {
      const emptyText = stringToStyledText("")
      buffer.setStyledText(emptyText)

      const plainText = buffer.getPlainText()
      expect(plainText).toBe("")
    })

    it("should return plain text without styling", () => {
      const styledText = stringToStyledText("Hello World")
      buffer.setStyledText(styledText)

      const plainText = buffer.getPlainText()
      expect(plainText).toBe("Hello World")
    })

    it("should handle text with newlines", () => {
      const styledText = stringToStyledText("Line 1\nLine 2\nLine 3")
      buffer.setStyledText(styledText)

      const plainText = buffer.getPlainText()
      expect(plainText).toBe("Line 1\nLine 2\nLine 3")
    })

    it("should handle Unicode characters correctly", () => {
      const styledText = stringToStyledText("Hello 世界 🌟")
      buffer.setStyledText(styledText)

      const plainText = buffer.getPlainText()
      expect(plainText).toBe("Hello 世界 🌟")
    })

    it("should handle styled text with colors and attributes", () => {
      const redChunk = {
        __isChunk: true as const,
        text: "Red",
        fg: RGBA.fromValues(1, 0, 0, 1),
      }
      const newlineChunk = {
        __isChunk: true as const,
        text: "\n",
      }
      const blueChunk = {
        __isChunk: true as const,
        text: "Blue",
        fg: RGBA.fromValues(0, 0, 1, 1),
      }

      const styledText = new StyledText([redChunk, newlineChunk, blueChunk])
      buffer.setStyledText(styledText)

      const plainText = buffer.getPlainText()
      expect(plainText).toBe("Red\nBlue")
    })
  })

  describe("length property", () => {
    it("should return correct length for simple text", () => {
      const styledText = stringToStyledText("Hello World")
      buffer.setStyledText(styledText)

      expect(buffer.length).toBe(11)
    })

    it("should return 0 for empty buffer", () => {
      const emptyText = stringToStyledText("")
      buffer.setStyledText(emptyText)

      expect(buffer.length).toBe(0)
    })

    it("should handle text with newlines correctly", () => {
      const styledText = stringToStyledText("Line 1\nLine 2\nLine 3")
      buffer.setStyledText(styledText)

      expect(buffer.length).toBe(18) // 6 + 6 + 6 chars (newlines not counted)
    })

    it("should handle Unicode characters correctly", () => {
      const styledText = stringToStyledText("Hello 世界 🌟")
      buffer.setStyledText(styledText)

      expect(buffer.length).toBe(13)
    })
  })

  describe("default styles", () => {
    it("should set and reset default foreground color", () => {
      const fg = RGBA.fromValues(1, 0, 0, 1)
      buffer.setDefaultFg(fg)
      buffer.resetDefaults()

      // No error should be thrown
      expect(true).toBe(true)
    })

    it("should set and reset default background color", () => {
      const bg = RGBA.fromValues(0, 0, 1, 1)
      buffer.setDefaultBg(bg)
      buffer.resetDefaults()

      // No error should be thrown
      expect(true).toBe(true)
    })

    it("should set and reset default attributes", () => {
      buffer.setDefaultAttributes(1)
      buffer.resetDefaults()

      // No error should be thrown
      expect(true).toBe(true)
    })
  })

  describe("clear() vs reset()", () => {
    it("clear() should empty buffer but preserve text across setText calls", () => {
      // Set initial text
      buffer.setText("First text")
      expect(buffer.length).toBe(10)

      // Set new text (which calls clear() internally)
      buffer.setText("Second text")
      expect(buffer.length).toBe(11)
      expect(buffer.getPlainText()).toBe("Second text")

      // Explicit clear
      buffer.clear()
      expect(buffer.length).toBe(0)
      expect(buffer.getPlainText()).toBe("")
    })

    it("reset() should fully reset the buffer", () => {
      buffer.setText("Some text")
      expect(buffer.length).toBe(9)

      buffer.reset()
      expect(buffer.length).toBe(0)
      expect(buffer.getPlainText()).toBe("")

      // Should be able to use buffer after reset
      buffer.setText("New text")
      expect(buffer.length).toBe(8)
    })

    it("setText should preserve highlights (use clear() not reset())", () => {
      // This test verifies that setText now uses clear() internally
      // and doesn't clear highlights
      buffer.setText("Hello World")

      // Note: We can't easily test highlight preservation from TypeScript
      // without a SyntaxStyle, but we verify the buffer still works
      expect(buffer.length).toBe(11)

      buffer.setText("New Text")
      expect(buffer.length).toBe(8)
      expect(buffer.getPlainText()).toBe("New Text")
    })

    it("setStyledText should preserve content across calls", () => {
      const firstText = stringToStyledText("First")
      buffer.setStyledText(firstText)
      expect(buffer.length).toBe(5)

      const secondText = stringToStyledText("Second")
      buffer.setStyledText(secondText)
      expect(buffer.length).toBe(6)
      expect(buffer.getPlainText()).toBe("Second")
    })

    it("multiple setText calls should work correctly with clear()", () => {
      buffer.setText("Text 1")
      expect(buffer.length).toBe(6)

      buffer.setText("Text 2")
      expect(buffer.length).toBe(6)

      buffer.setText("Text 3")
      expect(buffer.length).toBe(6)

      expect(buffer.getPlainText()).toBe("Text 3")
    })

    it("clear() followed by setText should work", () => {
      buffer.setText("Initial")
      expect(buffer.length).toBe(7)

      buffer.clear()
      expect(buffer.length).toBe(0)

      buffer.setText("After clear")
      expect(buffer.length).toBe(11)
      expect(buffer.getPlainText()).toBe("After clear")
    })

    it("reset() followed by setText should work", () => {
      buffer.setText("Initial")
      expect(buffer.length).toBe(7)

      buffer.reset()
      expect(buffer.length).toBe(0)

      buffer.setText("After reset")
      expect(buffer.length).toBe(11)
      expect(buffer.getPlainText()).toBe("After reset")
    })
  })
})
