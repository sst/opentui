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
})
