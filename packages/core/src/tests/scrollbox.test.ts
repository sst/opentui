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

  test("stays scrolled to bottom with growing code renderables in sticky scroll mode", async () => {
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

    const scrollPositions: number[] = []
    const maxScrollPositions: number[] = []

    // Phase 1: Add first code renderable with small content
    const wrapper1 = new BoxRenderable(testRenderer, {
      marginTop: 1,
      marginBottom: 1,
    })
    const code1 = new CodeRenderable(testRenderer, {
      content: "console.log('hello')",
      filetype: "javascript",
      syntaxStyle,
      drawUnstyledText: false,
      treeSitterClient: mockTreeSitterClient,
    })
    wrapper1.add(code1)
    scrollBox.add(wrapper1)

    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 1))
    await renderOnce()

    scrollPositions.push(scrollBox.scrollTop)
    maxScrollPositions.push(Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height))
    expect(scrollBox.scrollTop).toBe(maxScrollPositions[0])

    // Phase 2: Grow the first code renderable
    code1.content = `console.log('hello')
const foo = 'bar'
const baz = 'qux'
function test() {
  return 42
}
console.log(test())`

    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 1))
    await renderOnce()

    scrollPositions.push(scrollBox.scrollTop)
    maxScrollPositions.push(Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height))
    expect(scrollBox.scrollTop).toBe(maxScrollPositions[1])

    // Phase 3: Add a second code renderable
    const wrapper2 = new BoxRenderable(testRenderer, {
      marginTop: 1,
      marginBottom: 1,
    })
    const code2 = new CodeRenderable(testRenderer, {
      content: "const x = 10\nconst y = 20",
      filetype: "javascript",
      syntaxStyle,
      drawUnstyledText: false,
      treeSitterClient: mockTreeSitterClient,
    })
    wrapper2.add(code2)
    scrollBox.add(wrapper2)

    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 1))
    await renderOnce()

    scrollPositions.push(scrollBox.scrollTop)
    maxScrollPositions.push(Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height))
    expect(scrollBox.scrollTop).toBe(maxScrollPositions[2])

    // Phase 4: Grow the second code renderable
    code2.content = `const x = 10
const y = 20
const z = x + y
console.log(z)
function multiply(a, b) {
  return a * b
}
const result = multiply(x, y)
console.log('Result:', result)`

    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 1))
    await renderOnce()

    scrollPositions.push(scrollBox.scrollTop)
    maxScrollPositions.push(Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height))
    expect(scrollBox.scrollTop).toBe(maxScrollPositions[3])

    // Phase 5: Add a third code renderable
    const wrapper3 = new BoxRenderable(testRenderer, {
      marginTop: 1,
      marginBottom: 1,
    })
    const code3 = new CodeRenderable(testRenderer, {
      content: "// Final code block\nconst final = 'done'",
      filetype: "javascript",
      syntaxStyle,
      drawUnstyledText: false,
      treeSitterClient: mockTreeSitterClient,
    })
    wrapper3.add(code3)
    scrollBox.add(wrapper3)

    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 1))
    await renderOnce()

    scrollPositions.push(scrollBox.scrollTop)
    maxScrollPositions.push(Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height))
    expect(scrollBox.scrollTop).toBe(maxScrollPositions[4])

    // Phase 6: Grow the third code renderable significantly
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

    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 1))
    await renderOnce()

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

  test("REPRO: sticky scroll bottom fails after scrollBy/scrollTo is called", async () => {
    // This test reproduces the issue where calling scrollBy() or scrollTo()
    // marks the scroll as "manual" which prevents stickyScroll from working
    
    const scrollBox = new ScrollBoxRenderable(testRenderer, {
      width: 40,
      height: 10,
      stickyScroll: true,
      stickyStart: "bottom",
    })

    testRenderer.root.add(scrollBox)
    await renderOnce()
    
    // Add initial content
    scrollBox.add(new TextRenderable(testRenderer, { content: `Line 0` }))
    await renderOnce()
    
    // THE BUG: Someone calls scrollBy() programmatically (e.g., trying to scroll to bottom)
    // This marks hasManualScroll=true which breaks sticky scroll behavior
    scrollBox.scrollBy(100000)
    await renderOnce()
    
    scrollBox.scrollTo(scrollBox.scrollHeight)
    await renderOnce()
    
    // Now add content gradually - it SHOULD stay at bottom but it WON'T!
    for (let i = 1; i < 30; i++) {
      scrollBox.add(new TextRenderable(testRenderer, { content: `Line ${i}` }))
      await renderOnce()
      
      const maxScroll = Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height)
      
      // Check after content has grown
      if (i === 16) {
        // At this point, scrollTop should equal maxScroll (be at bottom)
        // But because hasManualScroll=true, it gets stuck at scrollTop=0 (top)
        expect(scrollBox.scrollTop).toBe(maxScroll)
      }
    }
  })

  test("sticky scroll bottom - starts empty and gradually fills with code renderables", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])
    
    const scrollBox = new ScrollBoxRenderable(testRenderer, {
      width: 40,
      height: 10,
      stickyScroll: true,
      stickyStart: "bottom",
    })

    testRenderer.root.add(scrollBox)
    await renderOnce()

    // Track scroll position after each addition
    const scrollPositions: number[] = []
    const maxScrollPositions: number[] = []
    const failures: string[] = []

    // Initial state: empty scrollbox
    scrollPositions.push(scrollBox.scrollTop)
    maxScrollPositions.push(Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height))
    console.log(`Initial: scrollTop=${scrollBox.scrollTop}, maxScroll=${maxScrollPositions[0]}, height=${scrollBox.scrollHeight}, viewport=${scrollBox.viewport.height}`)
    
    if (scrollBox.scrollTop !== maxScrollPositions[0]) {
      failures.push(`Step 0 (initial): scrollTop=${scrollBox.scrollTop}, expected=${maxScrollPositions[0]}`)
    }

    // Add code renderables one by one, each with growing content
    for (let i = 0; i < 10; i++) {
      // Create code renderable with minimal options first (like SolidJS)
      const code = new CodeRenderable(testRenderer, {
        syntaxStyle,
        drawUnstyledText: false,
        treeSitterClient: mockTreeSitterClient,
      })

      // Set content via setter - growing content each time
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
      
      console.log(`After adding block ${i}: scrollTop=${scrollBox.scrollTop}, maxScroll=${maxScroll}, height=${scrollBox.scrollHeight}, viewport=${scrollBox.viewport.height}`)
      
      if (scrollBox.scrollTop !== maxScroll) {
        failures.push(
          `Step ${i + 1}: scrollTop=${scrollBox.scrollTop}, expected=${maxScroll}, ` +
          `scrollHeight=${scrollBox.scrollHeight}, viewportHeight=${scrollBox.viewport.height}`
        )
      }
    }

    // Log all failures before asserting
    if (failures.length > 0) {
      console.log("\nSticky scroll failures:")
      failures.forEach((f) => console.log("  " + f))
    }

    // Verify that at each step, scrollTop equals maxScrollTop (stayed at bottom)
    for (let i = 0; i < scrollPositions.length; i++) {
      if (scrollPositions[i] !== maxScrollPositions[i]) {
        throw new Error(
          `Failed at step ${i}: scrollTop=${scrollPositions[i]}, expected=${maxScrollPositions[i]}`
        )
      }
    }
  })
})
