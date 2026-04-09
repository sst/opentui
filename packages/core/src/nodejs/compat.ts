import * as mod from "node:module"

const require = mod.createRequire(import.meta.url)

/**
 * Sets up Bun shims in a Node.js process.
 */
export function setup() {
  Object.defineProperty(globalThis, "Bun", {
    configurable: true,
    enumerable: true,
    get: () => require("./NodeBun.js"),
  })

  mod.registerHooks({ resolve: resolveBun, load: loadBun })
  if (process.env.VITEST) {
    mod.registerHooks({ resolve: resolveJsToTs })
  }
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
  if (context.importAttributes?.type === "file") {
    return {
      shortCircuit: true,
      format: "json",
      source: JSON.stringify(url),
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

// Auto-setup when loaded via --import in vitest workers
if (process.env.VITEST) setup()
