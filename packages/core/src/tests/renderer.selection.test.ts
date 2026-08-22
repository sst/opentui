import { test, expect, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"
import { BoxRenderable } from "../renderables/Box.js"
import { TextRenderable } from "../renderables/Text.js"

let renderer: TestRenderer
let renderOnce: () => void

beforeEach(async () => {
  ;({ renderer, renderOnce } = await createTestRenderer({}))
})

afterEach(() => {
  renderer.destroy()
})

test("selection on destroyed renderable should not throw", () => {
  const text = new TextRenderable(renderer, {
    content: "Hello World",
    width: 20,
    height: 1,
  })

  renderer.root.add(text)
  renderOnce()

  // Start selection
  renderer.startSelection(text, 0, 0)

  // Update selection - this should not throw
  renderer.updateSelection(text, 5, 1)

  expect(renderer.getSelection()).not.toBeNull()

  // Destroy the text renderable
  text.destroy()

  expect(text.isDestroyed).toBe(true)

  // Get selection - this should not throw
  expect(renderer.getSelection()!.getSelectedText()).toBe("")

  // Update selection - this should not throw
  renderer.updateSelection(text, 8, 1)

  // Clear selection - this should not throw
  renderer.clearSelection()

  expect(renderer.getSelection()).toBeNull()
})

test("selected text joins same-row renderables without newlines", () => {
  const row = new BoxRenderable(renderer, {
    flexDirection: "row",
    width: 20,
    height: 1,
  })
  const left = new TextRenderable(renderer, {
    content: "Hello ",
    width: 6,
    height: 1,
    selectable: true,
  })
  const right = new TextRenderable(renderer, {
    content: "World",
    width: 5,
    height: 1,
    selectable: true,
  })

  row.add(left)
  row.add(right)
  renderer.root.add(row)
  renderOnce()

  renderer.startSelection(left, left.x, left.y)
  renderer.updateSelection(right, right.x + right.width, right.y, { finishDragging: true })

  expect(renderer.getSelection()?.getSelectedText()).toBe("Hello World")
})

test("selected text keeps newlines between different rows", () => {
  const top = new TextRenderable(renderer, {
    content: "First row",
    position: "absolute",
    left: 0,
    top: 0,
    width: 9,
    height: 1,
    selectable: true,
  })
  const bottom = new TextRenderable(renderer, {
    content: "Second row",
    position: "absolute",
    left: 0,
    top: 1,
    width: 10,
    height: 1,
    selectable: true,
  })

  renderer.root.add(top)
  renderer.root.add(bottom)
  renderOnce()

  expect(bottom.y).toBe(top.y + 1)

  renderer.startSelection(top, top.x, top.y)
  renderer.updateSelection(bottom, bottom.x + bottom.width, bottom.y, { finishDragging: true })

  expect(renderer.getSelection()?.getSelectedText()).toBe("First row\nSecond row")
})

test("selected text merges multiline same-row renderables by visual row", () => {
  const row = new BoxRenderable(renderer, {
    flexDirection: "row",
    width: 4,
    height: 2,
  })
  const left = new TextRenderable(renderer, {
    content: "A\nB",
    width: 1,
    height: 2,
    selectable: true,
  })
  const right = new TextRenderable(renderer, {
    content: "1\n2",
    width: 1,
    height: 2,
    selectable: true,
  })

  row.add(left)
  row.add(right)
  renderer.root.add(row)
  renderOnce()

  renderer.startSelection(left, left.x, left.y)
  renderer.updateSelection(right, right.x + right.width, right.y + 1, { finishDragging: true })

  expect(renderer.getSelection()?.getSelectedText()).toBe("A1\nB2")
})

test("selected text preserves blank rows between vertically gapped renderables", () => {
  const top = new TextRenderable(renderer, {
    content: "First paragraph",
    position: "absolute",
    left: 0,
    top: 0,
    width: 20,
    height: 1,
    selectable: true,
  })
  const bottom = new TextRenderable(renderer, {
    content: "Second paragraph",
    position: "absolute",
    left: 0,
    top: 2,
    width: 20,
    height: 1,
    selectable: true,
  })

  renderer.root.add(top)
  renderer.root.add(bottom)
  renderOnce()

  expect(bottom.y).toBe(top.y + 2)

  renderer.startSelection(top, top.x, top.y)
  renderer.updateSelection(bottom, bottom.x + bottom.width, bottom.y, { finishDragging: true })

  expect(renderer.getSelection()?.getSelectedText()).toBe("First paragraph\n\nSecond paragraph")
})

test("selected text does not invent blanks for a partial multiline selection", () => {
  const top = new TextRenderable(renderer, {
    content: "A\nB\nC",
    position: "absolute",
    left: 0,
    top: 0,
    width: 3,
    height: 3,
    selectable: true,
  })
  const bottom = new TextRenderable(renderer, {
    content: "Next",
    position: "absolute",
    left: 0,
    top: 3,
    width: 4,
    height: 1,
    selectable: true,
  })

  renderer.root.add(top)
  renderer.root.add(bottom)
  renderOnce()

  expect(bottom.y).toBe(top.y + 3)

  renderer.startSelection(top, top.x, top.y + 2)
  renderer.updateSelection(bottom, bottom.x + bottom.width, bottom.y, { finishDragging: true })

  expect(renderer.getSelection()?.getSelectedText()).toBe("C\nNext")
})

test("selected text does not invent blanks for a wrapped renderable followed by an adjacent widget", () => {
  const top = new TextRenderable(renderer, {
    content: "abcdefghij",
    position: "absolute",
    left: 0,
    top: 0,
    width: 5,
    height: 2,
    wrapMode: "char",
    selectable: true,
  })
  const bottom = new TextRenderable(renderer, {
    content: "Next",
    position: "absolute",
    left: 0,
    top: 2,
    width: 4,
    height: 1,
    selectable: true,
  })

  renderer.root.add(top)
  renderer.root.add(bottom)
  renderOnce()

  expect(top.height).toBe(2)
  expect(bottom.y).toBe(top.y + 2)

  renderer.startSelection(top, top.x, top.y)
  renderer.updateSelection(bottom, bottom.x + bottom.width, bottom.y, { finishDragging: true })

  expect(renderer.getSelection()?.getSelectedText()).toBe("abcdefghij\nNext")
})

test("selected text keeps a blank row that is empty across columns", () => {
  const tall = new TextRenderable(renderer, {
    content: "A",
    position: "absolute",
    left: 10,
    top: 0,
    width: 1,
    height: 3,
    selectable: true,
  })
  const mid = new TextRenderable(renderer, {
    content: "B",
    position: "absolute",
    left: 0,
    top: 1,
    width: 1,
    height: 1,
    selectable: true,
  })
  const bottom = new TextRenderable(renderer, {
    content: "C",
    position: "absolute",
    left: 0,
    top: 3,
    width: 1,
    height: 1,
    selectable: true,
  })

  renderer.root.add(tall)
  renderer.root.add(mid)
  renderer.root.add(bottom)
  renderOnce()

  expect(mid.y).toBe(1)
  expect(bottom.y).toBe(3)

  renderer.startSelection(tall, tall.x, tall.y)
  renderer.updateSelection(bottom, bottom.x + bottom.width, bottom.y, { finishDragging: true })

  expect(renderer.getSelection()?.getSelectedText()).toBe("A\nB\n\nC")
})

test("selected text keeps a blank row after a tall widget's last text line", () => {
  const tall = new TextRenderable(renderer, {
    content: "A\nX",
    position: "absolute",
    left: 10,
    top: 0,
    width: 1,
    height: 3,
    selectable: true,
  })
  const mid = new TextRenderable(renderer, {
    content: "B",
    position: "absolute",
    left: 0,
    top: 1,
    width: 1,
    height: 1,
    selectable: true,
  })
  const bottom = new TextRenderable(renderer, {
    content: "C",
    position: "absolute",
    left: 0,
    top: 3,
    width: 1,
    height: 1,
    selectable: true,
  })

  renderer.root.add(tall)
  renderer.root.add(mid)
  renderer.root.add(bottom)
  renderOnce()

  renderer.startSelection(tall, tall.x, tall.y)
  renderer.updateSelection(bottom, bottom.x + bottom.width, bottom.y, { finishDragging: true })

  expect(renderer.getSelection()?.getSelectedText()).toBe("A\nBX\n\nC")
})

test("selected text joins a wrapped logical line's later visual row with a same-row widget", () => {
  const top = new TextRenderable(renderer, {
    content: "aaaaa\nB",
    position: "absolute",
    left: 10,
    top: 0,
    width: 4,
    height: 3,
    wrapMode: "char",
    selectable: true,
  })
  const left = new TextRenderable(renderer, {
    content: "L",
    position: "absolute",
    left: 0,
    top: 2,
    width: 1,
    height: 1,
    selectable: true,
  })
  const bottom = new TextRenderable(renderer, {
    content: "C",
    position: "absolute",
    left: 0,
    top: 4,
    width: 1,
    height: 1,
    selectable: true,
  })

  renderer.root.add(top)
  renderer.root.add(left)
  renderer.root.add(bottom)
  renderOnce()

  expect(left.y).toBe(top.y + 2)
  expect(bottom.y).toBe(top.y + 4)

  renderer.startSelection(top, top.x, top.y)
  renderer.updateSelection(bottom, bottom.x + bottom.width, bottom.y, { finishDragging: true })

  expect(renderer.getSelection()?.getSelectedText()).toBe("aaaaa\nLB\n\nC")
})

test("selected text keeps a trailing newline when selection ends on an empty line", () => {
  const text = new TextRenderable(renderer, {
    content: "A\n\nX",
    position: "absolute",
    left: 0,
    top: 0,
    width: 3,
    height: 3,
    selectable: true,
  })

  renderer.root.add(text)
  renderOnce()

  renderer.startSelection(text, text.x, text.y)
  renderer.updateSelection(text, text.x + 1, text.y + 1, { finishDragging: true })

  expect(text.getSelectedText()).toBe("A\n")
  expect(renderer.getSelection()?.getSelectedText()).toBe("A\n")
})
