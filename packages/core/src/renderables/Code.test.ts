import { test, expect, beforeEach, afterEach } from "bun:test"
import { CodeRenderable } from "./Code"
import { SyntaxStyle } from "../lib/syntax-style"
import { RGBA } from "../lib/RGBA"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>

beforeEach(async () => {
  const testRenderer = await createTestRenderer({ width: 80, height: 24 })
  currentRenderer = testRenderer.renderer
  renderOnce = testRenderer.renderOnce
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
