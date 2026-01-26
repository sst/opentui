import { test, expect, beforeEach, afterEach, describe } from "bun:test"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"
import { BoxRenderable } from "../renderables/Box"
import { TextRenderable } from "../renderables/Text"

let testRenderer: TestRenderer
let renderOnce: () => Promise<void>
let captureFrame: () => string

beforeEach(async () => {
  ;({
    renderer: testRenderer,
    renderOnce,
    captureCharFrame: captureFrame,
  } = await createTestRenderer({
    width: 10,
    height: 5,
  }))
})

afterEach(() => {
  testRenderer.destroy()
})

describe("Renderable - insertBefore", () => {
  test("reproduces insertBefore behavior with state change after timeout", async () => {
    const container = new BoxRenderable(testRenderer, {
      id: "container",
      width: 10,
      height: 5,
    })

    const bananaText = new TextRenderable(testRenderer, {
      id: "banana",
      content: "banana",
    })

    const appleText = new TextRenderable(testRenderer, {
      id: "apple",
      content: "apple",
    })

    const pearText = new TextRenderable(testRenderer, {
      id: "pear",
      content: "pear",
    })

    const separator = new BoxRenderable(testRenderer, {
      id: "separator",
      width: 20,
      height: 1,
    })

    container.add(bananaText)
    container.add(appleText)
    container.add(pearText)
    container.add(separator)

    testRenderer.root.add(container)
    await renderOnce()

    const initialFrame = captureFrame()
    expect(initialFrame).toMatchSnapshot("insertBefore initial state")

    await new Promise((resolve) => setTimeout(resolve, 100))

    container.insertBefore(appleText, separator)

    await renderOnce()

    const reorderedFrame = captureFrame()
    expect(reorderedFrame).toMatchSnapshot("insertBefore reordered state")
  })

  test("ensure .add with index works correctly", async () => {
    const container = new BoxRenderable(testRenderer, {
      id: "container",
      width: 20,
      height: 10,
    })

    // Create 5 text renderables in order
    const items = [
      new TextRenderable(testRenderer, { id: "order-1", content: "First" }),
      new TextRenderable(testRenderer, { id: "order-2", content: "Second" }),
      new TextRenderable(testRenderer, { id: "order-3", content: "Third" }),
      new TextRenderable(testRenderer, { id: "order-4", content: "Fourth" }),
      new TextRenderable(testRenderer, { id: "order-5", content: "Fifth" }),
    ]

    // Add items in initial order [1, 2, 3, 4, 5]
    for (const item of items) {
      container.add(item)
    }

    testRenderer.root.add(container)
    await renderOnce()

    let children = container.getChildren()

    expect(children.length).toBe(5)
    expect(children[0]?.id).toBe("order-1")
    expect(children[1]?.id).toBe("order-2")
    expect(children[2]?.id).toBe("order-3")
    expect(children[3]?.id).toBe("order-4")
    expect(children[4]?.id).toBe("order-5")

    // Reproduce the EXACT sequence from SolidJS reconciler output:
    container.add(items[4]!, 1) // order-5 at index 1
    container.add(items[0]!) // order-1 at index undefined
    container.add(items[3]!, 2) // order-4 at index 2
    container.add(items[1]!, 4) // order-2 at index 4

    await renderOnce()

    children = container.getChildren()

    // Expected: [5, 4, 3, 2, 1]
    expect(children.length).toBe(5)
    expect(children[0]?.id).toBe("order-5")
    expect(children[1]?.id).toBe("order-4")
    expect(children[2]?.id).toBe("order-3")
    expect(children[3]?.id).toBe("order-2")
    expect(children[4]?.id).toBe("order-1")
  })
})

describe("Renderable - add method", () => {
  test("basic add appends to end", async () => {
    const container = new BoxRenderable(testRenderer, {
      id: "container",
      width: 10,
      height: 10,
    })

    const item1 = new TextRenderable(testRenderer, { id: "item-1", content: "A" })
    const item2 = new TextRenderable(testRenderer, { id: "item-2", content: "B" })
    const item3 = new TextRenderable(testRenderer, { id: "item-3", content: "C" })

    container.add(item1)
    container.add(item2)
    container.add(item3)

    const children = container.getChildren()
    expect(children.length).toBe(3)
    expect(children[0]?.id).toBe("item-1")
    expect(children[1]?.id).toBe("item-2")
    expect(children[2]?.id).toBe("item-3")
  })

  test("add with index 0 inserts at beginning", async () => {
    const container = new BoxRenderable(testRenderer, {
      id: "container",
      width: 10,
      height: 10,
    })

    const item1 = new TextRenderable(testRenderer, { id: "item-1", content: "A" })
    const item2 = new TextRenderable(testRenderer, { id: "item-2", content: "B" })
    const item3 = new TextRenderable(testRenderer, { id: "item-3", content: "C" })

    container.add(item1)
    container.add(item2)
    container.add(item3, 0) // Insert at beginning

    const children = container.getChildren()
    expect(children.length).toBe(3)
    expect(children[0]?.id).toBe("item-3")
    expect(children[1]?.id).toBe("item-1")
    expect(children[2]?.id).toBe("item-2")
  })

  test("add with middle index inserts correctly", async () => {
    const container = new BoxRenderable(testRenderer, {
      id: "container",
      width: 10,
      height: 10,
    })

    const item1 = new TextRenderable(testRenderer, { id: "item-1", content: "A" })
    const item2 = new TextRenderable(testRenderer, { id: "item-2", content: "B" })
    const item3 = new TextRenderable(testRenderer, { id: "item-3", content: "C" })

    container.add(item1)
    container.add(item2)
    container.add(item3, 1) // Insert in middle

    const children = container.getChildren()
    expect(children.length).toBe(3)
    expect(children[0]?.id).toBe("item-1")
    expect(children[1]?.id).toBe("item-3")
    expect(children[2]?.id).toBe("item-2")
  })

  test("add with large index appends to end", async () => {
    const container = new BoxRenderable(testRenderer, {
      id: "container",
      width: 10,
      height: 10,
    })

    const item1 = new TextRenderable(testRenderer, { id: "item-1", content: "A" })
    const item2 = new TextRenderable(testRenderer, { id: "item-2", content: "B" })
    const item3 = new TextRenderable(testRenderer, { id: "item-3", content: "C" })

    container.add(item1)
    container.add(item2)
    container.add(item3, 999) // Out of bounds index

    const children = container.getChildren()
    expect(children.length).toBe(3)
    expect(children[0]?.id).toBe("item-1")
    expect(children[1]?.id).toBe("item-2")
    expect(children[2]?.id).toBe("item-3")
  })

  test("add returns correct index", async () => {
    const container = new BoxRenderable(testRenderer, {
      id: "container",
      width: 10,
      height: 10,
    })

    const item1 = new TextRenderable(testRenderer, { id: "item-1", content: "A" })
    const item2 = new TextRenderable(testRenderer, { id: "item-2", content: "B" })
    const item3 = new TextRenderable(testRenderer, { id: "item-3", content: "C" })

    const idx1 = container.add(item1)
    const idx2 = container.add(item2)
    const idx3 = container.add(item3, 1)

    expect(idx1).toBe(0)
    expect(idx2).toBe(1)
    expect(idx3).toBe(1) // Inserted at index 1
  })

  test("add null/undefined returns -1", async () => {
    const container = new BoxRenderable(testRenderer, {
      id: "container",
      width: 10,
      height: 10,
    })

    const idx1 = container.add(null as any)
    const idx2 = container.add(undefined as any)

    expect(idx1).toBe(-1)
    expect(idx2).toBe(-1)
    expect(container.getChildrenCount()).toBe(0)
  })

  test("re-adding existing child moves it", async () => {
    const container = new BoxRenderable(testRenderer, {
      id: "container",
      width: 10,
      height: 10,
    })

    const item1 = new TextRenderable(testRenderer, { id: "item-1", content: "A" })
    const item2 = new TextRenderable(testRenderer, { id: "item-2", content: "B" })
    const item3 = new TextRenderable(testRenderer, { id: "item-3", content: "C" })

    container.add(item1)
    container.add(item2)
    container.add(item3)

    // Re-add item1 to end
    container.add(item1)

    let children = container.getChildren()
    expect(children.length).toBe(3)
    expect(children[0]?.id).toBe("item-2")
    expect(children[1]?.id).toBe("item-3")
    expect(children[2]?.id).toBe("item-1")

    // Re-add item3 to beginning
    container.add(item3, 0)

    children = container.getChildren()
    expect(children.length).toBe(3)
    expect(children[0]?.id).toBe("item-3")
    expect(children[1]?.id).toBe("item-2")
    expect(children[2]?.id).toBe("item-1")
  })

  test("adding child from another parent removes it from old parent", async () => {
    const container1 = new BoxRenderable(testRenderer, {
      id: "container-1",
      width: 10,
      height: 10,
    })

    const container2 = new BoxRenderable(testRenderer, {
      id: "container-2",
      width: 10,
      height: 10,
    })

    const item = new TextRenderable(testRenderer, { id: "item", content: "A" })

    container1.add(item)
    expect(container1.getChildrenCount()).toBe(1)
    expect(item.parent).toBe(container1)

    container2.add(item)
    expect(container1.getChildrenCount()).toBe(0)
    expect(container2.getChildrenCount()).toBe(1)
    expect(item.parent).toBe(container2)
  })
})

describe("Renderable - insertBefore method", () => {
  test("insertBefore with null anchor appends to end", async () => {
    const container = new BoxRenderable(testRenderer, {
      id: "container",
      width: 10,
      height: 10,
    })

    const item1 = new TextRenderable(testRenderer, { id: "item-1", content: "A" })
    const item2 = new TextRenderable(testRenderer, { id: "item-2", content: "B" })
    const item3 = new TextRenderable(testRenderer, { id: "item-3", content: "C" })

    container.add(item1)
    container.add(item2)
    container.insertBefore(item3, null as any)

    const children = container.getChildren()
    expect(children.length).toBe(3)
    expect(children[2]?.id).toBe("item-3")
  })

  test("insertBefore inserts at correct position", async () => {
    const container = new BoxRenderable(testRenderer, {
      id: "container",
      width: 10,
      height: 10,
    })

    const item1 = new TextRenderable(testRenderer, { id: "item-1", content: "A" })
    const item2 = new TextRenderable(testRenderer, { id: "item-2", content: "B" })
    const item3 = new TextRenderable(testRenderer, { id: "item-3", content: "C" })

    container.add(item1)
    container.add(item3)
    container.insertBefore(item2, item3) // Insert item2 before item3

    const children = container.getChildren()
    expect(children.length).toBe(3)
    expect(children[0]?.id).toBe("item-1")
    expect(children[1]?.id).toBe("item-2")
    expect(children[2]?.id).toBe("item-3")
  })

  test("insertBefore at beginning", async () => {
    const container = new BoxRenderable(testRenderer, {
      id: "container",
      width: 10,
      height: 10,
    })

    const item1 = new TextRenderable(testRenderer, { id: "item-1", content: "A" })
    const item2 = new TextRenderable(testRenderer, { id: "item-2", content: "B" })
    const item3 = new TextRenderable(testRenderer, { id: "item-3", content: "C" })

    container.add(item1)
    container.add(item2)
    container.insertBefore(item3, item1) // Insert before first item

    const children = container.getChildren()
    expect(children.length).toBe(3)
    expect(children[0]?.id).toBe("item-3")
    expect(children[1]?.id).toBe("item-1")
    expect(children[2]?.id).toBe("item-2")
  })

  test("insertBefore moves existing child", async () => {
    const container = new BoxRenderable(testRenderer, {
      id: "container",
      width: 10,
      height: 10,
    })

    const item1 = new TextRenderable(testRenderer, { id: "item-1", content: "A" })
    const item2 = new TextRenderable(testRenderer, { id: "item-2", content: "B" })
    const item3 = new TextRenderable(testRenderer, { id: "item-3", content: "C" })

    container.add(item1)
    container.add(item2)
    container.add(item3)

    // Move item3 before item1
    container.insertBefore(item3, item1)

    let children = container.getChildren()
    expect(children.length).toBe(3)
    expect(children[0]?.id).toBe("item-3")
    expect(children[1]?.id).toBe("item-1")
    expect(children[2]?.id).toBe("item-2")

    // Move item1 before item2
    container.insertBefore(item1, item2)

    children = container.getChildren()
    expect(children.length).toBe(3)
    expect(children[0]?.id).toBe("item-3")
    expect(children[1]?.id).toBe("item-1")
    expect(children[2]?.id).toBe("item-2")
  })

  test("insertBefore with invalid anchor returns -1", async () => {
    const container = new BoxRenderable(testRenderer, {
      id: "container",
      width: 10,
      height: 10,
    })

    const item1 = new TextRenderable(testRenderer, { id: "item-1", content: "A" })
    const item2 = new TextRenderable(testRenderer, { id: "item-2", content: "B" })
    const notAChild = new TextRenderable(testRenderer, { id: "not-child", content: "X" })

    container.add(item1)

    expect(container.insertBefore(item2, notAChild)).toBe(-1)
  })

  test("insertBefore returns correct index", async () => {
    const container = new BoxRenderable(testRenderer, {
      id: "container",
      width: 10,
      height: 10,
    })

    const item1 = new TextRenderable(testRenderer, { id: "item-1", content: "A" })
    const item2 = new TextRenderable(testRenderer, { id: "item-2", content: "B" })
    const item3 = new TextRenderable(testRenderer, { id: "item-3", content: "C" })

    container.add(item1)
    container.add(item3)

    const idx = container.insertBefore(item2, item3)
    expect(idx).toBe(1)
  })

  test("insertBefore with null object returns -1", async () => {
    const container = new BoxRenderable(testRenderer, {
      id: "container",
      width: 10,
      height: 10,
    })

    const anchor = new TextRenderable(testRenderer, { id: "anchor", content: "A" })
    container.add(anchor)

    const idx = container.insertBefore(null as any, anchor)
    expect(idx).toBe(-1)
  })

  test("complex reordering scenario", async () => {
    const container = new BoxRenderable(testRenderer, {
      id: "container",
      width: 10,
      height: 10,
    })

    const items = [
      new TextRenderable(testRenderer, { id: "A", content: "A" }),
      new TextRenderable(testRenderer, { id: "B", content: "B" }),
      new TextRenderable(testRenderer, { id: "C", content: "C" }),
      new TextRenderable(testRenderer, { id: "D", content: "D" }),
      new TextRenderable(testRenderer, { id: "E", content: "E" }),
    ]

    // Initial: A, B, C, D, E
    items.forEach((item) => container.add(item))

    let children = container.getChildren()
    expect(children.map((c) => c.id)).toEqual(["A", "B", "C", "D", "E"])

    // Move E before B: A, E, B, C, D
    container.insertBefore(items[4]!, items[1]!)
    children = container.getChildren()
    expect(children.map((c) => c.id)).toEqual(["A", "E", "B", "C", "D"])

    // Move A before D: E, B, C, A, D
    container.insertBefore(items[0]!, items[3]!)
    children = container.getChildren()
    expect(children.map((c) => c.id)).toEqual(["E", "B", "C", "A", "D"])

    // Move C before E: C, E, B, A, D
    container.insertBefore(items[2]!, items[4]!)
    children = container.getChildren()
    expect(children.map((c) => c.id)).toEqual(["C", "E", "B", "A", "D"])
  })

  test("multiple sequential adds and inserts", async () => {
    const container = new BoxRenderable(testRenderer, {
      id: "container",
      width: 10,
      height: 10,
    })

    const items = [
      new TextRenderable(testRenderer, { id: "1", content: "1" }),
      new TextRenderable(testRenderer, { id: "2", content: "2" }),
      new TextRenderable(testRenderer, { id: "3", content: "3" }),
      new TextRenderable(testRenderer, { id: "4", content: "4" }),
    ]

    container.add(items[0]!)
    container.add(items[1]!)
    expect(container.getChildren().map((c) => c.id)).toEqual(["1", "2"])

    container.insertBefore(items[2]!, items[1]!)
    expect(container.getChildren().map((c) => c.id)).toEqual(["1", "3", "2"])

    container.add(items[3]!, 0)
    expect(container.getChildren().map((c) => c.id)).toEqual(["4", "1", "3", "2"])

    // Move "2" before "4"
    container.insertBefore(items[1]!, items[3]!)
    expect(container.getChildren().map((c) => c.id)).toEqual(["2", "4", "1", "3"])
  })
})
