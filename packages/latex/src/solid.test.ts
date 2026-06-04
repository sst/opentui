import { describe, expect, it } from "bun:test"
import { getComponentCatalogue } from "@opentui/solid/components"
import { LatexRenderable, registerLatex } from "./solid.js"

describe("@opentui/latex/solid", () => {
  it("registers the latex JSX component", () => {
    const catalogue = getComponentCatalogue()
    const hadPrevious = Object.prototype.hasOwnProperty.call(catalogue, "latex")
    const previous = catalogue.latex

    try {
      delete catalogue.latex

      registerLatex()

      expect(catalogue.latex).toBe(LatexRenderable)
    } finally {
      if (hadPrevious) {
        catalogue.latex = previous!
      } else {
        delete catalogue.latex
      }
    }
  })
})
