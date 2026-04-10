// Node.js module resolution hook that redirects react-reconciler imports
// to local ESM shims, bridging API differences between 0.29 (React 18) and 0.32 (React 19).
import { pathToFileURL } from "node:url"
import { resolve as pathResolve } from "node:path"
import { fileURLToPath } from "node:url"

const dir = fileURLToPath(new URL(".", import.meta.url))

const shims = {
  "react-reconciler/constants.js": pathToFileURL(pathResolve(dir, "react-reconciler-constants-shim.mjs")).href,
  "react-reconciler/constants": pathToFileURL(pathResolve(dir, "react-reconciler-constants-shim.mjs")).href,
  "react-reconciler": pathToFileURL(pathResolve(dir, "react-reconciler-shim.mjs")).href,
}

export function resolve(specifier, context, nextResolve) {
  const shimUrl = shims[specifier]
  if (shimUrl) {
    return { url: shimUrl, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
