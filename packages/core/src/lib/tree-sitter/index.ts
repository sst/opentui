export { TreeSitterClient } from "./client"
export { treeSitterToStyledText } from "../tree-sitter-styled-text"
export { SyntaxStyle } from "../syntax-style"
export type {
  HighlightRange,
  HighlightResponse,
  FiletypeParserOptions,
  BufferState,
  ParsedBuffer,
  TreeSitterClientEvents,
  TreeSitterClientOptions,
  Edit,
  PerformanceStats,
} from "./types"
export type { StyleDefinition } from "../syntax-style"

import { singleton } from "../singleton"
import { TreeSitterClient } from "./client"
import type { TreeSitterClientOptions } from "./types"
import { tmpdir } from "os"
import { join } from "path"

export function getTreeSitterClient(): TreeSitterClient {
  const defaultOptions: TreeSitterClientOptions = {
    dataPath: join(tmpdir(), "opentui-tree-sitter"),
  }

  return singleton("tree-sitter-client", () => new TreeSitterClient(defaultOptions))
}
