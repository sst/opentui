import { test, expect, beforeEach, afterEach } from "bun:test"
import { DiffRenderable } from "./Diff"
import { SyntaxStyle } from "../syntax-style"
import { RGBA } from "../lib/RGBA"
import { createTestRenderer, type TestRenderer } from "../testing"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>
let captureFrame: () => string

beforeEach(async () => {
  const testRenderer = await createTestRenderer({ width: 80, height: 20 })
  currentRenderer = testRenderer.renderer
  renderOnce = testRenderer.renderOnce
  captureFrame = testRenderer.captureCharFrame
})

afterEach(async () => {
  if (currentRenderer) {
    currentRenderer.destroy()
  }
})

const simpleDiff = `--- a/test.js
+++ b/test.js
@@ -1,3 +1,3 @@
 function hello() {
-  console.log("Hello");
+  console.log("Hello, World!");
 }`

const multiLineDiff = `--- a/math.js
+++ b/math.js
@@ -1,7 +1,11 @@
 function add(a, b) {
   return a + b;
 }
 
+function subtract(a, b) {
+  return a - b;
+}
+
 function multiply(a, b) {
-  return a * b;
+  return a * b * 1;
 }`

const addOnlyDiff = `--- a/new.js
+++ b/new.js
@@ -0,0 +1,3 @@
+function newFunction() {
+  return true;
+}`

const removeOnlyDiff = `--- a/old.js
+++ b/old.js
@@ -1,3 +0,0 @@
-function oldFunction() {
-  return false;
-}`

const largeDiff = `--- a/large.js
+++ b/large.js
@@ -42,9 +42,10 @@
 const line42 = 'context';
 const line43 = 'context';
-const line44 = 'removed';
+const line44 = 'added';
 const line45 = 'context';
+const line46 = 'added';
 const line47 = 'context';
 const line48 = 'context';
-const line49 = 'removed';
+const line49 = 'changed';
 const line50 = 'context';
 const line51 = 'context';`

test("DiffRenderable - basic construction with unified view", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: simpleDiff,
    view: "unified",
    syntaxStyle,
  })

  expect(diffRenderable.diff).toBe(simpleDiff)
  expect(diffRenderable.view).toBe("unified")
})

test("DiffRenderable - basic construction with split view", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: simpleDiff,
    view: "split",
    syntaxStyle,
  })

  expect(diffRenderable.diff).toBe(simpleDiff)
  expect(diffRenderable.view).toBe("split")
})

test("DiffRenderable - defaults to unified view", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: simpleDiff,
    syntaxStyle,
  })

  expect(diffRenderable.view).toBe("unified")
})

test("DiffRenderable - unified view renders correctly", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: simpleDiff,
    view: "unified",
    syntaxStyle,
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  const frame = captureFrame()
  expect(frame).toMatchSnapshot("unified view simple diff")

  // Check that both removed and added lines are present
  expect(frame).toContain('console.log("Hello")')
  expect(frame).toContain('console.log("Hello, World!")')
})

test("DiffRenderable - split view renders correctly", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: simpleDiff,
    view: "split",
    syntaxStyle,
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  const frame = captureFrame()
  expect(frame).toMatchSnapshot("split view simple diff")

  // In split view, both sides should be visible (may be wrapped)
  expect(frame).toContain("console.log")
  expect(frame).toContain("Hello")
  expect(frame).toContain("World")
})

test("DiffRenderable - multi-line diff unified view", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: multiLineDiff,
    view: "unified",
    syntaxStyle,
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  const frame = captureFrame()
  expect(frame).toMatchSnapshot("unified view multi-line diff")

  // Check for additions
  expect(frame).toContain("function subtract")
  // Check for modifications
  expect(frame).toContain("a * b * 1")
})

test("DiffRenderable - multi-line diff split view", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: multiLineDiff,
    view: "split",
    syntaxStyle,
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  const frame = captureFrame()
  expect(frame).toMatchSnapshot("split view multi-line diff")

  // Left side should have old code
  expect(frame).toContain("a * b")
  // Right side should have new code
  expect(frame).toContain("subtract")
})

test("DiffRenderable - add-only diff unified view", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: addOnlyDiff,
    view: "unified",
    syntaxStyle,
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  const frame = captureFrame()
  expect(frame).toMatchSnapshot("unified view add-only diff")

  expect(frame).toContain("newFunction")
})

test("DiffRenderable - add-only diff split view", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: addOnlyDiff,
    view: "split",
    syntaxStyle,
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  const frame = captureFrame()
  expect(frame).toMatchSnapshot("split view add-only diff")

  // Right side should have the new function
  expect(frame).toContain("newFunction")
})

test("DiffRenderable - remove-only diff unified view", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: removeOnlyDiff,
    view: "unified",
    syntaxStyle,
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  const frame = captureFrame()
  expect(frame).toMatchSnapshot("unified view remove-only diff")

  expect(frame).toContain("oldFunction")
})

test("DiffRenderable - remove-only diff split view", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: removeOnlyDiff,
    view: "split",
    syntaxStyle,
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  const frame = captureFrame()
  expect(frame).toMatchSnapshot("split view remove-only diff")

  // Left side should have the old function
  expect(frame).toContain("oldFunction")
})

test("DiffRenderable - large line numbers displayed correctly", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: largeDiff,
    view: "unified",
    syntaxStyle,
    showLineNumbers: true,
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  const frame = captureFrame()
  expect(frame).toMatchSnapshot("unified view large line numbers")

  // Check that line numbers in the 40s are displayed
  expect(frame).toMatch(/4[0-9]/)
})

test("DiffRenderable - can toggle view mode", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: simpleDiff,
    view: "unified",
    syntaxStyle,
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  const unifiedFrame = captureFrame()
  expect(diffRenderable.view).toBe("unified")

  // Switch to split view
  diffRenderable.view = "split"
  await renderOnce()

  const splitFrame = captureFrame()
  expect(diffRenderable.view).toBe("split")

  // Frames should be different
  expect(unifiedFrame).not.toBe(splitFrame)
})

test("DiffRenderable - can update diff content", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: simpleDiff,
    view: "unified",
    syntaxStyle,
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  const frame1 = captureFrame()
  expect(frame1).toContain("Hello")

  // Update diff
  diffRenderable.diff = multiLineDiff
  await renderOnce()

  const frame2 = captureFrame()
  expect(frame2).toContain("subtract")
  expect(frame2).not.toContain('console.log("Hello")')
})

test("DiffRenderable - can toggle line numbers", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: simpleDiff,
    view: "unified",
    syntaxStyle,
    showLineNumbers: true,
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  expect(diffRenderable.showLineNumbers).toBe(true)

  // Hide line numbers
  diffRenderable.showLineNumbers = false
  await renderOnce()

  expect(diffRenderable.showLineNumbers).toBe(false)
})

test("DiffRenderable - can update filetype", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromValues(1, 0, 0, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: simpleDiff,
    view: "unified",
    syntaxStyle,
    filetype: "javascript",
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  expect(diffRenderable.filetype).toBe("javascript")

  // Update filetype
  diffRenderable.filetype = "typescript"
  expect(diffRenderable.filetype).toBe("typescript")
})

test("DiffRenderable - handles empty diff", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: "",
    view: "unified",
    syntaxStyle,
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  // Should not crash with empty diff
  expect(diffRenderable.diff).toBe("")
})

test("DiffRenderable - handles diff with no changes", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const noChangeDiff = `--- a/test.js
+++ b/test.js
@@ -1,3 +1,3 @@
 function hello() {
   console.log("Hello");
 }`

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: noChangeDiff,
    view: "unified",
    syntaxStyle,
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  const frame = captureFrame()
  expect(frame).toContain("function hello")
})

test("DiffRenderable - can update wrapMode", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: simpleDiff,
    view: "unified",
    syntaxStyle,
    wrapMode: "word",
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  expect(diffRenderable.wrapMode).toBe("word")

  diffRenderable.wrapMode = "char"
  expect(diffRenderable.wrapMode).toBe("char")
})

test("DiffRenderable - split view alignment with empty lines", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  // Diff with additions that should create empty lines on left
  const alignmentDiff = `--- a/test.js
+++ b/test.js
@@ -1,2 +1,5 @@
 line1
+line2_added
+line3_added
+line4_added
 line5`

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: alignmentDiff,
    view: "split",
    syntaxStyle,
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  const frame = captureFrame()
  expect(frame).toMatchSnapshot("split view alignment")

  // Both sides should have same number of lines (with empty lines for alignment)
  expect(frame).toContain("line1")
  expect(frame).toContain("line5")
  expect(frame).toContain("line2_added")
})

test("DiffRenderable - context lines shown on both sides in split view", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: multiLineDiff,
    view: "split",
    syntaxStyle,
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  const frame = captureFrame()

  // Context lines should appear on both sides
  expect(frame).toContain("function add")
  expect(frame).toContain("function multiply")
})

test("DiffRenderable - custom colors applied correctly", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: simpleDiff,
    view: "unified",
    syntaxStyle,
    addedBg: "#00ff00",
    removedBg: "#ff0000",
    addedSignColor: "#00ff00",
    removedSignColor: "#ff0000",
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  // Should not crash with custom colors
  const frame = captureFrame()
  expect(frame).toContain('console.log("Hello")')
})

test("DiffRenderable - line numbers hidden for empty alignment lines in split view", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: addOnlyDiff,
    view: "split",
    syntaxStyle,
    showLineNumbers: true,
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  const frame = captureFrame()
  expect(frame).toMatchSnapshot("split view with hidden line numbers for empty lines")

  // Right side should have line numbers for new lines
  // Left side should have empty lines without line numbers
})

test("DiffRenderable - no width glitch on initial render", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: multiLineDiff,
    view: "unified",
    syntaxStyle,
    showLineNumbers: true,
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)

  // Wait for automatic initial render to happen
  await Bun.sleep(50)

  const frameAfterAutoRender = captureFrame()
  const gutterAfterAutoRender = diffRenderable["leftSide"]?.["gutter"]
  const widthAfterAutoRender = gutterAfterAutoRender?.width

  // Now call renderOnce explicitly (this would be the second render)
  await renderOnce()
  const firstFrame = captureFrame()
  const widthAfterFirst = diffRenderable["leftSide"]?.["gutter"]?.width

  // Render a third time
  await renderOnce()
  const secondFrame = captureFrame()
  const widthAfterSecond = diffRenderable["leftSide"]?.["gutter"]?.width

  // EXPECTATION: Width should be correct (6) from the very first auto render
  // If this fails, it means there's a glitch where width starts incorrect
  expect(widthAfterAutoRender).toBe(6) // Should be 6 for double-digit line numbers

  // Width should NOT change between renders (no glitch)
  expect(widthAfterAutoRender).toBe(widthAfterFirst)
  expect(widthAfterFirst).toBe(widthAfterSecond)

  // The frames should be identical (no visual glitch)
  expect(frameAfterAutoRender).toBe(firstFrame)
  expect(firstFrame).toBe(secondFrame)

  // Verify all frames have all content (not just partial)
  expect(frameAfterAutoRender).toContain("function add")
  expect(frameAfterAutoRender).toContain("function subtract")
  expect(frameAfterAutoRender).toContain("function multiply")
})

test("DiffRenderable - can be constructed without diff and set via setter", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  // Construct without diff
  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    view: "unified",
    syntaxStyle,
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  // Should render empty
  let frame = captureFrame()
  expect(frame.trim()).toBe("")

  // Now set diff via setter
  diffRenderable.diff = simpleDiff
  await renderOnce()

  frame = captureFrame()
  expect(frame).toContain("function hello")
  expect(frame).toContain('console.log("Hello")')
  expect(frame).toContain('console.log("Hello, World!")')
})

test("DiffRenderable - consistent left padding for line numbers > 9", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  // Create a diff with line numbers that go into double digits
  const diffWith10PlusLines = `--- a/test.js
+++ b/test.js
@@ -8,7 +8,9 @@
 line8
 line9
-line10_old
+line10_new
 line11
+line12_added
+line13_added
 line14
 line15
-line16_old
+line16_new`

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: diffWith10PlusLines,
    view: "unified",
    syntaxStyle,
    showLineNumbers: true,
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  const frame = captureFrame()
  expect(frame).toMatchSnapshot("unified view with double-digit line numbers")

  const frameLines = frame.split("\n")

  // Find lines in the output
  // Line 8 (single digit) should have left padding (appears as " 8 line8")
  const line8 = frameLines.find((l) => l.includes("line8"))
  expect(line8).toBeTruthy()
  const line8Match = line8!.match(/^( +)8 /)
  expect(line8Match).toBeTruthy()
  expect(line8Match![1].length).toBeGreaterThanOrEqual(1) // At least 1 space of left padding

  // Line 10 (double digit) should have left padding (appears as " 10 line10" or " 11 line10")
  const line10 = frameLines.find((l) => l.includes("line10"))
  expect(line10).toBeTruthy()
  const line10Match = line10!.match(/^( +)1[01] /)
  expect(line10Match).toBeTruthy()
  expect(line10Match![1].length).toBeGreaterThanOrEqual(1) // At least 1 space of left padding

  // Line 16 (double digit) should have left padding
  // Note: With correct line numbers, the removed line shows as 14 - and added shows as 16 +
  const line16 = frameLines.find((l) => l.includes("line16"))
  expect(line16).toBeTruthy()
  // Match either 14 - or 16 + (the correct line numbers after the fix)
  const line16Match = line16!.match(/^( +)(14 -|16 \+) /)
  expect(line16Match).toBeTruthy()
  expect(line16Match![1].length).toBeGreaterThanOrEqual(1) // At least 1 space of left padding
})

test("DiffRenderable - line numbers are correct in unified view", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: simpleDiff,
    view: "unified",
    syntaxStyle,
    showLineNumbers: true,
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  const frame = captureFrame()
  const frameLines = frame.split("\n")

  // Line 2 is removed (old file line 2)
  const removedLine = frameLines.find((l) => l.includes('console.log("Hello");'))
  expect(removedLine).toBeTruthy()
  expect(removedLine).toMatch(/^ *2 -/)

  // Line 2 is added (new file line 2) - NOT line 3!
  const addedLine = frameLines.find((l) => l.includes('console.log("Hello, World!")'))
  expect(addedLine).toBeTruthy()
  expect(addedLine).toMatch(/^ *2 \+/)
})

test("DiffRenderable - line numbers are correct in split view", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: simpleDiff,
    view: "split",
    syntaxStyle,
    showLineNumbers: true,
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  const frame = captureFrame()
  const frameLines = frame.split("\n")

  // In split view, both sides are on the same terminal line
  // Left side: line 2 is removed, Right side: line 2 is added
  const splitLine = frameLines.find((l) => l.includes('console.log("Hello, World!")'))
  expect(splitLine).toBeTruthy()
  // Should contain line 2 with - on left side
  expect(splitLine).toMatch(/^ *2 -/)
  // Should contain line 2 with + on right side (later in the same line)
  expect(splitLine).toMatch(/2 \+.*console\.log\("Hello, World!"\)/)
})

test("DiffRenderable - split view should not wrap lines prematurely", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  // Create a diff with long lines that should fit in split view
  const longLineDiff = `--- a/test.js
+++ b/test.js
@@ -1,4 +1,4 @@
 class Calculator {
-  subtract(a: number, b: number): number {
+  subtract(a: number, b: number, c: number = 0): number {
   return a - b;
 }`

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: longLineDiff,
    view: "split",
    syntaxStyle,
    showLineNumbers: true,
    wrapMode: "word",
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  const frame = captureFrame()
  const frameLines = frame.split("\n")

  // Find the line with "subtract" on the left side
  const leftSubtractLine = frameLines.find((l) => l.includes("subtract") && l.includes("b: number):"))
  expect(leftSubtractLine).toBeTruthy()

  // The line should NOT be wrapped - "subtract(a: number, b: number):" should be on one line
  // In an 80-char terminal with split view, each side gets ~40 chars (minus line numbers)
  // "subtract(a: number, b: number):" is 34 chars, so it should fit without wrapping
  expect(leftSubtractLine).toMatch(/subtract\(a: number, b: number\):/)

  // Find the line with "subtract" on the right side - it might be on the same line or next line
  // The signature is longer and might wrap
  const rightSubtractLines = frameLines.filter((l) => l.includes("subtract") || l.includes("c: number"))
  expect(rightSubtractLines.length).toBeGreaterThan(0)

  // The key assertion is that the left side doesn't wrap prematurely
  // We've already verified that above
})

test("DiffRenderable - split view alignment with calculator diff", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const calculatorDiff = `--- a/calculator.ts
+++ b/calculator.ts
@@ -1,13 +1,20 @@
 class Calculator {
   add(a: number, b: number): number {
     return a + b;
   }
 
-  subtract(a: number, b: number): number {
-    return a - b;
+  subtract(a: number, b: number, c: number = 0): number {
+    return a - b - c;
   }
 
   multiply(a: number, b: number): number {
     return a * b;
   }
+
+  divide(a: number, b: number): number {
+    if (b === 0) {
+      throw new Error("Division by zero");
+    }
+    return a / b;
+  }
 }`

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: calculatorDiff,
    view: "split",
    syntaxStyle,
    showLineNumbers: true,
    wrapMode: "none",
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  const frame = captureFrame()
  const frameLines = frame.split("\n")

  // Find the closing brace on the left (old line 13)
  const leftClosingBrace = frameLines.find((l) => l.match(/^\s*13\s+\}/))
  expect(leftClosingBrace).toBeTruthy()

  // Find the closing brace on the right (new line 20)
  const rightClosingBrace = frameLines.find((l) => l.match(/\s*20\s+\}/))
  expect(rightClosingBrace).toBeTruthy()

  // They should be on the SAME line in the output
  expect(leftClosingBrace).toBe(rightClosingBrace)
})

test("DiffRenderable - switching between unified and split views multiple times", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: simpleDiff,
    view: "unified",
    syntaxStyle,
    showLineNumbers: true,
    width: "100%",
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  // Step 1: Verify unified view works
  let frame = captureFrame()
  expect(frame).toContain("function hello")
  expect(frame).toContain('console.log("Hello")')
  expect(frame).toContain('console.log("Hello, World!")')

  // Step 2: Switch to split view
  diffRenderable.view = "split"
  await renderOnce()

  frame = captureFrame()
  expect(frame).toContain("function hello")
  expect(frame).toContain('console.log("Hello")')
  expect(frame).toContain('console.log("Hello, World!")')

  // Step 3: Switch back to unified view
  diffRenderable.view = "unified"
  await renderOnce()

  frame = captureFrame()
  expect(frame).toContain("function hello")
  expect(frame).toContain('console.log("Hello")')
  expect(frame).toContain('console.log("Hello, World!")')

  // Step 4: Switch to split view again (this currently fails)
  diffRenderable.view = "split"
  await renderOnce()

  frame = captureFrame()
  expect(frame).toContain("function hello")
  expect(frame).toContain('console.log("Hello")')
  expect(frame).toContain('console.log("Hello, World!")')
})

test("DiffRenderable - wrapMode works in unified view", async () => {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  // Create a diff with a very long line that will wrap
  const longLineDiff = `--- a/test.js
+++ b/test.js
@@ -1,3 +1,3 @@
 function hello() {
-  console.log("This is a very long line that should wrap when wrapMode is set to word but not when it is set to none");
+  console.log("This is a very long line that has been modified and should wrap when wrapMode is set to word but not when it is set to none");
 }`

  const diffRenderable = new DiffRenderable(currentRenderer, {
    id: "test-diff",
    diff: longLineDiff,
    view: "unified",
    syntaxStyle,
    showLineNumbers: true,
    wrapMode: "none",
    width: 80,
    height: "100%",
  })

  currentRenderer.root.add(diffRenderable)
  await renderOnce()

  // Capture with wrapMode: none
  const frameNone = captureFrame()
  expect(frameNone).toMatchSnapshot("wrapMode-none")

  // Change to wrapMode: word
  diffRenderable.wrapMode = "word"
  await renderOnce()

  // Capture with wrapMode: word
  const frameWord = captureFrame()
  expect(frameWord).toMatchSnapshot("wrapMode-word")

  // Frames should be different (word wrapping should create more lines)
  expect(frameNone).not.toBe(frameWord)

  // Change back to wrapMode: none
  diffRenderable.wrapMode = "none"
  await renderOnce()

  // Should match the original
  const frameNoneAgain = captureFrame()
  expect(frameNoneAgain).toMatchSnapshot("wrapMode-none")
  expect(frameNoneAgain).toBe(frameNone)
})

test("DiffRenderable - split view with wrapMode honors wrapping alignment", async () => {
  // Create a larger test renderer to fit the whole diff with wrapping
  const testRenderer = await createTestRenderer({ width: 80, height: 40 })
  const renderer = testRenderer.renderer
  const renderOnce = testRenderer.renderOnce
  const captureFrame = testRenderer.captureCharFrame

  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  const calculatorDiff = `--- a/calculator.ts
+++ b/calculator.ts
@@ -1,13 +1,20 @@
 class Calculator {
   add(a: number, b: number): number {
     return a + b;
   }
 
-  subtract(a: number, b: number): number {
-    return a - b;
+  subtract(a: number, b: number, c: number = 0): number {
+    return a - b - c;
   }
 
   multiply(a: number, b: number): number {
     return a * b;
   }
+
+  divide(a: number, b: number): number {
+    if (b === 0) {
+      throw new Error("Division by zero");
+    }
+    return a / b;
+  }
 }`

  const diffRenderable = new DiffRenderable(renderer, {
    id: "test-diff",
    diff: calculatorDiff,
    view: "split",
    syntaxStyle,
    showLineNumbers: true,
    wrapMode: "word",
    width: "100%",
    height: "100%",
  })

  renderer.root.add(diffRenderable)
  await renderOnce()

  // Wait for deferred rebuild with wrap alignment (debounced 150ms)
  await new Promise((resolve) => setTimeout(resolve, 200))
  await renderOnce()

  const frame = captureFrame()
  const frameLines = frame.split("\n")

  // Find the closing brace on the left (old line 13)
  const leftClosingBraceLine = frameLines.find((l) => l.match(/^\s*13\s+\}/))
  expect(leftClosingBraceLine).toBeTruthy()

  // Find the closing brace on the right (new line 20)
  const rightClosingBraceLine = frameLines.find((l) => l.match(/\s*20\s+\}/))
  expect(rightClosingBraceLine).toBeTruthy()

  // They should be on the SAME line in the output (same visual row)
  // even though the right side has wrapped lines above it
  expect(leftClosingBraceLine).toBe(rightClosingBraceLine)

  // Both sides should have the same number of final visual lines
  // (counting both logical lines and wrap continuations)
  // This is hard to assert directly, but if alignment is correct,
  // the closing braces being on the same line proves it worked

  // Clean up
  renderer.destroy()
})

test("DiffRenderable - context lines show new line numbers in unified view", async () => {
  // Create a larger test renderer to fit the whole diff
  const testRenderer = await createTestRenderer({ width: 80, height: 30 })
  const renderer = testRenderer.renderer
  const renderOnce = testRenderer.renderOnce
  const captureFrame = testRenderer.captureCharFrame

  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  })

  // This diff adds lines in the middle, so context lines after additions
  // should show their NEW line numbers, not old ones
  const calculatorDiff = `--- a/calculator.ts
+++ b/calculator.ts
@@ -1,13 +1,20 @@
 class Calculator {
   add(a: number, b: number): number {
     return a + b;
   }
 
-  subtract(a: number, b: number): number {
-    return a - b;
+  subtract(a: number, b: number, c: number = 0): number {
+    return a - b - c;
   }
 
   multiply(a: number, b: number): number {
     return a * b;
   }
+
+  divide(a: number, b: number): number {
+    if (b === 0) {
+      throw new Error("Division by zero");
+    }
+    return a / b;
+  }
 }`

  const diffRenderable = new DiffRenderable(renderer, {
    id: "test-diff",
    diff: calculatorDiff,
    view: "unified",
    syntaxStyle,
    showLineNumbers: true,
    width: "100%",
    height: "100%",
  })

  renderer.root.add(diffRenderable)
  await renderOnce()

  const frame = captureFrame()
  const frameLines = frame.split("\n")

  // The closing brace "}" for the Calculator class is a context line
  // In the old file it was at line 13
  // In the new file it's at line 20 (after adding 7 lines for divide method)
  // Unified view should show line 20, not line 13
  // Find the LAST closing brace that's just "}" (at the beginning of indentation, not nested)
  // This regex matches: optional spaces, digits, spaces, optional sign (+/-), spaces, "}", trailing spaces
  const closingBraceLines = frameLines.filter((l) => l.match(/^\s*\d+\s+[+-]?\s*\}\s*$/))

  // The last one should be the class closing brace
  const classClosingBraceLine = closingBraceLines[closingBraceLines.length - 1]
  expect(classClosingBraceLine).toBeTruthy()

  // Extract the line number from the closing brace line
  const lineNumberMatch = classClosingBraceLine!.match(/^\s*(\d+)/)
  expect(lineNumberMatch).toBeTruthy()

  const lineNumber = parseInt(lineNumberMatch![1])

  // The closing brace should show line 20 (new file position), not 13 (old file position)
  expect(lineNumber).toBe(20)

  // Clean up
  renderer.destroy()
})
