import { test, expect, beforeEach, afterEach } from "bun:test"
import { DiffRenderable } from "./Diff"
import { SyntaxStyle } from "../syntax-style"
import { RGBA } from "../lib/RGBA"
import { createTestRenderer, type TestRenderer } from "../testing"
import { MockTreeSitterClient } from "../testing/mock-tree-sitter-client"
import type { SimpleHighlight } from "../lib/tree-sitter/types"
import { BoxRenderable } from "./Box"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>
let captureFrame: () => string
let mockClient: MockTreeSitterClient

beforeEach(async () => {
  mockClient = new MockTreeSitterClient({ autoResolveTimeout: 1 })

  const testRenderer = await createTestRenderer({
    width: 32,
    height: 10,
    gatherStats: true,
  })
  currentRenderer = testRenderer.renderer
  renderOnce = testRenderer.renderOnce
  captureFrame = testRenderer.captureCharFrame
})

afterEach(async () => {
  if (currentRenderer) {
    currentRenderer.destroy()
  }
})

// When highlights conceal formatting characters (like **), line lengths change,
// potentially triggering wrapping changes, height changes, and onResize.
// This test ensures onResize doesn't cause content resets that create endless loops.
test("DiffRenderable - no endless loop when concealing markdown formatting", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const markdownDiff = `--- a/test.md
+++ b/test.md
@@ -1,2 +1,2 @@
-Some text **boldtext**
-Short
+Some text **boldtext**
+More text **formats**`

  const mockHighlights: SimpleHighlight[] = [
    [10, 11, "conceal", { isInjection: true, injectionLang: "markdown_inline", conceal: "" }],
    [11, 12, "conceal", { isInjection: true, injectionLang: "markdown_inline", conceal: "" }],
    [20, 21, "conceal", { isInjection: true, injectionLang: "markdown_inline", conceal: "" }],
    [21, 22, "conceal", { isInjection: true, injectionLang: "markdown_inline", conceal: "" }],
    [33, 34, "conceal", { isInjection: true, injectionLang: "markdown_inline", conceal: "" }],
    [34, 35, "conceal", { isInjection: true, injectionLang: "markdown_inline", conceal: "" }],
    [42, 43, "conceal", { isInjection: true, injectionLang: "markdown_inline", conceal: "" }],
    [43, 44, "conceal", { isInjection: true, injectionLang: "markdown_inline", conceal: "" }],
  ]

  mockClient.setMockResult({ highlights: mockHighlights })

  const box = new BoxRenderable(currentRenderer, {
    id: "background-box",
    border: true,
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: markdownDiff,
    syntaxStyle,
    filetype: "markdown",
    conceal: true,
    treeSitterClient: mockClient,
  })

  box.add(diffRenderable)
  currentRenderer.root.add(box)

  await renderOnce()
  diffRenderable.view = "split"

  await renderOnce()
  diffRenderable.wrapMode = "word"

  await renderOnce()
  await Bun.sleep(2000)

  // Check that the total number of rendered frames is low
  // We only called renderOnce() 3 times manually, so frameCount should be close to that
  // If there's an endless loop, frameCount would be much higher
  const stats = currentRenderer.getStats()
  expect(stats.frameCount).toBeLessThan(11)
})
