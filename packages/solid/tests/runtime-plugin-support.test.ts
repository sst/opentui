import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { spawnSync } from "@opentui/core/compat/testHelpers"

const bunIt = process.versions.bun ? it : it.skip

describe("solid runtime plugin support", () => {
  bunIt("loads external TSX modules against host runtime modules", () => {
    const fixturePath = join(import.meta.dirname, "runtime-plugin-support.fixture.ts")
    const result = spawnSync([process.execPath, fixturePath], {
      cwd: join(import.meta.dirname, ".."),
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    })

    const stdout = result.stdout.toString().trim()

    expect(result.exitCode).toBe(0)
    expect(stdout).toContain("solid=true")
    expect(stdout).toContain("core=true")
    expect(stdout).toContain("coreTesting=true")
    expect(stdout).toContain("solidJs=true")
    expect(stdout).toContain("jsx=true")
  })
})
