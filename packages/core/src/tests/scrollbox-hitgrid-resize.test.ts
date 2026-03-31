import { test, expect } from "bun:test"
import { createTestRenderer, type MockMouse, type TestRenderer } from "../testing.js"
import { ScrollBoxRenderable } from "../renderables/ScrollBox.js"
import { BoxRenderable } from "../renderables/Box.js"
import { Renderable } from "../Renderable.js"

test("hit grid works at all Y coordinates after terminal shrink", async () => {
  // Start wide: 160x50 = 8000 cells
  const { renderer, mockMouse, resize } = await createTestRenderer({
    width: 160,
    height: 50,
  })

  const scrollBox = new ScrollBoxRenderable(renderer, {
    width: "100%",
    height: "100%",
    scrollY: true,
  })
  renderer.root.add(scrollBox)

  const items: BoxRenderable[] = []
  for (let i = 0; i < 200; i++) {
    const item = new BoxRenderable(renderer, {
      id: `item-${i}`,
      height: 2,
    })
    items.push(item)
    scrollBox.add(item)
  }

  await renderer.idle()

  // Verify hit grid works at the original size
  const hitBefore = renderer.hitTest(5, 10)
  expect(hitBefore).not.toBe(0)

  // Shrink to narrow+tall: 60x100 = 6000 cells (smaller total area)
  resize(60, 100)
  renderer.root.resize(60, 100)
  await renderer.idle()

  // Row 70 is beyond the old height (50). Before the fix, checkHit
  // returned 0 here because hitGridHeight was still 50.
  const hitAtRow70 = renderer.hitTest(5, 70)
  expect(hitAtRow70).not.toBe(0)

  // Row 95 -- near the bottom of the new terminal
  const hitAtRow95 = renderer.hitTest(5, 95)
  expect(hitAtRow95).not.toBe(0)

  renderer.destroy()
})

test("mouse scroll reaches scrollbox after terminal shrink", async () => {
  const { renderer, mockMouse, resize } = await createTestRenderer({
    width: 160,
    height: 50,
  })

  const scrollBox = new ScrollBoxRenderable(renderer, {
    width: "100%",
    height: "100%",
    scrollY: true,
  })
  renderer.root.add(scrollBox)

  for (let i = 0; i < 200; i++) {
    scrollBox.add(
      new BoxRenderable(renderer, {
        id: `item-${i}`,
        height: 2,
      }),
    )
  }

  await renderer.idle()

  // Shrink terminal
  resize(60, 100)
  renderer.root.resize(60, 100)
  await renderer.idle()

  // Scroll to bottom first so we have room to scroll up
  scrollBox.scrollTop = scrollBox.scrollHeight - 100
  await renderer.idle()
  const positionBefore = scrollBox.scrollTop

  // Mouse wheel at row 70 (beyond the old height of 50)
  await mockMouse.scroll(30, 70, "up")
  await renderer.idle()

  // scrollTop should have decreased -- the scroll event reached the scrollbox
  expect(scrollBox.scrollTop).toBeLessThan(positionBefore)

  renderer.destroy()
})

test("hit grid works after multiple resize cycles", async () => {
  const { renderer, resize } = await createTestRenderer({
    width: 80,
    height: 40,
  })

  const box = new BoxRenderable(renderer, {
    id: "target",
    width: "100%",
    height: "100%",
  })
  renderer.root.add(box)
  await renderer.idle()

  // Grow: 80x40=3200 -> 120x60=7200
  resize(120, 60)
  renderer.root.resize(120, 60)
  await renderer.idle()
  expect(renderer.hitTest(5, 55)).not.toBe(0)

  // Shrink back: 120x60=7200 -> 80x40=3200
  resize(80, 40)
  renderer.root.resize(80, 40)
  await renderer.idle()
  expect(renderer.hitTest(5, 35)).not.toBe(0)
  // x=100 is outside the new width, should return 0
  expect(renderer.hitTest(100, 10)).toBe(0)

  // Shrink further: 80x40=3200 -> 40x30=1200
  resize(40, 30)
  renderer.root.resize(40, 30)
  await renderer.idle()
  expect(renderer.hitTest(5, 25)).not.toBe(0)
  // Old coordinates should be out of bounds
  expect(renderer.hitTest(5, 35)).toBe(0)
  expect(renderer.hitTest(50, 10)).toBe(0)

  renderer.destroy()
})
