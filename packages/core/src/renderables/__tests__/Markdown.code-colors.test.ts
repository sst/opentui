import { test, expect, beforeEach, afterEach } from "bun:test"
import { MarkdownRenderable, type MarkdownOptions } from "../Markdown.js"
import { CodeRenderable } from "../Code.js"
import { SyntaxStyle } from "../../syntax-style.js"
import { RGBA } from "../../lib/RGBA.js"
import { createTestRenderer, type TestRenderer, MockTreeSitterClient } from "../../testing.js"
import type { CapturedFrame } from "../../types.js"

let renderer: TestRenderer
let captureSpans: () => CapturedFrame

const syntaxStyle = SyntaxStyle.fromStyles({
  default: { fg: RGBA.fromValues(1, 1, 1, 1) },
})

beforeEach(async () => {
  const testRenderer = await createTestRenderer({ width: 60, height: 20 })
  renderer = testRenderer.renderer
  captureSpans = testRenderer.captureSpans
})

afterEach(async () => {
  if (renderer) {
    renderer.destroy()
  }
})

function createMarkdownRenderable(options: MarkdownOptions): MarkdownRenderable {
  return new MarkdownRenderable(renderer, options)
}

function findSpanContaining(frame: CapturedFrame, text: string) {
  for (const line of frame.lines) {
    const span = line.spans.find((candidate) => candidate.text.includes(text))
    if (span) return span
  }

  return undefined
}

function expectSpanColors(text: string, fg: RGBA, bg: RGBA): void {
  const span = findSpanContaining(captureSpans(), text)
  expect(span).toBeDefined()
  expect(span!.fg.equals(fg)).toBe(true)
  expect(span!.bg.equals(bg)).toBe(true)
}

test("unlabeled fenced code blocks inherit markdown fg/bg defaults", async () => {
  const fg = RGBA.fromValues(0.1, 0.1, 0.1, 1)
  const bg = RGBA.fromValues(0.95, 0.95, 0.95, 1)

  const md = createMarkdownRenderable({
    id: "markdown-code-default-colors",
    content: "```\nplain code block\n```",
    syntaxStyle,
    fg,
    bg,
  })

  renderer.root.add(md)
  await renderer.idle()

  const codeBlock = md._blockStates[0]?.renderable as CodeRenderable
  expect(codeBlock).toBeInstanceOf(CodeRenderable)
  expect(codeBlock.filetype).toBeUndefined()
  expect(codeBlock.fg.equals(fg)).toBe(true)
  expect(codeBlock.bg.equals(bg)).toBe(true)
  expectSpanColors("plain code block", fg, bg)
})

test("unsupported fenced code blocks keep inherited markdown fg/bg after highlight fallback", async () => {
  const fg = RGBA.fromValues(0.15, 0.15, 0.15, 1)
  const bg = RGBA.fromValues(0.9, 0.9, 0.9, 1)
  const mockTreeSitterClient = new MockTreeSitterClient()
  mockTreeSitterClient.setMockResult({
    highlights: [],
    warning: "No parser available for filetype toml",
  })

  const md = createMarkdownRenderable({
    id: "markdown-code-unsupported-colors",
    content: "```toml\nanswer = 42\n```",
    syntaxStyle,
    fg,
    bg,
    treeSitterClient: mockTreeSitterClient,
  })

  renderer.root.add(md)
  await renderer.idle()
  expect(mockTreeSitterClient.isHighlighting()).toBe(true)

  mockTreeSitterClient.resolveAllHighlightOnce()
  await Bun.sleep(10)
  await renderer.idle()

  const codeBlock = md._blockStates[0]?.renderable as CodeRenderable
  expect(codeBlock).toBeInstanceOf(CodeRenderable)
  expect(codeBlock.filetype).toBe("toml")
  expect(codeBlock.fg.equals(fg)).toBe(true)
  expect(codeBlock.bg.equals(bg)).toBe(true)
  expectSpanColors("answer = 42", fg, bg)
})

test("updating markdown fg/bg rerenders existing fenced code block renderables", async () => {
  const initialFg = RGBA.fromValues(0.1, 0.1, 0.1, 1)
  const initialBg = RGBA.fromValues(0.95, 0.95, 0.95, 1)
  const nextFg = RGBA.fromValues(0.8, 0.8, 0.8, 1)
  const nextBg = RGBA.fromValues(0.2, 0.2, 0.2, 1)

  const md = createMarkdownRenderable({
    id: "markdown-code-color-update",
    content: "```\nplain code block\n```",
    syntaxStyle,
    fg: initialFg,
    bg: initialBg,
  })

  renderer.root.add(md)
  await renderer.idle()

  const codeBlock = md._blockStates[0]?.renderable as CodeRenderable
  expect(codeBlock).toBeInstanceOf(CodeRenderable)
  expectSpanColors("plain code block", initialFg, initialBg)

  md.fg = nextFg
  md.bg = nextBg
  renderer.requestRender()
  await renderer.idle()

  expect(md._blockStates[0]?.renderable).toBe(codeBlock)
  expect(codeBlock.fg.equals(nextFg)).toBe(true)
  expect(codeBlock.bg.equals(nextBg)).toBe(true)
  expectSpanColors("plain code block", nextFg, nextBg)
})

test("updating markdown fg/bg rerenders markdown fallback renderables", async () => {
  const initialFg = RGBA.fromValues(0.15, 0.15, 0.15, 1)
  const initialBg = RGBA.fromValues(0.94, 0.94, 0.94, 1)
  const nextFg = RGBA.fromValues(0.75, 0.75, 0.75, 1)
  const nextBg = RGBA.fromValues(0.18, 0.18, 0.18, 1)
  const mockTreeSitterClient = new MockTreeSitterClient()
  mockTreeSitterClient.highlightOnce = async () => {
    throw new Error("Highlighting failed")
  }

  const md = createMarkdownRenderable({
    id: "markdown-paragraph-color-update",
    content: "Plain paragraph text",
    syntaxStyle,
    fg: initialFg,
    bg: initialBg,
    treeSitterClient: mockTreeSitterClient,
  })

  renderer.root.add(md)
  await renderer.idle()
  await Bun.sleep(10)
  await renderer.idle()

  const paragraphBlock = md._blockStates[0]?.renderable as CodeRenderable
  expect(paragraphBlock).toBeInstanceOf(CodeRenderable)
  expect(paragraphBlock.filetype).toBe("markdown")
  expectSpanColors("Plain paragraph text", initialFg, initialBg)

  md.fg = nextFg
  md.bg = nextBg
  renderer.requestRender()
  await renderer.idle()
  await Bun.sleep(10)
  await renderer.idle()

  expect(md._blockStates[0]?.renderable).toBe(paragraphBlock)
  expect(paragraphBlock.fg.equals(nextFg)).toBe(true)
  expect(paragraphBlock.bg.equals(nextBg)).toBe(true)
  expectSpanColors("Plain paragraph text", nextFg, nextBg)
})
