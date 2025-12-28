import { CliRenderer, engine } from "@opentui/core"
import React, { type ReactNode } from "react"
import type { OpaqueRoot } from "react-reconciler"
import { AppContext } from "../components/app"
import { ErrorBoundary } from "../components/error-boundary"
import { _render, reconciler } from "./reconciler"

const { flushSync, createPortal } = reconciler

export type Root = {
  render: (node: ReactNode) => void
  unmount: () => void
}

/**
 * Creates a root for rendering a React tree with the given CLI renderer.
 * @param renderer The CLI renderer to use
 * @returns A root object with a `render` method
 * @example
 * ```tsx
 * const renderer = await createCliRenderer()
 * createRoot(renderer).render(<App />)
 * ```
 */
export function createRoot(renderer: CliRenderer): Root {
  let container: OpaqueRoot | null = null

  return {
    render: (node: ReactNode) => {
      engine.attach(renderer)

      container = _render(
        React.createElement(
          AppContext.Provider,
          { value: { keyHandler: renderer.keyInput, renderer } },
          React.createElement(ErrorBoundary, null, node),
        ),
        renderer.root,
      )
    },

    unmount: (): void => {
      if (!container) {
        return
      }

      reconciler.updateContainer(null, container, null, () => {})
      // @ts-expect-error the types for `react-reconciler` are not up to date with the library.
      reconciler.flushSyncWork()
      container = null
    },
  }
}

export { createPortal, flushSync }
