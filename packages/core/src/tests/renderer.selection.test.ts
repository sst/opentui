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

test("selected text preserves visual gaps between same-row renderables", () => {
  const row = new BoxRenderable(renderer, {
    flexDirection: "row",
    width: 20,
    height: 1,
  })
  const left = new TextRenderable(renderer, {
    content: "Hello",
    width: 5,
    height: 1,
    selectable: true,
  })
  const spacer = new BoxRenderable(renderer, {
    width: 2,
    height: 1,
  })
  const right = new TextRenderable(renderer, {
    content: "World",
    width: 5,
    height: 1,
    selectable: true,
  })

  row.add(left)
  row.add(spacer)
  row.add(right)
  renderer.root.add(row)
  renderOnce()

  renderer.startSelection(left, left.x, left.y)
  renderer.updateSelection(right, right.x + right.width, right.y, { finishDragging: true })

  expect(renderer.getSelection()?.getSelectedText()).toBe("Hello  World")
})

test("selected text joins adjacent rows with a single newline", () => {
  const top = new TextRenderable(renderer, {
    content: "First row",
    left: 0,
    top: 0,
    width: 9,
    height: 1,
    selectable: true,
  })
  const bottom = new TextRenderable(renderer, {
    content: "Second row",
    left: 0,
    top: 1,
    width: 10,
    height: 1,
    selectable: true,
  })

  renderer.root.add(top)
  renderer.root.add(bottom)
  renderOnce()

  renderer.startSelection(top, top.x, top.y)
  renderer.updateSelection(bottom, bottom.x + bottom.width, bottom.y, { finishDragging: true })

  const gapLines = Math.max(bottom.y - top.y - 1, 0)
  expect(renderer.getSelection()?.getSelectedText()).toBe(["First row", ...Array(gapLines).fill(""), "Second row"].join("\n"))
})

test("selected text preserves blank lines within multiline renderables", () => {
  const text = new TextRenderable(renderer, {
    content: "First\n\nSecond",
    left: 0,
    top: 0,
    width: 10,
    height: 3,
    selectable: true,
  })

  renderer.root.add(text)
  renderOnce()

  renderer.startSelection(text, text.x, text.y)
  renderer.updateSelection(text, text.x + 6, text.y + 2, { finishDragging: true })

  expect(renderer.getSelection()?.getSelectedText()).toBe("First\n\nSecond")
})

test("selected text preserves vertical gaps between separated rows", () => {
  const top = new TextRenderable(renderer, {
    content: "First row",
    left: 0,
    top: 0,
    width: 9,
    height: 1,
    selectable: true,
  })
  const bottom = new TextRenderable(renderer, {
    content: "Second row",
    left: 0,
    top: 3,
    width: 10,
    height: 1,
    selectable: true,
  })

  renderer.root.add(top)
  renderer.root.add(bottom)
  renderOnce()

  renderer.startSelection(top, top.x, top.y)
  renderer.updateSelection(bottom, bottom.x + bottom.width, bottom.y, { finishDragging: true })

  const gapLines = Math.max(bottom.y - top.y - 1, 0)
  expect(renderer.getSelection()?.getSelectedText()).toBe(["First row", ...Array(gapLines).fill(""), "Second row"].join("\n"))
})

test("selected text preserves first-line indentation when selection starts at local column zero", () => {
  const top = new TextRenderable(renderer, {
    content: "First row",
    left: 4,
    top: 0,
    width: 9,
    height: 1,
    selectable: true,
  })
  const bottom = new TextRenderable(renderer, {
    content: "Second row",
    left: 0,
    top: 1,
    width: 10,
    height: 1,
    selectable: true,
  })

  renderer.root.add(top)
  renderer.root.add(bottom)
  renderOnce()

  renderer.startSelection(top, top.x, top.y)
  renderer.updateSelection(bottom, bottom.x + bottom.width, bottom.y, { finishDragging: true })

  const gapLines = Math.max(bottom.y - top.y - 1, 0)
  expect(renderer.getSelection()?.getSelectedText()).toBe(["    First row", ...Array(gapLines).fill(""), "Second row"].join("\n"))
})

test("selected text does not synthesize skipped indentation on the first copied line", () => {
  const top = new TextRenderable(renderer, {
    content: "First row",
    left: 4,
    top: 0,
    width: 9,
    height: 1,
    selectable: true,
  })
  const bottom = new TextRenderable(renderer, {
    content: "Second row",
    left: 0,
    top: 1,
    width: 10,
    height: 1,
    selectable: true,
  })

  renderer.root.add(top)
  renderer.root.add(bottom)
  renderOnce()

  renderer.startSelection(top, top.x + 1, top.y)
  renderer.updateSelection(bottom, bottom.x + bottom.width, bottom.y, { finishDragging: true })

  const gapLines = Math.max(bottom.y - top.y - 1, 0)
  expect(renderer.getSelection()?.getSelectedText()).toBe(["irst row", ...Array(gapLines).fill(""), "Second row"].join("\n"))
})

test("selected text does not infer blank rows from renderable height", () => {
  const top = new TextRenderable(renderer, {
    content: "First row",
    left: 0,
    top: 0,
    width: 9,
    height: 3,
    selectable: true,
  })
  const bottom = new TextRenderable(renderer, {
    content: "Second row",
    left: 0,
    top: 4,
    width: 10,
    height: 1,
    selectable: true,
  })

  renderer.root.add(top)
  renderer.root.add(bottom)
  renderOnce()

  renderer.startSelection(top, top.x, top.y)
  renderer.updateSelection(bottom, bottom.x + bottom.width, bottom.y, { finishDragging: true })

  const topVisualEndY = top.y + top.height - 1
  const gapLines = Math.max(bottom.y - topVisualEndY - 1, 0)
  expect(renderer.getSelection()?.getSelectedText()).toBe(["First row", ...Array(gapLines).fill(""), "Second row"].join("\n"))
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
