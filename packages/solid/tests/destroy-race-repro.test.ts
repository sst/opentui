import { describe, expect, it } from "bun:test"
import { join } from "node:path"

const fixturePath = join(import.meta.dir, "destroy-race.fixture.tsx")

const runFixture = (mode: "external" | "helper") => {
  const result = Bun.spawnSync([process.execPath, fixturePath, mode], {
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })

  const stdout = result.stdout.toString()
  const stderr = result.stderr.toString()

  console.debug(`[destroy-race-repro ${mode}] exit=${result.exitCode}`)
  if (stdout.trim()) {
    console.debug(`[destroy-race-repro ${mode}] stdout:\n${stdout.trimEnd()}`)
  }
  if (stderr.trim()) {
    console.debug(`[destroy-race-repro ${mode}] stderr:\n${stderr.trimEnd()}`)
  }

  return { result, stdout, stderr }
}

describe("destroy race regressions", () => {
  it("does not crash when renderer is destroyed during initial render (external renderer path)", () => {
    const { result } = runFixture("external")

    expect(result.exitCode).toBe(0)
  })

  it("does not crash when renderer is destroyed during initial render (testRender helper path)", () => {
    const { result } = runFixture("helper")

    expect(result.exitCode).toBe(0)
  })
})
