import { CliRenderer, createCliRenderer, engine, type CliRendererConfig } from "@opentui/core"
import React, { type ReactNode } from "react"
import { AppContext } from "../components/app"
import { ErrorBoundary } from "../components/error-boundary"
import { _render } from "./reconciler"

/**
 * @deprecated Use `createRoot(renderer).render(node)` instead
 */
export async function render(node: ReactNode, rendererConfig: CliRendererConfig = {}): Promise<void> {
  const renderer = await createCliRenderer(rendererConfig)
  engine.attach(renderer)
  _render(
    React.createElement(
      AppContext.Provider,
      { value: { keyHandler: renderer.keyInput, renderer } },
      React.createElement(ErrorBoundary, null, node),
    ),
    renderer.root,
  )
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
export function createRoot(renderer: CliRenderer): { render: (node: ReactNode) => void } {
  return {
    render: (node: ReactNode) => {
      engine.attach(renderer)

      _render(
        React.createElement(
          AppContext.Provider,
          { value: { keyHandler: renderer.keyInput, renderer } },
          React.createElement(ErrorBoundary, null, node),
        ),
        renderer.root,
      )
    },
  }
}
