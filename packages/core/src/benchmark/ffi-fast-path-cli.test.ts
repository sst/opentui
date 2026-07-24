import { afterEach, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

test.each(["", "."])("stress output %p does not remove its package directory", (output) => {
  const root = mkdtempSync(join(tmpdir(), "opentui-ffi-stress-test-"))
  temporaryDirectories.push(root)
  const packageRoot = join(root, "packages/core")
  const benchmarkDir = join(packageRoot, "src/benchmark")
  const script = join(benchmarkDir, "ffi-fast-path-stress.ts")
  const sentinel = join(packageRoot, "sentinel.txt")
  mkdirSync(benchmarkDir, { recursive: true })
  cpSync(join(import.meta.dir, "ffi-fast-path-stress.ts"), script)
  writeFileSync(sentinel, "keep")

  const child = spawnSync(process.execPath, [script, `--output=${output}`], {
    cwd: packageRoot,
    encoding: "utf8",
    timeout: 10_000,
  })

  expect(child.status).not.toBe(0)
  expect(existsSync(sentinel)).toBe(true)
})
