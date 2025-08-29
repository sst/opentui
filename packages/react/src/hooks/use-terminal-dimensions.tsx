import { useState } from "react"
import { useRenderer } from "./use-renderer"
import { useOnResize } from "./use-resize"

export const useTerminalDimensions = () => {
  const renderer = useRenderer()

  const [dimensions, setDimensions] = useState<{
    width: number
    height: number
  }>({
    width: renderer.width,
    height: renderer.height,
  })

  const cb = (width: number, height: number) => {
    setDimensions({ width, height })
  }

  useOnResize(cb)

  return dimensions
}
