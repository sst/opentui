import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createTestRenderer, type TestRendererSetup } from "../testing/test-renderer.js"
import { KeyEvent } from "../lib/KeyHandler.js"
import { RGBA } from "../lib/RGBA.js"
import { resolveRenderLib } from "../zig.js"
import { EmbeddedTerminalRenderable } from "./EmbeddedTerminal.js"

class MissingFramebufferTerminal extends EmbeddedTerminalRenderable {
  protected createFrameBuffer(): void {
    this.frameBuffer = null
  }
}

describe("EmbeddedTerminalRenderable", () => {
  let setup: TestRendererSetup

  beforeEach(async () => {
    setup = await createTestRenderer({ width: 30, height: 8 })
  })

  afterEach(() => setup.renderer.destroy())

  test("creates native state from the statically linked runtime", () => {
    const lib = resolveRenderLib()
    const handle = lib.createEmbeddedTerminal({ cols: 10, rows: 2 })
    expect(handle).toBeTruthy()
    lib.destroyEmbeddedTerminal(handle)
  })

  test("does not compose into the parent buffer when framebuffer allocation fails", async () => {
    const terminal = new MissingFramebufferTerminal(setup.renderer, { width: 20, height: 4 })
    setup.renderer.root.add(terminal)
    terminal.write("must not reach the parent")
    await setup.renderOnce()
    expect(setup.captureCharFrame()).not.toContain("must not reach the parent")
  })

  test("renders VT output and preserves it across clean frames", async () => {
    const terminal = new EmbeddedTerminalRenderable(setup.renderer, { width: 20, height: 4 })
    setup.renderer.root.add(terminal)
    terminal.write("hello \x1b[1;32mworld\x1b[0m\r\nwide: 界")

    await setup.renderOnce()
    const first = setup.captureCharFrame()
    expect(first).toContain("hello world")
    expect(first).toContain("wide: 界")

    await setup.renderOnce()
    expect(setup.captureCharFrame()).toBe(first)
  })

  test("preserves mouse callbacks and their renderable context", async () => {
    let mouseDowns = 0
    let callbackThis: EmbeddedTerminalRenderable | undefined
    const terminal = new EmbeddedTerminalRenderable(setup.renderer, {
      width: 20,
      height: 4,
      onMouseDown: function () {
        mouseDowns++
        callbackThis = this
      },
    })
    setup.renderer.root.add(terminal)
    await setup.renderOnce()

    await setup.mockMouse.pressDown(1, 1)

    expect(mouseDowns).toBe(1)
    expect(callbackThis).toBe(terminal)
  })

  test("participates in renderer selection and returns terminal text", async () => {
    const terminal = new EmbeddedTerminalRenderable(setup.renderer, { width: 20, height: 4 })
    setup.renderer.root.add(terminal)
    terminal.write("hello\r\nwide: 界")
    await setup.renderOnce()

    setup.renderer.startSelection(terminal, terminal.x + 1, terminal.y)
    setup.renderer.updateSelection(terminal, terminal.x + 3, terminal.y, { finishDragging: true })

    expect(terminal.hasSelection()).toBe(true)
    expect(terminal.getSelectedText()).toBe("ell")
    expect(setup.renderer.getSelection()?.getSelectedText()).toBe("ell")

    setup.renderer.clearSelection()
    expect(terminal.hasSelection()).toBe(false)
    expect(terminal.getSelectedText()).toBe("")
  })

  test("encodes keys and bracketed paste", () => {
    const terminal = new EmbeddedTerminalRenderable(setup.renderer, { width: 20, height: 4 })
    setup.renderer.root.add(terminal)
    terminal.write("\x1b[?2004h")

    expect(new TextDecoder().decode(terminal.encodeKey(keyEvent({ name: "enter", sequence: "\r" })))).toBe("\r")
    expect(new TextDecoder().decode(terminal.encodePaste(new TextEncoder().encode("one\ntwo")))).toBe(
      "\x1b[200~one\ntwo\x1b[201~",
    )
    expect(new TextDecoder().decode(terminal.encodeKey(keyEvent({ name: "😀", sequence: "😀" })))).toBe("😀")
    expect(new TextDecoder().decode(terminal.encodeKey(keyEvent({ name: "space", sequence: " " })))).toBe(" ")
    expect(
      new TextDecoder().decode(terminal.encodeKey(keyEvent({ name: "a", sequence: "A", shift: true, raw: "A" }))),
    ).toBe("A")

    terminal.write("\x1b[>19u")
    const longText = "x".repeat(2048)
    expect(new TextDecoder().decode(terminal.encodeKey(keyEvent({ name: longText, sequence: longText })))).toBe(
      longText,
    )
  })

  test("distinguishes user input from terminal responses", () => {
    const output: Array<{ data: string; source?: "input" | "response" }> = []
    const terminal = new EmbeddedTerminalRenderable(setup.renderer, {
      width: 20,
      height: 4,
      onData: (data, source) => output.push({ data: new TextDecoder().decode(data), source }),
    })
    setup.renderer.root.add(terminal)

    terminal.write("\x1b[5n")
    terminal.handleKeyPress(keyEvent({ name: "enter", sequence: "\r" }))

    expect(output).toEqual([
      { data: "\x1b[0n", source: "response" },
      { data: "\r", source: "input" },
    ])
  })

  test("encodes no-button motion and suppresses unavailable pixel coordinates", () => {
    const lib = resolveRenderLib()
    const handle = lib.createEmbeddedTerminal({ cols: 20, rows: 4 })
    try {
      lib.embeddedTerminalWrite(handle, "\x1b[?1003h\x1b[?1006h")
      const motion = lib.embeddedTerminalEncodeMouse(handle, {
        action: "motion",
        x: 1,
        y: 1,
      })
      expect(new TextDecoder().decode(motion)).toBe("\x1b[<35;2;2M")

      lib.embeddedTerminalWrite(handle, "\x1b[?1016h")
      expect(
        lib.embeddedTerminalEncodeMouse(handle, {
          action: "motion",
          x: 1,
          y: 1,
        }),
      ).toHaveLength(0)
    } finally {
      lib.destroyEmbeddedTerminal(handle)
    }
  })

  test("encodes Meta as Super rather than Alt", () => {
    const terminal = new EmbeddedTerminalRenderable(setup.renderer, { width: 20, height: 4 })
    setup.renderer.root.add(terminal)
    terminal.write("\x1b[>3u")

    const encoded = terminal.encodeKey(
      keyEvent({
        name: "a",
        sequence: "a",
        code: "KeyA",
        baseCode: "a".codePointAt(0),
        meta: true,
      }),
    )
    expect(new TextDecoder().decode(encoded)).toBe("\x1b[97;9u")
  })

  test("drains the preserved response prefix after overflow", () => {
    const lib = resolveRenderLib()
    const handle = lib.createEmbeddedTerminal({ cols: 20, rows: 4 })
    try {
      const query = "\x1b[5n"
      lib.embeddedTerminalWrite(handle, query.repeat((1024 * 1024) / query.length + 1))
      const responses = lib.embeddedTerminalDrainResponses(handle)
      expect(responses.byteLength).toBe(1024 * 1024)
      expect(new TextDecoder().decode(responses.subarray(0, 4))).toBe("\x1b[0n")
    } finally {
      lib.destroyEmbeddedTerminal(handle)
    }
  })

  test("resizes and destroys native state idempotently", async () => {
    const sizes: Array<[number, number]> = []
    const terminal = new EmbeddedTerminalRenderable(setup.renderer, {
      width: 10,
      height: 2,
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
    expect(sizes.some(([cols, rows]) => cols === 5 && rows === 3)).toBe(true)

    terminal.destroy()
    terminal.destroy()
    expect(terminal.isDestroyed).toBe(true)
  })

  test("rejects dimensions that cannot cross the native ABI", () => {
    expect(() => new EmbeddedTerminalRenderable(setup.renderer, { cols: 0, rows: 24 })).toThrow(
      "columns must be an integer between 1 and 65535",
    )
    expect(
      () => new EmbeddedTerminalRenderable(setup.renderer, { cols: 80, rows: 24, maxScrollback: 0x1_0000_0000 }),
    ).toThrow("Embedded terminal maxScrollback exceeds native u32 length limit")
  })

  test("cleans up focus and native state when the data callback throws", () => {
    const terminal = new EmbeddedTerminalRenderable(setup.renderer, {
      width: 20,
      height: 4,
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

  test("restores terminal cells after render hooks change", async () => {
    const terminal = new EmbeddedTerminalRenderable(setup.renderer, {
      width: 20,
      height: 4,
      renderAfter: (buffer) => {
        buffer.setCell(0, 0, "X", RGBA.fromInts(255, 255, 255, 255), RGBA.fromInts(0, 0, 0, 255))
      },
    })
    setup.renderer.root.add(terminal)
    terminal.write("A")
    await setup.renderOnce()
    expect(setup.captureCharFrame().startsWith("X")).toBe(true)

    terminal.renderAfter = undefined
    terminal.requestRender()
    await setup.renderOnce()
    expect(setup.captureCharFrame().startsWith("A")).toBe(true)
  })

  test("forwards Kitty key releases while focused", () => {
    const output: Uint8Array[] = []
    const terminal = new EmbeddedTerminalRenderable(setup.renderer, {
      width: 20,
      height: 4,
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

function keyEvent(
  options: Pick<ConstructorParameters<typeof KeyEvent>[0], "name" | "sequence"> &
    Partial<ConstructorParameters<typeof KeyEvent>[0]>,
): KeyEvent {
  return new KeyEvent({
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    raw: options.sequence,
    number: false,
    eventType: "press",
    source: "raw",
    ...options,
  })
}
