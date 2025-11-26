import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { testRender } from "../index"
import { SyntaxStyle } from "@opentui/core"
import { MockTreeSitterClient } from "@opentui/core/testing"

let testSetup: Awaited<ReturnType<typeof testRender>>
let mockTreeSitterClient: MockTreeSitterClient

describe("LineNumberRenderable with SolidJS", () => {
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

  test("renders code with line numbers", async () => {
    const syntaxStyle = SyntaxStyle.fromStyles({
      keyword: { fg: "#C792EA" },
      function: { fg: "#82AAFF" },
      default: { fg: "#FFFFFF" },
    })

    const codeContent = `function test() {
  return 42
}
console.log(test())`

    testSetup = await testRender(() => (
      <box id="root" width="100%" height="100%">
        <line_number
          id="line-numbers"
          fg="#888888"
          bg="#000000"
          minWidth={3}
          paddingRight={1}
          width="100%"
          height="100%"
        >
          <code
            id="code-content"
            content={codeContent}
            filetype="javascript"
            syntaxStyle={syntaxStyle}
            treeSitterClient={mockTreeSitterClient}
            width="100%"
            height="100%"
          />
        </line_number>
      </box>
    ))

    await testSetup.renderOnce()

    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await testSetup.renderOnce()

    const frame = testSetup.captureCharFrame()

    // Basic checks
    expect(frame).toContain("function test()")
    expect(frame).toContain(" 1 ") // Line number 1
    expect(frame).toContain(" 2 ") // Line number 2
    expect(frame).toContain(" 3 ") // Line number 3
    expect(frame).toContain(" 4 ") // Line number 4
  })
})
