import { test, expect, beforeEach, afterEach } from "bun:test"
import { CodeRenderable } from "./Code"
import { SyntaxStyle } from "../syntax-style"
import { RGBA } from "../lib/RGBA"
import { createTestRenderer, type TestRenderer, MockTreeSitterClient } from "../testing"
import { TreeSitterClient } from "../lib/tree-sitter"
import type { SimpleHighlight } from "../lib/tree-sitter/types"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>
let captureFrame: () => string

beforeEach(async () => {
  const testRenderer = await createTestRenderer({ width: 32, height: 2 })
  currentRenderer = testRenderer.renderer
  renderOnce = testRenderer.renderOnce
  captureFrame = testRenderer.captureCharFrame
})

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

  expect(mockClient.isHighlighting()).toBe(true)

  codeRenderable.content = "let newMessage = 'world';"

  expect(codeRenderable.content).toBe("let newMessage = 'world';")
  expect(mockClient.isHighlighting()).toBe(true)

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))

  expect(mockClient.isHighlighting()).toBe(true)

  mockClient.resolveHighlightOnce(0)

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

  expect(mockClient.isHighlighting()).toBe(true)

  codeRenderable.content = "first change"
  codeRenderable.content = "second change"
  codeRenderable.content = "final content"

  expect(codeRenderable.content).toBe("final content")
  expect(mockClient.isHighlighting()).toBe(true)

  mockClient.resolveHighlightOnce(0)

  await new Promise((resolve) => setTimeout(resolve, 10))

  expect(mockClient.isHighlighting()).toBe(true)

  mockClient.resolveHighlightOnce(0)

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

  mockClient.resolveHighlightOnce(0)
  await renderOnce()

  await new Promise((resolve) => setTimeout(resolve, 10))

  expect(codeRenderable.content).toBe("const message = 'hello';")
  expect(codeRenderable.plainText).toBe("const message = 'hello';")

  codeRenderable.content = ""

  expect(mockClient.isHighlighting()).toBe(false)
  expect(codeRenderable.content).toBe("")
})

test("CodeRenderable - text renders immediately before highlighting completes", async () => {
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

  expect(mockClient.isHighlighting()).toBe(true)

  await renderOnce()

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

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))

  highlightCount = 0

  codeRenderable.content = "let newMessage = 'world';"
  codeRenderable.filetype = "typescript"

  await new Promise((resolve) => queueMicrotask(resolve))

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

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))

  highlightCount = 0
  highlightCalls.length = 0

  codeRenderable.content = "first content change"
  codeRenderable.filetype = "typescript"
  codeRenderable.content = "second content change"

  await new Promise((resolve) => queueMicrotask(resolve))

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

test("CodeRenderable - continues highlighting after unresolved promise", async () => {
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

  await new Promise((resolve) => setTimeout(resolve, 20))

  highlightCount = 0
  pendingPromises.length = 0

  codeRenderable.content = "const message = 'hello';"
  codeRenderable.filetype = "javascript"
  await new Promise((resolve) => setTimeout(resolve, 20))

  codeRenderable.content = "# Documentation"
  codeRenderable.filetype = "markdown"
  await new Promise((resolve) => setTimeout(resolve, 20))

  codeRenderable.content = "const message = 'world';"
  codeRenderable.filetype = "javascript"
  await new Promise((resolve) => setTimeout(resolve, 20))

  codeRenderable.content = "interface User { name: string; }"
  codeRenderable.filetype = "typescript"
  await new Promise((resolve) => setTimeout(resolve, 20))

  codeRenderable.content = "# New Documentation"
  codeRenderable.filetype = "markdown"
  await new Promise((resolve) => queueMicrotask(resolve))
  await new Promise((resolve) => setTimeout(resolve, 20))

  const markdownHighlightHappened = pendingPromises.some(
    (p) => p.content === "# New Documentation" && p.filetype === "markdown",
  )

  expect(codeRenderable.content).toBe("# New Documentation")
  expect(codeRenderable.filetype).toBe("markdown")
  expect(markdownHighlightHappened).toBe(true)
  expect(highlightCount).toBe(5)
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

test("CodeRenderable - updating conceal triggers re-highlighting", async () => {
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

  expect(codeRenderable.conceal).toBe(true)

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))

  codeRenderable.conceal = false
  expect(codeRenderable.conceal).toBe(false)

  await new Promise((resolve) => queueMicrotask(resolve))
  await new Promise((resolve) => queueMicrotask(resolve))

  expect(mockClient.isHighlighting()).toBe(true)
  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
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

  expect(mockClient.isHighlighting()).toBe(true)

  await renderOnce()

  expect(codeRenderable.plainText).toBe("const message = 'hello';")

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  expect(codeRenderable.plainText).toBe("const message = 'hello';")
})

test("CodeRenderable - with drawUnstyledText=false, text does not render before highlighting", async () => {
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

  expect(mockClient.isHighlighting()).toBe(true)

  await renderOnce()

  expect(codeRenderable.plainText).toBe("const message = 'hello';")
  const frameBeforeHighlighting = captureFrame()
  expect(frameBeforeHighlighting.trim()).toBe("")

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  expect(codeRenderable.plainText).toBe("const message = 'hello';")
  const frameAfterHighlighting = captureFrame()
  expect(frameAfterHighlighting).toContain("const message")
})

test("CodeRenderable - updating drawUnstyledText from false to true triggers re-highlighting", async () => {
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

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))

  codeRenderable.drawUnstyledText = true
  expect(codeRenderable.drawUnstyledText).toBe(true)

  await new Promise((resolve) => queueMicrotask(resolve))

  expect(mockClient.isHighlighting()).toBe(true)

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  expect(mockClient.isHighlighting()).toBe(false)
  expect(codeRenderable.plainText).toBe("const message = 'hello';")
})

test("CodeRenderable - updating drawUnstyledText from true to false triggers re-highlighting", async () => {
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

  expect(codeRenderable.drawUnstyledText).toBe(true)

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))

  codeRenderable.drawUnstyledText = false
  expect(codeRenderable.drawUnstyledText).toBe(false)

  await new Promise((resolve) => queueMicrotask(resolve))
  await new Promise((resolve) => queueMicrotask(resolve))

  expect(mockClient.isHighlighting()).toBe(true)
  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
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

test("CodeRenderable - with drawUnstyledText=false, multiple updates only show final highlighted text", async () => {
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

  expect(mockClient.isHighlighting()).toBe(true)

  await renderOnce()
  expect(codeRenderable.plainText).toBe("const message = 'hello';")
  const frameBeforeHighlighting = captureFrame()
  expect(frameBeforeHighlighting.trim()).toBe("")

  codeRenderable.content = "let newMessage = 'world';"
  await new Promise((resolve) => queueMicrotask(resolve))

  await renderOnce()
  expect(codeRenderable.plainText).toBe("let newMessage = 'world';")
  const frameAfterUpdate = captureFrame()
  expect(frameAfterUpdate.trim()).toBe("")

  mockClient.resolveAllHighlightOnce()
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  expect(mockClient.isHighlighting()).toBe(false)
  expect(codeRenderable.plainText).toBe("let newMessage = 'world';")
  const frameAfterHighlighting = captureFrame()
  expect(frameAfterHighlighting).toContain("let newMessage")
})

test("CodeRenderable - simulates markdown stream from LLM with async updates", async () => {
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

  await new Promise((resolve) => setTimeout(resolve, 100))

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

  // Initial content should show unstyled text
  await renderOnce()
  expect(codeRenderable.plainText).toBe("const initial = 'hello';")

  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))

  // Update content - should NOT show unstyled text immediately in streaming mode
  codeRenderable.content = "const updated = 'world';"
  await new Promise((resolve) => queueMicrotask(resolve))

  // Content should be updated but rendering depends on cached highlights
  expect(codeRenderable.content).toBe("const updated = 'world';")
})

test("CodeRenderable - streaming mode uses cached highlights for partial styling", async () => {
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

  // Wait for initial highlighting
  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  // Update content - should use cached highlights immediately
  codeRenderable.content = "const updated = 'world';"
  await new Promise((resolve) => queueMicrotask(resolve))
  await renderOnce()

  // Text should be visible with partial styling from cached highlights
  expect(codeRenderable.plainText).toBe("const updated = 'world';")

  // Wait for new highlights
  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  // Should still have correct content with updated highlights
  expect(codeRenderable.plainText).toBe("const updated = 'world';")
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

  // Wait for initial highlighting
  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))

  // Multiple rapid updates
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

  mockClient.resolveAllHighlightOnce()
  await new Promise((resolve) => setTimeout(resolve, 20))
  await renderOnce()

  expect(codeRenderable.content).toContain("const var9 = 9;")
  expect(codeRenderable.plainText).toContain("const var9 = 9;")
})

test("CodeRenderable - disabling streaming clears cached highlights", async () => {
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
  })

  expect(codeRenderable.streaming).toBe(true)

  // Wait for initial highlighting
  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))

  // Disable streaming
  codeRenderable.streaming = false
  expect(codeRenderable.streaming).toBe(false)

  await new Promise((resolve) => queueMicrotask(resolve))

  // Should trigger re-highlighting
  expect(mockClient.isHighlighting()).toBe(true)
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

  // Initial render should show nothing
  await renderOnce()
  const frameBeforeHighlighting = captureFrame()
  expect(frameBeforeHighlighting.trim()).toBe("")

  // After highlighting completes, content should be visible
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

  // Wait for initial highlighting (which returns empty highlights)
  mockClient.resolveHighlightOnce(0)
  await new Promise((resolve) => setTimeout(resolve, 10))

  // Update content - should not crash with empty cached highlights
  codeRenderable.content = "more plain text"
  await new Promise((resolve) => queueMicrotask(resolve))

  expect(codeRenderable.content).toBe("more plain text")
  expect(codeRenderable.plainText).toBe("more plain text")
})
