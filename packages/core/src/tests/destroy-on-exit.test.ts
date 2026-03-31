import { describe, expect, it } from "bun:test"
import { join } from "node:path"

const fixturePath = join(import.meta.dir, "destroy-on-exit.fixture.ts")

const runFixture = (code: number, mode: "idle" | "during-render" = "idle") => {
  const result = Bun.spawnSync([process.execPath, fixturePath, code.toString(), mode], {
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
  it("it should let applications restore terminal state in an exit handler", () => {
    const { result, stdout } = runFixture(0)

    expect(result.exitCode).toBe(0)
    expect(stdout).toInclude("raw mode disabled")
  })

  it("it should restore terminal state for non-zero exit codes", () => {
    const { result, stdout } = runFixture(1)

    expect(result.exitCode).toBe(1)
    expect(stdout).toInclude("raw mode disabled")
  })

  it("it should suspend the renderer when destroy happens during an active frame in an exit handler", () => {
    const { result, stdout } = runFixture(0, "during-render")

    expect(result.exitCode).toBe(0)
    expect(stdout).toInclude("raw mode disabled")
    expect(stdout).toInclude("renderer suspended")
  })
})
