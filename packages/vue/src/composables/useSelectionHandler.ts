import { onMounted, onUnmounted } from "vue"
import type { Selection } from "@opentui/core"
import { useCliRenderer } from "./useCliRenderer"

export function useSelectionHandler(callback: (selection: Selection) => void) {
  const renderer = useCliRenderer()

  onMounted(() => {
    renderer.on("selection", callback)
  })

  onUnmounted(() => {
    renderer.off("selection", callback)
  })
}
