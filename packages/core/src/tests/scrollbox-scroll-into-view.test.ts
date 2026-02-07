import { test, expect, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer } from "../testing"
import { BoxRenderable } from "../renderables/Box"
import { ScrollBoxRenderable } from "../renderables/ScrollBox"

let testRenderer: TestRenderer
let renderOnce: () => Promise<void>

beforeEach(async () => {
  ;({ renderer: testRenderer, renderOnce } = await createTestRenderer({ width: 80, height: 24 }))
})

afterEach(() => {
  testRenderer.destroy()
})

// ═══════════════════════════════════════════════════════════════════════════════
// Renderable.scrollIntoView()
// ═══════════════════════════════════════════════════════════════════════════════

test("child below viewport scrolls down", async () => {
  const scrollbox = new ScrollBoxRenderable(testRenderer, {
    id: "sb",
    width: 40,
    height: 10,
  })

  // Create children taller than the viewport
  const a = new BoxRenderable(testRenderer, { id: "a", width: 40, height: 5 })
  const b = new BoxRenderable(testRenderer, { id: "b", width: 40, height: 5 })
  const c = new BoxRenderable(testRenderer, { id: "c", width: 40, height: 5 })
  scrollbox.add(a)
  scrollbox.add(b)
  scrollbox.add(c)
  testRenderer.root.add(scrollbox)

  await renderOnce()

  expect(scrollbox.scrollTop).toBe(0)

  c.scrollIntoView()
  expect(scrollbox.scrollTop).toBeGreaterThan(0)
})

test("child above viewport scrolls up", async () => {
  const scrollbox = new ScrollBoxRenderable(testRenderer, {
    id: "sb",
    width: 40,
    height: 10,
  })

  const a = new BoxRenderable(testRenderer, { id: "a", width: 40, height: 5 })
  const b = new BoxRenderable(testRenderer, { id: "b", width: 40, height: 5 })
  const c = new BoxRenderable(testRenderer, { id: "c", width: 40, height: 5 })
  scrollbox.add(a)
  scrollbox.add(b)
  scrollbox.add(c)
  testRenderer.root.add(scrollbox)

  await renderOnce()

  // Scroll to bottom first
  scrollbox.scrollTop = 99
  await renderOnce()

  const prevScroll = scrollbox.scrollTop

  // Scroll first child into view — should scroll up
  a.scrollIntoView()
  expect(scrollbox.scrollTop).toBe(0)
  expect(scrollbox.scrollTop).toBeLessThan(prevScroll)
})

test("child already visible - no scroll change", async () => {
  const scrollbox = new ScrollBoxRenderable(testRenderer, {
    id: "sb",
    width: 40,
    height: 20,
  })

  const a = new BoxRenderable(testRenderer, { id: "a", width: 40, height: 5 })
  scrollbox.add(a)
  testRenderer.root.add(scrollbox)

  await renderOnce()

  expect(scrollbox.scrollTop).toBe(0)
  a.scrollIntoView()
  expect(scrollbox.scrollTop).toBe(0)
})

test("no scrollbox ancestor - no crash", () => {
  const box = new BoxRenderable(testRenderer, { id: "box", width: 40, height: 10 })
  const child = new BoxRenderable(testRenderer, { id: "child", width: 10, height: 5 })
  box.add(child)
  testRenderer.root.add(box)

  // Should not throw
  expect(() => child.scrollIntoView()).not.toThrow()
})

test("nested containers - finds scrollbox through wrapper", async () => {
  const scrollbox = new ScrollBoxRenderable(testRenderer, {
    id: "sb",
    width: 40,
    height: 10,
  })

  const wrapper = new BoxRenderable(testRenderer, { id: "wrapper", width: 40, height: 15 })
  const deep = new BoxRenderable(testRenderer, { id: "deep", width: 40, height: 5 })
  wrapper.add(deep)

  const spacer = new BoxRenderable(testRenderer, { id: "spacer", width: 40, height: 10 })
  scrollbox.add(spacer)
  scrollbox.add(wrapper)
  testRenderer.root.add(scrollbox)

  await renderOnce()

  // deep is nested inside wrapper, which is inside scrollbox after a spacer
  deep.scrollIntoView()
  expect(scrollbox.scrollTop).toBeGreaterThan(0)
})
