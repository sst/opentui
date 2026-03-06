import { CliRenderer, createCliRenderer, engine, type CliRendererConfig } from "@opentui/core"
import { createTestRenderer, type TestRendererOptions } from "@opentui/core/testing"
import type { JSX } from "./jsx-runtime"
import { RendererContext } from "./src/elements"
import { _render as renderInternal, createComponent } from "./src/reconciler"

type DisposeFn = () => void

const createDisposeController = () => {
  let dispose: DisposeFn | undefined
  let disposeRequested = false
  let disposed = false

  const requestDispose = () => {
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

  const setDispose = (nextDispose: DisposeFn) => {
    dispose = nextDispose

    if (disposeRequested) {
      requestDispose()
    }
  }

  return { requestDispose, setDispose }
}

const mountWithDestroyGuard = (renderer: CliRenderer, mount: () => void) => {
  const originalDestroy = renderer.destroy.bind(renderer)
  let mounting = true
  let destroyRequested = false

  renderer.destroy = () => {
    if (mounting) {
      destroyRequested = true
      return
    }

    originalDestroy()
  }

  try {
    mount()
  } finally {
    mounting = false
    renderer.destroy = originalDestroy
  }

  if (destroyRequested) {
    originalDestroy()
  }
}

export const render = async (node: () => JSX.Element, rendererOrConfig: CliRenderer | CliRendererConfig = {}) => {
  const { requestDispose, setDispose } = createDisposeController()

  const renderer =
    rendererOrConfig instanceof CliRenderer
      ? rendererOrConfig
      : await createCliRenderer({
          ...rendererOrConfig,
          onDestroy: () => {
            rendererOrConfig.onDestroy?.()
          },
        })

  renderer.once("destroy", requestDispose)

  engine.attach(renderer)

  mountWithDestroyGuard(renderer, () => {
    setDispose(
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
      ),
    )
  })
}

export const testRender = async (node: () => JSX.Element, renderConfig: TestRendererOptions = {}) => {
  const { requestDispose, setDispose } = createDisposeController()

  const testSetup = await createTestRenderer({
    ...renderConfig,
    onDestroy: () => {
      renderConfig.onDestroy?.()
    },
  })

  testSetup.renderer.once("destroy", requestDispose)

  engine.attach(testSetup.renderer)

  mountWithDestroyGuard(testSetup.renderer, () => {
    setDispose(
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
      ),
    )
  })

  return testSetup
}

export * from "./src/reconciler"
export * from "./src/elements"
export * from "./src/types/elements"
export { type JSX }
