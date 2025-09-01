import { useCallback, useLayoutEffect, useRef } from "react"

/**
 * Returns a stable callback that always calls the latest version of the provided handler.
 * This prevents unnecessary re-renders and effect re-runs while ensuring the callback
 * always has access to the latest props and state.
 *
 * Useful for event handlers that need to be passed to effects with empty dependency arrays
 * or memoized child components.
 */
export function useEvent<T extends (...args: any[]) => any>(handler: T): T {
  const handlerRef = useRef<T>(handler)

  useLayoutEffect(() => {
    handlerRef.current = handler
  })

  return useCallback((...args: Parameters<T>) => {
    const fn = handlerRef.current
    return fn(...args)
  }, []) as T
}
