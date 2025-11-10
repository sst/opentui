import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer, type MockInput } from "../../testing/test-renderer"
import { createTextareaRenderable } from "./renderable-test-utils"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>
let currentMockInput: MockInput

describe("Textarea - Buffer Tests", () => {
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

  describe("getTextRange", () => {
    it("should get text range by display-width offsets", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello, World!\nThis is line 2.",
        width: 40,
        height: 10,
      })

      const range1 = editor.getTextRange(0, 5)
      expect(range1).toBe("Hello")

      const range2 = editor.getTextRange(7, 12)
      expect(range2).toBe("World")

      const range3 = editor.getTextRange(0, 13)
      expect(range3).toBe("Hello, World!")

      const range4 = editor.getTextRange(14, 21)
      expect(range4).toBe("This is")
    })

    it("should get text range by row/col coordinates", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello, World!\nThis is line 2.",
        width: 40,
        height: 10,
      })

      const range1 = editor.getTextRangeByCoords(0, 0, 0, 5)
      expect(range1).toBe("Hello")

      const range2 = editor.getTextRangeByCoords(0, 7, 0, 12)
      expect(range2).toBe("World")

      const range3 = editor.getTextRangeByCoords(1, 0, 1, 7)
      expect(range3).toBe("This is")

      const range4 = editor.getTextRangeByCoords(0, 0, 1, 7)
      expect(range4).toBe("Hello, World!\nThis is")
    })

    it("should handle empty ranges with getTextRangeByCoords", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello, World!",
        width: 40,
        height: 10,
      })

      const rangeEmpty = editor.getTextRangeByCoords(0, 5, 0, 5)
      expect(rangeEmpty).toBe("")

      const rangeInvalid = editor.getTextRangeByCoords(0, 10, 0, 5)
      expect(rangeInvalid).toBe("")
    })

    it("should handle ranges spanning multiple lines with getTextRangeByCoords", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
      })

      const range1 = editor.getTextRangeByCoords(0, 5, 1, 4)
      expect(range1).toBe("1\nLine")

      const range2 = editor.getTextRangeByCoords(0, 0, 2, 6)
      expect(range2).toBe("Line 1\nLine 2\nLine 3")

      const range3 = editor.getTextRangeByCoords(1, 0, 2, 6)
      expect(range3).toBe("Line 2\nLine 3")
    })

    it("should handle Unicode characters with getTextRangeByCoords", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello 🌟 World",
        width: 40,
        height: 10,
      })

      const range1 = editor.getTextRangeByCoords(0, 0, 0, 6)
      expect(range1).toBe("Hello ")

      const range2 = editor.getTextRangeByCoords(0, 6, 0, 8)
      expect(range2).toBe("🌟")

      const range3 = editor.getTextRangeByCoords(0, 8, 0, 14)
      expect(range3).toBe(" World")
    })

    it("should handle CJK characters with getTextRangeByCoords", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello 世界",
        width: 40,
        height: 10,
      })

      const range1 = editor.getTextRangeByCoords(0, 0, 0, 6)
      expect(range1).toBe("Hello ")

      const range2 = editor.getTextRangeByCoords(0, 6, 0, 10)
      expect(range2).toBe("世界")
    })

    it("should get text range by coords after editing operations", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "ABC\nDEF",
        width: 40,
        height: 10,
      })

      editor.focus()

      const range1 = editor.getTextRangeByCoords(0, 0, 1, 3)
      expect(range1).toBe("ABC\nDEF")

      editor.gotoLine(1)
      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("ABCDEF")

      const range2 = editor.getTextRangeByCoords(0, 1, 0, 5)
      expect(range2).toBe("BCDE")

      const range3 = editor.getTextRangeByCoords(0, 0, 0, 6)
      expect(range3).toBe("ABCDEF")
    })

    it("should handle out-of-bounds coordinates with getTextRangeByCoords", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Short",
        width: 40,
        height: 10,
      })

      const range1 = editor.getTextRangeByCoords(10, 0, 20, 0)
      expect(range1).toBe("")

      const range2 = editor.getTextRangeByCoords(0, 0, 0, 5)
      expect(range2).toBe("Short")

      const range3 = editor.getTextRangeByCoords(0, 100, 0, 200)
      expect(range3).toBe("")
    })

    it("should match offset-based and coords-based methods", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
      })

      const offsetBased = editor.getTextRange(0, 6)
      const coordsBased = editor.getTextRangeByCoords(0, 0, 0, 6)
      expect(coordsBased).toBe(offsetBased)
      expect(coordsBased).toBe("Line 1")

      const offsetBased2 = editor.getTextRange(7, 13)
      const coordsBased2 = editor.getTextRangeByCoords(1, 0, 1, 6)
      expect(coordsBased2).toBe(offsetBased2)
      expect(coordsBased2).toBe("Line 2")

      const offsetBased3 = editor.getTextRange(5, 12)
      const coordsBased3 = editor.getTextRangeByCoords(0, 5, 1, 5)
      expect(coordsBased3).toBe(offsetBased3)
      expect(coordsBased3).toBe("1\nLine ")
    })

    it("should handle empty ranges", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello, World!",
        width: 40,
        height: 10,
      })

      const rangeEmpty = editor.getTextRange(5, 5)
      expect(rangeEmpty).toBe("")

      const rangeInvalid = editor.getTextRange(10, 5)
      expect(rangeInvalid).toBe("")
    })

    it("should handle ranges spanning multiple lines", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Line 1\nLine 2\nLine 3",
        width: 40,
        height: 10,
      })

      const range1 = editor.getTextRange(0, 13)
      expect(range1).toBe("Line 1\nLine 2")

      const range2 = editor.getTextRange(5, 12)
      expect(range2).toBe("1\nLine ")
    })

    it("should handle Unicode characters in ranges", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello 🌟 World",
        width: 40,
        height: 10,
      })

      const range1 = editor.getTextRange(0, 6)
      expect(range1).toBe("Hello ")

      const range2 = editor.getTextRange(6, 8)
      expect(range2).toBe("🌟")

      const range3 = editor.getTextRange(8, 14)
      expect(range3).toBe(" World")
    })

    it("should handle CJK characters in ranges", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Hello 世界",
        width: 40,
        height: 10,
      })

      const range1 = editor.getTextRange(0, 6)
      expect(range1).toBe("Hello ")

      const range2 = editor.getTextRange(6, 10)
      expect(range2).toBe("世界")
    })

    it("should get text range after editing operations", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "ABC",
        width: 40,
        height: 10,
      })

      editor.focus()

      editor.gotoLine(9999)
      editor.insertText("DEF")
      expect(editor.plainText).toBe("ABCDEF")

      const range1 = editor.getTextRange(0, 6)
      expect(range1).toBe("ABCDEF")

      const range2 = editor.getTextRange(0, 3)
      expect(range2).toBe("ABC")

      const range3 = editor.getTextRange(3, 6)
      expect(range3).toBe("DEF")
    })

    it("should get text range across chunk boundaries after line joins", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "ABC\nDEF",
        width: 40,
        height: 10,
      })

      editor.focus()
      editor.gotoLine(1)

      currentMockInput.pressBackspace()
      expect(editor.plainText).toBe("ABCDEF")

      const range1 = editor.getTextRange(1, 5)
      expect(range1).toBe("BCDE")

      const range2 = editor.getTextRange(0, 6)
      expect(range2).toBe("ABCDEF")
    })

    it("should handle range at buffer boundaries", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Test",
        width: 40,
        height: 10,
      })

      const range1 = editor.getTextRange(0, 2)
      expect(range1).toBe("Te")

      const range2 = editor.getTextRange(2, 4)
      expect(range2).toBe("st")

      const range3 = editor.getTextRange(0, 4)
      expect(range3).toBe("Test")
    })

    it("should return empty string for out-of-bounds ranges", async () => {
      const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
        initialValue: "Short",
        width: 40,
        height: 10,
      })

      const range1 = editor.getTextRange(100, 200)
      expect(range1).toBe("")

      const range2 = editor.getTextRange(0, 1000)
      expect(range2).toBe("Short")
    })
  })
})
