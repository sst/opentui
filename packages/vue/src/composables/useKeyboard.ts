import { type KeyEvent } from "@opentui/core"
import { onMounted, onUnmounted } from "vue"
import { useCliRenderer } from "./useCliRenderer"

export interface UseKeyboardOptions {
  /** Include release events - callback receives events with eventType: "release" */
  release?: boolean
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
 * const keys = new Set<string>()
 * useKeyboard((e) => {
 *   if (e.eventType === "release") keys.delete(e.name)
 *   else keys.add(e.name)
 * }, { release: true })
 */
export const useKeyboard = (handler: (key: KeyEvent) => void, options?: UseKeyboardOptions) => {
  const renderer = useCliRenderer()
  const keyHandler = renderer.keyInput

  onMounted(() => {
    keyHandler.on("keypress", handler)
    if (options?.release) {
      keyHandler.on("keyrelease", handler)
    }
  })

  onUnmounted(() => {
    keyHandler.off("keypress", handler)
    if (options?.release) {
      keyHandler.off("keyrelease", handler)
    }
  })
}
