import { resolveAssetPath } from "../../platform/assets.js"

const PARSER_WORKER_ASSET_KEY = "@opentui/core/parser.worker.js"

export function resolveDefaultTreeSitterWorkerPath(): string {
  return resolveAssetPath(PARSER_WORKER_ASSET_KEY, new URL("./parser.worker.js", import.meta.url))
}
