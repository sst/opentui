import { createCliRenderer, type CliRendererConfig } from "@opentui/core"
import { createTestRenderer, type TestRendererOptions } from "@opentui/core/testing"
import type { JSX } from "./jsx-runtime"
import { RendererContext } from "./src/elements"
import { _render as renderInternal, createComponent } from "./src/reconciler"

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

export const testRender = async (node: () => JSX.Element, renderConfig: TestRendererOptions = {}) => {
  const testSetup = await createTestRenderer(renderConfig)

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
