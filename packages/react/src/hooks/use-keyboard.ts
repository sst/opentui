import type { KeyEvent } from "@opentui/core"
import { useEffect } from "react"
import { useAppContext } from "../components/app"
import { useEffectEvent } from "./use-event"

export const useKeyboard = (handler: (key: KeyEvent) => void) => {
  const { keyHandler } = useAppContext()
  const stableHandler = useEffectEvent(handler)

  useEffect(() => {
    keyHandler?.on("keypress", stableHandler)

    return () => {
      keyHandler?.off("keypress", stableHandler)
    }
  }, [keyHandler])
}
