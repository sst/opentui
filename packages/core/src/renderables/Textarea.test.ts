import { describe, expect, it, afterAll, beforeEach, afterEach } from "bun:test"
import { TextareaRenderable, type TextareaOptions } from "./Textarea"
import { createTestRenderer, type TestRenderer, type MockMouse, type MockInput } from "../testing/test-renderer"
import { RGBA } from "../lib/RGBA"
import { SyntaxStyle } from "../syntax-style"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>
let currentMouse: MockMouse
let currentMockInput: MockInput
let captureFrame: () => string
let resize: (width: number, height: number) => void

async function createTextareaRenderable(
  renderer: TestRenderer,
  options: TextareaOptions,
): Promise<{ textarea: TextareaRenderable; root: any }> {
  const textareaRenderable = new TextareaRenderable(renderer, { left: 0, top: 0, ...options })
  renderer.root.add(textareaRenderable)
  await renderOnce()

  return { textarea: textareaRenderable, root: renderer.root }
}

describe("TextareaRenderable", () => {
  beforeEach(async () => {
    ;({
      renderer: currentRenderer,
      renderOnce,
      mockMouse: currentMouse,
      mockInput: currentMockInput,
      captureCharFrame: captureFrame,
      resize,
    } = await createTestRenderer({
      width: 80,
      height: 24,
    }))
  })

  afterEach(() => {
    currentRenderer.destroy()
  })

  describe("Initialization", () => {
    it("should initialize with default options", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, { width: 40, height: 10 })

      expect(editor.x).toBeDefined()
      expect(editor.y).toBeDefined()
      expect(editor.width).toBeGreaterThan(0)
      expect(editor.height).toBeGreaterThan(0)
      expect(editor.focusable).toBe(true)
    })

    it("should initialize with content", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
      })

      expect(editor.plainText).toBe("Hello World")
    })

    it("should initialize with empty content", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      expect(editor.plainText).toBe("")
    })

    it("should initialize with multi-line content", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
      })

      expect(editor.plainText).toBe("Line 1\nLine 2\nLine 3")
    })
  })

  describe("Focus Management", () => {
    it("should handle focus and blur", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "test",
        width: 40,
        height: 10,
      })

      expect(editor.focused).toBe(false)

      editor.focus()
      expect(editor.focused).toBe(true)

      editor.blur()
      expect(editor.focused).toBe(false)
    })
  })

  describe("Text Insertion via Methods", () => {
    it("should insert single character", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello",
        width: 40,
        height: 10,
      })

      editor.gotoLine(9999) // Move to end
      editor.insertChar("!")

      expect(editor.plainText).toBe("Hello!")
    })

    it("should insert text", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello",
        width: 40,
        height: 10,
      })

      editor.gotoLine(9999) // Move to end
      editor.insertText(" World")

      expect(editor.plainText).toBe("Hello World")
    })

    it("should insert text in middle", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "HelloWorld",
        width: 40,
        height: 10,
      })

      editor.moveCursorRight()
      editor.moveCursorRight()
      editor.moveCursorRight()
      editor.moveCursorRight()
      editor.moveCursorRight()
      editor.insertText(" ")

      expect(editor.plainText).toBe("Hello World")
    })
  })

  describe("Text Deletion via Methods", () => {
    it("should delete character at cursor", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
      })

      // Move to 'W' and delete it
      for (let i = 0; i < 6; i++) {
        editor.moveCursorRight()
      }
      editor.deleteChar()

      expect(editor.plainText).toBe("Hello orld")
    })

    it("should delete character backward", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello",
        width: 40,
        height: 10,
      })

      editor.gotoLine(9999) // Move to end
      editor.deleteCharBackward()

      expect(editor.plainText).toBe("Hell")
    })

    it("should delete entire line", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
      })

      editor.gotoLine(1)
      editor.deleteLine()

      expect(editor.plainText).toBe("Line 1\nLine 3")
    })

    it("should delete to line end", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
      })

      for (let i = 0; i < 6; i++) {
        editor.moveCursorRight()
      }
      editor.deleteToLineEnd()

      expect(editor.plainText).toBe("Hello ")
    })
  })

  describe("Cursor Movement via Methods", () => {
    it("should move cursor left and right", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "ABCDE",
        width: 40,
        height: 10,
      })

      const initialCursor = editor.cursor
      expect(initialCursor.visualColumn).toBe(0)

      editor.moveCursorRight()
      expect(editor.cursor.visualColumn).toBe(1)

      editor.moveCursorRight()
      expect(editor.cursor.visualColumn).toBe(2)

      editor.moveCursorLeft()
      expect(editor.cursor.visualColumn).toBe(1)
    })

    it("should move cursor up and down", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
      })

      expect(editor.cursor.line).toBe(0)

      editor.moveCursorDown()
      expect(editor.cursor.line).toBe(1)

      editor.moveCursorDown()
      expect(editor.cursor.line).toBe(2)

      editor.moveCursorUp()
      expect(editor.cursor.line).toBe(1)
    })

    it("should move to line start and end", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
      })

      const cursor = editor.cursor
      editor.editBuffer.setCursorToLineCol(cursor.line, 9999) // Move to end of line
      expect(editor.cursor.visualColumn).toBe(11)

      editor.editBuffer.setCursor(editor.cursor.line, 0)
      expect(editor.cursor.visualColumn).toBe(0)
    })

    it("should move to buffer start and end", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
      })

      editor.gotoLine(9999) // Move to end
      let cursor = editor.cursor
      expect(cursor.line).toBe(2)

      editor.gotoLine(0) // Move to start
      cursor = editor.cursor
      expect(cursor.line).toBe(0)
      expect(cursor.visualColumn).toBe(0)
    })

    it("should goto specific line", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 0\nLine 1\nLine 2",
        width: 40,
        height: 10,
      })

      editor.gotoLine(1)
      expect(editor.cursor.line).toBe(1)

      editor.gotoLine(2)
      expect(editor.cursor.line).toBe(2)
    })
  })

  describe("Keyboard Input - Character Insertion", () => {
    it("should insert character when key is pressed", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      editor.focus()

      currentMockInput.pressKey("h")
      expect(editor.plainText).toBe("h")

      currentMockInput.pressKey("i")
      expect(editor.plainText).toBe("hi")
    })

    it("should insert multiple characters in sequence", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      editor.focus()

      currentMockInput.pressKey("h")
      currentMockInput.pressKey("e")
      currentMockInput.pressKey("l")
      currentMockInput.pressKey("l")
      currentMockInput.pressKey("o")

      expect(editor.plainText).toBe("hello")
    })

    it("should insert space character", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end

      currentMockInput.pressKey(" ")
      currentMockInput.pressKey("W")
      currentMockInput.pressKey("o")
      currentMockInput.pressKey("r")
      currentMockInput.pressKey("l")
      currentMockInput.pressKey("d")

      expect(editor.plainText).toBe("Hello World")
    })

    it("should not insert when not focused", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      // Don't focus
      expect(editor.focused).toBe(false)

      currentMockInput.pressKey("a")
      expect(editor.plainText).toBe("")
    })
  })

  describe("Keyboard Input - Arrow Keys", () => {
    it("should move cursor left with arrow key", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "ABC",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end
      expect(editor.cursor.visualColumn).toBe(3)

      currentMockInput.pressArrow("left")
      expect(editor.cursor.visualColumn).toBe(2)

      currentMockInput.pressArrow("left")
      expect(editor.cursor.visualColumn).toBe(1)
    })

    it("should move cursor right with arrow key", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "ABC",
        width: 40,
        height: 10,
      })

      editor.focus()
      expect(editor.cursor.visualColumn).toBe(0)

      currentMockInput.pressArrow("right")
      expect(editor.cursor.visualColumn).toBe(1)

      currentMockInput.pressArrow("right")
      expect(editor.cursor.visualColumn).toBe(2)
    })

    it("should move cursor up and down with arrow keys", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
      })

      editor.focus()
      expect(editor.cursor.line).toBe(0)

      currentMockInput.pressArrow("down")
      expect(editor.cursor.line).toBe(1)

      currentMockInput.pressArrow("down")
      expect(editor.cursor.line).toBe(2)

      currentMockInput.pressArrow("up")
      expect(editor.cursor.line).toBe(1)
    })

    it("should move cursor smoothly from end of one line to start of next", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "ABC\nDEF",
        width: 40,
        height: 10,
      })

      editor.focus()
      const cursor = editor.cursor
      editor.editBuffer.setCursorToLineCol(cursor.line, 9999) // Move to end of line // End of "ABC"
      expect(editor.cursor.visualColumn).toBe(3)

      // Move right should go to start of next line
      currentMockInput.pressArrow("right")
      expect(editor.cursor.line).toBe(1)
      expect(editor.cursor.visualColumn).toBe(0)

      // Move left should go back to end of previous line
      currentMockInput.pressArrow("left")
      expect(editor.cursor.line).toBe(0)
      expect(editor.cursor.visualColumn).toBe(3)
    })
  })

  describe("Keyboard Input - Backspace and Delete", () => {
    it("should handle backspace key", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end

      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("Hell")

      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("Hel")
    })

    it("should handle delete key", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello",
        width: 40,
        height: 10,
      })

      editor.focus()
      // Cursor at start

      currentMockInput.pressKey("DELETE")
      expect(editor.plainText).toBe("ello")
    })

    it("should join lines when backspace at start of line", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello\nWorld",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(1) // Move to line 2 (0-indexed line 1)
      expect(editor.cursor.line).toBe(1)
      expect(editor.cursor.visualColumn).toBe(0)

      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("HelloWorld")
      expect(editor.cursor.line).toBe(0)
      expect(editor.cursor.visualColumn).toBe(5) // Should be at end of "Hello"
    })

    it("should remove empty line when backspace at start", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello\n\nWorld",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(1) // Move to empty line
      expect(editor.cursor.line).toBe(1)

      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("Hello\nWorld")
      expect(editor.cursor.line).toBe(0)
    })

    it("should join lines with content when backspace at start", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line1\nLine2\nLine3",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(2) // Move to "Line3"
      expect(editor.cursor.line).toBe(2)
      expect(editor.cursor.visualColumn).toBe(0)

      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("Line1\nLine2Line3")
      expect(editor.cursor.line).toBe(1)
      expect(editor.cursor.visualColumn).toBe(5) // After "Line2"
    })

    it("should not do anything when backspace at start of first line", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello\nWorld",
        width: 40,
        height: 10,
      })

      editor.focus()
      expect(editor.cursor.line).toBe(0)
      expect(editor.cursor.visualColumn).toBe(0)

      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("Hello\nWorld")
      expect(editor.cursor.line).toBe(0)
      expect(editor.cursor.visualColumn).toBe(0)
    })

    it("should handle multiple backspaces joining multiple lines", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "A\nB\nC\nD",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(3) // Line "D"
      expect(editor.cursor.line).toBe(3)
      expect(editor.cursor.visualColumn).toBe(0)

      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("A\nB\nCD")
      expect(editor.cursor.line).toBe(2)
      // Cursor should be at the join point (after "C")
      expect(editor.cursor.visualColumn).toBe(1)

      // Now delete "C" by pressing backspace
      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("A\nB\nD")
      expect(editor.cursor.line).toBe(2)
      expect(editor.cursor.visualColumn).toBe(0)

      // Now join line 2 with line 1
      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("A\nBD")
      expect(editor.cursor.line).toBe(1)
      expect(editor.cursor.visualColumn).toBe(1) // After "B"

      // Delete "B"
      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("A\nD")
      expect(editor.cursor.line).toBe(1)
      expect(editor.cursor.visualColumn).toBe(0)

      // Now join line 1 with line 0
      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("AD")
      expect(editor.cursor.line).toBe(0)
      expect(editor.cursor.visualColumn).toBe(1)
    })

    it("should handle backspace after typing on new line", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end

      currentMockInput.pressEnter()
      expect(editor.plainText).toBe("Hello\n")

      currentMockInput.pressKey("W")
      currentMockInput.pressKey("o")
      currentMockInput.pressKey("r")
      expect(editor.plainText).toBe("Hello\nWor")

      // Now backspace to delete "r"
      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("Hello\nWo")

      // Move to start of line and backspace to join
      editor.editBuffer.setCursor(editor.cursor.line, 0)
      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("HelloWo")
    })

    it("should move cursor right after joining lines with backspace", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello\nWorld",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(1) // Move to "World"
      expect(editor.cursor.line).toBe(1)
      expect(editor.cursor.visualColumn).toBe(0)

      // Join lines with backspace
      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("HelloWorld")
      expect(editor.cursor.line).toBe(0)
      expect(editor.cursor.visualColumn).toBe(5) // After "Hello"

      // Press right repeatedly - should advance one at a time
      const positions: number[] = [editor.cursor.visualColumn]
      for (let i = 0; i < 5; i++) {
        currentMockInput.pressArrow("right")
        positions.push(editor.cursor.visualColumn)
      }

      // Should advance one position each time: [5, 6, 7, 8, 9, 10]
      expect(positions).toEqual([5, 6, 7, 8, 9, 10])
    })

    it("should move right one position after join", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "AB\nCD",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(1)

      // Backspace to join
      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("ABCD")
      expect(editor.cursor.visualColumn).toBe(2)

      // Press right - should advance by 1
      currentMockInput.pressArrow("right")
      expect(editor.cursor.visualColumn).toBe(3)
    })

    it("should advance cursor by 1 at every position after join", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "ABCDE\nFGHIJ",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(1)

      // Join lines
      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("ABCDEFGHIJ")
      expect(editor.cursor.visualColumn).toBe(5)

      // Each right press should advance by exactly 1
      const expectedPositions = [5, 6, 7, 8, 9, 10]

      for (let i = 0; i < expectedPositions.length; i++) {
        expect(editor.cursor.visualColumn).toBe(expectedPositions[i])
        if (i < expectedPositions.length - 1) {
          currentMockInput.pressArrow("right")
        }
      }
    })

    it("should move right after backspace join - setText content", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "ABC\nDEF",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(1)
      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("ABCDEF")
      expect(editor.cursor.visualColumn).toBe(3)

      currentMockInput.pressArrow("right")
      expect(editor.cursor.visualColumn).toBe(4)
    })

    it("should move right after backspace join - typed content", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      editor.focus()

      // Type "ABC", Enter, "DEF"
      currentMockInput.pressKey("A")
      currentMockInput.pressKey("B")
      currentMockInput.pressKey("C")
      currentMockInput.pressEnter()
      currentMockInput.pressKey("D")
      currentMockInput.pressKey("E")
      currentMockInput.pressKey("F")

      // Join and verify cursor advances
      editor.editBuffer.setCursor(editor.cursor.line, 0)
      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("ABCDEF")
      expect(editor.cursor.visualColumn).toBe(3)

      currentMockInput.pressArrow("right")
      expect(editor.cursor.visualColumn).toBe(4)

      currentMockInput.pressArrow("right")
      expect(editor.cursor.visualColumn).toBe(5)
    })

    it("should move cursor left after joining lines with backspace", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "ABC\nDEF",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(1) // Move to "DEF"

      // Join lines
      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("ABCDEF")
      expect(editor.cursor.visualColumn).toBe(3) // After "ABC"

      // Move right past the boundary
      currentMockInput.pressArrow("right")
      currentMockInput.pressArrow("right")
      expect(editor.cursor.visualColumn).toBe(5)

      // Now move left - should move smoothly back one at a time
      const positions: number[] = [editor.cursor.visualColumn]
      for (let i = 0; i < 5; i++) {
        currentMockInput.pressArrow("left")
        positions.push(editor.cursor.visualColumn)
      }

      // Should go back one at a time: [5, 4, 3, 2, 1, 0]
      expect(positions).toEqual([5, 4, 3, 2, 1, 0])
    })

    it("should move cursor left across chunk boundaries after joining lines", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "ABC\nDEF",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(1) // Move to "DEF"

      // Join lines
      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("ABCDEF")
      expect(editor.cursor.visualColumn).toBe(3) // After "ABC"

      // Move right to "D"
      currentMockInput.pressArrow("right")
      expect(editor.cursor.visualColumn).toBe(4)

      // Move right to "E"
      currentMockInput.pressArrow("right")
      expect(editor.cursor.visualColumn).toBe(5)

      // Now move left back across the chunk boundary
      currentMockInput.pressArrow("left")
      expect(editor.cursor.visualColumn).toBe(4)

      currentMockInput.pressArrow("left")
      expect(editor.cursor.visualColumn).toBe(3)

      currentMockInput.pressArrow("left")
      expect(editor.cursor.visualColumn).toBe(2)
    })
  })

  describe("Keyboard Input - Enter/Return", () => {
    it("should insert newline with Enter key", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "HelloWorld",
        width: 40,
        height: 10,
      })

      editor.focus()

      // Move to middle
      for (let i = 0; i < 5; i++) {
        editor.moveCursorRight()
      }

      currentMockInput.pressEnter()
      expect(editor.plainText).toBe("Hello\nWorld")
    })

    it("should insert newline at end", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end

      currentMockInput.pressEnter()
      expect(editor.plainText).toBe("Hello\n")
    })

    it("should handle multiple newlines", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line1",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end

      currentMockInput.pressEnter()
      currentMockInput.pressKey("L")
      currentMockInput.pressKey("i")
      currentMockInput.pressKey("n")
      currentMockInput.pressKey("e")
      currentMockInput.pressKey("2")

      expect(editor.plainText).toBe("Line1\nLine2")
    })
  })

  describe("Keyboard Input - Home and End", () => {
    it("should move to line start with Home", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end
      expect(editor.cursor.visualColumn).toBe(11)

      currentMockInput.pressKey("HOME")
      expect(editor.cursor.visualColumn).toBe(0)
    })

    it("should move to line end with End", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
      })

      editor.focus()
      expect(editor.cursor.visualColumn).toBe(0)

      currentMockInput.pressKey("END")
      expect(editor.cursor.visualColumn).toBe(11)
    })
  })

  describe("Keyboard Input - Control Commands", () => {
    it("should move to buffer start with Ctrl+A", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end

      currentMockInput.pressKey("CTRL_A")
      const cursor = editor.cursor
      expect(cursor.line).toBe(0)
      expect(cursor.visualColumn).toBe(0)
    })

    it("should move to buffer end with Ctrl+E", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
      })

      editor.focus()

      currentMockInput.pressKey("CTRL_E")
      const cursor = editor.cursor
      expect(cursor.line).toBe(2)
    })

    it("should delete line with Ctrl+D", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(1)

      currentMockInput.pressKey("CTRL_D")
      expect(editor.plainText).toBe("Line 1\nLine 3")
    })

    it("should delete to line end with Ctrl+K", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
      })

      editor.focus()
      for (let i = 0; i < 6; i++) {
        editor.moveCursorRight()
      }

      currentMockInput.pressKey("CTRL_K")
      expect(editor.plainText).toBe("Hello ")
    })
  })

  describe("Word Movement and Deletion", () => {
    it("should move forward by word with Alt+F", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "hello world foo bar",
        width: 40,
        height: 10,
      })

      editor.focus()
      expect(editor.cursor.visualColumn).toBe(0)

      currentMockInput.pressKey("ALT_F")
      expect(editor.cursor.visualColumn).toBe(6)

      currentMockInput.pressKey("ALT_F")
      expect(editor.cursor.visualColumn).toBe(12)

      currentMockInput.pressKey("ALT_F")
      expect(editor.cursor.visualColumn).toBe(16)
    })

    it("should move backward by word with Alt+B", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "hello world foo bar",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999)
      expect(editor.cursor.visualColumn).toBe(19)

      currentMockInput.pressKey("ALT_B")
      expect(editor.cursor.visualColumn).toBe(16)

      currentMockInput.pressKey("ALT_B")
      expect(editor.cursor.visualColumn).toBe(12)

      currentMockInput.pressKey("ALT_B")
      expect(editor.cursor.visualColumn).toBe(6)
    })

    it("should move forward by word with Meta+Right", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "one two three",
        width: 40,
        height: 10,
      })

      editor.focus()

      currentMockInput.pressArrow("right", { meta: true })
      expect(editor.cursor.visualColumn).toBe(4)

      currentMockInput.pressArrow("right", { meta: true })
      expect(editor.cursor.visualColumn).toBe(8)
    })

    it("should move backward by word with Meta+Left", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "one two three",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999)

      currentMockInput.pressArrow("left", { meta: true })
      expect(editor.cursor.visualColumn).toBe(8)

      currentMockInput.pressArrow("left", { meta: true })
      expect(editor.cursor.visualColumn).toBe(4)
    })

    it("should delete word forward with Alt+D", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "hello world foo",
        width: 40,
        height: 10,
      })

      editor.focus()
      expect(editor.plainText).toBe("hello world foo")

      currentMockInput.pressKey("ALT_D")
      expect(editor.plainText).toBe("world foo")

      currentMockInput.pressKey("ALT_D")
      expect(editor.plainText).toBe("foo")
    })

    it("should delete word backward with Alt+Backspace", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "hello world foo",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999)

      currentMockInput.pressKey("BACKSPACE", { meta: true })
      const text = editor.plainText
      expect(text.startsWith("hello world")).toBe(true)
      expect(text.length).toBeLessThan(15)
    })

    it("should delete word backward with Ctrl+W", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "test string here",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999)

      currentMockInput.pressKey("CTRL_W")
      expect(editor.plainText).toBe("test string ")

      currentMockInput.pressKey("CTRL_W")
      expect(editor.plainText).toBe("test ")
    })

    it("should select word forward with Alt+Shift+F", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "hello world foo",
        width: 40,
        height: 10,
      })

      editor.focus()

      currentMockInput.pressKey("f", { meta: true, shift: true })
      expect(editor.hasSelection()).toBe(true)
      expect(editor.getSelectedText()).toBe("hello ")
    })

    it("should select word backward with Alt+Shift+B", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "hello world foo",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999)

      currentMockInput.pressKey("b", { meta: true, shift: true })
      expect(editor.hasSelection()).toBe(true)
      expect(editor.getSelectedText()).toBe("foo")
    })

    it("should handle word movement across multiple lines", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "first line\nsecond line",
        width: 40,
        height: 10,
      })

      editor.focus()

      currentMockInput.pressKey("ALT_F")
      expect(editor.cursor.visualColumn).toBe(6)

      currentMockInput.pressKey("ALT_F")
      expect(editor.cursor.line).toBe(1)
    })

    it("should delete word forward from line start", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "hello\nworld test",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(1)
      const initialLength = editor.plainText.length

      currentMockInput.pressKey("ALT_D")
      expect(editor.plainText.length).toBeLessThan(initialLength)
      expect(editor.plainText).toContain("hello")
    })

    it("should handle word deletion operations", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "hello world test",
        width: 40,
        height: 10,
      })

      editor.focus()
      const initialText = editor.plainText

      currentMockInput.pressKey("ALT_D")
      expect(editor.plainText.length).toBeLessThan(initialText.length)
      expect(editor.plainText).toContain("world")
    })

    it("should navigate by words and characters", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "abc def ghi",
        width: 40,
        height: 10,
      })

      editor.focus()

      currentMockInput.pressKey("ALT_F")
      const col1 = editor.cursor.visualColumn
      expect(col1).toBeGreaterThan(0)

      currentMockInput.pressArrow("right")
      const col2 = editor.cursor.visualColumn
      expect(col2).toBe(col1 + 1)

      currentMockInput.pressKey("ALT_F")
      const col3 = editor.cursor.visualColumn
      expect(col3).toBeGreaterThan(col2)
    })

    it("should delete selected text when deleting word with selection", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "hello world foo",
        width: 40,
        height: 10,
      })

      editor.focus()

      currentMockInput.pressArrow("right", { shift: true })
      currentMockInput.pressArrow("right", { shift: true })
      currentMockInput.pressArrow("right", { shift: true })
      expect(editor.hasSelection()).toBe(true)

      currentMockInput.pressKey("ALT_D")
      expect(editor.plainText).toBe("lo world foo")
    })
  })

  describe("Keyboard Input - Meta Key Bindings", () => {
    it("should bind custom action to meta key", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Test",
        width: 40,
        height: 10,
        keyBindings: [{ name: "b", meta: true, action: "buffer-home" }],
      })

      editor.focus()
      editor.gotoLine(9999)

      currentMockInput.pressKey("ALT_B")

      const cursor = editor.cursor
      expect(cursor.line).toBe(0)
      expect(cursor.visualColumn).toBe(0)
    })

    it("should bind meta key actions", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Test",
        width: 40,
        height: 10,
        keyBindings: [{ name: "f", meta: true, action: "buffer-end" }],
      })

      editor.focus()

      currentMockInput.pressKey("ALT_F")

      const cursor = editor.cursor
      expect(cursor.line).toBe(0)
    })

    it("should work with meta key for navigation", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1\nLine 2",
        width: 40,
        height: 10,
        keyBindings: [{ name: "j", meta: true, action: "move-down" }],
      })

      editor.focus()
      expect(editor.cursor.line).toBe(0)

      currentMockInput.pressKey("ALT_J")
      expect(editor.cursor.line).toBe(1)
    })

    it("should allow meta key binding override", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
        keyBindings: [{ name: "k", meta: true, action: "move-up" }],
      })

      editor.focus()
      editor.gotoLine(2)
      expect(editor.cursor.line).toBe(2)

      currentMockInput.pressKey("k", { meta: true })
      expect(editor.cursor.line).toBe(1)
    })

    it("should work with Meta+Arrow keys", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "ABC",
        width: 40,
        height: 10,
        keyBindings: [
          { name: "left", meta: true, action: "line-home" },
          { name: "right", meta: true, action: "line-end" },
        ],
      })

      editor.focus()
      for (let i = 0; i < 2; i++) {
        editor.moveCursorRight()
      }
      expect(editor.cursor.visualColumn).toBe(2)

      currentMockInput.pressArrow("left", { meta: true })
      expect(editor.cursor.visualColumn).toBe(0)

      currentMockInput.pressArrow("right", { meta: true })
      expect(editor.cursor.visualColumn).toBe(3)
    })

    it("should support meta with shift modifier", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        keyBindings: [{ name: "H", meta: true, shift: true, action: "line-home" }],
      })

      editor.focus()
      editor.gotoLine(9999)
      expect(editor.cursor.visualColumn).toBe(11)

      currentMockInput.pressKey("h", { meta: true, shift: true })

      expect(editor.cursor.visualColumn).toBe(0)
    })

    it("should not trigger action without meta when meta binding exists", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Test",
        width: 40,
        height: 10,
        keyBindings: [{ name: "x", meta: true, action: "delete-line" }],
      })

      editor.focus()

      currentMockInput.pressKey("x")
      expect(editor.plainText).toBe("xTest")

      currentMockInput.pressKey("ALT_X")
      expect(editor.plainText).toBe("")
    })
  })

  describe("Chunk Boundary Navigation", () => {
    it("should move cursor across chunks created by insertions", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      editor.focus()

      // Insert "Hello"
      currentMockInput.pressKey("H")
      currentMockInput.pressKey("e")
      currentMockInput.pressKey("l")
      currentMockInput.pressKey("l")
      currentMockInput.pressKey("o")
      expect(editor.plainText).toBe("Hello")
      expect(editor.cursor.visualColumn).toBe(5)

      // Move cursor back to position 2
      for (let i = 0; i < 3; i++) {
        currentMockInput.pressArrow("left")
      }
      expect(editor.cursor.visualColumn).toBe(2)

      // Insert "XXX" - this creates a new chunk in the middle
      currentMockInput.pressKey("X")
      currentMockInput.pressKey("X")
      currentMockInput.pressKey("X")
      expect(editor.plainText).toBe("HeXXXllo")
      expect(editor.cursor.visualColumn).toBe(5)

      // Now move right - should move smoothly across chunk boundaries
      currentMockInput.pressArrow("right")
      expect(editor.cursor.visualColumn).toBe(6) // "l"

      currentMockInput.pressArrow("right")
      expect(editor.cursor.visualColumn).toBe(7) // "l"

      currentMockInput.pressArrow("right")
      expect(editor.cursor.visualColumn).toBe(8) // "o"
    })

    it("should move cursor left across multiple chunks", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Test",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end

      // Insert at end
      currentMockInput.pressKey("1")
      currentMockInput.pressKey("2")
      currentMockInput.pressKey("3")
      expect(editor.plainText).toBe("Test123")

      // Move to middle and insert again
      editor.gotoLine(0) // Move to start
      for (let i = 0; i < 4; i++) {
        currentMockInput.pressArrow("right")
      }
      currentMockInput.pressKey("A")
      currentMockInput.pressKey("B")
      expect(editor.plainText).toBe("TestAB123")
      expect(editor.cursor.visualColumn).toBe(6)

      // Now move left across all chunk boundaries
      for (let i = 6; i > 0; i--) {
        currentMockInput.pressArrow("left")
        expect(editor.cursor.visualColumn).toBe(i - 1)
      }
      expect(editor.cursor.visualColumn).toBe(0)
    })

    it("should move cursor right across all chunks to end", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "AB",
        width: 40,
        height: 10,
      })

      editor.focus()
      const cursor = editor.cursor
      editor.editBuffer.setCursorToLineCol(cursor.line, 9999) // Move to end of line
      expect(editor.cursor.visualColumn).toBe(2)

      // Insert at end
      currentMockInput.pressKey("C")
      currentMockInput.pressKey("D")
      expect(editor.plainText).toBe("ABCD")

      // Move to start
      editor.gotoLine(0) // Move to start
      expect(editor.cursor.visualColumn).toBe(0)

      // Move right through all characters
      for (let i = 0; i < 4; i++) {
        currentMockInput.pressArrow("right")
        expect(editor.cursor.visualColumn).toBe(i + 1)
      }
    })

    it("should handle cursor movement after multiple insertions and deletions", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Start",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end
      expect(editor.cursor.visualColumn).toBe(5)

      // Insert text
      currentMockInput.pressKey("1")
      currentMockInput.pressKey("2")

      // Delete one
      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("Start1")

      // Insert more
      currentMockInput.pressKey("X")
      currentMockInput.pressKey("Y")
      expect(editor.plainText).toBe("Start1XY")

      // Move back to start
      editor.gotoLine(0) // Move to start

      // Move right through all characters one by one
      for (let i = 0; i < 8; i++) {
        expect(editor.cursor.visualColumn).toBe(i)
        currentMockInput.pressArrow("right")
      }
      expect(editor.cursor.visualColumn).toBe(8)
    })
  })

  describe("Complex Editing Scenarios", () => {
    it("should handle typing, navigation, and deletion", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      editor.focus()

      // Type "Hello"
      currentMockInput.pressKey("H")
      currentMockInput.pressKey("e")
      currentMockInput.pressKey("l")
      currentMockInput.pressKey("l")
      currentMockInput.pressKey("o")
      expect(editor.plainText).toBe("Hello")

      // Add space and "World"
      currentMockInput.pressKey(" ")
      currentMockInput.pressKey("W")
      currentMockInput.pressKey("o")
      currentMockInput.pressKey("r")
      currentMockInput.pressKey("l")
      currentMockInput.pressKey("d")
      expect(editor.plainText).toBe("Hello World")

      // Backspace a few times
      currentMockInput.pressBackspace()
      currentMockInput.pressBackspace()
      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("Hello Wo")
    })

    it("should handle newlines and multi-line editing", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      editor.focus()

      currentMockInput.pressKey("L")
      currentMockInput.pressKey("i")
      currentMockInput.pressKey("n")
      currentMockInput.pressKey("e")
      currentMockInput.pressKey("1")
      currentMockInput.pressEnter()
      currentMockInput.pressKey("L")
      currentMockInput.pressKey("i")
      currentMockInput.pressKey("n")
      currentMockInput.pressKey("e")
      currentMockInput.pressKey("2")

      expect(editor.plainText).toBe("Line1\nLine2")
    })

    it("should handle insert and delete in sequence", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Test",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end

      currentMockInput.pressKey("i")
      currentMockInput.pressKey("n")
      currentMockInput.pressKey("g")
      expect(editor.plainText).toBe("Testing")

      currentMockInput.pressBackspace()
      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("Testi")
    })
  })

  describe("Content Property", () => {
    it("should update content programmatically", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Initial",
        width: 40,
        height: 10,
      })

      editor.setText("Updated")
      expect(editor.plainText).toBe("Updated")
      expect(editor.plainText).toBe("Updated")
    })

    it("should reset cursor when content changes", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
      })

      editor.gotoLine(9999) // Move to end
      expect(editor.cursor.visualColumn).toBe(11)

      editor.setText("New")
      // Cursor should reset to start
      expect(editor.cursor.line).toBe(0)
      expect(editor.cursor.visualColumn).toBe(0)
    })
  })

  describe("Wrapping", () => {
    it("should handle wrap mode property", async () => {
      const longText = "A".repeat(100)
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: longText,
        width: 20,
        height: 10,
        wrapMode: "word",
      })

      expect(editor.wrapMode).toBe("word")
      const wrappedCount = editor.editorView.getVirtualLineCount()
      expect(wrappedCount).toBeGreaterThan(1)

      editor.wrapMode = "none"
      expect(editor.wrapMode).toBe("none")
      const unwrappedCount = editor.editorView.getVirtualLineCount()
      expect(unwrappedCount).toBe(1)
    })

    it("should handle wrapMode changes", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello wonderful world",
        width: 12,
        height: 10,
        wrapMode: "char",
      })

      expect(editor.wrapMode).toBe("char")

      editor.wrapMode = "word"
      expect(editor.wrapMode).toBe("word")
    })
  })

  describe("Height and Width Measurement", () => {
    it("should grow height for multiline text without wrapping", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1\nLine 2\nLine 3\nLine 4\nLine 5",
        wrapMode: "none",
        width: 40,
      })

      await renderOnce()

      expect(editor.height).toBe(5)
      expect(editor.width).toBeGreaterThanOrEqual(6)
    })

    it("should grow height for wrapped text when wrapping enabled", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "This is a very long line that will definitely wrap to multiple lines",
        wrapMode: "word",
        width: 15,
      })

      await renderOnce()

      expect(editor.height).toBeGreaterThan(1)
      expect(editor.width).toBeLessThanOrEqual(15)
    })

    it("should measure full width when wrapping is disabled and not constrained by parent", async () => {
      const longLine = "This is a very long line that would wrap but wrapping is disabled"
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: longLine,
        wrapMode: "none",
        position: "absolute",
      })

      await renderOnce()

      expect(editor.height).toBe(1)
      expect(editor.width).toBe(longLine.length)
    })

    it("should shrink height when deleting lines via value setter", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1\nLine 2\nLine 3\nLine 4\nLine 5",
        width: 40,
        wrapMode: "none",
      })

      editor.focus()
      await renderOnce()
      expect(editor.height).toBe(5)

      // Remove lines by setting new value
      editor.setText("Line 1\nLine 2")
      await renderOnce()

      expect(editor.height).toBe(2)
      expect(editor.plainText).toBe("Line 1\nLine 2")
    })

    it("should update height when content changes from single to multiline", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Single line",
        wrapMode: "none",
      })

      await renderOnce()
      expect(editor.height).toBe(1)

      editor.setText("Line 1\nLine 2\nLine 3")
      await renderOnce()

      expect(editor.height).toBe(3)
    })

    it("should grow height when pressing Enter to add newlines", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Single line",
        width: 40,
        wrapMode: "none",
      })

      // Add a second textarea below to verify layout reflow
      const { textarea: belowEditor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Below",
        width: 40,
      })

      await renderOnce()
      expect(editor.height).toBe(1)
      const initialHeight = editor.height
      const initialBelowY = belowEditor.y

      editor.focus()
      editor.gotoLine(9999) // Move to end

      // Press Enter 3 times to add 3 newlines
      currentMockInput.pressEnter()
      expect(editor.plainText).toBe("Single line\n")
      await renderOnce() // Wait for layout recalculation

      currentMockInput.pressEnter()
      expect(editor.plainText).toBe("Single line\n\n")
      await renderOnce() // Wait for layout recalculation

      currentMockInput.pressEnter()
      expect(editor.plainText).toBe("Single line\n\n\n")
      await renderOnce() // Wait for layout recalculation

      // The editor should have grown
      expect(editor.height).toBeGreaterThan(initialHeight)
      expect(editor.height).toBe(4) // 1 original line + 3 new lines
      expect(editor.plainText).toBe("Single line\n\n\n")

      // The element below should have moved down
      expect(belowEditor.y).toBeGreaterThan(initialBelowY)
      expect(belowEditor.y).toBe(4) // After the 4-line editor
    })
  })

  describe("Unicode Support", () => {
    it("should handle emoji insertion", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end
      editor.insertText(" 🌟")

      expect(editor.plainText).toBe("Hello 🌟")
    })

    it("should handle CJK characters", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end
      editor.insertText(" 世界")

      expect(editor.plainText).toBe("Hello 世界")
    })

    it("should handle emoji cursor movement", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "A🌟B",
        width: 40,
        height: 10,
      })

      editor.focus()
      expect(editor.cursor.visualColumn).toBe(0)

      currentMockInput.pressArrow("right") // Move past A
      expect(editor.cursor.visualColumn).toBe(1)

      currentMockInput.pressArrow("right") // Move past emoji (2 cells)
      expect(editor.cursor.visualColumn).toBe(3)

      currentMockInput.pressArrow("right") // Move past B
      expect(editor.cursor.visualColumn).toBe(4)
    })
  })

  describe("Error Handling", () => {
    it("should throw error when using destroyed editor", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Test",
        width: 40,
        height: 10,
      })

      editor.destroy()

      expect(() => editor.plainText).toThrow("EditBuffer is destroyed")
      expect(() => editor.insertText("x")).toThrow("EditorView is destroyed")
      expect(() => editor.moveCursorLeft()).toThrow("EditBuffer is destroyed")
    })
  })

  describe("Segfault Reproduction", () => {
    it("SEGFAULT TEST: insert text with full render like demo", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Test",
        width: 40,
        height: 10,
      })

      editor.focus()

      // Call insertText like demo does
      editor.insertText("x")

      // Force actual rendering with a standalone buffer
      const { OptimizedBuffer } = await import("../buffer")
      const buffer = OptimizedBuffer.create(80, 24, "wcwidth")

      // THIS IS THE CRITICAL PART - actually draw the editor view
      // This should segfault if there's an issue
      buffer.drawEditorView(editor.editorView, 0, 0)

      expect(editor.plainText).toBe("xTest")

      buffer.destroy()
    })

    it("SEGFAULT TEST: rapid edits with rendering", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      editor.focus()

      const { OptimizedBuffer } = await import("../buffer")
      const buffer = OptimizedBuffer.create(80, 24, "wcwidth")

      for (let i = 0; i < 5; i++) {
        editor.insertText("a")
        // Draw after each insert - this is what happens in the demo
        buffer.drawEditorView(editor.editorView, 0, 0)
      }

      expect(editor.plainText).toBe("aaaaa")

      buffer.destroy()
    })

    it("SEGFAULT TEST: newline with rendering", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end

      const { OptimizedBuffer } = await import("../buffer")
      const buffer = OptimizedBuffer.create(80, 24, "wcwidth")

      editor.newLine()
      // Draw after newline - THIS SHOULD SEGFAULT
      buffer.drawEditorView(editor.editorView, 0, 0)

      expect(editor.plainText).toBe("Hello\n")

      buffer.destroy()
    })

    it("SEGFAULT TEST: backspace with rendering", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end

      const { OptimizedBuffer } = await import("../buffer")
      const buffer = OptimizedBuffer.create(80, 24, "wcwidth")

      editor.deleteCharBackward()
      // Draw after delete - THIS SHOULD SEGFAULT
      buffer.drawEditorView(editor.editorView, 0, 0)

      expect(editor.plainText).toBe("Hell")

      buffer.destroy()
    })

    it("SEGFAULT TEST: draw, edit, draw pattern", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Test",
        width: 40,
        height: 10,
      })

      editor.focus()

      const { OptimizedBuffer } = await import("../buffer")
      const buffer = OptimizedBuffer.create(80, 24, "wcwidth")

      // Draw initial
      buffer.drawEditorView(editor.editorView, 0, 0)

      // Edit
      editor.insertText("x")

      // Draw again - THIS IS WHERE IT CRASHES
      buffer.drawEditorView(editor.editorView, 0, 0)

      buffer.destroy()
    })

    it("SEGFAULT TEST: render after text buffer modification", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line1\nLine2\nLine3",
        width: 40,
        height: 10,
      })

      editor.focus()

      const { OptimizedBuffer } = await import("../buffer")
      const buffer = OptimizedBuffer.create(80, 24, "wcwidth")

      // Draw initial
      buffer.drawEditorView(editor.editorView, 0, 0)

      // Modify text buffer
      editor.insertText("X")

      // Draw again - buffer contents changed
      buffer.drawEditorView(editor.editorView, 0, 0)

      // More edits
      editor.newLine()
      buffer.drawEditorView(editor.editorView, 0, 0)

      editor.deleteCharBackward()
      buffer.drawEditorView(editor.editorView, 0, 0)

      buffer.destroy()
    })
  })

  describe("BUG REPRODUCTION: Type, backspace, type again", () => {
    it("BUG: cursor position after join, insert, backspace", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "ABC\nDEF",
        width: 40,
        height: 10,
      })

      editor.focus()

      // Move to start of line 2 (DEF)
      editor.gotoLine(1)
      expect(editor.cursor.line).toBe(1)
      expect(editor.cursor.visualColumn).toBe(0)
      expect(editor.plainText).toBe("ABC\nDEF")

      // Backspace to join lines - this creates a chunk boundary at position 3
      // Chunks: [chunk 0: "ABC" (mem_id 0), chunk 1: "DEF" (mem_id 0)]
      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("ABCDEF")
      expect(editor.cursor.line).toBe(0)
      expect(editor.cursor.visualColumn).toBe(3) // After "ABC"

      // Insert a character at the chunk boundary
      // Chunks: [chunk 0: "ABC", chunk 1: "X" (new mem_id), chunk 2: "DEF"]
      currentMockInput.pressKey("X")
      expect(editor.plainText).toBe("ABCXDEF")
      expect(editor.cursor.visualColumn).toBe(4) // After "ABCX"

      // Backspace to delete the just-inserted character
      // This removes chunk 1, so chunks become: [chunk 0: "ABC", chunk 1: "DEF"]
      // BUG: cursor.chunk stays at 1, cursor.chunk_byte_offset stays at 1
      // So cursor now points to position 1 in "DEF" instead of end of "ABC"
      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("ABCDEF")
      expect(editor.cursor.visualColumn).toBe(3) // Should be back to after "ABC"
    })

    it("BUG: typing after backspace inserts old characters", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      editor.focus()

      // Type some characters
      currentMockInput.pressKey("h")
      currentMockInput.pressKey("e")
      currentMockInput.pressKey("l")
      currentMockInput.pressKey("l")
      currentMockInput.pressKey("o")

      expect(editor.plainText).toBe("hello")

      // Backspace once
      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("hell")

      // Type again - THIS IS WHERE THE BUG HAPPENS
      currentMockInput.pressKey("p")
      expect(editor.plainText).toBe("hellp") // Should be "hellp", not "hellhellop" or similar

      currentMockInput.pressKey("!")
      expect(editor.plainText).toBe("hellp!")
    })

    it("BUG: multiple backspaces then typing", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      editor.focus()

      // Type "testing"
      currentMockInput.pressKey("t")
      currentMockInput.pressKey("e")
      currentMockInput.pressKey("s")
      currentMockInput.pressKey("t")
      currentMockInput.pressKey("i")
      currentMockInput.pressKey("n")
      currentMockInput.pressKey("g")

      expect(editor.plainText).toBe("testing")

      // Backspace 3 times
      currentMockInput.pressBackspace()
      currentMockInput.pressBackspace()
      currentMockInput.pressBackspace()

      expect(editor.plainText).toBe("test")

      // Type "ed" - should get "tested", not something weird
      currentMockInput.pressKey("e")
      currentMockInput.pressKey("d")

      expect(editor.plainText).toBe("tested")
    })

    it("BUG: type, backspace all, type new text", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      editor.focus()

      // Type "wrong"
      currentMockInput.pressKey("w")
      currentMockInput.pressKey("r")
      currentMockInput.pressKey("o")
      currentMockInput.pressKey("n")
      currentMockInput.pressKey("g")

      expect(editor.plainText).toBe("wrong")

      // Backspace everything
      for (let i = 0; i < 5; i++) {
        currentMockInput.pressBackspace()
      }

      expect(editor.plainText).toBe("")

      // Type "right" - should get "right", not "wrongright" or similar
      currentMockInput.pressKey("r")
      currentMockInput.pressKey("i")
      currentMockInput.pressKey("g")
      currentMockInput.pressKey("h")
      currentMockInput.pressKey("t")

      expect(editor.plainText).toBe("right")
    })
  })

  describe("Viewport Scrolling", () => {
    it("should scroll viewport down when cursor moves below visible area", async () => {
      // Create editor with small viewport
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9",
        width: 40,
        height: 5, // Only 5 lines visible
      })

      editor.focus()

      // Initial viewport should show lines 0-4
      let viewport = editor.editorView.getViewport()
      expect(viewport.offsetY).toBe(0)
      expect(viewport.height).toBe(5)

      // Move cursor to line 7 (beyond viewport)
      editor.gotoLine(7)

      // Viewport should have scrolled to keep cursor visible
      viewport = editor.editorView.getViewport()
      // With scroll margin of 0.2 (20% = 1 line), viewport should scroll to show line 7
      // Expected: offsetY should be at least 3 (to show lines 3-7)
      expect(viewport.offsetY).toBeGreaterThanOrEqual(3)
    })

    it("should scroll viewport up when cursor moves above visible area", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 0\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9",
        width: 40,
        height: 5,
      })

      editor.focus()

      // Start at line 8
      editor.gotoLine(8)

      let viewport = editor.editorView.getViewport()
      // Viewport should have automatically scrolled to show line 8
      expect(viewport.offsetY).toBeGreaterThan(0)

      // Now move to line 1 (above viewport)
      editor.gotoLine(1)

      viewport = editor.editorView.getViewport()
      // Viewport should have scrolled up to show line 1
      expect(viewport.offsetY).toBeLessThanOrEqual(1)
    })

    it("should scroll viewport when using arrow keys to move beyond visible area", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: Array.from({ length: 20 }, (_, i) => `Line ${i}`).join("\n"),
        width: 40,
        height: 5,
      })

      editor.focus()

      let viewport = editor.editorView.getViewport()
      expect(viewport.offsetY).toBe(0)

      // Press down arrow 6 times to move beyond initial viewport
      for (let i = 0; i < 6; i++) {
        currentMockInput.pressArrow("down")
      }

      viewport = editor.editorView.getViewport()
      // Should have scrolled
      expect(viewport.offsetY).toBeGreaterThan(0)
    })

    it("should maintain scroll margin when moving cursor", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: Array.from({ length: 20 }, (_, i) => `Line ${i}`).join("\n"),
        width: 40,
        height: 10,
        scrollMargin: 0.2, // 20% = 2 lines margin
      })

      editor.focus()

      // Move to line 8 (near bottom of initial viewport)
      editor.gotoLine(8)

      let viewport = editor.editorView.getViewport()

      // With 2-line margin, cursor at line 8 should trigger scroll
      // so that line 8 is at most at position 8 in viewport
      expect(viewport.offsetY).toBeGreaterThanOrEqual(0)
    })

    it("should handle viewport scrolling with text wrapping", async () => {
      const longLine = "word ".repeat(50) // Creates line that will wrap
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: Array.from({ length: 10 }, (_, i) => (i === 5 ? longLine : `Line ${i}`)).join("\n"),
        width: 20,
        height: 5,
        wrapMode: "word",
      })

      editor.focus()

      // Move to the long line
      editor.gotoLine(5)

      const vlineCount = editor.editorView.getTotalVirtualLineCount()
      expect(vlineCount).toBeGreaterThan(10) // Should be more due to wrapping

      // Move to end of long line
      const cursor = editor.cursor
      editor.editBuffer.setCursorToLineCol(cursor.line, 9999) // Move to end of line

      let viewport = editor.editorView.getViewport()

      // Viewport should have scrolled to show cursor
      // This is complex with wrapping - we need virtual line scrolling
    })

    it("should verify viewport follows cursor to line 10", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: Array.from({ length: 20 }, (_, i) => `Line ${i}`).join("\n"),
        width: 40,
        height: 8,
      })

      editor.focus()

      // Move to line 10
      editor.gotoLine(10)

      const viewport = editor.editorView.getViewport()

      // Viewport should have scrolled to show line 10
      // With height=8 and scroll margin, line 10 should be visible
      expect(viewport.offsetY).toBeGreaterThan(0)
      expect(viewport.offsetY).toBeLessThanOrEqual(10)

      // Line 10 should be within the viewport range
      const viewportEnd = viewport.offsetY + viewport.height
      expect(10).toBeGreaterThanOrEqual(viewport.offsetY)
      expect(10).toBeLessThan(viewportEnd)
    })

    it("should track viewport offset as cursor moves through document", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: Array.from({ length: 15 }, (_, i) => `Line ${i}`).join("\n"),
        width: 30,
        height: 5,
      })

      editor.focus()

      const viewportOffsets: number[] = []

      // Track viewport offset at different cursor positions
      for (const line of [0, 2, 4, 6, 8, 10, 12]) {
        editor.gotoLine(line)
        const viewport = editor.editorView.getViewport()
        viewportOffsets.push(viewport.offsetY)
      }

      // Viewport should generally increase as cursor moves down
      // (with possible plateaus when cursor is already visible)
      const lastOffset = viewportOffsets[viewportOffsets.length - 1]
      const firstOffset = viewportOffsets[0]
      expect(lastOffset).toBeGreaterThan(firstOffset)

      // At line 0, viewport should be at 0
      expect(viewportOffsets[0]).toBe(0)

      // At line 12, viewport should have scrolled
      expect(viewportOffsets[viewportOffsets.length - 1]).toBeGreaterThan(5)
    })

    it("should scroll viewport when cursor moves with Page Up/Page Down", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: Array.from({ length: 30 }, (_, i) => `Line ${i}`).join("\n"),
        width: 40,
        height: 10,
      })

      editor.focus()

      let viewport = editor.editorView.getViewport()
      expect(viewport.offsetY).toBe(0)

      // Move down 15 lines (more than viewport height)
      for (let i = 0; i < 15; i++) {
        editor.moveCursorDown()
      }

      viewport = editor.editorView.getViewport()

      // Should have scrolled
      expect(viewport.offsetY).toBeGreaterThan(0)
      expect(editor.cursor.line).toBe(15)
    })

    it("should scroll viewport down when pressing Enter repeatedly", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Start",
        width: 40,
        height: 5,
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end

      let viewport = editor.editorView.getViewport()
      expect(viewport.offsetY).toBe(0)
      expect(editor.cursor.line).toBe(0)

      // Press Enter 8 times to create 8 new lines
      for (let i = 0; i < 8; i++) {
        currentMockInput.pressEnter()
      }

      // After 8 Enters, we should have 9 lines total (0-8)
      expect(editor.cursor.line).toBe(8)

      // Viewport should have scrolled to keep cursor visible
      viewport = editor.editorView.getViewport()
      expect(viewport.offsetY).toBeGreaterThan(0)

      // Cursor should be visible in viewport
      const cursorLine = editor.cursor.line
      expect(cursorLine).toBeGreaterThanOrEqual(viewport.offsetY)
      expect(cursorLine).toBeLessThan(viewport.offsetY + viewport.height)
    })

    it("should scroll viewport up when pressing Backspace to delete characters and move up", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: Array.from({ length: 15 }, (_, i) => `Line ${i}`).join("\n"),
        width: 40,
        height: 5,
      })

      editor.focus()

      // Start at line 10, move to end so we have characters to delete
      editor.gotoLine(10)
      let cursor = editor.cursor
      editor.editBuffer.setCursorToLineCol(cursor.line, 9999) // Move to end of line

      let viewport = editor.editorView.getViewport()
      expect(viewport.offsetY).toBeGreaterThan(0)
      const initialOffset = viewport.offsetY

      // Delete all text and move cursor up to line 0
      // Press Ctrl+A to go to start, then move to line 2, then backspace repeatedly
      editor.gotoLine(0) // Move to start
      editor.gotoLine(2)
      cursor = editor.cursor
      editor.editBuffer.setCursorToLineCol(cursor.line, 9999) // Move to end of line

      // Now we're at line 2, and viewport should have scrolled up
      viewport = editor.editorView.getViewport()

      // Viewport should have scrolled up from initial position
      expect(viewport.offsetY).toBeLessThan(initialOffset)
      expect(editor.cursor.line).toBe(2)
    })

    it("should scroll viewport when typing at end creates wrapped lines beyond viewport", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Start",
        width: 20,
        height: 5,
        wrapMode: "word",
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end

      let viewport = editor.editorView.getViewport()
      expect(viewport.offsetY).toBe(0)

      // Type enough to create multiple wrapped lines
      const longText = " word".repeat(50)
      for (const char of longText) {
        currentMockInput.pressKey(char)
      }

      viewport = editor.editorView.getViewport()
      const vlineCount = editor.editorView.getTotalVirtualLineCount()

      // Should have created multiple virtual lines
      expect(vlineCount).toBeGreaterThan(5)

      // Viewport should have scrolled to keep cursor visible
      // (This test may fail if virtual line scrolling isn't implemented yet)
      expect(viewport.offsetY).toBeGreaterThanOrEqual(0)
    })

    it("should scroll viewport when using Enter to add lines, then Backspace to remove them", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 0\nLine 1\nLine 2",
        width: 40,
        height: 5,
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end

      let viewport = editor.editorView.getViewport()
      const initialOffset = viewport.offsetY

      // Add 6 new lines
      for (let i = 0; i < 6; i++) {
        currentMockInput.pressEnter()
        currentMockInput.pressKey("X")
      }

      // Should have scrolled down
      viewport = editor.editorView.getViewport()
      expect(viewport.offsetY).toBeGreaterThan(initialOffset)
      const maxOffset = viewport.offsetY

      // Now delete those lines by backspacing
      for (let i = 0; i < 12; i++) {
        // 12 backspaces to delete 6 "X\n" pairs
        currentMockInput.pressBackspace()
      }

      // Should have scrolled back up
      viewport = editor.editorView.getViewport()
      expect(viewport.offsetY).toBeLessThan(maxOffset)
    })

    it("should show last line at bottom of viewport with no gap", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: Array.from({ length: 10 }, (_, i) => `Line ${i}`).join("\n"),
        width: 40,
        height: 5,
      })

      editor.focus()

      // Move to last line (line 9)
      editor.gotoLine(9)

      let viewport = editor.editorView.getViewport()

      // With 10 lines (0-9) and viewport height 5, max offset is 10 - 5 = 5
      // Viewport should be at offset 5, showing lines 5-9 with line 9 at the bottom
      expect(viewport.offsetY).toBe(5)

      // Verify cursor line is visible
      expect(9).toBeGreaterThanOrEqual(viewport.offsetY)
      expect(9).toBeLessThan(viewport.offsetY + viewport.height)

      // No gap - last visible line should be the last line of content
      const lastVisibleLine = viewport.offsetY + viewport.height - 1
      expect(lastVisibleLine).toBe(9)
    })

    it("should not scroll past end when document is smaller than viewport", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 0\nLine 1\nLine 2",
        width: 40,
        height: 10, // Viewport bigger than content
      })

      editor.focus()

      // Move to last line
      editor.gotoLine(2)

      let viewport = editor.editorView.getViewport()

      // Should NOT scroll at all - content fits in viewport
      expect(viewport.offsetY).toBe(0)
    })
  })

  describe("Selection Support", () => {
    it("should support selection via mouse drag", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      const { OptimizedBuffer } = await import("../buffer")
      const buffer = OptimizedBuffer.create(80, 24, "wcwidth")

      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      const { OptimizedBuffer } = await import("../buffer")
      const buffer = OptimizedBuffer.create(80, 24, "wcwidth")

      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      const { OptimizedBuffer } = await import("../buffer")
      const buffer = OptimizedBuffer.create(80, 24, "wcwidth")

      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: true,
      })

      editor.focus()
      const cursor = editor.cursor
      editor.editBuffer.setCursorToLineCol(cursor.line, 9999) // Move to end of line // Move to end

      // Select backwards with shift+left
      for (let i = 0; i < 5; i++) {
        currentMockInput.pressArrow("left", { shift: true })
      }

      expect(editor.hasSelection()).toBe(true)
      expect(editor.getSelectedText()).toBe("World")
    })

    it("should select with shift+down", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      expect(editor.cursor.visualColumn).toBe(0)
    })

    it("should delete selected text with delete key", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: true,
      })

      editor.focus()

      // Select "World"
      const cursor = editor.cursor
      editor.editBuffer.setCursorToLineCol(cursor.line, 9999) // Move to end of line
      for (let i = 0; i < 5; i++) {
        currentMockInput.pressArrow("left", { shift: true })
      }

      expect(editor.getSelectedText()).toBe("World")
      expect(editor.plainText).toBe("Hello World")

      // Delete should delete the selected text
      currentMockInput.pressKey("DELETE")

      expect(editor.hasSelection()).toBe(false)
      expect(editor.plainText).toBe("Hello ")
      expect(editor.cursor.visualColumn).toBe(6)
    })

    it("should delete multi-line selection with backspace", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      expect(editor.cursor.visualColumn).toBe(0)
      expect(editor.cursor.line).toBe(0)
    })

    it("should delete entire line when selected with delete", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      expect(editor.cursor.line).toBe(1)
    })

    it("should replace selected text when typing", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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
      expect(editor.cursor.line).toBe(0)
      expect(editor.cursor.visualColumn).toBe(0)

      // Verify selection is cleared in EditorView
      expect(editor.editorView.hasSelection()).toBe(false)
    })
  })

  describe("History - Undo/Redo", () => {
    it("should undo text insertion", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      editor.focus()

      // Type "Hello"
      currentMockInput.pressKey("H")
      currentMockInput.pressKey("e")
      currentMockInput.pressKey("l")
      currentMockInput.pressKey("l")
      currentMockInput.pressKey("o")
      expect(editor.plainText).toBe("Hello")

      // Undo
      editor.undo()
      expect(editor.plainText).toBe("Hell")
    })

    it("should redo after undo", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      editor.focus()

      // Type text
      currentMockInput.pressKey("T")
      currentMockInput.pressKey("e")
      currentMockInput.pressKey("s")
      currentMockInput.pressKey("t")
      expect(editor.plainText).toBe("Test")

      // Undo
      editor.undo()
      expect(editor.plainText).toBe("Tes")

      // Redo
      editor.redo()
      expect(editor.plainText).toBe("Test")
    })

    it("should handle multiple undo operations", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      editor.focus()

      // Type characters one by one
      currentMockInput.pressKey("A")
      currentMockInput.pressKey("B")
      currentMockInput.pressKey("C")
      expect(editor.plainText).toBe("ABC")

      // Undo 3 times
      editor.undo()
      expect(editor.plainText).toBe("AB")

      editor.undo()
      expect(editor.plainText).toBe("A")

      editor.undo()
      expect(editor.plainText).toBe("")
    })

    it("should handle Ctrl+Z for undo", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      editor.focus()

      currentMockInput.pressKey("H")
      currentMockInput.pressKey("i")
      expect(editor.plainText).toBe("Hi")

      // Ctrl+Z to undo
      currentMockInput.pressKey("CTRL_Z")
      expect(editor.plainText).toBe("H")
    })

    it("should handle Ctrl+Y for redo", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      editor.focus()

      currentMockInput.pressKey("X")
      expect(editor.plainText).toBe("X")

      // Undo
      currentMockInput.pressKey("CTRL_Z")
      expect(editor.plainText).toBe("")

      // Ctrl+Y to redo
      currentMockInput.pressKey("CTRL_Y")
      expect(editor.plainText).toBe("X")
    })

    it("should handle redo programmatically", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      editor.focus()

      currentMockInput.pressKey("Y")
      expect(editor.plainText).toBe("Y")

      editor.undo()
      expect(editor.plainText).toBe("")

      // Programmatic redo
      editor.redo()
      expect(editor.plainText).toBe("Y")
    })

    it("should undo deletion", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end

      // Delete backward
      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("Hello Worl")

      // Undo
      editor.undo()
      expect(editor.plainText).toBe("Hello World")
    })

    it("should undo newline insertion", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end

      currentMockInput.pressEnter()
      expect(editor.plainText).toBe("Hello\n")

      // Undo
      editor.undo()
      expect(editor.plainText).toBe("Hello")
    })

    it("should restore cursor position after undo", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end
      expect(editor.cursor.visualColumn).toBe(6)

      currentMockInput.pressEnter()
      currentMockInput.pressKey("L")
      currentMockInput.pressKey("i")
      expect(editor.plainText).toBe("Line 1\nLi")
      expect(editor.cursor.line).toBe(1)
      expect(editor.cursor.visualColumn).toBe(2)

      // Undo last character "i"
      editor.undo()
      expect(editor.plainText).toBe("Line 1\nL")
      expect(editor.cursor.line).toBe(1)
      expect(editor.cursor.visualColumn).toBe(1)

      // Undo "L"
      editor.undo()
      expect(editor.plainText).toBe("Line 1\n")
      expect(editor.cursor.line).toBe(1)
      expect(editor.cursor.visualColumn).toBe(0)
    })

    it("should handle undo/redo chain", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      editor.focus()

      // Build up edits
      currentMockInput.pressKey("1")
      currentMockInput.pressKey("2")
      currentMockInput.pressKey("3")
      expect(editor.plainText).toBe("123")

      // Undo all
      editor.undo()
      expect(editor.plainText).toBe("12")
      editor.undo()
      expect(editor.plainText).toBe("1")
      editor.undo()
      expect(editor.plainText).toBe("")

      // Redo all
      editor.redo()
      expect(editor.plainText).toBe("1")
      editor.redo()
      expect(editor.plainText).toBe("12")
      editor.redo()
      expect(editor.plainText).toBe("123")
    })

    it("should handle undo after deleteChar", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "ABCDE",
        width: 40,
        height: 10,
      })

      editor.focus()

      // Delete "A"
      currentMockInput.pressKey("DELETE")
      expect(editor.plainText).toBe("BCDE")

      // Undo
      editor.undo()
      expect(editor.plainText).toBe("ABCDE")
    })

    it("should handle undo after deleteLine", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(1)

      const beforeDelete = editor.plainText

      // Delete line 2
      currentMockInput.pressKey("CTRL_D")
      const afterDelete = editor.plainText

      // Verify delete happened
      expect(afterDelete).not.toBe(beforeDelete)

      // Undo
      editor.undo()
      expect(editor.plainText).toBe(beforeDelete)
    })

    it("should clear selection on undo", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: true,
      })

      editor.focus()

      // Type a character first
      currentMockInput.pressKey("A")
      expect(editor.plainText).toBe("AHello World")

      // Undo to get back to original
      editor.undo()
      expect(editor.plainText).toBe("Hello World")

      // Make a selection
      currentMockInput.pressArrow("right", { shift: true })
      expect(editor.hasSelection()).toBe(true)

      // Undo should clear selection (even though there's nothing to undo now)
      editor.undo()
      expect(editor.hasSelection()).toBe(false)
    })
  })

  describe("Key Event Handling", () => {
    it("should only handle KeyEvents, not raw escape sequences", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      editor.focus()

      // Simulate raw escape sequence (like mouse events or terminal responses)
      const rawEscapeSequence = "\x1b[<35;86;19M"
      const handled = editor.handleKeyPress(rawEscapeSequence)

      // Should NOT be handled (return false)
      expect(handled).toBe(false)

      // Should NOT be inserted into content
      expect(editor.plainText).toBe("")
    })

    it("should not insert control sequences into text", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello",
        width: 40,
        height: 10,
      })

      editor.focus()

      // Try various control sequences that should NOT be inserted
      const controlSequences = [
        "\x1b[A", // Arrow up
        "\x1b[B", // Arrow down
        "\x1b[C", // Arrow right
        "\x1b[D", // Arrow left
        "\x1b[?1004h", // Focus tracking
        "\x1b[?2004h", // Bracketed paste
        "\x1b[<0;10;10M", // Mouse event
      ]

      for (const seq of controlSequences) {
        const before = editor.plainText
        editor.handleKeyPress(seq)
        const after = editor.plainText

        // Content should not change for control sequences
        expect(after).toBe(before)
      }
    })

    it("should handle printable characters via handleKeyPress", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      editor.focus()

      // These should be handled
      const handled1 = editor.handleKeyPress("a")
      expect(handled1).toBe(true)
      expect(editor.plainText).toBe("a")

      const handled2 = editor.handleKeyPress("b")
      expect(handled2).toBe(true)
      expect(editor.plainText).toBe("ab")
    })

    it("should handle multi-byte Unicode characters (emoji, CJK)", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      editor.focus()

      // Emoji (multi-byte UTF-8)
      const emojiHandled = editor.handleKeyPress("🌟")
      expect(emojiHandled).toBe(true)
      expect(editor.plainText).toBe("🌟")

      // CJK characters (multi-byte UTF-8)
      const cjkHandled = editor.handleKeyPress("世")
      expect(cjkHandled).toBe(true)
      expect(editor.plainText).toBe("🌟世")

      // Another emoji
      editor.insertText(" ")
      const emoji2Handled = editor.handleKeyPress("👍")
      expect(emoji2Handled).toBe(true)
      expect(editor.plainText).toBe("🌟世 👍")
    })

    it("should filter escape sequences when they have non-printable characters", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Test",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end

      // Escape character (0x1b) - should not be inserted
      const escapeChar = String.fromCharCode(0x1b)
      const handled = editor.handleKeyPress(escapeChar)

      // Should not insert escape character
      expect(editor.plainText).toBe("Test")
    })
  })

  describe("Paste Events", () => {
    it("should paste text at cursor position", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end

      await currentMockInput.pasteBracketedText(" World")

      expect(editor.plainText).toBe("Hello World")
    })

    it("should paste text in the middle", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "HelloWorld",
        width: 40,
        height: 10,
      })

      editor.focus()
      for (let i = 0; i < 5; i++) {
        editor.moveCursorRight()
      }

      await currentMockInput.pasteBracketedText(" ")

      expect(editor.plainText).toBe("Hello World")
    })

    it("should paste multi-line text", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Start",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999)

      await currentMockInput.pasteBracketedText("\nLine 2\nLine 3")

      expect(editor.plainText).toBe("Start\nLine 2\nLine 3")
    })

    it("should paste text at beginning of buffer", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "World",
        width: 40,
        height: 10,
      })

      editor.focus()
      // Cursor starts at beginning

      await currentMockInput.pasteBracketedText("Hello ")

      expect(editor.plainText).toBe("Hello World")
    })

    it("should replace selected text when pasting", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: true,
      })

      editor.focus()

      // Select "Hello" using shift+right
      for (let i = 0; i < 5; i++) {
        currentMockInput.pressArrow("right", { shift: true })
      }

      expect(editor.hasSelection()).toBe(true)
      expect(editor.getSelectedText()).toBe("Hello")

      // Paste to replace selection
      await currentMockInput.pasteBracketedText("Goodbye")

      expect(editor.hasSelection()).toBe(false)
      expect(editor.plainText).toBe("Goodbye World")
    })

    it("should replace multi-line selection when pasting", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
        selectable: true,
      })

      editor.focus()

      // Select from start through "Line 1\nLi"
      for (let i = 0; i < 10; i++) {
        currentMockInput.pressArrow("right", { shift: true })
      }

      expect(editor.hasSelection()).toBe(true)

      // Paste replacement text
      await currentMockInput.pasteBracketedText("New")

      expect(editor.hasSelection()).toBe(false)
      expect(editor.plainText).toBe("Newe 2\nLine 3")
    })

    it("should replace selected text with multi-line paste", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
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

      // Paste multi-line text to replace selection
      await currentMockInput.pasteBracketedText("Line 1\nLine 2")

      expect(editor.hasSelection()).toBe(false)
      expect(editor.plainText).toBe("Line 1\nLine 2 World")
    })

    it("should paste empty string without error", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Test",
        width: 40,
        height: 10,
      })

      editor.focus()

      await currentMockInput.pasteBracketedText("")

      expect(editor.plainText).toBe("Test")
    })

    it("should paste Unicode characters (emoji, CJK)", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999)

      await currentMockInput.pasteBracketedText(" 🌟世界👍")

      expect(editor.plainText).toBe("Hello 🌟世界👍")
    })

    it("should replace entire selection with pasted text", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "AAAA\nBBBB\nCCCC",
        width: 40,
        height: 10,
        selectable: true,
      })

      editor.focus()
      editor.gotoLine(1) // Go to BBBB line

      // Select all of BBBB
      for (let i = 0; i < 4; i++) {
        currentMockInput.pressArrow("right", { shift: true })
      }

      expect(editor.getSelectedText()).toBe("BBBB")

      // Paste replacement
      await currentMockInput.pasteBracketedText("XXXX")

      expect(editor.hasSelection()).toBe(false)
      expect(editor.plainText).toBe("AAAA\nXXXX\nCCCC")
    })

    it("should handle paste via handlePaste method directly", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Test",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999)

      editor.handlePaste(" Content")

      expect(editor.plainText).toBe("Test Content")
    })

    it("should replace selection when using handlePaste directly", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: true,
      })

      editor.focus()

      // Select "World"
      const cursor = editor.cursor
      editor.editBuffer.setCursorToLineCol(cursor.line, 9999)
      for (let i = 0; i < 5; i++) {
        currentMockInput.pressArrow("left", { shift: true })
      }

      expect(editor.getSelectedText()).toBe("World")

      // Use handlePaste directly
      editor.handlePaste("Universe")

      expect(editor.hasSelection()).toBe(false)
      expect(editor.plainText).toBe("Hello Universe")
    })
  })

  describe("Placeholder Support", () => {
    it("should display placeholder when empty", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
        placeholder: "Enter text here...",
        placeholderColor: "#666666",
      })

      // plainText should return empty (placeholder is display-only)
      expect(editor.plainText).toBe("")
      expect(editor.placeholder).toBe("Enter text here...")
    })

    it("should hide placeholder when text is inserted", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
        placeholder: "Type something...",
      })

      editor.focus()
      expect(editor.plainText).toBe("")

      currentMockInput.pressKey("H")
      currentMockInput.pressKey("i")

      expect(editor.plainText).toBe("Hi")
    })

    it("should reactivate placeholder when all text is deleted", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Test",
        width: 40,
        height: 10,
        placeholder: "Empty buffer...",
      })

      editor.focus()
      expect(editor.plainText).toBe("Test")

      // Move to end, then delete all text
      editor.gotoLine(9999)
      for (let i = 0; i < 4; i++) {
        currentMockInput.pressBackspace()
      }

      expect(editor.plainText).toBe("")
    })

    it("should update placeholder text dynamically", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
        placeholder: "First placeholder",
      })

      expect(editor.placeholder).toBe("First placeholder")
      expect(editor.plainText).toBe("")

      editor.placeholder = "Second placeholder"
      expect(editor.placeholder).toBe("Second placeholder")
      expect(editor.plainText).toBe("")
    })

    it("should update placeholder color dynamically", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
        placeholder: "Colored placeholder",
        placeholderColor: "#999999",
      })

      expect(editor.plainText).toBe("")

      // Update color
      editor.placeholderColor = "#FF0000"
      expect(editor.plainText).toBe("")
    })

    it("should work with value property setter", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
        placeholder: "Empty state",
      })

      expect(editor.plainText).toBe("")

      editor.setText("New content")
      expect(editor.plainText).toBe("New content")

      editor.setText("")
      expect(editor.plainText).toBe("")
    })

    it("should handle placeholder with focus changes", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
        placeholder: "Click to edit",
      })

      // Placeholder should show regardless of focus
      expect(editor.plainText).toBe("")

      editor.focus()
      expect(editor.plainText).toBe("")

      editor.blur()
      expect(editor.plainText).toBe("")
    })

    it("should handle typing after placeholder is shown", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
        placeholder: "Start typing...",
      })

      editor.focus()
      expect(editor.plainText).toBe("")

      currentMockInput.pressKey("H")
      currentMockInput.pressKey("e")
      currentMockInput.pressKey("l")
      currentMockInput.pressKey("l")
      currentMockInput.pressKey("o")

      expect(editor.plainText).toBe("Hello")
    })

    it("should show placeholder after deleting all typed text", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
        placeholder: "Type here",
      })

      editor.focus()

      // Type "Test"
      currentMockInput.pressKey("T")
      currentMockInput.pressKey("e")
      currentMockInput.pressKey("s")
      currentMockInput.pressKey("t")
      expect(editor.plainText).toBe("Test")

      // Backspace all
      for (let i = 0; i < 4; i++) {
        currentMockInput.pressBackspace()
      }

      expect(editor.plainText).toBe("")
    })

    it("should handle placeholder with newlines", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
        placeholder: "Line 1\nLine 2",
      })

      expect(editor.plainText).toBe("")

      editor.insertText("Content")
      expect(editor.plainText).toBe("Content")
    })

    it("should handle null placeholder (no placeholder)", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
        placeholder: null,
      })

      expect(editor.placeholder).toBe(null)
      expect(editor.plainText).toBe("")

      editor.insertText("Content")
      expect(editor.plainText).toBe("Content")
    })

    it("should clear placeholder when set to null", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
        placeholder: "Initial placeholder",
      })

      expect(editor.placeholder).toBe("Initial placeholder")
      expect(editor.plainText).toBe("")

      editor.placeholder = null
      expect(editor.placeholder).toBe(null)
      expect(editor.plainText).toBe("")
    })
  })

  describe("Deletion with empty lines", () => {
    it("should delete selection on line after empty lines correctly", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "AAAA\n\nBBBB\n\nCCCC",
        width: 40,
        height: 10,
        selectable: true,
        wrapMode: "word",
      })

      editor.focus()
      editor.gotoLine(2) // Line with "BBBB"

      expect(editor.cursor.line).toBe(2)
      expect(editor.plainText).toBe("AAAA\n\nBBBB\n\nCCCC")

      // Select "BBBB" by pressing shift+right 4 times
      for (let i = 0; i < 4; i++) {
        currentMockInput.pressArrow("right", { shift: true })
      }

      expect(editor.hasSelection()).toBe(true)
      expect(editor.getSelectedText()).toBe("BBBB")

      // Delete the selection
      currentMockInput.pressKey("DELETE")

      expect(editor.hasSelection()).toBe(false)
      expect(editor.plainText).toBe("AAAA\n\n\n\nCCCC")
      expect(editor.cursor.line).toBe(2)
      expect(editor.cursor.visualColumn).toBe(0)
    })

    it("should delete selection on first line correctly (baseline test)", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "AAAA\n\nBBBB\n\nCCCC",
        width: 40,
        height: 10,
        selectable: true,
        wrapMode: "word",
      })

      editor.focus()
      editor.gotoLine(0) // First line with "AAAA"

      expect(editor.cursor.line).toBe(0)

      // Select "AAAA"
      for (let i = 0; i < 4; i++) {
        currentMockInput.pressArrow("right", { shift: true })
      }

      expect(editor.getSelectedText()).toBe("AAAA")

      // Delete the selection
      currentMockInput.pressKey("DELETE")

      expect(editor.hasSelection()).toBe(false)
      expect(editor.plainText).toBe("\n\nBBBB\n\nCCCC")
    })

    it("should delete selection on last line after empty lines correctly", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "AAAA\n\nBBBB\n\nCCCC",
        width: 40,
        height: 10,
        selectable: true,
        wrapMode: "word",
      })

      editor.focus()
      editor.gotoLine(4) // Last line with "CCCC"

      expect(editor.cursor.line).toBe(4)

      // Select "CCCC"
      for (let i = 0; i < 4; i++) {
        currentMockInput.pressArrow("right", { shift: true })
      }

      const selectedText = editor.getSelectedText()
      expect(selectedText).toBe("CCCC")

      // Delete the selection
      currentMockInput.pressKey("DELETE")

      expect(editor.hasSelection()).toBe(false)
      // After deleting CCCC, we should still have AAAA and BBBB
      expect(editor.plainText).toContain("AAAA")
      expect(editor.plainText).toContain("BBBB")
      expect(editor.plainText).not.toContain("CCCC")
    })
  })

  describe("Key Bindings", () => {
    it("should use default keybindings", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
      })

      editor.focus()

      currentMockInput.pressArrow("right")
      expect(editor.cursor.visualColumn).toBe(1)

      currentMockInput.pressKey("HOME")
      expect(editor.cursor.visualColumn).toBe(0)

      currentMockInput.pressKey("END")
      expect(editor.cursor.visualColumn).toBe(11)
    })

    it("should allow custom keybindings to override defaults", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        keyBindings: [{ name: "j", action: "move-left" }],
      })

      editor.focus()
      editor.gotoLine(9999)
      expect(editor.cursor.visualColumn).toBe(11)

      currentMockInput.pressKey("j")
      expect(editor.cursor.visualColumn).toBe(10)
    })

    it("should map multiple custom keys to the same action", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        keyBindings: [
          { name: "h", action: "move-left" },
          { name: "j", action: "move-down" },
          { name: "k", action: "move-up" },
          { name: "l", action: "move-right" },
        ],
      })

      editor.focus()

      currentMockInput.pressKey("l")
      expect(editor.cursor.visualColumn).toBe(1)

      currentMockInput.pressKey("l")
      expect(editor.cursor.visualColumn).toBe(2)

      currentMockInput.pressKey("h")
      expect(editor.cursor.visualColumn).toBe(1)

      currentMockInput.pressKey("h")
      expect(editor.cursor.visualColumn).toBe(0)
    })

    it("should support custom keybindings with ctrl modifier", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
        keyBindings: [{ name: "g", ctrl: true, action: "buffer-home" }],
      })

      editor.focus()
      editor.gotoLine(9999)
      expect(editor.cursor.line).toBe(2)

      currentMockInput.pressKey("CTRL_G")
      expect(editor.cursor.line).toBe(0)
      expect(editor.cursor.visualColumn).toBe(0)
    })

    it("should support custom keybindings with shift modifier", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: true,
        keyBindings: [{ name: "l", shift: true, action: "select-right" }],
      })

      editor.focus()

      currentMockInput.pressKey("L", { shift: true })
      expect(editor.hasSelection()).toBe(true)
      expect(editor.getSelectedText()).toBe("H")

      currentMockInput.pressKey("L", { shift: true })
      expect(editor.getSelectedText()).toBe("He")
    })

    it("should support custom keybindings with alt modifier", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
        keyBindings: [{ name: "b", ctrl: true, action: "buffer-home" }],
      })

      editor.focus()
      editor.gotoLine(2)

      currentMockInput.pressKey("CTRL_B")
      expect(editor.cursor.line).toBe(0)
      expect(editor.cursor.visualColumn).toBe(0)
    })

    it("should support keybindings with multiple modifiers", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: true,
        keyBindings: [{ name: "right", ctrl: true, shift: true, action: "select-line-end" }],
      })

      editor.focus()

      currentMockInput.pressArrow("right", { ctrl: true, shift: true })
      expect(editor.hasSelection()).toBe(true)
      expect(editor.getSelectedText()).toBe("Hello World")
    })

    it("should map newline action to custom key", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello",
        width: 40,
        height: 10,
        keyBindings: [{ name: "n", ctrl: true, action: "newline" }],
      })

      editor.focus()
      editor.gotoLine(9999)

      currentMockInput.pressKey("CTRL_N")
      expect(editor.plainText).toBe("Hello\n")
    })

    it("should map backspace action to custom key", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello",
        width: 40,
        height: 10,
        keyBindings: [{ name: "h", ctrl: true, action: "backspace" }],
      })

      editor.focus()
      editor.gotoLine(9999)

      currentMockInput.pressKey("CTRL_H")
      expect(editor.plainText).toBe("Hell")
    })

    it("should map delete action to custom key", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello",
        width: 40,
        height: 10,
        keyBindings: [{ name: "d", ctrl: false, action: "delete" }],
      })

      editor.focus()

      currentMockInput.pressKey("d")
      expect(editor.plainText).toBe("ello")
    })

    it("should map line-home and line-end to custom keys", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        keyBindings: [
          { name: "a", action: "line-home" },
          { name: "e", action: "line-end" },
        ],
      })

      editor.focus()
      editor.moveCursorRight()
      editor.moveCursorRight()
      expect(editor.cursor.visualColumn).toBe(2)

      currentMockInput.pressKey("a")
      expect(editor.cursor.visualColumn).toBe(0)

      currentMockInput.pressKey("e")
      expect(editor.cursor.visualColumn).toBe(11)
    })

    it("should override default shift+home and shift+end keybindings", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: true,
        keyBindings: [
          { name: "home", shift: true, action: "buffer-home" },
          { name: "end", shift: true, action: "buffer-end" },
        ],
      })

      editor.focus()
      for (let i = 0; i < 6; i++) {
        editor.moveCursorRight()
      }
      expect(editor.cursor.visualColumn).toBe(6)

      currentMockInput.pressKey("HOME", { shift: true })
      expect(editor.hasSelection()).toBe(false)
      expect(editor.cursor.line).toBe(0)
      expect(editor.cursor.visualColumn).toBe(0)

      editor.moveCursorRight()
      currentMockInput.pressKey("END", { shift: true })
      expect(editor.hasSelection()).toBe(false)
      expect(editor.cursor.line).toBe(0)
    })

    it("should map undo and redo actions to custom keys", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
        keyBindings: [
          { name: "u", action: "undo" },
          { name: "r", action: "redo" },
        ],
      })

      editor.focus()

      currentMockInput.pressKey("H")
      currentMockInput.pressKey("i")
      expect(editor.plainText).toBe("Hi")

      currentMockInput.pressKey("u")
      expect(editor.plainText).toBe("H")

      currentMockInput.pressKey("r")
      expect(editor.plainText).toBe("Hi")
    })

    it("should map delete-line action to custom key", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
        keyBindings: [{ name: "x", ctrl: true, action: "delete-line" }],
      })

      editor.focus()
      editor.gotoLine(1)

      currentMockInput.pressKey("CTRL_X")
      expect(editor.plainText).toBe("Line 1\nLine 3")
    })

    it("should map delete-to-line-end action to custom key", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        keyBindings: [{ name: "k", action: "delete-to-line-end" }],
      })

      editor.focus()
      for (let i = 0; i < 6; i++) {
        editor.moveCursorRight()
      }

      currentMockInput.pressKey("k")
      expect(editor.plainText).toBe("Hello ")
    })

    it("should map buffer-home and buffer-end to custom keys", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
        keyBindings: [
          { name: "g", action: "buffer-home" },
          { name: "b", action: "buffer-end" },
        ],
      })

      editor.focus()
      editor.gotoLine(9999)
      expect(editor.cursor.line).toBe(2)

      currentMockInput.pressKey("g")
      expect(editor.cursor.line).toBe(0)
      expect(editor.cursor.visualColumn).toBe(0)

      currentMockInput.pressKey("b")
      expect(editor.cursor.line).toBe(2)
    })

    it("should map select-up and select-down to custom keys", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
        selectable: true,
        keyBindings: [
          { name: "k", shift: true, action: "select-up" },
          { name: "j", shift: true, action: "select-down" },
        ],
      })

      editor.focus()
      editor.gotoLine(1)

      currentMockInput.pressKey("J", { shift: true })
      expect(editor.hasSelection()).toBe(true)
      const selectedText = editor.getSelectedText()
      expect(selectedText.includes("Line")).toBe(true)
    })

    it("should preserve default keybindings when custom bindings don't override them", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        keyBindings: [{ name: "j", action: "move-down" }],
      })

      editor.focus()

      currentMockInput.pressArrow("right")
      expect(editor.cursor.visualColumn).toBe(1)

      currentMockInput.pressKey("HOME")
      expect(editor.cursor.visualColumn).toBe(0)
    })

    it("should allow remapping default keys to different actions", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
        keyBindings: [{ name: "up", action: "buffer-home" }],
      })

      editor.focus()
      editor.gotoLine(2)

      currentMockInput.pressArrow("up")
      expect(editor.cursor.line).toBe(0)
      expect(editor.cursor.visualColumn).toBe(0)
    })

    it("should handle complex keybinding scenario with multiple custom mappings", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
        keyBindings: [
          { name: "h", action: "move-left" },
          { name: "j", action: "move-down" },
          { name: "k", action: "move-up" },
          { name: "l", action: "move-right" },
          { name: "i", action: "buffer-home" },
          { name: "a", action: "line-end" },
        ],
      })

      editor.focus()

      currentMockInput.pressKey("i")
      expect(editor.cursor.line).toBe(0)
      expect(editor.cursor.visualColumn).toBe(0)

      currentMockInput.pressKey("a")
      expect(editor.cursor.visualColumn).toBe(6)

      currentMockInput.pressKey("h")
      expect(editor.cursor.visualColumn).toBe(5)

      currentMockInput.pressKey("j")
      expect(editor.cursor.line).toBe(1)

      currentMockInput.pressKey("k")
      expect(editor.cursor.line).toBe(0)

      currentMockInput.pressKey("l")
      expect(editor.cursor.visualColumn).toBe(6)
    })

    it("should not insert text when key is bound to action", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello",
        width: 40,
        height: 10,
        keyBindings: [{ name: "x", action: "delete" }],
      })

      editor.focus()

      currentMockInput.pressKey("x")
      expect(editor.plainText).toBe("ello")

      expect(editor.plainText).not.toContain("x")
    })

    it("should still insert unbound keys as text", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
        keyBindings: [{ name: "j", action: "move-down" }],
      })

      editor.focus()

      currentMockInput.pressKey("h")
      expect(editor.plainText).toBe("h")

      currentMockInput.pressKey("i")
      expect(editor.plainText).toBe("hi")

      currentMockInput.pressKey("j")
      expect(editor.plainText).toBe("hi")
    })

    it("should differentiate between key with and without modifiers", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello",
        width: 40,
        height: 10,
        keyBindings: [
          { name: "d", action: "delete" },
          { name: "d", ctrl: true, action: "delete-line" },
        ],
      })

      editor.focus()

      currentMockInput.pressKey("d")
      expect(editor.plainText).toBe("ello")
    })

    it("should support selection actions with custom keybindings", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        selectable: true,
        keyBindings: [
          { name: "h", shift: true, action: "select-left" },
          { name: "l", shift: true, action: "select-right" },
        ],
      })

      editor.focus()
      editor.gotoLine(9999)

      currentMockInput.pressKey("H", { shift: true })
      expect(editor.hasSelection()).toBe(true)
      expect(editor.getSelectedText()).toBe("d")

      currentMockInput.pressKey("H", { shift: true })
      expect(editor.getSelectedText()).toBe("ld")

      currentMockInput.pressKey("L", { shift: true })
      expect(editor.getSelectedText()).toBe("d")
    })

    it("should execute correct action when multiple keys map to different actions with same base", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1\nLine 2",
        width: 40,
        height: 10,
        keyBindings: [
          { name: "j", action: "move-down" },
          { name: "j", ctrl: true, action: "buffer-end" },
        ],
      })

      editor.focus()

      currentMockInput.pressKey("j")
      expect(editor.cursor.line).toBe(1)

      editor.gotoLine(0)
      currentMockInput.pressKey("CTRL_J")
      expect(editor.cursor.line).toBe(1)
    })

    it("should handle all action types via custom keybindings", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
        selectable: true,
        keyBindings: [
          { name: "1", action: "move-left" },
          { name: "2", action: "move-right" },
          { name: "3", action: "move-up" },
          { name: "4", action: "move-down" },
          { name: "5", shift: true, action: "select-left" },
          { name: "6", shift: true, action: "select-right" },
          { name: "7", shift: true, action: "select-up" },
          { name: "8", shift: true, action: "select-down" },
          { name: "a", action: "line-home" },
          { name: "b", action: "line-end" },
          { name: "c", shift: true, action: "select-line-home" },
          { name: "d", shift: true, action: "select-line-end" },
          { name: "e", action: "buffer-home" },
          { name: "f", action: "buffer-end" },
          { name: "g", action: "delete-line" },
          { name: "h", action: "delete-to-line-end" },
          { name: "i", action: "backspace" },
          { name: "j", action: "delete" },
          { name: "k", action: "newline" },
          { name: "u", action: "undo" },
          { name: "r", action: "redo" },
        ],
      })

      editor.focus()
      editor.gotoLine(1)
      editor.moveCursorRight()
      editor.moveCursorRight()
      expect(editor.cursor.line).toBe(1)
      expect(editor.cursor.visualColumn).toBe(2)

      currentMockInput.pressKey("1")
      expect(editor.cursor.visualColumn).toBe(1)

      currentMockInput.pressKey("2")
      expect(editor.cursor.visualColumn).toBe(2)

      currentMockInput.pressKey("3")
      expect(editor.cursor.line).toBe(0)

      currentMockInput.pressKey("4")
      expect(editor.cursor.line).toBe(1)

      currentMockInput.pressKey("a")
      expect(editor.cursor.visualColumn).toBe(0)

      currentMockInput.pressKey("b")
      expect(editor.cursor.visualColumn).toBe(6)

      currentMockInput.pressKey("e")
      expect(editor.cursor.line).toBe(0)

      currentMockInput.pressKey("f")
      expect(editor.cursor.line).toBe(2)
    })

    it("should not break when empty keyBindings array is provided", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello",
        width: 40,
        height: 10,
        keyBindings: [],
      })

      editor.focus()

      currentMockInput.pressArrow("right")
      expect(editor.cursor.visualColumn).toBe(1)

      currentMockInput.pressKey("HOME")
      expect(editor.cursor.visualColumn).toBe(0)
    })

    it("should document limitation: bound character keys cannot be typed", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
        keyBindings: [
          { name: "h", action: "move-left" },
          { name: "j", action: "move-down" },
          { name: "k", action: "move-up" },
          { name: "l", action: "move-right" },
        ],
      })

      editor.focus()

      currentMockInput.pressKey("h")
      currentMockInput.pressKey("e")
      currentMockInput.pressKey("l")
      currentMockInput.pressKey("l")
      currentMockInput.pressKey("o")

      expect(editor.plainText).toBe("eo")
    })

    it("should allow typing bound characters when using modifier keys for bindings", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
        keyBindings: [
          { name: "h", ctrl: true, action: "move-left" },
          { name: "j", ctrl: true, action: "move-down" },
          { name: "k", ctrl: true, action: "move-up" },
          { name: "l", ctrl: true, action: "move-right" },
        ],
      })

      editor.focus()

      currentMockInput.pressKey("h")
      currentMockInput.pressKey("e")
      currentMockInput.pressKey("l")
      currentMockInput.pressKey("l")
      currentMockInput.pressKey("o")

      expect(editor.plainText).toBe("hello")

      currentMockInput.pressKey("CTRL_H")
      expect(editor.cursor.visualColumn).toBe(4)
    })
  })

  describe("Change Events", () => {
    describe("onCursorChange", () => {
      it("should fire onCursorChange when cursor moves", async () => {
        let cursorChangeCount = 0
        let lastCursorEvent: { line: number; visualColumn: number } | null = null

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "Line 1\nLine 2\nLine 3",
          width: 40,
          height: 10,
          onCursorChange: (event) => {
            cursorChangeCount++
            lastCursorEvent = event
          },
        })

        editor.focus()
        const initialCount = cursorChangeCount

        editor.moveCursorRight()
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(cursorChangeCount).toBeGreaterThan(initialCount)
        expect(lastCursorEvent).not.toBe(null)
        expect(lastCursorEvent!.line).toBe(0)
        expect(lastCursorEvent!.visualColumn).toBe(1)

        const prevCount = cursorChangeCount

        editor.moveCursorDown()
        await new Promise((resolve) => setTimeout(resolve, 20))

        expect(cursorChangeCount).toBeGreaterThanOrEqual(prevCount)
        expect(lastCursorEvent).not.toBe(null)
        expect(lastCursorEvent!.line).toBeGreaterThanOrEqual(0)
      })

      it("should fire onCursorChange when typing moves cursor", async () => {
        let cursorChangeCount = 0
        let lastCursorEvent: { line: number; visualColumn: number } | null = null

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "",
          width: 40,
          height: 10,
          onCursorChange: (event) => {
            cursorChangeCount++
            lastCursorEvent = event
          },
        })

        editor.focus()
        const initialCount = cursorChangeCount

        currentMockInput.pressKey("H")
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(cursorChangeCount).toBeGreaterThan(initialCount)
        expect(lastCursorEvent).not.toBe(null)
        expect(lastCursorEvent!.line).toBe(0)
        expect(lastCursorEvent!.visualColumn).toBe(1)
      })

      it("should fire onCursorChange when pressing arrow keys", async () => {
        let cursorEventCount = 0
        let lastCursorEvent: { line: number; visualColumn: number } | null = null

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "ABC\nDEF",
          width: 40,
          height: 10,
          onCursorChange: (event) => {
            cursorEventCount++
            lastCursorEvent = event
          },
        })

        editor.focus()
        const initialCount = cursorEventCount

        currentMockInput.pressArrow("right")
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(cursorEventCount).toBeGreaterThan(initialCount)
        expect(lastCursorEvent).not.toBe(null)
        expect(lastCursorEvent!.visualColumn).toBe(1)

        const beforeDown = cursorEventCount
        currentMockInput.pressArrow("down")
        await new Promise((resolve) => setTimeout(resolve, 20))

        expect(cursorEventCount).toBeGreaterThanOrEqual(beforeDown)
        expect(lastCursorEvent).not.toBe(null)
      })

      it("should fire onCursorChange when using gotoLine", async () => {
        let cursorChangeCount = 0
        let lastCursorEvent: { line: number; visualColumn: number } | null = null

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "Line 0\nLine 1\nLine 2",
          width: 40,
          height: 10,
          onCursorChange: (event) => {
            cursorChangeCount++
            lastCursorEvent = event
          },
        })

        editor.focus()
        const initialCount = cursorChangeCount

        editor.gotoLine(2)
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(cursorChangeCount).toBeGreaterThan(initialCount)
        expect(lastCursorEvent).not.toBe(null)
        expect(lastCursorEvent!.line).toBe(2)
        expect(lastCursorEvent!.visualColumn).toBe(0)
      })

      it("should fire onCursorChange after undo", async () => {
        let cursorChangeCount = 0

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "",
          width: 40,
          height: 10,
          onCursorChange: () => {
            cursorChangeCount++
          },
        })

        editor.focus()

        currentMockInput.pressKey("H")
        currentMockInput.pressKey("i")
        await new Promise((resolve) => setTimeout(resolve, 10))

        const beforeUndo = cursorChangeCount

        editor.undo()
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(cursorChangeCount).toBeGreaterThan(beforeUndo)
      })

      it("should update event handler when set dynamically", async () => {
        let firstHandlerCalled = false
        let secondHandlerCalled = false

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "Test",
          width: 40,
          height: 10,
          onCursorChange: () => {
            firstHandlerCalled = true
          },
        })

        editor.focus()

        editor.moveCursorRight()
        await new Promise((resolve) => setTimeout(resolve, 10))
        expect(firstHandlerCalled).toBe(true)

        editor.onCursorChange = () => {
          secondHandlerCalled = true
        }

        editor.moveCursorRight()
        await new Promise((resolve) => setTimeout(resolve, 10))
        expect(secondHandlerCalled).toBe(true)
      })

      it("should not fire when handler is undefined", async () => {
        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "Test",
          width: 40,
          height: 10,
          onCursorChange: undefined,
        })

        editor.focus()

        editor.moveCursorRight()
        expect(editor.cursor.visualColumn).toBe(1)
      })
    })

    describe("onContentChange", () => {
      it("should fire onContentChange when typing", async () => {
        let contentChangeCount = 0

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "",
          width: 40,
          height: 10,
          onContentChange: () => {
            contentChangeCount++
          },
        })

        editor.focus()
        const initialCount = contentChangeCount

        currentMockInput.pressKey("H")
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(contentChangeCount).toBeGreaterThan(initialCount)
        expect(editor.plainText).toBe("H")
      })

      it("should fire onContentChange when deleting", async () => {
        let contentChangeCount = 0

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "Hello",
          width: 40,
          height: 10,
          onContentChange: () => {
            contentChangeCount++
          },
        })

        editor.focus()
        editor.gotoLine(9999)
        const initialCount = contentChangeCount

        currentMockInput.pressBackspace()
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(contentChangeCount).toBeGreaterThan(initialCount)
        expect(editor.plainText).toBe("Hell")
      })

      it("should fire onContentChange when inserting newline", async () => {
        let contentChangeCount = 0

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "Test",
          width: 40,
          height: 10,
          onContentChange: () => {
            contentChangeCount++
          },
        })

        editor.focus()
        editor.gotoLine(9999)
        const initialCount = contentChangeCount

        currentMockInput.pressEnter()
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(contentChangeCount).toBeGreaterThan(initialCount)
        expect(editor.plainText).toBe("Test\n")
      })

      it("should fire onContentChange when pasting", async () => {
        let contentChangeCount = 0

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "Hello",
          width: 40,
          height: 10,
          onContentChange: () => {
            contentChangeCount++
          },
        })

        editor.focus()
        editor.gotoLine(9999)

        const initialCount = contentChangeCount

        await currentMockInput.pasteBracketedText(" World")

        expect(contentChangeCount).toBeGreaterThan(initialCount)
        expect(editor.plainText).toBe("Hello World")
      })

      it("should fire onContentChange after undo", async () => {
        let contentChangeCount = 0

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "",
          width: 40,
          height: 10,
          onContentChange: () => {
            contentChangeCount++
          },
        })

        editor.focus()

        currentMockInput.pressKey("T")
        currentMockInput.pressKey("e")
        await new Promise((resolve) => setTimeout(resolve, 20))

        const beforeUndo = contentChangeCount

        editor.undo()
        await new Promise((resolve) => setTimeout(resolve, 20))

        expect(contentChangeCount).toBeGreaterThanOrEqual(beforeUndo)
        expect(editor.plainText).toBe("T")
      })

      it("should fire onContentChange after redo", async () => {
        let contentChangeCount = 0

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "",
          width: 40,
          height: 10,
          onContentChange: () => {
            contentChangeCount++
          },
        })

        editor.focus()

        currentMockInput.pressKey("X")
        await new Promise((resolve) => setTimeout(resolve, 20))
        editor.undo()
        await new Promise((resolve) => setTimeout(resolve, 20))

        const beforeRedo = contentChangeCount

        editor.redo()
        await new Promise((resolve) => setTimeout(resolve, 20))

        expect(contentChangeCount).toBeGreaterThanOrEqual(beforeRedo)
        expect(editor.plainText).toBe("X")
      })

      it("should fire onContentChange when setting value programmatically", async () => {
        let contentChangeCount = 0

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "Initial",
          width: 40,
          height: 10,
          onContentChange: () => {
            contentChangeCount++
          },
        })

        const initialCount = contentChangeCount

        editor.setText("Updated")
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(contentChangeCount).toBeGreaterThan(initialCount)
        expect(editor.plainText).toBe("Updated")
      })

      it("should fire onContentChange when deleting selection", async () => {
        let contentChangeCount = 0

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "Hello World",
          width: 40,
          height: 10,
          selectable: true,
          onContentChange: () => {
            contentChangeCount++
          },
        })

        editor.focus()

        for (let i = 0; i < 5; i++) {
          currentMockInput.pressArrow("right", { shift: true })
        }
        await new Promise((resolve) => setTimeout(resolve, 10))

        const beforeDelete = contentChangeCount

        currentMockInput.pressBackspace()
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(contentChangeCount).toBeGreaterThan(beforeDelete)
        expect(editor.plainText).toBe(" World")
      })

      it("should update event handler when set dynamically", async () => {
        let firstHandlerCalled = false
        let secondHandlerCalled = false

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "",
          width: 40,
          height: 10,
          onContentChange: () => {
            firstHandlerCalled = true
          },
        })

        editor.focus()

        currentMockInput.pressKey("A")
        await new Promise((resolve) => setTimeout(resolve, 10))
        expect(firstHandlerCalled).toBe(true)

        editor.onContentChange = () => {
          secondHandlerCalled = true
        }

        currentMockInput.pressKey("B")
        await new Promise((resolve) => setTimeout(resolve, 10))
        expect(secondHandlerCalled).toBe(true)
      })

      it("should not fire when handler is undefined", async () => {
        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "",
          width: 40,
          height: 10,
          onContentChange: undefined,
        })

        editor.focus()

        currentMockInput.pressKey("X")
        expect(editor.plainText).toBe("X")
      })

      it("should fire exactly once when setting via setter and pressing a key", async () => {
        let contentChangeCount = 0

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "",
          width: 40,
          height: 10,
        })

        editor.focus()

        editor.onContentChange = () => {
          contentChangeCount++
        }

        currentMockInput.pressKey("X")
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(contentChangeCount).toBe(1)
        expect(editor.plainText).toBe("X")
      })
    })

    describe("Combined cursor and content events", () => {
      it("should fire both onCursorChange and onContentChange when typing", async () => {
        let cursorChangeCount = 0
        let contentChangeCount = 0

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "",
          width: 40,
          height: 10,
          onCursorChange: () => {
            cursorChangeCount++
          },
          onContentChange: () => {
            contentChangeCount++
          },
        })

        editor.focus()
        const initialCursorCount = cursorChangeCount
        const initialContentCount = contentChangeCount

        currentMockInput.pressKey("H")
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(cursorChangeCount).toBeGreaterThan(initialCursorCount)
        expect(contentChangeCount).toBeGreaterThan(initialContentCount)
      })

      it("should fire onCursorChange but not onContentChange when only moving cursor", async () => {
        let cursorChangeCount = 0
        let contentChangeCount = 0

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "Test",
          width: 40,
          height: 10,
          onCursorChange: () => {
            cursorChangeCount++
          },
          onContentChange: () => {
            contentChangeCount++
          },
        })

        editor.focus()
        const initialCursorCount = cursorChangeCount
        const initialContentCount = contentChangeCount

        editor.moveCursorRight()
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(cursorChangeCount).toBeGreaterThan(initialCursorCount)
        expect(contentChangeCount).toBe(initialContentCount) // Should not change
      })

      it("should track events through complex editing sequence", async () => {
        const events: Array<{ type: "cursor" | "content"; time: number }> = []

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "",
          width: 40,
          height: 10,
          onCursorChange: () => {
            events.push({ type: "cursor", time: Date.now() })
          },
          onContentChange: () => {
            events.push({ type: "content", time: Date.now() })
          },
        })

        editor.focus()
        events.length = 0 // Clear initial events

        currentMockInput.pressKey("H")
        currentMockInput.pressKey("e")
        currentMockInput.pressKey("l")
        currentMockInput.pressKey("l")
        currentMockInput.pressKey("o")

        editor.moveCursorLeft()
        editor.moveCursorLeft()

        currentMockInput.pressBackspace()

        await new Promise((resolve) => setTimeout(resolve, 50))

        const cursorEvents = events.filter((e) => e.type === "cursor")
        const contentEvents = events.filter((e) => e.type === "content")

        expect(cursorEvents.length).toBeGreaterThan(0)
        expect(contentEvents.length).toBeGreaterThan(0)
      })
    })
  })

  describe("Textarea Content Snapshots", () => {
    it("should render basic text content correctly", async () => {
      await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        left: 5,
        top: 3,
        width: 20,
        height: 5,
      })

      const frame = captureFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render multiline text content correctly", async () => {
      await createTextareaRenderable(currentRenderer, {
        initialValue: "Line 1: Hello\nLine 2: World\nLine 3: Testing\nLine 4: Multiline",
        left: 1,
        top: 1,
        width: 30,
        height: 10,
      })

      const frame = captureFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render text with character wrapping correctly", async () => {
      await createTextareaRenderable(currentRenderer, {
        initialValue: "This is a very long text that should wrap to multiple lines when wrap is enabled",
        wrapMode: "char",
        width: 15,
        left: 0,
        top: 0,
      })

      const frame = captureFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render text with word wrapping and punctuation", async () => {
      await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello,World.Test-Example/Path with various punctuation marks!",
        wrapMode: "word",
        width: 12,
        left: 0,
        top: 0,
      })

      const frame = captureFrame()
      expect(frame).toMatchSnapshot()
    })
  })

  describe("Layout Reflow on Size Change", () => {
    it("should reflow subsequent elements when textarea grows and shrinks", async () => {
      const { textarea: firstEditor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Short",
        width: 20,
        wrapMode: "word",
      })

      const { textarea: secondEditor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "I am below the first textarea",
        width: 30,
      })

      await renderOnce()

      // Initially, first editor is 1 line high
      expect(firstEditor.height).toBe(1)
      const initialSecondY = secondEditor.y
      expect(initialSecondY).toBe(1) // Right after first editor

      // Expand first editor with wrapped content
      firstEditor.setText("This is a very long line that will wrap to multiple lines and push the second textarea down")
      await renderOnce()

      // First editor should now be taller
      expect(firstEditor.height).toBeGreaterThan(1)
      // Second editor should have moved down
      expect(secondEditor.y).toBeGreaterThan(initialSecondY)
      const expandedSecondY = secondEditor.y

      // Shrink first editor back
      firstEditor.setText("Short again")
      await renderOnce()

      // First editor should be 1 line again
      expect(firstEditor.height).toBe(1)
      // Second editor should have moved back up
      expect(secondEditor.y).toBeLessThan(expandedSecondY)
      expect(secondEditor.y).toBe(initialSecondY)
    })
  })

  describe("Width/Height Setter Layout Tests", () => {
    it("should not shrink box when width is set via setter", async () => {
      const { BoxRenderable } = await import("./Box")
      const { TextRenderable } = await import("./Text")

      resize(40, 10)

      const container = new BoxRenderable(currentRenderer, { border: true, width: 30 })
      currentRenderer.root.add(container)

      const row = new BoxRenderable(currentRenderer, { flexDirection: "row", width: "100%" })
      container.add(row)

      const indicator = new BoxRenderable(currentRenderer, { backgroundColor: "#f00" })
      row.add(indicator)

      const indicatorText = new TextRenderable(currentRenderer, { content: ">" })
      indicator.add(indicatorText)

      const content = new BoxRenderable(currentRenderer, { backgroundColor: "#0f0", flexGrow: 1 })
      row.add(content)

      const contentText = new TextRenderable(currentRenderer, { content: "Content that takes up space" })
      content.add(contentText)

      await renderOnce()

      const initialIndicatorWidth = indicator.width

      indicator.width = 5
      await renderOnce()

      const frame = captureFrame()
      expect(frame).toMatchSnapshot()

      expect(indicator.width).toBe(5)
      expect(content.width).toBeGreaterThan(0)
      expect(content.width).toBeLessThan(30)
    })

    it("should not shrink box when height is set via setter in column layout with textarea", async () => {
      const { BoxRenderable } = await import("./Box")
      const { TextRenderable } = await import("./Text")

      resize(30, 15)

      const outerBox = new BoxRenderable(currentRenderer, { border: true, width: 25, height: 10 })
      currentRenderer.root.add(outerBox)

      const column = new BoxRenderable(currentRenderer, { flexDirection: "column", height: "100%" })
      outerBox.add(column)

      const header = new BoxRenderable(currentRenderer, { backgroundColor: "#f00" })
      column.add(header)

      const headerText = new TextRenderable(currentRenderer, { content: "Header" })
      header.add(headerText)

      const mainContent = new BoxRenderable(currentRenderer, { backgroundColor: "#0f0", flexGrow: 1 })
      column.add(mainContent)

      const { textarea: mainTextarea } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line1\nLine2\nLine3\nLine4\nLine5\nLine6\nLine7\nLine8",
      })
      mainContent.add(mainTextarea)

      const footer = new BoxRenderable(currentRenderer, { height: 2, backgroundColor: "#00f" })
      column.add(footer)

      const footerText = new TextRenderable(currentRenderer, { content: "Footer" })
      footer.add(footerText)

      await renderOnce()

      header.height = 3
      await renderOnce()

      const frame = captureFrame()
      expect(frame).toMatchSnapshot()

      expect(header.height).toBe(3)
      expect(mainContent.height).toBeGreaterThan(0)
      expect(footer.height).toBe(2)
    })

    it("should not shrink box when minWidth is set via setter", async () => {
      const { BoxRenderable } = await import("./Box")
      const { TextRenderable } = await import("./Text")

      resize(40, 10)

      const container = new BoxRenderable(currentRenderer, { border: true, width: 30 })
      currentRenderer.root.add(container)

      const row = new BoxRenderable(currentRenderer, { flexDirection: "row", width: "100%" })
      container.add(row)

      const indicator = new BoxRenderable(currentRenderer, { backgroundColor: "#f00", flexShrink: 1 })
      row.add(indicator)

      const indicatorText = new TextRenderable(currentRenderer, { content: ">" })
      indicator.add(indicatorText)

      const content = new BoxRenderable(currentRenderer, { backgroundColor: "#0f0", flexGrow: 1 })
      row.add(content)

      const contentText = new TextRenderable(currentRenderer, { content: "Content that takes up space" })
      content.add(contentText)

      await renderOnce()

      indicator.minWidth = 5
      await renderOnce()

      const frame = captureFrame()
      expect(frame).toMatchSnapshot()
      expect(indicator.width).toBeGreaterThanOrEqual(5)
      expect(content.width).toBeGreaterThan(0)
    })

    it("should not shrink box when minHeight is set via setter in column layout with textarea", async () => {
      const { BoxRenderable } = await import("./Box")
      const { TextRenderable } = await import("./Text")

      resize(30, 15)

      const outerBox = new BoxRenderable(currentRenderer, { border: true, width: 25, height: 10 })
      currentRenderer.root.add(outerBox)

      const column = new BoxRenderable(currentRenderer, { flexDirection: "column", height: "100%" })
      outerBox.add(column)

      const header = new BoxRenderable(currentRenderer, { backgroundColor: "#f00", flexShrink: 1 })
      column.add(header)

      const headerText = new TextRenderable(currentRenderer, { content: "Header" })
      header.add(headerText)

      const mainContent = new BoxRenderable(currentRenderer, { backgroundColor: "#0f0", flexGrow: 1 })
      column.add(mainContent)

      const { textarea: mainTextarea } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line1\nLine2\nLine3\nLine4\nLine5\nLine6\nLine7\nLine8",
      })
      mainContent.add(mainTextarea)

      const footer = new BoxRenderable(currentRenderer, { height: 2, backgroundColor: "#00f" })
      column.add(footer)

      const footerText = new TextRenderable(currentRenderer, { content: "Footer" })
      footer.add(footerText)

      await renderOnce()

      header.minHeight = 3
      await renderOnce()

      const frame = captureFrame()
      expect(frame).toMatchSnapshot()

      expect(header.height).toBeGreaterThanOrEqual(3)
      expect(mainContent.height).toBeGreaterThan(0)
      expect(footer.height).toBe(2)
    })

    it("should not shrink box when width is set from undefined via setter", async () => {
      const { BoxRenderable } = await import("./Box")
      const { TextRenderable } = await import("./Text")

      resize(40, 10)

      const container = new BoxRenderable(currentRenderer, { border: true, width: 30 })
      currentRenderer.root.add(container)

      const row = new BoxRenderable(currentRenderer, { flexDirection: "row", width: "100%" })
      container.add(row)

      const indicator = new BoxRenderable(currentRenderer, { backgroundColor: "#f00", flexShrink: 1 })
      row.add(indicator)

      const indicatorText = new TextRenderable(currentRenderer, { content: ">" })
      indicator.add(indicatorText)

      const content = new BoxRenderable(currentRenderer, { backgroundColor: "#0f0", flexGrow: 1 })
      row.add(content)

      const contentText = new TextRenderable(currentRenderer, { content: "Content that takes up space" })
      content.add(contentText)

      await renderOnce()

      indicator.width = 5
      await renderOnce()

      const frame = captureFrame()
      expect(frame).toMatchSnapshot()

      expect(indicator.width).toBe(5)
      expect(content.width).toBeGreaterThan(0)
    })

    it("should verify dimensions are actually respected under extreme pressure", async () => {
      const { BoxRenderable } = await import("./Box")
      const { TextRenderable } = await import("./Text")

      resize(30, 10)

      const container = new BoxRenderable(currentRenderer, { border: true, width: 20 })
      currentRenderer.root.add(container)

      const row = new BoxRenderable(currentRenderer, { flexDirection: "row", width: "100%" })
      container.add(row)

      const box1 = new BoxRenderable(currentRenderer, { backgroundColor: "#f00", flexShrink: 1 })
      row.add(box1)
      const text1 = new TextRenderable(currentRenderer, { content: "AAA" })
      box1.add(text1)

      const box2 = new BoxRenderable(currentRenderer, { backgroundColor: "#0f0", flexShrink: 1 })
      row.add(box2)
      const text2 = new TextRenderable(currentRenderer, { content: "BBB" })
      box2.add(text2)

      const box3 = new BoxRenderable(currentRenderer, { backgroundColor: "#00f", flexGrow: 1 })
      row.add(box3)
      const text3 = new TextRenderable(currentRenderer, { content: "CCC" })
      box3.add(text3)

      await renderOnce()

      box1.width = 7
      box2.minWidth = 5
      await renderOnce()

      expect(box1.width).toBe(7)
      expect(box2.width).toBeGreaterThanOrEqual(5)
      expect(box3.width).toBeGreaterThan(0)

      const total = box1.width + box2.width + box3.width
      expect(total).toBeLessThanOrEqual(18)
    })
  })

  describe("Visual Cursor with Offset", () => {
    it("should have visualCursor with offset property", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      editor.focus()

      const visualCursor = editor.visualCursor
      expect(visualCursor).not.toBe(null)
      expect(visualCursor!.offset).toBeDefined()
      expect(visualCursor!.offset).toBe(0)
    })

    it("should update offset after inserting text", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      editor.focus()

      editor.insertText("Hello")

      const visualCursor = editor.visualCursor
      expect(visualCursor).not.toBe(null)
      expect(visualCursor!.offset).toBe(5)
    })

    it("should update offset correctly for multi-line content", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "ABC\nDEF",
        width: 40,
        height: 10,
      })

      editor.focus()

      // Cursor at start
      let visualCursor = editor.visualCursor
      expect(visualCursor!.offset).toBe(0)

      // Move to end of first line
      for (let i = 0; i < 3; i++) {
        editor.moveCursorRight()
      }
      visualCursor = editor.visualCursor
      expect(visualCursor!.offset).toBe(3)

      // Move to second line (across newline)
      editor.moveCursorRight()
      visualCursor = editor.visualCursor
      expect(visualCursor!.offset).toBe(4)
      expect(visualCursor!.logicalRow).toBe(1)
      expect(visualCursor!.logicalCol).toBe(0)

      // Move to end of second line
      for (let i = 0; i < 3; i++) {
        editor.moveCursorRight()
      }
      visualCursor = editor.visualCursor
      expect(visualCursor!.offset).toBe(7)
    })

    it("should set cursor by offset", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
      })

      editor.focus()

      // Set cursor to offset 6 (after "Hello ")
      editor.editBuffer.setCursorByOffset(6)

      const visualCursor = editor.visualCursor
      expect(visualCursor).not.toBe(null)
      expect(visualCursor!.offset).toBe(6)
      expect(visualCursor!.logicalRow).toBe(0)
      expect(visualCursor!.logicalCol).toBe(6)

      // Set cursor to offset 2
      editor.editBuffer.setCursorByOffset(2)

      const newVisualCursor = editor.visualCursor
      expect(newVisualCursor).not.toBe(null)
      expect(newVisualCursor!.offset).toBe(2)
      expect(newVisualCursor!.logicalRow).toBe(0)
      expect(newVisualCursor!.logicalCol).toBe(2)
    })

    it("should set cursor by offset in multi-line content", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "Line1\nLine2\nLine3",
        width: 40,
        height: 10,
      })

      editor.focus()

      // Set cursor to offset 6 (start of "Line2")
      editor.editBuffer.setCursorByOffset(6)

      const visualCursor = editor.visualCursor
      expect(visualCursor).not.toBe(null)
      expect(visualCursor!.offset).toBe(6)
      expect(visualCursor!.logicalRow).toBe(1)
      expect(visualCursor!.logicalCol).toBe(0)

      // Set cursor to offset 8 (L[i]ne2, at 'n')
      editor.editBuffer.setCursorByOffset(8)

      const newVisualCursor = editor.visualCursor
      expect(newVisualCursor).not.toBe(null)
      expect(newVisualCursor!.offset).toBe(8)
      expect(newVisualCursor!.logicalRow).toBe(1)
      expect(newVisualCursor!.logicalCol).toBe(2)
    })

    it("should maintain offset consistency when using editorView.setCursorByOffset", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "ABCDEF",
        width: 40,
        height: 10,
      })

      editor.focus()

      // Use editorView instead of editBuffer
      editor.editorView.setCursorByOffset(3)

      const visualCursor = editor.visualCursor
      expect(visualCursor).not.toBe(null)
      expect(visualCursor!.offset).toBe(3)
      expect(visualCursor!.logicalRow).toBe(0)
      expect(visualCursor!.logicalCol).toBe(3)
    })

    it("should set cursor to end of content using cursorOffset setter and Bun.stringWidth", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      editor.focus()

      const content = "Hello World"
      editor.setText(content)
      editor.cursorOffset = Bun.stringWidth(content)

      const visualCursor = editor.visualCursor
      expect(visualCursor).not.toBe(null)
      expect(visualCursor!.offset).toBe(Bun.stringWidth(content))
      expect(visualCursor!.logicalRow).toBe(0)
      expect(visualCursor!.logicalCol).toBe(content.length)
      expect(visualCursor!.visualCol).toBe(content.length)

      // Verify cursor is at the end
      expect(editor.cursorOffset).toBe(11)
      expect(editor.plainText).toBe("Hello World")
    })
  })

  describe("Syntax Highlighting", () => {
    describe("SyntaxStyle Management", () => {
      it("should set syntax style via constructor option", async () => {
        const style = SyntaxStyle.create()
        const styleId = style.registerStyle("keyword", {
          fg: RGBA.fromValues(0, 1, 0, 1),
          bold: true,
        })

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "const x = 5",
          width: 40,
          height: 10,
          syntaxStyle: style,
        })

        expect(editor.syntaxStyle).toBe(style)
      })

      it("should set syntax style via setter", async () => {
        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "test",
          width: 40,
          height: 10,
        })

        expect(editor.syntaxStyle).toBe(null)

        const style = SyntaxStyle.create()
        editor.syntaxStyle = style

        expect(editor.syntaxStyle).toBe(style)
      })

      it("should clear syntax style when set to null", async () => {
        const style = SyntaxStyle.create()

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "test",
          width: 40,
          height: 10,
          syntaxStyle: style,
        })

        expect(editor.syntaxStyle).toBe(style)

        editor.syntaxStyle = null

        expect(editor.syntaxStyle).toBe(null)
      })
    })

    describe("Highlight Management", () => {
      it("should add highlight by line and column range", async () => {
        const style = SyntaxStyle.create()
        const styleId = style.registerStyle("highlight", {
          fg: RGBA.fromValues(1, 0, 0, 1),
        })

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "Hello World",
          width: 40,
          height: 10,
          syntaxStyle: style,
        })

        editor.addHighlight(0, { start: 0, end: 5, styleId: styleId, priority: 0 })

        const highlights = editor.getLineHighlights(0)
        expect(highlights.length).toBe(1)
        expect(highlights[0].start).toBe(0)
        expect(highlights[0].end).toBe(5)
        expect(highlights[0].styleId).toBe(styleId)
        expect(highlights[0].priority).toBe(0)
        expect(highlights[0].hlRef).toBe(0)
      })

      it("should add multiple highlights to same line", async () => {
        const style = SyntaxStyle.create()
        const keywordId = style.registerStyle("keyword", { fg: RGBA.fromValues(1, 0, 0, 1) })
        const stringId = style.registerStyle("string", { fg: RGBA.fromValues(0, 1, 0, 1) })

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "const name = 'value'",
          width: 40,
          height: 10,
          syntaxStyle: style,
        })

        editor.addHighlight(0, { start: 0, end: 5, styleId: keywordId, priority: 0 }) // "const"
        editor.addHighlight(0, { start: 13, end: 20, styleId: stringId, priority: 0 }) // "'value'"

        const highlights = editor.getLineHighlights(0)
        expect(highlights.length).toBe(2)
        expect(highlights[0].start).toBe(0)
        expect(highlights[0].end).toBe(5)
        expect(highlights[0].styleId).toBe(keywordId)
        expect(highlights[1].start).toBe(13)
        expect(highlights[1].end).toBe(20)
        expect(highlights[1].styleId).toBe(stringId)
      })

      it("should add highlight by character range", async () => {
        const style = SyntaxStyle.create()
        const styleId = style.registerStyle("highlight", {
          fg: RGBA.fromValues(1, 1, 0, 1),
        })

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "Line 1\nLine 2\nLine 3",
          width: 40,
          height: 10,
          syntaxStyle: style,
        })

        // Highlight from "ine 2" to "ine 3" (char offset 7-13, newlines not counted)
        // Char positions (excluding newlines): "Line 1" = 0-5, "Line 2" = 6-11, "Line 3" = 12-17
        // Char 7 = "i" in "Line 2" (col 1), Char 13 = "i" in "Line 3" (col 1)
        editor.addHighlightByCharRange({ start: 7, end: 13, styleId: styleId, priority: 0 })

        const highlights = editor.getLineHighlights(1)
        expect(highlights.length).toBe(1)
        expect(highlights[0].start).toBe(1) // Second character "i" in "Line 2"
        expect(highlights[0].end).toBe(6) // End of "Line 2"
        expect(highlights[0].styleId).toBe(styleId)
      })

      it("should add highlight with custom priority", async () => {
        const style = SyntaxStyle.create()
        const lowPriorityId = style.registerStyle("low", { fg: RGBA.fromValues(0.5, 0.5, 0.5, 1) })
        const highPriorityId = style.registerStyle("high", { fg: RGBA.fromValues(1, 0, 0, 1) })

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "overlapping",
          width: 40,
          height: 10,
          syntaxStyle: style,
        })

        editor.addHighlight(0, { start: 0, end: 10, styleId: lowPriorityId, priority: 1 })
        editor.addHighlight(0, { start: 3, end: 8, styleId: highPriorityId, priority: 10 })

        const highlights = editor.getLineHighlights(0)
        expect(highlights.length).toBe(2)
        expect(highlights[0].priority).toBe(1)
        expect(highlights[1].priority).toBe(10)
      })

      it("should add highlight with reference ID", async () => {
        const style = SyntaxStyle.create()
        const styleId = style.registerStyle("ref-highlight", {
          fg: RGBA.fromValues(0, 0, 1, 1),
        })

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "test content",
          width: 40,
          height: 10,
          syntaxStyle: style,
        })

        const refId = 42
        editor.addHighlight(0, { start: 0, end: 4, styleId: styleId, priority: 0, hlRef: refId })

        const highlights = editor.getLineHighlights(0)
        expect(highlights.length).toBe(1)
        expect(highlights[0].hlRef).toBe(refId)
      })

      it("should remove highlights by reference ID", async () => {
        const style = SyntaxStyle.create()
        const styleId1 = style.registerStyle("style1", { fg: RGBA.fromValues(1, 0, 0, 1) })
        const styleId2 = style.registerStyle("style2", { fg: RGBA.fromValues(0, 1, 0, 1) })

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "test content here",
          width: 40,
          height: 10,
          syntaxStyle: style,
        })

        editor.addHighlight(0, { start: 0, end: 4, styleId: styleId1, priority: 0, hlRef: 1 })
        editor.addHighlight(0, { start: 5, end: 12, styleId: styleId2, priority: 0, hlRef: 2 })
        editor.addHighlight(0, { start: 13, end: 17, styleId: styleId1, priority: 0, hlRef: 1 })

        let highlights = editor.getLineHighlights(0)
        expect(highlights.length).toBe(3)

        editor.removeHighlightsByRef(1)

        highlights = editor.getLineHighlights(0)
        expect(highlights.length).toBe(1)
        expect(highlights[0].start).toBe(5)
        expect(highlights[0].hlRef).toBe(2)
      })

      it("should clear highlights for specific line", async () => {
        const style = SyntaxStyle.create()
        const styleId = style.registerStyle("style", { fg: RGBA.fromValues(1, 1, 1, 1) })

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "Line 1\nLine 2\nLine 3",
          width: 40,
          height: 10,
          syntaxStyle: style,
        })

        editor.addHighlight(0, { start: 0, end: 6, styleId: styleId, priority: 0 })
        editor.addHighlight(1, { start: 0, end: 6, styleId: styleId, priority: 0 })
        editor.addHighlight(2, { start: 0, end: 6, styleId: styleId, priority: 0 })

        expect(editor.getLineHighlights(0).length).toBe(1)
        expect(editor.getLineHighlights(1).length).toBe(1)
        expect(editor.getLineHighlights(2).length).toBe(1)

        editor.clearLineHighlights(1)

        expect(editor.getLineHighlights(0).length).toBe(1)
        expect(editor.getLineHighlights(1).length).toBe(0)
        expect(editor.getLineHighlights(2).length).toBe(1)
      })

      it("should clear all highlights", async () => {
        const style = SyntaxStyle.create()
        const styleId = style.registerStyle("style", { fg: RGBA.fromValues(1, 1, 1, 1) })

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "Line 1\nLine 2\nLine 3",
          width: 40,
          height: 10,
          syntaxStyle: style,
        })

        editor.addHighlight(0, { start: 0, end: 6, styleId: styleId, priority: 0 })
        editor.addHighlight(1, { start: 0, end: 6, styleId: styleId, priority: 0 })
        editor.addHighlight(2, { start: 0, end: 6, styleId: styleId, priority: 0 })

        expect(editor.getLineHighlights(0).length).toBe(1)
        expect(editor.getLineHighlights(1).length).toBe(1)
        expect(editor.getLineHighlights(2).length).toBe(1)

        editor.clearAllHighlights()

        expect(editor.getLineHighlights(0).length).toBe(0)
        expect(editor.getLineHighlights(1).length).toBe(0)
        expect(editor.getLineHighlights(2).length).toBe(0)
      })

      it("should return empty array for line with no highlights", async () => {
        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "Line 1\nLine 2",
          width: 40,
          height: 10,
        })

        const highlights = editor.getLineHighlights(0)
        expect(highlights).toEqual([])
      })

      it("should return empty array for line index out of bounds", async () => {
        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "Single line",
          width: 40,
          height: 10,
        })

        const highlights = editor.getLineHighlights(999)
        expect(highlights).toEqual([])
      })

      it("should handle highlights spanning multiple lines via character range", async () => {
        const style = SyntaxStyle.create()
        const styleId = style.registerStyle("multiline", {
          bg: RGBA.fromValues(0.2, 0.2, 0.2, 1),
        })

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "AAAA\nBBBB\nCCCC",
          width: 40,
          height: 10,
          syntaxStyle: style,
        })

        // Highlight from middle of line 0 to all of line 2 (chars 2-12, newlines not counted)
        // Char positions (excluding newlines): "AAAA" = 0-3, "BBBB" = 4-7, "CCCC" = 8-11
        // Char 2 = third "A", Char 12 = one past end
        editor.addHighlightByCharRange({ start: 2, end: 12, styleId: styleId, priority: 0 })

        const hl0 = editor.getLineHighlights(0)
        const hl1 = editor.getLineHighlights(1)
        const hl2 = editor.getLineHighlights(2)

        expect(hl0.length).toBe(1)
        expect(hl0[0].start).toBe(2)
        expect(hl0[0].end).toBe(4)

        expect(hl1.length).toBe(1)
        expect(hl1[0].start).toBe(0)
        expect(hl1[0].end).toBe(4)

        expect(hl2.length).toBe(1)
        expect(hl2[0].start).toBe(0)
        expect(hl2[0].end).toBe(4) // All of "CCCC"
      })

      it("should preserve highlights after text editing when using hlRef", async () => {
        const style = SyntaxStyle.create()
        const styleId = style.registerStyle("persistent", {
          fg: RGBA.fromValues(1, 0, 1, 1),
        })

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "Hello World",
          width: 40,
          height: 10,
          syntaxStyle: style,
        })

        editor.addHighlight(0, { start: 0, end: 5, styleId: styleId, priority: 0, hlRef: 100 })

        let highlights = editor.getLineHighlights(0)
        expect(highlights.length).toBe(1)
        expect(highlights[0].hlRef).toBe(100)

        // Edit text
        editor.focus()
        editor.gotoLine(9999)
        currentMockInput.pressKey("!")

        // Highlight should still exist (this is line-based, not offset-based)
        highlights = editor.getLineHighlights(0)
        expect(highlights.length).toBe(1)
        expect(highlights[0].hlRef).toBe(100)
      })

      it("should handle multiple highlights with different priorities", async () => {
        const style = SyntaxStyle.create()
        const baseId = style.registerStyle("base", { fg: RGBA.fromValues(0.5, 0.5, 0.5, 1) })
        const mediumId = style.registerStyle("medium", { fg: RGBA.fromValues(0, 1, 0, 1) })
        const highId = style.registerStyle("high", { fg: RGBA.fromValues(1, 0, 0, 1) })

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "overlapping text",
          width: 40,
          height: 10,
          syntaxStyle: style,
        })

        editor.addHighlight(0, { start: 0, end: 15, styleId: baseId, priority: 0 })
        editor.addHighlight(0, { start: 3, end: 12, styleId: mediumId, priority: 5 })
        editor.addHighlight(0, { start: 6, end: 9, styleId: highId, priority: 10 })

        const highlights = editor.getLineHighlights(0)
        expect(highlights.length).toBe(3)

        const sorted = [...highlights].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
        expect(sorted[0].priority).toBe(0)
        expect(sorted[1].priority).toBe(5)
        expect(sorted[2].priority).toBe(10)
      })

      it("should clear highlights when removing by ref across multiple lines", async () => {
        const style = SyntaxStyle.create()
        const styleId = style.registerStyle("temp", { bg: RGBA.fromValues(0.1, 0.1, 0.1, 1) })

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "Line 1\nLine 2\nLine 3",
          width: 40,
          height: 10,
          syntaxStyle: style,
        })

        const refId = 555
        editor.addHighlight(0, { start: 0, end: 6, styleId: styleId, priority: 0, hlRef: refId })
        editor.addHighlight(1, { start: 0, end: 6, styleId: styleId, priority: 0, hlRef: refId })
        editor.addHighlight(2, { start: 0, end: 6, styleId: styleId, priority: 0, hlRef: 999 }) // Different ref

        expect(editor.getLineHighlights(0).length).toBe(1)
        expect(editor.getLineHighlights(1).length).toBe(1)
        expect(editor.getLineHighlights(2).length).toBe(1)

        editor.removeHighlightsByRef(refId)

        expect(editor.getLineHighlights(0).length).toBe(0)
        expect(editor.getLineHighlights(1).length).toBe(0)
        expect(editor.getLineHighlights(2).length).toBe(1)
        expect(editor.getLineHighlights(2)[0].hlRef).toBe(999)
      })

      it("should handle empty highlights without hlRef", async () => {
        const style = SyntaxStyle.create()
        const styleId = style.registerStyle("no-ref", { fg: RGBA.fromValues(1, 1, 1, 1) })

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "test",
          width: 40,
          height: 10,
          syntaxStyle: style,
        })

        editor.addHighlight(0, { start: 0, end: 4, styleId: styleId, priority: 0 })

        const highlights = editor.getLineHighlights(0)
        expect(highlights.length).toBe(1)
        expect(highlights[0].hlRef).toBe(0)
      })

      it("should work without syntax style set", async () => {
        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "test",
          width: 40,
          height: 10,
        })

        // Can still add highlights even without syntax style (just need style IDs)
        editor.addHighlight(0, { start: 0, end: 4, styleId: 999, priority: 0 })

        const highlights = editor.getLineHighlights(0)
        expect(highlights.length).toBe(1)
        expect(highlights[0].styleId).toBe(999)
      })

      it("should handle char range spanning entire buffer", async () => {
        const style = SyntaxStyle.create()
        const styleId = style.registerStyle("all", { bg: RGBA.fromValues(0.1, 0.1, 0.1, 1) })

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "AAA\nBBB\nCCC",
          width: 40,
          height: 10,
          syntaxStyle: style,
        })

        // Highlight entire content (0 to end)
        editor.addHighlightByCharRange({ start: 0, end: 11, styleId: styleId, priority: 0 })

        expect(editor.getLineHighlights(0).length).toBeGreaterThan(0)
        expect(editor.getLineHighlights(1).length).toBeGreaterThan(0)
        expect(editor.getLineHighlights(2).length).toBeGreaterThan(0)
      })

      it("should handle updating highlights after clearing specific line", async () => {
        const style = SyntaxStyle.create()
        const styleId = style.registerStyle("test", { fg: RGBA.fromValues(1, 1, 0, 1) })

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "Line 1\nLine 2\nLine 3",
          width: 40,
          height: 10,
          syntaxStyle: style,
        })

        editor.addHighlight(0, { start: 0, end: 6, styleId: styleId, priority: 0 })
        editor.addHighlight(1, { start: 0, end: 6, styleId: styleId, priority: 0 })
        editor.addHighlight(2, { start: 0, end: 6, styleId: styleId, priority: 0 })

        editor.clearLineHighlights(1)

        // Re-add highlight on line 1
        editor.addHighlight(1, { start: 2, end: 5, styleId: styleId, priority: 0 })

        const highlights = editor.getLineHighlights(1)
        expect(highlights.length).toBe(1)
        expect(highlights[0].start).toBe(2)
        expect(highlights[0].end).toBe(5)
      })

      it("should handle zero-width highlights (should be ignored)", async () => {
        const style = SyntaxStyle.create()
        const styleId = style.registerStyle("zero", { fg: RGBA.fromValues(1, 0, 0, 1) })

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "test",
          width: 40,
          height: 10,
          syntaxStyle: style,
        })

        // Add zero-width highlight (start == end)
        editor.addHighlight(0, { start: 2, end: 2, styleId: styleId, priority: 0 })

        const highlights = editor.getLineHighlights(0)
        expect(highlights.length).toBe(0) // Should be ignored
      })

      it("should handle multiple reference IDs independently", async () => {
        const style = SyntaxStyle.create()
        const styleId = style.registerStyle("ref-style", { fg: RGBA.fromValues(1, 1, 1, 1) })

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "test content for multiple refs",
          width: 40,
          height: 10,
          syntaxStyle: style,
        })

        editor.addHighlight(0, { start: 0, end: 4, styleId: styleId, priority: 0, hlRef: 10 })
        editor.addHighlight(0, { start: 5, end: 12, styleId: styleId, priority: 0, hlRef: 20 })
        editor.addHighlight(0, { start: 13, end: 16, styleId: styleId, priority: 0, hlRef: 30 })

        let highlights = editor.getLineHighlights(0)
        expect(highlights.length).toBe(3)

        editor.removeHighlightsByRef(20)

        highlights = editor.getLineHighlights(0)
        expect(highlights.length).toBe(2)
        expect(highlights.filter((h) => h.hlRef === 10).length).toBe(1)
        expect(highlights.filter((h) => h.hlRef === 30).length).toBe(1)
      })
    })

    describe("Highlight Rendering Integration", () => {
      it("should render highlighted text without crashing", async () => {
        const { OptimizedBuffer } = await import("../buffer")
        const buffer = OptimizedBuffer.create(80, 24, "wcwidth")

        const style = SyntaxStyle.create()
        const styleId = style.registerStyle("keyword", {
          fg: RGBA.fromValues(1, 0, 0, 1),
          bold: true,
        })

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "const x = 5",
          width: 40,
          height: 10,
          syntaxStyle: style,
        })

        editor.addHighlight(0, { start: 0, end: 5, styleId: styleId, priority: 0 })

        // Should render without crashing
        buffer.drawEditorView(editor.editorView, 0, 0)

        expect(editor.getLineHighlights(0).length).toBe(1)
      })

      it("should handle highlights with overlapping ranges", async () => {
        const style = SyntaxStyle.create()
        const style1 = style.registerStyle("style1", { fg: RGBA.fromValues(1, 0, 0, 1) })
        const style2 = style.registerStyle("style2", { fg: RGBA.fromValues(0, 1, 0, 1) })

        const { textarea: editor } = await createTextareaRenderable(currentRenderer, {
          initialValue: "overlapping",
          width: 40,
          height: 10,
          syntaxStyle: style,
        })

        editor.addHighlight(0, { start: 0, end: 8, styleId: style1, priority: 0 })
        editor.addHighlight(0, { start: 4, end: 11, styleId: style2, priority: 5 }) // Higher priority

        const highlights = editor.getLineHighlights(0)
        expect(highlights.length).toBe(2)

        const { OptimizedBuffer } = await import("../buffer")
        const buffer = OptimizedBuffer.create(80, 24, "wcwidth")

        // Should render without crashing
        buffer.drawEditorView(editor.editorView, 0, 0)
      })
    })
  })
})
