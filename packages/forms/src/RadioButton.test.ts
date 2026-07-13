import { test, expect, beforeEach, afterEach, describe } from "bun:test"
import { RadioButtonRenderable, type RadioButtonRenderableOptions, RadioButtonRenderableEvents } from "./RadioButton.js"
import { createTestRenderer, type MockInput, type TestRenderer } from "@opentui/core/testing"
import { KeyEvent } from "@opentui/core"

function createKeyEvent(input: string | { name: string; shift?: boolean; ctrl?: boolean; meta?: boolean }): KeyEvent {
  if (typeof input === "string") {
    return new KeyEvent({
      name: input,
      sequence: input === "space" ? " " : input,
      ctrl: false,
      meta: false,
      shift: false,
      option: false,
      number: false,
      raw: input,
      eventType: "press",
      source: "raw",
    })
  }
  return new KeyEvent({
    name: input.name,
    sequence: input.name === "space" ? " " : input.name,
    ctrl: input.ctrl ?? false,
    meta: input.meta ?? false,
    shift: input.shift ?? false,
    option: false,
    number: false,
    raw: input.name,
    eventType: "press",
    source: "raw",
  })
}

let currentRenderer: TestRenderer
let currentMockInput: MockInput
let renderOnce: () => Promise<void>

function makeBtn(options: Partial<RadioButtonRenderableOptions> & { group?: string } = {}): RadioButtonRenderable {
  const btn = new RadioButtonRenderable(currentRenderer, {
    label: "Option",
    value: "opt",
    width: 20,
    height: 1,
    left: 0,
    top: 0,
    ...options,
  })
  currentRenderer.root.add(btn)
  return btn
}

beforeEach(async () => {
  ;({ renderer: currentRenderer, mockInput: currentMockInput, renderOnce } = await createTestRenderer({}))
})

afterEach(() => {
  currentRenderer.destroy()
})

describe("RadioButtonRenderable", () => {
  describe("Initialization", () => {
    test("defaults to unchecked classic design", () => {
      const btn = makeBtn()
      expect(btn.checked).toBe(false)
      expect(btn.design).toBe("classic")
      expect(btn.label).toBe("Option")
      expect(btn.value).toBe("opt")
      expect(btn.focusable).toBe(true)
    })

    test("respects checked: true option", () => {
      const btn = makeBtn({ checked: true })
      expect(btn.checked).toBe(true)
    })

    test("respects custom design", () => {
      const btn = makeBtn({ design: "filled" })
      expect(btn.design).toBe("filled")
    })

    test("respects custom tuple design", () => {
      const btn = makeBtn({ design: ["-", "+"] })
      expect(btn.design).toEqual(["-", "+"])
    })

    test("group accessor returns group name", () => {
      const btn = makeBtn({ group: "my-group" })
      expect(btn.group).toBe("my-group")
    })

    test("group accessor returns undefined when no group", () => {
      const btn = makeBtn()
      expect(btn.group).toBeUndefined()
    })
  })

  describe("select / deselect", () => {
    test("select sets checked to true", () => {
      const btn = makeBtn()
      expect(btn.checked).toBe(false)
      btn.select()
      expect(btn.checked).toBe(true)
    })

    test("deselect sets checked to false", () => {
      const btn = makeBtn({ checked: true })
      btn.deselect()
      expect(btn.checked).toBe(false)
    })

    test("select emits SELECTED every time", () => {
      const btn = makeBtn({ checked: true })
      let count = 0
      btn.on(RadioButtonRenderableEvents.SELECTED, () => count++)
      btn.select()
      btn.select()
      expect(count).toBe(2)
    })

    test("select emits CHANGED only when transitioning to checked", () => {
      const btn = makeBtn()
      const changes: boolean[] = []
      btn.on(RadioButtonRenderableEvents.CHANGED, (v: boolean) => changes.push(v))
      btn.select()
      btn.select()
      expect(changes).toEqual([true])
    })

    test("deselect emits CHANGED only when transitioning to unchecked", () => {
      const btn = makeBtn({ checked: true })
      const changes: boolean[] = []
      btn.on(RadioButtonRenderableEvents.CHANGED, (v: boolean) => changes.push(v))
      btn.deselect()
      btn.deselect()
      expect(changes).toEqual([false])
    })
  })

  describe("checked setter", () => {
    test("setting true calls select()", () => {
      const btn = makeBtn()
      btn.checked = true
      expect(btn.checked).toBe(true)
    })

    test("setting false calls deselect()", () => {
      const btn = makeBtn({ checked: true })
      btn.checked = false
      expect(btn.checked).toBe(false)
    })

    test("setting true enforces mutual exclusion within group", () => {
      const a = makeBtn({ group: "setter-group", checked: true })
      const b = makeBtn({ group: "setter-group", checked: false })
      b.checked = true
      expect(a.checked).toBe(false)
      expect(b.checked).toBe(true)
    })
  })

  describe("Group mutual exclusion", () => {
    test("selecting one button deselects siblings", () => {
      const a = makeBtn({ group: "g1", checked: true })
      const b = makeBtn({ group: "g1" })
      const c = makeBtn({ group: "g1" })
      b.select()
      expect(a.checked).toBe(false)
      expect(b.checked).toBe(true)
      expect(c.checked).toBe(false)
    })

    test("buttons in different groups are independent", () => {
      const a = makeBtn({ group: "ga", checked: true })
      const b = makeBtn({ group: "gb", checked: true })
      a.select()
      expect(a.checked).toBe(true)
      expect(b.checked).toBe(true)
    })

    test("ungrouped buttons do not affect each other", () => {
      const a = makeBtn({ checked: true })
      const b = makeBtn()
      b.select()
      expect(a.checked).toBe(true)
      expect(b.checked).toBe(true)
    })

    test("getSelected returns the checked button", () => {
      const a = makeBtn({ group: "gs", checked: true, value: "a" })
      const b = makeBtn({ group: "gs", value: "b" })
      expect(RadioButtonRenderable.getSelected(currentRenderer, "gs")).toBe(a)
      b.select()
      expect(RadioButtonRenderable.getSelected(currentRenderer, "gs")).toBe(b)
    })

    test("getSelectedValue returns value of checked button", () => {
      makeBtn({ group: "gv", checked: false, value: "x" })
      const b = makeBtn({ group: "gv", checked: true, value: "y" })
      expect(RadioButtonRenderable.getSelectedValue(currentRenderer, "gv")).toBe("y")
      b.deselect()
      expect(RadioButtonRenderable.getSelectedValue(currentRenderer, "gv")).toBeNull()
    })

    test("getSelected returns null for unknown group", () => {
      expect(RadioButtonRenderable.getSelected(currentRenderer, "nonexistent")).toBeNull()
    })
  })

  describe("initial selection", () => {
    test("last registered checked button wins", () => {
      const a = makeBtn({ group: "init", checked: true, value: "a" })
      const b = makeBtn({ group: "init", checked: true, value: "b" })
      const c = makeBtn({ group: "init", checked: true, value: "c" })
      expect(a.checked).toBe(false)
      expect(b.checked).toBe(false)
      expect(c.checked).toBe(true)
      expect(RadioButtonRenderable.getSelected(currentRenderer, "init")).toBe(c)
    })

    test("single checked button stays selected", () => {
      makeBtn({ group: "init1", value: "a" })
      const b = makeBtn({ group: "init1", checked: true, value: "b" })
      expect(b.checked).toBe(true)
      expect(RadioButtonRenderable.getSelected(currentRenderer, "init1")).toBe(b)
    })

    test("no button selected when none checked", () => {
      makeBtn({ group: "init2", value: "a" })
      makeBtn({ group: "init2", value: "b" })
      expect(RadioButtonRenderable.getSelected(currentRenderer, "init2")).toBeNull()
    })

    test("does not emit events during construction", () => {
      const a = makeBtn({ group: "init3", checked: true, value: "a" })
      let changed = 0
      let selected = 0
      a.on(RadioButtonRenderableEvents.CHANGED, () => changed++)
      a.on(RadioButtonRenderableEvents.SELECTED, () => selected++)

      // Constructing a later checked sibling displaces `a` silently.
      const b = makeBtn({ group: "init3", checked: true, value: "b" })

      expect(a.checked).toBe(false)
      expect(b.checked).toBe(true)
      expect(changed).toBe(0)
      expect(selected).toBe(0)
    })
  })

  describe("moveUp/moveDown", () => {
    test("moveDown transfers focus and checked state to next sibling", () => {
      const a = makeBtn({ group: "nav1", checked: true })
      const b = makeBtn({ group: "nav1" })
      a.focus()
      a.moveDown()
      expect(a.checked).toBe(false)
      expect(b.checked).toBe(true)
      expect(b.focused).toBe(true)
      expect(a.focused).toBe(false)
    })

    test("moveUp transfers focus and checked state to previous sibling", () => {
      const a = makeBtn({ group: "nav2" })
      const b = makeBtn({ group: "nav2", checked: true })
      b.focus()
      b.moveUp()
      expect(b.checked).toBe(false)
      expect(a.checked).toBe(true)
      expect(a.focused).toBe(true)
    })

    test("moveUp does nothing at first sibling", () => {
      const a = makeBtn({ group: "nav3", checked: true })
      makeBtn({ group: "nav3" })
      a.focus()
      a.moveUp()
      expect(a.checked).toBe(true)
      expect(a.focused).toBe(true)
    })

    test("moveDown does nothing at last sibling", () => {
      makeBtn({ group: "nav4" })
      const b = makeBtn({ group: "nav4", checked: true })
      b.focus()
      b.moveDown()
      expect(b.checked).toBe(true)
      expect(b.focused).toBe(true)
    })

    test("moveUp/moveDown are no-ops without a group", () => {
      const btn = makeBtn({ checked: true })
      btn.focus()
      btn.moveUp()
      btn.moveDown()
      expect(btn.checked).toBe(true)
    })
  })

  describe("Keyboard interaction", () => {
    test("Space selects the button", () => {
      const btn = makeBtn()
      btn.focus()
      expect(btn.handleKeyPress(createKeyEvent("space"))).toBe(true)
      expect(btn.checked).toBe(true)
    })

    test("Enter selects the button", () => {
      const btn = makeBtn()
      btn.focus()
      expect(btn.handleKeyPress(createKeyEvent("return"))).toBe(true)
      expect(btn.checked).toBe(true)
    })

    test("Up arrow calls moveUp", () => {
      const a = makeBtn({ group: "kb1", checked: false })
      const b = makeBtn({ group: "kb1", checked: true })
      b.focus()
      expect(b.handleKeyPress(createKeyEvent("up"))).toBe(true)
      expect(a.checked).toBe(true)
      expect(b.checked).toBe(false)
    })

    test("Down arrow calls moveDown", () => {
      const a = makeBtn({ group: "kb2", checked: true })
      const b = makeBtn({ group: "kb2", checked: false })
      a.focus()
      expect(a.handleKeyPress(createKeyEvent("down"))).toBe(true)
      expect(b.checked).toBe(true)
      expect(a.checked).toBe(false)
    })

    test("unhandled keys return false", () => {
      const btn = makeBtn()
      btn.focus()
      expect(btn.handleKeyPress(createKeyEvent("x"))).toBe(false)
      expect(btn.checked).toBe(false)
    })

    test("custom key bindings work", () => {
      const btn = makeBtn({ keyBindings: [{ name: "s", action: "select" }] })
      btn.focus()
      expect(btn.handleKeyPress(createKeyEvent("s"))).toBe(true)
      expect(btn.checked).toBe(true)
    })
  })

  describe("Property setters", () => {
    test("label setter updates label", () => {
      const btn = makeBtn()
      btn.label = "Updated"
      expect(btn.label).toBe("Updated")
    })

    test("value setter updates value", () => {
      const btn = makeBtn()
      btn.value = 42
      expect(btn.value).toBe(42)
    })

    test("design setter updates design", () => {
      const btn = makeBtn()
      btn.design = "arrow"
      expect(btn.design).toBe("arrow")
    })

    test("design setter accepts custom tuple", () => {
      const btn = makeBtn()
      btn.design = ["○", "●"]
      expect(btn.design).toEqual(["○", "●"])
    })

    test("color setters do not throw", () => {
      const btn = makeBtn()
      expect(() => {
        btn.backgroundColor = "#ff0000"
        btn.textColor = "#00ff00"
        btn.focusedBackgroundColor = "#0000ff"
        btn.focusedTextColor = "#ffff00"
        btn.checkedTextColor = "#ffffff"
      }).not.toThrow()
    })
  })

  describe("destroy", () => {
    test("removes button from group on destroy", () => {
      const a = makeBtn({ group: "destroy-test", checked: true })
      makeBtn({ group: "destroy-test" })
      a.destroy()
      expect(RadioButtonRenderable.getSelected(currentRenderer, "destroy-test")).not.toBe(a)
    })

    test("removes group entry when last button is destroyed", () => {
      const a = makeBtn({ group: "last-btn", checked: true })
      a.destroy()
      expect(RadioButtonRenderable.getSelected(currentRenderer, "last-btn")).toBeNull()
    })
  })

  describe("renderer scoping", () => {
    test("same-named groups in different renderers are isolated", async () => {
      const { renderer: otherRenderer } = await createTestRenderer({})
      try {
        const a = new RadioButtonRenderable(currentRenderer, { value: "a", group: "shared", checked: true })
        const b = new RadioButtonRenderable(otherRenderer, { value: "b", group: "shared", checked: true })

        // Selecting in one renderer must not deselect the other renderer's button.
        a.select()
        expect(a.checked).toBe(true)
        expect(b.checked).toBe(true)

        expect(RadioButtonRenderable.getSelected(currentRenderer, "shared")).toBe(a)
        expect(RadioButtonRenderable.getSelected(otherRenderer, "shared")).toBe(b)
      } finally {
        otherRenderer.destroy()
      }
    })
  })

  describe("group setter", () => {
    test("moves button between groups", () => {
      const a = makeBtn({ group: "src", value: "a" })
      makeBtn({ group: "dst", value: "b" })
      a.group = "dst"
      expect(a.group).toBe("dst")
      expect(RadioButtonRenderable.getSelected(currentRenderer, "src")).toBeNull()
    })

    test("moving a checked button deselects existing selection in target group", () => {
      const a = makeBtn({ group: "src", value: "a", checked: true })
      const b = makeBtn({ group: "dst", value: "b", checked: true })
      a.group = "dst"
      expect(a.checked).toBe(true)
      expect(b.checked).toBe(false)
      expect(RadioButtonRenderable.getSelected(currentRenderer, "dst")).toBe(a)
    })

    test("leaving a group keeps the button's own checked state", () => {
      const a = makeBtn({ group: "src", value: "a", checked: true })
      a.group = undefined
      expect(a.group).toBeUndefined()
      expect(a.checked).toBe(true)
      expect(RadioButtonRenderable.getSelected(currentRenderer, "src")).toBeNull()
    })

    test("setting the same group is a no-op", () => {
      const a = makeBtn({ group: "same", value: "a", checked: true })
      a.group = "same"
      expect(a.checked).toBe(true)
      expect(RadioButtonRenderable.getSelected(currentRenderer, "same")).toBe(a)
    })
  })

  describe("Focus", () => {
    test("focus/blur state", () => {
      const btn = makeBtn()
      expect(btn.focused).toBe(false)
      btn.focus()
      expect(btn.focused).toBe(true)
      btn.blur()
      expect(btn.focused).toBe(false)
    })
  })
})
