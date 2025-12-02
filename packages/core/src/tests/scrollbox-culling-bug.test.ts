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

  // Start recording frames
  const recorder = new TestRecorder(testRenderer)
  recorder.rec()

  // Add 5 items with sleep after each to give renderer time
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

  // Wait for renderer to be idle
  await testRenderer.idle()

  // Stop recording
  recorder.stop()

  // Get all frames
  const frames = recorder.recordedFrames
  console.log(`\nRecorded ${frames.length} frames\n`)

  // Check ALL frames to see if the bug occurs in any of them
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i].frame
    console.log(`Frame ${i}:`)
    console.log(frame)
    console.log("---\n")
  }

  // Check EVERY frame after the first item is added
  // With stickyScroll to bottom, there should NEVER be empty space at the bottom
  // when there are items available to render

  for (let frameIdx = 0; frameIdx < frames.length; frameIdx++) {
    const frame = frames[frameIdx].frame
    const lines = frame.split("\n")

    // Find the container borders - look for borders that start at column 0
    const containerStart = lines.findIndex((line) => line.startsWith("┌"))
    // The container bottom is at a known position (line containerStart + container.height - 1)
    const containerEnd = containerStart + 10 - 1 // container height is 10

    if (containerStart >= 0 && containerEnd > containerStart && containerEnd < lines.length) {
      const contentLines = lines.slice(containerStart + 1, containerEnd)

      // Count empty lines at bottom (lines with no actual content, just borders/whitespace)
      let emptyLinesAtBottom = 0

      for (let i = contentLines.length - 1; i >= 0; i--) {
        const line = contentLines[i]
        // Remove left/right borders, scrollbar chars, and whitespace
        // An empty content line will have nothing left
        const content = line.replace(/^[│\s]*/, "").replace(/[│█▄\s]*$/, "")

        if (content.length === 0) {
          emptyLinesAtBottom++
        } else {
          break
        }
      }

      // Check how many items should exist at this frame
      // Frame 0 = 1 item, Frame 1 = 2 items, etc.
      const expectedItems = frameIdx + 1

      console.log(`Frame ${frameIdx}: ${expectedItems} items, ${emptyLinesAtBottom} empty lines at bottom`)

      // With stickyScroll to bottom, once we have enough items to fill the viewport,
      // there should be NO empty space at the bottom
      // Viewport is 8 lines (10 - 2 for borders), items are 3 lines each
      // So with 3+ items (9 lines of content), we should always fill the viewport
      if (expectedItems >= 3) {
        expect(emptyLinesAtBottom).toBe(0)
      }
    }
  }

  // Also verify the last item text is in the final frame
  const finalFrame = frames[frames.length - 1].frame
  const hasLastItem = finalFrame.includes("Item 4")
  console.log(`\nFinal frame contains "Item 4": ${hasLastItem}`)
  expect(hasLastItem).toBe(true)
})
