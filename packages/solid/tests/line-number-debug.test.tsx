import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../index"
import { SyntaxStyle } from "../../core/src/syntax-style"
import { MockTreeSitterClient } from "@opentui/core/testing"

/**
 * CRITICAL BUG REPRODUCTION
 *
 * Based on actual OpenCode logs:
 *
 * WORKING (old code with manual boxes):
 *   box-399 (ToolPart): h=34
 *     text-413 (ToolTitle): h=2
 *     box-400 (row): h=29
 *       code: h=29
 *
 * BROKEN (LineNumberRenderable):
 *   box-399 (ToolPart): h=13 ⚠️
 *     text-413 (ToolTitle): h=0 ⚠️
 *     line_number: h=29 ⚠️ EXTENDS BEYOND PARENT!
 *       code: h=29
 *
 * The line_number is 29 lines tall but its parent is only 13 lines!
 * This causes overlap with content below.
 */

let testSetup: Awaited<ReturnType<typeof testRender>>
let mockTreeSitterClient: MockTreeSitterClient

describe("LineNumber Critical Bug - Parent Height Violation", () => {
  beforeEach(async () => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
    mockTreeSitterClient = new MockTreeSitterClient()
    mockTreeSitterClient.setMockResult({ highlights: [] })
  })

  afterEach(() => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
  })

  it("BUG: LineNumberRenderable extends beyond parent container height", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])

    // 29 lines of code
    const longCode = Array.from({ length: 29 }, (_, i) => `line ${i + 1}`).join("\n")

    testSetup = await testRender(
      () => (
        <box flexDirection="column" height="100%">
          <scrollbox flexGrow={1} scrollbarOptions={{ visible: false }} stickyScroll={true} stickyStart="bottom">
            {/* ToolPart structure - box with border, padding, gap */}
            <box
              id="tool-part"
              border={["left"]}
              paddingTop={1}
              paddingBottom={1}
              paddingLeft={2}
              gap={1}
              backgroundColor="#1a1a1a"
            >
              {/* ToolTitle */}
              <text id="tool-title" paddingLeft={3} fg="#888888">
                ← Wrote test.ts
              </text>

              {/* LineNumberRenderable */}
              <line_number id="line-num" fg="#888888" minWidth={3} paddingRight={1}>
                <code
                  id="code-content"
                  fg="#ffffff"
                  filetype="typescript"
                  syntaxStyle={syntaxStyle}
                  content={longCode}
                  treeSitterClient={mockTreeSitterClient}
                />
              </line_number>
            </box>

            {/* Next message - should NOT overlap */}
            <box paddingLeft={3} marginTop={1}>
              <text id="next-message" fg="#ffffff">
                This text should NOT be overlapped by line numbers!
              </text>
            </box>
          </scrollbox>
        </box>
      ),
      {
        width: 73,
        height: 45,
      },
    )

    await testSetup.renderOnce()
    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await testSetup.renderOnce()

    const frame = testSetup.captureCharFrame()
    console.log("=== BUG REPRODUCTION ===")
    console.log(frame)
    console.log("=== END ===")

    // The critical assertions from the logs
    const toolPart = testSetup.renderer.root.findById("tool-part")
    const toolTitle = testSetup.renderer.root.findById("tool-title")
    const lineNum = testSetup.renderer.root.findById("line-num")
    const codeContent = testSetup.renderer.root.findById("code-content")

    console.log("\n=== LAYOUT ANALYSIS ===")
    console.log(`tool-part:    y=${toolPart?.y} h=${toolPart?.height}`)
    console.log(`tool-title:   y=${toolTitle?.y} h=${toolTitle?.height}`)
    console.log(`line-num:     y=${lineNum?.y} h=${lineNum?.height}`)
    console.log(`code-content: y=${codeContent?.y} h=${codeContent?.height}`)

    if (toolPart && lineNum) {
      const parentHeight = toolPart.height
      const childHeight = lineNum.height
      const overflow = childHeight - (parentHeight - (lineNum.y - toolPart.y))

      console.log(`\nPARENT vs CHILD:`)
      console.log(`  Parent (tool-part) height: ${parentHeight}`)
      console.log(`  Child (line-num) height: ${childHeight}`)
      console.log(`  Child relative Y: ${lineNum.y - toolPart.y}`)
      console.log(`  Overflow: ${overflow} lines`)

      if (overflow > 0) {
        console.log(`\n🚨 BUG CONFIRMED: line_number extends ${overflow} lines beyond parent!`)
      }
    }

    expect(frame).toContain("Wrote test.ts")
    expect(frame).toContain("line 1")
  })
})
