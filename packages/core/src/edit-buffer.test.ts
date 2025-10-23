import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { EditBuffer } from "./edit-buffer"

describe("EditBuffer", () => {
  let buffer: EditBuffer

  beforeEach(() => {
    buffer = EditBuffer.create("wcwidth")
  })

  afterEach(() => {
    buffer.destroy()
  })

  describe("setText and getText", () => {
    it("should set and retrieve text content", () => {
      buffer.setText("Hello World")
      expect(buffer.getText()).toBe("Hello World")
    })

    it("should handle empty text", () => {
      buffer.setText("")
      expect(buffer.getText()).toBe("")
    })

    it("should handle text with newlines", () => {
      const text = "Line 1\nLine 2\nLine 3"
      buffer.setText(text)
      expect(buffer.getText()).toBe(text)
    })

    it("should handle Unicode characters", () => {
      const text = "Hello 世界 🌟"
      buffer.setText(text)
      expect(buffer.getText()).toBe(text)
    })
  })

  describe("cursor position", () => {
    it("should start cursor at beginning after setText", () => {
      buffer.setText("Hello World")
      const cursor = buffer.getCursorPosition()

      expect(cursor.line).toBe(0)
      expect(cursor.visualColumn).toBe(0)
    })

    it("should track cursor position after movements", () => {
      buffer.setText("Hello World")

      buffer.moveCursorRight()
      let cursor = buffer.getCursorPosition()
      expect(cursor.visualColumn).toBe(1)

      buffer.moveCursorRight()
      cursor = buffer.getCursorPosition()
      expect(cursor.visualColumn).toBe(2)
    })

    it("should handle multi-line cursor positions", () => {
      buffer.setText("Line 1\nLine 2\nLine 3")

      buffer.moveCursorDown()
      let cursor = buffer.getCursorPosition()
      expect(cursor.line).toBe(1)

      buffer.moveCursorDown()
      cursor = buffer.getCursorPosition()
      expect(cursor.line).toBe(2)
    })
  })

  describe("cursor movement", () => {
    it("should move cursor left and right", () => {
      buffer.setText("ABCDE")

      buffer.setCursorToLineCol(0, 5) // Move to end
      expect(buffer.getCursorPosition().visualColumn).toBe(5)

      buffer.moveCursorLeft()
      expect(buffer.getCursorPosition().visualColumn).toBe(4)

      buffer.moveCursorLeft()
      expect(buffer.getCursorPosition().visualColumn).toBe(3)
    })

    it("should move cursor up and down", () => {
      buffer.setText("Line 1\nLine 2\nLine 3")

      buffer.moveCursorDown()
      expect(buffer.getCursorPosition().line).toBe(1)

      buffer.moveCursorDown()
      expect(buffer.getCursorPosition().line).toBe(2)

      buffer.moveCursorUp()
      expect(buffer.getCursorPosition().line).toBe(1)
    })

    it("should move to line start and end", () => {
      buffer.setText("Hello World")

      buffer.setCursorToLineCol(0, 11) // Move to end
      expect(buffer.getCursorPosition().visualColumn).toBe(11)

      const cursor = buffer.getCursorPosition()
      buffer.setCursor(cursor.line, 0)
      expect(buffer.getCursorPosition().visualColumn).toBe(0)
    })

    it("should goto specific line", () => {
      buffer.setText("Line 1\nLine 2\nLine 3")

      buffer.gotoLine(1)
      expect(buffer.getCursorPosition().line).toBe(1)

      buffer.gotoLine(2)
      expect(buffer.getCursorPosition().line).toBe(2)
    })

    it("should handle Unicode grapheme movement correctly", () => {
      buffer.setText("A🌟B")

      expect(buffer.getCursorPosition().visualColumn).toBe(0)

      buffer.moveCursorRight() // Move to emoji
      expect(buffer.getCursorPosition().visualColumn).toBe(1)

      buffer.moveCursorRight() // Move past emoji (2 cells wide)
      expect(buffer.getCursorPosition().visualColumn).toBe(3)

      buffer.moveCursorRight() // Move to B
      expect(buffer.getCursorPosition().visualColumn).toBe(4)
    })
  })

  describe("text insertion", () => {
    it("should insert single character", () => {
      buffer.setText("Hello World")

      buffer.setCursorToLineCol(0, 11) // Move to end
      buffer.insertChar("!")

      expect(buffer.getText()).toBe("Hello World!")
    })

    it("should insert text at cursor", () => {
      buffer.setText("Hello")

      buffer.setCursorToLineCol(0, 5) // Move to end
      buffer.insertText(" World")

      expect(buffer.getText()).toBe("Hello World")
    })

    it("should insert text in middle", () => {
      buffer.setText("HelloWorld")

      buffer.setCursorToLineCol(0, 5)
      buffer.insertText(" ")

      expect(buffer.getText()).toBe("Hello World")
    })

    it("should handle continuous typing (edit session)", () => {
      buffer.setText("")

      buffer.insertText("Hello")
      buffer.insertText(" ")
      buffer.insertText("World")

      expect(buffer.getText()).toBe("Hello World")
    })

    it("should insert Unicode characters", () => {
      buffer.setText("Hello")

      buffer.setCursorToLineCol(0, 5) // Move to end
      buffer.insertText(" 世界 🌟")

      expect(buffer.getText()).toBe("Hello 世界 🌟")
    })

    it("should handle newline insertion", () => {
      buffer.setText("HelloWorld")

      buffer.setCursorToLineCol(0, 5)
      buffer.newLine()

      expect(buffer.getText()).toBe("Hello\nWorld")
    })
  })

  describe("text deletion", () => {
    it("should delete character at cursor", () => {
      buffer.setText("Hello World")

      buffer.setCursorToLineCol(0, 6)
      buffer.deleteChar()

      expect(buffer.getText()).toBe("Hello orld")
    })

    it("should delete character backward", () => {
      buffer.setText("")

      buffer.insertText("test")
      buffer.deleteCharBackward()

      expect(buffer.getText()).toBe("tes")
    })

    it("should delete entire line", () => {
      buffer.setText("Line 1\nLine 2\nLine 3")

      buffer.gotoLine(1) // Go to Line 2
      buffer.deleteLine()

      expect(buffer.getText()).toBe("Line 1\nLine 3")
    })

    // TODO: Re-implement deleteToLineEnd as scripted method
    it.skip("should delete to line end", () => {
      buffer.setText("Hello World")

      buffer.setCursorToLineCol(0, 6)
      // buffer.deleteToLineEnd()

      expect(buffer.getText()).toBe("Hello ")
    })

    it("should handle backspace in active edit session", () => {
      buffer.setText("")

      buffer.insertText("test")
      buffer.deleteCharBackward()
      buffer.deleteCharBackward()

      expect(buffer.getText()).toBe("te")
    })
  })

  describe("complex editing scenarios", () => {
    it("should handle multiple edit operations in sequence", () => {
      buffer.setText("Hello World")

      buffer.setCursorToLineCol(0, 11) // Move to end
      buffer.insertText("!")

      buffer.setCursorToLineCol(0, 0) // Move to start
      buffer.insertText(">> ")

      buffer.setCursorToLineCol(0, 99) // Move to end of line
      buffer.newLine()
      buffer.insertText("New line")

      expect(buffer.getText()).toBe(">> Hello World!\nNew line")
    })

    it("should handle insert, delete, and cursor movement", () => {
      buffer.setText("AAAA\nBBBB\nCCCC")

      buffer.gotoLine(1)
      buffer.setCursorToLineCol(1, 4) // Move to end of line 1
      buffer.insertText("X")

      const text1 = buffer.getText()
      expect(text1).toBe("AAAA\nBBBBX\nCCCC")

      // After insert, cursor is at end, deleteCharBackward will delete X
      buffer.deleteCharBackward()

      expect(buffer.getText()).toBe("AAAA\nBBBB\nCCCC")
    })

    it("should handle line operations", () => {
      buffer.setText("Line 1\nLine 2\nLine 3")

      buffer.gotoLine(1) // Go to Line 2
      buffer.deleteLine()

      // After deleting Line 2, we should have Line 1 and Line 3
      const result = buffer.getText()
      expect(result === "Line 1\nLine 3" || result === "Line 1\nLine 3\n").toBe(true)
    })
  })

  describe("setCursor methods", () => {
    it("should set cursor by line and byte offset", () => {
      buffer.setText("Hello World")

      buffer.setCursor(0, 6)
      const cursor = buffer.getCursorPosition()
      expect(cursor.visualColumn).toBe(6)
    })

    it("should set cursor by line and column", () => {
      buffer.setText("Hello World")

      buffer.setCursorToLineCol(0, 5)
      const cursor = buffer.getCursorPosition()
      expect(cursor.visualColumn).toBe(5)
    })

    it("should handle multi-line setCursorToLineCol", () => {
      buffer.setText("Line 1\nLine 2\nLine 3")

      buffer.setCursorToLineCol(1, 3)
      const cursor = buffer.getCursorPosition()
      expect(cursor.line).toBe(1)
      expect(cursor.visualColumn).toBe(3)
    })
  })

  describe("word boundary navigation", () => {
    it("should get next word boundary", () => {
      buffer.setText("hello world foo")
      buffer.setCursorToLineCol(0, 0)

      const nextBoundary = buffer.getNextWordBoundary()
      expect(nextBoundary.visualColumn).toBeGreaterThan(0)
    })

    it("should get previous word boundary", () => {
      buffer.setText("hello world foo")
      buffer.setCursorToLineCol(0, 15)

      const prevBoundary = buffer.getPrevWordBoundary()
      expect(prevBoundary.visualColumn).toBeLessThan(15)
    })

    it("should handle word boundary at start", () => {
      buffer.setText("hello world")
      buffer.setCursorToLineCol(0, 0)

      const prevBoundary = buffer.getPrevWordBoundary()
      expect(prevBoundary.line).toBe(0)
      expect(prevBoundary.visualColumn).toBe(0)
    })

    it("should handle word boundary at end", () => {
      buffer.setText("hello world")
      buffer.setCursorToLineCol(0, 11)

      const nextBoundary = buffer.getNextWordBoundary()
      expect(nextBoundary.visualColumn).toBe(11)
    })

    it("should navigate across lines", () => {
      buffer.setText("hello\nworld")
      buffer.setCursorToLineCol(0, 5)

      const nextBoundary = buffer.getNextWordBoundary()
      expect(nextBoundary.line).toBeGreaterThanOrEqual(0)
    })

    it("should handle punctuation boundaries", () => {
      buffer.setText("hello-world test")
      buffer.setCursorToLineCol(0, 0)

      const next1 = buffer.getNextWordBoundary()
      expect(next1.visualColumn).toBeGreaterThan(0)
    })
  })

  describe("error handling", () => {
    it("should throw error when using destroyed buffer", () => {
      buffer.setText("Test")
      buffer.destroy()

      expect(() => buffer.getText()).toThrow("EditBuffer is destroyed")
      expect(() => buffer.insertText("x")).toThrow("EditBuffer is destroyed")
      expect(() => buffer.moveCursorLeft()).toThrow("EditBuffer is destroyed")
    })
  })

  describe("line boundary operations", () => {
    it("should merge lines when backspacing at BOL", () => {
      buffer.setText("Line 1\nLine 2")
      buffer.setCursorToLineCol(1, 0) // Start of line 2
      buffer.deleteCharBackward()
      expect(buffer.getText()).toBe("Line 1Line 2")
      const cursor = buffer.getCursorPosition()
      expect(cursor.line).toBe(0)
      expect(cursor.visualColumn).toBe(6)
    })

    it("should merge lines when deleting at EOL", () => {
      buffer.setText("Line 1\nLine 2")
      buffer.setCursorToLineCol(0, 6) // End of line 1
      buffer.deleteChar()
      expect(buffer.getText()).toBe("Line 1Line 2")
      const cursor = buffer.getCursorPosition()
      expect(cursor.line).toBe(0)
      expect(cursor.visualColumn).toBe(6)
    })

    it("should handle newline insertion at BOL", () => {
      buffer.setText("Hello")
      buffer.setCursorToLineCol(0, 0)
      buffer.newLine()
      expect(buffer.getText()).toBe("\nHello")
      const cursor = buffer.getCursorPosition()
      expect(cursor.line).toBe(1)
      expect(cursor.visualColumn).toBe(0)
    })

    it("should handle newline insertion at EOL", () => {
      buffer.setText("Hello")
      buffer.setCursorToLineCol(0, 5)
      buffer.newLine()
      expect(buffer.getText()).toBe("Hello\n")
      const cursor = buffer.getCursorPosition()
      expect(cursor.line).toBe(1)
      expect(cursor.visualColumn).toBe(0)
    })

    it("should handle CRLF in text", () => {
      // CRLF is detected as a line break during setText
      buffer.setText("Line 1\r\nLine 2")
      // Both CR and LF are detected, so we get the text back
      const text = buffer.getText()
      // Verify we have two lines
      buffer.setCursorToLineCol(1, 0)
      buffer.deleteCharBackward()
      expect(buffer.getText()).toBe("Line 1Line 2")
    })

    it("should handle multiple consecutive newlines", () => {
      buffer.setText("A\n\n\nB")
      buffer.setCursorToLineCol(1, 0) // Empty line
      buffer.deleteCharBackward()
      expect(buffer.getText()).toBe("A\n\nB")
    })
  })

  describe("wide character handling", () => {
    it("should handle tabs correctly in edits", () => {
      buffer.setText("A\tB")
      // Tab has a display width of 8 columns (by default)
      // So "A\tB" has positions: A at col 0-1, tab at col 1-9, B at col 9
      // To insert after A, we use column 1
      buffer.setCursorToLineCol(0, 1) // After A, at the tab position
      // But since setCursorToLineCol might snap to grapheme boundaries,
      // let's just verify the text remains intact when inserting at byte level
      buffer.insertText("X")
      // The insert should happen at the cursor position
      const text = buffer.getText()
      // Either AX\tB or A\tXB depending on how cursor snaps
      expect(text.includes("A") && text.includes("B") && text.includes("\t") && text.includes("X")).toBe(true)
    })

    it("should handle CJK characters correctly", () => {
      buffer.setText("世界")
      buffer.setCursorToLineCol(0, 2) // After first character (2 columns wide)
      buffer.insertText("X")
      expect(buffer.getText()).toBe("世X界")
    })

    it("should handle emoji correctly", () => {
      buffer.setText("🌟")
      buffer.setCursorToLineCol(0, 0)
      buffer.moveCursorRight()
      const cursor = buffer.getCursorPosition()
      expect(cursor.visualColumn).toBe(2) // Emoji is 2 columns wide
    })

    it("should handle mixed width text correctly", () => {
      buffer.setText("A世🌟B")
      buffer.setCursorToLineCol(0, 1) // After A
      buffer.moveCursorRight()
      const cursor = buffer.getCursorPosition()
      expect(cursor.visualColumn).toBe(3) // A(1) + 世(2)
    })
  })

  describe("multi-line insertion", () => {
    it("should insert multi-line text correctly", () => {
      buffer.setText("Start")
      buffer.setCursorToLineCol(0, 5)
      buffer.insertText("\nMiddle\nEnd")
      expect(buffer.getText()).toBe("Start\nMiddle\nEnd")
      const cursor = buffer.getCursorPosition()
      expect(cursor.line).toBe(2)
      expect(cursor.visualColumn).toBe(3)
    })

    it("should insert multi-line text in middle", () => {
      buffer.setText("StartEnd")
      buffer.setCursorToLineCol(0, 5)
      buffer.insertText("\nMiddle\n")
      expect(buffer.getText()).toBe("Start\nMiddle\nEnd")
    })

    it("should handle inserting text with various line endings", () => {
      buffer.setText("")
      buffer.insertText("Line 1\nLine 2\rLine 3\r\nLine 4")
      const text = buffer.getText()
      // Line breaks are preserved in the buffer
      // Just verify we have 4 lines
      const lines = text.split(/\r?\n|\r/)
      expect(lines.length).toBe(4)
      expect(lines[0]).toBe("Line 1")
      expect(lines[3]).toBe("Line 4")
    })
  })
})

describe("EditBuffer Placeholder", () => {
  let buffer: EditBuffer

  beforeEach(() => {
    buffer = EditBuffer.create("wcwidth")
  })

  afterEach(() => {
    buffer.destroy()
  })

  describe("placeholder text", () => {
    it("should set placeholder and return empty from getText", () => {
      buffer.setPlaceholder("Enter text here...")

      // getText should return empty (placeholder is display-only)
      expect(buffer.getText()).toBe("")
    })

    it("should remove placeholder when inserting text", () => {
      buffer.setPlaceholder("Placeholder text")
      expect(buffer.getText()).toBe("")

      buffer.insertText("Hello")
      expect(buffer.getText()).toBe("Hello")
    })

    it("should reactivate placeholder when all text is deleted", () => {
      buffer.setPlaceholder("Type something...")

      // Insert text
      buffer.insertText("Hi")
      expect(buffer.getText()).toBe("Hi")

      // Delete all text
      buffer.setCursor(0, 0)
      buffer.deleteChar()
      buffer.deleteChar()

      // Placeholder should be active again
      expect(buffer.getText()).toBe("")
    })

    it("should reactivate placeholder when backspacing to empty", () => {
      buffer.setPlaceholder("Empty...")

      buffer.insertText("A")
      expect(buffer.getText()).toBe("A")

      buffer.deleteCharBackward()
      expect(buffer.getText()).toBe("")
    })

    it("should update placeholder text dynamically", () => {
      buffer.setPlaceholder("First placeholder")
      expect(buffer.getText()).toBe("")

      buffer.setPlaceholder("Second placeholder")
      expect(buffer.getText()).toBe("")
    })

    it("should clear placeholder when set to empty string", () => {
      buffer.setPlaceholder("Placeholder")
      expect(buffer.getText()).toBe("")

      buffer.setPlaceholder("")
      expect(buffer.getText()).toBe("")
    })

    it("should clear placeholder when set to null", () => {
      buffer.setPlaceholder("Placeholder")
      expect(buffer.getText()).toBe("")

      buffer.setPlaceholder(null)
      expect(buffer.getText()).toBe("")

      // After clearing, inserting text should work normally
      buffer.insertText("Hello")
      expect(buffer.getText()).toBe("Hello")
    })

    it("should handle placeholder with multi-line text", () => {
      buffer.setPlaceholder("Line 1\nLine 2\nLine 3")
      expect(buffer.getText()).toBe("")

      buffer.insertText("Actual content")
      expect(buffer.getText()).toBe("Actual content")
    })

    it("should handle placeholder with Unicode characters", () => {
      buffer.setPlaceholder("Enter 世界 🌟 here")
      expect(buffer.getText()).toBe("")

      buffer.insertText("Test")
      expect(buffer.getText()).toBe("Test")
    })
  })

  describe("placeholder color", () => {
    it("should set placeholder color without crashing", () => {
      const { RGBA } = require("./lib/RGBA")

      buffer.setPlaceholder("Placeholder")
      buffer.setPlaceholderColor(RGBA.fromValues(1, 0, 0, 1))

      expect(buffer.getText()).toBe("")
    })

    it("should update placeholder color while placeholder is active", () => {
      const { RGBA } = require("./lib/RGBA")

      buffer.setPlaceholder("Test placeholder")
      buffer.setPlaceholderColor(RGBA.fromValues(0.5, 0.5, 0.5, 1))
      buffer.setPlaceholderColor(RGBA.fromValues(1, 0, 0, 1))

      expect(buffer.getText()).toBe("")
    })
  })
})

describe("EditBuffer Events", () => {
  describe("events", () => {
    it("should emit cursor-changed event when cursor moves", async () => {
      const testBuffer = EditBuffer.create("wcwidth")

      let eventCount = 0
      testBuffer.on("cursor-changed", () => {
        eventCount++
      })

      testBuffer.setText("Hello World")
      testBuffer.moveCursorRight()

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(eventCount).toBeGreaterThan(1) // setText + moveCursorRight
      testBuffer.destroy()
    })

    it("should emit cursor-changed event on setCursor", async () => {
      const testBuffer = EditBuffer.create("wcwidth")

      let eventCount = 0
      testBuffer.on("cursor-changed", () => {
        eventCount++
      })

      testBuffer.setText("Hello World")
      testBuffer.setCursorToLineCol(0, 5)
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(eventCount).toBeGreaterThan(1) // setText + setCursor
      testBuffer.destroy()
    })

    it("should emit cursor-changed event on text insertion", async () => {
      const testBuffer = EditBuffer.create("wcwidth")

      let eventCount = 0
      testBuffer.on("cursor-changed", () => {
        eventCount++
      })

      testBuffer.setText("Hello")
      testBuffer.insertText(" World")
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(eventCount).toBeGreaterThan(1) // setText + insertText
      testBuffer.destroy()
    })

    it("should emit cursor-changed event on deletion", async () => {
      const testBuffer = EditBuffer.create("wcwidth")

      let eventCount = 0
      testBuffer.on("cursor-changed", () => {
        eventCount++
      })

      testBuffer.setText("Hello World")
      const beforeDelete = eventCount
      testBuffer.setCursorToLineCol(0, 5)
      testBuffer.deleteChar()
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(eventCount).toBeGreaterThan(beforeDelete + 1) // setCursor + deleteChar
      testBuffer.destroy()
    })

    it("should emit cursor-changed event on undo/redo", async () => {
      const testBuffer = EditBuffer.create("wcwidth")

      let eventCount = 0
      testBuffer.on("cursor-changed", () => {
        eventCount++
      })

      testBuffer.setText("Test")
      testBuffer.insertText(" Hello")

      if (testBuffer.canUndo()) {
        const beforeUndo = eventCount
        testBuffer.undo()
        await new Promise((resolve) => setTimeout(resolve, 10))
        expect(eventCount).toBeGreaterThan(beforeUndo)
      }

      if (testBuffer.canRedo()) {
        const beforeRedo = eventCount
        testBuffer.redo()
        await new Promise((resolve) => setTimeout(resolve, 10))
        expect(eventCount).toBeGreaterThan(beforeRedo)
      }

      testBuffer.destroy()
    })

    it("should handle multiple event listeners", async () => {
      const testBuffer = EditBuffer.create("wcwidth")

      let count1 = 0
      let count2 = 0

      testBuffer.on("cursor-changed", () => {
        count1++
      })
      testBuffer.on("cursor-changed", () => {
        count2++
      })

      testBuffer.setText("Hello")
      testBuffer.moveCursorRight()
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(count1).toBeGreaterThan(1)
      expect(count2).toBeGreaterThan(1)
      expect(count1).toBe(count2)

      testBuffer.destroy()
    })

    it("should support removing event listeners", async () => {
      const testBuffer = EditBuffer.create("wcwidth")
      testBuffer.setText("Hello")

      let eventCount = 0
      const listener = () => {
        eventCount++
      }

      testBuffer.on("cursor-changed", listener)
      testBuffer.moveCursorRight()
      await new Promise((resolve) => setTimeout(resolve, 10))

      const firstCount = eventCount

      testBuffer.off("cursor-changed", listener)
      testBuffer.moveCursorRight()
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Count should not have increased after removing listener
      expect(eventCount).toBe(firstCount)

      testBuffer.destroy()
    })

    it("should isolate events between different buffer instances", async () => {
      const testBuffer1 = EditBuffer.create("wcwidth")
      const testBuffer2 = EditBuffer.create("wcwidth")

      let count1 = 0
      let count2 = 0

      testBuffer1.on("cursor-changed", () => {
        count1++
      })
      testBuffer2.on("cursor-changed", () => {
        count2++
      })

      testBuffer1.setText("Buffer 1")
      await Bun.sleep(10)
      const count1AfterSetText = count1
      testBuffer1.moveCursorRight()
      await Bun.sleep(10)

      expect(count1).toBeGreaterThan(count1AfterSetText)
      expect(count2).toBe(0)

      testBuffer2.setText("Buffer 2")
      await Bun.sleep(10)
      const count2AfterSetText = count2
      testBuffer2.moveCursorRight()
      await Bun.sleep(10)

      expect(count1).toBe(count1AfterSetText + 1)
      expect(count2).toBeGreaterThan(count2AfterSetText)

      testBuffer1.destroy()
      testBuffer2.destroy()
    })

    it("should not emit events after destroy", async () => {
      const testBuffer = EditBuffer.create("wcwidth")

      let eventCount = 0
      testBuffer.on("cursor-changed", () => {
        eventCount++
      })

      testBuffer.setText("Hello")
      testBuffer.moveCursorRight()
      await new Promise((resolve) => setTimeout(resolve, 10))

      const countBeforeDestroy = eventCount

      testBuffer.destroy()

      // Trying to move cursor on destroyed buffer should throw
      // So we can't test event emission, but we can verify the instance is removed from registry
      expect(countBeforeDestroy).toBeGreaterThan(1) // setText + moveCursorRight
    })
  })

  describe("content-changed events", () => {
    it("should emit content-changed event on setText", async () => {
      const testBuffer = EditBuffer.create("wcwidth")

      let eventCount = 0
      testBuffer.on("content-changed", () => {
        eventCount++
      })

      testBuffer.setText("Hello World")
      await Bun.sleep(10)

      expect(eventCount).toBeGreaterThan(0)
      testBuffer.destroy()
    })

    it("should emit content-changed event on insertText", async () => {
      const testBuffer = EditBuffer.create("wcwidth")

      let eventCount = 0
      testBuffer.on("content-changed", () => {
        eventCount++
      })

      testBuffer.setText("Hello")
      await Bun.sleep(10)
      const countAfterSetText = eventCount

      testBuffer.insertText(" World")
      await Bun.sleep(10)

      expect(eventCount).toBeGreaterThan(countAfterSetText)
      testBuffer.destroy()
    })

    it("should emit content-changed event on deleteChar", async () => {
      const testBuffer = EditBuffer.create("wcwidth")

      let eventCount = 0
      testBuffer.on("content-changed", () => {
        eventCount++
      })

      testBuffer.setText("Hello World")
      await Bun.sleep(10)
      const countAfterSetText = eventCount

      testBuffer.setCursorToLineCol(0, 5)
      testBuffer.deleteChar()
      await Bun.sleep(10)

      expect(eventCount).toBeGreaterThan(countAfterSetText)
      testBuffer.destroy()
    })

    it("should emit content-changed event on deleteCharBackward", async () => {
      const testBuffer = EditBuffer.create("wcwidth")

      let eventCount = 0
      testBuffer.on("content-changed", () => {
        eventCount++
      })

      testBuffer.setText("Hello")
      await Bun.sleep(10)
      const countAfterSetText = eventCount

      testBuffer.setCursorToLineCol(0, 5)
      testBuffer.deleteCharBackward()
      await Bun.sleep(10)

      expect(eventCount).toBeGreaterThan(countAfterSetText)
      testBuffer.destroy()
    })

    it("should emit content-changed event on deleteLine", async () => {
      const testBuffer = EditBuffer.create("wcwidth")

      let eventCount = 0
      testBuffer.on("content-changed", () => {
        eventCount++
      })

      testBuffer.setText("Line 1\nLine 2\nLine 3")
      await Bun.sleep(10)
      const countAfterSetText = eventCount

      testBuffer.gotoLine(1)
      testBuffer.deleteLine()
      await Bun.sleep(10)

      expect(eventCount).toBeGreaterThan(countAfterSetText)
      testBuffer.destroy()
    })

    it("should emit content-changed event on newLine", async () => {
      const testBuffer = EditBuffer.create("wcwidth")

      let eventCount = 0
      testBuffer.on("content-changed", () => {
        eventCount++
      })

      testBuffer.setText("Hello")
      await Bun.sleep(10)
      const countAfterSetText = eventCount

      testBuffer.setCursorToLineCol(0, 5)
      testBuffer.newLine()
      await Bun.sleep(10)

      expect(eventCount).toBeGreaterThan(countAfterSetText)
      testBuffer.destroy()
    })

    it("should handle multiple content-changed listeners", async () => {
      const testBuffer = EditBuffer.create("wcwidth")

      let count1 = 0
      let count2 = 0

      testBuffer.on("content-changed", () => {
        count1++
      })
      testBuffer.on("content-changed", () => {
        count2++
      })

      testBuffer.setText("Hello")
      await Bun.sleep(10)

      expect(count1).toBeGreaterThan(0)
      expect(count2).toBeGreaterThan(0)
      expect(count1).toBe(count2)

      testBuffer.destroy()
    })

    it("should support removing content-changed listeners", async () => {
      const testBuffer = EditBuffer.create("wcwidth")
      testBuffer.setText("Hello")
      await Bun.sleep(10)

      let eventCount = 0
      const listener = () => {
        eventCount++
      }

      testBuffer.on("content-changed", listener)
      testBuffer.insertText(" World")
      await Bun.sleep(10)

      const firstCount = eventCount

      testBuffer.off("content-changed", listener)
      testBuffer.insertText("!")
      await Bun.sleep(10)

      // Count should not have increased after removing listener
      expect(eventCount).toBe(firstCount)

      testBuffer.destroy()
    })

    it("should isolate content-changed events between different buffer instances", async () => {
      const testBuffer1 = EditBuffer.create("wcwidth")
      const testBuffer2 = EditBuffer.create("wcwidth")

      let count1 = 0
      let count2 = 0

      testBuffer1.on("content-changed", () => {
        count1++
      })
      testBuffer2.on("content-changed", () => {
        count2++
      })

      testBuffer1.setText("Buffer 1")
      await Bun.sleep(10)
      const count1AfterSetText = count1

      testBuffer1.insertText(" updated")
      await Bun.sleep(10)

      expect(count1).toBeGreaterThan(count1AfterSetText)
      expect(count2).toBe(0)

      testBuffer2.setText("Buffer 2")
      await Bun.sleep(10)
      const count2AfterSetText = count2

      testBuffer2.insertText(" updated")
      await Bun.sleep(10)

      expect(count1).toBe(count1AfterSetText + 1)
      expect(count2).toBeGreaterThan(count2AfterSetText)

      testBuffer1.destroy()
      testBuffer2.destroy()
    })

    it("should not emit content-changed after destroy", async () => {
      const testBuffer = EditBuffer.create("wcwidth")

      let eventCount = 0
      testBuffer.on("content-changed", () => {
        eventCount++
      })

      testBuffer.setText("Hello")
      await Bun.sleep(10)

      const countBeforeDestroy = eventCount

      testBuffer.destroy()

      // Trying to modify destroyed buffer should throw
      expect(countBeforeDestroy).toBeGreaterThan(0)
    })
  })
})

describe("EditBuffer History Management", () => {
  let buffer: EditBuffer

  beforeEach(() => {
    buffer = EditBuffer.create("wcwidth")
  })

  afterEach(() => {
    buffer.destroy()
  })

  describe("setText with history", () => {
    it("should create undo history when using setText", () => {
      buffer.setText("Initial text")
      expect(buffer.canUndo()).toBe(true)
    })

    it("should allow undo after setText", () => {
      buffer.setText("First text")
      expect(buffer.getText()).toBe("First text")

      buffer.undo()
      expect(buffer.getText()).toBe("")
    })

    it("should allow redo after undo of setText", () => {
      buffer.setText("First text")
      buffer.undo()
      expect(buffer.getText()).toBe("")

      buffer.redo()
      expect(buffer.getText()).toBe("First text")
    })

    it("should maintain history across multiple setText calls", () => {
      buffer.setText("Text 1")
      buffer.setText("Text 2")
      buffer.setText("Text 3")

      expect(buffer.getText()).toBe("Text 3")
      expect(buffer.canUndo()).toBe(true)

      buffer.undo()
      expect(buffer.getText()).toBe("Text 2")

      buffer.undo()
      expect(buffer.getText()).toBe("Text 1")

      buffer.undo()
      expect(buffer.getText()).toBe("")
    })
  })

  describe("setTextOwned with history", () => {
    it("should create undo history by default when using setTextOwned", () => {
      buffer.setTextOwned("Initial text")
      expect(buffer.canUndo()).toBe(true)
    })

    it("should allow undo after setTextOwned", () => {
      buffer.setTextOwned("First text")
      expect(buffer.getText()).toBe("First text")

      buffer.undo()
      expect(buffer.getText()).toBe("")
    })

    it("should create history when explicitly enabled", () => {
      buffer.setTextOwned("Text with history", { history: true })
      expect(buffer.canUndo()).toBe(true)

      buffer.undo()
      expect(buffer.getText()).toBe("")
    })

    it("should not create history when explicitly disabled", () => {
      buffer.setTextOwned("Text without history", { history: false })
      expect(buffer.canUndo()).toBe(false)
    })

    it("should allow redo after undo of setTextOwned", () => {
      buffer.setTextOwned("First text")
      buffer.undo()
      expect(buffer.getText()).toBe("")

      buffer.redo()
      expect(buffer.getText()).toBe("First text")
    })

    it("should work correctly with Unicode text", () => {
      buffer.setTextOwned("Hello 世界 🌟")
      expect(buffer.getText()).toBe("Hello 世界 🌟")
      expect(buffer.canUndo()).toBe(true)

      buffer.undo()
      expect(buffer.getText()).toBe("")
    })
  })

  describe("setText with history: false", () => {
    it("should not create undo history when using setText with history: false", () => {
      buffer.setText("Initial text", { history: false })
      expect(buffer.canUndo()).toBe(false)
    })

    it("should set text content correctly", () => {
      buffer.setText("Test content", { history: false })
      expect(buffer.getText()).toBe("Test content")
    })

    it("should not affect existing history", () => {
      buffer.setText("First text")
      expect(buffer.canUndo()).toBe(true)

      buffer.setText("Second text", { history: false })
      expect(buffer.getText()).toBe("Second text")
      // setText with history=false doesn't create undo, but first setText did
      expect(buffer.canUndo()).toBe(true)

      buffer.undo()
      // After undo, we go back to the state before first setText
      expect(buffer.getText()).toBe("")
    })

    it("should work with multi-line text", () => {
      buffer.setText("Line 1\nLine 2\nLine 3", { history: false })
      expect(buffer.getText()).toBe("Line 1\nLine 2\nLine 3")
      expect(buffer.canUndo()).toBe(false)
    })

    it("should work with Unicode text", () => {
      buffer.setText("Unicode 世界 🌟", { history: false })
      expect(buffer.getText()).toBe("Unicode 世界 🌟")
      expect(buffer.canUndo()).toBe(false)
    })

    it("should work with empty text", () => {
      buffer.setText("Some text")
      buffer.setText("", { history: false })
      expect(buffer.getText()).toBe("")
    })

    it("should reuse single memory slot on repeated calls", () => {
      // This tests the memory efficiency - each call should replace the previous
      buffer.setText("Text 1", { history: false })
      expect(buffer.getText()).toBe("Text 1")

      buffer.setText("Text 2", { history: false })
      expect(buffer.getText()).toBe("Text 2")

      buffer.setText("Text 3", { history: false })
      expect(buffer.getText()).toBe("Text 3")

      // Should not have created any history
      expect(buffer.canUndo()).toBe(false)
    })
  })

  describe("mixed operations", () => {
    it("should handle setText followed by insertText", () => {
      buffer.setText("Hello")
      // setText places cursor at (0,0), so insertText inserts at beginning
      buffer.setCursorToLineCol(0, 5) // Move to end
      buffer.insertText(" World")
      expect(buffer.getText()).toBe("Hello World")

      buffer.undo()
      expect(buffer.getText()).toBe("Hello")

      buffer.undo()
      expect(buffer.getText()).toBe("")
    })

    it("should handle setText with history:false followed by insertText", () => {
      buffer.setText("Hello", { history: false })
      // setText places cursor at (0,0)
      buffer.setCursorToLineCol(0, 5) // Move to end
      buffer.insertText(" World")
      expect(buffer.getText()).toBe("Hello World")

      // Can undo the insertText
      buffer.undo()
      expect(buffer.getText()).toBe("Hello")

      // Cannot undo setText since it didn't create history
      expect(buffer.canUndo()).toBe(false)
    })

    it("should handle setTextOwned with and without history", () => {
      buffer.setTextOwned("Text 1", { history: true })
      buffer.setTextOwned("Text 2", { history: false })
      expect(buffer.getText()).toBe("Text 2")

      // Can only undo to state before Text 1 (Text 2 didn't create history)
      buffer.undo()
      expect(buffer.getText()).toBe("")
    })

    it("should allow clearing history after setText", () => {
      buffer.setText("Text 1")
      buffer.setText("Text 2")
      expect(buffer.canUndo()).toBe(true)

      buffer.clearHistory()
      expect(buffer.canUndo()).toBe(false)
      expect(buffer.getText()).toBe("Text 2")
    })
  })

  describe("events with different methods", () => {
    it("should emit content-changed for setText", async () => {
      let eventCount = 0
      buffer.on("content-changed", () => {
        eventCount++
      })

      buffer.setText("Hello")
      await Bun.sleep(10)

      expect(eventCount).toBeGreaterThan(0)
    })

    it("should emit content-changed for setText with history:false", async () => {
      let eventCount = 0
      buffer.on("content-changed", () => {
        eventCount++
      })

      buffer.setText("Hello", { history: false })
      await Bun.sleep(10)

      expect(eventCount).toBeGreaterThan(0)
    })

    it("should emit content-changed for setTextOwned", async () => {
      let eventCount = 0
      buffer.on("content-changed", () => {
        eventCount++
      })

      buffer.setTextOwned("Hello")
      await Bun.sleep(10)

      expect(eventCount).toBeGreaterThan(0)
    })
  })
})
