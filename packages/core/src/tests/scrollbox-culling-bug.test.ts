import { test, expect, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer } from "../testing"
import { ScrollBoxRenderable } from "../renderables/ScrollBox"
import { BoxRenderable } from "../renderables/Box"

let testRenderer: TestRenderer
let renderOnce: () => Promise<void>

beforeEach(async () => {
  ;({ renderer: testRenderer, renderOnce } = await createTestRenderer({ width: 95, height: 29 }))
})

afterEach(() => {
  testRenderer.destroy()
})

test("viewport culling bug: reports 1 visible when translateY changes but child positions are stale", async () => {
  // BUG from console logs _console_1764695860206 line 1007-1088:
  // Sequence:
  //   1. content.updateFromLayout() updates content size, triggers onSizeChange
  //   2. onSizeChange -> recalculateBarProps -> changes translateY from -845 to -863
  //   3. _getVisibleChildren() is called (within same updateLayout)
  //   4. BUT children haven't had updateFromLayout called yet, so their _y values are from previous frame
  //   5. Result: culling incorrectly reports 1 visible instead of 2

  const scrollBox = new ScrollBoxRenderable(testRenderer, {
    width: 92,
    height: 27,
    stickyScroll: true,
    stickyStart: "bottom",
  })

  testRenderer.root.add(scrollBox)
  await renderOnce()

  // Add 48 items, each 18px tall (17px height + 1px margin)
  // Total = 48 * 18 = 864px, maxScroll = 864 - 27 = 837
  for (let i = 0; i < 48; i++) {
    const item = new BoxRenderable(testRenderer, {
      id: `event-${i}`,
      height: 17,
      marginBottom: 1,
    })
    scrollBox.add(item)
  }

  await renderOnce()

  // Verify scrolled to bottom
  const maxScroll48 = Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height)
  expect(scrollBox.scrollTop).toBe(maxScroll48)

  // Should have 2 items visible (viewport 27px, items 18px each)
  const visibleBefore = (scrollBox.content as any)._getVisibleChildren().length
  expect(visibleBefore).toBe(2)

  // Add item #48 - this grows content from 864px to 882px
  // maxScroll changes from 837 to 855
  // recalculateBarProps will set scroll to 855 (jump of 18px)
  const item48 = new BoxRenderable(testRenderer, {
    id: `event-48`,
    height: 17,
    marginBottom: 1,
  })
  scrollBox.add(item48)

  // DON'T render yet - trigger the internal update sequence manually
  // to catch the bug at the exact moment it happens

  // Manually trigger what happens during updateLayout:
  // 1. Parent updateFromLayout updates size
  testRenderer.root.yogaNode.calculateLayout(testRenderer.width, testRenderer.height, 0)
  scrollBox.updateFromLayout()
  scrollBox.wrapper.updateFromLayout()
  scrollBox.viewport.updateFromLayout()

  // 2. Content updateFromLayout triggers onSizeChange which calls recalculateBarProps
  const oldTranslateY = scrollBox.content.translateY
  scrollBox.content.updateFromLayout() // This triggers onSizeChange -> recalculateBarProps
  const newTranslateY = scrollBox.content.translateY

  // Verify translateY changed
  expect(newTranslateY).not.toBe(oldTranslateY)
  expect(Math.abs(newTranslateY - oldTranslateY)).toBeGreaterThan(10)

  // 3. NOW call _getVisibleChildren - this is where the bug happens
  // Children's _y values haven't been updated yet (updateFromLayout not called on them)
  // but translateY has changed, causing incorrect culling
  const visibleDuringBug = (scrollBox.content as any)._getVisibleChildren().length

  // THE BUG: This will be 1, but should be 2
  // With viewport=27px and items=18px each, 2 items should fit
  expect(visibleDuringBug).toBe(2)
})
