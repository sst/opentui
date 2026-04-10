import * as mod from "node:module"
import path from "node:path"

// allow import(foo.js) to resolve to import(foo.ts)
// required for workers under vitest
const extensionMap: Record<string, string> = {
  ".js": ".ts",
  ".jsx": ".tsx",
  ".cjs": ".cts",
  ".mjs": ".mts",
}
mod.registerHooks({
  resolve: (specifier, context, next) => {
    try {
      return next(specifier, context)
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error)) {
        throw error
      }

      if (error.code === "ERR_MODULE_NOT_FOUND") {
        const extension = path.extname(specifier)
        const newExtension = extension in extensionMap ? extensionMap[extension] : undefined
        if (newExtension) {
          return next(specifier.slice(0, -extension.length) + newExtension, context)
        }
      }

      if (error.code === "ERR_UNSUPPORTED_ESM_URL_SCHEME" && "message" in error) {
        error.message += `\nSpecifier: '${specifier}'\nContext: '${JSON.stringify(context)}'`
      }

      throw error
    }
  },
})
