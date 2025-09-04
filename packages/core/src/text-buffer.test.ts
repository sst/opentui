import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { TextBuffer } from "./text-buffer"
import { StyledText, stringToStyledText } from "./lib/styled-text"
import { RGBA } from "./lib/RGBA"

describe("TextBuffer", () => {
  let buffer: TextBuffer

  beforeEach(() => {
    buffer = TextBuffer.create(256, "wcwidth")
  })

  afterEach(() => {
    buffer.destroy()
  })

  describe("lineInfo getter", () => {
    it("should return line info for empty buffer", () => {
      // Set empty content first
      const emptyText = stringToStyledText("")
      buffer.setStyledText(emptyText)

      const lineInfo = buffer.lineInfo
      expect(lineInfo.lineStarts).toEqual([0]) // Always starts with line 0
      expect(lineInfo.lineWidths).toEqual([0]) // Empty line has width 0
    })

    it("should return single line info for simple text without newlines", () => {
      const styledText = stringToStyledText("Hello World")
      buffer.setStyledText(styledText)

      const lineInfo = buffer.lineInfo
      expect(lineInfo.lineStarts).toEqual([0])
      expect(lineInfo.lineWidths).toBeArray()
      expect(lineInfo.lineWidths.length).toBe(1)
      expect(lineInfo.lineWidths[0]).toBeGreaterThan(0) // Width should be > 0 for non-empty text
    })

    it("should handle single newline correctly", () => {
      const styledText = stringToStyledText("Hello\nWorld")
      buffer.setStyledText(styledText)

      const lineInfo = buffer.lineInfo
      expect(lineInfo.lineStarts).toEqual([0, 6]) // "Hello\n" is 6 chars
      expect(lineInfo.lineWidths.length).toBe(2)
      expect(lineInfo.lineWidths[0]).toBeGreaterThan(0) // First line has content
      expect(lineInfo.lineWidths[1]).toBeGreaterThan(0) // Second line has content
    })

    it("should handle multiple lines separated by newlines", () => {
      const styledText = stringToStyledText("Line 1\nLine 2\nLine 3")
      buffer.setStyledText(styledText)

      const lineInfo = buffer.lineInfo
      expect(lineInfo.lineStarts).toEqual([0, 7, 14]) // Positions: 0, "Line 1\n"=7, "Line 1\nLine 2\n"=14
      expect(lineInfo.lineWidths.length).toBe(3)
      lineInfo.lineWidths.forEach((width) => {
        expect(width).toBeGreaterThan(0)
      })
    })

    it("should handle text ending with newline", () => {
      const styledText = stringToStyledText("Hello World\n")
      buffer.setStyledText(styledText)

      const lineInfo = buffer.lineInfo
      expect(lineInfo.lineStarts).toEqual([0, 12]) // "Hello World\n" is 12 chars
      expect(lineInfo.lineWidths.length).toBe(2)
      expect(lineInfo.lineWidths[0]).toBeGreaterThan(0) // First line has content
      // Second line (empty) may have width 0 or some default width
    })

    it("should handle consecutive newlines", () => {
      const styledText = stringToStyledText("Line 1\n\nLine 3")
      buffer.setStyledText(styledText)

      const lineInfo = buffer.lineInfo
      expect(lineInfo.lineStarts).toEqual([0, 7, 8]) // 0, "Line 1\n"=7, "Line 1\n\n"=8
      expect(lineInfo.lineWidths.length).toBe(3)
    })

    it("should handle text starting with newline", () => {
      const styledText = stringToStyledText("\nHello World")
      buffer.setStyledText(styledText)

      const lineInfo = buffer.lineInfo
      expect(lineInfo.lineStarts).toEqual([0, 1]) // Empty first line, then content
      expect(lineInfo.lineWidths.length).toBe(2)
    })

    it("should handle only newlines", () => {
      const styledText = stringToStyledText("\n\n\n")
      buffer.setStyledText(styledText)

      const lineInfo = buffer.lineInfo
      expect(lineInfo.lineStarts).toEqual([0, 1, 2, 3])
      expect(lineInfo.lineWidths.length).toBe(4)
    })

    it("should cache lineInfo result and return same reference", () => {
      const styledText = stringToStyledText("Test\nText")
      buffer.setStyledText(styledText)

      const lineInfo1 = buffer.lineInfo
      const lineInfo2 = buffer.lineInfo

      // Should be the same reference (cached)
      expect(lineInfo1).toBe(lineInfo2)
      expect(lineInfo1.lineStarts).toEqual(lineInfo2.lineStarts)
      expect(lineInfo1.lineWidths).toEqual(lineInfo2.lineWidths)
    })

    it("should reset cache when setting new styled text", () => {
      // Set initial text
      const styledText1 = stringToStyledText("Initial")
      buffer.setStyledText(styledText1)
      const lineInfo1 = buffer.lineInfo

      // Set different text
      const styledText2 = stringToStyledText("Different\nText")
      buffer.setStyledText(styledText2)
      const lineInfo2 = buffer.lineInfo

      // Should be different results
      expect(lineInfo1.lineStarts).not.toEqual(lineInfo2.lineStarts)
      expect(lineInfo1.lineWidths).not.toEqual(lineInfo2.lineWidths)
    })

    it("should handle wide characters (Unicode)", () => {
      const styledText = stringToStyledText("Hello 世界 🌟")
      buffer.setStyledText(styledText)

      const lineInfo = buffer.lineInfo
      expect(lineInfo.lineStarts).toEqual([0])
      expect(lineInfo.lineWidths.length).toBe(1)
      expect(lineInfo.lineWidths[0]).toBeGreaterThan(0)
    })

    it("should handle empty lines between content", () => {
      const styledText = stringToStyledText("First\n\nThird")
      buffer.setStyledText(styledText)

      const lineInfo = buffer.lineInfo
      expect(lineInfo.lineStarts.length).toBe(3)
      expect(lineInfo.lineWidths.length).toBe(3)
      expect(lineInfo.lineStarts[0]).toBe(0)
      expect(lineInfo.lineStarts[1]).toBe(6) // "First\n"
      expect(lineInfo.lineStarts[2]).toBe(7) // "First\n\n"
    })

    it("should handle very long lines", () => {
      const longText = "A".repeat(1000)
      const styledText = stringToStyledText(longText)
      buffer = TextBuffer.create(2000, "wcwidth") // Need larger capacity
      buffer.setStyledText(styledText)

      const lineInfo = buffer.lineInfo
      expect(lineInfo.lineStarts).toEqual([0])
      expect(lineInfo.lineWidths.length).toBe(1)
      expect(lineInfo.lineWidths[0]).toBeGreaterThan(0)

      buffer.destroy()
    })

    it("should handle lines with different widths", () => {
      const styledText = stringToStyledText("Short\n" + "A".repeat(50) + "\nMedium")
      buffer = TextBuffer.create(1000, "wcwidth")
      buffer.setStyledText(styledText)

      const lineInfo = buffer.lineInfo
      expect(lineInfo.lineStarts.length).toBe(3)
      expect(lineInfo.lineWidths.length).toBe(3)

      // All widths should be different (short < long > medium)
      const widths = lineInfo.lineWidths
      expect(widths[0]).toBeLessThan(widths[1]) // Short < Long
      expect(widths[1]).toBeGreaterThan(widths[2]) // Long > Medium

      buffer.destroy()
    })

    it("should handle styled text with colors and attributes", () => {
      const redChunk = {
        __isChunk: true as const,
        text: new TextEncoder().encode("Red"),
        plainText: "Red",
        fg: RGBA.fromValues(1, 0, 0, 1),
      }
      const newlineChunk = {
        __isChunk: true as const,
        text: new TextEncoder().encode("\n"),
        plainText: "\n",
      }
      const blueChunk = {
        __isChunk: true as const,
        text: new TextEncoder().encode("Blue"),
        plainText: "Blue",
        fg: RGBA.fromValues(0, 0, 1, 1),
      }

      const styledText = new StyledText([redChunk, newlineChunk, blueChunk])

      buffer.setStyledText(styledText)

      const lineInfo = buffer.lineInfo
      expect(lineInfo.lineStarts).toEqual([0, 4]) // "Red\n" = 4 chars
      expect(lineInfo.lineWidths.length).toBe(2)
    })

    it("should handle buffer with only whitespace", () => {
      const styledText = stringToStyledText("   \n \n ")
      buffer.setStyledText(styledText)

      const lineInfo = buffer.lineInfo
      expect(lineInfo.lineStarts).toEqual([0, 4, 6])
      expect(lineInfo.lineWidths.length).toBe(3)
      // Whitespace should still contribute to line widths
      lineInfo.lineWidths.forEach((width) => {
        expect(width).toBeGreaterThanOrEqual(0)
      })
    })

    it("should handle single character lines", () => {
      const styledText = stringToStyledText("A\nB\nC")
      buffer.setStyledText(styledText)

      const lineInfo = buffer.lineInfo
      expect(lineInfo.lineStarts).toEqual([0, 2, 4])
      expect(lineInfo.lineWidths.length).toBe(3)
      lineInfo.lineWidths.forEach((width) => {
        expect(width).toBeGreaterThan(0)
      })
    })

    it("should handle mixed content with special characters", () => {
      const styledText = stringToStyledText("Normal\n123\n!@#\n测试\n")
      buffer.setStyledText(styledText)

      const lineInfo = buffer.lineInfo
      expect(lineInfo.lineStarts.length).toBe(5) // 4 lines + empty line at end
      expect(lineInfo.lineWidths.length).toBe(5)
    })

    it("should handle lineInfo after buffer resize operations", () => {
      // Create a small buffer that will need to resize
      const smallBuffer = TextBuffer.create(16, "wcwidth")

      // Add text that will cause multiple resizes
      const longText = "A".repeat(100) + "\n" + "B".repeat(100)
      const styledText = stringToStyledText(longText)
      smallBuffer.setStyledText(styledText)

      const lineInfo = smallBuffer.lineInfo
      expect(lineInfo.lineStarts.length).toBe(2)
      expect(lineInfo.lineWidths.length).toBe(2)

      smallBuffer.destroy()
    })
  })

  describe("lineInfo edge cases", () => {
    it("should handle extremely long single line", () => {
      const extremelyLongText = "A".repeat(10000)
      const styledText = stringToStyledText(extremelyLongText)
      buffer = TextBuffer.create(20000, "wcwidth")
      buffer.setStyledText(styledText)

      const lineInfo = buffer.lineInfo
      expect(lineInfo.lineStarts).toEqual([0])
      expect(lineInfo.lineWidths.length).toBe(1)
      expect(lineInfo.lineWidths[0]).toBeGreaterThan(0)

      buffer.destroy()
    })

    it("should handle thousands of lines", () => {
      const manyLines = Array.from({ length: 1000 }, (_, i) => `Line ${i}`).join("\n")
      const styledText = stringToStyledText(manyLines)
      buffer = TextBuffer.create(10000, "wcwidth")
      buffer.setStyledText(styledText)

      const lineInfo = buffer.lineInfo
      expect(lineInfo.lineStarts.length).toBe(1000)
      expect(lineInfo.lineWidths.length).toBe(1000)

      // First line starts at 0
      expect(lineInfo.lineStarts[0]).toBe(0)
      // Each subsequent line should start after the previous line + newline
      for (let i = 1; i < lineInfo.lineStarts.length; i++) {
        expect(lineInfo.lineStarts[i]).toBeGreaterThan(lineInfo.lineStarts[i - 1])
      }

      buffer.destroy()
    })

    it("should handle alternating empty and content lines", () => {
      const styledText = stringToStyledText("\nContent\n\nMore\n\n")
      buffer.setStyledText(styledText)

      const lineInfo = buffer.lineInfo
      expect(lineInfo.lineStarts.length).toBe(6)
      expect(lineInfo.lineWidths.length).toBe(6)
    })

    it("should handle lineInfo with complex Unicode combining characters", () => {
      const styledText = stringToStyledText("café\nnaïve\nrésumé")
      buffer.setStyledText(styledText)

      const lineInfo = buffer.lineInfo
      expect(lineInfo.lineStarts.length).toBe(3)
      expect(lineInfo.lineWidths.length).toBe(3)
      lineInfo.lineWidths.forEach((width) => {
        expect(width).toBeGreaterThan(0)
      })
    })

    it("should handle lineInfo after setting default styles", () => {
      const styledText = stringToStyledText("Test\nText")
      buffer.setStyledText(styledText)

      // Set default styles
      buffer.setDefaultFg(RGBA.fromValues(1, 0, 0, 1))
      buffer.setDefaultBg(RGBA.fromValues(0, 0, 0, 1))
      buffer.setDefaultAttributes(1)

      // lineInfo should still work the same
      const lineInfo = buffer.lineInfo
      expect(lineInfo.lineStarts).toEqual([0, 5])
      expect(lineInfo.lineWidths.length).toBe(2)
    })

    it("should handle lineInfo consistency after resetDefaults", () => {
      const styledText = stringToStyledText("Test\nText")
      buffer.setStyledText(styledText)

      buffer.setDefaultFg(RGBA.fromValues(1, 0, 0, 1))
      buffer.resetDefaults()

      const lineInfo = buffer.lineInfo
      expect(lineInfo.lineStarts).toEqual([0, 5])
      expect(lineInfo.lineWidths.length).toBe(2)
    })
  })

  describe("lineInfo getter with unicode width method", () => {
    let unicodeBuffer: TextBuffer

    beforeEach(() => {
      unicodeBuffer = TextBuffer.create(256, "unicode")
    })

    afterEach(() => {
      unicodeBuffer.destroy()
    })

    it("should return line info for empty buffer", () => {
      // Set empty content first
      const emptyText = stringToStyledText("")
      unicodeBuffer.setStyledText(emptyText)

      const lineInfo = unicodeBuffer.lineInfo
      expect(lineInfo.lineStarts).toEqual([0]) // Always starts with line 0
      expect(lineInfo.lineWidths).toEqual([0]) // Empty line has width 0
    })

    it("should return single line info for simple text without newlines", () => {
      const styledText = stringToStyledText("Hello World")
      unicodeBuffer.setStyledText(styledText)

      const lineInfo = unicodeBuffer.lineInfo
      expect(lineInfo.lineStarts).toEqual([0])
      expect(lineInfo.lineWidths).toBeArray()
      expect(lineInfo.lineWidths.length).toBe(1)
      expect(lineInfo.lineWidths[0]).toBeGreaterThan(0) // Width should be > 0 for non-empty text
    })

    it("should handle wide characters (Unicode)", () => {
      const styledText = stringToStyledText("Hello 世界 🌟")
      unicodeBuffer.setStyledText(styledText)

      const lineInfo = unicodeBuffer.lineInfo
      expect(lineInfo.lineStarts).toEqual([0])
      expect(lineInfo.lineWidths.length).toBe(1)
      expect(lineInfo.lineWidths[0]).toBeGreaterThan(0)
    })

    it("should handle lineInfo with complex Unicode combining characters", () => {
      const styledText = stringToStyledText("café\nnaïve\nrésumé")
      unicodeBuffer.setStyledText(styledText)

      const lineInfo = unicodeBuffer.lineInfo
      expect(lineInfo.lineStarts.length).toBe(3)
      expect(lineInfo.lineWidths.length).toBe(3)
      lineInfo.lineWidths.forEach((width) => {
        expect(width).toBeGreaterThan(0)
      })
    })

    it("should handle mixed content with special characters", () => {
      const styledText = stringToStyledText("Normal\n123\n!@#\n测试\n")
      unicodeBuffer.setStyledText(styledText)

      const lineInfo = unicodeBuffer.lineInfo
      expect(lineInfo.lineStarts.length).toBe(5) // 4 lines + empty line at end
      expect(lineInfo.lineWidths.length).toBe(5)
    })

    it("should handle styled text with colors and attributes", () => {
      const redChunk = {
        __isChunk: true as const,
        text: new TextEncoder().encode("Red"),
        plainText: "Red",
        fg: RGBA.fromValues(1, 0, 0, 1),
      }
      const newlineChunk = {
        __isChunk: true as const,
        text: new TextEncoder().encode("\n"),
        plainText: "\n",
      }
      const blueChunk = {
        __isChunk: true as const,
        text: new TextEncoder().encode("Blue"),
        plainText: "Blue",
        fg: RGBA.fromValues(0, 0, 1, 1),
      }

      const styledText = new StyledText([redChunk, newlineChunk, blueChunk])

      unicodeBuffer.setStyledText(styledText)

      const lineInfo = unicodeBuffer.lineInfo
      expect(lineInfo.lineStarts).toEqual([0, 4]) // "Red\n" = 4 chars
      expect(lineInfo.lineWidths.length).toBe(2)
    })
  })
})
