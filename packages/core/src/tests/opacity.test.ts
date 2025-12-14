import { test, expect, beforeEach, afterEach, describe } from "bun:test"
import { Renderable, type RenderableOptions } from "../Renderable"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"
import type { RenderContext } from "../types"

class TestRenderable extends Renderable {
  constructor(ctx: RenderContext, options: RenderableOptions) {
    super(ctx, options)
  }
}

let testRenderer: TestRenderer
let renderOnce: () => Promise<void>

beforeEach(async () => {
  ;({ renderer: testRenderer, renderOnce } = await createTestRenderer({}))
})

afterEach(() => {
  testRenderer.destroy()
})

describe("Renderable - Opacity", () => {
  test("defaults to 1.0", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-opacity" })
    expect(renderable.opacity).toBe(1.0)
  })

  test("accepts opacity in constructor options", () => {
    const renderable = new TestRenderable(testRenderer, {
      id: "test-opacity-options",
      opacity: 0.5,
    })
    expect(renderable.opacity).toBe(0.5)
  })

  test("clamps opacity to 0-1 range via setter", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-clamp" })

    renderable.opacity = 1.5
    expect(renderable.opacity).toBe(1.0)

    renderable.opacity = -0.5
    expect(renderable.opacity).toBe(0.0)

    renderable.opacity = 0.7
    expect(renderable.opacity).toBe(0.7)
  })

  test("clamps opacity from constructor options", () => {
    const r1 = new TestRenderable(testRenderer, {
      id: "test-clamp-high",
      opacity: 2.0,
    })
    expect(r1.opacity).toBe(1.0)

    const r2 = new TestRenderable(testRenderer, {
      id: "test-clamp-low",
      opacity: -1,
    })
    expect(r2.opacity).toBe(0.0)
  })

  test("handles opacity of 0 (fully transparent)", async () => {
    const renderable = new TestRenderable(testRenderer, {
      id: "invisible",
      width: 10,
      height: 5,
      opacity: 0,
    })
    testRenderer.root.add(renderable)

    expect(renderable.opacity).toBe(0)

    // Render should not crash with zero opacity
    await renderOnce()
  })

  test("nested renderables maintain independent opacity values", async () => {
    const parent = new TestRenderable(testRenderer, {
      id: "parent",
      width: 20,
      height: 10,
      opacity: 0.5,
    })

    const child = new TestRenderable(testRenderer, {
      id: "child",
      width: 10,
      height: 5,
      opacity: 0.8,
    })

    parent.add(child)
    testRenderer.root.add(parent)
    await renderOnce()

    expect(parent.opacity).toBe(0.5)
    expect(child.opacity).toBe(0.8)
  })

  test("opacity changes trigger render request", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-render" })
    testRenderer.root.add(renderable)

    const initialOpacity = renderable.opacity
    renderable.opacity = 0.3

    expect(renderable.opacity).not.toBe(initialOpacity)
    expect(renderable.opacity).toBe(0.3)
  })

  test("setting same opacity value does not update", () => {
    const renderable = new TestRenderable(testRenderer, {
      id: "test-same",
      opacity: 0.5,
    })

    // Set to same value - should not trigger change
    renderable.opacity = 0.5
    expect(renderable.opacity).toBe(0.5)
  })
})
