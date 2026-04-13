import { test, expect, describe, beforeEach, afterEach, spyOn } from "bun:test"
import { BoxRenderable, type BoxOptions } from "./Box.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"
import type { BorderStyle } from "../lib/border.js"

let testRenderer: TestRenderer
let renderOnce: () => Promise<void>
let captureFrame: () => string
let warnSpy: ReturnType<typeof spyOn>

beforeEach(async () => {
  ;({ renderer: testRenderer, renderOnce, captureCharFrame: captureFrame } = await createTestRenderer({}))
  warnSpy = spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  testRenderer.destroy()
  warnSpy.mockRestore()
})

describe("BoxRenderable - focusable option", () => {
  test("is not focusable by default", async () => {
    const box = new BoxRenderable(testRenderer, {
      id: "test-box",
      width: 10,
      height: 5,
    })

    expect(box.focusable).toBe(false)
    box.focus()
    expect(box.focused).toBe(false)
  })

  test("can be made focusable via option", async () => {
    const box = new BoxRenderable(testRenderer, {
      id: "test-box",
      focusable: true,
      width: 10,
      height: 5,
    })

    expect(box.focusable).toBe(true)
    box.focus()
    expect(box.focused).toBe(true)
  })
})

describe("BoxRenderable - borderStyle validation", () => {
  describe("regression: invalid borderStyle via constructor does not crash", () => {
    test("handles invalid string borderStyle in constructor", async () => {
      const box = new BoxRenderable(testRenderer, {
        id: "test-box",
        borderStyle: "invalid-style" as BorderStyle,
        border: true,
        width: 10,
        height: 5,
      })

      testRenderer.root.add(box)
      await renderOnce()

      expect(box.borderStyle).toBe("single")
      expect(box.isDestroyed).toBe(false)
    })

    test("handles undefined borderStyle in constructor", async () => {
      const box = new BoxRenderable(testRenderer, {
        id: "test-box",
        borderStyle: undefined,
        border: true,
        width: 10,
        height: 5,
      })

      testRenderer.root.add(box)
      await renderOnce()

      expect(box.borderStyle).toBe("single")
      expect(box.isDestroyed).toBe(false)
    })
  })

  describe("regression: invalid borderStyle via setter does not crash", () => {
    test("handles invalid string borderStyle via setter", async () => {
      const box = new BoxRenderable(testRenderer, {
        id: "test-box",
        borderStyle: "double",
        border: true,
        width: 10,
        height: 5,
      })

      testRenderer.root.add(box)
      await renderOnce()

      expect(box.borderStyle).toBe("double")

      box.borderStyle = "invalid-style" as BorderStyle
      await renderOnce()

      expect(box.borderStyle).toBe("single")
      expect(box.isDestroyed).toBe(false)
    })

    test("renders correctly after fallback from invalid borderStyle", async () => {
      const box = new BoxRenderable(testRenderer, {
        id: "test-box",
        borderStyle: "invalid" as BorderStyle,
        border: true,
        width: 10,
        height: 5,
      })

      testRenderer.root.add(box)

      // Should not throw during render
      await expect(renderOnce()).resolves.toBeUndefined()
      expect(box.isDestroyed).toBe(false)
    })
  })

  describe("valid borderStyle values work correctly", () => {
    test.each(["single", "double", "rounded", "heavy"] as BorderStyle[])(
      "accepts valid borderStyle '%s' in constructor",
      async (style) => {
        const box = new BoxRenderable(testRenderer, {
          id: "test-box",
          borderStyle: style,
          border: true,
          width: 10,
          height: 5,
        })

        testRenderer.root.add(box)
        await renderOnce()

        expect(box.borderStyle).toBe(style)
      },
    )

    test.each(["single", "double", "rounded", "heavy"] as BorderStyle[])(
      "accepts valid borderStyle '%s' via setter",
      async (style) => {
        const box = new BoxRenderable(testRenderer, {
          id: "test-box",
          border: true,
          width: 10,
          height: 5,
        })

        testRenderer.root.add(box)
        await renderOnce()

        box.borderStyle = style
        await renderOnce()

        expect(box.borderStyle).toBe(style)
      },
    )
  })
})

describe("BoxRenderable - border titles (top and bottom)", () => {
  test("renders top and bottom titles on their respective borders", async () => {
    const box = new BoxRenderable(testRenderer, {
      id: "border-title-box",
      border: true,
      width: 16,
      height: 5,
      title: "Top",
      titleAlignment: "left",
      bottomTitle: "Bot",
      bottomTitleAlignment: "right",
    })

    testRenderer.root.add(box)
    await renderOnce()

    const lines = captureFrame().split("\n")

    expect(lines[0].slice(0, 16)).toBe("┌─Top──────────┐")
    expect(lines[4].slice(0, 16)).toBe("└──────────Bot─┘")
  })

  test.each([
    ["left", "└─Bot────────────┘"],
    ["center", "└──────Bot───────┘"],
    ["right", "└────────────Bot─┘"],
  ] as const)("renders bottom title with %s alignment", async (alignment, expectedBorder) => {
    const box = new BoxRenderable(testRenderer, {
      id: `bottom-title-${alignment}`,
      border: true,
      width: 18,
      height: 5,
      bottomTitle: "Bot",
      bottomTitleAlignment: alignment,
    })

    testRenderer.root.add(box)
    await renderOnce()

    const lines = captureFrame().split("\n")
    expect(lines[4].slice(0, 18)).toBe(expectedBorder)
  })
})

describe("BoxRenderable - focus-within", () => {
  test("hasFocusedDescendant is false initially", async () => {
    const parent = new BoxRenderable(testRenderer, {
      id: "parent",
      focusable: true,
      border: true,
      width: 10,
      height: 5,
    })
    const child = new BoxRenderable(testRenderer, {
      id: "child",
      focusable: true,
      width: 5,
      height: 3,
    })

    parent.add(child)
    testRenderer.root.add(parent)
    await renderOnce()

    expect(parent.hasFocusedDescendant).toBe(false)
  })

  test("hasFocusedDescendant becomes true when child is focused", async () => {
    const parent = new BoxRenderable(testRenderer, {
      id: "parent",
      focusable: true,
      border: true,
      width: 10,
      height: 5,
    })
    const child = new BoxRenderable(testRenderer, {
      id: "child",
      focusable: true,
      width: 5,
      height: 3,
    })

    parent.add(child)
    testRenderer.root.add(parent)
    await renderOnce()

    child.focus()

    expect(child.focused).toBe(true)
    expect(parent.hasFocusedDescendant).toBe(true)
  })

  test("hasFocusedDescendant becomes false when child is blurred", async () => {
    const parent = new BoxRenderable(testRenderer, {
      id: "parent",
      focusable: true,
      border: true,
      width: 10,
      height: 5,
    })
    const child = new BoxRenderable(testRenderer, {
      id: "child",
      focusable: true,
      width: 5,
      height: 3,
    })

    parent.add(child)
    testRenderer.root.add(parent)
    await renderOnce()

    child.focus()
    expect(parent.hasFocusedDescendant).toBe(true)

    child.blur()
    expect(parent.hasFocusedDescendant).toBe(false)
  })

  test("propagates up the ancestor chain", async () => {
    const grandparent = new BoxRenderable(testRenderer, {
      id: "grandparent",
      focusable: true,
      border: true,
      width: 20,
      height: 10,
    })
    const parent = new BoxRenderable(testRenderer, {
      id: "parent",
      focusable: true,
      width: 15,
      height: 8,
    })
    const child = new BoxRenderable(testRenderer, {
      id: "child",
      focusable: true,
      width: 5,
      height: 3,
    })

    grandparent.add(parent)
    parent.add(child)
    testRenderer.root.add(grandparent)
    await renderOnce()

    child.focus()

    expect(parent.hasFocusedDescendant).toBe(true)
    expect(grandparent.hasFocusedDescendant).toBe(true)
  })
})

describe("BoxRenderable - no-op rendering", () => {
  test("skips drawBox for transparent layout-only boxes", () => {
    const box = new BoxRenderable(testRenderer, {
      id: "layout-only",
      width: 10,
      height: 5,
    })

    let called = false
    const buffer = {
      drawBox() {
        called = true
      },
    }

    ;(box as any).renderSelf(buffer)
    expect(called).toBe(false)
  })

  test("still draws boxes with a visible fill", () => {
    const box = new BoxRenderable(testRenderer, {
      id: "filled-box",
      width: 10,
      height: 5,
      backgroundColor: "#112233",
    })

    let called = false
    const buffer = {
      drawBox() {
        called = true
      },
    }

    ;(box as any).renderSelf(buffer)
    expect(called).toBe(true)
  })

  test("still draws boxes with borders", () => {
    const box = new BoxRenderable(testRenderer, {
      id: "bordered-box",
      width: 10,
      height: 5,
      border: true,
    })

    let called = false
    const buffer = {
      drawBox() {
        called = true
      },
    }

    ;(box as any).renderSelf(buffer)
    expect(called).toBe(true)
  })
})
