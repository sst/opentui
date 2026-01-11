import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../index"
import type { TextRenderable } from "@opentui/core"

let testSetup: Awaited<ReturnType<typeof testRender>>

// Helper to get text renderable from renderer
function getTextRenderable(renderer: any): TextRenderable {
  return renderer.root.getChildren()[0] as TextRenderable
}

describe("Link Rendering Tests", () => {
  beforeEach(async () => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
  })

  it("should render link with href correctly", async () => {
    testSetup = await testRender(
      () => (
        <text>
          Visit <a href="https://opentui.com">opentui.com</a> for more info
        </text>
      ),
      {
        width: 50,
        height: 5,
      },
    )

    await testSetup.renderOnce()
    const frame = testSetup.captureCharFrame()

    expect(frame).toContain("Visit opentui.com for more info")
  })

  it("should render styled link with underline", async () => {
    testSetup = await testRender(
      () => (
        <text>
          <u>
            <a href="https://opentui.com" style={{ fg: "blue" }}>
              opentui.com
            </a>
          </u>
        </text>
      ),
      {
        width: 50,
        height: 5,
      },
    )

    await testSetup.renderOnce()
    const frame = testSetup.captureCharFrame()

    expect(frame).toContain("opentui.com")
  })

  it("should render link inside text with other elements", async () => {
    testSetup = await testRender(
      () => (
        <text>
          Check out <a href="https://github.com/anomalyco/opentui">GitHub</a> and{" "}
          <a href="https://opentui.com">our website</a>
        </text>
      ),
      {
        width: 60,
        height: 5,
      },
    )

    await testSetup.renderOnce()
    const frame = testSetup.captureCharFrame()

    expect(frame).toContain("GitHub")
    expect(frame).toContain("our website")
  })

  it("should inherit link from parent to nested styled span", async () => {
    testSetup = await testRender(
      () => (
        <text>
          <a href="https://opentui.com">
            <span style={{ fg: "blue", bold: true }}>styled text</span> default style
          </a>
        </text>
      ),
      {
        width: 60,
        height: 5,
      },
    )

    await testSetup.renderOnce()
    const frame = testSetup.captureCharFrame()

    // Both parts should be rendered
    expect(frame).toContain("styled text default style")
  })

  it("should inherit link from parent to multiple nested elements", async () => {
    testSetup = await testRender(
      () => (
        <text>
          Visit{" "}
          <a href="https://opentui.com">
            <b>our</b> <i>awesome</i> <u>website</u>
          </a>{" "}
          today
        </text>
      ),
      {
        width: 60,
        height: 5,
      },
    )

    await testSetup.renderOnce()
    const frame = testSetup.captureCharFrame()

    expect(frame).toContain("Visit our awesome website today")
  })

  it("should inherit link to deeply nested spans", async () => {
    testSetup = await testRender(
      () => (
        <text>
          <a href="https://example.com">
            <span style={{ fg: "red" }}>
              Level 1<span style={{ bg: "white" }}> Level 2</span>
            </span>
          </a>
        </text>
      ),
      {
        width: 60,
        height: 5,
      },
    )

    await testSetup.renderOnce()
    const frame = testSetup.captureCharFrame()

    expect(frame).toContain("Level 1 Level 2")
  })

  it("should handle mixed linked and non-linked text", async () => {
    testSetup = await testRender(
      () => (
        <text>
          Plain text <a href="https://example.com">linked text</a> more plain <a href="https://other.com">other link</a>
        </text>
      ),
      {
        width: 80,
        height: 5,
      },
    )

    await testSetup.renderOnce()
    const frame = testSetup.captureCharFrame()

    expect(frame).toContain("Plain text linked text more plain other link")
  })

  it("should preserve styles when inheriting link", async () => {
    testSetup = await testRender(
      () => (
        <text>
          <a href="https://opentui.com">
            <b>Bold</b> <i>Italic</i> <u>Underline</u> Normal
          </a>
        </text>
      ),
      {
        width: 80,
        height: 5,
      },
    )

    await testSetup.renderOnce()
    const frame = testSetup.captureCharFrame()

    expect(frame).toContain("Bold Italic Underline Normal")
  })

  it("should not override child link with parent link", async () => {
    testSetup = await testRender(
      () => (
        <text>
          <a href="https://parent.com">
            Parent link <a href="https://child.com">child link</a> parent again
          </a>
        </text>
      ),
      {
        width: 80,
        height: 5,
      },
    )

    await testSetup.renderOnce()
    const frame = testSetup.captureCharFrame()

    expect(frame).toContain("Parent link child link parent again")
  })

  it("should handle empty link content", async () => {
    testSetup = await testRender(
      () => (
        <text>
          Before <a href="https://example.com"></a> After
        </text>
      ),
      {
        width: 80,
        height: 5,
      },
    )

    await testSetup.renderOnce()
    const frame = testSetup.captureCharFrame()

    expect(frame).toContain("Before  After")
  })

  describe("Link Chunk Verification", () => {
    it("should create chunks with link for all nested content", async () => {
      testSetup = await testRender(
        () => (
          <text>
            <a href="https://opentui.com">
              <span style={{ fg: "blue" }}>styled</span> plain
            </a>
          </text>
        ),
        {
          width: 80,
          height: 5,
        },
      )

      await testSetup.renderOnce()
      const textRenderable = getTextRenderable(testSetup.renderer)
      const chunks = textRenderable.textNode.gatherWithInheritedStyle()

      // All chunks should have the link
      for (const chunk of chunks) {
        if (chunk.text.trim()) {
          // Skip empty chunks
          expect(chunk.link).toBeDefined()
          expect(chunk.link?.url).toBe("https://opentui.com")
        }
      }
    })

    it("should inherit link through multiple nesting levels", async () => {
      testSetup = await testRender(
        () => (
          <text>
            <a href="https://example.com">
              <b>
                <i>
                  <u>deeply nested</u>
                </i>
              </b>
            </a>
          </text>
        ),
        {
          width: 80,
          height: 5,
        },
      )

      await testSetup.renderOnce()
      const textRenderable = getTextRenderable(testSetup.renderer)
      const chunks = textRenderable.textNode.gatherWithInheritedStyle()

      // Find the chunk with text
      const textChunk = chunks.find((c) => c.text.includes("deeply nested"))
      expect(textChunk).toBeDefined()
      expect(textChunk?.link).toBeDefined()
      expect(textChunk?.link?.url).toBe("https://example.com")
    })

    it("should respect child link over parent link", async () => {
      testSetup = await testRender(
        () => (
          <text>
            <a href="https://parent.com">
              parent <a href="https://child.com">child</a> parent
            </a>
          </text>
        ),
        {
          width: 80,
          height: 5,
        },
      )

      await testSetup.renderOnce()
      const textRenderable = getTextRenderable(testSetup.renderer)
      const chunks = textRenderable.textNode.gatherWithInheritedStyle()

      // Find chunks
      const parentChunks = chunks.filter((c) => c.text.includes("parent"))
      const childChunk = chunks.find((c) => c.text.includes("child"))

      // Parent chunks should have parent link
      for (const chunk of parentChunks) {
        expect(chunk.link?.url).toBe("https://parent.com")
      }

      // Child chunk should have child link
      expect(childChunk?.link?.url).toBe("https://child.com")
    })

    it("should handle mixed styled content with inherited link", async () => {
      testSetup = await testRender(
        () => (
          <text>
            <a href="https://opentui.com">
              <b>Bold</b> <i>Italic</i> Plain
            </a>
          </text>
        ),
        {
          width: 80,
          height: 5,
        },
      )

      await testSetup.renderOnce()
      const textRenderable = getTextRenderable(testSetup.renderer)
      const chunks = textRenderable.textNode.gatherWithInheritedStyle()

      // All text chunks should have the same link
      const textChunks = chunks.filter((c) => c.text.trim().length > 0)
      expect(textChunks.length).toBeGreaterThan(0)

      for (const chunk of textChunks) {
        expect(chunk.link?.url).toBe("https://opentui.com")
      }
    })

    it("should only apply link to content within link element", async () => {
      testSetup = await testRender(
        () => (
          <text>
            before <a href="https://example.com">linked</a> after
          </text>
        ),
        {
          width: 80,
          height: 5,
        },
      )

      await testSetup.renderOnce()
      const textRenderable = getTextRenderable(testSetup.renderer)
      const chunks = textRenderable.textNode.gatherWithInheritedStyle()

      const beforeChunk = chunks.find((c) => c.text.includes("before"))
      const linkedChunk = chunks.find((c) => c.text.includes("linked"))
      const afterChunk = chunks.find((c) => c.text.includes("after"))

      // Only the linked chunk should have the link
      expect(beforeChunk?.link).toBeUndefined()
      expect(linkedChunk?.link?.url).toBe("https://example.com")
      expect(afterChunk?.link).toBeUndefined()
    })
  })
})
