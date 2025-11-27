import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../index"
import { SyntaxStyle } from "../../core/src/syntax-style"
import { MockTreeSitterClient } from "@opentui/core/testing"

let testSetup: Awaited<ReturnType<typeof testRender>>
let mockTreeSitterClient: MockTreeSitterClient

describe("LineNumber Comparison - With vs Without", () => {
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

  it("WITHOUT line_number - just plain code", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])

    testSetup = await testRender(
      () => (
        <box flexDirection="column" height="100%">
          <scrollbox flexGrow={1} scrollbarOptions={{ visible: false }} stickyScroll={true} stickyStart="bottom">
            <box border={["left"]} paddingTop={1} paddingBottom={1} paddingLeft={2} gap={1} backgroundColor="#1a1a1a">
              <text paddingLeft={3} fg="#888888">
                ← Wrote counter.ts
              </text>

              <code
                fg="#ffffff"
                filetype="typescript"
                syntaxStyle={syntaxStyle}
                content="class Counter {\n  value = 0;\n}"
                treeSitterClient={mockTreeSitterClient}
              />
            </box>
          </scrollbox>
        </box>
      ),
      {
        width: 50,
        height: 25,
      },
    )

    await testSetup.renderOnce()
    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await testSetup.renderOnce()

    const frame = testSetup.captureCharFrame()
    console.log("=== WITHOUT LINE_NUMBER ===")
    console.log(frame)
    console.log("=== END ===")

    const lines = frame.split("\n")
    const totalLines = lines.length
    const contentLines = lines.filter((line) => line.trim().length > 0).length
    const emptyLines = totalLines - contentLines

    console.log(`WITHOUT: Total: ${totalLines}, Content: ${contentLines}, Empty: ${emptyLines}`)

    expect(frame).toContain("class Counter")
  })

  it("WITH line_number - wrapped code", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])

    testSetup = await testRender(
      () => (
        <box flexDirection="column" height="100%">
          <scrollbox flexGrow={1} scrollbarOptions={{ visible: false }} stickyScroll={true} stickyStart="bottom">
            <box border={["left"]} paddingTop={1} paddingBottom={1} paddingLeft={2} gap={1} backgroundColor="#1a1a1a">
              <text paddingLeft={3} fg="#888888">
                ← Wrote counter.ts
              </text>

              <line_number fg="#888888" minWidth={3} paddingRight={1}>
                <code
                  fg="#ffffff"
                  filetype="typescript"
                  syntaxStyle={syntaxStyle}
                  content="class Counter {\n  value = 0;\n}"
                  treeSitterClient={mockTreeSitterClient}
                />
              </line_number>
            </box>
          </scrollbox>
        </box>
      ),
      {
        width: 50,
        height: 25,
      },
    )

    await testSetup.renderOnce()
    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await testSetup.renderOnce()

    const frame = testSetup.captureCharFrame()
    console.log("=== WITH LINE_NUMBER ===")
    console.log(frame)
    console.log("=== END ===")

    const lines = frame.split("\n")
    const totalLines = lines.length
    const contentLines = lines.filter((line) => line.trim().length > 0).length
    const emptyLines = totalLines - contentLines

    console.log(`WITH: Total: ${totalLines}, Content: ${contentLines}, Empty: ${emptyLines}`)

    expect(frame).toContain("class Counter")
  })
})
