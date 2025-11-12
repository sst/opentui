import { createCliRenderer, engine, type CliRendererConfig, type CliRenderer } from "@opentui/core"
import { createTestRenderer, type TestRendererOptions } from "@opentui/core/testing"
import type { JSX } from "./jsx-runtime"
import { RendererContext } from "./src/elements"
import { _render as renderInternal, createComponent } from "./src/reconciler"

/**
 * @deprecated Use `createRoot(renderer).render(() => element)` instead
 */
export const render = async (
  node: () => JSX.Element,
  renderConfig: CliRendererConfig = {},
): Promise<{ renderer: CliRenderer }> => {
  const renderer = await createCliRenderer(renderConfig)
  createRoot(renderer).render(node)

  return { renderer }
}

/**
 * Creates a root for rendering a Solid tree with the given CLI renderer.
 * @param renderer The CLI renderer to use
 * @returns A root object with a `render` method
 * @example
 * ```tsx
 * const renderer = await createCliRenderer()
 * createRoot(renderer).render(() => <App />)
 * ```
 */
export const createRoot = (renderer: CliRenderer): { render: (node: () => JSX.Element) => void } => {
  return {
    render: (node) => {
      engine.attach(renderer)
      renderInternal(
        () =>
          createComponent(RendererContext.Provider, {
            get value() {
              return renderer
            },
            get children() {
              return createComponent(node, {})
            },
          }),
        renderer.root,
      )
    },
  }
}

export const testRender = async (node: () => JSX.Element, renderConfig: TestRendererOptions = {}) => {
  const testSetup = await createTestRenderer(renderConfig)
  engine.attach(testSetup.renderer)

  renderInternal(
    () =>
      createComponent(RendererContext.Provider, {
        get value() {
          return testSetup.renderer
        },
        get children() {
          return createComponent(node, {})
        },
      }),
    testSetup.renderer.root,
  )

  return testSetup
}

export * from "./src/reconciler"
export * from "./src/elements"
export * from "./src/types/elements"
export { type JSX }
