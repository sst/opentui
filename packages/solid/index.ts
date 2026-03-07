import { CliRenderer, createCliRenderer, engine, type CliRendererConfig } from "@opentui/core"
import { createTestRenderer, type TestRendererOptions } from "@opentui/core/testing"
import type { JSX } from "./jsx-runtime"
import { RendererContext } from "./src/elements"
import { _render as renderInternal, createComponent } from "./src/reconciler"

type DisposeFn = () => void

const mountSolidRoot = (renderer: CliRenderer, node: () => JSX.Element) => {
  let dispose: DisposeFn | undefined
  let disposeRequested = false
  let disposed = false
  let mounting = true
  let destroyRequested = false

  const originalDestroy = renderer.destroy.bind(renderer)

  const runDispose = () => {
    if (disposed) {
      return
    }

    if (!dispose) {
      disposeRequested = true
      return
    }

    disposed = true
    dispose()
  }

  renderer.once("destroy", runDispose)

  renderer.destroy = () => {
    if (mounting) {
      destroyRequested = true
      return
    }

    originalDestroy()
  }

  try {
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
  } finally {
    mounting = false
    renderer.destroy = originalDestroy
  }

  if (disposeRequested) {
    runDispose()
  }

  if (destroyRequested) {
    originalDestroy()
  }
}

export const render = async (node: () => JSX.Element, rendererOrConfig: CliRenderer | CliRendererConfig = {}) => {
  const renderer =
    rendererOrConfig instanceof CliRenderer
      ? rendererOrConfig
      : await createCliRenderer({
          ...rendererOrConfig,
          onDestroy: () => {
            rendererOrConfig.onDestroy?.()
          },
        })

  engine.attach(renderer)
  mountSolidRoot(renderer, node)
}

export const testRender = async (node: () => JSX.Element, renderConfig: TestRendererOptions = {}) => {
  const testSetup = await createTestRenderer({
    ...renderConfig,
    onDestroy: () => {
      renderConfig.onDestroy?.()
    },
  })

  engine.attach(testSetup.renderer)
  mountSolidRoot(testSetup.renderer, node)

  return testSetup
}

export * from "./src/reconciler"
export * from "./src/elements"
export * from "./src/time-to-first-draw"
export * from "./src/types/elements"
export { type JSX }
