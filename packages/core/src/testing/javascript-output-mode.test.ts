import { describe, test, expect } from "bun:test"
import { PassThrough } from "stream"

import { CollectingStdout } from "./stdout-mocks"
import { createTestRenderer } from "./test-renderer"

describe("outputMode: 'javascript'", () => {
  test("setup and render flush native buffers", async () => {
    const stdout = new CollectingStdout()
    const stdin = new PassThrough()
    ;(stdin as any).isTTY = true

    const { renderer, renderOnce } = await createTestRenderer({
      outputMode: "javascript",
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      useAlternateScreen: false,
      useConsole: false,
      exitOnCtrlC: false,
    })

    try {
      await renderer.setupTerminal()
      expect(stdout.writes.length).toBeGreaterThan(0)

      stdout.clearWrites()
      await renderOnce()
      expect(stdout.writes.length).toBeGreaterThan(0)
    } finally {
      renderer.destroy()
      stdout.destroy()
      stdin.destroy()
    }
  })

  test("backpressure pauses rendering until drain", async () => {
    const stdout = new CollectingStdout()
    const stdin = new PassThrough()
    ;(stdin as any).isTTY = true

    const { renderer, renderOnce } = await createTestRenderer({
      outputMode: "javascript",
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      useAlternateScreen: false,
      useConsole: false,
      exitOnCtrlC: false,
    })

    try {
      await renderer.setupTerminal()
      stdout.clearWrites()
      stdout.forcedBackpressure = true

      await renderOnce()

      expect(stdout.writes.length).toBeGreaterThan(0)
      expect((renderer as any).outputStrategy.canRender()).toBe(false)

      stdout.forcedBackpressure = false
      stdout.emit("drain")
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect((renderer as any).outputStrategy.canRender()).toBe(true)
    } finally {
      renderer.destroy()
      stdout.destroy()
      stdin.destroy()
    }
  })
})
