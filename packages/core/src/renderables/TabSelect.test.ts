import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import {
  TabSelectRenderable,
  type TabSelectRenderableOptions,
  TabSelectRenderableEvents,
  type TabSelectOption,
} from "./TabSelect"
import { createTestRenderer, type MockInput, type TestRenderer } from "../testing/test-renderer"

let currentRenderer: TestRenderer
let currentMockInput: MockInput
let renderOnce: () => Promise<void>

const sampleOptions: TabSelectOption[] = [
  { name: "Tab 1", description: "First tab" },
  { name: "Tab 2", description: "Second tab" },
  { name: "Tab 3", description: "Third tab" },
  { name: "Tab 4", description: "Fourth tab" },
  { name: "Tab 5", description: "Fifth tab" },
]

async function createTabSelectRenderable(
  renderer: TestRenderer,
  options: TabSelectRenderableOptions,
): Promise<{ tabSelect: TabSelectRenderable; root: any }> {
  const tabSelectRenderable = new TabSelectRenderable(renderer, { left: 0, top: 0, ...options })
  renderer.root.add(tabSelectRenderable)
  await renderOnce()

  return { tabSelect: tabSelectRenderable, root: renderer.root }
}

beforeEach(async () => {
  ;({ renderer: currentRenderer, mockInput: currentMockInput, renderOnce } = await createTestRenderer({}))
})

afterEach(() => {
  currentRenderer.destroy()
})

describe("TabSelectRenderable", () => {
  describe("Key Bindings and Aliases", () => {
    test("should support custom key bindings", async () => {
      const { tabSelect } = await createTabSelectRenderable(currentRenderer, {
        width: 100,
        options: sampleOptions,
        keyBindings: [
          { name: "h", action: "move-left" },
          { name: "l", action: "move-right" },
        ],
      })

      tabSelect.focus()
      expect(tabSelect.getSelectedIndex()).toBe(0)

      // L should move right
      currentMockInput.pressKey("l")
      expect(tabSelect.getSelectedIndex()).toBe(1)

      // H should move left
      currentMockInput.pressKey("h")
      expect(tabSelect.getSelectedIndex()).toBe(0)
    })

    test("should support key aliases", async () => {
      const { tabSelect } = await createTabSelectRenderable(currentRenderer, {
        width: 100,
        options: sampleOptions,
        keyAliasMap: {
          enter: "return",
        },
      })

      tabSelect.focus()
      tabSelect.setSelectedIndex(1)

      let itemSelected = false
      tabSelect.on(TabSelectRenderableEvents.ITEM_SELECTED, () => {
        itemSelected = true
      })

      currentMockInput.pressEnter()
      expect(itemSelected).toBe(true)
    })

    test("should merge custom bindings with defaults", async () => {
      const { tabSelect } = await createTabSelectRenderable(currentRenderer, {
        width: 100,
        options: sampleOptions,
        keyBindings: [{ name: "n", action: "move-right" }],
      })

      tabSelect.focus()
      expect(tabSelect.getSelectedIndex()).toBe(0)

      // Default binding should still work
      currentMockInput.pressArrow("right")
      expect(tabSelect.getSelectedIndex()).toBe(1)

      // Custom binding should also work
      currentMockInput.pressKey("n")
      expect(tabSelect.getSelectedIndex()).toBe(2)
    })

    test("should override default bindings with custom ones", async () => {
      const { tabSelect } = await createTabSelectRenderable(currentRenderer, {
        width: 100,
        options: sampleOptions,
        keyBindings: [
          { name: "[", action: "move-right" }, // Override [ to move right instead of left
        ],
      })

      tabSelect.focus()
      expect(tabSelect.getSelectedIndex()).toBe(0)

      // [ should now move right instead of left
      currentMockInput.pressKey("[")
      expect(tabSelect.getSelectedIndex()).toBe(1)
    })

    test("should allow updating key bindings dynamically", async () => {
      const { tabSelect } = await createTabSelectRenderable(currentRenderer, {
        width: 100,
        options: sampleOptions,
      })

      tabSelect.focus()
      expect(tabSelect.getSelectedIndex()).toBe(0)

      // Move right with default binding
      currentMockInput.pressArrow("right")
      expect(tabSelect.getSelectedIndex()).toBe(1)

      // Update bindings
      tabSelect.keyBindings = [{ name: "space", action: "move-right" }]

      // Space should now move right
      currentMockInput.pressKey(" ")
      expect(tabSelect.getSelectedIndex()).toBe(2)
    })

    test("should handle modifiers in custom bindings", async () => {
      const { tabSelect } = await createTabSelectRenderable(currentRenderer, {
        width: 100,
        options: sampleOptions,
        keyBindings: [
          { name: "left", ctrl: true, action: "move-right" },
          { name: "right", ctrl: true, action: "move-left" },
        ],
      })

      tabSelect.focus()
      tabSelect.setSelectedIndex(2)

      // Ctrl+Right should move left
      currentMockInput.pressArrow("right", { ctrl: true })
      expect(tabSelect.getSelectedIndex()).toBe(1)

      // Ctrl+Left should move right
      currentMockInput.pressArrow("left", { ctrl: true })
      expect(tabSelect.getSelectedIndex()).toBe(2)
    })

    test("should handle wrap selection with custom bindings", async () => {
      const { tabSelect } = await createTabSelectRenderable(currentRenderer, {
        width: 100,
        options: sampleOptions,
        wrapSelection: true,
        keyBindings: [
          { name: "n", action: "move-right" },
          { name: "p", action: "move-left" },
        ],
      })

      tabSelect.focus()
      expect(tabSelect.getSelectedIndex()).toBe(0)

      // P should wrap to end
      currentMockInput.pressKey("p")
      expect(tabSelect.getSelectedIndex()).toBe(4)

      // N should wrap to start
      currentMockInput.pressKey("n")
      expect(tabSelect.getSelectedIndex()).toBe(0)
    })
  })
})
