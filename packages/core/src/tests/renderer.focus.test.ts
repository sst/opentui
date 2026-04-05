import { test, expect, beforeEach, afterEach, describe } from "bun:test"
import { CliRenderEvents } from "../renderer.js"
import { createTestRenderer, MouseButtons, type MockMouse, type TestRenderer } from "../testing.js"
import { ScrollBoxRenderable } from "../renderables/ScrollBox.js"
import { BoxRenderable } from "../renderables/Box.js"
import { InputRenderable } from "../renderables/Input.js"
import { TextareaRenderable } from "../renderables/Textarea.js"
import { TextRenderable } from "../renderables/Text.js"

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

test("autoFocus=false prevents click focus changes", async () => {
  const { renderer, mockMouse } = await createTestRenderer({
    width: 50,
    height: 30,
    autoFocus: false,
  })

  try {
    const first = new BoxRenderable(renderer, {
      id: "focus-first",
      position: "absolute",
      left: 1,
      top: 1,
      width: 8,
      height: 4,
      focusable: true,
    })
    const second = new BoxRenderable(renderer, {
      id: "focus-second",
      position: "absolute",
      left: 12,
      top: 1,
      width: 8,
      height: 4,
      focusable: true,
    })
    renderer.root.add(first)
    renderer.root.add(second)
    await renderer.idle()

    first.focus()
    expect(first.focused).toBe(true)

    await mockMouse.click(second.x + 1, second.y + 1)

    expect(first.focused).toBe(true)
    expect(second.focused).toBe(false)
  } finally {
    renderer.destroy()
  }
})

test("focused_editor event emits on editor focus changes", async () => {
  const events: Array<[string | null, string | null]> = []
  const box = new BoxRenderable(testRenderer, {
    id: "plain-box",
    width: 10,
    height: 2,
    focusable: true,
  })
  const textarea = new TextareaRenderable(testRenderer, {
    id: "editor-a",
    width: 20,
    height: 3,
  })
  const input = new InputRenderable(testRenderer, {
    id: "editor-b",
    width: 20,
  })

  testRenderer.on(CliRenderEvents.FOCUSED_EDITOR, (current, previous) => {
    events.push([current?.id ?? null, previous?.id ?? null])
  })

  testRenderer.root.add(box)
  testRenderer.root.add(textarea)
  testRenderer.root.add(input)
  await testRenderer.idle()

  textarea.focus()
  box.focus()
  input.focus()
  input.focus()

  expect(events).toEqual([
    ["editor-a", null],
    [null, "editor-a"],
    ["editor-b", null],
  ])
  expect(testRenderer.currentFocusedEditor?.id).toBe("editor-b")
})

describe("focus hierarchy mode", () => {
  test("focusing child focuses entire ancestor chain", async () => {
    const { renderer } = await createTestRenderer({
      width: 50,
      height: 30,
      focusAncestors: true,
    })

    const grandparent = new BoxRenderable(renderer, {
      id: "grandparent",
      width: 20,
      height: 10,
      focusable: true,
    })
    const parent = new BoxRenderable(renderer, {
      id: "parent",
      width: 15,
      height: 8,
      focusable: true,
    })
    const child = new BoxRenderable(renderer, {
      id: "child",
      width: 10,
      height: 5,
      focusable: true,
    })

    grandparent.add(parent)
    parent.add(child)
    renderer.root.add(grandparent)
    await renderer.idle()

    child.focus()

    expect(child.focused).toBe(true)
    expect(parent.focused).toBe(true)
    expect(grandparent.focused).toBe(true)

    renderer.destroy()
  })

  test("switching to different tree blurs old ancestors", async () => {
    const { renderer } = await createTestRenderer({
      width: 50,
      height: 30,
      focusAncestors: true,
    })

    const tree1 = new BoxRenderable(renderer, { id: "tree1", width: 10, height: 5, focusable: true })
    const child1 = new BoxRenderable(renderer, { id: "child1", width: 5, height: 3, focusable: true })
    tree1.add(child1)
    renderer.root.add(tree1)

    const tree2 = new BoxRenderable(renderer, { id: "tree2", width: 10, height: 5, focusable: true })
    const child2 = new BoxRenderable(renderer, { id: "child2", width: 5, height: 3, focusable: true })
    tree2.add(child2)
    renderer.root.add(tree2)

    await renderer.idle()

    child1.focus()
    expect(child1.focused).toBe(true)
    expect(tree1.focused).toBe(true)

    child2.focus()
    expect(child2.focused).toBe(true)
    expect(tree2.focused).toBe(true)
    expect(tree1.focused).toBe(false)
    expect(child1.focused).toBe(false)

    renderer.destroy()
  })

  test("shared ancestors remain focused when switching between siblings", async () => {
    const { renderer } = await createTestRenderer({
      width: 50,
      height: 30,
      focusAncestors: true,
    })

    const root = new BoxRenderable(renderer, { id: "root", width: 20, height: 10, focusable: true })
    const branchA = new BoxRenderable(renderer, { id: "branchA", width: 8, height: 6, focusable: true })
    const branchB = new BoxRenderable(renderer, { id: "branchB", width: 8, height: 6, focusable: true })
    const leafA = new BoxRenderable(renderer, { id: "leafA", width: 4, height: 3, focusable: true })
    const leafB = new BoxRenderable(renderer, { id: "leafB", width: 4, height: 3, focusable: true })

    root.add(branchA)
    root.add(branchB)
    branchA.add(leafA)
    branchB.add(leafB)
    renderer.root.add(root)

    await renderer.idle()

    leafA.focus()
    expect(leafA.focused).toBe(true)
    expect(branchA.focused).toBe(true)
    expect(root.focused).toBe(true)
    expect(branchB.focused).toBe(false)

    leafB.focus()
    expect(leafB.focused).toBe(true)
    expect(branchB.focused).toBe(true)
    expect(root.focused).toBe(true)
    expect(branchA.focused).toBe(false)
    expect(leafA.focused).toBe(false)

    renderer.destroy()
  })

  test("multiple disjoint trees stay independent", async () => {
    const { renderer } = await createTestRenderer({
      width: 50,
      height: 30,
      focusAncestors: true,
    })

    const tree1Root = new BoxRenderable(renderer, { id: "tree1Root", width: 8, height: 5, focusable: true })
    const tree1Child = new BoxRenderable(renderer, { id: "tree1Child", width: 4, height: 3, focusable: true })
    tree1Root.add(tree1Child)
    renderer.root.add(tree1Root)

    const tree2Root = new BoxRenderable(renderer, {
      id: "tree2Root",
      position: "absolute",
      left: 20,
      top: 0,
      width: 8,
      height: 5,
      focusable: true,
    })
    const tree2Child = new BoxRenderable(renderer, { id: "tree2Child", width: 4, height: 3, focusable: true })
    tree2Root.add(tree2Child)
    renderer.root.add(tree2Root)

    await renderer.idle()

    tree1Child.focus()
    expect(tree1Child.focused).toBe(true)
    expect(tree1Root.focused).toBe(true)
    expect(tree2Root.focused).toBe(false)

    tree2Child.focus()
    expect(tree2Child.focused).toBe(true)
    expect(tree2Root.focused).toBe(true)
    expect(tree1Root.focused).toBe(false)
    expect(tree1Child.focused).toBe(false)

    tree1Child.focus()
    expect(tree1Child.focused).toBe(true)
    expect(tree1Root.focused).toBe(true)
    expect(tree2Root.focused).toBe(false)
    expect(tree2Child.focused).toBe(false)

    renderer.destroy()
  })
})
