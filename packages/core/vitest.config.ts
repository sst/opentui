/**
 * Vitest is used to run tests under Node.js.
 * Tests import `bun:test`, which is aliased to the Vitest adapter here.
 */

import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "bun:test": fileURLToPath(new URL("./src/compat/test.ts", import.meta.url)),
    },
    external: true,
  },
  test: {
    environment: "node",
    resolveSnapshotPath: (testPath, ext) =>
      join(dirname(testPath), "__snapshots__", `${basename(testPath)}.nodejs${ext}`),
    root: "src",
  },
})
