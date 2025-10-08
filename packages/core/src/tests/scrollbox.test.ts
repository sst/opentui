import { test, expect, beforeEach, afterEach, describe } from "bun:test"
import { createTestRenderer, type TestRenderer, type MockMouse } from "../testing/test-renderer"
import { ScrollBoxRenderable } from "../renderables/ScrollBox"
import { BoxRenderable } from "../renderables/Box"
import { TextRenderable } from "../renderables/Text"
import { LinearScrollAccel, MacOSScrollAccel } from "../lib/scroll-acceleration"

let testRenderer: TestRenderer
let mockMouse: MockMouse
let renderOnce: () => Promise<void>

beforeEach(async () => {
  ;({ renderer: testRenderer, mockMouse, renderOnce } = await createTestRenderer({ width: 80, height: 24 }))
})

afterEach(() => {
  testRenderer.destroy()
})

describe("ScrollBoxRenderable - child delegation", () => {
  test("delegates add to content wrapper", () => {
    const scrollbox = new ScrollBoxRenderable(testRenderer, { id: "scrollbox" })
    const child = new BoxRenderable(testRenderer, { id: "child" })

    scrollbox.add(child)

    const children = scrollbox.getChildren()
    expect(children.length).toBe(1)
    expect(children[0].id).toBe("child")
    expect(child.parent).toBe(scrollbox.content)
  })

  test("delegates remove to content wrapper", () => {
    const scrollbox = new ScrollBoxRenderable(testRenderer, { id: "scrollbox" })
    const child = new BoxRenderable(testRenderer, { id: "child" })

    scrollbox.add(child)
    expect(scrollbox.getChildren().length).toBe(1)

    scrollbox.remove(child.id)
    expect(scrollbox.getChildren().length).toBe(0)
  })

  test("delegates insertBefore to content wrapper", () => {
    const scrollbox = new ScrollBoxRenderable(testRenderer, { id: "scrollbox" })
    const child1 = new BoxRenderable(testRenderer, { id: "child1" })
    const child2 = new BoxRenderable(testRenderer, { id: "child2" })
    const child3 = new BoxRenderable(testRenderer, { id: "child3" })

    scrollbox.add(child1)
    scrollbox.add(child2)
    scrollbox.insertBefore(child3, child2)

    const children = scrollbox.getChildren()
    expect(children.length).toBe(3)
    expect(children[0].id).toBe("child1")
    expect(children[1].id).toBe("child3")
    expect(children[2].id).toBe("child2")
  })
})

describe("ScrollBoxRenderable - destroyRecursively", () => {
  test("destroys internal ScrollBox components", () => {
    const parent = new ScrollBoxRenderable(testRenderer, { id: "scroll-parent" })
    const child = new BoxRenderable(testRenderer, { id: "child" })

    parent.add(child)

    const wrapper = parent.wrapper
    const viewport = parent.viewport
    const content = parent.content
    const horizontalScrollBar = parent.horizontalScrollBar
    const verticalScrollBar = parent.verticalScrollBar

    expect(parent.isDestroyed).toBe(false)
    expect(child.isDestroyed).toBe(false)
    expect(wrapper.isDestroyed).toBe(false)
    expect(viewport.isDestroyed).toBe(false)
    expect(content.isDestroyed).toBe(false)
    expect(horizontalScrollBar.isDestroyed).toBe(false)
    expect(verticalScrollBar.isDestroyed).toBe(false)

    parent.destroyRecursively()

    expect(parent.isDestroyed).toBe(true)
    expect(child.isDestroyed).toBe(true)
    expect(wrapper.isDestroyed).toBe(true)
    expect(viewport.isDestroyed).toBe(true)
    expect(content.isDestroyed).toBe(true)
    expect(horizontalScrollBar.isDestroyed).toBe(true)
    expect(verticalScrollBar.isDestroyed).toBe(true)
  })
})

describe("ScrollBoxRenderable - Mouse interaction", () => {
  test("scrolls with mouse wheel", async () => {
    const scrollBox = new ScrollBoxRenderable(testRenderer, {
      width: 50,
      height: 20,
      scrollAcceleration: new MacOSScrollAccel({ A: 0 }),
    })
    for (let i = 0; i < 50; i++) scrollBox.add(new TextRenderable(testRenderer, { text: `Line ${i}` }))
    testRenderer.root.add(scrollBox)
    await renderOnce()

    await mockMouse.scroll(25, 10, "down")
    await renderOnce()
    expect(scrollBox.scrollTop).toBeGreaterThan(0)
  })

  test("single isolated scroll has same distance as linear", async () => {
    const linearBox = new ScrollBoxRenderable(testRenderer, {
      width: 50,
      height: 20,
      scrollAcceleration: new LinearScrollAccel(),
    })

    for (let i = 0; i < 100; i++) linearBox.add(new TextRenderable(testRenderer, { text: `Line ${i}` }))
    testRenderer.root.add(linearBox)
    await renderOnce()

    await mockMouse.scroll(25, 10, "down")
    await renderOnce()
    const linearDistance = linearBox.scrollTop

    testRenderer.destroy()
    ;({ renderer: testRenderer, mockMouse, renderOnce } = await createTestRenderer({ width: 80, height: 24 }))

    const accelBox = new ScrollBoxRenderable(testRenderer, {
      width: 50,
      height: 20,
      scrollAcceleration: new MacOSScrollAccel(),
    })

    for (let i = 0; i < 100; i++) accelBox.add(new TextRenderable(testRenderer, { text: `Line ${i}` }))
    testRenderer.root.add(accelBox)
    await renderOnce()

    await mockMouse.scroll(25, 10, "down")
    await renderOnce()

    expect(accelBox.scrollTop).toBe(linearDistance)
  })

  test("acceleration makes rapid scrolls cover more distance", async () => {
    const scrollBox = new ScrollBoxRenderable(testRenderer, {
      width: 50,
      height: 20,
      scrollAcceleration: new MacOSScrollAccel({ A: 0.8, tau: 3, maxMultiplier: 6 }),
    })
    for (let i = 0; i < 200; i++) scrollBox.add(new TextRenderable(testRenderer, { text: `Line ${i}` }))
    testRenderer.root.add(scrollBox)
    await renderOnce()

    await mockMouse.scroll(25, 10, "down")
    await renderOnce()
    const slowScrollDistance = scrollBox.scrollTop

    scrollBox.scrollTop = 0

    for (let i = 0; i < 5; i++) {
      await mockMouse.scroll(25, 10, "down")
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    await renderOnce()
    const rapidScrollDistance = scrollBox.scrollTop

    expect(rapidScrollDistance).toBeGreaterThan(slowScrollDistance * 3)
  })
})
