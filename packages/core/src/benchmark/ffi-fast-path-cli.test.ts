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

test("comparison rejects repeated report files as independent rounds", () => {
  const root = mkdtempSync(join(tmpdir(), "opentui-ffi-compare-test-"))
  temporaryDirectories.push(root)
  const baseline = join(root, "baseline.json")
  const candidate = join(root, "candidate.json")
  writeReport(baseline, 100, 100)
  writeReport(candidate, 100, 80)
  const repeatedBaseline = Array(9).fill(baseline).join(",")
  const repeatedCandidate = Array(9).fill(candidate).join(",")

  const child = spawnSync(
    process.execPath,
    [join(import.meta.dir, "ffi-fast-path-compare.ts"), repeatedBaseline, repeatedCandidate, "--no-output"],
    { encoding: "utf8", timeout: 10_000 },
  )

  expect(child.status).not.toBe(0)
  expect(child.stderr).toContain("duplicate report path")
})

function writeReport(path: string, bunNsPerOp: number, nodeNsPerOp: number, rounds = 1): void {
  const samples = (nsPerOp: number) => Array.from({ length: rounds }, () => ({ nsPerOp }))
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: 1,
      benchmark: "opentui-ffi-fast-path",
      runId: path,
      suite: "default",
      environment: {
        bun: { name: "bun", version: "1.3.14", platform: "darwin", arch: "arm64" },
        node: { name: "node", version: "v26.4.0", platform: "darwin", arch: "arm64" },
      },
      results: [
        {
          name: "scenario",
          rawProcessRounds: { bun: samples(bunNsPerOp), node: samples(nodeNsPerOp) },
        },
      ],
    }),
  )
}
