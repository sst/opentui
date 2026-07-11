import { resolveBundledFilePath } from "../../platform/runtime.js"
import { resolveAssetPath } from "../../platform/assets.js"

const PARSER_WORKER_ASSET_KEY = "@opentui/core/parser.worker.js"

const bundledTreeSitterWorkerPath = await resolveBundledFilePath(
  PARSER_WORKER_ASSET_KEY,
  () => import("@opentui/core/parser.worker" as string, { with: { type: "file" } }),
  new URL("./parser.worker.js", import.meta.url),
  import.meta.url,
  false,
)

export function resolveDefaultTreeSitterWorkerPath(): string {
  return resolveAssetPath(PARSER_WORKER_ASSET_KEY, bundledTreeSitterWorkerPath)
}
