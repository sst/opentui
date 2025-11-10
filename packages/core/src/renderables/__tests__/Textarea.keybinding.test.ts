import { describe, expect, it, afterAll, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer, type MockMouse, type MockInput } from "../../testing/test-renderer"
import { createTextareaRenderable } from "./renderable-test-utils"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>
let currentMouse: MockMouse
let currentMockInput: MockInput

describe("Textarea - Keybinding Tests", () => {
  beforeEach(async () => {
    ;({
      renderer: currentRenderer,
      renderOnce,
      mockMouse: currentMouse,
      mockInput: currentMockInput,
    } = await createTestRenderer({
      width: 80,
      height: 24,
    }))
  })

  afterEach(() => {
    currentRenderer.destroy()
  })

  describe("Keyboard Input - Meta Key Bindings", () => {
    it("should bind custom action to meta key", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Test",
        width: 40,
        height: 10,
        keyBindings: [{ name: "b", meta: true, action: "buffer-home" }],
      })

      editor.focus()
      editor.gotoLine(9999)

      currentMockInput.pressKey("b", { meta: true })

      const cursor = editor.logicalCursor
      expect(cursor.row).toBe(0)
      expect(cursor.col).toBe(0)
    })

    it("should bind meta key actions", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Test",
        width: 40,
        height: 10,
        keyBindings: [{ name: "f", meta: true, action: "buffer-end" }],
      })

      editor.focus()

      currentMockInput.pressKey("f", { meta: true })

      const cursor = editor.logicalCursor
      expect(cursor.row).toBe(0)
    })

    it("should work with meta key for navigation", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Line 1\nLine 2",
        width: 40,
        height: 10,
        keyBindings: [{ name: "j", meta: true, action: "move-down" }],
      })

      editor.focus()
      expect(editor.logicalCursor.row).toBe(0)

      currentMockInput.pressKey("j", { meta: true })
      expect(editor.logicalCursor.row).toBe(1)
    })

    it("should allow meta key binding override", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
        keyBindings: [{ name: "k", meta: true, action: "move-up" }],
      })

      editor.focus()
      editor.gotoLine(2)
      expect(editor.logicalCursor.row).toBe(2)

      currentMockInput.pressKey("k", { meta: true })
      expect(editor.logicalCursor.row).toBe(1)
    })

    it("should work with Meta+Arrow keys", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
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
      expect(editor.logicalCursor.col).toBe(2)

      currentMockInput.pressArrow("left", { meta: true })
      expect(editor.logicalCursor.col).toBe(0)

      currentMockInput.pressArrow("right", { meta: true })
      expect(editor.logicalCursor.col).toBe(3)
    })

    it("should support meta with shift modifier", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello World",
        width: 40,
        height: 10,
        keyBindings: [{ name: "H", meta: true, shift: true, action: "line-home" }],
      })

      editor.focus()
      editor.gotoLine(9999)
      expect(editor.logicalCursor.col).toBe(11)

      currentMockInput.pressKey("h", { meta: true, shift: true })

      expect(editor.logicalCursor.col).toBe(0)
    })

    it("should not trigger action without meta when meta binding exists", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Test",
        width: 40,
        height: 10,
        keyBindings: [{ name: "x", meta: true, action: "delete-line" }],
      })

      editor.focus()

      currentMockInput.pressKey("x")
      expect(editor.plainText).toBe("xTest")

      currentMockInput.pressKey("x", { meta: true })
      expect(editor.plainText).toBe("")
    })

    it("should update keyBindings dynamically with setter", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Test",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(9999)

      currentMockInput.pressKey("b", { meta: true })
      expect(editor.logicalCursor.row).toBe(0)
      expect(editor.logicalCursor.col).toBe(0)

      editor.keyBindings = [{ name: "b", meta: true, action: "buffer-end" }]

      editor.gotoLine(0)
      expect(editor.logicalCursor.row).toBe(0)

      currentMockInput.pressKey("b", { meta: true })
      expect(editor.logicalCursor.row).toBe(0)
    })

    it("should merge new keyBindings with defaults", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Line 1\nLine 2",
        width: 40,
        height: 10,
      })

      editor.focus()

      currentMockInput.pressArrow("right")
      expect(editor.logicalCursor.col).toBe(1)

      editor.keyBindings = [{ name: "x", meta: true, action: "delete-line" }]

      currentMockInput.pressArrow("right")
      expect(editor.logicalCursor.col).toBe(2)

      currentMockInput.pressKey("x", { meta: true })
      expect(editor.plainText).toBe("Line 2")
    })

    it("should override default keyBindings with new bindings", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "hello world",
        width: 40,
        height: 10,
      })

      editor.focus()

      currentMockInput.pressKey("f", { meta: true })
      expect(editor.logicalCursor.col).toBe(6)

      editor.keyBindings = [{ name: "f", meta: true, action: "buffer-end" }]

      editor.gotoLine(0)
      currentMockInput.pressKey("f", { meta: true })
      expect(editor.logicalCursor.row).toBe(0)
    })

    it("should override return/enter keys to swap newline and submit actions", async () => {
      let submitCalled = false
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Line 1",
        width: 40,
        height: 10,
        onSubmit: () => {
          submitCalled = true
        },
      })

      editor.focus()
      editor.gotoLine(9999)

      currentMockInput.pressEnter()
      expect(editor.plainText).toBe("Line 1\n")
      expect(submitCalled).toBe(false)

      currentMockInput.pressEnter({ meta: true })
      expect(submitCalled).toBe(true)
      submitCalled = false

      editor.keyBindings = [
        { name: "return", meta: true, action: "newline" },
        { name: "linefeed", meta: true, action: "newline" },
        { name: "return", action: "submit" },
        { name: "linefeed", action: "submit" },
      ]

      currentMockInput.pressEnter()
      expect(submitCalled).toBe(true)
      submitCalled = false

      currentMockInput.pressEnter({ meta: true })
      expect(editor.plainText).toBe("Line 1\n\n")
      expect(submitCalled).toBe(false)
    })
  })
})
