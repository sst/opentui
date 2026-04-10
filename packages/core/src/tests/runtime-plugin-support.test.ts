import { describe, expect, it } from "bun:test"
import { spawnSync } from "../compat/testHelpers.js"
import { join } from "node:path"

// Fixtures require `import { plugin } from "bun"` — no Node.js equivalent.
const _describe = process.versions.bun ? describe : describe.skip

_describe("runtime plugin support", () => {
  it("installs exactly once via drop-in module", () => {
    const fixturePath = join(import.meta.dirname, "runtime-plugin-support.fixture.ts")
    const result = spawnSync([process.execPath, fixturePath], {
      cwd: join(import.meta.dirname, "..", ".."),
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    })

    const stdout = result.stdout.toString().trim()

    expect(result.exitCode).toBe(0)
    expect(stdout).toContain("idempotent=true")
  })
})
