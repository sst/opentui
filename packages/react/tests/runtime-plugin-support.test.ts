import { describe, expect, it } from "bun:test"
import { join } from "node:path"

describe("react runtime plugin support", () => {
  it("loads external modules against host runtime exports", () => {
    const fixturePath = join(import.meta.dir, "runtime-plugin-support.fixture.ts")
    const result = Bun.spawnSync([process.execPath, fixturePath], {
      cwd: join(import.meta.dir, ".."),
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
