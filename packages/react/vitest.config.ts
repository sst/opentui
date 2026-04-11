import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "bun:test": fileURLToPath(new URL("../core/src/compat/test.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    resolveSnapshotPath: (testPath, ext) =>
      join(dirname(testPath), "__snapshots__", `${basename(testPath)}.nodejs${ext}`),
    exclude: ["node_modules/**", "dist-test/**"],
  },
})
