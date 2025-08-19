import type { ParsedKey } from "@opentui/core"
import { useEffect } from "react"
import { useAppContext } from "../components/app"

export const useKeyboard = (handler: (key: ParsedKey) => void) => {
  const { keyHandler } = useAppContext()

  useEffect(() => {
    keyHandler?.on("keypress", handler)

    return () => {
      keyHandler?.off("keypress", handler)
    }
  }, [keyHandler, handler])
}
