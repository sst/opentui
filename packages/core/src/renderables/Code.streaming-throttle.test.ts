import { test, expect, beforeEach, afterEach } from "bun:test"
import { CodeRenderable } from "./Code.js"
import { SyntaxStyle } from "../syntax-style.js"
import { RGBA } from "../lib/RGBA.js"
import { createTestRenderer, type TestRenderer, MockTreeSitterClient } from "../testing.js"
import type { SimpleHighlight } from "../lib/tree-sitter/types.js"

let renderer: TestRenderer
let renderOnce: () => Promise<void>

beforeEach(async () => {
  ;({ renderer, renderOnce } = await createTestRenderer({ width: 80, height: 24 }))
})

afterEach(() => {
  renderer.destroy()
})

function makeSyntaxStyle(): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(0, 0, 1, 1) },
  })
}

test("CodeRenderable - streamingHighlightThrottleMs defaults to 0 (disabled)", async () => {
  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({ highlights: [] })

  const code = new CodeRenderable(renderer, {
    id: "throttle-default",
    content: "const a = 1;",
    filetype: "javascript",
    syntaxStyle: makeSyntaxStyle(),
    treeSitterClient: mockClient,
    streaming: true,
    drawUnstyledText: false,
  })
  renderer.root.add(code)

  // settle initial highlight
  await renderOnce()
  mockClient.resolveHighlightOnce(0)
  await code.highlightingDone

  // With throttling disabled (default), a streamed update highlights immediately:
  // there is a pending request to resolve right after renderOnce.
  code.content = "const b = 2;"
  await renderOnce()
  mockClient.resolveHighlightOnce(0)
  await code.highlightingDone

  expect(code.plainText).toBe("const b = 2;")
})

test("CodeRenderable - streamingHighlightThrottleMs coalesces re-highlights during a burst", async () => {
  const throttleMs = 1000
  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({ highlights: [[0, 5, "keyword"]] as SimpleHighlight[] })

  const code = new CodeRenderable(renderer, {
    id: "throttle-on",
    content: "const v0 = 0;",
    filetype: "javascript",
    syntaxStyle: makeSyntaxStyle(),
    treeSitterClient: mockClient,
    streaming: true,
    drawUnstyledText: true,
    streamingHighlightThrottleMs: throttleMs,
  })
  renderer.root.add(code)

  // settle initial highlight so _hadInitialContent becomes true
  await renderOnce()
  mockClient.resolveAllHighlightOnce()
  await code.highlightingDone

  // Count highlight invocations from here on.
  let highlightCalls = 0
  const originalHighlightOnce = mockClient.highlightOnce.bind(mockClient)
  mockClient.highlightOnce = async (content: string, filetype: string) => {
    highlightCalls++
    return originalHighlightOnce(content, filetype)
  }

  // Burst of streamed updates inside a single throttle window.
  for (let i = 1; i <= 5; i++) {
    code.content = `const v${i} = ${i};`
    await renderOnce()
  }

  // Live text stays current every frame (drawUnstyledText), even before the
  // throttled highlight fires.
  expect(code.plainText).toBe("const v5 = 5;")
  // ...but the expensive re-highlight has been coalesced: not started yet.
  expect(highlightCalls).toBe(0)

  // After the throttle window, exactly one highlight fires for the whole burst.
  await new Promise((resolve) => setTimeout(resolve, throttleMs + 300))
  expect(highlightCalls).toBe(1)

  mockClient.resolveAllHighlightOnce()
  await code.highlightingDone
  expect(code.plainText).toBe("const v5 = 5;")
})

test("CodeRenderable - disabling streaming cancels a pending throttled highlight", async () => {
  const throttleMs = 1000
  const mockClient = new MockTreeSitterClient()
  mockClient.setMockResult({ highlights: [] })

  const code = new CodeRenderable(renderer, {
    id: "throttle-cancel",
    content: "const a = 1;",
    filetype: "javascript",
    syntaxStyle: makeSyntaxStyle(),
    treeSitterClient: mockClient,
    streaming: true,
    drawUnstyledText: true,
    streamingHighlightThrottleMs: throttleMs,
  })
  renderer.root.add(code)

  await renderOnce()
  mockClient.resolveAllHighlightOnce()
  await code.highlightingDone

  let highlightCalls = 0
  const originalHighlightOnce = mockClient.highlightOnce.bind(mockClient)
  mockClient.highlightOnce = async (content: string, filetype: string) => {
    highlightCalls++
    return originalHighlightOnce(content, filetype)
  }

  // Schedule a throttled highlight, then disable streaming before it fires.
  code.content = "const b = 2;"
  await renderOnce()
  expect(highlightCalls).toBe(0)

  // Disabling streaming cancels the pending throttle timer; the next render
  // then highlights immediately via the normal (non-throttled) path.
  code.streaming = false
  await renderOnce()
  mockClient.resolveAllHighlightOnce()
  await code.highlightingDone
  expect(highlightCalls).toBe(1)

  // The cancelled timer must NOT fire a second, redundant highlight.
  await new Promise((resolve) => setTimeout(resolve, throttleMs + 300))
  expect(highlightCalls).toBe(1)
})
