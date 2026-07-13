import { describe, expect, it } from "bun:test"
import { getComponentCatalogue } from "@opentui/react"
import { RadioButtonRenderable, registerRadioButton } from "./react.js"

describe("@opentui/forms/react", () => {
  it("registers the radio-button JSX component", () => {
    const catalogue = getComponentCatalogue()
    const hadPrevious = Object.prototype.hasOwnProperty.call(catalogue, "radio-button")
    const previous = catalogue["radio-button"]

    try {
      delete catalogue["radio-button"]
      registerRadioButton()
      expect(catalogue["radio-button"]).toBe(RadioButtonRenderable)
    } finally {
      if (hadPrevious) {
        catalogue["radio-button"] = previous!
      } else {
        delete catalogue["radio-button"]
      }
    }
  })
})
