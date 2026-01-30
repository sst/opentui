import { test, expect, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, MouseButtons, type MockMouse, type TestRenderer } from "../testing"
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

test("non-left click does not auto-focus", async () => {
  const scrollbox = new ScrollBoxRenderable(testRenderer, {
    id: "focusable-box",
    width: 20,
    height: 10,
  })
  testRenderer.root.add(scrollbox)
  await testRenderer.idle()

  await mockMouse.click(scrollbox.x + 1, scrollbox.y + 1, MouseButtons.RIGHT)
  expect(scrollbox.focused).toBe(false)

  await mockMouse.click(scrollbox.x + 2, scrollbox.y + 2, MouseButtons.MIDDLE)
  expect(scrollbox.focused).toBe(false)
})

test("preventDefault on ancestor blocks auto-focus", async () => {
  let childDown = false
  const parent = new BoxRenderable(testRenderer, {
    id: "focus-parent",
    position: "absolute",
    left: 2,
    top: 2,
    width: 20,
    height: 10,
    focusable: true,
    onMouseDown: (event) => {
      event.preventDefault()
    },
  })
  const child = new BoxRenderable(testRenderer, {
    id: "focus-child",
    position: "absolute",
    left: 1,
    top: 1,
    width: 6,
    height: 3,
    onMouseDown: () => {
      childDown = true
    },
  })
  parent.add(child)
  testRenderer.root.add(parent)
  await testRenderer.idle()

  await mockMouse.click(child.x + 1, child.y + 1)

  expect(childDown).toBe(true)
  expect(parent.focused).toBe(false)
  expect(child.focused).toBe(false)
})

test("dragging over focusable target does not auto-focus", async () => {
  const start = new BoxRenderable(testRenderer, {
    id: "drag-start",
    position: "absolute",
    left: 1,
    top: 1,
    width: 6,
    height: 4,
  })
  const focusable = new BoxRenderable(testRenderer, {
    id: "drag-focusable",
    position: "absolute",
    left: 12,
    top: 1,
    width: 6,
    height: 4,
    focusable: true,
  })
  testRenderer.root.add(start)
  testRenderer.root.add(focusable)
  await testRenderer.idle()

  await mockMouse.pressDown(start.x + 1, start.y + 1)
  await mockMouse.moveTo(focusable.x + 1, focusable.y + 1)
  await mockMouse.release(focusable.x + 1, focusable.y + 1)

  expect(focusable.focused).toBe(false)
})

test("clicking empty space does not auto-focus", async () => {
  const box = new BoxRenderable(testRenderer, {
    id: "focusable-box",
    position: "absolute",
    left: 1,
    top: 1,
    width: 8,
    height: 4,
    focusable: true,
  })
  testRenderer.root.add(box)
  await testRenderer.idle()

  await mockMouse.click(testRenderer.width - 1, testRenderer.height - 1)

  expect(box.focused).toBe(false)
})
