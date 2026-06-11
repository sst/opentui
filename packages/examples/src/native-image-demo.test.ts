import { afterEach, describe, expect, test } from "bun:test"
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing"
import { destroy, run } from "./native-image-demo.js"

describe("native image demo", () => {
  let setup: TestRendererSetup | null = null

  afterEach(() => {
    if (!setup) return
    destroy(setup.renderer)
    setup.renderer.destroy()
    setup = null
  })

  test("loads every format, renders previews, and updates display controls", async () => {
    setup = await createTestRenderer({ width: 120, height: 32 })
    await run(setup.renderer)

    const frame = await setup.waitForFrame(
      (value) => ["PNG", "JPEG", "WEBP", "GIF"].every((format) => value.includes(format)),
      { maxPasses: 40 },
    )
    expect(frame).toContain("NATIVE IMAGE LAB")
    expect(frame).toContain("filesystem path")
    expect(frame).toContain("file: URL")
    expect(frame).toContain("Uint8Array")
    expect(frame).toContain("HTTP response")
    expect([...frame].filter((char) => "▀▄▌▐▖▗▘▝▚▞▙▛▜▟█".includes(char)).length).toBeGreaterThan(100)

    setup.mockInput.pressKey("f")
    await setup.flush()
    const updated = setup.captureCharFrame()
    expect(updated).toContain("COVER")
    expect(updated).toContain("KITTY → SIXEL → BLOCKS")
  })
})
