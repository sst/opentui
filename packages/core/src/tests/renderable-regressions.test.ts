import { test, expect, beforeEach, afterEach, describe, spyOn } from "bun:test"

import { Renderable, type RenderableOptions } from "../Renderable.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"
import type { RenderContext } from "../types.js"

class HookMovedRenderable extends Renderable {
  constructor(ctx: RenderContext, options: RenderableOptions) {
    super(ctx, options)
  }

  protected renderSelf(): void {}
}

class CountingRenderable extends Renderable {
  public renderCount = 0

  constructor(ctx: RenderContext, options: RenderableOptions) {
    super(ctx, options)
  }

  protected renderSelf(): void {
    this.renderCount += 1
  }
}

class ParentWithVisibleChildrenOverride extends Renderable {
  private visibleChildNums: Set<number> = new Set()

  constructor(ctx: RenderContext, options: RenderableOptions) {
    super(ctx, options)
  }

  public showOnly(...children: Renderable[]): void {
    this.visibleChildNums = new Set(children.map((child) => child.num))
  }

  protected renderSelf(): void {}

  protected _getVisibleChildren(): number[] {
    return this.getChildren()
      .filter((child) => this.visibleChildNums.has(child.num))
      .map((child) => child.num)
  }
}

let testRenderer: TestRenderer
let renderOnce: () => Promise<void>

beforeEach(async () => {
  ;({ renderer: testRenderer, renderOnce } = await createTestRenderer({ width: 20, height: 10 }))
})

afterEach(() => {
  testRenderer.destroy()
})

describe("Renderable regressions", () => {
  test("renderBefore position changes use the updated position for hit-grid writes", async () => {
    const renderable = new HookMovedRenderable(testRenderer, {
      id: "hook-moved",
      position: "absolute",
      left: 0,
      top: 0,
      width: 4,
      height: 2,
    })

    testRenderer.root.add(renderable)

    await renderOnce()

    renderable.renderBefore = function () {
      this.translateX = 5
    }

    const addToHitGridSpy = spyOn(testRenderer, "addToHitGrid")
    renderable.render(testRenderer.currentRenderBuffer, 0)

    expect(renderable.x).toBe(5)
    expect(renderable.screenX).toBe(5)
    expect(addToHitGridSpy).toHaveBeenCalledWith(5, 0, renderable.width, renderable.height, renderable.num)
  })

  test("_getVisibleChildren override alone still filters child rendering", async () => {
    const parent = new ParentWithVisibleChildrenOverride(testRenderer, {
      id: "parent",
      width: 20,
      height: 5,
      flexDirection: "column",
    })
    const visibleChild = new CountingRenderable(testRenderer, {
      id: "visible-child",
      height: 1,
    })
    const hiddenChild = new CountingRenderable(testRenderer, {
      id: "hidden-child",
      height: 1,
    })

    parent.add(visibleChild)
    parent.add(hiddenChild)
    parent.showOnly(visibleChild)
    testRenderer.root.add(parent)

    await renderOnce()

    expect(visibleChild.renderCount).toBeGreaterThan(0)
    expect(hiddenChild.renderCount).toBe(0)
  })
})
