import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createTestRenderer, type MockInput, type TestRenderer } from "@opentui/core/testing"
import { resolveBindingSections, type BindingValue } from "../index.js"
import type { BindingInput } from "../../index.js"
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

  test("includes requested sections that are missing from sparse config", () => {
    const sectionNames = ["app", "prompt", "dialog_select"] as const
    type SectionName = (typeof sectionNames)[number]
    type KeymapSections = Record<SectionName, BindingInput[]>

    const resolved = resolveBindingSections(
      {
        app: {
          save: "s",
        },
        custom: {
          run: "r",
        },
      },
      {
        sections: sectionNames,
      },
    )
    const typedSections: KeymapSections = resolved.sections

    expect(Object.keys(resolved.sections)).toEqual(["app", "prompt", "dialog_select", "custom"])
    expect(typedSections.app).toEqual([{ key: "s", cmd: "save" }])
    expect(typedSections.prompt).toEqual([])
    expect(typedSections.dialog_select).toEqual([])
    expect(resolved.sections.custom).toEqual([{ key: "r", cmd: "run" }])
    expect(typedSections.prompt).not.toBe(typedSections.dialog_select)
    expect(resolved.get("app", "save")).toEqual([{ key: "s", cmd: "save" }])
    expect(resolved.get("prompt", "save")).toBeUndefined()
    expect(resolved.get("dialog_select", "run")).toBeUndefined()
    expect(resolved.get("custom", "run")).toEqual([{ key: "r", cmd: "run" }])
  })

  test("can return a complete empty section shape for empty config", () => {
    const resolved = resolveBindingSections(
      {},
      {
        sections: ["app", "prompt", "dialog_select"],
      },
    )

    expect(resolved.sections).toEqual({
      app: [],
      prompt: [],
      dialog_select: [],
    })
    expect(resolved.get("app", "save")).toBeUndefined()
    expect(resolved.get("prompt", "submit")).toBeUndefined()
    expect(resolved.get("missing", "submit")).toBeUndefined()
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

  test("clones key and binding objects without mutating inputs", () => {
    const key = { name: "s", ctrl: true }
    const binding = {
      key,
      cmd: "ignored.command",
      preventDefault: false,
      metadata: { source: "user" },
    }

    const resolved = resolveBindingSections({
      app: {
        save: binding,
      },
    })
    const resolvedBinding = resolved.sections.app?.[0]

    expect(resolvedBinding).toEqual({
      key: { name: "s", ctrl: true },
      cmd: "save",
      preventDefault: false,
      metadata: { source: "user" },
    })
    expect(resolvedBinding).not.toBe(binding)
    expect(resolvedBinding?.key).not.toBe(key)
    expect(binding.cmd).toBe("ignored.command")
  })

  test("lets false, none, and empty arrays disable a command and lets later normalized entries replace earlier ones", () => {
    const resolved = resolveBindingSections({
      app: {
        " save ": "x",
        save: false,
        disabled: "none",
        literal_none_key: ["none"],
        "open ": "o",
        open: ["p", { key: "shift+p", preventDefault: false }],
        empty: [],
      },
    })

    expect(resolved.sections.app).toEqual([
      { key: "none", cmd: "literal_none_key" },
      { key: "p", cmd: "open" },
      { key: "shift+p", cmd: "open", preventDefault: false },
    ])
    expect(resolved.get("app", "save")).toBeUndefined()
    expect(resolved.get("app", "disabled")).toBeUndefined()
    expect(resolved.get("app", "literal_none_key")).toEqual([{ key: "none", cmd: "literal_none_key" }])
    expect(resolved.get("app", "open")).toEqual([
      { key: "p", cmd: "open" },
      { key: "shift+p", cmd: "open", preventDefault: false },
    ])
    expect(resolved.get("app", " open ")).toEqual([
      { key: "p", cmd: "open" },
      { key: "shift+p", cmd: "open", preventDefault: false },
    ])
    expect(resolved.get("app", "empty")).toBeUndefined()
  })

  test("preserves empty sections when every command is disabled", () => {
    const resolved = resolveBindingSections({
      app: {
        save: false,
        open: "none",
        close: [],
      },
    })

    expect(resolved.sections.app).toEqual([])
    expect(resolved.get("app", "save")).toBeUndefined()
    expect(resolved.get("app", "open")).toBeUndefined()
    expect(resolved.get("app", "close")).toBeUndefined()
  })

  test("re-adds normalized commands after disables at the latest insertion point", () => {
    const app: Record<string, BindingValue> = {}
    app[" action "] = "a"
    app.action = false
    app.before_action = "b"
    app["action "] = "c"

    const resolved = resolveBindingSections({ app })

    expect(resolved.sections.app).toEqual([
      { key: "b", cmd: "before_action" },
      { key: "c", cmd: "action" },
    ])
    expect(resolved.get("app", " action ")).toEqual([{ key: "c", cmd: "action" }])
  })

  test("ignores inherited section and command properties", () => {
    const inheritedSectionConfig = Object.create({ inherited: "i" }) as Record<string, unknown>
    inheritedSectionConfig.save = "s"

    const config = Object.create({ inherited_section: { run: "r" } }) as Record<string, Record<string, unknown>>
    config.app = inheritedSectionConfig

    const resolved = resolveBindingSections(config)

    expect(Object.keys(resolved.sections)).toEqual(["app"])
    expect(resolved.sections.app).toEqual([{ key: "s", cmd: "save" }])
    expect(resolved.get("app", "inherited")).toBeUndefined()
    expect(resolved.get("inherited_section", "run")).toBeUndefined()
  })

  test("throws for invalid sections and binding values", () => {
    expect(() => resolveBindingSections({ app: false } as never)).toThrow(
      'Invalid binding section "app": expected an object',
    )
    expect(() => resolveBindingSections({ app: null } as never)).toThrow(
      'Invalid binding section "app": expected an object',
    )
    expect(() => resolveBindingSections({ app: [] } as never)).toThrow(
      'Invalid binding section "app": expected an object',
    )
    expect(() => resolveBindingSections({ app: { save: true } } as never)).toThrow(
      'Invalid binding value for "app.save": expected false, a key, a binding object, or an array of keys/binding objects',
    )
    expect(() => resolveBindingSections({ app: { save: null } } as never)).toThrow(
      'Invalid binding value for "app.save": expected false, a key, a binding object, or an array of keys/binding objects',
    )
    expect(() => resolveBindingSections({ app: { save: ["x", true] } } as never)).toThrow(
      'Invalid binding value for "app.save" at index 1: expected false, a key, a binding object, or an array of keys/binding objects',
    )
    expect(() => resolveBindingSections({ app: { save: ["x", false] } } as never)).toThrow(
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
