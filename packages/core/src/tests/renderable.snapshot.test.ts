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
