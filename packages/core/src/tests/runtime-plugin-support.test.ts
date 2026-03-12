import { describe, expect, it } from "bun:test"
import { join } from "node:path"

describe("runtime plugin support", () => {
  it("installs exactly once via drop-in module", () => {
    const fixturePath = join(import.meta.dir, "runtime-plugin-support.fixture.ts")
    const result = Bun.spawnSync([process.execPath, fixturePath], {
      cwd: join(import.meta.dir, "..", ".."),
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    })

    const stdout = result.stdout.toString().trim()
    const stderr = result.stderr.toString().trim()

    if (stdout) {
      console.debug(`[runtime-plugin-support.fixture] stdout:\n${stdout}`)
    }

    if (stderr) {
      console.debug(`[runtime-plugin-support.fixture] stderr:\n${stderr}`)
    }

    expect(result.exitCode).toBe(0)
    expect(stdout).toContain("idempotent=true")
  })
})
