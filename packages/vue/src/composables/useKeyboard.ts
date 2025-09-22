// packages/vue/src/composables/useKeyboard.ts
import { type ParsedKey } from "@opentui/core"
import { onMounted, onUnmounted } from "vue"
import { useCliRenderer } from "./useCliRenderer"

export const useKeyboard = (handler: (key: ParsedKey) => void) => {
  const renderer = useCliRenderer()

  onMounted(() => {
    renderer.keyInput.on("keypress", handler)
  })

  onUnmounted(() => {
    renderer.keyInput.off("keypress", handler)
  })
}
