import { test, expect, describe, beforeEach, afterEach, spyOn } from "bun:test"
import { BoxRenderable, type BoxOptions } from "./Box"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"
import type { BorderStyle } from "../lib/border"

let testRenderer: TestRenderer
let renderOnce: () => Promise<void>
let warnSpy: ReturnType<typeof spyOn>

beforeEach(async () => {
  ;({ renderer: testRenderer, renderOnce } = await createTestRenderer({}))
  warnSpy = spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  testRenderer.destroy()
  warnSpy.mockRestore()
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
