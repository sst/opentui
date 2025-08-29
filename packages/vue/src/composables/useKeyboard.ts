// packages/vue/src/composables/useKeyboard.ts
import { getKeyHandler, type ParsedKey } from "@opentui/core"
import { onMounted, onUnmounted } from "vue"
import { useCliRenderer } from "./useCliRenderer"

export const useKeyboard = (handler: (key: ParsedKey) => void) => {
  const renderer = useCliRenderer()

  onMounted(() => {
    getKeyHandler()?.on("keypress", handler)
  })

  onUnmounted(() => {
    getKeyHandler()?.off("keypress", handler)
  })
}
