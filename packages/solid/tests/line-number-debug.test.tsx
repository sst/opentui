import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../index"
import { SyntaxStyle } from "../../core/src/syntax-style"
import { MockTreeSitterClient } from "@opentui/core/testing"

let testSetup: Awaited<ReturnType<typeof testRender>>
let mockTreeSitterClient: MockTreeSitterClient

describe("LineNumber Debug - Visual Border Tests", () => {
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

  it("DEBUG: line_number with borders to see actual height", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])
    const codeContent = `function hello() {
  console.log("Hello");
  return 42;
}`

    testSetup = await testRender(
      () => (
        <box flexDirection="column" border borderColor="#ff0000" title="Outer Container">
          <scrollbox flexGrow={1} scrollbarOptions={{ visible: false }} border borderColor="#00ff00" title="ScrollBox">
            <line_number fg="#888888" minWidth={3} paddingRight={1} border borderColor="#0000ff" title="LineNumber">
              <code
                fg="#ffffff"
                filetype="javascript"
                syntaxStyle={syntaxStyle}
                content={codeContent}
                treeSitterClient={mockTreeSitterClient}
              />
            </line_number>
          </scrollbox>
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
    console.log("=== FRAME WITH BORDERS ===")
    console.log(frame)
    console.log("=== END FRAME ===")

    expect(frame).toMatchSnapshot()

    // The borders will show us exactly where each component's boundaries are
    expect(frame).toContain("function hello")
  })

  it("DEBUG: multiple line_number blocks with borders", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])

    testSetup = await testRender(
      () => (
        <box flexDirection="column" border borderColor="#ff0000">
          <scrollbox flexGrow={1} scrollbarOptions={{ visible: false }} border borderColor="#00ff00">
            <box border borderColor="#ffff00" title="Block 1 Container">
              <line_number fg="#888888" minWidth={2} paddingRight={1} border borderColor="#0000ff">
                <code
                  fg="#ffffff"
                  filetype="javascript"
                  syntaxStyle={syntaxStyle}
                  content="const x = 1;"
                  treeSitterClient={mockTreeSitterClient}
                />
              </line_number>
            </box>

            <box border borderColor="#ff00ff" title="Block 2 Container">
              <line_number fg="#888888" minWidth={2} paddingRight={1} border borderColor="#00ffff">
                <code
                  fg="#ffffff"
                  filetype="javascript"
                  syntaxStyle={syntaxStyle}
                  content="const y = 2;"
                  treeSitterClient={mockTreeSitterClient}
                />
              </line_number>
            </box>
          </scrollbox>
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
    console.log("=== MULTIPLE BLOCKS WITH BORDERS ===")
    console.log(frame)
    console.log("=== END FRAME ===")

    expect(frame).toMatchSnapshot()
  })

  it("DEBUG: add markers between blocks to see spacing", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])

    testSetup = await testRender(
      () => (
        <box flexDirection="column" border borderColor="#ff0000">
          <scrollbox flexGrow={1} scrollbarOptions={{ visible: false }}>
            <text>▼▼▼ START ▼▼▼</text>

            <line_number fg="#888888" minWidth={2} paddingRight={1} border borderColor="#0000ff" title="LineNum1">
              <code
                fg="#ffffff"
                filetype="javascript"
                syntaxStyle={syntaxStyle}
                content="const x = 1;"
                treeSitterClient={mockTreeSitterClient}
              />
            </line_number>

            <text>▲▲▲ BETWEEN ▼▼▼</text>

            <line_number fg="#888888" minWidth={2} paddingRight={1} border borderColor="#00ffff" title="LineNum2">
              <code
                fg="#ffffff"
                filetype="javascript"
                syntaxStyle={syntaxStyle}
                content="const y = 2;"
                treeSitterClient={mockTreeSitterClient}
              />
            </line_number>

            <text>▲▲▲ END ▲▲▲</text>
          </scrollbox>
        </box>
      ),
      {
        width: 50,
        height: 35,
      },
    )

    await testSetup.renderOnce()
    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await testSetup.renderOnce()

    const frame = testSetup.captureCharFrame()
    console.log("=== WITH MARKERS ===")
    console.log(frame)
    console.log("=== END FRAME ===")

    expect(frame).toMatchSnapshot()

    // All markers should be visible
    expect(frame).toContain("START")
    expect(frame).toContain("BETWEEN")
    expect(frame).toContain("END")
  })
})
