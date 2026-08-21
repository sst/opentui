import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer, type MockInput } from "../../testing/test-renderer.js"
import { createTextareaRenderable } from "./renderable-test-utils.js"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>
let currentMockInput: MockInput

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe("Textarea - Smart Punctuation (double-space period)", () => {
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

  it("is disabled by default: two spaces stay two spaces", async () => {
    const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
      initialValue: "hi",
      width: 40,
      height: 10,
    })
    editor.focus()
    editor.gotoBufferEnd()

    currentMockInput.pressKey(" ")
    currentMockInput.pressKey(" ")
    await settle()

    expect(editor.plainText).toBe("hi  ")
  })

  it("converts double space after a letter to '. ' when enabled", async () => {
    const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
      initialValue: "hi",
      width: 40,
      height: 10,
      smartPunctuation: true,
    })
    editor.focus()
    editor.gotoBufferEnd()

    currentMockInput.pressKey(" ")
    currentMockInput.pressKey(" ")
    await settle()

    expect(editor.plainText).toBe("hi. ")
  })

  it("converts double space after a digit", async () => {
    const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
      initialValue: "v2",
      width: 40,
      height: 10,
      smartPunctuation: true,
    })
    editor.focus()
    editor.gotoBufferEnd()

    currentMockInput.pressKey(" ")
    currentMockInput.pressKey(" ")
    await settle()

    expect(editor.plainText).toBe("v2. ")
  })

  it("does not convert at line start (no preceding word char)", async () => {
    const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
      initialValue: "",
      width: 40,
      height: 10,
      smartPunctuation: true,
    })
    editor.focus()

    currentMockInput.pressKey(" ")
    currentMockInput.pressKey(" ")
    await settle()

    expect(editor.plainText).toBe("  ")
  })

  it("does not convert after punctuation", async () => {
    const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
      initialValue: "hi.",
      width: 40,
      height: 10,
      smartPunctuation: true,
    })
    editor.focus()
    editor.gotoBufferEnd()

    currentMockInput.pressKey(" ")
    currentMockInput.pressKey(" ")
    await settle()

    expect(editor.plainText).toBe("hi.  ")
  })

  it("does not stack into '.. ' on a third space", async () => {
    const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
      initialValue: "hi",
      width: 40,
      height: 10,
      smartPunctuation: true,
    })
    editor.focus()
    editor.gotoBufferEnd()

    currentMockInput.pressKey(" ")
    currentMockInput.pressKey(" ")
    currentMockInput.pressKey(" ")
    await settle()

    expect(editor.plainText).toBe("hi.  ")
  })

  it("reverts to two spaces when backspace is pressed immediately after", async () => {
    const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
      initialValue: "hi",
      width: 40,
      height: 10,
      smartPunctuation: true,
    })
    editor.focus()
    editor.gotoBufferEnd()

    currentMockInput.pressKey(" ")
    currentMockInput.pressKey(" ")
    await settle()
    expect(editor.plainText).toBe("hi. ")

    currentMockInput.pressBackspace()
    await settle()

    expect(editor.plainText).toBe("hi  ")
  })

  it("can be toggled at runtime via the smartPunctuation setter", async () => {
    const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
      initialValue: "hi",
      width: 40,
      height: 10,
    })
    editor.focus()
    editor.gotoBufferEnd()
    editor.smartPunctuation = true

    currentMockInput.pressKey(" ")
    currentMockInput.pressKey(" ")
    await settle()

    expect(editor.plainText).toBe("hi. ")
  })
})
