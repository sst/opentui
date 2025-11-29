import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { testRender } from "../index"
import { SyntaxStyle, RGBA } from "@opentui/core"
import { createSignal, Show } from "solid-js"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("DiffRenderable with SolidJS", () => {
  beforeEach(async () => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
  })

  afterEach(() => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
  })

  test("renders unified diff without glitching", async () => {
    const syntaxStyle = SyntaxStyle.fromStyles({
      keyword: { fg: RGBA.fromValues(0.78, 0.57, 0.92, 1) },
      function: { fg: RGBA.fromValues(0.51, 0.67, 1, 1) },
      default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    })

    const diffContent = `--- a/test.js
+++ b/test.js
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

    testSetup = await testRender(() => (
      <box id="root" width="100%" height="100%">
        <diff
          id="test-diff"
          diff={diffContent}
          view="unified"
          filetype="javascript"
          syntaxStyle={syntaxStyle}
          showLineNumbers={true}
          width="100%"
          height="100%"
        />
      </box>
    ))

    // Wait for automatic initial render
    await Bun.sleep(50)

    const boxRenderable = testSetup.renderer.root.getRenderable("root")
    const diffRenderable = boxRenderable?.getRenderable("test-diff") as any
    const leftSide = diffRenderable?.getRenderable("test-diff-left") as any
    const gutterAfterAutoRender = leftSide?.["gutter"]
    const widthAfterAutoRender = gutterAfterAutoRender?.width

    // First explicit render
    await testSetup.renderOnce()
    const firstFrame = testSetup.captureCharFrame()
    const widthAfterFirst = leftSide?.["gutter"]?.width

    // Second render to check stability
    await testSetup.renderOnce()
    const secondFrame = testSetup.captureCharFrame()
    const widthAfterSecond = leftSide?.["gutter"]?.width

    // EXPECTATION: No width glitch - width should be correct from auto render
    expect(widthAfterAutoRender).toBeDefined()
    expect(widthAfterFirst).toBeDefined()
    expect(widthAfterSecond).toBeDefined()
    expect(widthAfterAutoRender).toBe(widthAfterFirst)
    expect(widthAfterFirst).toBe(widthAfterSecond)
    expect(widthAfterFirst!).toBeGreaterThan(0)

    // Frames should be identical (no visual changes)
    expect(firstFrame).toBe(secondFrame)

    // Check content is present
    expect(firstFrame).toContain("function add")
    expect(firstFrame).toContain("function subtract")
    expect(firstFrame).toContain("function multiply")

    // Check for diff markers
    expect(firstFrame).toContain("+")
    expect(firstFrame).toContain("-")
  })

  test("renders split diff correctly", async () => {
    const syntaxStyle = SyntaxStyle.fromStyles({
      keyword: { fg: RGBA.fromValues(0.78, 0.57, 0.92, 1) },
      function: { fg: RGBA.fromValues(0.51, 0.67, 1, 1) },
      default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    })

    const diffContent = `--- a/test.js
+++ b/test.js
@@ -1,3 +1,3 @@
 function hello() {
-  console.log("Hello");
+  console.log("Hello, World!");
 }`

    testSetup = await testRender(() => (
      <box id="root" width="100%" height="100%">
        <diff
          id="test-diff"
          diff={diffContent}
          view="split"
          filetype="javascript"
          syntaxStyle={syntaxStyle}
          showLineNumbers={true}
          width="100%"
          height="100%"
        />
      </box>
    ))

    await testSetup.renderOnce()

    const frame = testSetup.captureCharFrame()

    // Both sides should be visible
    expect(frame).toContain("function hello")
    expect(frame).toContain("console.log")
    expect(frame).toContain("Hello")
  })

  test("handles double-digit line numbers with proper left padding", async () => {
    const syntaxStyle = SyntaxStyle.fromStyles({
      keyword: { fg: RGBA.fromValues(0.78, 0.57, 0.92, 1) },
      default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    })

    const diffWith10PlusLines = `--- a/test.js
+++ b/test.js
@@ -8,10 +8,12 @@
 line8
 line9
 line10
-line11_old
+line11_new
 line12
+line13_added
+line14_added
 line15
 line16
-line17_old
+line17_new
 line18
 line19`

    testSetup = await testRender(() => (
      <box id="root" width="100%" height="100%">
        <diff
          id="test-diff"
          diff={diffWith10PlusLines}
          view="unified"
          syntaxStyle={syntaxStyle}
          showLineNumbers={true}
          width="100%"
          height="100%"
        />
      </box>
    ))

    await testSetup.renderOnce()

    const frame = testSetup.captureCharFrame()
    const frameLines = frame.split("\n")

    // Find lines with single and double digit numbers
    const line8 = frameLines.find((l) => l.includes("line8"))
    const line10 = frameLines.find((l) => l.includes("line10"))
    const line16 = frameLines.find((l) => l.includes("line16"))

    // All lines should have proper left padding
    if (!line8 || !line10 || !line16) {
      throw new Error("Expected lines not found in output")
    }

    // Verify proper left padding for single-digit line numbers
    const line8Match = line8.match(/^( +)\d+ /)
    if (!line8Match || !line8Match[1]) throw new Error("Line 8 format incorrect")
    expect(line8Match[1].length).toBeGreaterThanOrEqual(1)

    // Verify proper left padding for double-digit line numbers (line10)
    const line10Match = line10.match(/^( +)\d+ /)
    if (!line10Match || !line10Match[1]) throw new Error("Line 10 format incorrect")
    expect(line10Match[1].length).toBeGreaterThanOrEqual(1)

    // Verify proper left padding for double-digit line numbers (line16)
    // Note: In unified diff, removed lines show old file line numbers, added lines show new file line numbers
    const line16Match = line16.match(/^( +)\d+ /)
    if (!line16Match || !line16Match[1]) throw new Error("Line 16 format incorrect")
    expect(line16Match[1].length).toBeGreaterThanOrEqual(1)
  })

  test("handles conditional removal of diff element", async () => {
    const syntaxStyle = SyntaxStyle.fromStyles({
      keyword: { fg: RGBA.fromValues(0.78, 0.57, 0.92, 1) },
      function: { fg: RGBA.fromValues(0.51, 0.67, 1, 1) },
      default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    })

    const diffContent = `--- a/test.js
+++ b/test.js
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

    const [showDiff, setShowDiff] = createSignal(true)

    testSetup = await testRender(() => (
      <box id="root" width="100%" height="100%">
        <Show
          when={showDiff()}
          fallback={
            <text id="fallback-text" width="100%" height="100%">
              No diff to display
            </text>
          }
        >
          <diff
            id="test-diff"
            diff={diffContent}
            view="unified"
            filetype="javascript"
            syntaxStyle={syntaxStyle}
            showLineNumbers={true}
            width="100%"
            height="100%"
          />
        </Show>
      </box>
    ))

    await testSetup.renderOnce()

    let frame = testSetup.captureCharFrame()

    // Initially shows diff content
    expect(frame).toContain("function add")
    expect(frame).toContain("function subtract")
    expect(frame).toContain("+")
    expect(frame).toContain("-")

    // Toggle to hide diff - this should trigger destruction of DiffRenderable
    setShowDiff(false)
    await testSetup.renderOnce()

    frame = testSetup.captureCharFrame()

    // Should show fallback text
    expect(frame).toContain("No diff to display")
    // Diff content should not be present
    expect(frame).not.toContain("function add")
    expect(frame).not.toContain("function subtract")

    // Toggle back to show diff - this should create a new DiffRenderable
    setShowDiff(true)
    await testSetup.renderOnce()

    frame = testSetup.captureCharFrame()

    // Diff should be visible again
    expect(frame).toContain("function add")
    expect(frame).toContain("function subtract")
  })

  test("handles conditional removal of split diff element", async () => {
    const syntaxStyle = SyntaxStyle.fromStyles({
      keyword: { fg: RGBA.fromValues(0.78, 0.57, 0.92, 1) },
      function: { fg: RGBA.fromValues(0.51, 0.67, 1, 1) },
      default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    })

    const diffContent = `--- a/test.js
+++ b/test.js
@@ -1,3 +1,3 @@
 function hello() {
-  console.log("Hello");
+  console.log("Hello, World!");
 }`

    const [showDiff, setShowDiff] = createSignal(true)

    testSetup = await testRender(() => (
      <box id="root" width="100%" height="100%">
        <Show
          when={showDiff()}
          fallback={
            <text id="fallback-text" width="100%" height="100%">
              No diff to display
            </text>
          }
        >
          <diff
            id="test-diff"
            diff={diffContent}
            view="split"
            filetype="javascript"
            syntaxStyle={syntaxStyle}
            showLineNumbers={true}
            width="100%"
            height="100%"
          />
        </Show>
      </box>
    ))

    await testSetup.renderOnce()

    let frame = testSetup.captureCharFrame()

    // Initially shows diff content in split view
    expect(frame).toContain("function hello")
    expect(frame).toContain("console.log")

    // Toggle to hide diff - this should trigger destruction of DiffRenderable with split view
    setShowDiff(false)
    await testSetup.renderOnce()

    frame = testSetup.captureCharFrame()

    // Should show fallback text
    expect(frame).toContain("No diff to display")
    // Diff content should not be present
    expect(frame).not.toContain("function hello")

    // Toggle back to show diff - this should create a new DiffRenderable
    setShowDiff(true)
    await testSetup.renderOnce()

    frame = testSetup.captureCharFrame()

    // Diff should be visible again
    expect(frame).toContain("function hello")
  })
})
