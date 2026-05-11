import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

import { resolveBundledFilePath } from "./runtime.js"

describe("platform/runtime", () => {
  test("does not evaluate fallback paths when Bun bundled file imports are available", async () => {
    const bundledUrl = new URL("./bundled-tree-sitter.wasm", import.meta.url).href
    let fallbackCalled = false

    const resolved = await resolveBundledFilePath(
      async () => ({ default: bundledUrl }),
      () => {
        fallbackCalled = true
        throw new Error("fallback should be lazy")
      },
      import.meta.url,
    )

    expect(resolved).toBe(fileURLToPath(bundledUrl))
    expect(fallbackCalled).toBe(false)
  })
})
