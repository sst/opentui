import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { BoxRenderable } from "@opentui/core"
import { createTestRenderer, type MockInput, type TestRenderer } from "@opentui/core/testing"
import { registerExCommands } from "@opentui/keymap/addons"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createDiagnosticHarness } from "../../../tests/diagnostic-harness.js"

let renderer: TestRenderer
let mockInput: MockInput
const diagnostics = createDiagnosticHarness()

function getKeymap(renderer: TestRenderer) {
  return diagnostics.trackKeymap(createDefaultOpenTuiKeymap(renderer))
}

function createFocusableBox(id: string): BoxRenderable {
  return new BoxRenderable(renderer, {
    id,
    width: 10,
    height: 4,
    focusable: true,
  })
}

describe("ex commands addon", () => {
  beforeEach(async () => {
    const testSetup = await createTestRenderer({ width: 40, height: 10 })
    renderer = testSetup.renderer
    mockInput = testSetup.mockInput
  })

  afterEach(() => {
    renderer?.destroy()
    diagnostics.assertNoUnhandledDiagnostics()
  })

  test("supports aliases and nargs validation", () => {
    const keymap = getKeymap(renderer)
    const calls: string[] = []

    keymap.registerLayer({
      commands: [
        {
          name: "fallback",
          run() {
            calls.push("fallback")
          },
        },
      ],
    })

    registerExCommands(keymap, [
      {
        name: "write",
        aliases: ["w"],
        nargs: "1",
        run({ payload }) {
          calls.push(`write:${payload.args.join(",")}`)
        },
      },
    ])

    const target = createFocusableBox("ex-target")
    renderer.root.add(target)

    keymap.registerLayer({
      bindings: [
        { key: "x", cmd: "fallback" },
        { key: "y", cmd: ":w file.txt" },
      ],
    })

    keymap.registerLayer({
      target,
      bindings: [{ key: "x", cmd: ":write" }],
    })

    target.focus()
    mockInput.pressKey("x")
    mockInput.pressKey("y")

    expect(calls).toEqual(["fallback", "write:file.txt"])
  })

  test("supports colon-prefixed names and each nargs mode", () => {
    const keymap = getKeymap(renderer)
    const calls: string[] = []
    let passthroughCount = 0

    registerExCommands(keymap, [
      {
        name: ":quit",
        nargs: "0",
        run() {
          calls.push("quit")
        },
      },
      {
        name: "maybe",
        nargs: "?",
        run({ payload }) {
          calls.push(`maybe:${payload.args.join(",")}`)
        },
      },
      {
        name: "many",
        nargs: "*",
        run({ payload }) {
          calls.push(`many:${payload.args.join(",")}`)
        },
      },
      {
        name: "plus",
        nargs: "+",
        run({ payload }) {
          calls.push(`plus:${payload.args.join(",")}`)
        },
      },
      {
        name: "free",
        run({ payload }) {
          calls.push(`free:${payload.args.join(",")}`)
        },
      },
    ])

    const target = createFocusableBox("nargs-target")
    target.onKeyDown = () => {
      passthroughCount += 1
    }
    renderer.root.add(target)

    keymap.registerLayer({
      target,
      bindings: [
        { key: "a", cmd: ":quit" },
        { key: "b", cmd: ":quit now" },
        { key: "c", cmd: ":maybe" },
        { key: "d", cmd: ":maybe one" },
        { key: "e", cmd: ":maybe one two" },
        { key: "f", cmd: ":many" },
        { key: "g", cmd: ":many one two" },
        { key: "h", cmd: ":plus" },
        { key: "i", cmd: ":plus one" },
        { key: "j", cmd: ":free one two" },
      ],
    })

    target.focus()

    mockInput.pressKey("a")
    mockInput.pressKey("b")
    mockInput.pressKey("c")
    mockInput.pressKey("d")
    mockInput.pressKey("e")
    mockInput.pressKey("f")
    mockInput.pressKey("g")
    mockInput.pressKey("h")
    mockInput.pressKey("i")
    mockInput.pressKey("j")

    expect(calls).toEqual(["quit", "maybe:", "maybe:one", "many:", "many:one,two", "plus:one", "free:one,two"])
    expect(passthroughCount).toBe(3)
  })

  test("forwards extra command fields into registered ex commands", () => {
    const keymap = getKeymap(renderer)

    registerExCommands(keymap, [
      {
        name: "write",
        aliases: ["w"],
        nargs: "1",
        desc: "Write the current buffer",
        title: "Write Buffer",
        category: "File",
        run() {},
      },
    ])

    keymap.registerLayer({
      bindings: [{ key: "x", cmd: ":w file.txt" }],
    })

    expect(
      keymap.getActiveKeys({ includeMetadata: true }).find((candidate) => candidate.stroke.name === "x")?.commandAttrs,
    ).toEqual({
      desc: "Write the current buffer",
      title: "Write Buffer",
      category: "File",
    })

    expect(keymap.getCommands({ filter: { namespace: "excommands" } })).toMatchObject([
      {
        name: ":write",
        aliases: ["w"],
        nargs: "1",
        desc: "Write the current buffer",
        title: "Write Buffer",
        category: "File",
        namespace: "excommands",
      },
      {
        name: ":w",
        aliases: ["w"],
        nargs: "1",
        desc: "Write the current buffer",
        title: "Write Buffer",
        category: "File",
        namespace: "excommands",
      },
    ])
  })

  test("can be disposed to remove ex-command resolution", () => {
    const keymap = getKeymap(renderer)
    const calls: string[] = []

    keymap.registerLayer({
      commands: [
        {
          name: "fallback",
          run() {
            calls.push("fallback")
          },
        },
      ],
    })

    keymap.registerLayer({
      bindings: [{ key: "x", cmd: "fallback" }],
    })

    const offExCommands = registerExCommands(keymap, [
      {
        name: "write",
        aliases: ["w"],
        run({ payload }) {
          calls.push(`write:${payload.args.join(",")}`)
        },
      },
    ])

    keymap.registerLayer({
      bindings: [{ key: "x", cmd: ":w file.txt" }],
    })

    mockInput.pressKey("x")
    expect(calls).toEqual(["write:file.txt"])

    offExCommands()

    mockInput.pressKey("x")
    expect(calls).toEqual(["write:file.txt", "fallback"])
  })

  test("runCommand resolves ex commands programmatically", () => {
    const keymap = getKeymap(renderer)
    const calls: string[] = []

    registerExCommands(keymap, [
      {
        name: "write",
        aliases: ["w"],
        nargs: "1",
        usage: ":write <file>",
        run({ payload }) {
          calls.push(`${payload.raw}:${payload.args.join(",")}`)
        },
      },
      {
        name: "free",
        run({ payload }) {
          calls.push(`${payload.raw}:${payload.args.join(",")}:${payload.payload ?? ""}`)
        },
      },
    ])

    expect(keymap.runCommand(":w file.txt")).toEqual({
      ok: true,
    })
    expect(keymap.runCommand(":w file.txt", { includeCommand: true })).toMatchObject({
      ok: true,
      command: {
        name: ":w",
        aliases: ["w"],
        nargs: "1",
        usage: ":write <file>",
        namespace: "excommands",
      },
    })
    expect(keymap.runCommand(":w")).toEqual({
      ok: false,
      reason: "invalid-args",
    })
    expect(keymap.runCommand(":w", { includeCommand: true })).toMatchObject({
      ok: false,
      reason: "invalid-args",
      command: {
        name: ":w",
        aliases: ["w"],
        nargs: "1",
        usage: ":write <file>",
        namespace: "excommands",
      },
    })
    expect(keymap.runCommand(":free one", { payload: "explicit" })).toEqual({ ok: true })
    expect(keymap.runCommand(":missing")).toEqual({ ok: false, reason: "not-found" })
    expect(calls).toEqual([":w file.txt:file.txt", ":w file.txt:file.txt", ":free one:one:explicit"])
  })
})
