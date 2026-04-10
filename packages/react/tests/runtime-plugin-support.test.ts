import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { spawnSync } from "@opentui/core/compat/testHelpers"

const bunIt = process.versions.bun ? it : it.skip

describe("react runtime plugin support", () => {
  bunIt("loads external modules against host runtime exports", () => {
    const fixturePath = join(import.meta.dirname, "runtime-plugin-support.fixture.ts")
    const result = spawnSync([process.execPath, fixturePath], {
      cwd: join(import.meta.dirname, ".."),
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    })

    const stdout = result.stdout.toString().trim()

    expect(result.exitCode).toBe(0)
    expect(stdout).toContain("core=true")
    expect(stdout).toContain("coreTesting=true")
    expect(stdout).toContain("opentuiReact=true")
    expect(stdout).toContain("opentuiReactJsx=true")
    expect(stdout).toContain("opentuiReactJsxDev=true")
    expect(stdout).toContain("react=true")
    expect(stdout).toContain("reactJsx=true")
    expect(stdout).toContain("reactJsxDev=true")
  })
})
