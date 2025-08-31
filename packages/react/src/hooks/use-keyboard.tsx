import type { ParsedKey } from "@opentui/core"
import { useEffect } from "react"
import { useAppContext } from "../components/app"
import { useEvent } from "./use-event"

export const useKeyboard = (handler: (key: ParsedKey) => void) => {
  const { keyHandler } = useAppContext()
  const stableHandler = useEvent(handler)

  useEffect(() => {
    keyHandler?.on("keypress", stableHandler)

    return () => {
      keyHandler?.off("keypress", stableHandler)
    }
  }, [keyHandler, stableHandler])
}
