import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../index"
import { createSignal, createMemo, createEffect, For } from "solid-js"
import type { ScrollBoxRenderable } from "../../core/src/renderables"
import { SyntaxStyle } from "../../core/src/syntax-style"
import { MockTreeSitterClient } from "@opentui/core/testing"

let testSetup: Awaited<ReturnType<typeof testRender>>
let mockTreeSitterClient: MockTreeSitterClient

describe("ScrollBox Content Visibility", () => {
  beforeEach(async () => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
    mockTreeSitterClient = new MockTreeSitterClient()
    mockTreeSitterClient.setMockResult({ highlights: [] })
  })

  afterEach(() => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
  })

  it("maintains content visibility when adding many items and scrolling", async () => {
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

    await testSetup.renderOnce()
    const initialFrame = testSetup.captureCharFrame()
    expect(initialFrame).toContain("Header Content")
    expect(initialFrame).toContain("Footer Content")

    setCount(100)
    await testSetup.renderOnce()

    if (scrollRef) {
      scrollRef.scrollTo(scrollRef.scrollHeight)
      await testSetup.renderOnce()
    }

    const frameAfterScroll = testSetup.captureCharFrame()

    expect(frameAfterScroll).toContain("Header Content")
    expect(frameAfterScroll).toContain("Footer Content")

    const hasMessageContent = /Message \d+/.test(frameAfterScroll)
    expect(hasMessageContent).toBe(true)

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
                  <code
                    drawUnstyledText={false}
                    syntaxStyle={syntaxStyle}
                    content={code}
                    filetype="markdown"
                    treeSitterClient={mockTreeSitterClient}
                  />
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

    await testSetup.renderOnce()
    const initialFrame = testSetup.captureCharFrame()
    expect(initialFrame).toContain("Some visual content")

    setCount(100)
    await testSetup.renderOnce()

    for (let i = 0; i < 100; i++) {
      mockTreeSitterClient.resolveHighlightOnce()
    }
    await new Promise((resolve) => setTimeout(resolve, 1))

    if (scrollRef) {
      scrollRef.scrollTo(scrollRef.scrollHeight)
      await testSetup.renderOnce()
    }

    const frameAfterScroll = testSetup.captureCharFrame()

    expect(frameAfterScroll).toContain("Some visual content")

    const hasCodeContent =
      frameAfterScroll.includes("HELLO") ||
      frameAfterScroll.includes("world") ||
      frameAfterScroll.includes("<div") ||
      frameAfterScroll.includes("```") ||
      frameAfterScroll.includes("class=")

    expect(hasCodeContent).toBe(true)

    const nonWhitespaceChars = frameAfterScroll.replace(/\s/g, "").length
    expect(nonWhitespaceChars).toBeGreaterThan(50)
  })

  it("maintains visibility with many Code elements", async () => {
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
                  <code
                    drawUnstyledText={false}
                    syntaxStyle={syntaxStyle}
                    content={`Item ${i}`}
                    filetype="markdown"
                    treeSitterClient={mockTreeSitterClient}
                  />
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

    await testSetup.renderOnce()

    setCount(50)
    await testSetup.renderOnce()

    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 1))

    if (scrollRef) {
      scrollRef.scrollTo(scrollRef.scrollHeight)
    }
    await testSetup.renderOnce()

    const frame = testSetup.captureCharFrame()

    expect(frame).toContain("Header")
    expect(frame).toContain("Footer")

    const hasItems = /Item \d+/.test(frame)
    expect(hasItems).toBe(true)

    const nonWhitespaceChars = frame.replace(/\s/g, "").length
    expect(nonWhitespaceChars).toBeGreaterThan(18)
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

    for (let i = 0; i < 50; i++) {
      setItems((prev) => [...prev, `Item ${i + 1}`])
    }
    await testSetup.renderOnce()

    if (scrollRef) {
      scrollRef.scrollTo(scrollRef.scrollHeight)
      await testSetup.renderOnce()
    }

    const frame = testSetup.captureCharFrame()

    const hasItems = /Item \d+/.test(frame)
    expect(hasItems).toBe(true)

    const nonWhitespaceChars = frame.replace(/\s/g, "").length
    expect(nonWhitespaceChars).toBeGreaterThan(10)
  })
})
