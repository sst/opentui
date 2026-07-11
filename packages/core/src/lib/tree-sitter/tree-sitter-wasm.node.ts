import { resolveAssetPath } from "../../platform/assets.js"

const TREE_SITTER_WASM_KEY = "web-tree-sitter/tree-sitter.wasm"

export function resolveTreeSitterWasm(): Promise<string> {
  return Promise.resolve(
    resolveAssetPath(TREE_SITTER_WASM_KEY, () => new URL(import.meta.resolve(TREE_SITTER_WASM_KEY))),
  )
}
