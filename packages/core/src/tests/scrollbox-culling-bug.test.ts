import { test, expect, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer } from "../testing"
import { ScrollBoxRenderable } from "../renderables/ScrollBox"
import { BoxRenderable } from "../renderables/Box"
import { TextRenderable } from "../renderables/Text"
import { TestRecorder } from "../testing/test-recorder"

let testRenderer: TestRenderer

beforeEach(async () => {
  ;({ renderer: testRenderer } = await createTestRenderer({ width: 50, height: 12 }))
})

afterEach(() => {
  testRenderer.destroy()
})

test("scrollbox culling issue: last item not visible in frame after content grows with stickyScroll", async () => {
  // ISSUE: During updateLayout, when content.onSizeChange triggers recalculateBarProps,
  // it changes translateY via the scrollbar onChange callback. Then _getVisibleChildren()
  // is called for culling, but it uses the NEW translateY value with OLD child layout
  // positions (since children haven't had updateFromLayout called yet). This causes
  // incorrect culling where the last item is not rendered even though it should be visible.

  // Container box with border to see constraints clearly
  const container = new BoxRenderable(testRenderer, {
    width: 48,
    height: 10,
    border: true,
  })
  testRenderer.root.add(container)

  const scrollBox = new ScrollBoxRenderable(testRenderer, {
    width: "100%",
    height: "100%",
    stickyScroll: true,
    stickyStart: "bottom",
  })
  container.add(scrollBox)

  const recorder = new TestRecorder(testRenderer)
  recorder.rec()

  for (let i = 0; i < 50; i++) {
    const item = new BoxRenderable(testRenderer, {
      id: `item-${i}`,
      height: 3,
      border: true,
    })

    const text = new TextRenderable(testRenderer, {
      content: `Item ${i}`,
    })
    item.add(text)

    scrollBox.add(item)
    await Bun.sleep(10)
  }

  await testRenderer.idle()

  recorder.stop()

  const frames = recorder.recordedFrames

  // With stickyScroll to bottom, there should NEVER be empty space at the bottom
  // when there are items available to render

  for (let frameIdx = 0; frameIdx < frames.length; frameIdx++) {
    const frame = frames[frameIdx].frame
    const lines = frame.split("\n")

    const containerStart = lines.findIndex((line) => line.startsWith("┌"))
    const containerEnd = containerStart + 10 - 1

    if (containerStart >= 0 && containerEnd > containerStart && containerEnd < lines.length) {
      const contentLines = lines.slice(containerStart + 1, containerEnd)

      let emptyLinesAtBottom = 0

      for (let i = contentLines.length - 1; i >= 0; i--) {
        const line = contentLines[i]
        const content = line.replace(/^[│\s]*/, "").replace(/[│█▄\s]*$/, "")

        if (content.length === 0) {
          emptyLinesAtBottom++
        } else {
          break
        }
      }

      const expectedItems = frameIdx + 1

      // With stickyScroll to bottom, once we have enough items to fill the viewport,
      // there should be NO empty space at the bottom
      // Viewport is 8 lines (10 - 2 for borders), items are 3 lines each
      // So with 3+ items (9 lines of content), we should always fill the viewport
      if (expectedItems >= 3) {
        expect(emptyLinesAtBottom).toBe(0)
      }
    }
  }

  // With stickyScroll to bottom, the last item should be visible after all items are added
  const finalFrame = frames[frames.length - 1].frame
  const hasItem49 = finalFrame.includes("Item 49")
  expect(hasItem49).toBe(true)
})
