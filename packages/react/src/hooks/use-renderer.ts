import { useAppContext } from "../components/app"

export const useRenderer = () => {
  const { renderer } = useAppContext()

  if (!renderer) {
    throw new Error("Renderer not found.")
  }

  return renderer
}
