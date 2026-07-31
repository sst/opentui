import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createTestRenderer, type TestRendererSetup } from "../testing/test-renderer.js"
import { KeyEvent } from "../lib/KeyHandler.js"
import { EmbeddedTerminalRenderable } from "./EmbeddedTerminal.js"

const libraryPath = process.env.OPENTUI_GHOSTTY_VT_LIBRARY
const describeRuntime = libraryPath ? describe : describe.skip

describeRuntime("EmbeddedTerminalRenderable", () => {
  let setup: TestRendererSetup

  beforeEach(async () => {
    setup = await createTestRenderer({ width: 30, height: 8 })
  })

  afterEach(() => setup.renderer.destroy())

  test("renders VT output and preserves it across clean frames", async () => {
    const terminal = new EmbeddedTerminalRenderable(setup.renderer, {
      width: 20,
      height: 4,
      libraryPath,
    })
    setup.renderer.root.add(terminal)
    terminal.write("hello \x1b[1;32mworld\x1b[0m\r\nwide: 界")

    await setup.renderOnce()
    const first = setup.captureCharFrame()
    expect(first).toContain("hello world")
    expect(first).toContain("wide: \u754c")

    await setup.renderOnce()
    expect(setup.captureCharFrame()).toBe(first)
  })

  test("encodes focused keys and paste for the child terminal", () => {
    const output: Uint8Array[] = []
    const terminal = new EmbeddedTerminalRenderable(setup.renderer, {
      width: 20,
      height: 4,
      libraryPath,
      onData: (data) => output.push(data),
    })
    setup.renderer.root.add(terminal)
    terminal.write("\x1b[?2004h")

    const enter = new KeyEvent({
      name: "enter",
      ctrl: false,
      meta: false,
      shift: false,
      option: false,
      sequence: "\r",
      raw: "\r",
      number: false,
      eventType: "press",
      source: "raw",
    })
    expect(new TextDecoder().decode(terminal.encodeKey(enter))).toBe("\r")
    expect(new TextDecoder().decode(terminal.encodePaste(new TextEncoder().encode("one\ntwo")))).toBe(
      "\x1b[200~one\ntwo\x1b[201~",
    )

    const emoji = new KeyEvent({
      name: "😀",
      ctrl: false,
      meta: false,
      shift: false,
      option: false,
      sequence: "😀",
      raw: "😀",
      number: false,
      eventType: "press",
      source: "raw",
    })
    expect(new TextDecoder().decode(terminal.encodeKey(emoji))).toBe("😀")

    const space = new KeyEvent({
      name: "space",
      ctrl: false,
      meta: false,
      shift: false,
      option: false,
      sequence: " ",
      raw: " ",
      number: false,
      eventType: "press",
      source: "raw",
    })
    expect(new TextDecoder().decode(terminal.encodeKey(space))).toBe(" ")

    const uppercase = new KeyEvent({
      name: "a",
      ctrl: false,
      meta: false,
      shift: true,
      option: false,
      sequence: "A",
      raw: "A",
      number: false,
      eventType: "press",
      source: "raw",
    })
    expect(new TextDecoder().decode(terminal.encodeKey(uppercase))).toBe("A")

    terminal.write("\x1b[>19u")
    const longText = "x".repeat(2048)
    const composition = new KeyEvent({
      name: longText,
      ctrl: false,
      meta: false,
      shift: false,
      option: false,
      sequence: longText,
      raw: longText,
      number: false,
      eventType: "press",
      source: "raw",
    })
    expect(new TextDecoder().decode(terminal.encodeKey(composition))).toBe(longText)
  })

  test("resizes and destroys its native state", async () => {
    const sizes: Array<[number, number]> = []
    const terminal = new EmbeddedTerminalRenderable(setup.renderer, {
      width: 10,
      height: 2,
      libraryPath,
      onTerminalResize: (cols, rows) => sizes.push([cols, rows]),
    })
    setup.renderer.root.add(terminal)
    terminal.write("abcdefghij")
    await setup.renderOnce()

    terminal.width = 5
    terminal.height = 3
    await setup.renderOnce()
    expect(terminal.width).toBe(5)
    expect(terminal.height).toBe(3)
    expect(sizes).toContainEqual([5, 3])

    terminal.destroy()
    terminal.destroy()
    expect(terminal.isDestroyed).toBe(true)
  })

  test("rejects dimensions that cannot cross the native ABI", () => {
    expect(
      () =>
        new EmbeddedTerminalRenderable(setup.renderer, {
          cols: 0,
          rows: 24,
          libraryPath,
        }),
    ).toThrow("columns must be an integer between 1 and 65535")
    expect(
      () =>
        new EmbeddedTerminalRenderable(setup.renderer, {
          cols: 80,
          rows: 24,
          maxScrollback: 0x1_0000_0000,
          libraryPath,
        }),
    ).toThrow("maxScrollback must be an integer between 0 and 4294967295")
  })

  test("cleans up focus state when the data callback throws", () => {
    const terminal = new EmbeddedTerminalRenderable(setup.renderer, {
      width: 20,
      height: 4,
      libraryPath,
      onData: () => {
        throw new Error("write failed")
      },
    })
    setup.renderer.root.add(terminal)
    terminal.write("\x1b[?1004h")

    expect(() => terminal.focus()).toThrow("write failed")
    expect(terminal.focused).toBe(false)

    terminal.onData = undefined
    terminal.focus()
    terminal.onData = () => {
      throw new Error("write failed")
    }
    terminal.destroy()
    expect(terminal.isDestroyed).toBe(true)
  })

  test("forwards Kitty key releases while focused", () => {
    const output: Uint8Array[] = []
    const terminal = new EmbeddedTerminalRenderable(setup.renderer, {
      width: 20,
      height: 4,
      libraryPath,
      onData: (data) => output.push(data),
    })
    setup.renderer.root.add(terminal)
    terminal.write("\x1b[>3u")
    terminal.focus()

    setup.renderer.keyInput.processParsedKey({
      name: "a",
      ctrl: false,
      meta: false,
      shift: false,
      option: false,
      sequence: "",
      raw: "",
      number: false,
      eventType: "release",
      source: "kitty",
      code: "KeyA",
    })

    expect(new TextDecoder().decode(output.at(-1))).toBe("\x1b[97;1:3u")
  })
})
