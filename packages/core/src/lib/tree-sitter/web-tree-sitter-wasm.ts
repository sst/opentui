type WebTreeSitterWasmModule = {
  default: string
}

type ResolveModuleSpecifier = (specifier: string) => string

export async function importWebTreeSitterWasm(): Promise<WebTreeSitterWasmModule> {
  try {
    return await import("web-tree-sitter/web-tree-sitter.wasm" as string, { with: { type: "wasm" } })
  } catch {
    return import("web-tree-sitter/tree-sitter.wasm" as string, { with: { type: "wasm" } })
  }
}

export function resolveWebTreeSitterWasmPath(
  resolveModule: ResolveModuleSpecifier = (specifier) => import.meta.resolve(specifier),
): string {
  try {
    return resolveModule("web-tree-sitter/web-tree-sitter.wasm")
  } catch {
    return resolveModule("web-tree-sitter/tree-sitter.wasm")
  }
}
