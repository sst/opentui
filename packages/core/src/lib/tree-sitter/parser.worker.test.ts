import { describe, expect, test } from "bun:test"

import { resolveWebTreeSitterWasmPath } from "./web-tree-sitter-wasm.js"

describe("parser worker web-tree-sitter wasm resolution", () => {
  test("prefers the web-tree-sitter 0.26 wasm filename", () => {
    const resolvedSpecifiers: string[] = []

    const resolved = resolveWebTreeSitterWasmPath((specifier) => {
      resolvedSpecifiers.push(specifier)
      return `/node_modules/${specifier}`
    })

    expect(resolved).toBe("/node_modules/web-tree-sitter/web-tree-sitter.wasm")
    expect(resolvedSpecifiers).toEqual(["web-tree-sitter/web-tree-sitter.wasm"])
  })

  test("falls back to the web-tree-sitter 0.25 wasm filename", () => {
    const resolvedSpecifiers: string[] = []

    const resolved = resolveWebTreeSitterWasmPath((specifier) => {
      resolvedSpecifiers.push(specifier)
      if (specifier === "web-tree-sitter/web-tree-sitter.wasm") {
        throw new Error("new wasm filename is not exported")
      }

      return `/node_modules/${specifier}`
    })

    expect(resolved).toBe("/node_modules/web-tree-sitter/tree-sitter.wasm")
    expect(resolvedSpecifiers).toEqual(["web-tree-sitter/web-tree-sitter.wasm", "web-tree-sitter/tree-sitter.wasm"])
  })
})
