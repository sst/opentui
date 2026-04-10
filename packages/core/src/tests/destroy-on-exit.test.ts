import { describe, expect, it } from "bun:test"
import { spawnSync } from "../compat/testHelpers.js"
import { join } from "node:path"

const fixturePath = join(import.meta.dirname, "destroy-on-exit.fixture.ts")
const supportedDescribe = process.versions.bun ? describe : describe.skip

const runFixture = (code: number, mode: "idle" | "during-render" = "idle") => {
  const result = spawnSync([process.execPath, fixturePath, code.toString(), mode], {
    cwd: join(import.meta.dirname, ".."),
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })

  const stdout = result.stdout.toString()

  return { result, stdout }
}

supportedDescribe("destroy on process exit", () => {
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
