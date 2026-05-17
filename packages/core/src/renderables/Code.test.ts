import { test, expect, beforeEach, afterEach } from "bun:test"
import { CodeRenderable } from "./Code.js"
import { SyntaxStyle } from "../syntax-style.js"
import { RGBA } from "../lib/RGBA.js"
import { createTestRenderer, type TestRenderer, MockTreeSitterClient, type MockMouse } from "../testing.js"
import { TreeSitterClient } from "../lib/tree-sitter/index.js"
import type { SimpleHighlight } from "../lib/tree-sitter/types.js"
import { BoxRenderable } from "./Box.js"
import { TextAttributes, type CapturedFrame } from "../types.js"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>
let captureFrame: () => string
let captureSpans: () => CapturedFrame
let mockMouse: MockMouse
let resize: (width: number, height: number) => void

beforeEach(async () => {
  const testRenderer = await createTestRenderer({ width: 80, height: 24 })
  currentRenderer = testRenderer.renderer
  renderOnce = testRenderer.renderOnce
  captureFrame = testRenderer.captureCharFrame
  captureSpans = testRenderer.captureSpans
  mockMouse = testRenderer.mockMouse
  resize = testRenderer.resize
})

function findSpanContaining(frame: CapturedFrame, text: string) {
  for (const line of frame.lines) {
    const span = line.spans.find((candidate) => candidate.text.includes(text))
    if (span) return span
  }
}

async function resolveMockHighlights(mockClient: MockTreeSitterClient): Promise<void> {
  await renderOnce()
  mockClient.resolveAllHighlightOnce()
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()
}

afterEach(async () => {
  if (currentRenderer) {
    currentRenderer.destroy()
  }
})

test("CodeRenderable - basic construction", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
    string: { fg: RGBA.fromValues(0, 1, 0, 1) },
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: 'const message = "Hello, world!";',
    filetype: "javascript",
    syntaxStyle,
    conceal: false,
  })

  expect(codeRenderable.content).toBe('const message = "Hello, world!";')
  expect(codeRenderable.filetype).toBe("javascript")
  expect(codeRenderable.syntaxStyle).toBe(syntaxStyle)
  expect(codeRenderable.baseHighlight).toBeUndefined()
})

test("CodeRenderable - content updates", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "original content",
    filetype: "javascript",
    syntaxStyle,
    conceal: false,
  })

  expect(codeRenderable.content).toBe("original content")

  codeRenderable.content = "updated content"
  expect(codeRenderable.content).toBe("updated content")
})

test("CodeRenderable - filetype updates", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "console.log('test');",
    filetype: "javascript",
    syntaxStyle,
    conceal: false,
  })

  expect(codeRenderable.filetype).toBe("javascript")

  codeRenderable.filetype = "typescript"
  expect(codeRenderable.filetype).toBe("typescript")
})

test("CodeRenderable - re-highlights when content changes during active highlighting", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [
      [0, 5, "keyword"],
      [6, 13, "identifier"],
    ] as SimpleHighlight[],
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello';",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    conceal: false,
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  expect(mockClient.isHighlighting()).toBe(true)

  codeRenderable.content = "let newMessage = 'world';"

  expect(codeRenderable.content).toBe("let newMessage = 'world';")

  await renderOnce()
  expect(mockClient.isHighlighting()).toBe(true)

  // Resolve initial: snapshot mismatch (content changed) bails out and
  // requests a render. Next renderOnce fires the highlight for the latest
  // content.
  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()
  expect(mockClient.isHighlighting()).toBe(true)

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))

  expect(mockClient.isHighlighting()).toBe(false)
})

test("CodeRenderable - multiple content changes during highlighting", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({ highlights: [] })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "original content",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    conceal: false,
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  expect(mockClient.isHighlighting()).toBe(true)

  codeRenderable.content = "first change"
  codeRenderable.content = "second change"
  codeRenderable.content = "final content"

  expect(codeRenderable.content).toBe("final content")

  // With coalescing only the initial highlight is in flight; the three content
  // changes just bumped the snapshot id and marked dirty.
  await renderOnce()
  expect(mockClient.isHighlighting()).toBe(true)

  // Resolve the initial highlight. Snapshot id has moved → bailStale clears
  // _isHighlighting and requests another render. The next renderOnce picks up
  // the dirty state and fires a fresh highlight on "final content".
  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()
  expect(mockClient.isHighlighting()).toBe(true)

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))

  expect(mockClient.isHighlighting()).toBe(false)
})

test("CodeRenderable - uses fallback rendering when no filetype provided", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello world';",
    syntaxStyle,
    conceal: false,
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  expect(codeRenderable.content).toBe("const message = 'hello world';")
  expect(codeRenderable.filetype).toBeUndefined()
  expect(codeRenderable.plainText).toBe("const message = 'hello world';")
})

test("CodeRenderable - uses fallback rendering when highlighting throws error", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()

  mockClient.highlightOnce = async () => {
    throw new Error("Highlighting failed")
  }

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello world';",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    conceal: false,
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  await new Promise((resolve) => setTimeout(resolve, 20))
  await renderOnce()

  expect(codeRenderable.content).toBe("const message = 'hello world';")
  expect(codeRenderable.filetype).toBe("javascript")
  expect(codeRenderable.plainText).toBe("const message = 'hello world';")
})

test("CodeRenderable - handles empty content", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "",
    filetype: "javascript",
    syntaxStyle,
    conceal: false,
  })

  await renderOnce()

  expect(codeRenderable.content).toBe("")
  expect(codeRenderable.filetype).toBe("javascript")
  expect(codeRenderable.plainText).toBe("")
})

test("CodeRenderable - empty content does not trigger highlighting", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({ highlights: [] })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello';",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    conceal: false,
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  expect(codeRenderable.content).toBe("const message = 'hello';")
  expect(codeRenderable.plainText).toBe("const message = 'hello';")

  codeRenderable.content = ""
  await renderOnce()

  expect(mockClient.isHighlighting()).toBe(false)
  expect(codeRenderable.content).toBe("")
})

test("CodeRenderable - text renders immediately before highlighting completes", async () => {
  resize(32, 2)

  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [
      [0, 5, "keyword"],
      [6, 13, "identifier"],
    ] as SimpleHighlight[],
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello world';",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    conceal: false,
    left: 0,
    top: 0,
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  expect(mockClient.isHighlighting()).toBe(true)

  const frameBeforeHighlighting = captureFrame()
  expect(frameBeforeHighlighting).toMatchSnapshot("text visible before highlighting completes")

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  const frameAfterHighlighting = captureFrame()
  expect(frameAfterHighlighting).toMatchSnapshot("text visible after highlighting completes")
})

test("CodeRenderable - batches concurrent content and filetype updates", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
  })

  let highlightCount = 0
  const mockClient = new MockTreeSitterClient()
  const originalHighlightOnce = mockClient.highlightOnce.bind(mockClient)

  mockClient.highlightOnce = async (content: string, filetype: string) => {
    highlightCount++
    return originalHighlightOnce(content, filetype)
  }

  mockClient.setMockResult({
    highlights: [[0, 3, "keyword"]] as SimpleHighlight[],
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello';",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    conceal: false,
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))

  highlightCount = 0

  codeRenderable.content = "let newMessage = 'world';"
  codeRenderable.filetype = "typescript"

  await renderOnce()

  mockClient.resolveAllHighlightOnce()
  await new Promise((resolve) => setTimeout(resolve, 10))

  expect(highlightCount).toBe(1)
  expect(codeRenderable.content).toBe("let newMessage = 'world';")
  expect(codeRenderable.filetype).toBe("typescript")
})

test("CodeRenderable - batches multiple updates in same tick into single highlight", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  let highlightCount = 0
  const highlightCalls: Array<{ content: string; filetype: string }> = []
  const mockClient = new MockTreeSitterClient()
  const originalHighlightOnce = mockClient.highlightOnce.bind(mockClient)

  mockClient.highlightOnce = async (content: string, filetype: string) => {
    highlightCount++
    highlightCalls.push({ content, filetype })
    return originalHighlightOnce(content, filetype)
  }

  mockClient.setMockResult({ highlights: [] })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "initial",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    conceal: false,
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))

  highlightCount = 0
  highlightCalls.length = 0

  codeRenderable.content = "first content change"
  codeRenderable.filetype = "typescript"
  codeRenderable.content = "second content change"

  await renderOnce()

  mockClient.resolveAllHighlightOnce()
  await new Promise((resolve) => setTimeout(resolve, 10))

  expect(highlightCount).toBe(1)
  expect(highlightCalls[0]?.content).toBe("second content change")
  expect(highlightCalls[0]?.filetype).toBe("typescript")
})

test("CodeRenderable - renders markdown with TypeScript injection correctly", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(1, 0, 0, 1) }, // Red
    string: { fg: RGBA.fromValues(0, 1, 0, 1) }, // Green
    "markup.heading.1": { fg: RGBA.fromValues(0, 0, 1, 1) }, // Blue
  })

  const markdownCode = `# Hello\n\n\`\`\`typescript\nconst msg: string = "hi";\n\`\`\``

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-markdown",
    content: markdownCode,
    filetype: "markdown",
    syntaxStyle,
    conceal: false,
    left: 0,
    top: 0,
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  await new Promise((resolve) => setTimeout(resolve, 100))
  await renderOnce()

  expect(codeRenderable.plainText).toContain("# Hello")
  expect(codeRenderable.plainText).toContain("const msg")
  expect(codeRenderable.plainText).toContain("typescript")
})

test("CodeRenderable - coalesces highlights while one is in flight (hung-worker scenario)", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
  })

  let highlightCount = 0
  const pendingPromises: Array<{ content: string; filetype: string; never: boolean }> = []

  class HangingMockClient extends TreeSitterClient {
    constructor() {
      super({ dataPath: "/tmp/mock" })
    }

    async highlightOnce(
      content: string,
      filetype: string,
    ): Promise<{ highlights?: SimpleHighlight[]; warning?: string; error?: string }> {
      highlightCount++

      const shouldHang = highlightCount === 4 && filetype === "typescript"

      pendingPromises.push({ content, filetype, never: shouldHang })

      if (shouldHang) {
        return new Promise(() => {})
      }

      return Promise.resolve({ highlights: [] })
    }
  }

  const mockClient = new HangingMockClient()

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "interface User { name: string; }",
    filetype: "typescript",
    syntaxStyle,
    treeSitterClient: mockClient,
    conceal: false,
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()
  await new Promise((resolve) => setTimeout(resolve, 20))

  highlightCount = 0
  pendingPromises.length = 0

  codeRenderable.content = "const message = 'hello';"
  codeRenderable.filetype = "javascript"
  await renderOnce()
  await new Promise((resolve) => setTimeout(resolve, 20))

  codeRenderable.content = "# Documentation"
  codeRenderable.filetype = "markdown"
  await renderOnce()
  await new Promise((resolve) => setTimeout(resolve, 20))

  codeRenderable.content = "const message = 'world';"
  codeRenderable.filetype = "javascript"
  await renderOnce()
  await new Promise((resolve) => setTimeout(resolve, 20))

  codeRenderable.content = "interface User { name: string; }"
  codeRenderable.filetype = "typescript"
  await renderOnce()
  await new Promise((resolve) => setTimeout(resolve, 20))

  codeRenderable.content = "# New Documentation"
  codeRenderable.filetype = "markdown"
  await renderOnce()
  await new Promise((resolve) => setTimeout(resolve, 20))

  // With coalescing (at most one in-flight per renderable), the 4th call hangs
  // forever and the 5th `set content` only marks the renderable dirty — it
  // does not spawn a concurrent worker call. The latest content is still
  // reflected on the renderable; it just won't be highlighted until the hung
  // worker returns (or a watchdog supersedes it). This is the intended
  // trade-off for collapsing streaming-burst write amplification.
  expect(codeRenderable.content).toBe("# New Documentation")
  expect(codeRenderable.filetype).toBe("markdown")
  expect(highlightCount).toBe(4)
  // The hung 4th call is still in flight on the mock; nothing for the 5th.
  expect(pendingPromises.filter((p) => p.never).length).toBe(1)
})

test("CodeRenderable - concealment is enabled by default", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello';",
    filetype: "javascript",
    syntaxStyle,
  })

  expect(codeRenderable.conceal).toBe(true)
})

test("CodeRenderable - concealment can be disabled explicitly", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello';",
    filetype: "javascript",
    syntaxStyle,
    conceal: false,
  })

  expect(codeRenderable.conceal).toBe(false)
})

test("CodeRenderable - applies concealment to styled text", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [[0, 5, "keyword"]] as SimpleHighlight[],
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello';",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    conceal: true,
    left: 0,
    top: 0,
  })

  currentRenderer.root.add(codeRenderable)

  expect(codeRenderable.conceal).toBe(true)

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  expect(codeRenderable.content).toBe("const message = 'hello';")
})

test("CodeRenderable - updating conceal re-chunks from cache without a new worker round-trip", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({ highlights: [] })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello';",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    conceal: true,
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  expect(codeRenderable.conceal).toBe(true)
  // Settle the initial highlight so we have a cached _lastHighlights to restyle from.
  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(mockClient.isHighlighting()).toBe(false)

  // Toggling conceal should NOT spawn a new worker round-trip — H3 reuses the
  // cached highlights and just re-runs chunking.
  codeRenderable.conceal = false
  expect(codeRenderable.conceal).toBe(false)

  await renderOnce()
  await codeRenderable.highlightingDone

  expect(mockClient.isHighlighting()).toBe(false)
})

test("CodeRenderable - drawUnstyledText is true by default", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello';",
    filetype: "javascript",
    syntaxStyle,
  })

  expect(codeRenderable.drawUnstyledText).toBe(true)
})

test("CodeRenderable - drawUnstyledText can be set to false", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello';",
    filetype: "javascript",
    syntaxStyle,
    drawUnstyledText: false,
  })

  expect(codeRenderable.drawUnstyledText).toBe(false)
})

test("CodeRenderable - with drawUnstyledText=true, text renders before highlighting", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [[0, 5, "keyword"]] as SimpleHighlight[],
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello';",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    drawUnstyledText: true,
    left: 0,
    top: 0,
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  expect(mockClient.isHighlighting()).toBe(true)

  expect(codeRenderable.plainText).toBe("const message = 'hello';")

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  expect(codeRenderable.plainText).toBe("const message = 'hello';")
})

test("CodeRenderable - with drawUnstyledText=false, text does not render before highlighting but lineCount is correct", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [[0, 5, "keyword"]] as SimpleHighlight[],
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello';",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    drawUnstyledText: false,
    left: 0,
    top: 0,
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  expect(mockClient.isHighlighting()).toBe(true)

  // Text buffer has content (for lineCount), but nothing renders yet
  expect(codeRenderable.plainText).toBe("const message = 'hello';")
  expect(codeRenderable.lineCount).toBe(1)
  const frameBeforeHighlighting = captureFrame()
  expect(frameBeforeHighlighting.trim()).toBe("")

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  expect(codeRenderable.plainText).toBe("const message = 'hello';")
  const frameAfterHighlighting = captureFrame()
  expect(frameAfterHighlighting).toContain("const message")
})

test("CodeRenderable - updating drawUnstyledText from false to true re-renders without a new worker round-trip", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({ highlights: [] })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello';",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    drawUnstyledText: false,
    left: 0,
    top: 0,
  })

  currentRenderer.root.add(codeRenderable)

  expect(codeRenderable.drawUnstyledText).toBe(false)

  await renderOnce()
  expect(codeRenderable.plainText).toBe("const message = 'hello';")
  expect(codeRenderable.lineCount).toBe(1)

  // Settle the initial highlight so the renderable has cached highlights.
  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))

  codeRenderable.drawUnstyledText = true
  expect(codeRenderable.drawUnstyledText).toBe(true)

  await renderOnce()
  await codeRenderable.highlightingDone

  // H3: no new worker call; restyle path handled it.
  expect(mockClient.isHighlighting()).toBe(false)
  expect(codeRenderable.plainText).toBe("const message = 'hello';")
})

test("CodeRenderable - updating drawUnstyledText from true to false re-renders without a new worker round-trip", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({ highlights: [] })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello';",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    drawUnstyledText: true,
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  expect(codeRenderable.drawUnstyledText).toBe(true)

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))

  codeRenderable.drawUnstyledText = false
  expect(codeRenderable.drawUnstyledText).toBe(false)

  await renderOnce()
  await codeRenderable.highlightingDone

  expect(mockClient.isHighlighting()).toBe(false)
})

test("CodeRenderable - uses fallback rendering on error even with drawUnstyledText=false", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()

  mockClient.highlightOnce = async () => {
    throw new Error("Highlighting failed")
  }

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello world';",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    drawUnstyledText: false,
    left: 0,
    top: 0,
  })

  currentRenderer.root.add(codeRenderable)

  await new Promise((resolve) => setTimeout(resolve, 20))
  await renderOnce()

  expect(codeRenderable.plainText).toBe("const message = 'hello world';")
})

test("CodeRenderable - with drawUnstyledText=false and no filetype, fallback is used", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello world';",
    syntaxStyle,
    drawUnstyledText: false,
    left: 0,
    top: 0,
  })

  currentRenderer.root.add(codeRenderable)

  await renderOnce()

  expect(codeRenderable.filetype).toBeUndefined()
  expect(codeRenderable.plainText).toBe("const message = 'hello world';")
})

test("CodeRenderable - with drawUnstyledText=false, multiple updates only render final highlighted text", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [[0, 3, "keyword"]] as SimpleHighlight[],
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello';",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    drawUnstyledText: false,
    left: 0,
    top: 0,
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  expect(mockClient.isHighlighting()).toBe(true)

  // Text buffer has content (for lineCount), but nothing renders yet
  expect(codeRenderable.plainText).toBe("const message = 'hello';")
  expect(codeRenderable.lineCount).toBe(1)
  const frameBeforeHighlighting = captureFrame()
  expect(frameBeforeHighlighting.trim()).toBe("")

  codeRenderable.content = "let newMessage = 'world';"
  await renderOnce()

  // Text buffer updated immediately, but still no rendering
  expect(codeRenderable.plainText).toBe("let newMessage = 'world';")
  expect(codeRenderable.lineCount).toBe(1)
  const frameAfterUpdate = captureFrame()
  expect(frameAfterUpdate.trim()).toBe("")

  // Coalescing: only the first highlight is in flight. Resolving it surfaces
  // a snapshot mismatch (content changed) which bails and schedules another
  // render; that render fires the highlight on the latest content, which we
  // then resolve as well.
  mockClient.resolveAllHighlightOnce()
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()
  mockClient.resolveAllHighlightOnce()
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()
  await new Promise((resolve) => setTimeout(resolve, 10))

  expect(mockClient.isHighlighting()).toBe(false)
  expect(codeRenderable.plainText).toBe("let newMessage = 'world';")
  const frameAfterHighlighting = captureFrame()
  expect(frameAfterHighlighting).toContain("let newMessage")
})

// TODO: flaky in CI because it needs to finish in time
// lib/tree-sitter/client.ts needs a way to check if the queue is empty
// then this can wait for all tree-sitter operations to complete
// instead of the arbitrary 500ms wait
// it worked before because text was set anyway for drawUnstyledText=false
test.skip("CodeRenderable - simulates markdown stream from LLM with async updates", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
    string: { fg: RGBA.fromValues(0, 1, 0, 1) },
    "markup.heading.1": { fg: RGBA.fromValues(0, 0, 1, 1) },
  })

  // Base markdown content that we'll repeat to grow to ~1MB
  const baseMarkdownContent = `# Code Example

Here's a simple TypeScript function:

\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

const message = greet("World");
console.log(message);
\`\`\`
`

  const targetSize = 64 * 128
  let fullMarkdownContent = ""
  let iteration = 0
  while (fullMarkdownContent.length < targetSize) {
    fullMarkdownContent += `\n--- Iteration ${iteration} ---\n\n` + baseMarkdownContent
    iteration++
  }

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-markdown-stream",
    content: "",
    filetype: "markdown",
    syntaxStyle,
    conceal: false,
    left: 0,
    top: 0,
    drawUnstyledText: false,
  })
  await codeRenderable.treeSitterClient.initialize()
  await codeRenderable.treeSitterClient.preloadParser("markdown")

  currentRenderer.root.add(codeRenderable)
  currentRenderer.start()

  let currentContent = ""

  const chunkSize = 64
  const chunks: string[] = []
  for (let i = 0; i < fullMarkdownContent.length; i += chunkSize) {
    chunks.push(fullMarkdownContent.slice(i, Math.min(i + chunkSize, fullMarkdownContent.length)))
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    currentContent += chunk
    codeRenderable.content = currentContent
    await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 25) + 1))
  }

  // wait for highlighting to complete (long for slow machines/CI)
  await new Promise((resolve) => setTimeout(resolve, 500))

  expect(codeRenderable.content).toBe(fullMarkdownContent)
  expect(codeRenderable.content.length).toBeGreaterThanOrEqual(targetSize)
  expect(codeRenderable.plainText).toContain("# Code Example")
  expect(codeRenderable.plainText).toContain("function greet")
  expect(codeRenderable.plainText).toContain("typescript")
  expect(codeRenderable.plainText).toContain("Hello")

  const plainText = codeRenderable.plainText
  expect(plainText.length).toBeGreaterThan(targetSize * 0.9)
  expect(plainText).toContain("Code Example")
  expect(plainText).toContain("const message = greet")
})

test("CodeRenderable - streaming option is false by default", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello';",
    filetype: "javascript",
    syntaxStyle,
  })

  expect(codeRenderable.streaming).toBe(false)
})

test("CodeRenderable - streaming can be enabled", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello';",
    filetype: "javascript",
    syntaxStyle,
    streaming: true,
  })

  expect(codeRenderable.streaming).toBe(true)
})

test("CodeRenderable - streaming applies provisional lexical styles before parser results", async () => {
  const keywordColor = RGBA.fromValues(0, 0, 1, 1)
  const typeColor = RGBA.fromValues(1, 0.5, 0, 1)
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: keywordColor },
    type: { fg: typeColor },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({ highlights: [] })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code-streaming-provisional-lexical",
    content: "class UserManager",
    filetype: "typescript",
    syntaxStyle,
    treeSitterClient: mockClient,
    streaming: true,
    drawUnstyledText: true,
    left: 0,
    top: 0,
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  const frame = captureSpans()
  const keywordSpan = findSpanContaining(frame, "class")
  const typeSpan = findSpanContaining(frame, "UserManager")
  expect(keywordSpan?.fg?.toInts()).toEqual(keywordColor.toInts())
  expect(typeSpan?.fg?.toInts()).toEqual(typeColor.toInts())
})

test("CodeRenderable - streaming mode respects drawUnstyledText only for initial content", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [[0, 5, "keyword"]] as SimpleHighlight[],
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const initial = 'hello';",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    streaming: true,
    drawUnstyledText: true,
    left: 0,
    top: 0,
  })

  currentRenderer.root.add(codeRenderable)

  await renderOnce()
  expect(codeRenderable.plainText).toBe("const initial = 'hello';")

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))

  codeRenderable.content = "const updated = 'world';"
  await new Promise((resolve) => queueMicrotask(resolve))

  expect(codeRenderable.content).toBe("const updated = 'world';")
})

test("CodeRenderable - streaming cached styling extends active-line class name style", async () => {
  const keywordColor = RGBA.fromValues(0, 0, 1, 1)
  const typeColor = RGBA.fromValues(1, 0.5, 0, 1)
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: keywordColor },
    type: { fg: typeColor },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [
      [0, 5, "keyword"],
      [6, 10, "type"],
    ] as SimpleHighlight[],
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code-streaming-active-token",
    content: "class User",
    filetype: "typescript",
    syntaxStyle,
    treeSitterClient: mockClient,
    streaming: true,
    drawUnstyledText: true,
    left: 0,
    top: 0,
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()
  mockClient.resolveAllHighlightOnce()
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  codeRenderable.content = "class UserManager"
  await renderOnce()

  const line = captureSpans().lines[0]
  expect(
    line.spans
      .map((span) => span.text)
      .join("")
      .slice(0, "class UserManager".length),
  ).toBe("class UserManager")
  expect(
    line.spans.some(
      (span) => span.text.includes("UserManager") && span.fg?.toInts().join() === typeColor.toInts().join(),
    ),
  ).toBe(true)
})

test("CodeRenderable - streaming keeps first token style when parser flips scope", async () => {
  const typeColor = RGBA.fromValues(1, 0.5, 0, 1)
  const variableColor = RGBA.fromValues(0, 1, 1, 1)
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
    type: { fg: typeColor },
    variable: { fg: variableColor },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [
      [0, 5, "keyword"],
      [6, 10, "type"],
    ] as SimpleHighlight[],
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code-streaming-style-lock",
    content: "class User",
    filetype: "typescript",
    syntaxStyle,
    treeSitterClient: mockClient,
    streaming: true,
    drawUnstyledText: true,
    left: 0,
    top: 0,
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()
  mockClient.resolveAllHighlightOnce()
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  codeRenderable.content = "class UserManager"
  await renderOnce()

  mockClient.setMockResult({
    highlights: [
      [0, 5, "keyword"],
      [6, 17, "variable"],
    ] as SimpleHighlight[],
  })
  mockClient.resolveAllHighlightOnce()
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  const line = captureSpans().lines[0]
  expect(
    line.spans.some(
      (span) => span.text.includes("UserManager") && span.fg?.toInts().join() === typeColor.toInts().join(),
    ),
  ).toBe(true)
  expect(
    line.spans.some(
      (span) => span.text.includes("UserManager") && span.fg?.toInts().join() === variableColor.toInts().join(),
    ),
  ).toBe(false)
})

test("CodeRenderable - streaming cached styling keeps completed lines highlighted while new line streams", async () => {
  const keywordColor = RGBA.fromValues(0, 0, 1, 1)
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: keywordColor },
    type: { fg: RGBA.fromValues(1, 0.5, 0, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [
      [0, 5, "keyword"],
      [6, 10, "type"],
    ] as SimpleHighlight[],
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code-streaming-completed-line",
    content: "class User\n",
    filetype: "typescript",
    syntaxStyle,
    treeSitterClient: mockClient,
    streaming: true,
    drawUnstyledText: true,
    left: 0,
    top: 0,
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()
  mockClient.resolveAllHighlightOnce()
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  codeRenderable.content = "class User\nclass UserManager"
  await renderOnce()

  const frame = captureSpans()
  const firstLineClass = frame.lines[0].spans.find((span) => span.text.includes("class"))
  expect(firstLineClass?.fg?.toInts()).toEqual(keywordColor.toInts())
  expect(
    frame.lines[1].spans.some(
      (span) => span.text.includes("class") && span.fg?.toInts().join() === keywordColor.toInts().join(),
    ),
  ).toBe(true)
})

test("CodeRenderable - ending streaming keeps styled text while final highlight is pending", async () => {
  const keywordColor = RGBA.fromValues(0, 0, 1, 1)
  const typeColor = RGBA.fromValues(1, 0.5, 0, 1)
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: keywordColor },
    type: { fg: typeColor },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [
      [0, 5, "keyword"],
      [6, 17, "type"],
    ] as SimpleHighlight[],
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code-streaming-end-no-white-flash",
    content: "class UserManager",
    filetype: "typescript",
    syntaxStyle,
    treeSitterClient: mockClient,
    streaming: true,
    drawUnstyledText: true,
    left: 0,
    top: 0,
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()
  mockClient.resolveAllHighlightOnce()
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  let frame = captureSpans()
  expect(findSpanContaining(frame, "class")?.fg?.toInts()).toEqual(keywordColor.toInts())
  expect(findSpanContaining(frame, "UserManager")?.fg?.toInts()).toEqual(typeColor.toInts())

  codeRenderable.streaming = false
  await renderOnce()

  frame = captureSpans()
  expect(findSpanContaining(frame, "class")?.fg?.toInts()).toEqual(keywordColor.toInts())
  expect(findSpanContaining(frame, "UserManager")?.fg?.toInts()).toEqual(typeColor.toInts())
})

test("CodeRenderable - streaming mode with drawUnstyledText=false waits for new highlights", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [[0, 5, "keyword"]] as SimpleHighlight[],
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const initial = 'hello';",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    streaming: true,
    drawUnstyledText: false,
    left: 0,
    top: 0,
  })

  currentRenderer.root.add(codeRenderable)

  await renderOnce()
  mockClient.resolveHighlightOnce(0)
  await codeRenderable.highlightingDone

  expect(codeRenderable.plainText).toBe("const initial = 'hello';")

  codeRenderable.content = "const updated = 'world';"
  expect(codeRenderable.plainText).toBe("const initial = 'hello';")

  await renderOnce()
  mockClient.resolveHighlightOnce(0)
  await codeRenderable.highlightingDone

  expect(codeRenderable.plainText).toBe("const updated = 'world';")
})

test("CodeRenderable - onChunks callback can transform chunks when highlights are empty", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({ highlights: [] })

  let callbackInvoked = false

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "hello",
    filetype: "plaintext",
    syntaxStyle,
    treeSitterClient: mockClient,
    onChunks: (chunks) => {
      callbackInvoked = true
      return chunks.map((chunk) => ({
        ...chunk,
        text: chunk.text.toUpperCase(),
      }))
    },
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  expect(callbackInvoked).toBe(true)
  expect(codeRenderable.plainText).toBe("HELLO")
})

test("CodeRenderable - baseHighlight applies a style when parser highlights are empty", async () => {
  const quoteColor = RGBA.fromValues(0.25, 0.5, 0.75, 1)
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    "markup.quote": { fg: quoteColor, italic: true },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({ highlights: [] })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code-base-highlight-empty",
    content: "hello world",
    filetype: "plaintext",
    syntaxStyle,
    treeSitterClient: mockClient,
    baseHighlight: "markup.quote",
  })

  currentRenderer.root.add(codeRenderable)
  await resolveMockHighlights(mockClient)

  const span = findSpanContaining(captureSpans(), "hello world")
  expect(span?.fg?.toInts()).toEqual(quoteColor.toInts())
  expect((span?.attributes ?? 0) & TextAttributes.ITALIC).toBe(TextAttributes.ITALIC)
})

test("CodeRenderable - parser highlights override baseHighlight properties and inherit unspecified ones", async () => {
  const quoteColor = RGBA.fromValues(0.25, 0.5, 0.75, 1)
  const keywordColor = RGBA.fromValues(1, 0, 0, 1)
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    "markup.quote": { fg: quoteColor, italic: true },
    keyword: { fg: keywordColor },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [[0, 5, "keyword"]] as SimpleHighlight[],
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code-base-highlight-precedence",
    content: "const value",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    baseHighlight: "markup.quote",
  })

  currentRenderer.root.add(codeRenderable)
  await resolveMockHighlights(mockClient)

  const keywordSpan = findSpanContaining(captureSpans(), "const")
  expect(keywordSpan?.fg?.toInts()).toEqual(keywordColor.toInts())
  expect((keywordSpan?.attributes ?? 0) & TextAttributes.ITALIC).toBe(TextAttributes.ITALIC)

  const baseSpan = findSpanContaining(captureSpans(), "value")
  expect(baseSpan?.fg?.toInts()).toEqual(quoteColor.toInts())
  expect((baseSpan?.attributes ?? 0) & TextAttributes.ITALIC).toBe(TextAttributes.ITALIC)
})

test("CodeRenderable - onHighlight receives parser highlights without baseHighlight", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    "markup.quote": { fg: RGBA.fromValues(0.25, 0.5, 0.75, 1) },
    keyword: { fg: RGBA.fromValues(1, 0, 0, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [[0, 5, "keyword"]] as SimpleHighlight[],
  })

  let receivedHighlights: SimpleHighlight[] | undefined
  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code-base-highlight-callback",
    content: "const value",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    baseHighlight: "markup.quote",
    onHighlight: (highlights) => {
      receivedHighlights = [...highlights]
      return highlights
    },
  })

  currentRenderer.root.add(codeRenderable)
  await resolveMockHighlights(mockClient)

  expect(receivedHighlights).toEqual([[0, 5, "keyword"]])
})

test("CodeRenderable - changing baseHighlight re-highlights content", async () => {
  const quoteColor = RGBA.fromValues(0.25, 0.5, 0.75, 1)
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    "markup.quote": { fg: quoteColor },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({ highlights: [] })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code-base-highlight-update",
    content: "hello world",
    filetype: "plaintext",
    syntaxStyle,
    treeSitterClient: mockClient,
    baseHighlight: "markup.quote",
  })

  currentRenderer.root.add(codeRenderable)
  await resolveMockHighlights(mockClient)
  expect(findSpanContaining(captureSpans(), "hello world")?.fg?.toInts()).toEqual(quoteColor.toInts())

  codeRenderable.baseHighlight = undefined
  await resolveMockHighlights(mockClient)
  expect(findSpanContaining(captureSpans(), "hello world")?.fg?.toInts()).toEqual(RGBA.fromValues(1, 1, 1, 1).toInts())
})

test("CodeRenderable - onHighlight callback receives highlights and context", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [[0, 5, "keyword"]] as SimpleHighlight[],
  })

  let callbackInvoked = false
  let receivedHighlights: SimpleHighlight[] | null = null
  let receivedContext: { content: string; filetype: string | undefined; syntaxStyle: SyntaxStyle } | null = null

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello';",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    onHighlight: (highlights, context) => {
      callbackInvoked = true
      receivedHighlights = [...highlights]
      receivedContext = { ...context }
      return highlights
    },
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  expect(callbackInvoked).toBe(true)
  expect(receivedHighlights).not.toBeNull()
  expect(receivedHighlights?.length).toBe(1)
  expect(receivedHighlights?.[0]).toEqual([0, 5, "keyword"])
  expect(receivedContext?.content).toBe("const message = 'hello';")
  expect(receivedContext?.filetype).toBe("javascript")
  expect(receivedContext?.syntaxStyle).toBe(syntaxStyle)
})

test("CodeRenderable - onHighlight callback can add custom highlights", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
    "custom.highlight": { fg: RGBA.fromValues(1, 0, 0, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [[0, 5, "keyword"]] as SimpleHighlight[],
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello';",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    onHighlight: (highlights) => {
      highlights.push([6, 13, "custom.highlight", {}])
      return highlights
    },
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  expect(codeRenderable.plainText).toBe("const message = 'hello';")

  // Verify both the original keyword highlight and the custom highlight are applied
  const lineHighlights = codeRenderable.getLineHighlights(0)
  expect(lineHighlights.length).toBeGreaterThanOrEqual(2)

  // Check keyword highlight exists with the correct styleId
  const keywordStyleId = syntaxStyle.getStyleId("keyword")
  const keywordHighlight = lineHighlights.find((h) => h.styleId === keywordStyleId)
  expect(keywordHighlight).toBeDefined()

  // Check custom highlight exists with the correct styleId
  const customStyleId = syntaxStyle.getStyleId("custom.highlight")
  const customHighlight = lineHighlights.find((h) => h.styleId === customStyleId)
  expect(customHighlight).toBeDefined()
})

test("CodeRenderable - onHighlight callback returning undefined uses original highlights", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [[0, 5, "keyword"]] as SimpleHighlight[],
  })

  let callbackInvoked = false

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello';",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    onHighlight: (highlights) => {
      callbackInvoked = true
      return undefined as unknown as SimpleHighlight[]
    },
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  expect(callbackInvoked).toBe(true)
  expect(codeRenderable.plainText).toBe("const message = 'hello';")
})

test("CodeRenderable - onHighlight callback is called on re-highlighting when content changes", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [[0, 5, "keyword"]] as SimpleHighlight[],
  })

  let callbackCount = 0

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello';",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    onHighlight: (highlights) => {
      callbackCount++
      return highlights
    },
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  expect(callbackCount).toBe(1)

  codeRenderable.content = "let newMessage = 'world';"
  await renderOnce()

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  expect(callbackCount).toBe(2)
})

test("CodeRenderable - onHighlight callback supports async functions", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
    "async.highlight": { fg: RGBA.fromValues(0, 1, 0, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [[0, 5, "keyword"]] as SimpleHighlight[],
  })

  let asyncCallbackCompleted = false

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello';",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    onHighlight: async (highlights) => {
      // Simulate async operation (e.g., fetching additional highlight data)
      await new Promise((resolve) => setTimeout(resolve, 5))
      highlights.push([6, 13, "async.highlight", {}])
      asyncCallbackCompleted = true
      return highlights
    },
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 20))
  await renderOnce()

  expect(asyncCallbackCompleted).toBe(true)
  expect(codeRenderable.plainText).toBe("const message = 'hello';")

  // Verify the async highlight was applied
  const lineHighlights = codeRenderable.getLineHighlights(0)
  expect(lineHighlights.length).toBeGreaterThanOrEqual(2)

  const asyncStyleId = syntaxStyle.getStyleId("async.highlight")
  const asyncHighlight = lineHighlights.find((h) => h.styleId === asyncStyleId && h.start === 6 && h.end === 13)
  expect(asyncHighlight).toBeDefined()
})

test("CodeRenderable - streaming mode caches highlights between updates", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [[0, 5, "keyword"]] as SimpleHighlight[],
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const initial = 'hello';",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    streaming: true,
    left: 0,
    top: 0,
  })

  currentRenderer.root.add(codeRenderable)

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))

  codeRenderable.content = "const updated = 'world';"
  await new Promise((resolve) => queueMicrotask(resolve))

  codeRenderable.content = "const updated2 = 'test';"
  await new Promise((resolve) => queueMicrotask(resolve))

  codeRenderable.content = "const final = 'done';"
  await new Promise((resolve) => queueMicrotask(resolve))

  await renderOnce()

  expect(codeRenderable.content).toBe("const final = 'done';")
  expect(codeRenderable.plainText).toBe("const final = 'done';")
})

test("CodeRenderable - streaming mode works with large content updates", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [[0, 5, "keyword"]] as SimpleHighlight[],
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const x = 1;",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    streaming: true,
    drawUnstyledText: true,
    left: 0,
    top: 0,
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  // Wait for initial highlighting
  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))

  // Simulate streaming with progressively larger content
  let content = "const x = 1;"
  for (let i = 0; i < 10; i++) {
    content += `\nconst var${i} = ${i};`
    codeRenderable.content = content
    await new Promise((resolve) => setTimeout(resolve, 5))
  }

  await renderOnce()
  mockClient.resolveAllHighlightOnce()
  await new Promise((resolve) => setTimeout(resolve, 20))
  await renderOnce()

  expect(codeRenderable.content).toContain("const var9 = 9;")
  expect(codeRenderable.plainText).toContain("const var9 = 9;")
})

test("CodeRenderable - disabling streaming reuses current cached highlights", async () => {
  const keywordColor = RGBA.fromValues(0, 0, 1, 1)
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: keywordColor },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [[0, 5, "keyword"]] as SimpleHighlight[],
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const initial = 'hello';",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    streaming: true,
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  expect(codeRenderable.streaming).toBe(true)

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))

  codeRenderable.streaming = false
  expect(codeRenderable.streaming).toBe(false)

  await renderOnce()

  expect(mockClient.isHighlighting()).toBe(false)
  expect(findSpanContaining(captureSpans(), "const")?.fg?.toInts()).toEqual(keywordColor.toInts())
})

test("CodeRenderable - streaming mode with drawUnstyledText=false shows nothing initially", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [[0, 5, "keyword"]] as SimpleHighlight[],
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const initial = 'hello';",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    streaming: true,
    drawUnstyledText: false,
    left: 0,
    top: 0,
  })

  currentRenderer.root.add(codeRenderable)

  await renderOnce()
  const frameBeforeHighlighting = captureFrame()
  expect(frameBeforeHighlighting.trim()).toBe("")

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  const frameAfterHighlighting = captureFrame()
  expect(frameAfterHighlighting).toContain("const initial")
})

test("CodeRenderable - streaming mode handles empty cached highlights gracefully", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [],
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "plain text",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    streaming: true,
    drawUnstyledText: true,
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))

  codeRenderable.content = "more plain text"
  await renderOnce()

  expect(codeRenderable.content).toBe("more plain text")
  expect(codeRenderable.plainText).toBe("more plain text")
})

test("CodeRenderable - selection across two Code renderables in flex row", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const container = new BoxRenderable(currentRenderer, {
    id: "container",
    width: 80,
    height: 10,
    flexDirection: "row",
    left: 0,
    top: 0,
  })
  currentRenderer.root.add(container)

  const leftCode = new CodeRenderable(currentRenderer, {
    id: "left-code",
    content: "line1\nline2\nline3\nline4\nline5",
    syntaxStyle,
    selectable: true,
    wrapMode: "none",
    width: 20,
    height: 5,
  })

  const rightCode = new CodeRenderable(currentRenderer, {
    id: "right-code",
    content: "lineA\nlineB\nlineC\nlineD\nlineE",
    syntaxStyle,
    selectable: true,
    wrapMode: "none",
    width: 20,
    height: 5,
  })

  container.add(leftCode)
  container.add(rightCode)

  await renderOnce()

  expect(leftCode.x).toBe(0)
  expect(rightCode.x).toBeGreaterThan(leftCode.x)

  const startX = leftCode.x + 2
  const startY = leftCode.y + 2
  const endX = rightCode.x + 3
  const endY = rightCode.y + rightCode.height + 2

  await mockMouse.drag(startX, startY, endX, endY)
  await renderOnce()

  expect(leftCode.hasSelection()).toBe(true)
  expect(rightCode.hasSelection()).toBe(true)

  const leftSelection = leftCode.getSelectedText()
  const rightSelection = rightCode.getSelectedText()
  const leftSelectionObj = leftCode.getSelection()
  const rightSelectionObj = rightCode.getSelection()

  expect(leftSelectionObj).not.toBeNull()
  expect(rightSelectionObj).not.toBeNull()

  if (leftSelectionObj && rightSelectionObj) {
    expect(leftSelectionObj.start).toBeGreaterThan(0)
    expect(leftSelectionObj.end).toBe(29)
    expect(rightSelectionObj.start).toBe(0)
    expect(rightSelectionObj.end).toBe(29)
    expect(leftSelection).toBe("ne3\nline4\nline5")
    expect(rightSelection).toBe("lineA\nlineB\nlineC\nlineD\nlineE")
  }
})

test("CodeRenderable - content update during async highlighting does not get overwritten by stale highlight result", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({
    highlights: [[0, 5, "keyword"]] as SimpleHighlight[],
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "line1\nline2\nline3",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    drawUnstyledText: true,
  })

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  expect(mockClient.isHighlighting()).toBe(true)
  expect(codeRenderable.lineCount).toBe(3)

  codeRenderable.content = "line1\nline2\nline3\nline4\nline5"
  expect(codeRenderable.lineCount).toBe(5)

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))

  expect(codeRenderable.content).toBe("line1\nline2\nline3\nline4\nline5")
  expect(codeRenderable.lineCount).toBe(5)

  await renderOnce()
  expect(codeRenderable.lineCount).toBe(5)

  expect(mockClient.isHighlighting()).toBe(true)

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  expect(codeRenderable.content).toBe("line1\nline2\nline3\nline4\nline5")
  expect(codeRenderable.lineCount).toBe(5)
  expect(codeRenderable.plainText).toBe("line1\nline2\nline3\nline4\nline5")
})

test("CodeRenderable - lineCount is correct immediately with drawUnstyledText=false", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({ highlights: [] })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "line1\nline2\nline3\nline4\nline5",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    drawUnstyledText: false,
  })

  expect(codeRenderable.lineCount).toBe(5)
  expect(codeRenderable.content).toBe("line1\nline2\nline3\nline4\nline5")

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  expect(mockClient.isHighlighting()).toBe(true)
  expect(codeRenderable.lineCount).toBe(5)

  const frameBeforeHighlighting = captureFrame()
  expect(frameBeforeHighlighting.trim()).toBe("")

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  expect(codeRenderable.lineCount).toBe(5)
  const frameAfterHighlighting = captureFrame()
  expect(frameAfterHighlighting).toContain("line1")
})

test("CodeRenderable - lineCount updates correctly when content changes with drawUnstyledText=false", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({ highlights: [] })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "line1\nline2\nline3",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    drawUnstyledText: false,
  })

  expect(codeRenderable.lineCount).toBe(3)

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  codeRenderable.content = "line1\nline2\nline3\nline4\nline5\nline6\nline7"
  expect(codeRenderable.lineCount).toBe(7)

  await renderOnce()
  expect(codeRenderable.lineCount).toBe(7)

  codeRenderable.content = "line1\nline2"
  expect(codeRenderable.lineCount).toBe(2)

  await renderOnce()
  expect(codeRenderable.lineCount).toBe(2)
})

test("CodeRenderable - lineInfo is accessible with drawUnstyledText=false before highlighting", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({ highlights: [] })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "short\nlonger line here\nmed",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    drawUnstyledText: false,
  })

  currentRenderer.root.add(codeRenderable)

  expect(codeRenderable.lineCount).toBe(3)
  expect(codeRenderable.lineInfo.lineStartCols.length).toBe(3)

  await renderOnce()

  expect(mockClient.isHighlighting()).toBe(true)
  expect(codeRenderable.lineInfo.lineStartCols.length).toBe(3)
  expect(codeRenderable.lineInfo.lineSources.length).toBe(3)

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  expect(codeRenderable.lineInfo.lineStartCols.length).toBe(3)
  expect(codeRenderable.lineInfo.lineSources.length).toBe(3)
})

test("CodeRenderable - plainText reflects content immediately with drawUnstyledText=false", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({ highlights: [] })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "initial content",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    drawUnstyledText: false,
  })

  expect(codeRenderable.plainText).toBe("initial content")

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  expect(mockClient.isHighlighting()).toBe(true)
  expect(codeRenderable.plainText).toBe("initial content")

  codeRenderable.content = "updated content"
  expect(codeRenderable.plainText).toBe("updated content")

  await renderOnce()
  const frame = captureFrame()
  expect(frame.trim()).toBe("")

  // Coalescing: the initial highlight (on "initial content") is still in
  // flight when we set "updated content". Resolving it bails on snapshot
  // mismatch and schedules the highlight for the latest content, which we
  // resolve on the second pass.
  mockClient.resolveAllHighlightOnce()
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()
  mockClient.resolveAllHighlightOnce()
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  expect(codeRenderable.plainText).toBe("updated content")
  const finalFrame = captureFrame()
  expect(finalFrame).toContain("updated content")
})

test("CodeRenderable - textLength is correct with drawUnstyledText=false", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({ highlights: [] })

  const content = "hello world test"
  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content,
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    drawUnstyledText: false,
  })

  expect(codeRenderable.textLength).toBe(content.length)

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  expect(codeRenderable.textLength).toBe(content.length)

  const newContent = "longer content here"
  codeRenderable.content = newContent
  expect(codeRenderable.textLength).toBe(newContent.length)
})

test("CodeRenderable - streaming mode with drawUnstyledText=false has correct lineCount", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({ highlights: [] })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "line1\nline2",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    streaming: true,
    drawUnstyledText: false,
  })

  expect(codeRenderable.lineCount).toBe(2)

  currentRenderer.root.add(codeRenderable)
  await renderOnce()

  const frameBeforeHighlighting = captureFrame()
  expect(frameBeforeHighlighting.trim()).toBe("")

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  expect(codeRenderable.lineCount).toBe(2)

  codeRenderable.content = "line1\nline2\nline3\nline4"
  expect(codeRenderable.lineCount).toBe(2)

  codeRenderable.content = "line1\nline2\nline3\nline4\nline5\nline6"
  expect(codeRenderable.lineCount).toBe(2)

  await renderOnce()
  mockClient.resolveAllHighlightOnce()
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  expect(codeRenderable.lineCount).toBe(6)
  const finalFrame = captureFrame()
  expect(finalFrame).toContain("line1")
})

test("CodeRenderable - streaming with conceal and drawUnstyledText=false should not jump when fenced code blocks are concealed", async () => {
  resize(80, 20)

  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
    string: { fg: RGBA.fromValues(0, 1, 0, 1) },
    "markup.heading.1": { fg: RGBA.fromValues(0, 0, 1, 1) },
    "markup.raw.block": { fg: RGBA.fromValues(0.5, 0.5, 0.5, 1) },
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-markdown",
    content: "# Example",
    filetype: "markdown",
    syntaxStyle,
    streaming: true,
    conceal: true,
    drawUnstyledText: false,
    left: 0,
    top: 0,
  })

  currentRenderer.root.add(codeRenderable)

  const waitForHighlightingCycle = async (timeout = 2000) => {
    const start = Date.now()
    await renderOnce()
    await new Promise((resolve) => setTimeout(resolve, 10))
    while (codeRenderable.isHighlighting && Date.now() - start < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    await renderOnce()
  }

  // Use TestRecorder to capture frames
  const { TestRecorder } = await import("../testing/test-recorder.js")
  const recorder = new TestRecorder(currentRenderer)

  // Start renderer and recorder
  currentRenderer.start()
  recorder.rec()

  // Wait for initial highlighting to complete
  await waitForHighlightingCycle()

  // Now simulate streaming: add more content including fenced code block
  codeRenderable.content = `# Example\n\nHere's some code:\n\n\`\`\`typescript\nconst x = 1;\n\`\`\``

  // Wait for highlighting to process the update
  await waitForHighlightingCycle()

  // Stop everything
  currentRenderer.stop()
  recorder.stop()

  const frames = recorder.recordedFrames

  // Analyze frames to detect the presence of backticks
  const frameAnalysis: Array<{ hasBackticks: boolean; lineCount: number; isEmpty: boolean }> = []

  for (const recordedFrame of frames) {
    const frame = recordedFrame.frame
    const hasBackticks = frame.includes("```")
    const lines = frame.split("\n").filter((line) => line.trim().length > 0)
    const isEmpty = frame.trim().length === 0

    frameAnalysis.push({
      hasBackticks,
      lineCount: lines.length,
      isEmpty,
    })
  }

  let hasFlickering = false
  for (let i = 2; i < frameAnalysis.length; i++) {
    const prev = frameAnalysis[i - 1]
    const curr = frameAnalysis[i]
    if (!prev.isEmpty && curr.isEmpty) {
      hasFlickering = true
    }
  }

  const framesWithBackticks = frameAnalysis.filter((f) => f.hasBackticks && !f.isEmpty)

  expect(framesWithBackticks.length).toBe(0)
  expect(hasFlickering).toBe(false)

  const finalFrame = frameAnalysis[frameAnalysis.length - 1]
  expect(finalFrame.isEmpty).toBe(false)
  expect(finalFrame.hasBackticks).toBe(false)
  expect(finalFrame.lineCount).toBe(3)

  const finalFrameText = frames[frames.length - 1].frame
  expect(finalFrameText).toContain("Example")
  expect(finalFrameText).toContain("Here's some code")
  expect(finalFrameText).toContain("const x = 1")
  expect(finalFrameText).not.toContain("```")
})

test("CodeRenderable - streaming with drawUnstyledText=false falls back to unstyled text when highlights fail", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const mockClient = new MockTreeSitterClient()

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const initial = 'hello';",
    filetype: "javascript",
    syntaxStyle,
    treeSitterClient: mockClient,
    streaming: true,
    drawUnstyledText: false,
    left: 0,
    top: 0,
  })

  currentRenderer.root.add(codeRenderable)

  await renderOnce()
  mockClient.resolveHighlightOnce(0)
  await codeRenderable.highlightingDone

  mockClient.highlightOnce = async () => {
    throw new Error("Highlighting failed")
  }

  codeRenderable.content = "const updated = 'world';"

  await renderOnce()
  await codeRenderable.highlightingDone

  expect(codeRenderable.plainText).toBe("const updated = 'world';")
})
