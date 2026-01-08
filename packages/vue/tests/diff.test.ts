import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { defineComponent, h, ref, nextTick } from "vue"
import { testRender } from "../src/test-utils"
import { SyntaxStyle, RGBA } from "@opentui/core"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("DiffRenderable with Vue", () => {
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

  it("renders unified diff without glitching", async () => {
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

    const TestComponent = defineComponent({
      setup() {
        return () =>
          h("box", { id: "root", width: "100%", height: "100%" }, [
            h("diff", {
              id: "test-diff",
              diff: diffContent,
              view: "unified",
              filetype: "javascript",
              syntaxStyle,
              showLineNumbers: true,
              width: "100%",
              height: "100%",
            }),
          ])
      },
    })

    testSetup = await testRender(TestComponent)

    // Wait for automatic initial render
    await Bun.sleep(50)

    const box = testSetup.renderer.root.getRenderable("root")
    const diff = box?.getRenderable("test-diff") as any
    const leftSide = diff?.getRenderable("test-diff-left") as any
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

  it("renders split diff correctly", async () => {
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

    const TestComponent = defineComponent({
      setup() {
        return () =>
          h("box", { id: "root", width: "100%", height: "100%" }, [
            h("diff", {
              id: "test-diff",
              diff: diffContent,
              view: "split",
              filetype: "javascript",
              syntaxStyle,
              showLineNumbers: true,
              width: "100%",
              height: "100%",
            }),
          ])
      },
    })

    testSetup = await testRender(TestComponent)

    await testSetup.renderOnce()

    const frame = testSetup.captureCharFrame()

    // Both sides should be visible
    expect(frame).toContain("function hello")
    expect(frame).toContain("console.log")
    expect(frame).toContain("Hello")
  })

  it("handles double-digit line numbers with proper left padding", async () => {
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

    const TestComponent = defineComponent({
      setup() {
        return () =>
          h("box", { id: "root", width: "100%", height: "100%" }, [
            h("diff", {
              id: "test-diff",
              diff: diffWith10PlusLines,
              view: "unified",
              syntaxStyle,
              showLineNumbers: true,
              width: "100%",
              height: "100%",
            }),
          ])
      },
    })

    testSetup = await testRender(TestComponent)

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
    const line16Match = line16.match(/^( +)\d+ /)
    if (!line16Match || !line16Match[1]) throw new Error("Line 16 format incorrect")
    expect(line16Match[1].length).toBeGreaterThanOrEqual(1)
  })

  it("handles conditional removal of diff element", async () => {
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

    const showDiff = ref(true)

    const TestComponent = defineComponent({
      setup() {
        return () =>
          h("box", { id: "root", width: "100%", height: "100%" }, [
            showDiff.value
              ? h("diff", {
                  id: "test-diff",
                  diff: diffContent,
                  view: "unified",
                  filetype: "javascript",
                  syntaxStyle,
                  showLineNumbers: true,
                  width: "100%",
                  height: "100%",
                })
              : h("Text", { id: "fallback-text", width: "100%", height: "100%" }, "No diff to display"),
          ])
      },
    })

    testSetup = await testRender(TestComponent)

    await testSetup.renderOnce()

    let frame = testSetup.captureCharFrame()

    // Initially shows diff content
    expect(frame).toContain("function add")
    expect(frame).toContain("function subtract")
    expect(frame).toContain("+")
    expect(frame).toContain("-")

    // Toggle to hide diff - this should trigger destruction of DiffRenderable
    showDiff.value = false
    await nextTick()
    await testSetup.renderOnce()

    frame = testSetup.captureCharFrame()

    // Should show fallback text
    expect(frame).toContain("No diff to display")
    // Diff content should not be present
    expect(frame).not.toContain("function add")
    expect(frame).not.toContain("function subtract")

    // Toggle back to show diff - this should create a new DiffRenderable
    showDiff.value = true
    await nextTick()
    await testSetup.renderOnce()

    frame = testSetup.captureCharFrame()

    // Diff should be visible again
    expect(frame).toContain("function add")
    expect(frame).toContain("function subtract")
  })

  it("handles conditional removal of split diff element", async () => {
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

    const showDiff = ref(true)

    const TestComponent = defineComponent({
      setup() {
        return () =>
          h("box", { id: "root", width: "100%", height: "100%" }, [
            showDiff.value
              ? h("diff", {
                  id: "test-diff",
                  diff: diffContent,
                  view: "split",
                  filetype: "javascript",
                  syntaxStyle,
                  showLineNumbers: true,
                  width: "100%",
                  height: "100%",
                })
              : h("Text", { id: "fallback-text", width: "100%", height: "100%" }, "No diff to display"),
          ])
      },
    })

    testSetup = await testRender(TestComponent)

    await testSetup.renderOnce()

    let frame = testSetup.captureCharFrame()

    // Initially shows diff content in split view
    expect(frame).toContain("function hello")
    expect(frame).toContain("console.log")

    // Toggle to hide diff - this should trigger destruction of DiffRenderable with split view
    showDiff.value = false
    await nextTick()
    await testSetup.renderOnce()

    frame = testSetup.captureCharFrame()

    // Should show fallback text
    expect(frame).toContain("No diff to display")
    // Diff content should not be present
    expect(frame).not.toContain("function hello")

    // Toggle back to show diff - this should create a new DiffRenderable
    showDiff.value = true
    await nextTick()
    await testSetup.renderOnce()

    frame = testSetup.captureCharFrame()

    // Diff should be visible again
    expect(frame).toContain("function hello")
  })

  it("split diff with word wrapping: toggling vs setting from start should match", async () => {
    const syntaxStyle = SyntaxStyle.fromStyles({
      keyword: { fg: RGBA.fromValues(0.78, 0.57, 0.92, 1) },
      "keyword.import": { fg: RGBA.fromValues(0.78, 0.57, 0.92, 1) },
      string: { fg: RGBA.fromValues(0.65, 0.84, 1, 1) },
      comment: { fg: RGBA.fromValues(0.55, 0.58, 0.62, 1), italic: true },
      function: { fg: RGBA.fromValues(0.51, 0.67, 1, 1) },
      default: { fg: RGBA.fromValues(0.9, 0.93, 0.95, 1) },
    })

    // Use the actual diff content from the demo
    const diffContent = `Index: packages/core/src/examples/index.ts
===================================================================
--- packages/core/src/examples/index.ts	before
+++ packages/core/src/examples/index.ts	after
@@ -56,6 +56,7 @@
 import * as terminalDemo from "./terminal"
 import * as diffDemo from "./diff-demo"
 import * as keypressDebugDemo from "./keypress-debug-demo"
+import * as textTruncationDemo from "./text-truncation-demo"
 import { setupCommonDemoKeys } from "./lib/standalone-keys"
 
 interface Example {
@@ -85,6 +86,12 @@
     destroy: textSelectionExample.destroy,
   },
   {
+    name: "Text Truncation Demo",
+    description: "Middle truncation with ellipsis - toggle with 'T' key and resize to test responsive behavior",
+    run: textTruncationDemo.run,
+    destroy: textTruncationDemo.destroy,
+  },
+  {
     name: "ASCII Font Selection Demo",
     description: "Text selection with ASCII fonts - precise character-level selection across different font types",
     run: asciiFontSelectionExample.run,`

    const wrapMode = ref<"none" | "word">("none")

    const TestComponent = defineComponent({
      setup() {
        return () =>
          h("box", { id: "root", width: "100%", height: "100%" }, [
            h("diff", {
              id: "test-diff-toggle",
              diff: diffContent,
              view: "split",
              filetype: "typescript",
              syntaxStyle,
              showLineNumbers: true,
              wrapMode: wrapMode.value,
              width: "100%",
              height: "100%",
            }),
          ])
      },
    })

    testSetup = await testRender(TestComponent)

    await testSetup.renderOnce()
    wrapMode.value = "word"
    await nextTick()
    await Bun.sleep(10)
    await testSetup.renderer.idle()

    const frameAfterToggle = testSetup.captureCharFrame()

    testSetup.renderer.destroy()

    // Create a new test with word wrap from the start
    const TestComponentFromStart = defineComponent({
      setup() {
        return () =>
          h("box", { id: "root", width: "100%", height: "100%" }, [
            h("diff", {
              id: "test-diff-from-start",
              diff: diffContent,
              view: "split",
              filetype: "typescript",
              syntaxStyle,
              showLineNumbers: true,
              wrapMode: "word",
              width: "100%",
              height: "100%",
            }),
          ])
      },
    })

    testSetup = await testRender(TestComponentFromStart)

    await Bun.sleep(10)
    await testSetup.renderer.idle()

    const frameFromStart = testSetup.captureCharFrame()

    expect(frameAfterToggle).toBe(frameFromStart)
  })
})
