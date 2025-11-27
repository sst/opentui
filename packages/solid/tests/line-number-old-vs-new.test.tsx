import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../index"
import { For } from "solid-js"
import { SyntaxStyle } from "../../core/src/syntax-style"
import { MockTreeSitterClient } from "@opentui/core/testing"

let testSetup: Awaited<ReturnType<typeof testRender>>
let mockTreeSitterClient: MockTreeSitterClient

describe("OLD vs NEW Code - Exact Patch Comparison", () => {
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

  it("OLD CODE - Before LineNumberRenderable (from patch)", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])
    const content = "class Counter {\n  value = 0;\n}"
    const lines = content.split("\n")
    const pad = lines.length.toString().length
    const numbers = lines.map((_, index) => index + 1).map((x) => x.toString().padStart(pad, " "))

    testSetup = await testRender(
      () => (
        <box flexDirection="column" height="100%">
          <scrollbox flexGrow={1} scrollbarOptions={{ visible: false }} stickyScroll={true} stickyStart="bottom">
            <box border={["left"]} paddingTop={1} paddingBottom={1} paddingLeft={2} gap={1} backgroundColor="#1a1a1a">
              <text paddingLeft={3} fg="#888888">
                ← Wrote counter.ts
              </text>

              {/* OLD CODE FROM PATCH */}
              <box flexDirection="row">
                <box flexShrink={0}>
                  <For each={numbers}>{(value) => <text fg="#888888">{value}</text>}</For>
                </box>
                <box paddingLeft={1} flexGrow={1}>
                  <code
                    fg="#ffffff"
                    filetype="typescript"
                    syntaxStyle={syntaxStyle}
                    content={content}
                    treeSitterClient={mockTreeSitterClient}
                  />
                </box>
              </box>
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
    console.log("=== OLD CODE (BEFORE PATCH) ===")
    console.log(frame)
    console.log("=== END ===")

    const lines2 = frame.split("\n")
    const totalLines = lines2.length
    const contentLines = lines2.filter((line) => line.trim().length > 0).length
    const emptyLines = totalLines - contentLines

    console.log(`OLD: Total: ${totalLines}, Content: ${contentLines}, Empty: ${emptyLines}`)

    expect(frame).toContain("class Counter")
  })

  it("NEW CODE - After LineNumberRenderable (from patch)", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])
    const content = "class Counter {\n  value = 0;\n}"

    testSetup = await testRender(
      () => (
        <box flexDirection="column" height="100%">
          <scrollbox flexGrow={1} scrollbarOptions={{ visible: false }} stickyScroll={true} stickyStart="bottom">
            <box border={["left"]} paddingTop={1} paddingBottom={1} paddingLeft={2} gap={1} backgroundColor="#1a1a1a">
              <text paddingLeft={3} fg="#888888">
                ← Wrote counter.ts
              </text>

              {/* NEW CODE FROM PATCH */}
              <line_number fg="#888888" minWidth={3} paddingRight={1}>
                <code
                  fg="#ffffff"
                  filetype="typescript"
                  syntaxStyle={syntaxStyle}
                  content={content}
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
    console.log("=== NEW CODE (AFTER PATCH) ===")
    console.log(frame)
    console.log("=== END ===")

    const lines = frame.split("\n")
    const totalLines = lines.length
    const contentLines = lines.filter((line) => line.trim().length > 0).length
    const emptyLines = totalLines - contentLines

    console.log(`NEW: Total: ${totalLines}, Content: ${contentLines}, Empty: ${emptyLines}`)

    expect(frame).toContain("class Counter")
  })
})
