import { createCliRenderer, type CliRendererConfig } from "@opentui/core"
import type { JSX } from "./jsx-runtime"
import { RendererContext } from "./src/elements"
import { _render, createComponent } from "./src/reconciler"

export const render = async (node: () => JSX.Element, renderConfig: CliRendererConfig = {}) => {
  const renderer = await createCliRenderer(renderConfig)

  _render(
    () =>
      createComponent(RendererContext.Provider, {
        get value() {
          return renderer
        },
        get children() {
          // @ts-expect-error is fine, ts makes it so JSX.Element is the only thing returned from components
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
