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

// Test the exact scenario described: unified -> split -> wrap -> none -> wrap
// This reproduces the alignment and gutter height issues
//
// BUGS REPRODUCED BY THIS TEST:
// 1. LINE NUMBER MISALIGNMENT: When first enabling word wrap in split view,
//    line numbers on left and right sides are misaligned (off by one row).
//    After toggling wrapMode none->word again, alignment is correct.
// 2. GUTTER HEIGHT TOO TALL: The gutter height is calculated as target.lineCount
//    which includes padding/empty lines added for alignment, not just the actual
//    logical lines with line numbers. The gutter should only be tall enough to
//    cover the lines that actually have line numbers displayed.
//
// EXPECTED BEHAVIOR (split view with word wrap):
//   1 - Some text  1 + Some text
//       boldtext       boldtext
//   2 - Short      2 + More text
//                      formats
// Line numbers 1 and 2 should align horizontally on both sides.
// Gutters should only cover rows that display line numbers (not continuation lines).
test("DiffRenderable - view mode switching with wrapping alignment and gutter heights", async () => {
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

  // Step 1: Unified view (default, wrapMode=none)
  await renderOnce()
  const unifiedFrame = captureFrame()
  console.log("Unified view:")
  console.log(unifiedFrame)

  // Expected unified view:
  //   1 - Some text boldtext
  //   2 - Short
  //   1 + Some text boldtext
  //   2 + More text formats
  expect(unifiedFrame).toContain("1 - Some text")
  expect(unifiedFrame).toContain("2 - Short")
  expect(unifiedFrame).toContain("1 + Some text")
  expect(unifiedFrame).toContain("2 + More text")

  // Step 2: Switch to split view (wrapMode still none)
  diffRenderable.view = "split"
  await renderOnce()
  const splitFrame = captureFrame()
  console.log("\nSplit view (no wrap):")
  console.log(splitFrame)

  // Expected split view (side-by-side):
  //   1 - Some text  1 + Some text
  //   2 - Short      2 + More text
  expect(splitFrame).toContain("1 - Some text")
  expect(splitFrame).toContain("1 + Some text")
  expect(splitFrame).toContain("2 - Short")
  expect(splitFrame).toContain("2 + More text")

  // Step 3: Enable word wrapping in split view
  diffRenderable.wrapMode = "word"
  await renderOnce()
  // Allow time for rebuild to complete (microtask)
  await Bun.sleep(10)
  await renderOnce()
  const splitWrapFrame = captureFrame()
  console.log("\nSplit view (word wrap):")
  console.log(splitWrapFrame)

  // Check gutter heights - get the child renderables
  const diffChildren = diffRenderable.getChildren()
  console.log(`\nDiff has ${diffChildren.length} children`)
  for (let i = 0; i < diffChildren.length; i++) {
    const child = diffChildren[i]
    console.log(
      `Child ${i}: id=${child.id}, width=${child.width}, height=${child.height}, type=${child.constructor.name}`,
    )
    // Check if this is a LineNumberRenderable
    if (child.constructor.name === "LineNumberRenderable") {
      const lineNumChildren = child.getChildren()
      console.log(`  LineNumberRenderable has ${lineNumChildren.length} children`)
      for (let j = 0; j < lineNumChildren.length; j++) {
        const lineNumChild = lineNumChildren[j]
        const lineCount = "lineCount" in lineNumChild ? (lineNumChild as any).lineCount : "N/A"
        const lineInfo = "lineInfo" in lineNumChild ? (lineNumChild as any).lineInfo : null
        const lineInfoLineCount = lineInfo && "lineSources" in lineInfo ? lineInfo.lineSources.length : "N/A"
        console.log(
          `    Child ${j}: id=${lineNumChild.id}, width=${lineNumChild.width}, height=${lineNumChild.height}, lineCount=${lineCount}, visualLines=${lineInfoLineCount}, type=${lineNumChild.constructor.name}`,
        )
      }
    }
  }

  // Expected split view with wrapping:
  //   1 - Some text  1 + Some text
  //       boldtext       boldtext
  //   2 - Short      2 + More text
  //                      formats
  //
  // Issues to check:
  // 1. Line number alignment - left side line 2 should be on same visual row as right side line 2
  // 2. Gutter height should only cover used space, not total logical line count

  // Check that line numbers are properly aligned
  const lines = splitWrapFrame.split("\n")

  // Find the line with "2 - Short" on left side and "2 + More" on right side
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
  // Line numbers on both sides MUST be on the same row
  console.log(`Line 2 alignment: left at row ${leftLine2Row}, right at row ${rightLine2Row}`)
  expect(leftLine2Row).toBe(rightLine2Row)

  // Check gutter heights
  const leftSide = diffChildren[0]
  const rightSide = diffChildren[1]
  const leftGutter = leftSide.getChildren()[0]
  const rightGutter = rightSide.getChildren()[0]
  const leftCode = leftSide.getChildren()[1]
  const rightCode = rightSide.getChildren()[1]

  const leftVisualLines = (leftCode as any).lineInfo?.lineSources?.length || 0
  const rightVisualLines = (rightCode as any).lineInfo?.lineSources?.length || 0

  // In split view with wrapping, both sides MUST have the same total visual height due to alignment
  expect(leftVisualLines).toBe(rightVisualLines)
  // Gutters MUST match the visual line count
  expect(leftGutter.height).toBe(leftVisualLines)
  expect(rightGutter.height).toBe(rightVisualLines)

  // Step 4: Go back to wrapMode=none and then back to wrapMode=word
  diffRenderable.wrapMode = "none"
  await renderOnce()
  diffRenderable.wrapMode = "word"
  await renderOnce()
  // Allow time for rebuild to complete (microtask)
  await Bun.sleep(10)
  await renderOnce()
  const splitWrapFrame2 = captureFrame()
  console.log("\nSplit view (word wrap after toggle):")
  console.log(splitWrapFrame2)

  // Check alignment again after toggle
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
  // After toggling, alignment MUST still be correct
  expect(leftLine2Row2).toBe(rightLine2Row2)

  // The final alignment should be correct:
  //   1 - Some text  1 + Some text
  //       boldtext       boldtext
  //   2 - Short      2 + More text
  //                      formats
  expect(splitWrapFrame2).toContain("1 - Some text")
  expect(splitWrapFrame2).toContain("boldtext")
  expect(splitWrapFrame2).toContain("2 - Short")
  expect(splitWrapFrame2).toContain("2 + More text")
  expect(splitWrapFrame2).toContain("formats")
})
