import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer, type MockInput } from "../../testing/test-renderer"
import { createTextareaRenderable } from "./renderable-test-utils"
import { TextareaRenderableEvents } from "../Textarea"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>
let currentMockInput: MockInput

describe("Textarea - Input-like Functionality Tests", () => {
  beforeEach(async () => {
    ;({
      renderer: currentRenderer,
      renderOnce,
      mockInput: currentMockInput,
    } = await createTestRenderer({
      width: 80,
      height: 24,
    }))
  })

  afterEach(() => {
    currentRenderer.destroy()
  })

  describe("INPUT Event", () => {
    it("should emit INPUT event when text is typed", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        width: 40,
        height: 10,
      })

      let inputEventFired = false
      let inputValue = ""

      editor.on(TextareaRenderableEvents.INPUT, (value: string) => {
        inputEventFired = true
        inputValue = value
      })

      editor.focus()

      currentMockInput.pressKey("h")
      expect(inputEventFired).toBe(true)
      expect(inputValue).toBe("h")

      inputEventFired = false
      currentMockInput.pressKey("i")
      expect(inputEventFired).toBe(true)
      expect(inputValue).toBe("hi")
    })

    it("should emit INPUT event when text is inserted via insertText", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        width: 40,
        height: 10,
      })

      let inputEventFired = false
      let inputValue = ""

      editor.on(TextareaRenderableEvents.INPUT, (value: string) => {
        inputEventFired = true
        inputValue = value
      })

      editor.focus()
      editor.insertText("hello")

      expect(inputEventFired).toBe(true)
      expect(inputValue).toBe("hello")
    })

    it("should emit INPUT event when text is inserted via insertChar", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        width: 40,
        height: 10,
      })

      let inputEventFired = false
      let inputValue = ""

      editor.on(TextareaRenderableEvents.INPUT, (value: string) => {
        inputEventFired = true
        inputValue = value
      })

      editor.focus()
      editor.insertChar("x")

      expect(inputEventFired).toBe(true)
      expect(inputValue).toBe("x")
    })

    it("should emit INPUT event when text is deleted with backspace", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "hello",
        width: 40,
        height: 10,
      })

      let inputEventFired = false
      let inputValue = ""

      editor.on(TextareaRenderableEvents.INPUT, (value: string) => {
        inputEventFired = true
        inputValue = value
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end

      currentMockInput.pressBackspace()
      expect(inputEventFired).toBe(true)
      expect(inputValue).toBe("hell")
    })

    it("should emit INPUT event when text is deleted with delete key", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "hello",
        width: 40,
        height: 10,
      })

      let inputEventFired = false
      let inputValue = ""

      editor.on(TextareaRenderableEvents.INPUT, (value: string) => {
        inputEventFired = true
        inputValue = value
      })

      editor.focus()
      // Cursor at start

      currentMockInput.pressKey("DELETE")
      expect(inputEventFired).toBe(true)
      expect(inputValue).toBe("ello")
    })

    it("should emit INPUT event when line is deleted", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "line1\nline2\nline3",
        width: 40,
        height: 10,
      })

      let inputEventFired = false
      let inputValue = ""

      editor.on(TextareaRenderableEvents.INPUT, (value: string) => {
        inputEventFired = true
        inputValue = value
      })

      editor.focus()
      editor.gotoLine(1) // Move to line2

      editor.deleteLine()
      expect(inputEventFired).toBe(true)
      expect(inputValue).toBe("line1\nline3")
    })

    it("should emit INPUT event when newline is added", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "hello",
        width: 40,
        height: 10,
      })

      let inputEventFired = false
      let inputValue = ""

      editor.on(TextareaRenderableEvents.INPUT, (value: string) => {
        inputEventFired = true
        inputValue = value
      })

      editor.focus()
      editor.gotoLine(9999) // Move to end

      currentMockInput.pressEnter()
      expect(inputEventFired).toBe(true)
      expect(inputValue).toBe("hello\n")
    })

    it("should emit INPUT event when selection is deleted", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "hello world",
        width: 40,
        height: 10,
        selectable: true,
      })

      let inputEventFired = false
      let inputValue = ""

      editor.on(TextareaRenderableEvents.INPUT, (value: string) => {
        inputEventFired = true
        inputValue = value
      })

      editor.focus()

      // Select "hello"
      for (let i = 0; i < 5; i++) {
        currentMockInput.pressArrow("right", { shift: true })
      }
      expect(editor.getSelectedText()).toBe("hello")

      currentMockInput.pressKey("DELETE")
      expect(inputEventFired).toBe(true)
      expect(inputValue).toBe(" world")
    })

    it("should emit INPUT event for word deletion operations", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "hello world test",
        width: 40,
        height: 10,
      })

      let inputEventFired = false
      let inputValue = ""

      editor.on(TextareaRenderableEvents.INPUT, (value: string) => {
        inputEventFired = true
        inputValue = value
      })

      editor.focus()

      // Delete first word
      currentMockInput.pressKey("d", { ctrl: true })
      expect(inputEventFired).toBe(true)
      expect(inputValue).toBe(" world test")

      // Delete word backward
      inputEventFired = false
      editor.gotoLine(9999) // Move to end
      currentMockInput.pressKey("w", { ctrl: true })
      expect(inputEventFired).toBe(true)
      expect(inputValue).toBe(" world ")
    })

    it("should emit INPUT event for line deletion operations", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "hello world",
        width: 40,
        height: 10,
      })

      let inputEventFired = false
      let inputValue = ""

      editor.on(TextareaRenderableEvents.INPUT, (value: string) => {
        inputEventFired = true
        inputValue = value
      })

      editor.focus()
      editor.moveCursorRight()
      editor.moveCursorRight()

      // Delete to end of line
      currentMockInput.pressKey("k", { ctrl: true })
      expect(inputEventFired).toBe(true)
      expect(inputValue).toBe("he")

      // Delete to start of line
      inputEventFired = false
      currentMockInput.pressKey("u", { ctrl: true })
      expect(inputEventFired).toBe(true)
      expect(inputValue).toBe("")
    })
  })

  describe("CHANGE Event", () => {
    it("should emit CHANGE event on blur if text was modified", async () => {
      const { textarea: editor1 } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "initial",
        width: 40,
        height: 10,
      })

      const { textarea: editor2 } = await createTextareaRenderable(currentRenderer, renderOnce, {
        width: 40,
        height: 10,
      })

      let changeEventFired = false
      let changeValue = ""

      editor1.on(TextareaRenderableEvents.CHANGE, (value: string) => {
        changeEventFired = true
        changeValue = value
      })

      editor1.focus()
      currentMockInput.pressKey("x")
      expect(editor1.plainText).toBe("xinitial")

      // Change event should not fire during focus
      expect(changeEventFired).toBe(false)

      // Switch focus to trigger blur
      editor2.focus()

      // Change event should fire on blur
      expect(changeEventFired).toBe(true)
      expect(changeValue).toBe("xinitial")
    })

    it("should not emit CHANGE event on blur if text was not modified", async () => {
      const { textarea: editor1 } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "unchanged",
        width: 40,
        height: 10,
      })

      const { textarea: editor2 } = await createTextareaRenderable(currentRenderer, renderOnce, {
        width: 40,
        height: 10,
      })

      let changeEventFired = false

      editor1.on(TextareaRenderableEvents.CHANGE, () => {
        changeEventFired = true
      })

      editor1.focus()
      // Don't modify text

      // Switch focus to trigger blur
      editor2.focus()

      expect(changeEventFired).toBe(false)
    })

    it("should emit CHANGE event when text changes and then focus is lost", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "",
        width: 40,
        height: 10,
      })

      let changeEventFired = false
      let changeValue = ""

      editor.on(TextareaRenderableEvents.CHANGE, (value: string) => {
        changeEventFired = true
        changeValue = value
      })

      editor.focus()
      currentMockInput.pressKey("h")
      currentMockInput.pressKey("e")
      currentMockInput.pressKey("l")
      currentMockInput.pressKey("l")
      currentMockInput.pressKey("o")

      expect(editor.plainText).toBe("hello")
      expect(changeEventFired).toBe(false) // Not fired yet

      editor.blur()

      expect(changeEventFired).toBe(true)
      expect(changeValue).toBe("hello")
    })

    it("should track change state correctly across multiple focus/blur cycles", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "start",
        width: 40,
        height: 10,
      })

      let changeEvents: string[] = []

      editor.on(TextareaRenderableEvents.CHANGE, (value: string) => {
        changeEvents.push(value)
      })

      // First focus/edit/blur cycle
      editor.focus()
      currentMockInput.pressKey("1")
      editor.blur()
      expect(changeEvents).toEqual(["start1"])

      // Second focus/edit/blur cycle
      changeEvents.length = 0
      editor.focus()
      currentMockInput.pressKey("2")
      editor.blur()
      expect(changeEvents).toEqual(["start12"])

      // Third focus without edit/blur cycle
      changeEvents.length = 0
      editor.focus()
      editor.blur()
      expect(changeEvents).toEqual([]) // No change event
    })
  })

  describe("maxLength Property", () => {
    it("should prevent typing beyond maxLength", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        maxLength: 5,
        width: 40,
        height: 10,
      })

      editor.focus()

      currentMockInput.pressKey("1")
      currentMockInput.pressKey("2")
      currentMockInput.pressKey("3")
      currentMockInput.pressKey("4")
      currentMockInput.pressKey("5")
      expect(editor.plainText).toBe("12345")

      // This should be ignored
      currentMockInput.pressKey("6")
      expect(editor.plainText).toBe("12345")
    })

    it("should prevent insertText beyond maxLength", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        maxLength: 5,
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.insertText("hello")
      expect(editor.plainText).toBe("hello")

      editor.insertText("world")
      expect(editor.plainText).toBe("hello") // Should remain unchanged
    })

    it("should truncate insertText to maxLength", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        maxLength: 8,
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.insertText("hello")
      expect(editor.plainText).toBe("hello")

      editor.insertText("world")
      expect(editor.plainText).toBe("hellowor") // Should be truncated
    })

    it("should prevent insertChar beyond maxLength", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        maxLength: 3,
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.insertChar("a")
      editor.insertChar("b")
      editor.insertChar("c")
      expect(editor.plainText).toBe("abc")

      editor.insertChar("d")
      expect(editor.plainText).toBe("abc") // Should remain unchanged
    })

    it("should prevent newlines beyond maxLength", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        maxLength: 5,
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.insertText("hello")
      expect(editor.plainText).toBe("hello")

      currentMockInput.pressEnter()
      expect(editor.plainText).toBe("hello") // Newline should be prevented
    })

    it("should allow deletion when at maxLength", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        maxLength: 5,
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.insertText("hello")
      expect(editor.plainText).toBe("hello")

      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("hell")

      // Should now allow typing again
      currentMockInput.pressKey("p")
      expect(editor.plainText).toBe("hellp")
    })

    it("should truncate existing text when maxLength is set lower", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "hello world",
        width: 40,
        height: 10,
      })

      let inputEventFired = false
      editor.on(TextareaRenderableEvents.INPUT, () => {
        inputEventFired = true
      })

      expect(editor.plainText).toBe("hello world")

      editor.maxLength = 5
      expect(editor.plainText).toBe("hello")
      expect(inputEventFired).toBe(true) // Should emit INPUT event
    })

    it("should work with getter/setter", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        width: 40,
        height: 10,
      })

      expect(editor.maxLength).toBeUndefined()

      editor.maxLength = 10
      expect(editor.maxLength).toBe(10)

      editor.focus()
      editor.insertText("1234567890")
      expect(editor.plainText).toBe("1234567890")

      editor.insertText("x")
      expect(editor.plainText).toBe("1234567890") // Should be at limit

      editor.maxLength = undefined
      editor.insertText("y")
      expect(editor.plainText).toBe("1234567890y") // Should now allow
    })

    it("should work with multi-line text", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        maxLength: 10,
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.insertText("line1\nlin")
      expect(editor.plainText).toBe("line1\nlin")

      currentMockInput.pressKey("e")
      expect(editor.plainText).toBe("line1\nline") // 10 chars including newline

      currentMockInput.pressKey("x")
      expect(editor.plainText).toBe("line1\nline") // Should be prevented
    })
  })

  describe("Modifier Key Handling", () => {
    it("should not insert text for keys with modifier keys", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        width: 40,
        height: 10,
      })

      editor.focus()

      // Test various modifier key combinations
      currentMockInput.pressKey("a", { ctrl: true })
      expect(editor.plainText).toBe("") // Should use buffer-home action, not insert

      currentMockInput.pressKey("b", { meta: true })
      expect(editor.plainText).toBe("") // Should use move-backward action, not insert

      // Normal key without modifiers should work
      currentMockInput.pressKey("h")
      expect(editor.plainText).toBe("h")

      // Shift alone should work for uppercase letters
      currentMockInput.pressKey("i", { shift: true })
      expect(editor.plainText).toBe("hI")
    })

    it("should properly execute actions for modifier keys instead of inserting text", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "hello world",
        width: 40,
        height: 10,
      })

      editor.focus()

      // Ctrl+A should go to buffer start, not insert "a"
      currentMockInput.pressKey("a", { ctrl: true })
      expect(editor.logicalCursor.row).toBe(0)
      expect(editor.logicalCursor.col).toBe(0)
      expect(editor.plainText).toBe("hello world") // Text unchanged

      // Ctrl+E should go to buffer end, not insert "e"
      currentMockInput.pressKey("e", { ctrl: true })
      expect(editor.logicalCursor.col).toBe(11) // End of line
      expect(editor.plainText).toBe("hello world") // Text unchanged
    })
  })

  describe("Combined INPUT and CHANGE Events", () => {
    it("should emit both INPUT and CHANGE events appropriately", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "start",
        width: 40,
        height: 10,
      })

      let inputEvents: string[] = []
      let changeEvents: string[] = []

      editor.on(TextareaRenderableEvents.INPUT, (value: string) => {
        inputEvents.push(value)
      })

      editor.on(TextareaRenderableEvents.CHANGE, (value: string) => {
        changeEvents.push(value)
      })

      editor.focus()

      currentMockInput.pressKey("1")
      expect(inputEvents).toEqual(["start1"])
      expect(changeEvents).toEqual([]) // No change event yet

      currentMockInput.pressKey("2")
      expect(inputEvents).toEqual(["start1", "start12"])
      expect(changeEvents).toEqual([]) // No change event yet

      editor.blur()
      expect(inputEvents).toEqual(["start1", "start12"]) // No new input events
      expect(changeEvents).toEqual(["start12"]) // Change event fired
    })

    it("should handle maxLength with both events", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        maxLength: 6,
        width: 40,
        height: 10,
      })

      let inputEvents: string[] = []
      let changeEvents: string[] = []

      editor.on(TextareaRenderableEvents.INPUT, (value: string) => {
        inputEvents.push(value)
      })

      editor.on(TextareaRenderableEvents.CHANGE, (value: string) => {
        changeEvents.push(value)
      })

      editor.focus()

      editor.insertText("hello!")
      expect(inputEvents).toEqual(["hello!"])

      // Try to insert more - should be prevented and not emit INPUT
      editor.insertText("world")
      expect(inputEvents).toEqual(["hello!"]) // No new event

      editor.blur()
      expect(changeEvents).toEqual(["hello!"])
    })
  })
})
