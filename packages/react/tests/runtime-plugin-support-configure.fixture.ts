import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { plugin as registerPlugin } from "bun"
import { ensureRuntimePluginSupport } from "../scripts/runtime-plugin-support-configure.js"

const tempRoot = mkdtempSync(join(tmpdir(), "react-runtime-plugin-support-configure-fixture-"))
const entryPath = join(tempRoot, "entry.ts")

const source = [
  'import { marker } from "runtime-plugin-support-extra"',
  'import { useState } from "react"',
  "console.log(`extra=${marker};react=${typeof useState === 'function'}`)",
  "export const noop = 1",
].join("\n")

writeFileSync(entryPath, source)

registerPlugin.clearAll()

try {
  const additional = {
    "runtime-plugin-support-extra": { marker: "ok" },
  }
  const first = ensureRuntimePluginSupport({ additional })
  const second = ensureRuntimePluginSupport({ additional })
  console.log(`first=${first};second=${second}`)
  await import(entryPath)
} finally {
  registerPlugin.clearAll()
  rmSync(tempRoot, { recursive: true, force: true })
}
