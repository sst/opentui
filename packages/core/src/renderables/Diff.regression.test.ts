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

  const stats = currentRenderer.getStats()
  expect(stats.frameCount).toBeLessThan(25)
})

// Tests that line numbers align correctly and gutter heights are properly sized
// when switching between view modes and wrap modes in split view
test("DiffRenderable - line number alignment and gutter heights in split view with wrapping", async () => {
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
  const unifiedFrame = captureFrame()

  expect(unifiedFrame).toContain("1 - Some text")
  expect(unifiedFrame).toContain("2 - Short")
  expect(unifiedFrame).toContain("1 + Some text")
  expect(unifiedFrame).toContain("2 + More text")

  diffRenderable.view = "split"
  await renderOnce()
  const splitFrame = captureFrame()

  expect(splitFrame).toContain("1 - Some text")
  expect(splitFrame).toContain("1 + Some text")
  expect(splitFrame).toContain("2 - Short")
  expect(splitFrame).toContain("2 + More text")

  diffRenderable.wrapMode = "word"
  await currentRenderer.idle()
  await Bun.sleep(200)
  const splitWrapFrame = captureFrame()

  const diffChildren = diffRenderable.getChildren()
  const lines = splitWrapFrame.split("\n")

  let leftLine2Row = -1
  let rightLine2Row = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.includes("2 - Short")) {
      leftLine2Row = i
    }
    if (line.includes("2 + More")) {
      rightLine2Row = i
    }
  }

  expect(leftLine2Row).toBeGreaterThan(-1)
  expect(rightLine2Row).toBeGreaterThan(-1)
  expect(leftLine2Row).toBe(rightLine2Row)
  const leftSide = diffChildren[0]
  const rightSide = diffChildren[1]
  const leftGutter = leftSide.getChildren()[0]
  const rightGutter = rightSide.getChildren()[0]
  const leftCode = leftSide.getChildren()[1]
  const rightCode = rightSide.getChildren()[1]

  const leftVisualLines = (leftCode as any).lineInfo?.lineSources?.length || 0
  const rightVisualLines = (rightCode as any).lineInfo?.lineSources?.length || 0

  expect(leftVisualLines).toBe(rightVisualLines)
  expect(leftGutter.height).toBe(leftVisualLines)
  expect(rightGutter.height).toBe(rightVisualLines)

  diffRenderable.wrapMode = "none"
  await renderOnce()
  diffRenderable.wrapMode = "word"
  await renderOnce()
  await Bun.sleep(200) // Give time for highlight rebuild
  await renderOnce()
  const splitWrapFrame2 = captureFrame()
  const lines2 = splitWrapFrame2.split("\n")
  let leftLine2Row2 = -1
  let rightLine2Row2 = -1

  for (let i = 0; i < lines2.length; i++) {
    const line = lines2[i]
    if (line.includes("2 - Short")) {
      leftLine2Row2 = i
    }
    if (line.includes("2 + More")) {
      rightLine2Row2 = i
    }
  }

  expect(leftLine2Row2).toBeGreaterThan(-1)
  expect(rightLine2Row2).toBeGreaterThan(-1)
  expect(leftLine2Row2).toBe(rightLine2Row2)

  expect(splitWrapFrame2).toContain("1 - Some text")
  expect(splitWrapFrame2).toContain("boldtext")
  expect(splitWrapFrame2).toContain("2 - Short")
  expect(splitWrapFrame2).toContain("2 + More text")
  expect(splitWrapFrame2).toContain("formats")
})
