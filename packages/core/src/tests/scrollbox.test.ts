import { test, expect, beforeEach, afterEach, describe } from "bun:test"
import { createTestRenderer, type TestRenderer, type MockMouse, MockTreeSitterClient } from "../testing"
import { ScrollBoxRenderable } from "../renderables/ScrollBox"
import { BoxRenderable } from "../renderables/Box"
import { TextRenderable } from "../renderables/Text"
import { CodeRenderable } from "../renderables/Code"
import { LinearScrollAccel, MacOSScrollAccel, type ScrollAcceleration } from "../lib/scroll-acceleration"
import { SyntaxStyle } from "../syntax-style"

// Test accelerator that returns a constant multiplier
class ConstantScrollAccel implements ScrollAcceleration {
  constructor(private multiplier: number) {}
  tick(_now?: number): number {
    return this.multiplier
  }
  reset(): void {}
}

let testRenderer: TestRenderer
let mockMouse: MockMouse
let renderOnce: () => Promise<void>
let captureCharFrame: () => string
let mockTreeSitterClient: MockTreeSitterClient

beforeEach(async () => {
  ;({
    renderer: testRenderer,
    mockMouse,
    renderOnce,
    captureCharFrame,
  } = await createTestRenderer({ width: 80, height: 24 }))
  mockTreeSitterClient = new MockTreeSitterClient()
  mockTreeSitterClient.setMockResult({ highlights: [] })
})

afterEach(() => {
  testRenderer.destroy()
})

describe("ScrollBoxRenderable - child delegation", () => {
  test("delegates add to content wrapper", () => {
    const scrollbox = new ScrollBoxRenderable(testRenderer, { id: "scrollbox" })
    const child = new BoxRenderable(testRenderer, { id: "child" })

    scrollbox.add(child)

    const children = scrollbox.getChildren()
    expect(children.length).toBe(1)
    expect(children[0].id).toBe("child")
    expect(child.parent).toBe(scrollbox.content)
  })

  test("delegates remove to content wrapper", () => {
    const scrollbox = new ScrollBoxRenderable(testRenderer, { id: "scrollbox" })
    const child = new BoxRenderable(testRenderer, { id: "child" })

    scrollbox.add(child)
    expect(scrollbox.getChildren().length).toBe(1)

    scrollbox.remove(child.id)
    expect(scrollbox.getChildren().length).toBe(0)
  })

  test("delegates insertBefore to content wrapper", () => {
    const scrollbox = new ScrollBoxRenderable(testRenderer, { id: "scrollbox" })
    const child1 = new BoxRenderable(testRenderer, { id: "child1" })
    const child2 = new BoxRenderable(testRenderer, { id: "child2" })
    const child3 = new BoxRenderable(testRenderer, { id: "child3" })

    scrollbox.add(child1)
    scrollbox.add(child2)
    scrollbox.insertBefore(child3, child2)

    const children = scrollbox.getChildren()
    expect(children.length).toBe(3)
    expect(children[0].id).toBe("child1")
    expect(children[1].id).toBe("child3")
    expect(children[2].id).toBe("child2")
  })
})

describe("ScrollBoxRenderable - clipping", () => {
  test("clips nested scrollbox content to inner viewport (see issue #388)", async () => {
    const root = new BoxRenderable(testRenderer, {
      flexDirection: "column",
      gap: 0,
      width: 32,
      height: 16,
    })

    const outer = new ScrollBoxRenderable(testRenderer, {
      width: 30,
      height: 10,
      border: true,
      overflow: "hidden",
      scrollY: true,
    })

    const inner = new ScrollBoxRenderable(testRenderer, {
      width: 26,
      height: 6,
      border: true,
      overflow: "hidden",
      scrollY: true,
    })

    for (let index = 0; index < 6; index += 1) {
      inner.add(new TextRenderable(testRenderer, { content: `LEAK-${index}` }))
    }

    outer.add(inner)
    root.add(outer)
    testRenderer.root.add(root)

    await renderOnce()

    const frame = captureCharFrame()
    const innerViewportHeight = 4 // height 6 minus top/bottom border
    const visibleLines = frame.split("\n").filter((line) => line.includes("LEAK-"))

    expect(visibleLines.length).toBeLessThanOrEqual(innerViewportHeight)
  })
})

describe("ScrollBoxRenderable - padding behavior", () => {
  test("applies scrollbox padding to content while keeping scrollbar docked", async () => {
    const noPadding = new ScrollBoxRenderable(testRenderer, {
      left: 0,
      top: 0,
      width: 26,
      height: 9,
      border: true,
      scrollY: true,
    })

    const padded = new ScrollBoxRenderable(testRenderer, {
      left: 0,
      top: 11,
      width: 26,
      height: 9,
      border: true,
      scrollY: true,
      padding: 2,
    })

    for (let index = 0; index < 24; index += 1) {
      noPadding.add(new TextRenderable(testRenderer, { content: `NP-${index}` }))
      padded.add(new TextRenderable(testRenderer, { content: `PD-${index}` }))
    }

    testRenderer.root.add(noPadding)
    testRenderer.root.add(padded)

    await renderOnce()

    expect(noPadding.verticalScrollBar.visible).toBe(true)
    expect(padded.verticalScrollBar.visible).toBe(true)
    expect(noPadding.verticalScrollBar.x).toBe(noPadding.x + noPadding.width - 2)
    expect(padded.verticalScrollBar.x).toBe(padded.x + padded.width - 2)

    const frameLines = captureCharFrame().split("\n")
    const noPaddingRow = frameLines.find((line) => line.includes("NP-0"))
    const paddedRow = frameLines.find((line) => line.includes("PD-0"))

    expect(noPaddingRow).toBeDefined()
    expect(paddedRow).toBeDefined()

    const noPaddingTextX = noPaddingRow?.indexOf("NP-0") ?? -1
    const paddedTextX = paddedRow?.indexOf("PD-0") ?? -1

    expect(paddedTextX).toBeGreaterThan(noPaddingTextX)
  })

  test("padding setter updates content inset without moving scrollbar", async () => {
    const scrollBox = new ScrollBoxRenderable(testRenderer, {
      width: 26,
      height: 9,
      border: true,
      scrollY: true,
    })

    for (let index = 0; index < 24; index += 1) {
      scrollBox.add(new TextRenderable(testRenderer, { content: `PX-${index}` }))
    }

    testRenderer.root.add(scrollBox)
    await renderOnce()

    const beforeScrollbarX = scrollBox.verticalScrollBar.x
    const beforeFrameLines = captureCharFrame().split("\n")
    const beforeRow = beforeFrameLines.find((line) => line.includes("PX-0"))
    const beforeTextX = beforeRow?.indexOf("PX-0") ?? -1

    scrollBox.padding = 2
    await renderOnce()

    const afterFrameLines = captureCharFrame().split("\n")
    const afterRow = afterFrameLines.find((line) => line.includes("PX-0"))
    const afterTextX = afterRow?.indexOf("PX-0") ?? -1

    expect(scrollBox.verticalScrollBar.x).toBe(beforeScrollbarX)
    expect(afterTextX).toBeGreaterThan(beforeTextX)
  })
})

describe("ScrollBoxRenderable - destroyRecursively", () => {
  test("destroys internal ScrollBox components", () => {
    const parent = new ScrollBoxRenderable(testRenderer, { id: "scroll-parent" })
    const child = new BoxRenderable(testRenderer, { id: "child" })

    parent.add(child)

    const wrapper = parent.wrapper
    const viewport = parent.viewport
    const content = parent.content
    const horizontalScrollBar = parent.horizontalScrollBar
    const verticalScrollBar = parent.verticalScrollBar

    expect(parent.isDestroyed).toBe(false)
    expect(child.isDestroyed).toBe(false)
    expect(wrapper.isDestroyed).toBe(false)
    expect(viewport.isDestroyed).toBe(false)
    expect(content.isDestroyed).toBe(false)
    expect(horizontalScrollBar.isDestroyed).toBe(false)
    expect(verticalScrollBar.isDestroyed).toBe(false)

    parent.destroyRecursively()

    expect(parent.isDestroyed).toBe(true)
    expect(child.isDestroyed).toBe(true)
    expect(wrapper.isDestroyed).toBe(true)
    expect(viewport.isDestroyed).toBe(true)
    expect(content.isDestroyed).toBe(true)
    expect(horizontalScrollBar.isDestroyed).toBe(true)
    expect(verticalScrollBar.isDestroyed).toBe(true)
  })
})

describe("ScrollBoxRenderable - Mouse interaction", () => {
  test("scrolls with mouse wheel", async () => {
    const scrollBox = new ScrollBoxRenderable(testRenderer, {
      width: 50,
      height: 20,
      scrollAcceleration: new MacOSScrollAccel({ A: 0 }),
    })
    for (let i = 0; i < 50; i++) scrollBox.add(new TextRenderable(testRenderer, { content: `Line ${i}` }))
    testRenderer.root.add(scrollBox)
    await renderOnce()

    await mockMouse.scroll(25, 10, "down")
    await renderOnce()
    expect(scrollBox.scrollTop).toBeGreaterThan(0)
  })

  test("single isolated scroll has same distance as linear", async () => {
    const linearBox = new ScrollBoxRenderable(testRenderer, {
      width: 50,
      height: 20,
      scrollAcceleration: new LinearScrollAccel(),
    })

    for (let i = 0; i < 100; i++) linearBox.add(new TextRenderable(testRenderer, { content: `Line ${i}` }))
    testRenderer.root.add(linearBox)
    await renderOnce()

    await mockMouse.scroll(25, 10, "down")
    await renderOnce()
    const linearDistance = linearBox.scrollTop

    testRenderer.destroy()
    ;({
      renderer: testRenderer,
      mockMouse,
      renderOnce,
      captureCharFrame,
    } = await createTestRenderer({ width: 80, height: 24 }))

    const accelBox = new ScrollBoxRenderable(testRenderer, {
      width: 50,
      height: 20,
      scrollAcceleration: new MacOSScrollAccel(),
    })

    for (let i = 0; i < 100; i++) accelBox.add(new TextRenderable(testRenderer, { content: `Line ${i}` }))
    testRenderer.root.add(accelBox)
    await renderOnce()

    await mockMouse.scroll(25, 10, "down")
    await renderOnce()

    expect(accelBox.scrollTop).toBe(linearDistance)
  })

  test("acceleration makes rapid scrolls cover more distance", async () => {
    const scrollBox = new ScrollBoxRenderable(testRenderer, {
      width: 50,
      height: 20,
      scrollAcceleration: new MacOSScrollAccel({ A: 0.8, tau: 3, maxMultiplier: 6 }),
    })
    for (let i = 0; i < 200; i++) scrollBox.add(new TextRenderable(testRenderer, { content: `Line ${i}` }))
    testRenderer.root.add(scrollBox)
    await renderOnce()

    await mockMouse.scroll(25, 10, "down")
    await renderOnce()
    const slowScrollDistance = scrollBox.scrollTop

    scrollBox.scrollTop = 0

    for (let i = 0; i < 5; i++) {
      await mockMouse.scroll(25, 10, "down")
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    await renderOnce()
    const rapidScrollDistance = scrollBox.scrollTop

    expect(rapidScrollDistance).toBeGreaterThan(slowScrollDistance * 3)
  })

  test("multiplier < 1 slows down scroll distance", async () => {
    // Test with slowdown using a constant multiplier < 1
    const slowdownBox = new ScrollBoxRenderable(testRenderer, {
      width: 50,
      height: 20,
      scrollAcceleration: new ConstantScrollAccel(0.5),
    })
    for (let i = 0; i < 200; i++) slowdownBox.add(new TextRenderable(testRenderer, { content: `Line ${i}` }))
    testRenderer.root.add(slowdownBox)
    await renderOnce()

    // Do multiple scrolls with delay to ensure they're treated as slow scrolls
    for (let i = 0; i < 5; i++) {
      await mockMouse.scroll(25, 10, "down")
      await renderOnce()
      // Add delay to prevent acceleration from kicking in
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    const slowdownDistance = slowdownBox.scrollTop

    testRenderer.destroy()
    ;({
      renderer: testRenderer,
      mockMouse,
      renderOnce,
      captureCharFrame,
    } = await createTestRenderer({
      width: 80,
      height: 24,
    }))

    // Compare with linear (no slowdown)
    const linearBox = new ScrollBoxRenderable(testRenderer, {
      width: 50,
      height: 20,
      scrollAcceleration: new LinearScrollAccel(),
    })
    for (let i = 0; i < 200; i++) linearBox.add(new TextRenderable(testRenderer, { content: `Line ${i}` }))
    testRenderer.root.add(linearBox)
    await renderOnce()

    for (let i = 0; i < 5; i++) {
      await mockMouse.scroll(25, 10, "down")
      await renderOnce()
      // Add delay to prevent acceleration from kicking in
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    const linearDistance = linearBox.scrollTop

    expect(slowdownDistance).toBeLessThan(linearDistance)
    expect(slowdownDistance).toBeGreaterThan(0)
  })

  test("multiplier < 1 accumulates fractional scroll amounts", async () => {
    const scrollBox = new ScrollBoxRenderable(testRenderer, {
      width: 50,
      height: 20,
      scrollAcceleration: new ConstantScrollAccel(0.3),
    })
    for (let i = 0; i < 200; i++) scrollBox.add(new TextRenderable(testRenderer, { content: `Line ${i}` }))
    testRenderer.root.add(scrollBox)
    await renderOnce()

    // With multiplier < 1, fractional amounts accumulate
    // It should take multiple scroll events to accumulate enough to scroll 1 full unit
    let scrolled = false
    for (let i = 0; i < 5; i++) {
      await mockMouse.scroll(25, 10, "down")
      await renderOnce()
      if (scrollBox.scrollTop > 0) {
        scrolled = true
        break
      }
    }

    expect(scrolled).toBe(true)
    expect(scrollBox.scrollTop).toBeGreaterThan(0)
  })

  test("horizontal scroll with multiplier < 1 works correctly", async () => {
    const scrollBox = new ScrollBoxRenderable(testRenderer, {
      width: 50,
      height: 20,
      scrollX: true,
      scrollAcceleration: new ConstantScrollAccel(0.4),
    })

    const wideBox = new BoxRenderable(testRenderer, { width: 300, height: 10 })
    scrollBox.add(wideBox)
    testRenderer.root.add(scrollBox)
    await renderOnce()

    await mockMouse.scroll(25, 10, "right")
    await renderOnce()

    // Should eventually scroll after multiple events due to accumulation
    let scrolled = false
    for (let i = 0; i < 5; i++) {
      await mockMouse.scroll(25, 10, "right")
      await renderOnce()
      if (scrollBox.scrollLeft > 0) {
        scrolled = true
        break
      }
    }

    expect(scrolled).toBe(true)
  })

  test("multiplier < 1 with acceleration work together", async () => {
    const scrollBox = new ScrollBoxRenderable(testRenderer, {
      width: 50,
      height: 20,
      scrollAcceleration: new ConstantScrollAccel(0.3),
    })
    for (let i = 0; i < 200; i++) scrollBox.add(new TextRenderable(testRenderer, { content: `Line ${i}` }))
    testRenderer.root.add(scrollBox)
    await renderOnce()

    // Multiple scrolls should accumulate fractional amounts
    for (let i = 0; i < 10; i++) {
      await mockMouse.scroll(25, 10, "down")
      await renderOnce()
    }
    const scrollDistance = scrollBox.scrollTop

    // With 0.3 multiplier and 10 scrolls: 10 * 1 * 0.3 = 3 pixels total
    // Math.trunc applied each time, so we get 2 pixels actually scrolled
    expect(scrollDistance).toBeGreaterThan(0)
    expect(scrollDistance).toBeLessThan(5)
  })
})

describe("ScrollBoxRenderable - Content Visibility", () => {
  test("maintains visibility when scrolling with many Code elements", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])

    const parent = new BoxRenderable(testRenderer, {
      flexDirection: "column",
      gap: 1,
    })

    const header = new BoxRenderable(testRenderer, { flexShrink: 0 })
    header.add(new TextRenderable(testRenderer, { content: "Header Content" }))

    const scrollBox = new ScrollBoxRenderable(testRenderer, {
      flexGrow: 1,
      stickyScroll: true,
      stickyStart: "bottom",
    })

    const footer = new BoxRenderable(testRenderer, { flexShrink: 0 })
    footer.add(new TextRenderable(testRenderer, { content: "Footer Content" }))

    parent.add(header)
    parent.add(scrollBox)
    parent.add(footer)
    testRenderer.root.add(parent)

    await renderOnce()
    const initialFrame = captureCharFrame()
    expect(initialFrame).toContain("Header Content")
    expect(initialFrame).toContain("Footer Content")

    const codeContent = `
# HELLO

world

## HELLO World

\`\`\`html
<div class="example">
  <p>Content</p>
</div>
\`\`\`
`

    for (let i = 0; i < 100; i++) {
      const wrapper = new BoxRenderable(testRenderer, {
        marginTop: 2,
        marginBottom: 2,
      })
      const code = new CodeRenderable(testRenderer, {
        content: codeContent,
        filetype: "markdown",
        syntaxStyle,
        drawUnstyledText: false,
        treeSitterClient: mockTreeSitterClient,
      })
      wrapper.add(code)
      scrollBox.add(wrapper)
    }

    await renderOnce()

    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 10))

    await renderOnce()

    scrollBox.scrollTo(scrollBox.scrollHeight)
    await renderOnce()

    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await renderOnce()

    const frameAfterScroll = captureCharFrame()

    expect(frameAfterScroll).toContain("Header Content")
    expect(frameAfterScroll).toContain("Footer Content")

    const hasCodeContent =
      frameAfterScroll.includes("HELLO") ||
      frameAfterScroll.includes("world") ||
      frameAfterScroll.includes("<div") ||
      frameAfterScroll.includes("```")

    expect(hasCodeContent).toBe(true)

    const nonWhitespaceChars = frameAfterScroll.replace(/\s/g, "").length
    expect(nonWhitespaceChars).toBeGreaterThan(50)
  })

  test("maintains visibility when scrolling with many Code elements (setter-based, like SolidJS)", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])

    const parent = new BoxRenderable(testRenderer, {
      flexDirection: "column",
      gap: 1,
    })

    const header = new BoxRenderable(testRenderer, { flexShrink: 0 })
    header.add(new TextRenderable(testRenderer, { content: "Header Content" }))

    const scrollBox = new ScrollBoxRenderable(testRenderer, {
      flexGrow: 1,
      stickyScroll: true,
      stickyStart: "bottom",
    })

    const footer = new BoxRenderable(testRenderer, { flexShrink: 0 })
    footer.add(new TextRenderable(testRenderer, { content: "Footer Content" }))

    parent.add(header)
    parent.add(scrollBox)
    parent.add(footer)
    testRenderer.root.add(parent)

    await renderOnce()
    const initialFrame = captureCharFrame()
    expect(initialFrame).toContain("Header Content")
    expect(initialFrame).toContain("Footer Content")

    const codeContent = `
# HELLO

world

## HELLO World

\`\`\`html
<div class="example">
  <p>Content</p>
</div>
\`\`\`
`

    for (let i = 0; i < 100; i++) {
      const wrapper = new BoxRenderable(testRenderer, { id: `wrapper-${i}` })
      wrapper.marginTop = 2
      wrapper.marginBottom = 2

      const code = new CodeRenderable(testRenderer, {
        id: `code-${i}`,
        syntaxStyle,
        drawUnstyledText: false,
        treeSitterClient: mockTreeSitterClient,
      })

      wrapper.add(code)
      code.content = codeContent
      code.filetype = "markdown"

      scrollBox.add(wrapper)
    }

    await testRenderer.idle()

    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 1))

    await testRenderer.idle()

    scrollBox.scrollTo(scrollBox.scrollHeight)
    await testRenderer.idle()

    const frameAfterScroll = captureCharFrame()

    expect(frameAfterScroll).toContain("Header Content")
    expect(frameAfterScroll).toContain("Footer Content")

    const hasCodeContent =
      frameAfterScroll.includes("HELLO") ||
      frameAfterScroll.includes("world") ||
      frameAfterScroll.includes("<div") ||
      frameAfterScroll.includes("```")

    expect(hasCodeContent).toBe(true)

    const nonWhitespaceChars = frameAfterScroll.replace(/\s/g, "").length
    expect(nonWhitespaceChars).toBeGreaterThan(50)
  })

  test("maintains visibility with simple Code elements (constructor)", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])

    const parent = new BoxRenderable(testRenderer, {
      flexDirection: "column",
      gap: 1,
    })

    const header = new BoxRenderable(testRenderer, { flexShrink: 0 })
    header.add(new TextRenderable(testRenderer, { content: "Header" }))

    const scrollBox = new ScrollBoxRenderable(testRenderer, {
      flexGrow: 1,
      stickyScroll: true,
      stickyStart: "bottom",
    })

    const footer = new BoxRenderable(testRenderer, { flexShrink: 0 })
    footer.add(new TextRenderable(testRenderer, { content: "Footer" }))

    parent.add(header)
    parent.add(scrollBox)
    parent.add(footer)
    testRenderer.root.add(parent)

    await renderOnce()

    for (let i = 0; i < 50; i++) {
      const wrapper = new BoxRenderable(testRenderer, {
        marginTop: 1,
        marginBottom: 1,
      })
      const code = new CodeRenderable(testRenderer, {
        content: `Item ${i}`,
        filetype: "markdown",
        syntaxStyle,
        drawUnstyledText: false,
        treeSitterClient: mockTreeSitterClient,
      })
      wrapper.add(code)
      scrollBox.add(wrapper)
    }

    await renderOnce()

    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 10))

    await renderOnce()

    scrollBox.scrollTo(scrollBox.scrollHeight)
    await renderOnce()

    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await renderOnce()

    const frame = captureCharFrame()

    expect(frame).toContain("Header")
    expect(frame).toContain("Footer")

    const hasItems = /Item \d+/.test(frame)
    expect(hasItems).toBe(true)

    const nonWhitespaceChars = frame.replace(/\s/g, "").length
    expect(nonWhitespaceChars).toBeGreaterThan(18)
  })

  test("maintains visibility with simple Code elements (setter-based, like SolidJS)", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])

    const parent = new BoxRenderable(testRenderer, {
      flexDirection: "column",
      gap: 1,
    })

    const header = new BoxRenderable(testRenderer, { flexShrink: 0 })
    header.add(new TextRenderable(testRenderer, { content: "Header" }))

    const scrollBox = new ScrollBoxRenderable(testRenderer, {
      flexGrow: 1,
      stickyScroll: true,
      stickyStart: "bottom",
    })

    const footer = new BoxRenderable(testRenderer, { flexShrink: 0 })
    footer.add(new TextRenderable(testRenderer, { content: "Footer" }))

    parent.add(header)
    parent.add(scrollBox)
    parent.add(footer)
    testRenderer.root.add(parent)

    await renderOnce()

    for (let i = 0; i < 50; i++) {
      const wrapper = new BoxRenderable(testRenderer, { id: `wrapper-${i}` })
      wrapper.marginTop = 1
      wrapper.marginBottom = 1

      const code = new CodeRenderable(testRenderer, {
        id: `code-${i}`,
        syntaxStyle,
        drawUnstyledText: false,
        treeSitterClient: mockTreeSitterClient,
      })

      wrapper.add(code)
      code.content = `Item ${i}`
      code.filetype = "markdown"

      scrollBox.add(wrapper)
    }

    await Bun.sleep(20)

    mockTreeSitterClient.resolveAllHighlightOnce()
    await Bun.sleep(20)

    await renderOnce()

    scrollBox.scrollTo(scrollBox.scrollHeight)
    await renderOnce()

    const frame = captureCharFrame()

    expect(frame).toContain("Header")
    expect(frame).toContain("Footer")

    const hasItems = /Item \d+/.test(frame)
    expect(hasItems).toBe(true)

    const nonWhitespaceChars = frame.replace(/\s/g, "").length
    expect(nonWhitespaceChars).toBeGreaterThan(18)
  })

  test("maintains visibility with TextRenderable elements", async () => {
    const parent = new BoxRenderable(testRenderer, {
      flexDirection: "column",
      gap: 1,
    })

    const header = new BoxRenderable(testRenderer, { flexShrink: 0 })
    header.add(new TextRenderable(testRenderer, { content: "Header" }))

    const scrollBox = new ScrollBoxRenderable(testRenderer, {
      flexGrow: 1,
      stickyScroll: true,
      stickyStart: "bottom",
    })

    const footer = new BoxRenderable(testRenderer, { flexShrink: 0 })
    footer.add(new TextRenderable(testRenderer, { content: "Footer" }))

    parent.add(header)
    parent.add(scrollBox)
    parent.add(footer)
    testRenderer.root.add(parent)

    await renderOnce()

    for (let i = 0; i < 50; i++) {
      const wrapper = new BoxRenderable(testRenderer, {
        marginTop: 1,
        marginBottom: 1,
      })
      wrapper.add(new TextRenderable(testRenderer, { content: `Item ${i}` }))
      scrollBox.add(wrapper)
    }

    await renderOnce()

    scrollBox.scrollTo(scrollBox.scrollHeight)
    await renderOnce()

    const frame = captureCharFrame()

    expect(frame).toContain("Header")
    expect(frame).toContain("Footer")

    const hasItems = /Item \d+/.test(frame)
    expect(hasItems).toBe(true)

    const nonWhitespaceChars = frame.replace(/\s/g, "").length
    expect(nonWhitespaceChars).toBeGreaterThan(20)
  })

  test("stays scrolled to bottom with growing code renderables in sticky scroll mode", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])
    // Use auto-resolving mock client to avoid timing issues with stale highlight detection
    const autoResolvingClient = new MockTreeSitterClient({ autoResolveTimeout: 1 })
    autoResolvingClient.setMockResult({ highlights: [] })

    const parent = new BoxRenderable(testRenderer, {
      flexDirection: "column",
      gap: 1,
    })

    const header = new BoxRenderable(testRenderer, { flexShrink: 0 })
    header.add(new TextRenderable(testRenderer, { content: "Header" }))

    const scrollBox = new ScrollBoxRenderable(testRenderer, {
      flexGrow: 1,
      stickyScroll: true,
      stickyStart: "bottom",
    })

    const footer = new BoxRenderable(testRenderer, { flexShrink: 0 })
    footer.add(new TextRenderable(testRenderer, { content: "Footer" }))

    parent.add(header)
    parent.add(scrollBox)
    parent.add(footer)
    testRenderer.root.add(parent)

    const scrollPositions: number[] = []
    const maxScrollPositions: number[] = []
    const wrapper1 = new BoxRenderable(testRenderer, {
      marginTop: 1,
      marginBottom: 1,
    })
    const code1 = new CodeRenderable(testRenderer, {
      content: "console.log('hello')",
      filetype: "javascript",
      syntaxStyle,
      drawUnstyledText: false,
      treeSitterClient: autoResolvingClient,
    })
    wrapper1.add(code1)
    scrollBox.add(wrapper1)

    await Bun.sleep(10)
    await testRenderer.idle()

    scrollPositions.push(scrollBox.scrollTop)
    maxScrollPositions.push(Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height))
    expect(scrollBox.scrollTop).toBe(maxScrollPositions[0])

    code1.content = `console.log('hello')
const foo = 'bar'
const baz = 'qux'
function test() {
  return 42
}
console.log(test())`

    await Bun.sleep(10)
    await testRenderer.idle()

    scrollPositions.push(scrollBox.scrollTop)
    maxScrollPositions.push(Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height))
    expect(scrollBox.scrollTop).toBe(maxScrollPositions[1])

    const wrapper2 = new BoxRenderable(testRenderer, {
      marginTop: 1,
      marginBottom: 1,
    })
    const code2 = new CodeRenderable(testRenderer, {
      content: "const x = 10\nconst y = 20",
      filetype: "javascript",
      syntaxStyle,
      drawUnstyledText: false,
      treeSitterClient: autoResolvingClient,
    })
    wrapper2.add(code2)
    scrollBox.add(wrapper2)

    await Bun.sleep(10)
    await testRenderer.idle()

    scrollPositions.push(scrollBox.scrollTop)
    maxScrollPositions.push(Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height))
    expect(scrollBox.scrollTop).toBe(maxScrollPositions[2])

    code2.content = `const x = 10
const y = 20
const z = x + y
console.log(z)
function multiply(a, b) {
  return a * b
}
const result = multiply(x, y)
console.log('Result:', result)`

    await Bun.sleep(10)
    await testRenderer.idle()

    scrollPositions.push(scrollBox.scrollTop)
    maxScrollPositions.push(Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height))
    expect(scrollBox.scrollTop).toBe(maxScrollPositions[3])

    const wrapper3 = new BoxRenderable(testRenderer, {
      marginTop: 1,
      marginBottom: 1,
    })
    const code3 = new CodeRenderable(testRenderer, {
      content: "// Final code block\nconst final = 'done'",
      filetype: "javascript",
      syntaxStyle,
      drawUnstyledText: false,
      treeSitterClient: autoResolvingClient,
    })
    wrapper3.add(code3)
    scrollBox.add(wrapper3)

    await Bun.sleep(10)
    await testRenderer.idle()

    scrollPositions.push(scrollBox.scrollTop)
    maxScrollPositions.push(Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height))
    expect(scrollBox.scrollTop).toBe(maxScrollPositions[4])

    code3.content = `// Final code block
const final = 'done'

class DataProcessor {
  constructor(data) {
    this.data = data
  }
  
  process() {
    return this.data.map(item => item * 2)
  }
  
  filter(predicate) {
    return this.data.filter(predicate)
  }
  
  reduce(fn, initial) {
    return this.data.reduce(fn, initial)
  }
}

const processor = new DataProcessor([1, 2, 3, 4, 5])
console.log(processor.process())
console.log(processor.filter(x => x > 2))
console.log(processor.reduce((acc, val) => acc + val, 0))`

    await Bun.sleep(10)
    await testRenderer.idle()

    scrollPositions.push(scrollBox.scrollTop)
    maxScrollPositions.push(Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height))
    expect(scrollBox.scrollTop).toBe(maxScrollPositions[5])

    const frame = captureCharFrame()
    expect(frame).toContain("Header")
    expect(frame).toContain("Footer")

    const hasCodeContent =
      frame.includes("console") ||
      frame.includes("function") ||
      frame.includes("const") ||
      frame.includes("DataProcessor") ||
      frame.includes("processor")

    expect(hasCodeContent).toBe(true)

    const nonWhitespaceChars = frame.replace(/\s/g, "").length
    expect(nonWhitespaceChars).toBeGreaterThan(50)

    for (let i = 0; i < scrollPositions.length; i++) {
      expect(scrollPositions[i]).toBe(maxScrollPositions[i])
    }
  })

  test("sticky scroll bottom stays at bottom after scrollBy/scrollTo is called", async () => {
    const scrollBox = new ScrollBoxRenderable(testRenderer, {
      width: 40,
      height: 10,
      stickyScroll: true,
      stickyStart: "bottom",
    })

    testRenderer.root.add(scrollBox)
    await renderOnce()

    scrollBox.add(new TextRenderable(testRenderer, { content: `Line 0` }))
    await renderOnce()

    scrollBox.scrollBy(100000)
    await renderOnce()

    scrollBox.scrollTo(scrollBox.scrollHeight)
    await renderOnce()

    for (let i = 1; i < 30; i++) {
      scrollBox.add(new TextRenderable(testRenderer, { content: `Line ${i}` }))
      await renderOnce()

      const maxScroll = Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height)

      if (i === 16) {
        expect(scrollBox.scrollTop).toBe(maxScroll)
      }
    }
  })

  test("scrolls CodeRenderable with LineNumberRenderable using mouse wheel", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])

    const scrollBox = new ScrollBoxRenderable(testRenderer, {
      width: 40,
      height: 10,
      scrollY: true,
      scrollX: false,
    })

    // Create long code content that needs scrolling
    let code = "Line 1\n"
    for (let i = 2; i <= 30; i++) {
      code += `Line ${i}\n`
    }

    const { LineNumberRenderable } = await import("../renderables/LineNumberRenderable")
    const codeRenderable = new CodeRenderable(testRenderer, {
      content: code,
      filetype: "javascript",
      syntaxStyle,
      drawUnstyledText: true,
      treeSitterClient: mockTreeSitterClient,
      width: "100%",
    })

    const codeWithLines = new LineNumberRenderable(testRenderer, {
      target: codeRenderable,
      width: "100%",
    })

    scrollBox.add(codeWithLines)
    testRenderer.root.add(scrollBox)

    await renderOnce()

    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await renderOnce()

    // Capture initial frame (should show top lines)
    const frameTop = captureCharFrame()
    expect(frameTop).toContain("Line 1")
    expect(frameTop).not.toContain("Line 30")

    // Scroll down to bottom
    for (let i = 0; i < 25; i++) {
      await mockMouse.scroll(20, 5, "down")
      await renderOnce()
    }

    // Capture after scroll (should show bottom lines)
    const frameBottom = captureCharFrame()
    expect(frameBottom).toMatchSnapshot()
    expect(frameBottom).toContain("Line 30")
    expect(frameBottom).not.toContain("Line 1")
  })

  test("sticky scroll bottom stays at bottom when gradually filled with code renderables", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])

    const scrollBox = new ScrollBoxRenderable(testRenderer, {
      width: 40,
      height: 10,
      stickyScroll: true,
      stickyStart: "bottom",
    })

    testRenderer.root.add(scrollBox)
    await renderOnce()

    const scrollPositions: number[] = []
    const maxScrollPositions: number[] = []

    scrollPositions.push(scrollBox.scrollTop)
    maxScrollPositions.push(Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height))

    for (let i = 0; i < 10; i++) {
      const code = new CodeRenderable(testRenderer, {
        syntaxStyle,
        drawUnstyledText: false,
        treeSitterClient: mockTreeSitterClient,
      })

      let content = `// Block ${i}\n`
      for (let j = 0; j <= i; j++) {
        content += `const var${j} = ${j}\n`
      }
      code.content = content
      code.filetype = "javascript"

      scrollBox.add(code)

      mockTreeSitterClient.resolveAllHighlightOnce()
      await new Promise((resolve) => setTimeout(resolve, 1))
      await renderOnce()

      const maxScroll = Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height)
      scrollPositions.push(scrollBox.scrollTop)
      maxScrollPositions.push(maxScroll)
    }

    for (let i = 0; i < scrollPositions.length; i++) {
      expect(scrollPositions[i]).toBe(maxScrollPositions[i])
    }
  })

  test("clips nested scrollboxes when multiple stacked children overflow (app-style tool blocks)", async () => {
    const custom = await createTestRenderer({ width: 120, height: 40 })
    const { renderer, renderOnce, captureCharFrame } = custom

    const root = new BoxRenderable(renderer, { flexDirection: "column", width: 118, height: 38, gap: 0 })
    const header = new BoxRenderable(renderer, { height: 3, border: true })
    header.add(new TextRenderable(testRenderer, { content: "HEADER" }))
    root.add(header)

    const outer = new ScrollBoxRenderable(renderer, { height: 25, border: true, overflow: "hidden", scrollY: true })
    expect((outer as any)._overflow).toBe("hidden")

    const addToolBlock = (id: number) => {
      const wrapper = new BoxRenderable(renderer, { border: true, padding: 0, marginTop: 0, marginBottom: 0 })
      const inner = new ScrollBoxRenderable(renderer, {
        height: 10,
        border: true,
        overflow: "hidden",
        scrollY: true,
        contentOptions: { paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 },
      })
      expect((inner as any)._overflow).toBe("hidden")
      for (let i = 0; i < 15; i += 1) {
        inner.add(new TextRenderable(renderer, { content: `[tool ${id}] line ${i}` }))
      }
      wrapper.add(inner)
      outer.add(wrapper)
    }

    addToolBlock(1)
    addToolBlock(2)
    addToolBlock(3)

    root.add(outer)

    const footer = new BoxRenderable(renderer, { height: 3, border: true })
    footer.add(new TextRenderable(renderer, { content: "FOOTER" }))
    root.add(footer)

    renderer.root.add(root)
    await renderer.idle()
    expect(outer.width).toBeGreaterThan(0)
    expect(outer.height).toBeGreaterThan(0)

    const frame = captureCharFrame()

    // The third tool block should be clipped entirely (outer height fits ~two blocks).
    expect(frame).not.toMatch(/\[tool 3\] line 1/)

    renderer.destroy()
  })

  test("does not overdraw above header when scrolling nested tool blocks upward", async () => {
    const custom = await createTestRenderer({ width: 120, height: 24 })
    const { renderer, renderOnce, captureCharFrame } = custom

    const root = new BoxRenderable(renderer, { flexDirection: "column", width: 118, height: 22, gap: 0 })
    const header = new BoxRenderable(renderer, { height: 3, border: true })
    header.add(new TextRenderable(renderer, { content: "HEADER" }))
    root.add(header)

    const outer = new ScrollBoxRenderable(renderer, { height: 14, border: true, overflow: "hidden", scrollY: true })
    const inner = new ScrollBoxRenderable(renderer, { height: 10, border: true, overflow: "hidden", scrollY: true })
    for (let i = 0; i < 12; i += 1) {
      inner.add(new TextRenderable(renderer, { content: `[tool] line ${i}` }))
    }
    outer.add(inner)
    root.add(outer)

    const footer = new BoxRenderable(renderer, { height: 3, border: true })
    footer.add(new TextRenderable(renderer, { content: "FOOTER" }))
    root.add(footer)

    renderer.root.add(root)
    await renderOnce()

    // Scroll up to try to draw above header
    inner.scrollTo({ x: 0, y: -100 })
    outer.scrollTo({ x: 0, y: -100 })
    await renderOnce()

    const frame = captureCharFrame()
    const headerIndex = frame.indexOf("HEADER")
    const firstToolIndex = frame.indexOf("[tool] line 0")

    expect(headerIndex).toBeGreaterThan(-1)
    expect(firstToolIndex).toBeGreaterThan(headerIndex)

    renderer.destroy()
  })

  // Regression test for issue #530: sticky scroll jumps to top after manual scroll
  test("resets _hasManualScroll when user scrolls back to sticky position (issue #530)", async () => {
    const scrollBox = new ScrollBoxRenderable(testRenderer, {
      width: 40,
      height: 10,
      stickyScroll: true,
      stickyStart: "bottom",
    })

    testRenderer.root.add(scrollBox)

    // Add enough content to overflow the viewport
    for (let i = 0; i < 20; i++) {
      scrollBox.add(new TextRenderable(testRenderer, { content: `Line ${i}` }))
    }
    await renderOnce()

    const maxScroll = Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height)
    expect(scrollBox.scrollTop).toBe(maxScroll)
    expect((scrollBox as any)._hasManualScroll).toBe(false)

    // User scrolls up manually - this sets _hasManualScroll = true
    scrollBox.scrollTo(5)
    await renderOnce()

    expect(scrollBox.scrollTop).toBe(5)
    expect((scrollBox as any)._hasManualScroll).toBe(true)

    // User scrolls back to bottom - this should reset _hasManualScroll = false
    const newMaxScroll = Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height)
    scrollBox.scrollTo(newMaxScroll)
    await renderOnce()

    expect(scrollBox.scrollTop).toBe(newMaxScroll)
    // This is the fix: _hasManualScroll should be reset when back at sticky position
    expect((scrollBox as any)._hasManualScroll).toBe(false)

    // Add more content - should stay at bottom because sticky scroll is re-enabled
    for (let i = 20; i < 30; i++) {
      scrollBox.add(new TextRenderable(testRenderer, { content: `Line ${i}` }))
      await renderOnce()

      const expectedMaxScroll = Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height)
      // Without the fix, this would fail: scroll would jump to top
      expect(scrollBox.scrollTop).toBe(expectedMaxScroll)
    }
  })

  // Regression test for issue #709: content size recalculation should not clear manual scroll state
  test("does not reset _hasManualScroll during content size recalculation (issue #709)", async () => {
    const scrollBox = new ScrollBoxRenderable(testRenderer, {
      width: 40,
      height: 10,
      stickyScroll: true,
      stickyStart: "bottom",
    })

    testRenderer.root.add(scrollBox)

    for (let i = 0; i < 30; i++) {
      scrollBox.add(new TextRenderable(testRenderer, { id: `line-${i}`, content: `Line ${i}` }))
    }
    await renderOnce()

    const initialMaxScroll = Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height)
    expect(scrollBox.scrollTop).toBe(initialMaxScroll)
    expect((scrollBox as any)._hasManualScroll).toBe(false)

    scrollBox.scrollTo(5)
    await renderOnce()

    expect(scrollBox.scrollTop).toBe(5)
    expect((scrollBox as any)._hasManualScroll).toBe(true)

    // Force a size recalculation that programmatically clamps scrollTop to 0.
    // This must not be treated as a user returning to sticky position.
    for (let i = 0; i < 28; i++) {
      scrollBox.remove(`line-${i}`)
    }
    await renderOnce()

    expect(Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height)).toBe(0)
    expect(scrollBox.scrollTop).toBe(0)
    expect((scrollBox as any)._hasManualScroll).toBe(true)

    // When content grows again, we should keep manual-scroll mode and stay away from sticky bottom.
    for (let i = 30; i < 50; i++) {
      scrollBox.add(new TextRenderable(testRenderer, { id: `line-${i}`, content: `Line ${i}` }))
    }
    await renderOnce()

    const newMaxScroll = Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height)
    expect(newMaxScroll).toBeGreaterThan(0)
    expect((scrollBox as any)._hasManualScroll).toBe(true)
    expect(scrollBox.scrollTop).toBe(0)
  })

  // Regression test for issue #530: edge case when content fits in viewport
  test("resets _hasManualScroll for stickyStart=bottom when content fits in viewport (issue #530)", async () => {
    const scrollBox = new ScrollBoxRenderable(testRenderer, {
      width: 40,
      height: 10,
      stickyScroll: true,
      stickyStart: "bottom",
    })

    testRenderer.root.add(scrollBox)

    // Add content that fits in viewport (no actual scrolling needed)
    scrollBox.add(new TextRenderable(testRenderer, { content: "Line 0" }))
    scrollBox.add(new TextRenderable(testRenderer, { content: "Line 1" }))
    await renderOnce()

    // maxScrollTop should be 0 since content fits
    const maxScroll = Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height)
    expect(maxScroll).toBe(0)

    // Simulate accidental scroll attempts (common with trackpads)
    scrollBox.scrollTo(0)
    await renderOnce()

    // Even though we're at scrollTop=0, for stickyStart="bottom" with maxScrollTop=0,
    // we're effectively at both top AND bottom, so _hasManualScroll should be false
    expect((scrollBox as any)._hasManualScroll).toBe(false)

    // Add more content that causes overflow - should stay at bottom
    for (let i = 2; i < 20; i++) {
      scrollBox.add(new TextRenderable(testRenderer, { content: `Line ${i}` }))
      await renderOnce()

      const expectedMaxScroll = Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height)
      if (expectedMaxScroll > 0) {
        expect(scrollBox.scrollTop).toBe(expectedMaxScroll)
      }
    }
  })
})
