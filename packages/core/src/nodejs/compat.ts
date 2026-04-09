import * as mod from "node:module"

/**
 * Sets up Bun shims in a Node.js process.
 */
export function install() {
  Object.defineProperty(globalThis, "Bun", {
    configurable: true,
    enumerable: true,
    get: () => require("./NodeBun"),
  })

  mod.registerHooks({ resolve: resolveBun })
}

const BUN_PREFIX = "bun:"

const resolveBun: mod.ResolveHookSync = (request, context, next) => {
  console.log("resolveBun", request, context)
  if (request.startsWith(BUN_PREFIX)) {
    const name = request.slice(BUN_PREFIX.length)
    const result = next(`./bunModules/${name}`, {
      parentURL: import.meta.url,
      importAttributes: {
        type: "commonjs",
      },
    })
    console.log("resolveBun result", result)
    return result
  }
  return next(request, context)
}
