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

    it("should start with wrap mode set to none", () => {
      // Default wrap mode is 'none', no direct getter but we can test behavior
      expect(view.getVirtualLineCount()).toBeGreaterThanOrEqual(0)
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
    it("should enable and disable wrapping via wrap mode", () => {
      // Create text that will wrap at narrow viewport
      buffer.setText("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRST")

      // Initially no wrapping (mode is 'none')
      expect(view.getVirtualLineCount()).toBe(1)

      // Enable wrapping (viewport is 40 columns)
      view.setWrapMode("char")
      expect(view.getVirtualLineCount()).toBeGreaterThan(1) // Should wrap to multiple lines

      // Disable wrapping
      view.setWrapMode("none")
      expect(view.getVirtualLineCount()).toBe(1)
    })

    it("should wrap at viewport width", () => {
      buffer.setText("ABCDEFGHIJKLMNOPQRST") // 20 chars

      view.setWrapMode("char")
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

      view.setViewportSize(10, 10)

      // Test char mode
      view.setWrapMode("char")
      const charCount = view.getVirtualLineCount()
      expect(charCount).toBeGreaterThanOrEqual(2)

      // Test word mode
      view.setWrapMode("word")
      const wordCount = view.getVirtualLineCount()
      expect(wordCount).toBeGreaterThanOrEqual(2)

      // Test none mode
      view.setWrapMode("none")
      const noneCount = view.getVirtualLineCount()
      expect(noneCount).toBe(1)
    })

    it("should preserve newlines when wrapping", () => {
      buffer.setText("Short\nAnother short line\nLast")

      view.setWrapMode("char")
      view.setViewportSize(50, 10)

      // Should still have 3 virtual lines (original newlines preserved)
      expect(view.getVirtualLineCount()).toBe(3)
    })

    it("should wrap long lines with wrapping enabled", () => {
      const longLine = "This is a very long line that will definitely wrap when the viewport is narrow"
      buffer.setText(longLine)

      view.setWrapMode("char")
      view.setViewportSize(20, 10)

      const vlineCount = view.getVirtualLineCount()
      expect(vlineCount).toBeGreaterThan(1)
    })
  })

  describe("integration with EditBuffer", () => {
    it("should reflect edits made to EditBuffer", () => {
      buffer.setText("Line 1\nLine 2\nLine 3")
      expect(view.getVirtualLineCount()).toBe(3)

      buffer.gotoLine(9999) // Go to end
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
  })

  describe("viewport with wrapping and editing", () => {
    it("should maintain wrapping after edits", () => {
      buffer.setText("Short line")

      view.setWrapMode("char")
      view.setViewportSize(20, 10)

      expect(view.getVirtualLineCount()).toBe(1)

      buffer.gotoLine(9999) // Go to end
      buffer.insertText(" that becomes very long and should wrap now")

      expect(view.getVirtualLineCount()).toBeGreaterThan(1)
    })

    it("should handle viewport resize with wrapped content", () => {
      const longText = "This is a very long line that will wrap when the viewport is narrow"
      buffer.setText(longText)

      view.setWrapMode("char")
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

  describe("word boundary navigation", () => {
    it("should get next word boundary with visual cursor", () => {
      buffer.setText("hello world foo")
      buffer.setCursorToLineCol(0, 0)

      const nextBoundary = view.getNextWordBoundary()
      expect(nextBoundary).toBeDefined()
      expect(nextBoundary.visualCol).toBeGreaterThan(0)
    })

    it("should get previous word boundary with visual cursor", () => {
      buffer.setText("hello world foo")
      buffer.setCursorToLineCol(0, 15)

      const prevBoundary = view.getPrevWordBoundary()
      expect(prevBoundary).toBeDefined()
      expect(prevBoundary.visualCol).toBeLessThan(15)
    })

    it("should handle word boundary at start", () => {
      buffer.setText("hello world")
      buffer.setCursorToLineCol(0, 0)

      const prevBoundary = view.getPrevWordBoundary()
      expect(prevBoundary.logicalRow).toBe(0)
      expect(prevBoundary.visualCol).toBe(0)
    })

    it("should handle word boundary at end", () => {
      buffer.setText("hello world")
      buffer.setCursorToLineCol(0, 11)

      const nextBoundary = view.getNextWordBoundary()
      expect(nextBoundary.visualCol).toBe(11)
    })

    it("should navigate across lines with visual coordinates", () => {
      buffer.setText("hello\nworld")
      buffer.setCursorToLineCol(0, 5)

      const nextBoundary = view.getNextWordBoundary()
      expect(nextBoundary.logicalRow).toBeGreaterThanOrEqual(0)
    })

    it("should handle wrapping when getting word boundaries", () => {
      buffer.setText("hello world test foo bar")
      view.setWrapMode("word")
      view.setViewportSize(10, 10)

      buffer.setCursorToLineCol(0, 0)
      const nextBoundary = view.getNextWordBoundary()

      expect(nextBoundary).toBeDefined()
      expect(nextBoundary.visualRow).toBeGreaterThanOrEqual(0)
      expect(nextBoundary.logicalRow).toBeGreaterThanOrEqual(0)
    })
  })

  describe("large content", () => {
    it("should handle many lines", () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}`).join("\n")
      buffer.setText(lines)

      expect(view.getTotalVirtualLineCount()).toBe(100)
    })

    it("should handle very long single line with wrapping", () => {
      const longLine = "A".repeat(1000)
      buffer.setText(longLine)

      view.setWrapMode("char")
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

      expect(smallView.getTotalVirtualLineCount()).toBe(20) // Total line count

      smallView.destroy()
    })
  })

  describe("error handling", () => {
    it("should throw error when using destroyed view", () => {
      view.destroy()

      expect(() => view.getVirtualLineCount()).toThrow("EditorView is destroyed")
      expect(() => view.setViewportSize(80, 24)).toThrow("EditorView is destroyed")
      expect(() => view.setWrapMode("char")).toThrow("EditorView is destroyed")
    })
  })

  describe("Unicode edge cases", () => {
    it("should handle emoji with wrapping", () => {
      buffer.setText("🌟".repeat(20))

      view.setWrapMode("char")
      view.setViewportSize(10, 10)

      // Each emoji takes 2 cells, so 10 emojis = 20 cells, should wrap
      expect(view.getVirtualLineCount()).toBeGreaterThan(1)
    })

    it("should handle CJK characters with wrapping", () => {
      buffer.setText("测试文字处理功能")

      view.setWrapMode("char")
      view.setViewportSize(10, 10)

      // CJK chars are 2 cells each
      const vlineCount = view.getVirtualLineCount()
      expect(vlineCount).toBeGreaterThanOrEqual(1)
    })

    it("should handle mixed ASCII and wide characters", () => {
      buffer.setText("AB测试CD文字EF")

      view.setWrapMode("char")
      view.setViewportSize(8, 10)

      expect(view.getVirtualLineCount()).toBeGreaterThanOrEqual(1)
    })
  })

  describe("cursor movement around multi-cell graphemes", () => {
    // These tests verify that the cursor correctly handles multi-cell graphemes like emojis (🌟)
    // and CJK characters (世界). Multi-cell graphemes occupy 2 visual columns but are treated
    // as a single logical unit for cursor movement and deletion.
    //
    // Key behaviors:
    // - moveCursorRight/Left skips over entire graphemes (no intermediate positions)
    // - deleteCharBackward deletes the entire grapheme, not individual cells
    // - Visual column positions reflect the actual display width (2 cells per wide grapheme)
    // - Logical column positions mark grapheme boundaries (skipping intermediate cell positions)

    it("should understand logical vs visual cursor positions", () => {
      // This test documents how cursor positions work with multi-cell graphemes
      // For "a🌟b": moving right skips intermediate positions in multi-cell graphemes
      buffer.setText("a🌟b")

      // Position 0: before 'a'
      buffer.setCursorToLineCol(0, 0)
      expect(view.getVisualCursor().visualCol).toBe(0)

      // Position 1: after 'a', before '🌟'
      buffer.setCursorToLineCol(0, 1)
      expect(view.getVisualCursor().visualCol).toBe(1)

      // Position 3: after '🌟' (position 2 would be inside the 2-cell emoji)
      buffer.setCursorToLineCol(0, 3)
      expect(view.getVisualCursor().visualCol).toBe(3)

      // Position 4: after 'b'
      buffer.setCursorToLineCol(0, 4)
      expect(view.getVisualCursor().visualCol).toBe(4)

      // Moving right skips over multi-cell graphemes in one jump
      buffer.setCursorToLineCol(0, 0)
      buffer.moveCursorRight() // 0 -> 1
      expect(buffer.getCursorPosition().col).toBe(1)

      buffer.moveCursorRight() // 1 -> 3 (skips 2, which is inside emoji)
      expect(buffer.getCursorPosition().col).toBe(3)
      expect(view.getVisualCursor().visualCol).toBe(3)

      buffer.moveCursorRight() // 3 -> 4
      expect(buffer.getCursorPosition().col).toBe(4)
    })

    it("should move cursor correctly around emoji (🌟) with visual positions", () => {
      // Setup: "a🌟b" where 🌟 takes 2 visual cells
      // Cursor positions: 0 (before a), 1 (after a), 3 (after 🌟), 4 (after b)
      buffer.setText("a🌟b")

      // Start before emoji (after 'a')
      buffer.setCursorToLineCol(0, 1)
      let visualCursor = view.getVisualCursor()
      expect(visualCursor.visualCol).toBe(1)

      // Move right: cursor jumps over the emoji to position 3
      buffer.moveCursorRight()
      visualCursor = view.getVisualCursor()
      expect(visualCursor.visualCol).toBe(3) // After 2-cell emoji

      // Move right again: cursor moves to after 'b'
      buffer.moveCursorRight()
      visualCursor = view.getVisualCursor()
      expect(visualCursor.visualCol).toBe(4)

      // Move left: cursor jumps back over 'b'
      buffer.moveCursorLeft()
      visualCursor = view.getVisualCursor()
      expect(visualCursor.visualCol).toBe(3)

      // Move left again: cursor jumps back over emoji
      buffer.moveCursorLeft()
      visualCursor = view.getVisualCursor()
      expect(visualCursor.visualCol).toBe(1)
    })

    it("should move cursor correctly around CJK characters (世界) with visual positions", () => {
      // Setup: "a世界b" where each CJK char takes 2 visual cells
      // Cursor positions: 0, 1 (after a), 3 (after 世), 5 (after 界), 6 (after b)
      buffer.setText("a世界b")

      // Start at beginning
      buffer.setCursorToLineCol(0, 0)
      expect(view.getVisualCursor().visualCol).toBe(0)

      // Move through each character
      buffer.moveCursorRight() // after 'a'
      expect(view.getVisualCursor().visualCol).toBe(1)

      buffer.moveCursorRight() // after '世'
      expect(view.getVisualCursor().visualCol).toBe(3)

      buffer.moveCursorRight() // after '界'
      expect(view.getVisualCursor().visualCol).toBe(5)

      buffer.moveCursorRight() // after 'b'
      expect(view.getVisualCursor().visualCol).toBe(6)

      // Move back
      buffer.moveCursorLeft() // back to after '界'
      expect(view.getVisualCursor().visualCol).toBe(5)

      buffer.moveCursorLeft() // back to after '世'
      expect(view.getVisualCursor().visualCol).toBe(3)

      buffer.moveCursorLeft() // back to after 'a'
      expect(view.getVisualCursor().visualCol).toBe(1)
    })

    it("should handle backspace correctly after emoji", () => {
      // Setup: "a🌟b" with cursor positions: 0, 1, 3, 4
      buffer.setText("a🌟b")

      // Position cursor right after emoji (position 3, before 'b')
      buffer.setCursorToLineCol(0, 3)
      expect(view.getVisualCursor().visualCol).toBe(3)

      // Backspace should delete the entire emoji grapheme
      buffer.deleteCharBackward()
      expect(buffer.getText()).toBe("ab")
      expect(view.getVisualCursor().visualCol).toBe(1)
    })

    it("should handle backspace correctly after CJK character", () => {
      // Setup: "世界" with cursor positions: 0, 2 (after 世), 4 (after 界)
      buffer.setText("世界")

      // Position cursor at end (after '界', position 4)
      buffer.setCursorToLineCol(0, 4)
      expect(view.getVisualCursor().visualCol).toBe(4)

      // Backspace should delete '界' (the entire 2-cell character)
      buffer.deleteCharBackward()
      expect(buffer.getText()).toBe("世")
      expect(view.getVisualCursor().visualCol).toBe(2)

      // Backspace again should delete '世'
      buffer.deleteCharBackward()
      expect(buffer.getText()).toBe("")
      expect(view.getVisualCursor().visualCol).toBe(0)
    })

    it("should treat multi-cell graphemes as single units for cursor movement", () => {
      // "🌟世界🎉" = 2 + 2 + 2 + 2 = 8 visual cells total
      // Cursor positions: 0, 2 (after 🌟), 4 (after 世), 6 (after 界), 8 (after 🎉)
      buffer.setText("🌟世界🎉")

      buffer.setCursorToLineCol(0, 0)
      expect(view.getVisualCursor().visualCol).toBe(0)

      // Move through each grapheme - cursor jumps by 2 each time
      buffer.moveCursorRight()
      expect(view.getVisualCursor().visualCol).toBe(2)

      buffer.moveCursorRight()
      expect(view.getVisualCursor().visualCol).toBe(4)

      buffer.moveCursorRight()
      expect(view.getVisualCursor().visualCol).toBe(6)

      buffer.moveCursorRight()
      expect(view.getVisualCursor().visualCol).toBe(8)

      // Move back - cursor jumps by 2 each time
      buffer.moveCursorLeft()
      expect(view.getVisualCursor().visualCol).toBe(6)

      buffer.moveCursorLeft()
      expect(view.getVisualCursor().visualCol).toBe(4)

      buffer.moveCursorLeft()
      expect(view.getVisualCursor().visualCol).toBe(2)

      buffer.moveCursorLeft()
      expect(view.getVisualCursor().visualCol).toBe(0)
    })

    it("should handle backspace through mixed multi-cell graphemes", () => {
      // "a🌟b世c" with positions: 0, 1 (after a), 3 (after 🌟), 4 (after b), 6 (after 世), 7 (after c)
      buffer.setText("a🌟b世c")

      // Move to end (position 7)
      buffer.setCursorToLineCol(0, 7)
      expect(view.getVisualCursor().visualCol).toBe(7)

      // Delete 'c'
      buffer.deleteCharBackward()
      expect(buffer.getText()).toBe("a🌟b世")
      expect(view.getVisualCursor().visualCol).toBe(6)

      // Delete '世' (2-cell character)
      buffer.deleteCharBackward()
      expect(buffer.getText()).toBe("a🌟b")
      expect(view.getVisualCursor().visualCol).toBe(4)

      // Delete 'b'
      buffer.deleteCharBackward()
      expect(buffer.getText()).toBe("a🌟")
      expect(view.getVisualCursor().visualCol).toBe(3)

      // Delete '🌟' (2-cell emoji)
      buffer.deleteCharBackward()
      expect(buffer.getText()).toBe("a")
      expect(view.getVisualCursor().visualCol).toBe(1)

      // Delete 'a'
      buffer.deleteCharBackward()
      expect(buffer.getText()).toBe("")
      expect(view.getVisualCursor().visualCol).toBe(0)
    })

    it("should handle delete key correctly before multi-cell graphemes", () => {
      // "a🌟b" with positions: 0, 1 (after a), 3 (after 🌟), 4 (after b)
      buffer.setText("a🌟b")

      // Position after 'a', before emoji (position 1)
      buffer.setCursorToLineCol(0, 1)
      expect(view.getVisualCursor().visualCol).toBe(1)

      // Delete should remove the entire emoji
      buffer.deleteChar()
      expect(buffer.getText()).toBe("ab")
      expect(view.getVisualCursor().visualCol).toBe(1)

      // Position at start
      buffer.setCursorToLineCol(0, 0)

      // Delete 'a'
      buffer.deleteChar()
      expect(buffer.getText()).toBe("b")
      expect(view.getVisualCursor().visualCol).toBe(0)
    })

    it("should handle line start and end with multi-cell graphemes", () => {
      // "🌟世界🎉" = 8 visual cells total
      // Positions: 0, 2 (after 🌟), 4 (after 世), 6 (after 界), 8 (after 🎉)
      buffer.setText("🌟世界🎉")

      // Go to start of line
      buffer.setCursorToLineCol(0, 0)
      expect(view.getVisualCursor().visualCol).toBe(0)

      // Go to end of line using getEOL
      const eol = view.getEOL()
      buffer.setCursorToLineCol(eol.logicalRow, eol.logicalCol)
      expect(view.getVisualCursor().visualCol).toBe(8)
    })
  })
})
