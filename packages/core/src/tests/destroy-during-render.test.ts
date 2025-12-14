import { test, expect, beforeEach, afterEach, describe } from "bun:test"
import { Renderable, type RenderableOptions } from "../Renderable"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"
import type { RenderContext } from "../types"
import type { OptimizedBuffer } from "../buffer"

class TestRenderable extends Renderable {
  public renderSelfCalled = false
  public customOnUpdate?: () => void

  constructor(ctx: RenderContext, options: RenderableOptions) {
    super(ctx, options)
  }

  public onUpdate(deltaTime: number): void {
    if (this.customOnUpdate) {
      this.customOnUpdate()
    }
  }

  protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
    this.renderSelfCalled = true
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

describe("Destroy During Render - Actual Bugs", () => {
  test("BUG: destroying self in onUpdate still calls renderSelf", async () => {
    const renderable = new TestRenderable(testRenderer, {
      id: "test",
      width: 100,
      height: 100,
    })

    renderable.customOnUpdate = () => {
      renderable.destroy()
    }

    testRenderer.root.add(renderable)
    await renderOnce()

    expect(renderable.isDestroyed).toBe(true)
    // BUG: renderSelf should NOT be called after destroy in onUpdate
    expect(renderable.renderSelfCalled).toBe(false)
  })

  test("BUG: destroying child in parent's onUpdate, child still renders", async () => {
    const parent = new TestRenderable(testRenderer, {
      id: "parent",
      width: 100,
      height: 100,
    })
    const child = new TestRenderable(testRenderer, {
      id: "child",
      width: 50,
      height: 50,
    })

    parent.add(child)
    testRenderer.root.add(parent)

    parent.customOnUpdate = () => {
      child.destroy()
    }

    await renderOnce()

    expect(child.isDestroyed).toBe(true)
    // BUG: Child should not render if destroyed in parent's onUpdate
    expect(child.renderSelfCalled).toBe(false)
  })

  test("BUG: destroying sibling in onUpdate, sibling still renders", async () => {
    const parent = new TestRenderable(testRenderer, { id: "parent" })
    const child1 = new TestRenderable(testRenderer, {
      id: "child1",
      width: 50,
      height: 50,
    })
    const child2 = new TestRenderable(testRenderer, {
      id: "child2",
      width: 50,
      height: 50,
    })

    parent.add(child1)
    parent.add(child2)
    testRenderer.root.add(parent)

    child1.customOnUpdate = () => {
      child2.destroy()
    }

    await renderOnce()

    expect(child2.isDestroyed).toBe(true)
    // BUG: child2 should not render if destroyed by sibling's onUpdate
    expect(child2.renderSelfCalled).toBe(false)
  })

  test("BUG: destroying sibling in renderBefore, sibling (later in render list) still renders", async () => {
    const parent = new TestRenderable(testRenderer, { id: "parent" })
    const child2 = new TestRenderable(testRenderer, {
      id: "child2",
      width: 50,
      height: 50,
      zIndex: 2,
    })

    const child1 = new TestRenderable(testRenderer, {
      id: "child1",
      width: 50,
      height: 50,
      zIndex: 1,
      renderBefore: function () {
        child2.destroy()
      },
    })

    parent.add(child1)
    parent.add(child2)
    testRenderer.root.add(parent)

    await renderOnce()

    expect(child2.isDestroyed).toBe(true)
    // BUG: child2 should not render since it was destroyed before its turn
    expect(child2.renderSelfCalled).toBe(false)
  })

  test("BUG: onLifecyclePass not called (registration issue)", async () => {
    let lifecyclePassCalled = false

    const renderable = new TestRenderable(testRenderer, { id: "test" })
    renderable.onLifecyclePass = () => {
      lifecyclePassCalled = true
    }

    testRenderer.root.add(renderable)
    await renderOnce()

    // BUG: Lifecycle pass should be called but isn't
    expect(lifecyclePassCalled).toBe(true)
  })
})

describe("Destroy During Render - Working Cases (for documentation)", () => {
  test("WORKS: destroying self in renderAfter", async () => {
    const renderable = new TestRenderable(testRenderer, {
      id: "test",
      width: 100,
      height: 100,
      renderAfter: function () {
        this.destroy()
      },
    })

    testRenderer.root.add(renderable)
    await renderOnce()

    expect(renderable.isDestroyed).toBe(true)
    // renderSelf was already called by this point, which is fine
    expect(renderable.renderSelfCalled).toBe(true)
  })

  test("WORKS: destroying child in renderAfter", async () => {
    const child = new TestRenderable(testRenderer, {
      id: "child",
      width: 50,
      height: 50,
    })

    const parent = new TestRenderable(testRenderer, {
      id: "parent",
      width: 100,
      height: 100,
      renderAfter: function () {
        child.destroy()
      },
    })

    parent.add(child)
    testRenderer.root.add(parent)

    await renderOnce()

    expect(child.isDestroyed).toBe(true)
    // Child already rendered before parent's renderAfter, which is expected
  })
})
