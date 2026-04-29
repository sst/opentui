import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { BoxRenderable, InputRenderable, InputRenderableEvents, TextareaRenderable } from "@opentui/core"
import { createTestRenderer, type MockInput, type TestRenderer } from "@opentui/core/testing"
import { commandBindings } from "@opentui/keymap/extras"
import {
  createTextareaBindings,
  registerEditBufferCommands,
  registerManagedTextareaLayer,
  registerTextareaMappingSuspension,
} from "@opentui/keymap/addons/opentui"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createDiagnosticHarness } from "../../../tests/diagnostic-harness.js"

let renderer: TestRenderer
let mockInput: MockInput
const diagnostics = createDiagnosticHarness()

function getKeymap(renderer: TestRenderer) {
  return diagnostics.trackKeymap(createDefaultOpenTuiKeymap(renderer))
}

describe("edit buffer bindings addon", () => {
  beforeEach(async () => {
    const testSetup = await createTestRenderer({ width: 40, height: 10 })
    renderer = testSetup.renderer
    mockInput = testSetup.mockInput
  })

  afterEach(() => {
    renderer?.destroy()
    diagnostics.assertNoUnhandledDiagnostics()
  })

  test("registerEditBufferCommands resolves plain layers that were registered first", () => {
    const keymap = getKeymap(renderer)

    keymap.registerLayer({
      bindings: [{ key: "ctrl+d", cmd: "input.delete.line" }],
    })

    expect(keymap.getActiveKeys().some((candidate) => candidate.stroke.name === "d" && candidate.stroke.ctrl)).toBe(
      false,
    )

    registerEditBufferCommands(keymap, renderer)

    expect(keymap.getActiveKeys().some((candidate) => candidate.stroke.name === "d" && candidate.stroke.ctrl)).toBe(
      true,
    )

    const textarea = new TextareaRenderable(renderer, {
      width: 20,
      height: 4,
      initialValue: "Line 1\nLine 2\nLine 3",
    })
    renderer.root.add(textarea)

    textarea.focus()
    textarea.gotoLine(1)
    mockInput.pressKey("d", { ctrl: true })

    expect(textarea.plainText).toBe("Line 1\nLine 3")
  })

  test("supports sequence bindings through plain layers", () => {
    const keymap = getKeymap(renderer)

    registerEditBufferCommands(keymap, renderer)
    keymap.registerLayer({
      bindings: [{ key: "dd", cmd: "input.delete.line" }],
    })

    const textarea = new TextareaRenderable(renderer, {
      width: 20,
      height: 4,
      initialValue: "Line 1\nLine 2\nLine 3",
    })
    renderer.root.add(textarea)

    textarea.focus()
    textarea.gotoLine(1)
    mockInput.pressKey("d")
    mockInput.pressKey("d")

    expect(textarea.plainText).toBe("Line 1\nLine 3")
  })

  test("passes uncaptured input through to the focused textarea", () => {
    const keymap = getKeymap(renderer)

    registerEditBufferCommands(keymap, renderer)
    keymap.registerLayer({
      bindings: [{ key: "left", cmd: "input.move.left" }],
    })

    const textarea = new TextareaRenderable(renderer, {
      width: 20,
      height: 4,
      initialValue: "",
    })
    renderer.root.add(textarea)

    textarea.focus()
    mockInput.pressKey("x")

    expect(textarea.plainText).toBe("x")
  })

  test("createTextareaBindings prepends override-style bindings ahead of textarea defaults", () => {
    const bindings = createTextareaBindings([
      { key: "left", cmd: "custom-left" },
      { key: "dd", cmd: "input.delete.line" },
    ])

    expect(bindings[0]).toEqual({ key: "left", cmd: "custom-left" })
    expect(bindings[1]).toEqual({ key: "dd", cmd: "input.delete.line" })
    expect(bindings.some((binding) => binding.key === "right" && binding.cmd === "input.move.right")).toBe(true)
    expect(bindings.some((binding) => binding.key === "left" && binding.cmd === "input.move.left")).toBe(true)
    expect(bindings.some((binding) => binding.key === "backspace" && binding.desc === "Delete backward")).toBe(true)
  })

  test("createTextareaBindings applies custom command names to generated defaults", () => {
    const bindings = createTextareaBindings(undefined, {
      commandNames: {
        "move-left": "input_move_left",
        submit: "input_submit",
      },
    })

    expect(bindings.some((binding) => binding.key === "left" && binding.cmd === "input_move_left")).toBe(true)
    expect(bindings.some((binding) => binding.key === "left" && binding.cmd === "input.move.left")).toBe(false)
    expect(bindings.some((binding) => binding.key === "meta+return" && binding.cmd === "input_submit")).toBe(true)
    expect(bindings.some((binding) => binding.key === "return" && binding.cmd === "input.newline")).toBe(true)
  })

  test("registerManagedTextareaLayer accepts commandBindings helper output for overrides", () => {
    const keymap = getKeymap(renderer)
    const textarea = new TextareaRenderable(renderer, {
      width: 20,
      height: 4,
      initialValue: "Line 1\nLine 2",
    })
    renderer.root.add(textarea)

    registerEditBufferCommands(keymap, renderer)
    const off = registerManagedTextareaLayer(keymap, renderer, {
      bindings: commandBindings({ "input.delete.line": "dd" }),
    })

    textarea.focus()
    textarea.gotoLine(1)
    mockInput.pressKey("d")
    mockInput.pressKey("d")

    expect(textarea.plainText).toBe("Line 1")

    off()
  })

  test("registerManagedTextareaLayer typing rejects target and targetMode", () => {
    const textarea = new TextareaRenderable(renderer, {
      width: 20,
      height: 4,
      initialValue: "Line 1\nLine 2",
    })
    renderer.root.add(textarea)

    const layer: Parameters<typeof registerManagedTextareaLayer>[2] = {
      // @ts-expect-error managed textarea layers are always global
      target: textarea,
      // @ts-expect-error managed textarea layers are always global
      targetMode: "focus-within",
      bindings: commandBindings({ "input.delete.line": "dd" }),
    }

    expect(layer.bindings).toEqual([{ key: "dd", cmd: "input.delete.line" }])
  })

  test("registerManagedTextareaLayer ignores scoped fields passed by untyped callers", () => {
    const keymap = getKeymap(renderer)
    const primary = new TextareaRenderable(renderer, {
      width: 20,
      height: 4,
      initialValue: "Line 1\nLine 2",
    })
    const secondary = new TextareaRenderable(renderer, {
      width: 20,
      height: 4,
      initialValue: "Alpha\nBeta\nGamma",
    })
    renderer.root.add(primary)
    renderer.root.add(secondary)

    const off = registerManagedTextareaLayer(keymap, renderer, {
      target: primary,
      targetMode: "focus-within",
      bindings: commandBindings({ "input.delete.line": "dd" }),
    } as Parameters<typeof registerManagedTextareaLayer>[2])

    secondary.focus()
    secondary.gotoLine(1)
    expect(secondary.traits.suspend).toBe(true)

    mockInput.pressKey("d")
    mockInput.pressKey("d")

    expect(secondary.plainText).toBe("Alpha\nGamma")

    primary.focus()
    primary.cursorOffset = primary.plainText.length
    mockInput.pressBackspace()

    expect(primary.plainText).toBe("Line 1\nLine ")

    off()
  })

  test("registerTextareaMappingSuspension disables local textarea shortcuts but preserves plain typing", () => {
    const keymap = getKeymap(renderer)
    const textarea = new TextareaRenderable(renderer, {
      width: 20,
      height: 4,
      initialValue: "abc",
    })
    renderer.root.add(textarea)

    const offSuspension = registerTextareaMappingSuspension(keymap, renderer)

    textarea.focus()
    textarea.cursorOffset = 3
    expect(textarea.traits.suspend).toBe(true)

    mockInput.pressBackspace()
    expect(textarea.plainText).toBe("abc")

    mockInput.pressKey("x")
    expect(textarea.plainText).toBe("abcx")

    offSuspension()
    expect(textarea.traits.suspend).toBeUndefined()

    mockInput.pressBackspace()
    expect(textarea.plainText).toBe("abc")
  })

  test("registerTextareaMappingSuspension leaves input renderables using their own mappings", () => {
    const keymap = getKeymap(renderer)
    let submitted = 0

    const input = new InputRenderable(renderer, {
      width: 20,
      value: "Hello",
    })
    input.on(InputRenderableEvents.ENTER, () => {
      submitted += 1
    })
    renderer.root.add(input)

    const offSuspension = registerTextareaMappingSuspension(keymap, renderer)

    input.focus()
    expect(input.traits.suspend).toBeUndefined()

    mockInput.pressEnter()
    expect(submitted).toBe(1)

    offSuspension()
  })

  test("does not double-run textarea actions when a global binding uses the same stroke", () => {
    const keymap = getKeymap(renderer)

    registerEditBufferCommands(keymap, renderer)
    keymap.registerLayer({
      bindings: [{ key: "backspace", cmd: "input.backspace" }],
    })

    const textarea = new TextareaRenderable(renderer, {
      width: 20,
      height: 4,
      initialValue: "abc",
    })
    renderer.root.add(textarea)

    textarea.focus()
    textarea.cursorOffset = 3
    mockInput.pressBackspace()

    expect(textarea.plainText).toBe("ab")
    expect(textarea.cursorOffset).toBe(2)
  })

  test("supports submit on input renderables through plain layers", () => {
    const keymap = getKeymap(renderer)
    let submitted = 0

    registerEditBufferCommands(keymap, renderer)
    keymap.registerLayer({
      bindings: [{ key: "x", cmd: "input.submit" }],
    })

    const input = new InputRenderable(renderer, {
      width: 20,
      value: "Hello",
    })
    input.on(InputRenderableEvents.ENTER, () => {
      submitted += 1
    })
    renderer.root.add(input)

    input.focus()
    mockInput.pressKey("x")

    expect(submitted).toBe(1)
    expect(input.value).toBe("Hello")
  })

  test("keeps shared commands alive across registrations", () => {
    const keymap = getKeymap(renderer)
    let submitted = 0

    const offFirst = registerEditBufferCommands(keymap, renderer)
    const offSecond = registerEditBufferCommands(keymap, renderer)
    keymap.registerLayer({
      bindings: [{ key: "x", cmd: "input.submit" }],
    })

    const input = new InputRenderable(renderer, {
      width: 20,
      value: "Hello",
    })
    input.on(InputRenderableEvents.ENTER, () => {
      submitted += 1
    })
    renderer.root.add(input)

    offFirst()
    input.focus()
    mockInput.pressKey("x")

    expect(submitted).toBe(1)

    offSecond()
  })

  test("falls through when there is no focused editor or submit is unsupported", () => {
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

    registerEditBufferCommands(keymap, renderer)
    keymap.registerLayer({
      bindings: [{ key: "x", cmd: "input.submit" }],
    })

    const box = new BoxRenderable(renderer, {
      id: "plain-box",
      width: 10,
      height: 4,
      focusable: true,
    })
    const textarea = new TextareaRenderable(renderer, {
      width: 20,
      height: 4,
      initialValue: "Hello",
    })
    renderer.root.add(box)
    renderer.root.add(textarea)

    box.focus()
    mockInput.pressKey("x")

    textarea.focus()
    ;(textarea as { submit?: unknown }).submit = undefined
    mockInput.pressKey("x")

    expect(calls).toEqual(["fallback", "fallback"])
    expect(textarea.plainText).toBe("Hello")
  })

  test("registerManagedTextareaLayer combines commands, suspension, defaults, and overrides", () => {
    const keymap = getKeymap(renderer)

    const off = registerManagedTextareaLayer(keymap, renderer, {
      bindings: [{ key: "dd", cmd: "input.delete.line" }],
    })

    const textarea = new TextareaRenderable(renderer, {
      width: 20,
      height: 4,
      initialValue: "Line 1\nLine 2\nLine 3",
    })
    renderer.root.add(textarea)

    textarea.focus()
    textarea.gotoLine(1)
    expect(textarea.traits.suspend).toBe(true)

    mockInput.pressKey("d")
    mockInput.pressKey("d")

    expect(textarea.plainText).toBe("Line 1\nLine 3")

    mockInput.pressKey("x")
    expect(textarea.plainText).toBe("Line 1\nxLine 3")

    off()
    expect(textarea.traits.suspend).toBeUndefined()

    mockInput.pressBackspace()
    expect(textarea.plainText).toBe("Line 1\nLine 3")
  })

  test("registerManagedTextareaLayer lets overrides replace default textarea shortcuts by order", () => {
    const keymap = getKeymap(renderer)
    const calls: string[] = []

    keymap.registerLayer({
      commands: [
        {
          name: "custom-left",
          run() {
            calls.push("custom-left")
          },
        },
      ],
    })

    const off = registerManagedTextareaLayer(keymap, renderer, {
      bindings: [{ key: "left", cmd: "custom-left" }],
    })

    const textarea = new TextareaRenderable(renderer, {
      width: 20,
      height: 4,
      initialValue: "abc",
    })
    renderer.root.add(textarea)

    textarea.focus()
    textarea.cursorOffset = 3

    mockInput.pressArrow("left")

    expect(calls).toEqual(["custom-left"])
    expect(textarea.cursorOffset).toBe(3)

    off()
  })

  test("registerEditBufferCommands applies custom command names and descriptions when metadata fields are registered", () => {
    const keymap = getKeymap(renderer)

    registerEditBufferCommands(keymap, renderer, {
      commandNames: {
        "delete-line": "input_delete_line",
      },
      descriptions: {
        "delete-line": "Supprimer la ligne",
      },
    })

    keymap.registerLayer({
      bindings: [{ key: "x", cmd: "input_delete_line" }],
    })

    const textarea = new TextareaRenderable(renderer, {
      width: 20,
      height: 4,
      initialValue: "Line 1\nLine 2\nLine 3",
    })
    renderer.root.add(textarea)

    textarea.focus()
    textarea.gotoLine(1)
    mockInput.pressKey("x")

    const activeKey = keymap.getActiveKeys({ includeMetadata: true }).find((candidate) => candidate.stroke.name === "x")

    expect(textarea.plainText).toBe("Line 1\nLine 3")
    expect(activeKey?.command).toBe("input_delete_line")
    expect(activeKey?.commandAttrs).toEqual({ desc: "Supprimer la ligne" })
  })

  test("registerManagedTextareaLayer applies custom command names and descriptions to generated default bindings", () => {
    const keymap = getKeymap(renderer)
    const textarea = new TextareaRenderable(renderer, {
      width: 20,
      height: 4,
      initialValue: "abc",
    })
    renderer.root.add(textarea)

    const off = registerManagedTextareaLayer(
      keymap,
      renderer,
      {},
      {
        commandNames: {
          "move-left": "input_move_left",
        },
        descriptions: {
          "move-left": "Curseur gauche",
        },
      },
    )

    const activeKey = keymap
      .getActiveKeys({ includeMetadata: true })
      .find((candidate) => candidate.stroke.name === "left")

    textarea.focus()
    textarea.cursorOffset = 3
    mockInput.pressArrow("left")

    expect(textarea.cursorOffset).toBe(2)
    expect(activeKey?.command).toBe("input_move_left")
    expect(activeKey?.bindingAttrs).toEqual({ desc: "Curseur gauche" })
    expect(activeKey?.commandAttrs).toEqual({ desc: "Curseur gauche" })

    off()
  })

  test("shared edit buffer command registrations ignore later description overrides", () => {
    const keymap = getKeymap(renderer)

    registerEditBufferCommands(keymap, renderer, {
      descriptions: {
        "move-left": "Cursor left",
      },
    })

    expect(() => {
      registerEditBufferCommands(keymap, renderer, {
        descriptions: {
          "move-left": "Curseur gauche",
        },
      })
    }).not.toThrow()
  })

  test("shared edit buffer command registrations ignore later command name overrides", () => {
    const keymap = getKeymap(renderer)

    registerEditBufferCommands(keymap, renderer, {
      commandNames: {
        "move-left": "input_move_left",
      },
    })

    expect(() => {
      registerEditBufferCommands(keymap, renderer, {
        commandNames: {
          "move-left": "other_move_left",
        },
      })
    }).not.toThrow()

    expect(keymap.getCommands({ visibility: "registered" }).some((command) => command.name === "input_move_left")).toBe(
      true,
    )
    expect(keymap.getCommands({ visibility: "registered" }).some((command) => command.name === "other_move_left")).toBe(
      false,
    )
  })

  test("createTextareaBindings rejects empty custom command names", () => {
    expect(() => {
      createTextareaBindings(undefined, {
        commandNames: {
          "move-left": "   ",
        },
      })
    }).toThrow('Edit buffer command name for "move-left" cannot be empty')
  })

  test("registerEditBufferCommands rejects duplicate custom command names", () => {
    const keymap = getKeymap(renderer)

    expect(() => {
      registerEditBufferCommands(keymap, renderer, {
        commandNames: {
          "move-left": "input_move",
          "move-right": "input_move",
        },
      })
    }).toThrow('Edit buffer command name "input_move" is assigned to both "move-left" and "move-right"')
  })

  test("disposes single registrations cleanly and supports re-registration", () => {
    const keymap = getKeymap(renderer)

    keymap.registerLayer({
      bindings: [{ key: "ctrl+d", cmd: "input.delete.line" }],
    })

    const off = registerEditBufferCommands(keymap, renderer)

    expect(keymap.getActiveKeys().some((candidate) => candidate.stroke.name === "d" && candidate.stroke.ctrl)).toBe(
      true,
    )

    off()
    off()

    expect(keymap.getActiveKeys().some((candidate) => candidate.stroke.name === "d" && candidate.stroke.ctrl)).toBe(
      false,
    )

    registerEditBufferCommands(keymap, renderer)

    expect(keymap.getActiveKeys().some((candidate) => candidate.stroke.name === "d" && candidate.stroke.ctrl)).toBe(
      true,
    )

    const textarea = new TextareaRenderable(renderer, {
      width: 20,
      height: 4,
      initialValue: "Line 1\nLine 2\nLine 3",
    })
    renderer.root.add(textarea)

    textarea.focus()
    textarea.gotoLine(1)
    mockInput.pressKey("d", { ctrl: true })

    expect(textarea.plainText).toBe("Line 1\nLine 3")
  })

  test("keeps shared commands registered until the last registration is removed regardless of dispose order", () => {
    const keymap = getKeymap(renderer)

    keymap.registerLayer({
      bindings: [{ key: "ctrl+d", cmd: "input.delete.line" }],
    })

    const textarea = new TextareaRenderable(renderer, {
      width: 20,
      height: 4,
      initialValue: "Line 1\nLine 2\nLine 3",
    })
    renderer.root.add(textarea)

    const offFirst = registerEditBufferCommands(keymap, renderer)
    const offSecond = registerEditBufferCommands(keymap, renderer)

    textarea.focus()
    textarea.gotoLine(1)

    offSecond()
    mockInput.pressKey("d", { ctrl: true })

    expect(textarea.plainText).toBe("Line 1\nLine 3")

    offFirst()
    offSecond()
  })

  test("allows colliding command names on separate layers and continues registering the rest of the batch", () => {
    const keymap = getKeymap(renderer)
    const { errors } = diagnostics.captureDiagnostics(keymap)

    keymap.registerLayer({
      commands: [
        {
          name: "input.delete.line",
          run() {},
        },
      ],
    })
    keymap.registerLayer({
      bindings: [{ key: "x", cmd: "input.submit" }],
    })

    expect(() => {
      registerEditBufferCommands(keymap, renderer)
    }).not.toThrow()

    expect(errors).toEqual([])
    expect(keymap.getCommands().some((command) => command.name === "input.submit")).toBe(true)
    expect(
      keymap.getCommands({ visibility: "registered" }).filter((command) => command.name === "input.delete.line"),
    ).toHaveLength(2)
    expect(keymap.getActiveKeys().find((candidate) => candidate.stroke.name === "x")?.command).toBe("input.submit")
  })
})
