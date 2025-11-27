import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { testRender } from "../index"
import { SyntaxStyle, RGBA } from "@opentui/core"

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

    const unifiedView = diffRenderable?.unifiedView
    const gutterAfterAutoRender = unifiedView?.gutter
    const widthAfterAutoRender = gutterAfterAutoRender?.width

    // First explicit render
    await testSetup.renderOnce()
    const firstFrame = testSetup.captureCharFrame()
    const widthAfterFirst = diffRenderable?.unifiedView?.gutter?.width

    // Second render to check stability
    await testSetup.renderOnce()
    const secondFrame = testSetup.captureCharFrame()
    const widthAfterSecond = diffRenderable?.unifiedView?.gutter?.width

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
@@ -8,8 +8,10 @@
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

    const line8Match = line8.match(/^( +)8 /)
    if (!line8Match || !line8Match[1]) throw new Error("Line 8 format incorrect")
    expect(line8Match[1].length).toBeGreaterThanOrEqual(1)

    const line10Match = line10.match(/^( +)1[01] /)
    if (!line10Match || !line10Match[1]) throw new Error("Line 10 format incorrect")
    expect(line10Match[1].length).toBeGreaterThanOrEqual(1)

    const line16Match = line16.match(/^( +)1[67] /)
    if (!line16Match || !line16Match[1]) throw new Error("Line 16 format incorrect")
    expect(line16Match[1].length).toBeGreaterThanOrEqual(1)
  })
})
