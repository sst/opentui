import { test, expect, beforeEach, afterEach } from "bun:test"
import { CodeRenderable } from "./Code"
import { SyntaxStyle } from "../lib/syntax-style"
import { RGBA } from "../lib/RGBA"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"
import { TreeSitterClient } from "../lib/tree-sitter"
import type { SimpleHighlight } from "../lib/tree-sitter/types"

class MockTreeSitterClient extends TreeSitterClient {
  private _highlightOnceResolver:
    | ((result: { highlights?: SimpleHighlight[]; warning?: string; error?: string }) => void)
    | null = null
  private _highlightOncePromise: Promise<{ highlights?: SimpleHighlight[]; warning?: string; error?: string }> | null =
    null
  private _mockResult: { highlights?: SimpleHighlight[]; warning?: string; error?: string } = { highlights: [] }

  constructor() {
    super({ dataPath: "/tmp/mock" })
  }

  async highlightOnce(
    content: string,
    filetype: string,
  ): Promise<{ highlights?: SimpleHighlight[]; warning?: string; error?: string }> {
    this._highlightOncePromise = new Promise((resolve) => {
      this._highlightOnceResolver = resolve
    })

    return this._highlightOncePromise
  }

  setMockResult(result: { highlights?: SimpleHighlight[]; warning?: string; error?: string }) {
    this._mockResult = result
  }

  resolveHighlightOnce() {
    if (this._highlightOnceResolver) {
      this._highlightOnceResolver(this._mockResult)
      this._highlightOnceResolver = null
      this._highlightOncePromise = null
    }
  }

  isHighlighting(): boolean {
    return this._highlightOncePromise !== null
  }
}

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
  const syntaxStyle = new SyntaxStyle({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
    string: { fg: RGBA.fromValues(0, 1, 0, 1) },
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: 'const message = "Hello, world!";',
    filetype: "javascript",
    syntaxStyle,
  })

  expect(codeRenderable.content).toBe('const message = "Hello, world!";')
  expect(codeRenderable.filetype).toBe("javascript")
  expect(codeRenderable.syntaxStyle).toBe(syntaxStyle)
})

test("CodeRenderable - content updates", async () => {
  const syntaxStyle = new SyntaxStyle({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "original content",
    filetype: "javascript",
    syntaxStyle,
  })

  expect(codeRenderable.content).toBe("original content")

  codeRenderable.content = "updated content"
  expect(codeRenderable.content).toBe("updated content")
})

test("CodeRenderable - filetype updates", async () => {
  const syntaxStyle = new SyntaxStyle({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "console.log('test');",
    filetype: "javascript",
    syntaxStyle,
  })

  expect(codeRenderable.filetype).toBe("javascript")

  codeRenderable.filetype = "typescript"
  expect(codeRenderable.filetype).toBe("typescript")
})

test("CodeRenderable - re-highlighting when content changes during active highlighting", async () => {
  const syntaxStyle = new SyntaxStyle({
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
  })

  expect(mockClient.isHighlighting()).toBe(true)

  codeRenderable.content = "let newMessage = 'world';"

  expect(codeRenderable.content).toBe("let newMessage = 'world';")
  expect(mockClient.isHighlighting()).toBe(true)

  mockClient.resolveHighlightOnce()
  await new Promise((resolve) => setTimeout(resolve, 10))

  expect(mockClient.isHighlighting()).toBe(true)

  mockClient.resolveHighlightOnce()

  expect(mockClient.isHighlighting()).toBe(false)
})

test("CodeRenderable - multiple content changes during highlighting", async () => {
  const syntaxStyle = new SyntaxStyle({
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
  })

  expect(mockClient.isHighlighting()).toBe(true)

  codeRenderable.content = "first change"
  codeRenderable.content = "second change"
  codeRenderable.content = "final content"

  expect(codeRenderable.content).toBe("final content")
  expect(mockClient.isHighlighting()).toBe(true)

  mockClient.resolveHighlightOnce()

  await new Promise((resolve) => setTimeout(resolve, 10))

  expect(mockClient.isHighlighting()).toBe(true)

  mockClient.resolveHighlightOnce()

  expect(mockClient.isHighlighting()).toBe(false)
})

test("CodeRenderable - fallback when no filetype provided", async () => {
  const syntaxStyle = new SyntaxStyle({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "const message = 'hello world';",
    syntaxStyle,
    // No filetype provided - should trigger fallback
  })

  await renderOnce()

  expect(codeRenderable.content).toBe("const message = 'hello world';")
  expect(codeRenderable.filetype).toBeUndefined()
  expect(codeRenderable.plainText).toBe("const message = 'hello world';")
})

test("CodeRenderable - fallback when highlighting throws error", async () => {
  const syntaxStyle = new SyntaxStyle({
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
  })

  await renderOnce()

  expect(codeRenderable.content).toBe("const message = 'hello world';")
  expect(codeRenderable.filetype).toBe("javascript")
  expect(codeRenderable.plainText).toBe("const message = 'hello world';")
})

test("CodeRenderable - early return when content is empty", async () => {
  const syntaxStyle = new SyntaxStyle({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const codeRenderable = new CodeRenderable(currentRenderer, {
    id: "test-code",
    content: "", // Empty content should trigger early return
    filetype: "javascript",
    syntaxStyle,
  })

  await renderOnce()

  expect(codeRenderable.content).toBe("")
  expect(codeRenderable.filetype).toBe("javascript")
  expect(codeRenderable.plainText).toBe("")
})

test("CodeRenderable - empty content does not trigger highlighting", async () => {
  const syntaxStyle = new SyntaxStyle({
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
  })

  mockClient.resolveHighlightOnce()
  await renderOnce()

  await new Promise((resolve) => setTimeout(resolve, 10))

  expect(codeRenderable.content).toBe("const message = 'hello';")
  expect(codeRenderable.plainText).toBe("const message = 'hello';")

  codeRenderable.content = ""

  expect(mockClient.isHighlighting()).toBe(false)
  expect(codeRenderable.content).toBe("")
})

test("CodeRenderable - text renders immediately before highlighting completes", async () => {
  const syntaxStyle = new SyntaxStyle({
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
    left: 0,
    top: 0,
  })

  currentRenderer.root.add(codeRenderable)

  expect(mockClient.isHighlighting()).toBe(true)

  await renderOnce()

  const frameBeforeHighlighting = captureFrame()
  expect(frameBeforeHighlighting).toMatchSnapshot("text visible before highlighting completes")

  mockClient.resolveHighlightOnce()
  await new Promise((resolve) => setTimeout(resolve, 10))
  await renderOnce()

  const frameAfterHighlighting = captureFrame()
  expect(frameAfterHighlighting).toMatchSnapshot("text visible after highlighting completes")
})
