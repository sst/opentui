import { resolveBundledFilePath } from "../../platform/runtime.js"

const TREE_SITTER_WASM_KEY = "web-tree-sitter/tree-sitter.wasm"

export function resolveTreeSitterWasm(): Promise<string> {
  return resolveBundledFilePath(
    TREE_SITTER_WASM_KEY,
    () => import("web-tree-sitter/tree-sitter.wasm" as string, { with: { type: "wasm" } }),
    () => import.meta.resolve(TREE_SITTER_WASM_KEY),
    import.meta.url,
  )
}
