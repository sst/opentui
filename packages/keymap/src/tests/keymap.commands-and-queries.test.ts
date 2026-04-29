import { Buffer } from "node:buffer"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { BoxRenderable, KeyEvent, type Renderable } from "@opentui/core"
import { createTestRenderer, type MockInput, type TestRenderer } from "@opentui/core/testing"
import * as addons from "../addons/index.js"
import {
  stringifyKeySequence,
  stringifyKeyStroke,
  type ActiveKey,
  type ActiveKeyOptions,
  type BindingParser,
  type CommandRecord,
  type ErrorEvent,
  type EventMatchResolverContext,
  type Keymap,
  type ReactiveMatcher,
  type WarningEvent,
} from "../index.js"
import { createDefaultOpenTuiKeymap, createOpenTuiKeymap } from "../opentui.js"
import { createDiagnosticHarness } from "./diagnostic-harness.js"
import { createKeymapTestHelpers, type OpenTuiKeymap } from "./keymap.test-support.js"

let renderer: TestRenderer
let mockInput: MockInput
const diagnostics = createDiagnosticHarness()
const {
  createFocusableBox,
  getActiveKey,
  getActiveKeyNames,
  getParserKeymap,
  getKeymap,
  createBareKeymap,
  getCommand,
  getCommandEntry,
  getActiveKeyDisplay,
  captureDiagnostics,
  matchEventAs,
  createBracketTokenParser,
  createReactiveBoolean,
} = createKeymapTestHelpers(diagnostics, () => renderer)

describe("keymap: commands and queries", () => {
  beforeEach(async () => {
    const testSetup = await createTestRenderer({ width: 40, height: 10 })
    renderer = testSetup.renderer
    mockInput = testSetup.mockInput
  })

  afterEach(() => {
    renderer?.destroy()
    diagnostics.assertNoUnhandledDiagnostics()
  })
  test("supports command metadata attributes in active keys and command contexts", () => {
    const keymap = getKeymap(renderer)
    const seen: Record<string, unknown>[] = []

    keymap.registerLayer({
      commands: [
        {
          name: "save-file",
          desc: "Save the current file",
          title: "Save File",
          category: "File",
          run(ctx) {
            seen.push({ ...(ctx.command?.attrs ?? {}) })
          },
        },
      ],
    })

    keymap.registerLayer({
      bindings: [{ key: "x", cmd: "save-file" }],
    })

    const attrs = {
      desc: "Save the current file",
      title: "Save File",
      category: "File",
    }

    const activeKey = getActiveKey(keymap, "x", { includeBindings: true, includeMetadata: true })
    expect(activeKey?.bindings?.[0]?.command).toBe("save-file")
    expect(activeKey?.bindings?.[0]?.commandAttrs).toEqual(attrs)
    expect(activeKey?.command).toBe("save-file")
    expect(activeKey?.commandAttrs).toEqual(attrs)

    mockInput.pressKey("x")

    expect(seen).toEqual([attrs])
  })

  test("getCommands searches names by default and returns raw fields plus compiled attrs", () => {
    const keymap = getParserKeymap()

    keymap.registerCommandFields({
      title(value, ctx) {
        ctx.attr("label", value)
      },
    })

    keymap.registerLayer({
      commands: [
        {
          name: "save-current",
          namespace: "excommands",
          title: "Write File",
          usage: ":write <file>",
          tags: ["file", "write"],
          run() {},
        },
        {
          name: "session-reset",
          namespace: "excommands",
          title: "Reset Counters",
          run() {},
        },
        {
          name: "palette-help",
          namespace: "palette",
          title: "Open Help",
          run() {},
        },
      ],
    })

    expect(keymap.getCommands({ search: "save" }).map((command) => command.name)).toEqual(["save-current"])
    expect(keymap.getCommands({ search: "write" })).toEqual([])
    expect(keymap.getCommands({ search: "write", searchIn: ["title"] }).map((command) => command.name)).toEqual([
      "save-current",
    ])
    expect(keymap.getCommands({ search: "write", searchIn: ["label"] }).map((command) => command.name)).toEqual([
      "save-current",
    ])
    expect(getCommand(keymap, "save-current")).toEqual({
      name: "save-current",
      fields: {
        namespace: "excommands",
        title: "Write File",
        usage: ":write <file>",
        tags: ["file", "write"],
      },
      attrs: {
        label: "Write File",
      },
    })
  })

  test("getCommands supports namespace and filter queries across raw fields and attrs", () => {
    const keymap = getParserKeymap()

    keymap.registerCommandFields({
      title(value, ctx) {
        ctx.attr("label", value)
      },
    })

    const offCommands = keymap.registerLayer({
      commands: [
        {
          name: "save-current",
          namespace: "excommands",
          title: "Write File",
          usage: ":write <file>",
          tags: ["file", "write"],
          run() {},
        },
        {
          name: "session-reset",
          namespace: "excommands",
          title: "Reset Counters",
          tags: ["session"],
          run() {},
        },
        {
          name: "palette-help",
          namespace: "palette",
          title: "Open Help",
          tags: ["help"],
          run() {},
        },
        {
          name: "untagged-help",
          title: "excommands helper",
          tags: ["help"],
          run() {},
        },
      ],
    })

    expect(keymap.getCommands({ namespace: "excommands" }).map((command) => command.name)).toEqual([
      "save-current",
      "session-reset",
    ])
    expect(keymap.getCommands({ namespace: ["palette", "missing"] }).map((command) => command.name)).toEqual([
      "palette-help",
    ])
    expect(
      keymap
        .getCommands({ namespace: "excommands", search: "reset", searchIn: ["title"] })
        .map((command) => command.name),
    ).toEqual(["session-reset"])
    expect(keymap.getCommands({ filter: { namespace: "excommands" } }).map((command) => command.name)).toEqual([
      "save-current",
      "session-reset",
    ])
    expect(keymap.getCommands({ filter: { tags: "file" } }).map((command) => command.name)).toEqual(["save-current"])
    expect(keymap.getCommands({ filter: { label: "Reset Counters" } }).map((command) => command.name)).toEqual([
      "session-reset",
    ])
    expect(
      keymap
        .getCommands({
          filter: {
            usage(value: unknown, command: CommandRecord) {
              return typeof value === "string" && value.includes("<file>") && command.fields.namespace === "excommands"
            },
          },
        })
        .map((command) => command.name),
    ).toEqual(["save-current"])
    expect(
      keymap
        .getCommands({
          namespace: "excommands",
          filter: {
            usage(value: unknown) {
              return typeof value === "string" && value.includes("<file>")
            },
          },
        })
        .map((command) => command.name),
    ).toEqual(["save-current"])
    expect(
      keymap.getCommands({ filter: (command) => command.name === "palette-help" }).map((command) => command.name),
    ).toEqual(["palette-help"])
    expect(
      keymap.getCommands({ filter: { name: ["palette-help", "missing"] } }).map((command) => command.name),
    ).toEqual(["palette-help"])
    expect(
      keymap
        .getCommands({ filter: { name: ["save-current", "palette-help"], namespace: "excommands" } })
        .map((command) => command.name),
    ).toEqual(["save-current"])
    expect(keymap.getCommands({ filter: { name: [] } }).map((command) => command.name)).toEqual([])

    offCommands()

    expect(keymap.getCommands()).toEqual([])
  })

  test("getCommands defaults to reachable commands and supports active and registered visibility", () => {
    const keymap = getKeymap(renderer)

    const target = createFocusableBox("command-visibility-target")
    renderer.root.add(target)

    keymap.registerLayer({
      commands: [
        { name: "save", title: "Global Save", run() {} },
        { name: "quit", title: "Quit", run() {} },
      ],
    })
    keymap.registerLayer({
      target,
      commands: [{ name: "save", title: "Local Save", run() {} }],
    })

    expect(keymap.getCommands().map((command) => command.name)).toEqual(["save", "quit"])
    expect(keymap.getCommands().map((command) => command.fields.title)).toEqual(["Global Save", "Quit"])
    expect(keymap.getCommands({ visibility: "active" }).map((command) => command.fields.title)).toEqual([
      "Global Save",
      "Quit",
    ])
    expect(keymap.getCommands({ visibility: "registered" }).map((command) => command.fields.title)).toEqual([
      "Global Save",
      "Quit",
      "Local Save",
    ])

    target.focus()

    expect(keymap.getCommands().map((command) => command.fields.title)).toEqual(["Local Save", "Quit"])
    expect(keymap.getCommands({ visibility: "active" }).map((command) => command.fields.title)).toEqual([
      "Local Save",
      "Global Save",
      "Quit",
    ])
    expect(keymap.getCommands({ visibility: "registered" }).map((command) => command.fields.title)).toEqual([
      "Global Save",
      "Quit",
      "Local Save",
    ])
  })

  test("getCommandEntries returns commands with bindings across visibility modes", () => {
    const keymap = getKeymap(renderer)
    const target = createFocusableBox("command-entry-visibility-target")
    renderer.root.add(target)

    keymap.registerLayer({
      commands: [
        { name: "save", title: "Global Save", run() {} },
        { name: "quit", title: "Quit", run() {} },
      ],
      bindings: [
        { key: "x", cmd: "save", desc: "Write current file" },
        { key: "q", cmd: "quit", desc: "Quit app" },
      ],
    })
    keymap.registerLayer({
      target,
      commands: [{ name: "save", title: "Local Save", run() {} }],
      bindings: [{ key: "l", cmd: "save", desc: "Save in panel" }],
    })

    const snapshot = (visibility?: "reachable" | "active" | "registered") => {
      return keymap.getCommandEntries(visibility ? { visibility } : undefined).map((entry) => ({
        title: entry.command.fields.title,
        bindings: entry.bindings
          .map((binding) => stringifyKeySequence(binding.sequence, { preferDisplay: true }))
          .sort(),
      }))
    }

    expect(snapshot()).toEqual([
      { title: "Global Save", bindings: ["x"] },
      { title: "Quit", bindings: ["q"] },
    ])

    target.focus()

    expect(snapshot()).toEqual([
      { title: "Local Save", bindings: ["l", "x"] },
      { title: "Quit", bindings: ["q"] },
    ])
    expect(snapshot("active")).toEqual([
      { title: "Local Save", bindings: ["l", "x"] },
      { title: "Global Save", bindings: ["l", "x"] },
      { title: "Quit", bindings: ["q"] },
    ])
    expect(snapshot("registered")).toEqual([
      { title: "Global Save", bindings: ["l", "x"] },
      { title: "Quit", bindings: ["q"] },
      { title: "Local Save", bindings: ["l", "x"] },
    ])
  })

  test("getCommandBindings returns requested command binding groups", () => {
    const keymap = getKeymap(renderer)

    keymap.registerLayer({
      commands: [
        { name: "save", title: "Save", run() {} },
        { name: "quit", title: "Quit", run() {} },
      ],
      bindings: [
        { key: "ctrl+s", cmd: "save", desc: "Save with control" },
        { key: "s", cmd: "save" },
        { key: "q", cmd: "quit" },
        { key: "x", cmd: "unrequested" },
      ],
    })

    const bindings = keymap.getCommandBindings({
      visibility: "registered",
      commands: ["quit", "missing", "save"],
    })

    expect([...bindings.keys()]).toEqual(["quit", "missing", "save"])
    expect(bindings.get("quit")?.map((binding) => stringifyKeySequence(binding.sequence))).toEqual(["q"])
    expect(bindings.get("missing")).toEqual([])
    expect(bindings.get("save")?.map((binding) => stringifyKeySequence(binding.sequence))).toEqual(["ctrl+s", "s"])
    expect(bindings.get("save")?.[0]).toMatchObject({
      command: "save",
      commandAttrs: {
        title: "Save",
      },
      attrs: {
        desc: "Save with control",
      },
      event: "press",
      preventDefault: true,
      fallthrough: false,
    })
  })

  test("getCommandBindings collapses duplicate command records without duplicating bindings", () => {
    const keymap = getKeymap(renderer)

    keymap.registerLayer({
      commands: [{ name: "duplicate", title: "First", run() {} }],
      bindings: [{ key: "a", cmd: "duplicate" }],
    })
    keymap.registerLayer({
      commands: [{ name: "duplicate", title: "Second", run() {} }],
      bindings: [{ key: "b", cmd: "duplicate" }],
    })

    expect(
      keymap
        .getCommandEntries({ visibility: "registered", filter: { name: "duplicate" } })
        .map((entry) => entry.bindings.map((binding) => stringifyKeySequence(binding.sequence))),
    ).toEqual([
      ["a", "b"],
      ["a", "b"],
    ])
    expect(
      keymap
        .getCommandBindings({ visibility: "registered", commands: ["duplicate"] })
        .get("duplicate")
        ?.map((binding) => stringifyKeySequence(binding.sequence)),
    ).toEqual(["a", "b"])
  })

  test("getCommandBindings respects registered and active visibility", () => {
    const keymap = getKeymap(renderer)
    const target = createFocusableBox("command-binding-visibility-target")
    renderer.root.add(target)

    keymap.registerLayer({
      commands: [{ name: "save", title: "Global Save", run() {} }],
      bindings: [{ key: "x", cmd: "save" }],
    })
    keymap.registerLayer({
      target,
      commands: [{ name: "save", title: "Local Save", run() {} }],
      bindings: [{ key: "l", cmd: "save" }],
    })

    const labels = (visibility?: "reachable" | "active" | "registered") => {
      return keymap
        .getCommandBindings({ visibility, commands: ["save"] })
        .get("save")
        ?.map((binding) => stringifyKeySequence(binding.sequence))
    }

    expect(labels()).toEqual(["x"])
    expect(labels("active")).toEqual(["x"])
    expect(labels("registered")).toEqual(["x", "l"])

    target.focus()

    expect(labels()).toEqual(["l", "x"])
    expect(labels("active")).toEqual(["l", "x"])
    expect(labels("registered")).toEqual(["x", "l"])
  })

  test("getCommandBindings filters inactive bindings outside registered visibility", () => {
    const keymap = getKeymap(renderer)
    let enabled = false

    keymap.registerBindingFields({
      active(value, ctx) {
        if (value !== true) {
          throw new Error('Keymap binding field "active" must be true')
        }

        ctx.activeWhen(() => enabled)
      },
    })
    keymap.registerLayer({
      commands: [{ name: "conditional", run() {} }],
      bindings: [{ key: "x", cmd: "conditional", active: true }],
    })

    const labels = (visibility?: "reachable" | "active" | "registered") => {
      return keymap
        .getCommandBindings({ visibility, commands: ["conditional"] })
        .get("conditional")
        ?.map((binding) => stringifyKeySequence(binding.sequence))
    }

    expect(labels()).toEqual([])
    expect(labels("active")).toEqual([])
    expect(labels("registered")).toEqual(["x"])

    enabled = true

    expect(labels()).toEqual(["x"])
    expect(labels("active")).toEqual(["x"])
  })

  test("getCommandBindings includes registered bindings and applies resolver visibility", () => {
    const keymap = getKeymap(renderer)

    keymap.registerLayer({
      bindings: [{ key: "x", cmd: "external-run" }],
    })

    const labels = (visibility?: "reachable" | "active" | "registered") => {
      return keymap
        .getCommandBindings({ visibility, commands: ["external-run"] })
        .get("external-run")
        ?.map((binding) => stringifyKeySequence(binding.sequence))
    }

    expect(labels("registered")).toEqual(["x"])
    expect(labels()).toEqual([])

    keymap.appendCommandResolver((command) => {
      if (command !== "external-run") {
        return undefined
      }

      return {
        attrs: {
          title: "External Run",
        },
        run() {},
      }
    })

    const activeBindings = keymap.getCommandBindings({ commands: ["external-run"] }).get("external-run")

    expect(activeBindings?.map((binding) => stringifyKeySequence(binding.sequence))).toEqual(["x"])
    expect(activeBindings?.[0]?.commandAttrs).toEqual({ title: "External Run" })
  })

  test("getCommandEntries reuses active binding views and keeps command-only entries", () => {
    const keymap = getKeymap(renderer)

    keymap.registerLayer({
      commands: [
        {
          name: "save-file",
          desc: "Save the current file",
          title: "Save File",
          category: "File",
          run() {},
        },
        {
          name: "palette-help",
          title: "Open Help",
          run() {},
        },
      ],
      bindings: [{ key: "x", cmd: "save-file", desc: "Write current file", group: "File" }],
    })

    const save = getCommandEntry(keymap, "save-file")
    expect(save).toEqual({
      command: {
        name: "save-file",
        fields: {
          desc: "Save the current file",
          title: "Save File",
          category: "File",
        },
        attrs: {
          desc: "Save the current file",
          title: "Save File",
          category: "File",
        },
      },
      bindings: [
        {
          sequence: save?.bindings[0]?.sequence,
          command: "save-file",
          commandAttrs: {
            desc: "Save the current file",
            title: "Save File",
            category: "File",
          },
          attrs: {
            desc: "Write current file",
            group: "File",
          },
          event: "press",
          preventDefault: true,
          fallthrough: false,
        },
      ],
    })

    expect(getCommandEntry(keymap, "palette-help")).toEqual({
      command: {
        name: "palette-help",
        fields: {
          title: "Open Help",
        },
        attrs: {
          title: "Open Help",
        },
      },
      bindings: [],
    })
  })

  test("getCommandEntries applies command query filters before attaching bindings", () => {
    const keymap = getParserKeymap()

    keymap.registerCommandFields({
      title(value, ctx) {
        ctx.attr("label", value)
      },
    })

    keymap.registerLayer({
      commands: [
        {
          name: "save-current",
          namespace: "excommands",
          title: "Write File",
          usage: ":write <file>",
          run() {},
        },
        {
          name: "palette-help",
          namespace: "palette",
          title: "Open Help",
          usage: ":help",
          run() {},
        },
      ],
      bindings: [
        { key: "x", cmd: "save-current" },
        { key: "h", cmd: "palette-help" },
      ],
    })

    expect(
      keymap
        .getCommandEntries({ namespace: "excommands", search: "write", searchIn: ["title", "label"] })
        .map((entry) => ({
          name: entry.command.name,
          bindings: entry.bindings.map((binding) => stringifyKeySequence(binding.sequence, { preferDisplay: true })),
        })),
    ).toEqual([
      {
        name: "save-current",
        bindings: ["x"],
      },
    ])
  })

  test("getCommands treats thrown filter predicates as errors and returns no matches", () => {
    const keymap = getKeymap(renderer)
    const { takeErrors } = captureDiagnostics(keymap)

    keymap.registerLayer({
      commands: [
        { name: "save-current", usage: ":write <file>", run() {} },
        { name: "palette-help", usage: ":help", run() {} },
      ],
    })

    let queryResult: ReturnType<OpenTuiKeymap["getCommands"]> = []

    expect(() => {
      queryResult = keymap.getCommands({
        filter(command) {
          throw new Error(`query ${command.name}`)
        },
      })
    }).not.toThrow()

    expect(queryResult).toEqual([])
    expect(takeErrors().errors).toEqual([
      "[Keymap] Error in command query filter:",
      "[Keymap] Error in command query filter:",
    ])

    expect(() => {
      queryResult = keymap.getCommands({
        filter: {
          usage() {
            throw new Error("usage boom")
          },
        },
      })
    }).not.toThrow()

    expect(queryResult).toEqual([])
    expect(takeErrors().errors).toEqual([
      "[Keymap] Error in command query filter:",
      "[Keymap] Error in command query filter:",
    ])
  })

  test("getCommands returns immutable metadata records across repeated reads", () => {
    const keymap = getKeymap(renderer)

    keymap.registerLayer({
      commands: [
        {
          name: "save-current",
          tags: ["file", "write"],
          run() {},
        },
      ],
    })

    const first = getCommand(keymap, "save-current")
    expect(first).toBeDefined()
    expect(Object.isFrozen(first!.fields)).toBe(true)
    expect(Object.isFrozen(first!.fields.tags as object)).toBe(true)

    expect(() => {
      ;(first!.fields.tags as string[]).push("mutated")
    }).toThrow()

    const second = getCommand(keymap, "save-current")
    expect(second).toBe(first)
    expect(second).toEqual({
      name: "save-current",
      fields: {
        tags: ["file", "write"],
      },
    })
  })

  test("getCommands clones plain metadata deeply but preserves opaque values by reference", () => {
    const keymap = getKeymap(renderer)
    const opaque = new Map([["recent", 1]])
    const helper = () => "ok"
    const payload = {
      nested: { title: "Write File" },
      tags: ["file", { kind: "write" }],
      opaque,
      helper,
    }

    keymap.registerLayer({
      commands: [
        {
          name: "save-current",
          payload,
          run() {},
        },
      ],
    })

    payload.nested.title = "Mutated"
    ;(payload.tags[1] as { kind: string }).kind = "mutated"

    const command = getCommand(keymap, "save-current")
    const storedPayload = command?.fields.payload as {
      nested: { title: string }
      tags: [string, { kind: string }]
      opaque: Map<string, number>
      helper: () => string
    }

    expect(storedPayload).toBeDefined()
    expect(storedPayload).not.toBe(payload)
    expect(storedPayload.nested).not.toBe(payload.nested)
    expect(storedPayload.tags).not.toBe(payload.tags)
    expect(storedPayload.tags[1]).not.toBe(payload.tags[1])
    expect(storedPayload.nested.title).toBe("Write File")
    expect(storedPayload.tags[1]).toEqual({ kind: "write" })
    expect(storedPayload.opaque).toBe(opaque)
    expect(storedPayload.helper).toBe(helper)
    expect(Object.isFrozen(storedPayload)).toBe(true)
    expect(Object.isFrozen(storedPayload.nested)).toBe(true)
    expect(Object.isFrozen(storedPayload.tags)).toBe(true)
    expect(Object.isFrozen(storedPayload.tags[1])).toBe(true)
  })

  test("keeps active key projections isolated across repeated reads", () => {
    const keymap = getKeymap(renderer)

    keymap.registerLayer({
      commands: [
        {
          name: "save-file",
          desc: "Save the current file",
          title: "Save File",
          category: "File",
          run() {},
        },
      ],
    })

    keymap.registerLayer({
      bindings: [{ key: "x", cmd: "save-file", desc: "Write current file", group: "File" }],
    })

    const plain = getActiveKey(keymap, "x")
    const metadataOnly = getActiveKey(keymap, "x", { includeMetadata: true })
    const withBindings = getActiveKey(keymap, "x", { includeBindings: true })
    const withBindingsAndMetadata = getActiveKey(keymap, "x", { includeBindings: true, includeMetadata: true })
    const plainAgain = getActiveKey(keymap, "x")

    const commandAttrs = {
      desc: "Save the current file",
      title: "Save File",
      category: "File",
    }
    const bindingAttrs = {
      desc: "Write current file",
      group: "File",
    }

    expect(plain?.bindings).toBeUndefined()
    expect(plain?.bindingAttrs).toBeUndefined()
    expect(plain?.commandAttrs).toBeUndefined()
    expect(plain?.command).toBe("save-file")

    expect(metadataOnly?.bindings).toBeUndefined()
    expect(metadataOnly?.command).toBe("save-file")
    expect(metadataOnly?.bindingAttrs).toEqual(bindingAttrs)
    expect(metadataOnly?.commandAttrs).toEqual(commandAttrs)

    expect(withBindings?.bindingAttrs).toBeUndefined()
    expect(withBindings?.commandAttrs).toBeUndefined()
    expect(withBindings?.command).toBe("save-file")
    expect(withBindings?.bindings?.[0]?.attrs).toEqual(bindingAttrs)
    expect(withBindings?.bindings?.[0]?.command).toBe("save-file")
    expect(withBindings?.bindings?.[0]?.commandAttrs).toEqual(commandAttrs)

    expect(withBindingsAndMetadata?.bindingAttrs).toEqual(bindingAttrs)
    expect(withBindingsAndMetadata?.commandAttrs).toEqual(commandAttrs)
    expect(withBindingsAndMetadata?.command).toBe("save-file")
    expect(withBindingsAndMetadata?.bindings?.[0]?.attrs).toEqual(bindingAttrs)
    expect(withBindingsAndMetadata?.bindings?.[0]?.command).toBe("save-file")
    expect(withBindingsAndMetadata?.bindings?.[0]?.commandAttrs).toEqual(commandAttrs)

    expect(plainAgain?.bindings).toBeUndefined()
    expect(plainAgain?.bindingAttrs).toBeUndefined()
    expect(plainAgain?.commandAttrs).toBeUndefined()
    expect(plainAgain?.command).toBe("save-file")
  })
})
