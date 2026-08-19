import { extend } from "@opentui/solid/components"
import { RadioButtonRenderable } from "./RadioButton.js"

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    radio_button: typeof RadioButtonRenderable
  }
}

export function registerRadioButton(): void {
  extend({ radio_button: RadioButtonRenderable })
}

export * from "./index.js"
