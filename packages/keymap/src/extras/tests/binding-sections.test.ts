import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createTestRenderer, type MockInput, type TestRenderer } from "@opentui/core/testing"
import { resolveBindingSections } from "../index.js"
import { createDefaultOpenTuiKeymap } from "../../opentui.js"
import { createDiagnosticHarness } from "../../tests/diagnostic-harness.js"

let renderer: TestRenderer
let mockInput: MockInput
const diagnostics = createDiagnosticHarness()

function getKeymap(renderer: TestRenderer) {
  return diagnostics.trackKeymap(createDefaultOpenTuiKeymap(renderer))
}

describe("resolveBindingSections helper", () => {
  beforeEach(async () => {
    const testSetup = await createTestRenderer({ width: 40, height: 10 })
    renderer = testSetup.renderer
    mockInput = testSetup.mockInput
  })

  afterEach(() => {
    renderer?.destroy()
    diagnostics.assertNoUnhandledDiagnostics()
  })

  test("resolves sectioned command config into binding arrays", () => {
    const leaderQuit = "<leader>q"
    const saveKey = { name: "s", ctrl: true }

    const resolved = resolveBindingSections({
      app: {
        " command.palette.show ": "ctrl+p",
        "app.exit": ["ctrl+c", "ctrl+d", leaderQuit],
        "file.save": saveKey,
      },
      prompt_input: {
        "prompt.paste": {
          key: "ctrl+v",
          preventDefault: false,
          fallthrough: true,
          event: "press",
          desc: "Paste",
        },
      },
    })

    expect(resolved.sections.app).toEqual([
      { key: "ctrl+p", cmd: "command.palette.show" },
      { key: "ctrl+c", cmd: "app.exit" },
      { key: "ctrl+d", cmd: "app.exit" },
      { key: "<leader>q", cmd: "app.exit" },
      { key: { name: "s", ctrl: true }, cmd: "file.save" },
    ])
    expect(resolved.sections.prompt_input).toEqual([
      {
        key: "ctrl+v",
        cmd: "prompt.paste",
        preventDefault: false,
        fallthrough: true,
        event: "press",
        desc: "Paste",
      },
    ])
    expect(resolved.get("app", " command.palette.show ")).toEqual([{ key: "ctrl+p", cmd: "command.palette.show" }])
    expect(resolved.get("app", "app.missing")).toBeUndefined()
    expect(resolved.get("missing", "app.exit")).toBeUndefined()
    expect(resolved.get("app", "file.save")?.[0]?.key).not.toBe(saveKey)
  })

  test("uses section command keys as the binding command identity", () => {
    const resolved = resolveBindingSections({
      app: {
        "app.exit": {
          key: "q",
          cmd: "ignored.command",
          preventDefault: false,
        },
      },
    })

    expect(resolved.sections.app).toEqual([{ key: "q", cmd: "app.exit", preventDefault: false }])
    expect(resolved.get("app", "ignored.command")).toBeUndefined()
  })

  test("lets false disable a command and lets later normalized entries replace earlier ones", () => {
    const resolved = resolveBindingSections({
      app: {
        " save ": "x",
        save: false,
        "open ": "o",
        open: ["p", { key: "shift+p", preventDefault: false }],
        empty: [],
      },
    })

    expect(resolved.sections.app).toEqual([
      { key: "p", cmd: "open" },
      { key: "shift+p", cmd: "open", preventDefault: false },
    ])
    expect(resolved.get("app", "save")).toBeUndefined()
    expect(resolved.get("app", "open")).toEqual([
      { key: "p", cmd: "open" },
      { key: "shift+p", cmd: "open", preventDefault: false },
    ])
    expect(resolved.get("app", "empty")).toEqual([])
  })

  test("throws for invalid sections and binding values", () => {
    expect(() => resolveBindingSections({ app: false } as never)).toThrow(
      'Invalid binding section "app": expected an object',
    )
    expect(() => resolveBindingSections({ app: { save: true } } as never)).toThrow(
      'Invalid binding value for "app.save": expected false, a key, a binding object, or an array of keys/binding objects',
    )
    expect(() => resolveBindingSections({ app: { save: ["x", true] } } as never)).toThrow(
      'Invalid binding value for "app.save" at index 1: expected false, a key, a binding object, or an array of keys/binding objects',
    )
    expect(() => resolveBindingSections({ app: { save: { key: true } } } as never)).toThrow(
      'Invalid binding value for "app.save": expected false, a key, a binding object, or an array of keys/binding objects',
    )
  })

  test("supports registering resolved section bindings", () => {
    const keymap = getKeymap(renderer)
    const calls: string[] = []

    keymap.registerLayer({
      commands: [
        {
          name: "app.exit",
          run() {
            calls.push("exit")
          },
        },
        {
          name: "prompt.paste",
          run() {
            calls.push("paste")
          },
        },
      ],
    })

    const resolved = resolveBindingSections({
      app: {
        "app.exit": ["q", "ctrl+c"],
      },
      prompt_input: {
        "prompt.paste": {
          key: "p",
          preventDefault: false,
        },
      },
    })

    keymap.registerLayer({ bindings: resolved.sections.app })
    keymap.registerLayer({ bindings: resolved.sections.prompt_input })

    mockInput.pressKey("q")
    mockInput.pressKey("p")

    expect(calls).toEqual(["exit", "paste"])
  })
})
