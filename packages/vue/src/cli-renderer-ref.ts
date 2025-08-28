import type { CliRenderer } from "@opentui/core"

let currentCliRenderer: CliRenderer | null = null

export function setCurrentCliRenderer(renderer: CliRenderer) {
  currentCliRenderer = renderer
}

export function getCurrentCliRenderer(): CliRenderer {
  if (!currentCliRenderer) {
    throw new Error("No CLI renderer available. Make sure to call setCurrentCliRenderer.")
  }
  return currentCliRenderer
}
