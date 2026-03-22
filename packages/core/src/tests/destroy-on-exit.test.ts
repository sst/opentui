import { describe, expect, it } from "bun:test"
import { join } from "node:path"

const fixturePath = join(import.meta.dir, "destroy-on-exit.fixture.ts")

const runFixture = (code: number) => {
  const result = Bun.spawnSync([process.execPath, fixturePath, code.toString()], {
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })

  const stdout = result.stdout.toString()
  const stderr = result.stderr.toString()

  console.debug(`[destroy-on-exit] exit=${result.exitCode}`)
  if (stdout.trim()) {
    console.debug(`[destroy-on-exit] stdout:\n${stdout.trimEnd()}`)
  }
  if (stderr.trim()) {
    console.debug(`[destroy-on-exit] stderr:\n${stderr.trimEnd()}`)
  }

  return { result, stdout, stderr }
}

describe("destroy on process exit", () => {
  it("it should destroy renderer when the process is manually terminated", () => {
    const { result } = runFixture(0)

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toInclude("renderer destroyed")
  })

  it("it should destroy renderer when the process is manually terminated with non-zero code", () => {
    const { result } = runFixture(1)

    expect(result.exitCode).toBe(1)
    expect(result.stdout.toString()).toInclude("renderer destroyed")
  })
})
