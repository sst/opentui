// packages/vue/src/composables/useOnResize.ts
import { onMounted, onUnmounted } from "vue"
import { useCliRenderer } from "./useCliRenderer"

export const useOnResize = (callback: (width: number, height: number) => void) => {
  const renderer = useCliRenderer()

  onMounted(() => {
    renderer.on("resize", callback)
  })

  onUnmounted(() => {
    renderer.off("resize", callback)
  })
}
