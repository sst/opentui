import { extend } from "@opentui/solid/components"
import { LatexRenderable } from "./renderables/Latex.js"

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    latex: typeof LatexRenderable
  }
}

export function registerLatex(): void {
  extend({ latex: LatexRenderable })
}

export * from "./index.js"
