import { test, expect, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type MockMouse, type TestRenderer } from "../testing"
import { ScrollBoxRenderable } from "../renderables/ScrollBox"
import { BoxRenderable } from "../renderables/Box"
import { TextRenderable } from "../renderables/Text"

let testRenderer: TestRenderer
let mockMouse: MockMouse

beforeEach(async () => {
  ;({ renderer: testRenderer, mockMouse } = await createTestRenderer({
    width: 50,
    height: 30,
  }))
})

afterEach(() => {
  testRenderer.destroy()
})

test("click on focusable element focuses it", async () => {
  const scrollbox = new ScrollBoxRenderable(testRenderer, {
    id: "focusable-box",
    width: 20,
    height: 10,
  })
  testRenderer.root.add(scrollbox)
  await testRenderer.idle()

  expect(scrollbox.focused).toBe(false)

  await mockMouse.click(scrollbox.x + 1, scrollbox.y + 1)

  expect(scrollbox.focused).toBe(true)
})

test("click on child bubbles up to focusable parent", async () => {
  const scrollbox = new ScrollBoxRenderable(testRenderer, {
    id: "parent-box",
    width: 20,
    height: 10,
  })
  testRenderer.root.add(scrollbox)

  const text = new TextRenderable(testRenderer, {
    id: "child-text",
    content: "Click me",
  })
  scrollbox.add(text)
  await testRenderer.idle()

  expect(scrollbox.focused).toBe(false)

  await mockMouse.click(text.x + 1, text.y)

  expect(scrollbox.focused).toBe(true)
})

test("click on non-focusable with no focusable parent does nothing", async () => {
  const box = new BoxRenderable(testRenderer, {
    id: "plain-box",
    width: 20,
    height: 10,
  })
  testRenderer.root.add(box)
  await testRenderer.idle()

  expect(box.focusable).toBe(false)

  await mockMouse.click(box.x + 1, box.y + 1)

  expect(box.focused).toBe(false)
})

test("preventDefault on mousedown prevents auto-focus", async () => {
  const scrollbox = new ScrollBoxRenderable(testRenderer, {
    id: "focusable-box",
    width: 20,
    height: 10,
    onMouseDown: (event) => {
      event.preventDefault()
    },
  })
  testRenderer.root.add(scrollbox)
  await testRenderer.idle()

  expect(scrollbox.focused).toBe(false)

  await mockMouse.click(scrollbox.x + 1, scrollbox.y + 1)

  expect(scrollbox.focused).toBe(false)
})

test("mousedown handler is only called once per click", async () => {
  let mouseDownCount = 0
  const box = new BoxRenderable(testRenderer, {
    id: "click-box",
    width: 20,
    height: 10,
    onMouseDown: () => {
      mouseDownCount++
    },
  })
  testRenderer.root.add(box)
  await testRenderer.idle()

  await mockMouse.click(box.x + 1, box.y + 1)

  expect(mouseDownCount).toBe(1)
})
