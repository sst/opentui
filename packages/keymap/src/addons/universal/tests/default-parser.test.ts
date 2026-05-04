import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { terminalNamedSingleStrokeKeys, type KeyEvent, type Renderable } from "@opentui/core"
import { createTestRenderer, type MockInput, type TestRenderer } from "@opentui/core/testing"
import { Keymap } from "@opentui/keymap"
import { registerDefaultKeys } from "@opentui/keymap/addons"
import { createOpenTuiKeymapHost } from "@opentui/keymap/opentui"
import { createDiagnosticHarness } from "../../../tests/diagnostic-harness.js"

let renderer: TestRenderer
let mockInput: MockInput
const diagnostics = createDiagnosticHarness()

describe("default parser addon", () => {
  beforeEach(async () => {
    const testSetup = await createTestRenderer({ width: 40, height: 12 })
    renderer = testSetup.renderer
    mockInput = testSetup.mockInput
  })

  afterEach(() => {
    renderer.destroy()
    diagnostics.assertNoUnhandledDiagnostics()
  })

  test("bare keymaps do not parse string bindings until the addon is registered", () => {
    const keymap = diagnostics.trackKeymap(new Keymap<Renderable, KeyEvent>(createOpenTuiKeymapHost(renderer)))
    const { takeErrors } = diagnostics.captureDiagnostics(keymap)

    keymap.registerLayer({
      commands: [{ name: "run", run() {} }],
      bindings: [{ key: "x", cmd: "run" }],
    })

    expect(takeErrors().errors).toEqual(["No keymap binding parsers are registered"])
    expect(keymap.getActiveKeys()).toEqual([])
  })

  test("registerDefaultKeys restores the standard parser and event matching", () => {
    const keymap = diagnostics.trackKeymap(new Keymap<Renderable, KeyEvent>(createOpenTuiKeymapHost(renderer)))
    const { takeWarnings } = diagnostics.captureDiagnostics(keymap)
    const calls: string[] = []

    registerDefaultKeys(keymap)

    keymap.registerLayer({
      commands: [
        {
          name: "run",
          run() {
            calls.push("run")
          },
        },
      ],
      bindings: [{ key: "<leader>d", cmd: "run" }],
    })
    keymap.registerToken({ name: "leader", key: { name: "x", ctrl: true } })

    mockInput.pressKey("x", { ctrl: true })
    mockInput.pressKey("d")

    expect(takeWarnings().warnings).toEqual([
      '[Keymap] Unknown token "leader" in key sequence "<leader>d" was ignored',
    ])
    expect(calls).toEqual(["run"])
  })

  test('registerDefaultKeys keeps the " " to "space" mapping in the addon, not the engine', () => {
    const keymap = diagnostics.trackKeymap(new Keymap<Renderable, KeyEvent>(createOpenTuiKeymapHost(renderer)))
    const calls: string[] = []

    registerDefaultKeys(keymap)

    keymap.registerLayer({
      commands: [
        {
          name: "space",
          run() {
            calls.push("space")
          },
        },
      ],
      bindings: [{ key: " ", cmd: "space" }],
    })

    mockInput.pressKey(" ")

    expect(calls).toEqual(["space"])
  })

  test("registerDefaultKeys parses every named single-stroke key emitted by terminal hosts", () => {
    const keymap = diagnostics.trackKeymap(new Keymap<Renderable, KeyEvent>(createOpenTuiKeymapHost(renderer)))

    registerDefaultKeys(keymap)

    keymap.registerLayer({
      commands: [{ name: "run", run() {} }],
      bindings: terminalNamedSingleStrokeKeys.map((key) => ({ key, cmd: "run" })),
    })

    const activeKeyNames = new Set(keymap.getActiveKeys().map((candidate) => candidate.stroke.name))

    for (const key of terminalNamedSingleStrokeKeys) {
      expect(activeKeyNames.has(key)).toBe(true)
    }
  })
})
