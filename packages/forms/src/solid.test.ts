import { describe, expect, it } from "bun:test"
import { getComponentCatalogue } from "@opentui/solid/components"
import { RadioButtonRenderable, registerRadioButton } from "./solid.js"

describe("@opentui/forms/solid", () => {
  it("registers the radio_button JSX component", () => {
    const catalogue = getComponentCatalogue()
    const hadPrevious = Object.prototype.hasOwnProperty.call(catalogue, "radio_button")
    const previous = catalogue.radio_button

    try {
      delete catalogue.radio_button
      registerRadioButton()
      expect(catalogue.radio_button).toBe(RadioButtonRenderable)
    } finally {
      if (hadPrevious) {
        catalogue.radio_button = previous!
      } else {
        delete catalogue.radio_button
      }
    }
  })
})
