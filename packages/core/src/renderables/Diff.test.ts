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
@@ -1,7 +1,9 @@
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
@@ -42,10 +42,12 @@
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
