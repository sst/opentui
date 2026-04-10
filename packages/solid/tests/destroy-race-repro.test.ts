import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { spawnSync } from "@opentui/core/compat/testHelpers"

const fixturePath = join(import.meta.dirname, "destroy-race.fixture.tsx")
const bunIt = process.versions.bun ? it : it.skip

type Mode = "external" | "helper" | "external-onmount" | "helper-onmount" | "external-active" | "helper-active"

const runFixture = (mode: Mode) => {
  const result = spawnSync([process.execPath, fixturePath, mode], {
    cwd: join(import.meta.dirname, ".."),
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })

  const stdout = result.stdout.toString()

  return { result, stdout }
}

describe("destroy race regressions", () => {
  bunIt("does not crash when renderer is destroyed during initial render (external renderer path)", () => {
    const { result } = runFixture("external")

    expect(result.exitCode).toBe(0)
  })

  bunIt("does not crash when renderer is destroyed during initial render (testRender helper path)", () => {
    const { result } = runFixture("helper")

    expect(result.exitCode).toBe(0)
  })

  bunIt("does not crash when renderer is destroyed from onMount (external renderer path)", () => {
    const { result } = runFixture("external-onmount")

    expect(result.exitCode).toBe(0)
  })

  bunIt("does not crash when renderer is destroyed from onMount (testRender helper path)", () => {
    const { result } = runFixture("helper-onmount")

    expect(result.exitCode).toBe(0)
  })

  bunIt("does not crash when renderer is destroyed in an active render pass (external renderer path)", () => {
    const { result } = runFixture("external-active")

    expect(result.exitCode).toBe(0)
  })

  bunIt("does not crash when renderer is destroyed in an active render pass (testRender helper path)", () => {
    const { result } = runFixture("helper-active")

    expect(result.exitCode).toBe(0)
  })
})
