import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"

// Regression test for Linux threaded renderer startup through Bun FFI.
// We run this in a child process because historical failures were process-level
// crashes/hangs when enabling `setUseThread(true)` in a dlopened native lib.
// The test verifies the full lifecycle (create -> enable threads -> render -> destroy)
// and fails if Bun exits non-zero or times out.
test("linux ffi renderer can enable threading and shut down", () => {
  if (process.platform !== "linux") {
    return
  }

  if (process.arch !== "x64" && process.arch !== "arm64") {
    return
  }

  const script = `
const nativeModule = await import("@opentui/core-${process.platform}-${process.arch}/index.ts")
const { dlopen } = await import("bun:ffi")

const lib = dlopen(nativeModule.default, {
  createRenderer: { args: ["u32", "u32", "bool", "bool"], returns: "ptr" },
  setUseThread: { args: ["ptr", "bool"], returns: "void" },
  render: { args: ["ptr", "bool"], returns: "void" },
  destroyRenderer: { args: ["ptr"], returns: "void" },
})

const renderer = lib.symbols.createRenderer(20, 8, true, true)
if (!renderer) {
  throw new Error("createRenderer returned null")
}

lib.symbols.setUseThread(renderer, true)

for (let i = 0; i < 20; i++) {
  lib.symbols.render(renderer, false)
}

lib.symbols.destroyRenderer(renderer)
`

  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 15_000,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(
      `threading child process failed (status=${result.status}, signal=${result.signal})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    )
  }

  expect(result.status).toBe(0)
})
