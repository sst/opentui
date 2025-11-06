import { test, expect, beforeEach, afterEach, describe } from "bun:test"
import { createTestRenderer, type TestRenderer, type MockMouse, MockTreeSitterClient } from "../testing"
import { ScrollBoxRenderable } from "../renderables/ScrollBox"
import { BoxRenderable } from "../renderables/Box"
import { TextRenderable } from "../renderables/Text"
import { CodeRenderable } from "../renderables/Code"
import { LinearScrollAccel, MacOSScrollAccel } from "../lib/scroll-acceleration"
import { SyntaxStyle } from "../syntax-style"

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

    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 1))

    await renderOnce()

    scrollBox.scrollTo(scrollBox.scrollHeight)
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

    // Simulate SolidJS reconciler behavior: createElement first, then set properties
    for (let i = 0; i < 100; i++) {
      const wrapper = new BoxRenderable(testRenderer, { id: `wrapper-${i}` })
      wrapper.marginTop = 2
      wrapper.marginBottom = 2

      // Create CodeRenderable with minimal options (like SolidJS createElement)
      const code = new CodeRenderable(testRenderer, {
        id: `code-${i}`,
        syntaxStyle,
        drawUnstyledText: false,
        treeSitterClient: mockTreeSitterClient,
      })

      // Then set properties via setters (like SolidJS setProperty)
      // NOTE: Order matters! Setting content first gives initial dimensions
      code.content = codeContent
      code.filetype = "markdown"

      wrapper.add(code)
      scrollBox.add(wrapper)
    }

    // Wait for microtasks (scheduleUpdate uses queueMicrotask)
    await new Promise((resolve) => setTimeout(resolve, 0))

    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 1))

    await renderOnce()

    scrollBox.scrollTo(scrollBox.scrollHeight)
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

    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 1))

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

    // Simulate SolidJS reconciler behavior
    for (let i = 0; i < 50; i++) {
      const wrapper = new BoxRenderable(testRenderer, { id: `wrapper-${i}` })
      wrapper.marginTop = 1
      wrapper.marginBottom = 1

      // Create with minimal options first
      const code = new CodeRenderable(testRenderer, {
        id: `code-${i}`,
        syntaxStyle,
        drawUnstyledText: false,
        treeSitterClient: mockTreeSitterClient,
      })

      // Set properties via setters
      // NOTE: Order matters! Setting content first gives initial dimensions
      code.content = `Item ${i}`
      code.filetype = "markdown"

      wrapper.add(code)
      scrollBox.add(wrapper)
    }

    // Wait for microtasks (scheduleUpdate uses queueMicrotask)
    await new Promise((resolve) => setTimeout(resolve, 0))

    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 1))

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
})
