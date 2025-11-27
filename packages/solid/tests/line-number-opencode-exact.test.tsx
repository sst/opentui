import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../index"
import { For, createSignal } from "solid-js"
import { SyntaxStyle } from "../../core/src/syntax-style"
import { MockTreeSitterClient } from "@opentui/core/testing"

/**
 * EXACT REPRODUCTION OF OPENCODE SESSION LAYOUT
 *
 * This test replicates the EXACT structure from OpenCode's session view:
 * - scrollbox with stickyScroll + stickyStart="bottom"
 * - box containers with border, paddingTop=1, paddingBottom=1, paddingLeft=2, gap=1
 * - ToolTitle as text with paddingLeft=3
 * - line_number WITHOUT flexShrink (critical!)
 * - Multiple messages with reactive updates
 *
 * RUN WITH: DEBUG_LINE_NUMBER=1 bun test line-number-opencode-exact.test.tsx
 */

let testSetup: Awaited<ReturnType<typeof testRender>>
let mockTreeSitterClient: MockTreeSitterClient

describe("LineNumber OpenCode EXACT Reproduction", () => {
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

  it("EXACT: WriteTool rendering with box container + gap + no flexShrink", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])

    // Simulate exactly how WriteTool renders
    const code = `class Counter {
  private value: number;

  constructor(initialValue: number = 0) {
    this.value = initialValue;
  }

  increment(): void {
    this.value++;
  }

  decrement(): void {
    this.value--;
  }

  reset(): void {
    this.value = 0;
  }

  getValue(): number {
    return this.value;
  }
}`

    testSetup = await testRender(
      () => (
        <box flexDirection="row">
          <box flexGrow={1} paddingBottom={1} paddingTop={1} paddingLeft={2} paddingRight={2} gap={1}>
            <scrollbox
              scrollbarOptions={{
                paddingLeft: 2,
                visible: false,
              }}
              stickyScroll={true}
              stickyStart="bottom"
              flexGrow={1}
            >
              {/* EXACT structure from ToolPart */}
              <box
                border={["left"]}
                paddingTop={1}
                paddingBottom={1}
                paddingLeft={2}
                marginTop={1}
                gap={1}
                backgroundColor="#1a1a1a"
              >
                {/* ToolTitle */}
                <text paddingLeft={3} fg="#888888">
                  ← Wrote counter.ts
                </text>

                {/* line_number - NOTE: NO flexShrink prop! */}
                <line_number fg="#888888" minWidth={3} paddingRight={1}>
                  <code
                    fg="#ffffff"
                    filetype="typescript"
                    syntaxStyle={syntaxStyle}
                    content={code}
                    treeSitterClient={mockTreeSitterClient}
                  />
                </line_number>
              </box>
            </scrollbox>
          </box>
        </box>
      ),
      {
        width: 72,
        height: 40,
      },
    )

    await testSetup.renderOnce()
    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await testSetup.renderOnce()

    const frame = testSetup.captureCharFrame()
    console.log("=== EXACT OPENCODE STRUCTURE ===")
    console.log(frame)
    console.log("=== END ===")

    // Check that line numbers appear
    expect(frame).toContain("class Counter")
    expect(frame).toMatch(/\d+\s+class Counter/) // Line number followed by code
  })

  it("EXACT: Multiple WriteTool blocks in sequence (cumulative gap issue?)", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])

    const files = [
      { name: "file1.ts", code: "const a = 1;\nconst b = 2;" },
      { name: "file2.ts", code: "const c = 3;\nconst d = 4;" },
      { name: "file3.ts", code: "const e = 5;\nconst f = 6;" },
    ]

    testSetup = await testRender(
      () => (
        <box flexDirection="row">
          <box flexGrow={1} paddingBottom={1} paddingTop={1} paddingLeft={2} paddingRight={2} gap={1}>
            <scrollbox
              scrollbarOptions={{
                paddingLeft: 2,
                visible: false,
              }}
              stickyScroll={true}
              stickyStart="bottom"
              flexGrow={1}
            >
              <For each={files}>
                {(file) => (
                  <box
                    border={["left"]}
                    paddingTop={1}
                    paddingBottom={1}
                    paddingLeft={2}
                    marginTop={1}
                    gap={1}
                    backgroundColor="#1a1a1a"
                  >
                    <text paddingLeft={3} fg="#888888">
                      ← Wrote {file.name}
                    </text>

                    {/* NO flexShrink! */}
                    <line_number fg="#888888" minWidth={3} paddingRight={1}>
                      <code
                        fg="#ffffff"
                        filetype="typescript"
                        syntaxStyle={syntaxStyle}
                        content={file.code}
                        treeSitterClient={mockTreeSitterClient}
                      />
                    </line_number>
                  </box>
                )}
              </For>
            </scrollbox>
          </box>
        </box>
      ),
      {
        width: 60,
        height: 50,
      },
    )

    await testSetup.renderOnce()
    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await testSetup.renderOnce()

    const frame = testSetup.captureCharFrame()
    console.log("=== MULTIPLE BLOCKS NO FLEXSHRINK ===")
    console.log(frame)
    console.log("=== END ===")

    const lines = frame.split("\n")

    // Find markers
    const file1Idx = lines.findIndex((line) => line.includes("file1.ts"))
    const file2Idx = lines.findIndex((line) => line.includes("file2.ts"))
    const file3Idx = lines.findIndex((line) => line.includes("file3.ts"))

    console.log(`Indices: file1=${file1Idx}, file2=${file2Idx}, file3=${file3Idx}`)

    if (file1Idx >= 0 && file2Idx >= 0) {
      const block1Height = file2Idx - file1Idx
      console.log(`Block 1 height: ${block1Height} lines (code has 2 lines)`)

      // With gap=1, we expect: 1 (title) + 2 (code) + gap lines = ~3-5 lines
      // If we see 10+ lines, that's the bug
      if (block1Height > 10) {
        console.log("🚨 BUG FOUND: Excessive height between blocks!")
      }
    }

    expect(frame).toContain("file1.ts")
    expect(frame).toContain("file2.ts")
  })

  it("EXACT: Dynamic content update (mimics streaming/reactive changes)", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])
    const [code, setCode] = createSignal("const x = 1;")

    testSetup = await testRender(
      () => (
        <box flexDirection="row">
          <box flexGrow={1} paddingBottom={1} paddingTop={1} paddingLeft={2} paddingRight={2} gap={1}>
            <scrollbox
              scrollbarOptions={{
                paddingLeft: 2,
                visible: false,
              }}
              stickyScroll={true}
              stickyStart="bottom"
              flexGrow={1}
            >
              <box
                border={["left"]}
                paddingTop={1}
                paddingBottom={1}
                paddingLeft={2}
                marginTop={1}
                gap={1}
                backgroundColor="#1a1a1a"
              >
                <text paddingLeft={3} fg="#888888">
                  ← Wrote test.ts
                </text>

                <line_number fg="#888888" minWidth={3} paddingRight={1}>
                  <code
                    fg="#ffffff"
                    filetype="typescript"
                    syntaxStyle={syntaxStyle}
                    content={code()}
                    treeSitterClient={mockTreeSitterClient}
                  />
                </line_number>
              </box>
            </scrollbox>
          </box>
        </box>
      ),
      {
        width: 60,
        height: 30,
      },
    )

    await testSetup.renderOnce()
    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await testSetup.renderOnce()

    const frame1 = testSetup.captureCharFrame()
    console.log("=== INITIAL RENDER ===")
    console.log(frame1)
    console.log("=== END ===")

    expect(frame1).toContain("const x = 1")

    // Update code to longer content
    setCode(`const x = 1;
const y = 2;
const z = 3;
function test() {
  return x + y + z;
}`)

    await testSetup.renderOnce()
    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await testSetup.renderOnce()

    const frame2 = testSetup.captureCharFrame()
    console.log("=== AFTER UPDATE ===")
    console.log(frame2)
    console.log("=== END ===")

    const lines = frame2.split("\n")
    const wroteIdx = lines.findIndex((line) => line.includes("Wrote test.ts"))

    if (wroteIdx >= 0) {
      // Count lines with actual code (not empty)
      let codeLineCount = 0
      let emptyLineCount = 0

      for (let i = wroteIdx + 1; i < lines.length; i++) {
        const line = lines[i] ?? ""
        if (line.includes("function test") || line.includes("const")) {
          codeLineCount++
        } else if (line.trim().length === 0 || /^\s*\d+\s*$/.test(line)) {
          emptyLineCount++
        }
      }

      console.log(`After update: ${codeLineCount} code lines, ${emptyLineCount} empty lines`)

      if (emptyLineCount > 20) {
        console.log("🚨 BUG FOUND: Excessive empty lines after update!")
      }
    }

    expect(frame2).toContain("function test")
  })

  it("EXACT: Box with explicit gap={1} - does gap affect line_number height?", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])

    testSetup = await testRender(
      () => (
        <box flexDirection="column" padding={2}>
          <text fg="#00ff00">=== Start Marker ===</text>

          {/* Exact ToolPart structure */}
          <box
            border={["left"]}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            marginTop={1}
            gap={1} // <-- This gap might be causing issues
            backgroundColor="#1a1a1a"
          >
            <text paddingLeft={3} fg="#888888">
              ← Wrote test.ts
            </text>

            <line_number fg="#888888" minWidth={3} paddingRight={1}>
              <code
                fg="#ffffff"
                filetype="typescript"
                syntaxStyle={syntaxStyle}
                content="const a = 1;\nconst b = 2;\nconst c = 3;"
                treeSitterClient={mockTreeSitterClient}
              />
            </line_number>
          </box>

          <text fg="#00ff00">=== End Marker ===</text>
        </box>
      ),
      {
        width: 50,
        height: 30,
      },
    )

    await testSetup.renderOnce()
    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await testSetup.renderOnce()

    const frame = testSetup.captureCharFrame()
    console.log("=== GAP EFFECT TEST ===")
    console.log(frame)
    console.log("=== END ===")

    const lines = frame.split("\n")
    const startIdx = lines.findIndex((line) => line.includes("Start Marker"))
    const endIdx = lines.findIndex((line) => line.includes("End Marker"))

    if (startIdx >= 0 && endIdx >= 0) {
      const distance = endIdx - startIdx
      console.log(`Distance between markers: ${distance} lines (3 lines of code + padding/borders)`)

      // Expected: ~7-9 lines (1 start + 1 title + 3 code + 1 gap? + 1 padding + 1 end)
      // If we see 15+ lines, gap might be causing extra spacing
      if (distance > 12) {
        console.log("🚨 BUG FOUND: Gap causing excessive spacing!")
      }
    }

    expect(frame).toContain("const a = 1")
    expect(startIdx).toBeGreaterThanOrEqual(0)
    expect(endIdx).toBeGreaterThan(startIdx)
  })

  it("EXACT: Line number WITHOUT flexShrink in scrollbox with flexGrow parent", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])

    testSetup = await testRender(
      () => (
        <box flexDirection="column" height="100%">
          {/* This scrollbox has flexGrow */}
          <scrollbox flexGrow={1} scrollbarOptions={{ visible: false }} stickyScroll={true} stickyStart="bottom">
            {/* Box with gap */}
            <box border={["left"]} paddingTop={1} paddingBottom={1} paddingLeft={2} gap={1} backgroundColor="#1a1a1a">
              <text paddingLeft={3} fg="#888888">
                ← Wrote counter.ts
              </text>

              {/* Critical: NO flexShrink means it inherits default behavior */}
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
    console.log("=== NO FLEXSHRINK IN FLEXGROW PARENT ===")
    console.log(frame)
    console.log("=== END ===")

    // Count total lines vs content lines
    const lines = frame.split("\n")
    const totalLines = lines.length
    const contentLines = lines.filter((line) => line.trim().length > 0).length
    const emptyLines = totalLines - contentLines

    console.log(`Total: ${totalLines}, Content: ${contentLines}, Empty: ${emptyLines}`)

    if (emptyLines > 15) {
      console.log("🚨 BUG FOUND: Excessive empty space in flexGrow parent!")
    }

    expect(frame).toContain("class Counter")
  })
})
