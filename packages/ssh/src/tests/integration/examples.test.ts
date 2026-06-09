import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const packageRoot = new URL("../../..", import.meta.url).pathname
for (const [name, entrypoint, extraArgs] of [
  ["React", "examples/react.tsx", []],
  ["Solid", "examples/solid.tsx", ["--jsx-import-source", "@opentui/solid"]],
] as const) {
  test(`${name} example compiles`, () => {
    const outdir = mkdtempSync(join(tmpdir(), `opentui-ssh-${name.toLowerCase()}-`))
    try {
      const result = Bun.spawnSync(["bun", "build", entrypoint, "--target", "bun", "--outdir", outdir, ...extraArgs], {
        cwd: packageRoot,
        stdout: "pipe",
        stderr: "pipe",
      })
      expect(result.exitCode, result.stderr.toString()).toBe(0)
    } finally {
      rmSync(outdir, { recursive: true, force: true })
    }
  })
}
