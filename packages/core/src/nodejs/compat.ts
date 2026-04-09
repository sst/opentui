import * as mod from "node:module"
import { fileURLToPath } from "node:url"
import { Worker as NodeWorker, isMainThread, parentPort } from "node:worker_threads"

const require = mod.createRequire(import.meta.url)

/**
 * Wraps node:worker_threads Worker to match the Web Worker API surface
 * used by this project (constructor with URL string, .onmessage, .onerror,
 * .postMessage, .terminate).
 */
class WebWorkerShim extends NodeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null

  constructor(url: string | URL) {
    const resolved = typeof url === "string" && url.startsWith("file://") ? new URL(url) : url
    super(resolved, { execArgv: [...process.execArgv, `--import=${import.meta.url}`] })
    this.on("message", (data: unknown) => {
      this.onmessage?.({ data })
    })
    this.on("error", (error: Error) => {
      this.onerror?.({ message: error.message })
    })
  }
}

/**
 * Sets up Bun shims in a Node.js process.
 */
export function setup() {
  Object.defineProperty(globalThis, "Bun", {
    configurable: true,
    enumerable: true,
    get: () => require("./NodeBun.js").default,
  })

  if (globalThis.Worker === undefined) {
    ;(globalThis as any).Worker = WebWorkerShim
  }

  // Inside a worker thread, bridge Web Worker messaging API to parentPort
  if (!isMainThread && parentPort) {
    ;(globalThis as any).postMessage = (msg: unknown) => parentPort!.postMessage(msg)
    Object.defineProperty(globalThis, "onmessage", {
      configurable: true,
      set(handler: ((event: { data: unknown }) => void) | null) {
        parentPort!.removeAllListeners("message")
        if (handler) {
          parentPort!.on("message", (data: unknown) => handler({ data }))
        }
      },
    })
  }

  mod.registerHooks({ resolve: resolveBun, load: loadBun })
  mod.registerHooks({ resolve: resolveJsToTs })
}

const BUN_PREFIX = "bun:"

const resolveBun: mod.ResolveHookSync = (request, context, next) => {
  if (request.startsWith(BUN_PREFIX) || request === "bun") {
    const name = request === "bun" ? "bun" : request.slice(BUN_PREFIX.length)
    const extname = import.meta.url.split(".").pop()
    const result = next(`./bunModules/${name}.${extname}`, {
      parentURL: import.meta.url,
      importAttributes: {
        type: "commonjs",
      },
    })
    return result
  }

  return next(request, context)
}

const loadBun: mod.LoadHookSync = (url, context, next) => {
  if (context.importAttributes?.type === "file" || context.importAttributes?.type === "wasm") {
    // Bun's `import ... with { type: "file" }` returns the absolute file path.
    // Convert file:// URL to a path to match.
    const filePath = url.startsWith("file://") ? fileURLToPath(url) : url
    return {
      shortCircuit: true,
      format: "json",
      source: JSON.stringify(filePath),
    }
  }

  const result = next(url, context)
  if (result.source === undefined) {
    return { ...result, shortCircuit: true }
  }
  return result
}

const JS_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs"]
const TS_REPLACEMENTS: Record<string, string> = {
  ".js": ".ts",
  ".jsx": ".tsx",
  ".mjs": ".mts",
  ".cjs": ".cts",
}

const resolveJsToTs: mod.ResolveHookSync = (request, context, next) => {
  // Only rewrite relative imports
  if (!request.startsWith(".")) return next(request, context)

  const ext = JS_EXTENSIONS.find((e) => request.endsWith(e))
  if (!ext) return next(request, context)

  // Try the original .js first
  try {
    return next(request, context)
  } catch {
    // Fall through to .ts attempt
  }

  const tsRequest = request.slice(0, -ext.length) + TS_REPLACEMENTS[ext]
  return next(tsRequest, context)
}

setup()
