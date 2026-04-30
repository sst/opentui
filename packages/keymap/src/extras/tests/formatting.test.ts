import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createTestRenderer, type TestRenderer } from "@opentui/core/testing"
import { formatCommandBindings, formatKeySequence } from "../index.js"
import { createDefaultOpenTuiKeymap } from "../../opentui.js"
import { createDiagnosticHarness } from "../../tests/diagnostic-harness.js"

let renderer: TestRenderer
const diagnostics = createDiagnosticHarness()

function getKeymap(renderer: TestRenderer) {
  return diagnostics.trackKeymap(createDefaultOpenTuiKeymap(renderer))
}

describe("formatting helpers", () => {
  beforeEach(async () => {
    const testSetup = await createTestRenderer({ width: 40, height: 10 })
    renderer = testSetup.renderer
  })

  afterEach(() => {
    renderer?.destroy()
    diagnostics.assertNoUnhandledDiagnostics()
  })

  test("formats canonical key sequences by default", () => {
    const keymap = getKeymap(renderer)

    expect(formatKeySequence(keymap.parseKeySequence("dd"))).toBe("d d")
    expect(formatKeySequence(keymap.parseKeySequence({ name: "return", ctrl: true }))).toBe("ctrl+enter")
    expect(formatKeySequence(undefined)).toBe("")
  })

  test("applies generic key and modifier aliases", () => {
    const keymap = getKeymap(renderer)

    expect(
      formatKeySequence(keymap.parseKeySequence({ name: "pageup", meta: true, shift: true }), {
        keyNameAliases: {
          pageup: "pgup",
        },
        modifierAliases: {
          meta: "alt",
        },
      }),
    ).toBe("shift+alt+pgup")
    expect(
      formatKeySequence(keymap.parseKeySequence({ name: "delete", hyper: true }), {
        keyNameAliases: {
          delete: "del",
        },
        modifierAliases: {
          hyper: "meh",
        },
      }),
    ).toBe("meh+del")
  })

  test("uses preserved token display by default and supports token overrides", () => {
    const keymap = getKeymap(renderer)
    keymap.registerToken({ name: "<leader>", key: { name: "space" } })
    const leaderSequence = keymap.parseKeySequence("<leader>s")

    expect(formatKeySequence(leaderSequence)).toBe("<leader> s")
    expect(
      formatKeySequence(leaderSequence, {
        tokenDisplay: {
          "<leader>": "space",
        },
      }),
    ).toBe("space s")
    expect(
      formatKeySequence(leaderSequence, {
        tokenDisplay(tokenName) {
          return tokenName === "<leader>" ? "ctrl+x" : undefined
        },
      }),
    ).toBe("ctrl+x s")
  })

  test("formats command binding lists with dedupe by default", () => {
    const keymap = getKeymap(renderer)
    keymap.registerToken({ name: "<leader>", key: { name: "space" } })

    keymap.registerLayer({
      commands: [{ name: "save-file", run() {} }],
      bindings: [{ key: "ctrl+s", cmd: "save-file" }, { key: "ctrl+s", cmd: "save-file" }, { key: "<leader>s", cmd: "save-file" }],
    })

    const bindings = keymap.getCommandBindings({ visibility: "registered", commands: ["save-file"] }).get("save-file")

    expect(formatCommandBindings(bindings)).toBe("ctrl+s, <leader> s")
  })

  test("supports custom separators and optional duplicate retention", () => {
    const keymap = getKeymap(renderer)
    keymap.registerLayer({
      commands: [{ name: "duplicate", run() {} }],
      bindings: [{ key: "dd", cmd: "duplicate" }, { key: "dd", cmd: "duplicate" }],
    })

    const bindings = keymap.getCommandBindings({ visibility: "registered", commands: ["duplicate"] }).get("duplicate")

    expect(formatCommandBindings(bindings, { separator: " then ", bindingSeparator: " | " })).toBe("d then d")
    expect(formatCommandBindings(bindings, { dedupe: false, bindingSeparator: " | " })).toBe("d d | d d")
    expect(formatCommandBindings(undefined)).toBeUndefined()
  })
})
