import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { BoxRenderable } from "../renderables/Box.js"
import { TextareaRenderable } from "../renderables/Textarea.js"
import { TextRenderable } from "../renderables/Text.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"

// Native-backed measurement wires renderables to native state (measure targets,
// Yoga measure funcs, handles). These tests lock the lifecycle behavior:
// destroying renderables must detach cleanly while the rest of the tree keeps
// measuring, including under create/layout/destroy churn.

let renderer: TestRenderer
let renderOnce: () => Promise<void>

beforeEach(async () => {
  ;({ renderer, renderOnce } = await createTestRenderer({ width: 80, height: 30 }))
})

afterEach(() => {
  renderer.destroy()
})

function maybeCollectGarbage(): void {
  const bun = (globalThis as { Bun?: { gc?: (force?: boolean) => void } }).Bun
  bun?.gc?.(false)
}

function expectSize(
  renderable: TextRenderable | TextareaRenderable,
  expected: { width: number; height: number },
): void {
  expect(renderable.width).toBeCloseTo(expected.width, 5)
  expect(renderable.height).toBeCloseTo(expected.height, 5)
}

describe("native-backed measurement lifecycle", () => {
  test("destroying a text renderable keeps sibling measurement working", async () => {
    const parent = new BoxRenderable(renderer, { width: 40, flexDirection: "column", alignItems: "flex-start" })
    const first = new TextRenderable(renderer, { content: "AAAAA", wrapMode: "none", alignSelf: "flex-start" })
    const second = new TextRenderable(renderer, { content: "BBBBBBBBBB", wrapMode: "none", alignSelf: "flex-start" })
    parent.add(first)
    parent.add(second)
    renderer.root.add(parent)
    await renderOnce()

    expectSize(first, { width: 5, height: 1 })
    expectSize(second, { width: 10, height: 1 })

    first.destroy()
    await renderOnce()
    expectSize(second, { width: 10, height: 1 })

    second.content = "CCC"
    await renderOnce()
    expectSize(second, { width: 3, height: 1 })
  })

  test("destroying a textarea keeps sibling measurement working", async () => {
    const parent = new BoxRenderable(renderer, { width: 40, flexDirection: "column", alignItems: "flex-start" })
    const first = new TextareaRenderable(renderer, { initialValue: "AAAAA", wrapMode: "none", alignSelf: "flex-start" })
    const second = new TextareaRenderable(renderer, {
      initialValue: "BBBBBBBBBB",
      wrapMode: "none",
      alignSelf: "flex-start",
    })
    parent.add(first)
    parent.add(second)
    renderer.root.add(parent)
    await renderOnce()

    expectSize(first, { width: 5, height: 1 })
    expectSize(second, { width: 10, height: 1 })

    first.destroy()
    await renderOnce()
    expectSize(second, { width: 10, height: 1 })

    second.setText("CCC")
    await renderOnce()
    expectSize(second, { width: 3, height: 1 })
  })

  test("survives create/layout/destroy churn of native-backed renderables", async () => {
    for (let round = 0; round < 20; round++) {
      const container = new BoxRenderable(renderer, { flexDirection: "column", alignItems: "flex-start" })
      renderer.root.add(container)

      const texts: TextRenderable[] = []
      const textareas: TextareaRenderable[] = []
      for (let index = 0; index < 16; index++) {
        const width = 1 + ((round + index) % 20)
        const text = new TextRenderable(renderer, {
          content: "X".repeat(width),
          wrapMode: "none",
          alignSelf: "flex-start",
        })
        texts.push(text)
        container.add(text)
      }
      for (let index = 0; index < 6; index++) {
        const width = 1 + ((round + index) % 15)
        const textarea = new TextareaRenderable(renderer, {
          initialValue: "Y".repeat(width),
          wrapMode: "none",
          alignSelf: "flex-start",
        })
        textareas.push(textarea)
        container.add(textarea)
      }

      await renderOnce()

      for (const [index, text] of texts.entries()) {
        expectSize(text, { width: 1 + ((round + index) % 20), height: 1 })
      }
      for (const [index, textarea] of textareas.entries()) {
        expectSize(textarea, { width: 1 + ((round + index) % 15), height: 1 })
      }

      // Alternate destroy orders: children-first and recursive subtree destroy.
      if (round % 2 === 0) {
        for (const text of texts) text.destroy()
        for (const textarea of textareas) textarea.destroy()
        container.destroy()
      } else {
        container.destroyRecursively()
      }

      if (round % 5 === 0) maybeCollectGarbage()
      await renderOnce()
    }
  })
})
