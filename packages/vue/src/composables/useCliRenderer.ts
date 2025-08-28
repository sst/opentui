import { inject } from "@vue/runtime-core"
import type { CliRenderer } from "@opentui/core"
import { cliRendererKey } from "../.."

export function useCliRenderer(): CliRenderer {
  const renderer = inject(cliRendererKey)

  if (!renderer) {
    throw new Error("Could not find CliRenderer instance. Was it provided by the app?")
  }

  return renderer
}
