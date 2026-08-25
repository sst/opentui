import { describe, expect, it, spyOn } from "bun:test"
import { testRender } from "../src/test-utils.js"

describe("React test utilities", () => {
  it("renders a static component without an act warning", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {})
    const setup = await testRender(<text>hello</text>, { width: 80, height: 24 })

    try {
      await setup.renderOnce()
      expect(setup.captureCharFrame()).toContain("hello")
      setup.renderer.destroy()
      await Promise.resolve()
      expect(consoleError.mock.calls.flat().join("\n")).not.toContain("was not wrapped in act")
    } finally {
      setup.renderer.destroy()
      consoleError.mockRestore()
    }
  })
})
