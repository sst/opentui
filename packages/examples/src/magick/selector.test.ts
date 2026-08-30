import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { EmbeddedTerminalRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"

test.skipIf(process.env.TERMINAL_TESTS !== "1" || process.platform !== "linux").each([false, true])(
  "Magick diagnostics and terminal cleanup (standalone=%p)",
  async (standalone) => {
    const setup = await createTestRenderer({ width: 80, height: 24 })
    const terminal = new EmbeddedTerminalRenderable(setup.renderer, { width: 80, height: 24 })
    setup.renderer.root.add(terminal)
    const entry = fileURLToPath(new URL(standalone ? "./demo.ts" : "../index.ts", import.meta.url))
    const command = ["bun", entry, ...(standalone ? ["--width=65", "--height=33"] : [])]
      .map((argument) => `'${argument.replaceAll("'", "'\\''")}'`)
      .join(" ")
    const child = Bun.spawn(["script", "--return", "--quiet", "--command", command, "/dev/null"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20_000,
    })
    const steps = standalone
      ? [
          ["Running", "c"],
          ["Console", "` "],
          ["Paused", "\x03"],
        ]
      : [
          ["Filter examples", "magick"],
          ["Magick Arena", "\r"],
          ["Running", "c"],
          ["Console", "` "],
          ["Paused", "\x1b"],
          ["Filter examples", "magick"],
          ["Magick Arena", "\r"],
          ["Running", "\x1b"],
          ["Filter examples", "\x03"],
        ]
    let step = 0
    let output = ""
    const decoder = new TextDecoder()
    const reader = child.stdout.getReader()
    const error = new Response(child.stderr).text()
    try {
      while (true) {
        const { value: chunk, done } = await reader.read()
        if (done) break
        output = (output + decoder.decode(chunk, { stream: true })).slice(-65_536)
        terminal.write(chunk)
        await setup.renderOnce()
        const text = terminal.screen().text
        if (step < steps.length && text.includes(steps[step][0])) {
          child.stdin.write(steps[step][1])
          child.stdin.flush()
          step++
          output = ""
        }
      }
      expect(step, terminal.screen().text).toBe(steps.length)
      expect(await child.exited, await error).toBe(0)
      expect(output).toContain("\x1b[?25h")
      expect(output).toContain("\x1b[?1049l")
    } finally {
      reader.releaseLock()
      child.kill()
      await child.exited
      setup.renderer.destroy()
    }
  },
  25_000,
)
