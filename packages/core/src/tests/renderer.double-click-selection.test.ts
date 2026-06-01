import { test, expect, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer, type MockMouse } from "../testing.js"
import { TextRenderable } from "../renderables/Text.js"

let renderer: TestRenderer
let mockMouse: MockMouse
let renderOnce: () => Promise<void>

beforeEach(async () => {
  ;({ renderer, mockMouse, renderOnce } = await createTestRenderer({ width: 40, height: 10 }))
})

afterEach(() => {
  renderer.destroy()
})

function addText(content: string): TextRenderable {
  const text = new TextRenderable(renderer, {
    content,
    width: 20,
    height: 1,
    selectable: true,
    position: "absolute",
    left: 0,
    top: 0,
  })
  renderer.root.add(text)
  return text
}

// "hello world" => h0 e1 l2 l3 o4 (space)5 w6 o7 r8 l9 d10

test("double-click selects the word under the cursor (mid-line)", async () => {
  addText("hello world")
  await renderOnce()

  // click on the 'r' in "world"
  await mockMouse.doubleClick(8, 0)

  expect(renderer.getSelection()?.getSelectedText()).toBe("world")
})

test("double-click selects the first word", async () => {
  addText("hello world")
  await renderOnce()

  // click on the second 'l' in "hello"
  await mockMouse.doubleClick(2, 0)

  expect(renderer.getSelection()?.getSelectedText()).toBe("hello")
})

test("double-click expands only to printable cell boundaries", async () => {
  // two single-character words separated by a space: "a bc"
  addText("a bc")
  await renderOnce()

  await mockMouse.doubleClick(2, 0) // the 'b'
  expect(renderer.getSelection()?.getSelectedText()).toBe("bc")
})
