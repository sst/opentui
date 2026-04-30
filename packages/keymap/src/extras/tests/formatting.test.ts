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
    expect(formatKeySequence([])).toBe("")
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
    expect(
      formatKeySequence(
        keymap.parseKeySequence({ name: "return", ctrl: true, shift: true, meta: true, super: true, hyper: true }),
        {
          keyNameAliases: {
            enter: "return",
          },
          modifierAliases: {
            ctrl: "C",
            shift: "S",
            meta: "M",
            super: "Super",
            hyper: "Hyper",
          },
        },
      ),
    ).toBe("C+S+M+Super+Hyper+return")
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
    expect(formatKeySequence(leaderSequence, { tokenDisplay: { "<leader>": "" } })).toBe(" s")
    expect(
      formatKeySequence(leaderSequence, {
        tokenDisplay(tokenName, part) {
          expect(tokenName).toBe("<leader>")
          expect(part.tokenName).toBe("<leader>")
          return ""
        },
      }),
    ).toBe(" s")
  })

  test("formats active-key shaped parts", () => {
    const keymap = getKeymap(renderer)
    keymap.registerToken({ name: "<leader>", key: { name: "space" } })
    keymap.registerLayer({ commands: [{ name: "save", run() {} }], bindings: [{ key: "<leader>s", cmd: "save" }] })

    const activeKey = keymap.getActiveKeys()[0]

    expect(formatKeySequence(activeKey ? [activeKey] : [])).toBe("<leader>")
    expect(formatKeySequence(activeKey ? [activeKey] : [], { tokenDisplay: { "<leader>": "ctrl+x" } })).toBe("ctrl+x")
  })

  test("supports empty separators", () => {
    const keymap = getKeymap(renderer)

    expect(formatKeySequence(keymap.parseKeySequence("dd"), { separator: "" })).toBe("dd")
  })

  test("formats command binding lists with dedupe by default", () => {
    const keymap = getKeymap(renderer)
    keymap.registerToken({ name: "<leader>", key: { name: "space" } })

    keymap.registerLayer({
      commands: [{ name: "save-file", run() {} }],
      bindings: [
        { key: "ctrl+s", cmd: "save-file" },
        { key: "ctrl+s", cmd: "save-file" },
        { key: "<leader>s", cmd: "save-file" },
      ],
    })

    const bindings = keymap.getCommandBindings({ visibility: "registered", commands: ["save-file"] }).get("save-file")

    expect(formatCommandBindings(bindings)).toBe("ctrl+s, <leader> s")
  })

  test("supports custom separators and optional duplicate retention", () => {
    const keymap = getKeymap(renderer)
    keymap.registerLayer({
      commands: [{ name: "duplicate", run() {} }],
      bindings: [
        { key: "dd", cmd: "duplicate" },
        { key: "dd", cmd: "duplicate" },
      ],
    })

    const bindings = keymap.getCommandBindings({ visibility: "registered", commands: ["duplicate"] }).get("duplicate")

    expect(formatCommandBindings(bindings, { separator: " then ", bindingSeparator: " | " })).toBe("d then d")
    expect(formatCommandBindings(bindings, { dedupe: false, bindingSeparator: " | " })).toBe("d d | d d")
    expect(formatCommandBindings([])).toBeUndefined()
    expect(formatCommandBindings(undefined)).toBeUndefined()
  })

  test("dedupes by formatted display after aliases", () => {
    const keymap = getKeymap(renderer)
    keymap.registerLayer({
      commands: [{ name: "alias-duplicate", run() {} }],
      bindings: [
        { key: "enter", cmd: "alias-duplicate" },
        { key: "return", cmd: "alias-duplicate" },
      ],
    })

    const bindings = keymap
      .getCommandBindings({ visibility: "registered", commands: ["alias-duplicate"] })
      .get("alias-duplicate")

    expect(formatCommandBindings(bindings)).toBe("enter")
    expect(formatCommandBindings(bindings, { keyNameAliases: { enter: "ret" } })).toBe("ret")
    expect(formatCommandBindings(bindings, { dedupe: false, keyNameAliases: { enter: "ret" } })).toBe("ret, ret")
  })
})
