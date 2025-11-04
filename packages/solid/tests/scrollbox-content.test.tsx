/**
 * Tests for scrollbox content visibility bug.
 *
 * ISSUE: When adding many items to a scrollbox and scrolling to the bottom,
 * the content inside the scrollbox disappears (becomes blank) while the
 * surrounding content (header/footer) remains visible.
 *
 * This test suite reproduces the bug with various scenarios:
 * 1. Simple text content (passes - no bug)
 * 2. Code element with syntax highlighting (FAILS - reproduces bug)
 * 3. Large code blocks (FAILS - reproduces bug)
 *
 * The tests capture frames and verify content is not blank/missing.
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../index"
import { createSignal, createMemo, createEffect, For } from "solid-js"
import type { ScrollBoxRenderable } from "../../core/src/renderables"
import { SyntaxStyle } from "../../core/src/syntax-style"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("ScrollBox Content Visibility", () => {
  beforeEach(async () => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
  })

  afterEach(() => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
  })

  it("should not have blank content after adding many items and scrolling", async () => {
    const [count, setCount] = createSignal(0)
    const messages = createMemo(() => Array.from({ length: count() }, (_, i) => `Message ${i + 1}`))

    let scrollRef: ScrollBoxRenderable | undefined

    testSetup = await testRender(
      () => (
        <box flexDirection="column" gap={1}>
          <box flexShrink={0}>
            <text>Header Content</text>
          </box>
          <scrollbox ref={(r) => (scrollRef = r)} focused stickyScroll={true} stickyStart="bottom" flexGrow={1}>
            <For each={messages()}>
              {(msg) => (
                <box marginTop={1} marginBottom={1}>
                  <text>{msg}</text>
                </box>
              )}
            </For>
          </scrollbox>
          <box flexShrink={0}>
            <text>Footer Content</text>
          </box>
        </box>
      ),
      {
        width: 40,
        height: 20,
      },
    )

    // Render initial state (empty)
    await testSetup.renderOnce()
    const initialFrame = testSetup.captureCharFrame()
    expect(initialFrame).toContain("Header Content")
    expect(initialFrame).toContain("Footer Content")

    // Add many items
    setCount(100)
    await testSetup.renderOnce()

    // Scroll to bottom
    if (scrollRef) {
      scrollRef.scrollTo(scrollRef.scrollHeight)
      await testSetup.renderOnce()
    }

    // Capture frame after scrolling
    const frameAfterScroll = testSetup.captureCharFrame()

    // The issue: content disappears (frame is blank or missing expected content)
    // Check that we still have visible content
    expect(frameAfterScroll).toContain("Header Content")
    expect(frameAfterScroll).toContain("Footer Content")

    // Should show some messages (the ones that fit in the viewport)
    const hasMessageContent = /Message \d+/.test(frameAfterScroll)
    expect(hasMessageContent).toBe(true)

    // Frame should not be mostly blank/empty
    const nonWhitespaceChars = frameAfterScroll.replace(/\s/g, "").length
    expect(nonWhitespaceChars).toBeGreaterThan(20)
  })

  it("should maintain content visibility with code blocks in scrollbox", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])
    const codeBlock = `

# HELLO

world

## HELLO World

\`\`\`html
<div
  class="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 relative overflow-hidden"
>
  <!-- Sakura Petals Background Animation -->
  <div class="absolute inset-0 pointer-events-none">
    <div class="sakura-petal absolute top-10 left-20 animate-pulse opacity-60">
      🌸
    </div>
    <div
      class="sakura-petal absolute top-1/2 right-20 animate-pulse opacity-45"
      style="animation-delay: 1.5s"
    >
      🌸
    </div>
    <div
      class="sakura-petal absolute bottom-40 right-1/3 animate-pulse opacity-55"
      style="animation-delay: 0.5s"
    >
      🌸
    </div>
  </div>
/div>
\`\`\`


`

    const [count, setCount] = createSignal(0)
    const messages = createMemo(() => Array.from({ length: count() }, (_, i) => codeBlock))

    let scrollRef: ScrollBoxRenderable | undefined

    testSetup = await testRender(
      () => (
        <box flexDirection="column" gap={1}>
          <box flexShrink={0}>
            <text>Some visual content</text>
          </box>
          <scrollbox ref={(r) => (scrollRef = r)} focused stickyScroll={true} stickyStart="bottom" flexGrow={1}>
            <For each={messages()}>
              {(code) => (
                <box marginTop={2} marginBottom={2}>
                  <code drawUnstyledText={false} syntaxStyle={syntaxStyle} content={code} filetype="markdown" />
                </box>
              )}
            </For>
          </scrollbox>
          <box flexShrink={0}>
            <text>Some visual content</text>
          </box>
        </box>
      ),
      {
        width: 80,
        height: 30,
      },
    )

    // Render initial state
    await testSetup.renderOnce()
    const initialFrame = testSetup.captureCharFrame()
    expect(initialFrame).toContain("Some visual content")

    // Add many code blocks - exactly as in tmp.tsx
    setCount(100)
    await testSetup.renderOnce()

    // Scroll to bottom - with a small delay as in tmp.tsx
    if (scrollRef) {
      scrollRef.scrollTo(scrollRef.scrollHeight)
      await testSetup.renderOnce()
    }

    // Capture frame after scrolling
    const frameAfterScroll = testSetup.captureCharFrame()

    // Check that header/footer are still visible
    expect(frameAfterScroll).toContain("Some visual content")

    // BUG: The scrollbox content should be visible but it's not!
    // After adding 100 items and scrolling to bottom, the scrollbox area is blank.
    // This test demonstrates the disappearing content issue.
    const hasCodeContent =
      frameAfterScroll.includes("HELLO") ||
      frameAfterScroll.includes("world") ||
      frameAfterScroll.includes("<div") ||
      frameAfterScroll.includes("```") ||
      frameAfterScroll.includes("class=")

    // This should pass but fails due to the bug
    expect(hasCodeContent).toBe(true)

    // The scrollbox should not be completely blank
    // Count non-whitespace characters - should have more than just header/footer
    const nonWhitespaceChars = frameAfterScroll.replace(/\s/g, "").length
    // Just header + footer is ~35 chars, so we expect much more with content
    expect(nonWhitespaceChars).toBeGreaterThan(50)
  })

  it("should show scrollbox content after adding many items with code element (MINIMAL REPRO)", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])
    const [count, setCount] = createSignal(0)

    let scrollRef: ScrollBoxRenderable | undefined

    testSetup = await testRender(
      () => (
        <box flexDirection="column" gap={1}>
          <box flexShrink={0}>
            <text>Header</text>
          </box>
          <scrollbox ref={(r) => (scrollRef = r)} focused stickyScroll={true} stickyStart="bottom" flexGrow={1}>
            <For each={Array.from({ length: count() }, (_, i) => i)}>
              {(i) => (
                <box marginTop={1} marginBottom={1}>
                  <code drawUnstyledText={false} syntaxStyle={syntaxStyle} content={`Item ${i}`} filetype="markdown" />
                </box>
              )}
            </For>
          </scrollbox>
          <box flexShrink={0}>
            <text>Footer</text>
          </box>
        </box>
      ),
      {
        width: 40,
        height: 20,
      },
    )

    // Initial render
    await testSetup.renderOnce()

    // Add many items
    setCount(50)
    await testSetup.renderOnce()

    // Scroll to bottom
    if (scrollRef) {
      scrollRef.scrollTo(scrollRef.scrollHeight)
      await testSetup.renderOnce()
    }

    const frame = testSetup.captureCharFrame()

    // Should have header and footer
    expect(frame).toContain("Header")
    expect(frame).toContain("Footer")

    // BUG: Should have visible items in the scrollbox but they disappear
    const hasItems = /Item \d+/.test(frame)
    expect(hasItems).toBe(true)

    // Should not be mostly blank
    const nonWhitespaceChars = frame.replace(/\s/g, "").length
    expect(nonWhitespaceChars).toBeGreaterThan(20)
  })

  it("should maintain content when rapidly updating and scrolling", async () => {
    const [items, setItems] = createSignal<string[]>([])
    let scrollRef: ScrollBoxRenderable | undefined

    testSetup = await testRender(
      () => (
        <box flexDirection="column">
          <scrollbox ref={(r) => (scrollRef = r)} focused stickyScroll={true} flexGrow={1}>
            <For each={items()}>
              {(item) => (
                <box>
                  <text>{item}</text>
                </box>
              )}
            </For>
          </scrollbox>
        </box>
      ),
      {
        width: 40,
        height: 15,
      },
    )

    await testSetup.renderOnce()

    // Rapidly add items
    for (let i = 0; i < 50; i++) {
      setItems((prev) => [...prev, `Item ${i + 1}`])
    }
    await testSetup.renderOnce()

    // Scroll to bottom
    if (scrollRef) {
      scrollRef.scrollTo(scrollRef.scrollHeight)
      await testSetup.renderOnce()
    }

    const frame = testSetup.captureCharFrame()

    // Should have visible content
    const hasItems = /Item \d+/.test(frame)
    expect(hasItems).toBe(true)

    // Should not be blank
    const nonWhitespaceChars = frame.replace(/\s/g, "").length
    expect(nonWhitespaceChars).toBeGreaterThan(10)
  })
})
