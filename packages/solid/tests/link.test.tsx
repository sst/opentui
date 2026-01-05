import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../index"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("Link Rendering Tests", () => {
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
})
