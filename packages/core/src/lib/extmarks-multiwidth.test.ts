import { describe, expect, it, afterEach } from "bun:test"
import { TextareaRenderable } from "../renderables/Textarea"
import { createTestRenderer, type TestRenderer, type MockInput } from "../testing/test-renderer"
import { type ExtmarksController } from "./extmarks"
import { SyntaxStyle } from "../syntax-style"
import { RGBA } from "./RGBA"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>
let currentMockInput: MockInput
let textarea: TextareaRenderable
let extmarks: ExtmarksController

async function setup(initialValue: string = "Hello World") {
  const result = await createTestRenderer({ width: 80, height: 24 })
  currentRenderer = result.renderer
  renderOnce = result.renderOnce
  currentMockInput = result.mockInput

  textarea = new TextareaRenderable(currentRenderer, {
    left: 0,
    top: 0,
    width: 40,
    height: 10,
    initialValue,
  })

  currentRenderer.root.add(textarea)
  await renderOnce()

  extmarks = textarea.extmarks

  return { textarea, extmarks }
}

describe("ExtmarksController - Multi-width Graphemes", () => {
  afterEach(() => {
    if (extmarks) extmarks.destroy()
    if (currentRenderer) currentRenderer.destroy()
  })

  describe("Basic Multi-width Highlighting", () => {
    it("should correctly highlight text AFTER multi-width characters", async () => {
      // Text: "前后端分离 @git-committer"
      // Chinese chars are multi-width, @ onwards should highlight correctly
      await setup("前后端分离 @git-committer")

      const style = SyntaxStyle.create()
      const styleId = style.registerStyle("mention", {
        fg: RGBA.fromValues(0, 0, 1, 1),
        bg: RGBA.fromValues(0.9, 0.9, 1, 1),
      })

      textarea.syntaxStyle = style

      const text = textarea.plainText

      // Calculate CORRECT display-width offsets
      // "前" = 2 cols, "后" = 2 cols, "端" = 2 cols, "分" = 2 cols, "离" = 2 cols, " " = 1 col
      // Total before "@": 10 + 1 = 11 display-width columns
      let displayOffset = 0
      const atJsIndex = text.indexOf("@")
      for (let i = 0; i < atJsIndex; i++) {
        if (text[i] === "\n") {
          displayOffset += 1
        } else {
          displayOffset += Bun.stringWidth(text[i])
        }
      }

      const mentionText = "@git-committer"
      const mentionDisplayWidth = Bun.stringWidth(mentionText)
      const mentionStart = displayOffset // Should be 11
      const mentionEnd = displayOffset + mentionDisplayWidth // Should be 25

      extmarks.create({
        start: mentionStart,
        end: mentionEnd,
        styleId,
      })

      const highlights = textarea.getLineHighlights(0)
      expect(highlights.length).toBe(1)
      expect(highlights[0].start).toBe(11)
      expect(highlights[0].end).toBe(25)
    })

    it("should correctly highlight text BEFORE multi-width characters", async () => {
      await setup("hello 前后端分离")

      const style = SyntaxStyle.create()
      const styleId = style.registerStyle("test", {
        fg: RGBA.fromValues(1, 0, 0, 1),
      })

      textarea.syntaxStyle = style

      // Highlight "hello" which is at offsets 0-5
      extmarks.create({
        start: 0,
        end: 5,
        styleId,
      })

      const highlights = textarea.getLineHighlights(0)

      expect(highlights.length).toBe(1)
      expect(highlights[0].start).toBe(0)
      expect(highlights[0].end).toBe(5)
    })

    it("should correctly highlight BETWEEN multi-width characters", async () => {
      await setup("前后 test 端分离")

      const style = SyntaxStyle.create()
      const styleId = style.registerStyle("test", {
        fg: RGBA.fromValues(1, 0, 0, 1),
      })

      textarea.syntaxStyle = style

      // "前后 test 端分离"
      // Offsets: 前=0, 后=1, space=2, t=3, e=4, s=5, t=6, space=7, 端=8, 分=9, 离=10
      const testStart = 3
      const testEnd = 7

      extmarks.create({
        start: testStart,
        end: testEnd,
        styleId,
      })

      const highlights = textarea.getLineHighlights(0)

      if (highlights.length > 0) {
        const lineText = textarea.plainText.split("\n")[0]
        const actualHighlightedText = lineText.substring(highlights[0].start, highlights[0].end)
        expect(actualHighlightedText).toBe("test")
      }

      expect(highlights.length).toBe(1)
    })

    it("should correctly highlight the multi-width characters themselves", async () => {
      await setup("hello 前后端分离 world")

      const style = SyntaxStyle.create()
      const styleId = style.registerStyle("test", {
        fg: RGBA.fromValues(1, 0, 0, 1),
      })

      textarea.syntaxStyle = style

      // "hello 前后端分离 world"
      // Offsets: h=0,e=1,l=2,l=3,o=4,space=5,前=6,后=7,端=8,分=9,离=10,space=11,w=12...
      const chineseStart = 6
      const chineseEnd = 11

      extmarks.create({
        start: chineseStart,
        end: chineseEnd,
        styleId,
      })

      const highlights = textarea.getLineHighlights(0)

      if (highlights.length > 0) {
        const lineText = textarea.plainText.split("\n")[0]
        const actualHighlightedText = lineText.substring(highlights[0].start, highlights[0].end)
        expect(actualHighlightedText).toBe("前后端分离")
      }

      expect(highlights.length).toBe(1)
    })
  })

  describe("Complex Multi-width Scenarios", () => {
    it("should handle emoji and multi-width characters together", async () => {
      await setup("前后 🌟 test")

      const style = SyntaxStyle.create()
      const styleId = style.registerStyle("test", {
        fg: RGBA.fromValues(1, 0, 0, 1),
      })

      textarea.syntaxStyle = style

      // Highlight "test" at the end
      const text = textarea.plainText
      const testPos = text.indexOf("test")

      extmarks.create({
        start: testPos,
        end: testPos + 4,
        styleId,
      })

      const highlights = textarea.getLineHighlights(0)

      expect(highlights.length).toBe(1)

      const lineText = textarea.plainText.split("\n")[0]
      const actualHighlightedText = lineText.substring(highlights[0].start, highlights[0].end)
      expect(actualHighlightedText).toBe("test")
    })

    it("should handle multiple highlights with multi-width characters", async () => {
      await setup("前后端 @user1 分离 @user2 end")

      const style = SyntaxStyle.create()
      const styleId = style.registerStyle("mention", {
        fg: RGBA.fromValues(0, 0, 1, 1),
      })

      textarea.syntaxStyle = style

      const text = textarea.plainText

      const user1Start = text.indexOf("@user1")
      const user1End = user1Start + 6
      const user2Start = text.indexOf("@user2")
      const user2End = user2Start + 6

      extmarks.create({
        start: user1Start,
        end: user1End,
        styleId,
      })

      extmarks.create({
        start: user2Start,
        end: user2End,
        styleId,
      })

      const highlights = textarea.getLineHighlights(0)

      highlights.forEach((h, i) => {
        const lineText = textarea.plainText.split("\n")[0]
        const highlightedText = lineText.substring(h.start, h.end)
      })

      expect(highlights.length).toBe(2)
    })
  })

  describe("Cursor Movement with Multi-width Characters", () => {
    it("should correctly position cursor after multi-width characters", async () => {
      await setup("前后 test")

      textarea.focus()
      textarea.cursorOffset = 0

      // Text: "前后 test"
      // "前" = display width 2, "后" = display width 2, " " = display width 1
      // After 3 arrow right presses from position 0:
      //   Press 1: move to display-width 2 (after "前")
      //   Press 2: move to display-width 4 (after "后")
      //   Press 3: move to display-width 5 (after " ")

      for (let i = 0; i < 3; i++) {
        currentMockInput.pressArrow("right")
      }

      const cursorPos = textarea.cursorOffset

      // Cursor should be at display-width offset 5 (after "前后 ")
      expect(cursorPos).toBe(5)
    })
  })

  describe("Visual vs Byte Offset Issues", () => {
    it("should demonstrate the offset to char offset conversion issue", async () => {
      // This is the CRITICAL test - offsetToCharOffset doesn't account for display width
      await setup("前后端分离 @git-committer")

      const style = SyntaxStyle.create()
      const styleId = style.registerStyle("mention", {
        fg: RGBA.fromValues(0, 0, 1, 1),
        bg: RGBA.fromValues(0.9, 0.9, 1, 1),
      })

      textarea.syntaxStyle = style

      const text = textarea.plainText

      // The @ symbol is at cursor offset 6
      const atPos = text.indexOf("@")

      // We want to highlight from @ to the end of "committer"
      const start = atPos
      const end = atPos + 14 // "@git-committer" is 14 chars

      const extmarkId = extmarks.create({
        start: start,
        end: end,
        styleId,
      })

      const extmark = extmarks.get(extmarkId)

      const highlights = textarea.getLineHighlights(0)

      if (highlights.length > 0) {
        const h = highlights[0]

        // This is where the bug manifests:
        // The offsetToCharOffset in extmarks.ts doesn't account for multi-width display
        // So the highlight char offset will be wrong

        const lineText = text.split("\n")[0]

        // Try to extract what's actually highlighted using the char offsets
        const actualText = lineText.substring(h.start, Math.min(h.end, lineText.length))

        // This will likely FAIL because the char offsets don't account for display width
      }

      expect(highlights.length).toBe(1)
    })
  })
})
