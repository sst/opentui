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
import { getDataPaths } from "../data-paths"

export function getTreeSitterClient(): TreeSitterClient {
  const dataPathsManager = getDataPaths()
  const defaultOptions: TreeSitterClientOptions = {
    dataPath: dataPathsManager.globalDataPath,
  }

  return singleton("tree-sitter-client", () => {
    const client = new TreeSitterClient(defaultOptions)

    dataPathsManager.on("paths:changed", (paths) => {
      client.setDataPath(paths.globalDataPath)
    })

    return client
  })
}
