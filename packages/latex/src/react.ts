import { extend } from "@opentui/react"
import { LatexRenderable } from "./renderables/Latex.js"

declare module "@opentui/react" {
  interface OpenTUIComponents {
    latex: typeof LatexRenderable
  }
}

export function registerLatex(): void {
  extend({ latex: LatexRenderable })
}

export * from "./index.js"
