import { describe, expect, it, afterEach } from "bun:test"

import { TextareaRenderable } from "../renderables/Textarea.js"
import { createTestRenderer, type TestRenderer, type MockInput } from "../testing/test-renderer.js"
import { type ExtmarksController } from "./extmarks.js"
import { SyntaxStyle } from "../syntax-style.js"
import { stringWidth } from "../platform/runtime.js"
import { RGBA } from "./RGBA.js"

function utf16IndexToDisplayOffset(text: string, index: number): number {
  const lines = text.slice(0, index).split("\n")
  return lines.reduce((offset, line) => offset + stringWidth(line), 0) + lines.length - 1
}

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

      const displayOffset = utf16IndexToDisplayOffset(text, text.indexOf("@"))

      const mentionText = "@git-committer"
      const mentionDisplayWidth = stringWidth(mentionText)
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

      const text = textarea.plainText
      const testIndex = text.indexOf("test")
      const testStart = utf16IndexToDisplayOffset(text, testIndex)
      const testEnd = utf16IndexToDisplayOffset(text, testIndex + "test".length)

      extmarks.create({
        start: testStart,
        end: testEnd,
        styleId,
      })

      const highlights = textarea.getLineHighlights(0)

      expect(highlights).toHaveLength(1)
      expect(highlights[0]).toMatchObject({ start: testStart, end: testEnd })
    })

    it("should correctly highlight the multi-width characters themselves", async () => {
      await setup("hello 前后端分离 world")

      const style = SyntaxStyle.create()
      const styleId = style.registerStyle("test", {
        fg: RGBA.fromValues(1, 0, 0, 1),
      })

      textarea.syntaxStyle = style

      const text = textarea.plainText
      const chineseIndex = text.indexOf("前")
      const chineseStart = utf16IndexToDisplayOffset(text, chineseIndex)
      const chineseEnd = utf16IndexToDisplayOffset(text, chineseIndex + "前后端分离".length)

      extmarks.create({
        start: chineseStart,
        end: chineseEnd,
        styleId,
      })

      const highlights = textarea.getLineHighlights(0)

      expect(highlights).toHaveLength(1)
      expect(highlights[0]).toMatchObject({ start: chineseStart, end: chineseEnd })
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
      const testIndex = text.indexOf("test")
      const testStart = utf16IndexToDisplayOffset(text, testIndex)
      const testEnd = utf16IndexToDisplayOffset(text, testIndex + "test".length)

      extmarks.create({
        start: testStart,
        end: testEnd,
        styleId,
      })

      const highlights = textarea.getLineHighlights(0)

      expect(highlights.length).toBe(1)

      expect(highlights[0]).toMatchObject({ start: testStart, end: testEnd })
    })

    it("should handle multiple highlights with multi-width characters", async () => {
      await setup("前后端 @user1 分离 @user2 end")

      const style = SyntaxStyle.create()
      const styleId = style.registerStyle("mention", {
        fg: RGBA.fromValues(0, 0, 1, 1),
      })

      textarea.syntaxStyle = style

      const text = textarea.plainText

      const user1Index = text.indexOf("@user1")
      const user2Index = text.indexOf("@user2")
      const user1Start = utf16IndexToDisplayOffset(text, user1Index)
      const user1End = utf16IndexToDisplayOffset(text, user1Index + 6)
      const user2Start = utf16IndexToDisplayOffset(text, user2Index)
      const user2End = utf16IndexToDisplayOffset(text, user2Index + 6)

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

  describe("UTF-16 Caller Conversion", () => {
    it("should convert regex UTF-16 indexes before creating an extmark", async () => {
      await setup("前后端分离 @git-committer")

      const style = SyntaxStyle.create()
      const styleId = style.registerStyle("mention", {
        fg: RGBA.fromValues(0, 0, 1, 1),
        bg: RGBA.fromValues(0.9, 0.9, 1, 1),
      })

      textarea.syntaxStyle = style

      const text = textarea.plainText

      const atIndex = text.indexOf("@")
      const start = utf16IndexToDisplayOffset(text, atIndex)
      const end = utf16IndexToDisplayOffset(text, atIndex + 14)

      const extmarkId = extmarks.create({
        start: start,
        end: end,
        styleId,
      })

      const highlights = textarea.getLineHighlights(0)
      expect(extmarks.get(extmarkId)).toMatchObject({ start: 11, end: 25 })
      expect(highlights).toEqual([{ start: 11, end: 25, styleId, priority: 0, hlRef: extmarkId }])
    })
  })
})
