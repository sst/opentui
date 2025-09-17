import { test, expect, beforeEach, afterEach, describe } from "bun:test"
import {
  Renderable,
  BaseRenderable,
  RootRenderable,
  LayoutEvents,
  RenderableEvents,
  type BaseRenderableOptions,
  type RenderableOptions,
} from "../Renderable"
import { createTestRenderer, type TestRenderer, type MockMouse } from "../testing/test-renderer"
import type { RenderContext } from "../types"

export class TestBaseRenderable extends BaseRenderable {
  constructor(options: BaseRenderableOptions) {
    super(options)
  }

  add(obj: BaseRenderable | unknown, index?: number): number {
    throw new Error("Method not implemented.")
  }
  remove(id: string): void {
    throw new Error("Method not implemented.")
  }
  insertBefore(obj: BaseRenderable | unknown, anchor: BaseRenderable | unknown): void {
    throw new Error("Method not implemented.")
  }
  getChildren(): BaseRenderable[] {
    throw new Error("Method not implemented.")
  }
  getChildrenCount(): number {
    throw new Error("Method not implemented.")
  }
  getRenderable(id: string): BaseRenderable | undefined {
    throw new Error("Method not implemented.")
  }
  requestRender(): void {
    throw new Error("Method not implemented.")
  }
}

class TestRenderable extends Renderable {
  constructor(ctx: RenderContext, options: RenderableOptions) {
    super(ctx, options)
  }
}

class TestFocusableRenderable extends Renderable {
  _focusable = true

  constructor(ctx: RenderContext, options: RenderableOptions) {
    super(ctx, options)
  }
}

let testRenderer: TestRenderer
let testMockMouse: MockMouse
let renderOnce: () => Promise<void>

beforeEach(async () => {
  ;({ renderer: testRenderer, mockMouse: testMockMouse, renderOnce } = await createTestRenderer({}))
})

afterEach(() => {
  testRenderer.destroy()
})

describe("BaseRenderable", () => {
  test("creates with default id", () => {
    const renderable = new TestBaseRenderable({})
    expect(renderable.id).toMatch(/^renderable-\d+$/)
    expect(typeof renderable.num).toBe("number")
    expect(renderable.num).toBeGreaterThan(0)
  })

  test("creates with custom id", () => {
    const renderable = new TestBaseRenderable({ id: "custom-id" })
    expect(renderable.id).toBe("custom-id")
  })

  test("has unique numbers", () => {
    const r1 = new TestBaseRenderable({})
    const r2 = new TestBaseRenderable({})
    expect(r1.num).not.toBe(r2.num)
  })

  test("initial visibility state", () => {
    const renderable = new TestBaseRenderable({})
    expect(renderable.visible).toBe(true)
  })

  test("can set visibility", () => {
    const renderable = new TestBaseRenderable({})
    renderable.visible = false
    expect(renderable.visible).toBe(false)
  })
})

describe("Renderable", () => {
  test("creates with basic options", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-renderable" })
    expect(renderable.id).toBe("test-renderable")
    expect(renderable.visible).toBe(true)
    expect(renderable.focusable).toBe(false)
    expect(renderable.zIndex).toBe(0)
    expect(renderable.live).toBe(false)
    expect(renderable.liveCount).toBe(0)
  })

  test("isRenderable", () => {
    const { isRenderable } = require("../Renderable")
    const renderable = new TestBaseRenderable({})
    expect(isRenderable(renderable)).toBe(true)
    expect(isRenderable({})).toBe(false)
    expect(isRenderable(null)).toBe(false)
    expect(isRenderable(undefined)).toBe(false)
  })

  test("creates with width and height", () => {
    const renderable = new TestRenderable(testRenderer, {
      id: "test-size",
      width: 100,
      height: 50,
    })
    expect(renderable.width).toBe(100)
    expect(renderable.height).toBe(50)
  })

  test("throws on invalid width", () => {
    expect(() => {
      new TestRenderable(testRenderer, { width: -10 })
    }).toThrow(TypeError)
  })

  test("throws on invalid height", () => {
    expect(() => {
      new TestRenderable(testRenderer, { width: 100, height: -5 })
    }).toThrow(TypeError)
  })

  test("handles visibility changes", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-visible" })
    expect(renderable.visible).toBe(true)

    renderable.visible = false
    expect(renderable.visible).toBe(false)

    renderable.visible = true
    expect(renderable.visible).toBe(true)
  })

  test("handles live mode", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-live", live: true })
    expect(renderable.live).toBe(true)
    expect(renderable.liveCount).toBe(1)
  })
})

describe("Renderable - Child Management", () => {
  test("can add and remove children", () => {
    const parent = new TestRenderable(testRenderer, { id: "parent" })
    const child1 = new TestRenderable(testRenderer, { id: "child1" })
    const child2 = new TestRenderable(testRenderer, { id: "child2" })

    const index1 = parent.add(child1)
    expect(index1).toBe(0)
    expect(parent.getChildrenCount()).toBe(1)
    expect(parent.getRenderable("child1")).toBe(child1)

    const index2 = parent.add(child2)
    expect(index2).toBe(1)
    expect(parent.getChildrenCount()).toBe(2)

    parent.remove("child1")
    expect(parent.getChildrenCount()).toBe(1)
    expect(parent.getRenderable("child1")).toBeUndefined()
    expect(parent.getRenderable("child2")).toBe(child2)
  })

  test("can insert child at specific index", () => {
    const parent = new TestRenderable(testRenderer, { id: "parent" })
    const child1 = new TestRenderable(testRenderer, { id: "child1" })
    const child2 = new TestRenderable(testRenderer, { id: "child2" })
    const child3 = new TestRenderable(testRenderer, { id: "child3" })

    parent.add(child1)
    parent.add(child2)
    parent.insertBefore(child3, child2)

    const children = parent.getChildren()
    expect(children[0].id).toBe("child1")
    expect(children[1].id).toBe("child3")
    expect(children[2].id).toBe("child2")
  })

  test("handles adding destroyed renderable", () => {
    const parent = new TestRenderable(testRenderer, { id: "parent" })
    const child = new TestRenderable(testRenderer, { id: "child" })
    child.destroy()

    const result = parent.add(child)
    expect(result).toBe(-1)
    expect(parent.getChildrenCount()).toBe(0)
  })
})

describe("Renderable - Events", () => {
  test("handles mouse events", async () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-mouse", left: 0, top: 0, width: 10, height: 10 })
    let mouseCalled = false

    renderable.onMouse = () => {
      mouseCalled = true
    }

    testRenderer.root.add(renderable)
    await renderOnce()

    testMockMouse.click(5, 5)
    expect(mouseCalled).toBe(true)
  })

  test("handles mouse event types", async () => {
    const renderable = new TestRenderable(testRenderer, {
      id: "test-mouse-types",
      left: 0,
      top: 0,
      width: 10,
      height: 10,
    })
    let downCalled = false
    let upCalled = false

    renderable.onMouseDown = () => {
      downCalled = true
    }
    renderable.onMouseUp = () => {
      upCalled = true
    }

    testRenderer.root.add(renderable)
    await renderOnce()

    testMockMouse.pressDown(5, 5)
    expect(downCalled).toBe(true)

    testMockMouse.release(5, 5)
    expect(upCalled).toBe(true)
  })
})

describe("Renderable - Focus", () => {
  test("handles focus when not focusable", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-focus" })
    expect(renderable.focusable).toBe(false)
    expect(renderable.focused).toBe(false)

    renderable.focus()
    expect(renderable.focused).toBe(false)
  })

  test("handles focus when focusable", () => {
    const renderable = new TestFocusableRenderable(testRenderer, { id: "test-focusable" })

    expect(renderable.focusable).toBe(true)
    expect(renderable.focused).toBe(false)

    renderable.focus()
    expect(renderable.focused).toBe(true)

    renderable.blur()
    expect(renderable.focused).toBe(false)
  })

  test("emits focus events", () => {
    const renderable = new TestFocusableRenderable(testRenderer, { id: "test-focus-events" })

    let focused = false
    let blurred = false

    renderable.on(RenderableEvents.FOCUSED, () => {
      focused = true
    })
    renderable.on(RenderableEvents.BLURRED, () => {
      blurred = true
    })

    renderable.focus()
    expect(focused).toBe(true)

    renderable.blur()
    expect(blurred).toBe(true)
  })
})

describe("Renderable - Lifecycle", () => {
  test("handles destroy", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-destroy" })
    expect(renderable.isDestroyed).toBe(false)

    renderable.destroy()
    expect(renderable.isDestroyed).toBe(true)
  })

  test("prevents double destroy", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-double-destroy" })
    renderable.destroy()
    expect(renderable.isDestroyed).toBe(true)

    // Should not throw or cause issues
    renderable.destroy()
    expect(renderable.isDestroyed).toBe(true)
  })

  test("handles recursive destroy", () => {
    const parent = new TestRenderable(testRenderer, { id: "parent-destroy" })
    const child = new TestRenderable(testRenderer, { id: "child-destroy" })
    parent.add(child)

    parent.destroyRecursively()
    expect(parent.isDestroyed).toBe(true)
    expect(child.isDestroyed).toBe(true)
  })
})

describe("RootRenderable", () => {
  test("creates with proper setup", () => {
    const root = new RootRenderable(testRenderer)
    expect(root.id).toBe("__root__")
    expect(root.visible).toBe(true)
    expect(root.width).toBe(testRenderer.width)
    expect(root.height).toBe(testRenderer.height)
  })

  test("handles layout calculation", () => {
    const root = new RootRenderable(testRenderer)
    expect(() => root.calculateLayout()).not.toThrow()
  })

  test("handles resize", async () => {
    const root = testRenderer.root
    const newWidth = 70
    const newHeight = 50

    root.resize(newWidth, newHeight)
    await renderOnce()

    expect(root.width).toBe(newWidth)
    expect(root.height).toBe(newHeight)
  })
})
