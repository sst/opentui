import { useEffect } from "react"
import { useEffectEvent } from "./use-event"
import { useRenderer } from "./use-renderer"

export const useOnResize = (callback: (width: number, height: number) => void) => {
  const renderer = useRenderer()
  const stableCallback = useEffectEvent(callback)

  useEffect(() => {
    renderer.on("resize", stableCallback)

    return () => {
      renderer.off("resize", stableCallback)
    }
  }, [renderer])

  return renderer
}
