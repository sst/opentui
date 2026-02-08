import { findClosestKeyboardScope, type KeyEvent, type Renderable } from "@opentui/core"
import type { RefObject } from "react"
import { useEffect } from "react"
import { useAppContext } from "../components/app"
import { useEffectEvent } from "./use-event"

export interface UseKeyboardOptions {
  /** Include release events - callback receives events with eventType: "release" */
  release?: boolean
  /** Ref used to discover the nearest keyboard scope. Falls back to global when none exists. */
  ref?: RefObject<Renderable | null>
}

/**
 * Subscribe to keyboard events.
 *
 * By default, only receives press events (including key repeats with `repeated: true`).
 * Use `options.release` to also receive release events.
 *
 * @example
 * // Basic press handling (includes repeats)
 * useKeyboard((e) => console.log(e.name, e.repeated ? "(repeat)" : ""))
 *
 * // With release events
 * useKeyboard((e) => {
 *   if (e.eventType === "release") keys.delete(e.name)
 *   else keys.add(e.name)
 * }, { release: true })
 */
export const useKeyboard = (handler: (key: KeyEvent) => void, options: UseKeyboardOptions = { release: false }) => {
  const { keyHandler } = useAppContext()
  const stableHandler = useEffectEvent(handler)

  useEffect(() => {
    const refTarget = options.ref?.current
    const scopedTarget = refTarget ? findClosestKeyboardScope(refTarget) : null
    const target = scopedTarget ?? keyHandler

    target?.on("keypress", stableHandler)
    if (options?.release) {
      target?.on("keyrelease", stableHandler)
    }
    return () => {
      target?.off("keypress", stableHandler)
      if (options?.release) {
        target?.off("keyrelease", stableHandler)
      }
    }
  }, [keyHandler, options.ref, options.release])
}
