import { useState } from "react"
import { useRenderer } from "./use-renderer.js"
import { useOnResize } from "./use-resize.js"

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
