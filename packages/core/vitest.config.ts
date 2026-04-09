/**
 * Vitest is used to run tests under Node.js.
 * bun:test imports are replaced with Vitest in nodejs/compat.ts.
 */

import { basename, dirname, join } from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // globalSetup: "./src/nodejs/compat.ts",
    environment: "node",
    isolate: false,
    // alias: {
    //   "bun:ffi": "./src/nodejs/bunModules/ffi.ts",
    //   "bun:test": "./src/nodejs/bunModules/test.ts",
    // },
    execArgv: [
      // "--experimental-transform-types",
      // "--import=tsx",
      // "--import=@swc-node/register/esm",
      "--no-experimental-strip-types",
      "--experimental-transform-types",
      // "--import=esbuild-register/loader",
      "--import=./src/nodejs/compat.ts",
    ],
    experimental: {
      // Disable Vite bundling entirely so we exersize the nodejs/compat.ts shim.
      viteModuleRunner: false,
    },
    // Create independent snapshots from bun:test
    resolveSnapshotPath: (testPath, ext) =>
      join(dirname(testPath), "__snapshots__", `${basename(testPath)}.nodejs${ext}`),
  },
})
