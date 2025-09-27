import { useEffect } from "react"
import { useRenderer } from "./use-renderer"

export const useOnResize = (callback: (width: number, height: number) => void) => {
  const renderer = useRenderer()

  useEffect(() => {
    renderer.on("resize", callback)

    return () => {
      renderer.off("resize", callback)
    }
  }, [renderer, callback])

  return renderer
}
