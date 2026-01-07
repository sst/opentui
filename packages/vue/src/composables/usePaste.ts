import { onMounted, onUnmounted } from "vue"
import type { PasteEvent } from "@opentui/core"
import { useCliRenderer } from "./useCliRenderer"

export function usePaste(callback: (event: PasteEvent) => void) {
  const renderer = useCliRenderer()
  const keyHandler = renderer.keyInput

  onMounted(() => {
    keyHandler.on("paste", callback)
  })

  onUnmounted(() => {
    keyHandler.off("paste", callback)
  })
}
