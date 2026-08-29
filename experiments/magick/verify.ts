import { closeSync, openSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"

const root = resolve(import.meta.dir, "../..")
const output = resolve(root, "experiments/magick/results/verification")
await mkdir(output, { recursive: true })
const steps = [
  { name: "native", cwd: "packages/core", command: ["bun", "run", "test:native", "-j2"] },
  { name: "bun", cwd: "packages/core", command: ["bun", "run", "test:js"] },
  { name: "node", cwd: "packages/core", command: ["bun", "run", "test:js:node"] },
  { name: "distribution", cwd: "packages/core", command: ["bun", "run", "test:dist", "--skip-build"] },
  { name: "gpu-three", cwd: "packages/three", command: ["bun", "test", "src/canvas.test.ts"] },
  { name: "gpu-examples", cwd: "packages/examples", command: ["bun", "test", "src/magick"] },
  {
    name: "examples-types",
    cwd: ".",
    command: [
      "bun",
      "packages/core/node_modules/typescript/bin/tsc",
      "--noEmit",
      "-p",
      "packages/examples/src/magick/tsconfig.json",
    ],
  },
  {
    name: "sharing",
    cwd: "experiments/magick/gpu-sharing",
    command: ["make", "verify", "three-verify", `WEBGPU_NODE_MODULES=${root}/packages/examples/node_modules`],
  },
  { name: "format", cwd: ".", command: ["bun", "run", "fmt:check"] },
  { name: "lint", cwd: ".", command: ["bun", "run", "lint"] },
]
const results: Record<string, unknown>[] = []
// The Bun and Node suites share test ports. Do not run them or GPU measurements together.
for (const step of steps) {
  process.stderr.write(`Checking ${step.name}\n`)
  const path = resolve(output, `${step.name}.log`)
  const fd = openSync(path, "w")
  const start = performance.now()
  let exitCode: number
  try {
    const child = Bun.spawn(step.command, {
      cwd: resolve(root, step.cwd),
      stdin: "ignore",
      stdout: fd,
      stderr: fd,
      timeout: 600_000,
      env: {
        ...process.env,
        GPU_TESTS: "1",
        TERMINAL_TESTS: "1",
        MAGICK_ARENA_MODULE: `${root}/packages/examples/src/magick/arena.ts`,
      },
    })
    exitCode = await child.exited
  } finally {
    closeSync(fd)
  }
  const text = (await Bun.file(path).text()).replace(/\x1b\[[0-9;]*m/g, "")
  results.push({
    name: step.name,
    command: step.command,
    cwd: step.cwd,
    exitCode,
    seconds: (performance.now() - start) / 1000,
    tail: text.trim().split("\n").slice(-8),
  })
  await Bun.write(resolve(output, "index.json"), JSON.stringify(results, null, 2) + "\n")
  const formatted = Bun.spawnSync(["bunx", "oxfmt", "--write", resolve(output, "index.json")], { cwd: root })
  if (formatted.exitCode !== 0) throw new Error("Could not format the verification report")
  if (exitCode !== 0) throw new Error(`${step.name} failed. Read ${path}`)
}
process.stderr.write(`All ${steps.length} verification steps passed\n`)
