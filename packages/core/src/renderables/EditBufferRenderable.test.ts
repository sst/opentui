import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { BoxRenderable } from "./Box.js"
import { isEditBufferRenderable } from "./EditBufferRenderable.js"
import { InputRenderable } from "./Input.js"
import { TextareaRenderable } from "./Textarea.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"

describe("EditBufferRenderable", () => {
  let renderer: TestRenderer
  let renderOnce: () => Promise<void>

  beforeEach(async () => {
    ;({ renderer, renderOnce } = await createTestRenderer({ width: 40, height: 20 }))
  })

  afterEach(() => {
    renderer.destroy()
  })

  test("brands textarea and input instances", async () => {
    const textarea = new TextareaRenderable(renderer, { width: 20, height: 3 })
    const input = new InputRenderable(renderer, { width: 20 })

    renderer.root.add(textarea)
    renderer.root.add(input)
    await renderOnce()

    expect(isEditBufferRenderable(textarea)).toBe(true)
    expect(isEditBufferRenderable(input)).toBe(true)
  })

  test("does not brand non-editor renderables", async () => {
    const box = new BoxRenderable(renderer, { width: 10, height: 2 })

    renderer.root.add(box)
    await renderOnce()

    expect(isEditBufferRenderable(box)).toBe(false)
    expect(isEditBufferRenderable(null)).toBe(false)
    expect(isEditBufferRenderable(undefined)).toBe(false)
  })

  test("supports currentFocusedRenderable narrowing for editor access", async () => {
    const textarea = new TextareaRenderable(renderer, {
      width: 20,
      height: 3,
      initialValue: "hello",
    })

    renderer.root.add(textarea)
    await renderOnce()

    textarea.focus()

    const current = renderer.currentFocusedRenderable
    expect(isEditBufferRenderable(current)).toBe(true)
    if (!isEditBufferRenderable(current)) throw new Error("expected focused editor")

    expect(current.plainText).toBe("hello")
    current.cursorOffset = 2
    expect(current.visualCursor.offset).toBe(2)
  })

  test("stores generic editor traits per instance", async () => {
    const textarea = new TextareaRenderable(renderer, { width: 20, height: 3 })
    const input = new InputRenderable(renderer, { width: 20, value: "name" })

    renderer.root.add(textarea)
    renderer.root.add(input)
    await renderOnce()

    expect(textarea.traits).toEqual({})
    expect(input.traits).toEqual({})

    textarea.traits = {
      capture: ["escape", "navigate"],
      suspend: true,
      status: "PALETTE",
    }

    expect(textarea.traits).toEqual({
      capture: ["escape", "navigate"],
      suspend: true,
      status: "PALETTE",
    })
    expect(input.traits).toEqual({})

    input.traits.status = "FILTER"

    expect(textarea.traits.status).toBe("PALETTE")
    expect(input.traits.status).toBe("FILTER")
  })
})
