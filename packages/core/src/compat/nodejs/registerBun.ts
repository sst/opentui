import * as mod from "node:module"
import { extname } from "node:path"
import { __url as ffiUrl } from "../ffi.js"
import * as NodeBun from "../runtime.js"
import { fileURLToPath } from "node:url"

if (typeof globalThis.Bun === "undefined") {
  Object.defineProperty(globalThis, "Bun", {
    value: NodeBun,
    writable: false,
    enumerable: true,
    configurable: true,
  })
}

const recentOddSpecifiers = new Map<string, mod.ResolveHookContext>()
function popRecentSpecifier(specifier: string) {
  const context = recentOddSpecifiers.get(specifier)
  if (context) {
    recentOddSpecifiers.delete(specifier)
  } else if (recentOddSpecifiers.size > 10) {
    const key = recentOddSpecifiers.keys().next().value
    if (key) {
      recentOddSpecifiers.delete(key)
    }
  }
  return context
}

function extendError(error: unknown, specifier: string, context: mod.ResolveHookContext | undefined) {
  if (error && typeof error === "object" && "message" in error) {
    error.message += `\nSpecifier: '${specifier}'\nFrom: ${JSON.stringify(context, null, 2)}`
  }
  return error
}

const NORMAL_EXTENSIONS = new Set<string>([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"])

mod.registerHooks({
  resolve: (specifier, context, next) => {
    try {
      if (specifier === "bun:ffi") {
        return next(ffiUrl, context)
      }

      if (specifier.startsWith("bun:")) {
        throw new Error(`Untransformed Bun specifier: '${specifier}' from '${context.parentURL}'`)
      }

      const result = next(specifier, context)

      if (
        (!result.url.startsWith("node:") && !NORMAL_EXTENSIONS.has(extname(result.url))) ||
        (context.importAttributes.type &&
          context.importAttributes.type !== "module" &&
          context.importAttributes.type !== "commonjs")
      ) {
        recentOddSpecifiers.set(result.url, context)
      }

      return result
    } catch (error) {
      throw extendError(error, specifier, context)
    }
  },
  load: (specifier, context, next) => {
    // Exists only for error reporting / debugging.
    const resolveContext = popRecentSpecifier(specifier)
    try {
      return next(specifier, context)
    } catch (error) {
      if (context.importAttributes.type === "file" || context.importAttributes.type?.includes("/")) {
        const absolutePath = fileURLToPath(specifier)
        return {
          format: "module",
          source: `export default ${JSON.stringify(absolutePath)}`,
          shortCircuit: true,
        }
      }

      throw extendError(error, specifier, resolveContext)
    }
  },
})
