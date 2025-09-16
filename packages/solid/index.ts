import { createCliRenderer, type CliRendererConfig } from "@opentui/core"
import type { JSX } from "./jsx-runtime"
import { RendererContext } from "./src/elements"
import { render as renderInternal, createComponent } from "./src/reconciler"

export const render = async (node: () => JSX.Element, renderConfig: CliRendererConfig = {}) => {
  const renderer = await createCliRenderer(renderConfig)

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
}

export * from "./src/reconciler"
export * from "./src/elements"
export * from "./src/types/elements"
export { type JSX }
