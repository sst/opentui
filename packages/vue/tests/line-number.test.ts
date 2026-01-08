import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { defineComponent, h, ref, nextTick } from "vue"
import { testRender } from "../src/test-utils"
import { SyntaxStyle } from "@opentui/core"
import { MockTreeSitterClient } from "@opentui/core/testing"

let testSetup: Awaited<ReturnType<typeof testRender>>
let mockTreeSitterClient: MockTreeSitterClient

describe("Vue Renderer | LineNumberRenderable Tests", () => {
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

  it("renders code with line numbers", async () => {
    const syntaxStyle = SyntaxStyle.fromStyles({
      keyword: { fg: "#C792EA" },
      function: { fg: "#82AAFF" },
      default: { fg: "#FFFFFF" },
    })

    const codeContent = `function test() {
  return 42
}
console.log(test())`

    const TestComponent = defineComponent({
      setup() {
        return () =>
          h("box", { id: "root", style: { width: "100%", height: "100%" } }, [
            h(
              "line-number",
              {
                id: "line-numbers",
                fg: "#888888",
                bg: "#000000",
                minWidth: 3,
                paddingRight: 1,
                style: { width: "100%", height: "100%" },
              },
              [
                h("Code", {
                  id: "code-content",
                  content: codeContent,
                  filetype: "javascript",
                  syntaxStyle: syntaxStyle,
                  treeSitterClient: mockTreeSitterClient,
                  style: { width: "100%", height: "100%" },
                }),
              ],
            ),
          ])
      },
    })

    testSetup = await testRender(TestComponent, {
      width: 40,
      height: 10,
    })

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

  it("handles conditional removal of line number element", async () => {
    const syntaxStyle = SyntaxStyle.fromStyles({
      keyword: { fg: "#C792EA" },
      function: { fg: "#82AAFF" },
      default: { fg: "#FFFFFF" },
    })

    const codeContent = `function test() {
  return 42
}
console.log(test())`

    const showLineNumbers = ref(true)

    const TestComponent = defineComponent({
      setup() {
        return () =>
          h("box", { id: "root", style: { width: "100%", height: "100%" } }, [
            showLineNumbers.value
              ? h(
                  "line-number",
                  {
                    id: "line-numbers",
                    fg: "#888888",
                    bg: "#000000",
                    minWidth: 3,
                    paddingRight: 1,
                    style: { width: "100%", height: "100%" },
                  },
                  [
                    h("Code", {
                      id: "code-content",
                      content: codeContent,
                      filetype: "javascript",
                      syntaxStyle: syntaxStyle,
                      treeSitterClient: mockTreeSitterClient,
                      style: { width: "100%", height: "100%" },
                    }),
                  ],
                )
              : h("Code", {
                  id: "code-content-no-lines",
                  content: codeContent,
                  filetype: "javascript",
                  syntaxStyle: syntaxStyle,
                  treeSitterClient: mockTreeSitterClient,
                  style: { width: "100%", height: "100%" },
                }),
          ])
      },
    })

    testSetup = await testRender(TestComponent, {
      width: 40,
      height: 10,
    })

    await testSetup.renderOnce()
    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await testSetup.renderOnce()

    let frame = testSetup.captureCharFrame()

    // Initially shows line numbers
    expect(frame).toContain(" 1 ")
    expect(frame).toContain(" 2 ")

    // Toggle to hide line numbers - this should trigger destruction of LineNumberRenderable
    showLineNumbers.value = false
    await nextTick()
    await testSetup.renderOnce()
    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await testSetup.renderOnce()

    frame = testSetup.captureCharFrame()

    // Should still show code but without line numbers
    expect(frame).toContain("function test()")
    // Line numbers should not be present
    expect(frame).not.toContain(" 1 function")
  })
})
