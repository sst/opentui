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
      expect(cursor.charPos).toBe(0)
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

      buffer.moveCursorToLineEnd()
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

      buffer.moveCursorToLineEnd()
      expect(buffer.getCursorPosition().visualColumn).toBe(11)

      buffer.moveCursorToLineStart()
      expect(buffer.getCursorPosition().visualColumn).toBe(0)
    })

    it("should move to buffer start and end", () => {
      buffer.setText("Line 1\nLine 2\nLine 3")

      buffer.moveCursorToBufferEnd()
      let cursor = buffer.getCursorPosition()
      expect(cursor.line).toBe(2)
      expect(cursor.visualColumn).toBe(6)

      buffer.moveCursorToBufferStart()
      cursor = buffer.getCursorPosition()
      expect(cursor.line).toBe(0)
      expect(cursor.visualColumn).toBe(0)
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

      buffer.moveCursorToLineEnd()
      buffer.insertChar("!")

      expect(buffer.getText()).toBe("Hello World!")
    })

    it("should insert text at cursor", () => {
      buffer.setText("Hello")

      buffer.moveCursorToLineEnd()
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

      buffer.moveCursorToLineEnd()
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

      buffer.gotoLine(1)
      buffer.deleteLine()

      expect(buffer.getText()).toBe("Line 1\nLine 3")
    })

    it("should delete to line end", () => {
      buffer.setText("Hello World")

      buffer.setCursorToLineCol(0, 6)
      buffer.deleteToLineEnd()

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

      buffer.moveCursorToLineEnd()
      buffer.insertText("!")

      buffer.moveCursorToBufferStart()
      buffer.insertText(">> ")

      buffer.moveCursorToLineEnd()
      buffer.newLine()
      buffer.insertText("New line")

      expect(buffer.getText()).toBe(">> Hello World!\nNew line")
    })

    it("should handle insert, delete, and cursor movement", () => {
      buffer.setText("AAAA\nBBBB\nCCCC")

      buffer.gotoLine(1)
      buffer.moveCursorToLineEnd()
      buffer.insertText("X")

      const text1 = buffer.getText()
      expect(text1).toBe("AAAA\nBBBBX\nCCCC")

      // After insert, cursor is at end, deleteCharBackward will delete X
      buffer.deleteCharBackward()

      expect(buffer.getText()).toBe("AAAA\nBBBB\nCCCC")
    })

    it("should handle line operations", () => {
      buffer.setText("Line 1\nLine 2\nLine 3")

      buffer.gotoLine(1)
      buffer.deleteLine()

      expect(buffer.getText()).toBe("Line 1\nLine 3")
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

  describe("getTextBufferPtr", () => {
    it("should return valid TextBuffer pointer", () => {
      buffer.setText("Test")
      const ptr = buffer.getTextBufferPtr()
      expect(ptr).toBeDefined()
      expect(typeof ptr).toBe("number")
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
})
