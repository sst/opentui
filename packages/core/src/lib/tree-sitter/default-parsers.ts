import type { FiletypeParserOptions } from "./types"

export const DEFAULT_PARSERS: FiletypeParserOptions[] = [
  {
    filetype: "javascript",
    queries: {
      highlights: [
        "https://raw.githubusercontent.com/tree-sitter/tree-sitter-javascript/refs/heads/master/queries/highlights.scm",
      ],
    },
    language:
      "https://github.com/tree-sitter/tree-sitter-javascript/releases/download/v0.25.0/tree-sitter-javascript.wasm",
  },
  {
    filetype: "typescript",
    queries: {
      highlights: [
        "https://raw.githubusercontent.com/tree-sitter/tree-sitter-javascript/refs/heads/master/queries/highlights.scm",
        "https://raw.githubusercontent.com/tree-sitter/tree-sitter-typescript/refs/heads/master/queries/highlights.scm",
      ],
    },
    language:
      "https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v0.23.2/tree-sitter-typescript.wasm",
  },
]
