import { test, expect, describe } from "bun:test"
import { createTestRenderer } from "../testing/test-renderer"

// NOTE: These tests are not running the mouse activation sequences,
// only verifying that the configuration is applied correctly.
// Tests avoid actually outputting to the terminal during test runs,
// to not mess up the terminal state.
// What actually gets written can be tested properly when
// https://github.com/anomalyco/opentui/pull/238 is merged.
describe("useMouse configuration", () => {
  test("useMouse: true sets renderer.useMouse to true", async () => {
    const { renderer } = await createTestRenderer({
      useMouse: true,
      exitOnCtrlC: false,
      useAlternateScreen: false,
    })

    expect(renderer.useMouse).toBe(true)
    renderer.destroy()
  })

  test("useMouse: false disables mouse tracking", async () => {
    const { renderer } = await createTestRenderer({
      useMouse: false,
      exitOnCtrlC: false,
      useAlternateScreen: false,
    })

    expect(renderer.useMouse).toBe(false)
    renderer.destroy()
  })

  test("toggling useMouse property updates renderer state", async () => {
    const { renderer } = await createTestRenderer({
      useMouse: false,
      exitOnCtrlC: false,
      useAlternateScreen: false,
    })

    expect(renderer.useMouse).toBe(false)

    renderer.useMouse = true
    expect(renderer.useMouse).toBe(true)

    renderer.useMouse = false
    expect(renderer.useMouse).toBe(false)

    renderer.destroy()
  })
})
