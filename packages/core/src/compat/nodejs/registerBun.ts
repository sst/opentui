import * as mod from "node:module"
import * as NodeBun from "../runtime.js"
import { __url as ffiUrl } from "./ffi.js"

if (typeof globalThis.Bun === "undefined") {
  Object.defineProperty(globalThis, "Bun", {
    value: NodeBun,
    writable: false,
    enumerable: true,
    configurable: true,
  })
}

mod.registerHooks({
  resolve: (specifier, context, next) => {
    if (specifier === "bun:ffi") {
      return next(ffiUrl, context)
    }

    if (specifier.startsWith("bun:")) {
      throw new Error(`Untransformed Bun specifier: '${specifier}' from '${context.parentURL}'`)
    }

    return next(specifier, context)
  },
})
