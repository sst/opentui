import { test, expect, beforeEach, afterEach, describe, spyOn } from "bun:test"
import {
  Renderable,
  BaseRenderable,
  RootRenderable,
  RenderableEvents,
  type BaseRenderableOptions,
  type RenderableOptions,
} from "../Renderable"
import { createTestRenderer, type TestRenderer, type MockMouse, type MockInput } from "../testing/test-renderer"
import type { RenderContext } from "../types"
import { TextNodeRenderable } from "../renderables/TextNode"
import { TextRenderable } from "../renderables/Text"

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
  findDescendantById(id: string): BaseRenderable | undefined {
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
let testMockInput: MockInput
let renderOnce: () => Promise<void>

beforeEach(async () => {
  ;({
    renderer: testRenderer,
    mockMouse: testMockMouse,
    mockInput: testMockInput,
    renderOnce,
  } = await createTestRenderer({}))
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

  test("insertBefore makes new child accessible", () => {
    const parent = new TestRenderable(testRenderer, { id: "parent" })
    const child1 = new TestRenderable(testRenderer, { id: "child1" })
    const child2 = new TestRenderable(testRenderer, { id: "child2" })
    const newChild = new TestRenderable(testRenderer, { id: "newChild" })

    parent.add(child1)
    parent.add(child2)
    parent.insertBefore(newChild, child2)

    expect(parent.getRenderable("newChild")).toBe(newChild)
  })

  test("handles adding destroyed renderable", () => {
    const parent = new TestRenderable(testRenderer, { id: "parent" })
    const child = new TestRenderable(testRenderer, { id: "child" })
    child.destroy()

    const result = parent.add(child)
    expect(result).toBe(-1)
    expect(parent.getChildrenCount()).toBe(0)
  })

  test("can change renderable id and updates parent mapping", () => {
    const parent = new TestRenderable(testRenderer, { id: "parent" })
    const child = new TestRenderable(testRenderer, { id: "child" })

    parent.add(child)
    expect(parent.getRenderable("child")).toBe(child)

    // Change the child's id
    child.id = "new-child-id"
    expect(child.id).toBe("new-child-id")

    // Verify parent mapping is updated
    expect(parent.getRenderable("child")).toBeUndefined()
    expect(parent.getRenderable("new-child-id")).toBe(child)
  })

  test("findDescendantById finds direct children", () => {
    const parent = new TestRenderable(testRenderer, { id: "parent" })
    const child1 = new TestRenderable(testRenderer, { id: "child1" })
    const child2 = new TestRenderable(testRenderer, { id: "child2" })

    parent.add(child1)
    parent.add(child2)

    expect(parent.findDescendantById("child1")).toBe(child1)
    expect(parent.findDescendantById("child2")).toBe(child2)
    expect(parent.findDescendantById("nonexistent")).toBeUndefined()
  })

  test("findDescendantById finds nested descendants", () => {
    const parent = new TestRenderable(testRenderer, { id: "parent" })
    const child1 = new TestRenderable(testRenderer, { id: "child1" })
    const child2 = new TestRenderable(testRenderer, { id: "child2" })
    const grandchild = new TestRenderable(testRenderer, { id: "grandchild" })

    parent.add(child1)
    parent.add(child2)
    child1.add(grandchild)

    expect(parent.findDescendantById("grandchild")).toBe(grandchild)
    expect(parent.findDescendantById("child1")).toBe(child1)
    expect(parent.findDescendantById("child2")).toBe(child2)
  })

  test("findDescendantById handles TextNodeRenderable children without crashing", () => {
    const parent = new TestRenderable(testRenderer, { id: "parent" })
    const child1 = new TestRenderable(testRenderer, { id: "child1" })
    const child2 = new TestRenderable(testRenderer, { id: "child2" })
    const child3 = new TextRenderable(testRenderer, { id: "child3" })
    const textNode = new TextNodeRenderable({ id: "text-node" })

    parent.add(child1)
    child1.add(child2)
    child2.add(child3)
    child3.add(textNode)

    expect(parent.findDescendantById("child1")).toBe(child1)
    expect(parent.findDescendantById("child2")).toBe(child2)
    expect(parent.findDescendantById("text-node")).toBeUndefined()
  })

  test("destroyRecursively destroys nested children recursively", () => {
    const parent = new TestRenderable(testRenderer, { id: "parent" })
    const child = new TestRenderable(testRenderer, { id: "child" })
    const grandchild = new TestRenderable(testRenderer, { id: "grandchild" })
    const greatGrandchild = new TestRenderable(testRenderer, { id: "greatGrandchild" })

    parent.add(child)
    child.add(grandchild)
    grandchild.add(greatGrandchild)

    expect(parent.isDestroyed).toBe(false)
    expect(child.isDestroyed).toBe(false)
    expect(grandchild.isDestroyed).toBe(false)
    expect(greatGrandchild.isDestroyed).toBe(false)

    parent.destroyRecursively()

    expect(parent.isDestroyed).toBe(true)
    expect(child.isDestroyed).toBe(true)
    expect(grandchild.isDestroyed).toBe(true)
    expect(greatGrandchild.isDestroyed).toBe(true)
  })

  test("destroyRecursively handles empty renderable without errors", () => {
    const parent = new TestRenderable(testRenderer, { id: "empty-parent" })

    expect(parent.isDestroyed).toBe(false)
    expect(() => parent.destroyRecursively()).not.toThrow()
    expect(parent.isDestroyed).toBe(true)
  })

  test("destroyRecursively destroys all children correctly with multiple children", () => {
    const parent = new TestRenderable(testRenderer, { id: "parent" })
    const child1 = new TestRenderable(testRenderer, { id: "child1" })
    const child2 = new TestRenderable(testRenderer, { id: "child2" })
    const child3 = new TestRenderable(testRenderer, { id: "child3" })

    parent.add(child1)
    parent.add(child2)
    parent.add(child3)

    parent.destroyRecursively()

    expect(parent.isDestroyed).toBe(true)
    expect(child1.isDestroyed).toBe(true)
    expect(child2.isDestroyed).toBe(true)
    expect(child3.isDestroyed).toBe(true)
  })

  test("handles immediate add and destroy before render tick", async () => {
    const parent = new TestRenderable(testRenderer, { id: "parent" })
    const children = []
    for (let i = 0; i < 10; i++) {
      children.push(new TestRenderable(testRenderer, { id: `child-${i}` }))
    }

    for (const child of children) {
      parent.add(child)
    }

    testRenderer.root.add(parent)

    parent.destroyRecursively()

    await renderOnce()
    expect(parent.getChildrenCount()).toBe(0)
  })

  test("newly added child should not have layout updated if destroyed before render", async () => {
    const parent = new TestRenderable(testRenderer, { id: "parent" })
    const child = new TestRenderable(testRenderer, { id: "child" })

    parent.add(child)
    testRenderer.root.add(parent)
    await renderOnce()

    const child2 = new TestRenderable(testRenderer, { id: "child2" })
    parent.add(child2)

    const spy = spyOn(child2, "updateFromLayout")

    child2.destroy()

    await renderOnce()

    expect(spy).not.toHaveBeenCalled()
  })

  test("newly added children receive correct layout dimensions on first render", async () => {
    const parent = new TestRenderable(testRenderer, {
      id: "parent",
      width: 100,
      height: 100,
      flexDirection: "column",
    })

    testRenderer.root.add(parent)
    await renderOnce()

    // Add children after parent has been rendered
    const child1 = new TestRenderable(testRenderer, {
      id: "child1",
      height: 30,
      flexGrow: 0,
    })
    const child2 = new TestRenderable(testRenderer, {
      id: "child2",
      height: 20,
      flexGrow: 0,
    })

    parent.add(child1)
    parent.add(child2)

    // Before render, width should be 0 (no layout computed yet)
    expect(child1.width).toBe(0)
    expect(child2.width).toBe(0)

    await renderOnce()

    // After render, children should have correct dimensions
    // Width should be inherited from parent's width
    expect(child1.width).toBe(100)
    expect(child1.height).toBe(30)
    expect(child2.width).toBe(100)
    expect(child2.height).toBe(20)
  })

  test("newly added children with nested children receive correct layout", async () => {
    const parent = new TestRenderable(testRenderer, {
      id: "parent",
      width: 100,
      height: 100,
    })

    testRenderer.root.add(parent)
    await renderOnce()

    // Add a child with its own child
    const child = new TestRenderable(testRenderer, {
      id: "child",
      width: 50,
      height: 50,
    })
    const grandchild = new TestRenderable(testRenderer, {
      id: "grandchild",
      flexGrow: 1,
    })

    child.add(grandchild)
    parent.add(child)

    await renderOnce()

    // Verify parent child gets layout
    expect(child.width).toBe(50)
    expect(child.height).toBe(50)

    // Note: grandchild layout depends on whether the nested children 
    // are also updated - we're testing the current behavior
    // The grandchild should get some dimensions
    expect(grandchild.width).toBeGreaterThan(0)
    expect(grandchild.height).toBeGreaterThan(0)
  })

  test("children added via insertBefore receive correct layout on first render", async () => {
    const parent = new TestRenderable(testRenderer, {
      id: "parent",
      width: 100,
      height: 100,
      flexDirection: "column",
    })

    const child1 = new TestRenderable(testRenderer, {
      id: "child1",
      height: 20,
      flexGrow: 0,
    })
    const child3 = new TestRenderable(testRenderer, {
      id: "child3",
      height: 20,
      flexGrow: 0,
    })

    parent.add(child1)
    parent.add(child3)
    testRenderer.root.add(parent)
    await renderOnce()

    // Insert child2 between child1 and child3
    const child2 = new TestRenderable(testRenderer, {
      id: "child2",
      height: 15,
      flexGrow: 0,
    })

    parent.insertBefore(child2, child3)

    // Before render, width should be 0 (no layout computed yet)
    expect(child2.width).toBe(0)

    await renderOnce()

    // After render, child2 should have correct dimensions
    expect(child2.width).toBe(100)
    expect(child2.height).toBe(15)

    // Verify correct vertical positions (column layout)
    expect(child1.y).toBe(0)
    expect(child2.y).toBe(20) // After child1
    expect(child3.y).toBe(35) // After child1 + child2
  })

  test("children after insertBefore anchor maintain correct layout", async () => {
    const parent = new TestRenderable(testRenderer, {
      id: "parent",
      width: 100,
      height: 100,
      flexDirection: "row",
    })

    const child1 = new TestRenderable(testRenderer, {
      id: "child1",
      width: 20,
      flexGrow: 0,
    })
    const child2 = new TestRenderable(testRenderer, {
      id: "child2",
      width: 25,
      flexGrow: 0,
    })
    const child3 = new TestRenderable(testRenderer, {
      id: "child3",
      width: 30,
      flexGrow: 0,
    })

    parent.add(child1)
    parent.add(child2)
    parent.add(child3)
    testRenderer.root.add(parent)
    await renderOnce()

    // Capture initial positions
    const child1InitialX = child1.x
    const child2InitialX = child2.x
    const child3InitialX = child3.x

    // Insert a new child before child2
    const newChild = new TestRenderable(testRenderer, {
      id: "newChild",
      width: 10,
      flexGrow: 0,
    })

    parent.insertBefore(newChild, child2)
    await renderOnce()

    // Verify all children have correct positions after insertion
    // child1 should stay at same position
    expect(child1.x).toBe(child1InitialX)

    // newChild should be after child1
    expect(newChild.x).toBe(child1InitialX + 20)

    // child2 and child3 should shift right
    expect(child2.x).toBe(child1InitialX + 30) // After child1 + newChild
    expect(child3.x).toBe(child1InitialX + 55) // After child1 + newChild + child2

    // Verify they all have correct dimensions
    expect(child1.width).toBe(20)
    expect(newChild.width).toBe(10)
    expect(child2.width).toBe(25)
    expect(child3.width).toBe(30)
  })

  test("multiple children inserted in sequence receive correct layout", async () => {
    const parent = new TestRenderable(testRenderer, {
      id: "parent",
      width: 200,
      height: 100,
      flexDirection: "column",
    })

    const anchor = new TestRenderable(testRenderer, {
      id: "anchor",
      height: 10,
      flexGrow: 0,
    })

    parent.add(anchor)
    testRenderer.root.add(parent)
    await renderOnce()

    // Insert multiple children before the anchor in sequence
    const newChild1 = new TestRenderable(testRenderer, {
      id: "new1",
      height: 15,
      flexGrow: 0,
    })
    const newChild2 = new TestRenderable(testRenderer, {
      id: "new2",
      height: 20,
      flexGrow: 0,
    })
    const newChild3 = new TestRenderable(testRenderer, {
      id: "new3",
      height: 25,
      flexGrow: 0,
    })

    parent.insertBefore(newChild1, anchor)
    parent.insertBefore(newChild2, anchor)
    parent.insertBefore(newChild3, anchor)

    await renderOnce()

    // Verify all have correct dimensions
    expect(newChild1.width).toBe(200)
    expect(newChild1.height).toBe(15)
    expect(newChild2.width).toBe(200)
    expect(newChild2.height).toBe(20)
    expect(newChild3.width).toBe(200)
    expect(newChild3.height).toBe(25)

    // Verify correct vertical layout
    expect(newChild1.y).toBe(0)
    expect(newChild2.y).toBe(15)
    expect(newChild3.y).toBe(35)
    expect(anchor.y).toBe(60) // After all three new children
  })

  test("existing child moved via insertBefore maintains layout integrity", async () => {
    const parent = new TestRenderable(testRenderer, {
      id: "parent",
      width: 100,
      height: 100,
      flexDirection: "column",
    })

    const child1 = new TestRenderable(testRenderer, {
      id: "child1",
      height: 10,
      flexGrow: 0,
    })
    const child2 = new TestRenderable(testRenderer, {
      id: "child2",
      height: 20,
      flexGrow: 0,
    })
    const child3 = new TestRenderable(testRenderer, {
      id: "child3",
      height: 30,
      flexGrow: 0,
    })

    parent.add(child1)
    parent.add(child2)
    parent.add(child3)
    testRenderer.root.add(parent)
    await renderOnce()

    // Move child3 to the beginning
    parent.insertBefore(child3, child1)
    await renderOnce()

    // Verify new layout order
    expect(child3.y).toBe(0)
    expect(child1.y).toBe(30) // After child3
    expect(child2.y).toBe(40) // After child3 and child1

    // Verify all maintain their dimensions
    expect(child1.width).toBe(100)
    expect(child1.height).toBe(10)
    expect(child2.width).toBe(100)
    expect(child2.height).toBe(20)
    expect(child3.width).toBe(100)
    expect(child3.height).toBe(30)
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

  test("onPaste receives full paste event with preventDefault", async () => {
    const renderable = new TestFocusableRenderable(testRenderer, { id: "test-paste" })
    let receivedEvent: any = null
    let handlePasteCalled = false

    renderable.handlePaste = (event) => {
      handlePasteCalled = true
    }

    renderable.onPaste = (event) => {
      receivedEvent = event
      event.preventDefault()
    }

    renderable.focus()
    await testMockInput.pasteBracketedText("test text")

    expect(receivedEvent).not.toBeNull()
    expect(receivedEvent.text).toBe("test text")
    expect(receivedEvent.defaultPrevented).toBe(true)
    expect(handlePasteCalled).toBe(false)
  })

  test("handlePaste receives full paste event", async () => {
    const renderable = new TestFocusableRenderable(testRenderer, { id: "test-paste-handler" })
    let receivedEvent: any = null

    renderable.handlePaste = (event) => {
      receivedEvent = event
    }

    renderable.focus()
    await testMockInput.pasteBracketedText("handler text")

    expect(receivedEvent).not.toBeNull()
    expect(receivedEvent.text).toBe("handler text")
    expect(typeof receivedEvent.preventDefault).toBe("function")
  })

  test("preventDefault in onPaste prevents handlePaste", async () => {
    const renderable = new TestFocusableRenderable(testRenderer, { id: "test-prevent" })
    let onPasteCalled = false
    let handlePasteCalled = false

    renderable.onPaste = (event) => {
      onPasteCalled = true
      event.preventDefault()
    }

    renderable.handlePaste = () => {
      handlePasteCalled = true
    }

    renderable.focus()
    await testMockInput.pasteBracketedText("prevented")

    expect(onPasteCalled).toBe(true)
    expect(handlePasteCalled).toBe(false)
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

describe("Renderable - Layout with Viewport Filtering", () => {
  // Create a test renderable that filters visible children like ScrollBox does
  class ViewportFilteringRenderable extends Renderable {
    private _filterEnabled = false

    constructor(ctx: RenderContext, options: RenderableOptions) {
      super(ctx, options)
    }

    enableFiltering() {
      this._filterEnabled = true
    }

    protected _getVisibleChildren(): number[] {
      if (!this._filterEnabled) {
        return super._getVisibleChildren()
      }
      // Simulate viewport culling - only return first 2 children
      const children = this._childrenInZIndexOrder.slice(0, 2)
      return children.map((c) => c.num)
    }
  }

  test("newly added children receive layout even when filtered from viewport", async () => {
    const parent = new ViewportFilteringRenderable(testRenderer, {
      id: "parent",
      width: 100,
      height: 100,
      flexDirection: "column",
    })

    // Add initial children
    const child1 = new TestRenderable(testRenderer, {
      id: "child1",
      height: 30,
      flexGrow: 0,
    })
    const child2 = new TestRenderable(testRenderer, {
      id: "child2",
      height: 30,
      flexGrow: 0,
    })

    parent.add(child1)
    parent.add(child2)
    testRenderer.root.add(parent)
    parent.enableFiltering()
    await renderOnce()

    // Add a third child that will be filtered out
    const child3 = new TestRenderable(testRenderer, {
      id: "child3",
      height: 25,
      flexGrow: 0,
    })

    parent.add(child3)

    expect(child3.width).toBe(0) // Not laid out yet

    await renderOnce()

    // Even though child3 is filtered from viewport, it should still get layout
    expect(child3.width).toBe(100)
    expect(child3.height).toBe(25)
    expect(child3.y).toBe(60) // After child1 (30) + child2 (30)
  })

  test("child inserted before visible children receives layout when filtered", async () => {
    const parent = new ViewportFilteringRenderable(testRenderer, {
      id: "parent",
      width: 100,
      height: 100,
      flexDirection: "column",
    })

    const child1 = new TestRenderable(testRenderer, {
      id: "child1",
      height: 20,
      flexGrow: 0,
    })
    const child2 = new TestRenderable(testRenderer, {
      id: "child2",
      height: 20,
      flexGrow: 0,
    })
    const child3 = new TestRenderable(testRenderer, {
      id: "child3",
      height: 20,
      flexGrow: 0,
    })

    parent.add(child1)
    parent.add(child2)
    parent.add(child3)
    testRenderer.root.add(parent)
    parent.enableFiltering()
    await renderOnce()

    // Insert a new child that pushes child3 further down (outside viewport filter)
    const newChild = new TestRenderable(testRenderer, {
      id: "newChild",
      height: 15,
      flexGrow: 0,
    })

    parent.insertBefore(newChild, child2)

    await renderOnce()

    // All children should have correct layout even though child3 is filtered
    expect(newChild.width).toBe(100)
    expect(newChild.height).toBe(15)
    expect(child3.width).toBe(100)
    expect(child3.height).toBe(20)

    // Verify positions
    expect(child1.y).toBe(0)
    expect(newChild.y).toBe(20)
    expect(child2.y).toBe(35)
    expect(child3.y).toBe(55) // child3 is outside viewport filter but still laid out
  })
})

describe("Renderable - Nested Children Layout", () => {
  test("newly added parent with deeply nested children all receive layout", async () => {
    const root = new TestRenderable(testRenderer, {
      id: "root",
      width: 200,
      height: 200,
    })

    testRenderer.root.add(root)
    await renderOnce()

    // Create a hierarchy: parent -> child -> grandchild -> greatGrandchild
    const parent = new TestRenderable(testRenderer, {
      id: "parent",
      width: 150,
      height: 150,
    })
    const child = new TestRenderable(testRenderer, {
      id: "child",
      width: 100,
      height: 100,
    })
    const grandchild = new TestRenderable(testRenderer, {
      id: "grandchild",
      width: 50,
      height: 50,
    })
    const greatGrandchild = new TestRenderable(testRenderer, {
      id: "greatGrandchild",
      flexGrow: 1,
    })

    grandchild.add(greatGrandchild)
    child.add(grandchild)
    parent.add(child)

    // Add the whole hierarchy at once
    root.add(parent)

    await renderOnce()

    // Verify parent gets layout
    expect(parent.width).toBe(150)
    expect(parent.height).toBe(150)

    // Verify direct child gets layout
    expect(child.width).toBe(100)
    expect(child.height).toBe(100)

    // Verify grandchild also receives layout
    // (testing that nested children are properly initialized)
    expect(grandchild.width).toBeGreaterThan(0)
    expect(grandchild.height).toBeGreaterThan(0)
  })

  test("insertBefore with nested children updates all descendants correctly", async () => {
    const root = new TestRenderable(testRenderer, {
      id: "root",
      width: 200,
      height: 200,
      flexDirection: "column",
    })

    const existingChild = new TestRenderable(testRenderer, {
      id: "existing",
      height: 50,
      flexGrow: 0,
    })

    root.add(existingChild)
    testRenderer.root.add(root)
    await renderOnce()

    // Create a parent with nested child
    const newParent = new TestRenderable(testRenderer, {
      id: "newParent",
      height: 80,
      flexGrow: 0,
    })
    const nestedChild = new TestRenderable(testRenderer, {
      id: "nested",
      flexGrow: 1,
    })

    newParent.add(nestedChild)
    root.insertBefore(newParent, existingChild)

    await renderOnce()

    // Verify newParent (the direct child) gets correct layout
    expect(newParent.width).toBe(200)
    expect(newParent.height).toBe(80)
    expect(newParent.y).toBe(0)

    // Verify nestedChild gets some layout
    expect(nestedChild.width).toBeGreaterThan(0)
    expect(nestedChild.height).toBeGreaterThan(0)

    // Verify existingChild is pushed down correctly
    expect(existingChild.y).toBe(80)
  })
})

describe("Renderable - Complex Layout Update Scenarios", () => {
  test("multiple rapid add operations before render complete correctly", async () => {
    const parent = new TestRenderable(testRenderer, {
      id: "parent",
      width: 100,
      height: 200,
      flexDirection: "column",
    })

    testRenderer.root.add(parent)
    await renderOnce()

    // Rapidly add multiple children before any render occurs
    const children: TestRenderable[] = []
    for (let i = 0; i < 5; i++) {
      const child = new TestRenderable(testRenderer, {
        id: `child-${i}`,
        height: 20,
        flexGrow: 0,
      })
      children.push(child)
      parent.add(child)
    }

    // All should be pending layout
    for (const child of children) {
      expect(child.width).toBe(0)
    }

    await renderOnce()

    // All should receive correct layout
    let expectedY = 0
    for (const child of children) {
      expect(child.width).toBe(100)
      expect(child.height).toBe(20)
      expect(child.y).toBe(expectedY)
      expectedY += 20
    }
  })

  test("insertBefore at different positions updates subsequent children correctly", async () => {
    const parent = new TestRenderable(testRenderer, {
      id: "parent",
      width: 100,
      height: 300,
      flexDirection: "column",
    })

    const children: TestRenderable[] = []
    for (let i = 0; i < 5; i++) {
      const child = new TestRenderable(testRenderer, {
        id: `child-${i}`,
        height: 20,
        flexGrow: 0,
      })
      children.push(child)
      parent.add(child)
    }

    testRenderer.root.add(parent)
    await renderOnce()

    // Insert before position 2 (middle)
    const insert1 = new TestRenderable(testRenderer, {
      id: "insert1",
      height: 15,
      flexGrow: 0,
    })
    parent.insertBefore(insert1, children[2]!)

    await renderOnce()

    // Verify children from position 2 onwards have updated positions
    expect(children[0]!.y).toBe(0)
    expect(children[1]!.y).toBe(20)
    expect(insert1.y).toBe(40)
    expect(children[2]!.y).toBe(55) // Shifted by insert1's height
    expect(children[3]!.y).toBe(75)
    expect(children[4]!.y).toBe(95)

    // Insert before position 4 (near end)
    const insert2 = new TestRenderable(testRenderer, {
      id: "insert2",
      height: 10,
      flexGrow: 0,
    })
    parent.insertBefore(insert2, children[4]!)

    await renderOnce()

    // Verify only children after insert position are updated
    expect(children[0]!.y).toBe(0)
    expect(children[1]!.y).toBe(20)
    expect(insert1.y).toBe(40)
    expect(children[2]!.y).toBe(55)
    expect(children[3]!.y).toBe(75)
    expect(insert2.y).toBe(95)
    expect(children[4]!.y).toBe(105) // Shifted by insert2's height
  })

  test("add and insertBefore mixed operations maintain layout integrity", async () => {
    const parent = new TestRenderable(testRenderer, {
      id: "parent",
      width: 100,
      height: 200,
      flexDirection: "column",
    })

    testRenderer.root.add(parent)
    await renderOnce()

    const child1 = new TestRenderable(testRenderer, {
      id: "child1",
      height: 10,
      flexGrow: 0,
    })
    const child2 = new TestRenderable(testRenderer, {
      id: "child2",
      height: 20,
      flexGrow: 0,
    })

    parent.add(child1)
    parent.add(child2)

    const child3 = new TestRenderable(testRenderer, {
      id: "child3",
      height: 15,
      flexGrow: 0,
    })
    parent.insertBefore(child3, child2)

    const child4 = new TestRenderable(testRenderer, {
      id: "child4",
      height: 25,
      flexGrow: 0,
    })
    parent.add(child4)

    await renderOnce()

    // Verify final layout order and positions
    expect(child1.y).toBe(0)
    expect(child3.y).toBe(10) // Inserted before child2
    expect(child2.y).toBe(25) // Pushed down by child3
    expect(child4.y).toBe(45) // Added at end

    // Verify all have correct dimensions
    expect(child1.width).toBe(100)
    expect(child2.width).toBe(100)
    expect(child3.width).toBe(100)
    expect(child4.width).toBe(100)
  })

  test("children removed and re-added receive fresh layout", async () => {
    const parent = new TestRenderable(testRenderer, {
      id: "parent",
      width: 100,
      height: 100,
      flexDirection: "column",
    })

    const child1 = new TestRenderable(testRenderer, {
      id: "child1",
      height: 30,
      flexGrow: 0,
    })
    const child2 = new TestRenderable(testRenderer, {
      id: "child2",
      height: 40,
      flexGrow: 0,
    })

    parent.add(child1)
    parent.add(child2)
    testRenderer.root.add(parent)
    await renderOnce()

    const child1InitialY = child1.y
    const child2InitialY = child2.y

    expect(child1InitialY).toBe(0)
    expect(child2InitialY).toBe(30)

    // Remove child1
    parent.remove(child1.id)
    await renderOnce()

    // child2 should move up
    expect(child2.y).toBe(0)

    // Re-add child1 at the end
    parent.add(child1)
    await renderOnce()

    // child1 should now be after child2
    expect(child2.y).toBe(0)
    expect(child1.y).toBe(40)
    expect(child1.width).toBe(100)
    expect(child1.height).toBe(30)
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
