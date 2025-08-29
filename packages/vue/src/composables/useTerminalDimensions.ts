// packages/vue/src/composables/useTerminalDimensions.ts
import { ref } from "vue"
import { useCliRenderer } from "./useCliRenderer"
import { useOnResize } from "./useOnResize"

export const useTerminalDimensions = () => {
  const renderer = useCliRenderer()

  const dimensions = ref({
    width: renderer.width,
    height: renderer.height,
  })

  const onResize = (width: number, height: number) => {
    dimensions.value = { width, height }
  }

  useOnResize(onResize)

  return dimensions
}
