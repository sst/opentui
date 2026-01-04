import { CliRenderer, createCliRenderer, engine, type CliRendererConfig } from "@opentui/core"
import { createTestRenderer, type TestRendererOptions } from "@opentui/core/testing"
import type { JSX } from "./jsx-runtime"
import { RendererContext } from "./src/elements"
import { _render as renderInternal, createComponent } from "./src/reconciler"

export const render = async (node: () => JSX.Element, rendererOrConfig: CliRenderer | CliRendererConfig = {}) => {
  let isDisposed = false
  let dispose: () => void

  const renderer =
    rendererOrConfig instanceof CliRenderer
      ? rendererOrConfig
      : await createCliRenderer({
          ...rendererOrConfig,
          onDestroy: () => {
            if (!isDisposed) {
              isDisposed = true
              dispose()
            }
            rendererOrConfig.onDestroy?.()
          },
        })

  if (rendererOrConfig instanceof CliRenderer) {
    renderer.on("destroy", () => {
      if (!isDisposed) {
        isDisposed = true
        dispose()
      }
    })
  }

  engine.attach(renderer)

  dispose = renderInternal(
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
  let isDisposed = false
  const testSetup = await createTestRenderer({
    ...renderConfig,
    onDestroy: () => {
      if (!isDisposed) {
        isDisposed = true
        dispose()
      }
      renderConfig.onDestroy?.()
    },
  })
  engine.attach(testSetup.renderer)

  const dispose = renderInternal(
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
