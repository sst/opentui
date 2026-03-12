import { singleton } from "../singleton.js"
import { TreeSitterClient } from "./client.js"
import type { TreeSitterClientOptions } from "./types.js"
import { getDataPaths } from "../data-paths.js"

export * from "./client.js"
export * from "../tree-sitter-styled-text.js"
export * from "./types.js"
export * from "./resolve-ft.js"
export type { UpdateOptions } from "./assets/update.js"
export { updateAssets } from "./assets/update.js"

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
