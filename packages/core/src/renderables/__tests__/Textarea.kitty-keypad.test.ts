import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer, type MockInput } from "../../testing/test-renderer.js"
import { createTextareaRenderable } from "./renderable-test-utils.js"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>
let currentMockInput: MockInput

describe("Textarea - Kitty keypad input (#1041)", () => {
  beforeEach(async () => {
    ;({
      renderer: currentRenderer,
      renderOnce,
      mockInput: currentMockInput,
    } = await createTestRenderer({
      width: 80,
      height: 24,
      kittyKeyboard: true,
    }))
  })

  afterEach(() => {
    currentRenderer.destroy()
  })

  const emitKitty = async (codepoint: number): Promise<void> => {
    currentRenderer.stdin.emit("data", Buffer.from(`\x1b[${codepoint}u`))
    await renderOnce()
  }

  it.each([
    [57399, "kp0", "0"],
    [57400, "kp1", "1"],
    [57401, "kp2", "2"],
    [57402, "kp3", "3"],
    [57403, "kp4", "4"],
    [57404, "kp5", "5"],
    [57405, "kp6", "6"],
    [57406, "kp7", "7"],
    [57407, "kp8", "8"],
    [57408, "kp9", "9"],
  ])("inserts digit when %s arrives as %s", async (codepoint, _name, expected) => {
    const { textarea } = await createTextareaRenderable(currentRenderer, renderOnce, { width: 40, height: 4 })
    textarea.focus()

    await emitKitty(codepoint as number)

    expect(textarea.plainText).toBe(expected as string)
  })

  it.each([
    [57409, "kpdecimal", "."],
    [57410, "kpdivide", "/"],
    [57411, "kpmultiply", "*"],
    [57412, "kpminus", "-"],
    [57413, "kpplus", "+"],
    [57415, "kpequal", "="],
    [57416, "kpseparator", ","],
  ])("inserts operator/symbol when %s arrives as %s", async (codepoint, _name, expected) => {
    const { textarea } = await createTextareaRenderable(currentRenderer, renderOnce, { width: 40, height: 4 })
    textarea.focus()

    await emitKitty(codepoint as number)

    expect(textarea.plainText).toBe(expected as string)
  })

  it("treats kpenter as a newline within the textarea", async () => {
    const { textarea } = await createTextareaRenderable(currentRenderer, renderOnce, { width: 40, height: 4 })
    textarea.focus()

    currentMockInput.pressKey("a")
    await renderOnce()
    await emitKitty(57414) // kpenter
    currentMockInput.pressKey("b")
    await renderOnce()

    expect(textarea.plainText).toBe("a\nb")
  })

  it("composes a multi-digit decimal across the full numpad", async () => {
    const { textarea } = await createTextareaRenderable(currentRenderer, renderOnce, { width: 40, height: 4 })
    textarea.focus()

    // "3.14" via numpad
    await emitKitty(57402) // kp3
    await emitKitty(57409) // kpdecimal
    await emitKitty(57400) // kp1
    await emitKitty(57403) // kp4

    expect(textarea.plainText).toBe("3.14")
  })
})
