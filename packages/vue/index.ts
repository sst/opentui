import {
  CliRenderEvents,
  CliRenderer,
  createCliRenderer,
  engine,
  type BaseRenderable,
  type CliRendererConfig,
} from "@opentui/core"
import { createOpenTUIRenderer } from "./src/renderer"
import { defineComponent, h, shallowRef, type App, type Component, type InjectionKey } from "vue"
import { elements } from "./src/elements"
import { initializeDevtools } from "./src/devtools"
export * from "./src/composables/index"
export * from "./src/extend"
export { testRender } from "./src/test-utils"
export { Portal, type PortalProps } from "./src/components/Portal"
export { setupOpenTUIDevtools, type OpenTUIDevtoolsSettings } from "./src/devtools"

export const cliRendererKey: InjectionKey<CliRenderer> = Symbol("cliRenderer")

export interface RenderableComponentExpose<TRenderable extends BaseRenderable = BaseRenderable> {
  readonly element: TRenderable | null
}

export function installOpenTUIComponents(app: App): void {
  for (const elementName of Object.keys(elements)) {
    const displayName = elementName.endsWith("Renderable")
      ? elementName.slice(0, -10).toLowerCase()
      : elementName.toLowerCase()

    app.component(
      elementName,
      defineComponent({
        name: displayName,
        inheritAttrs: false,
        setup(_props, { attrs, slots, expose }) {
          const element = shallowRef<BaseRenderable | null>(null)
          expose({
            get element() {
              return element.value
            },
          })

          return () => h(elementName, { ...attrs, ref: element }, slots.default?.())
        },
      }),
    )
  }
}

let currentCliRenderer: CliRenderer | null = null
let currentEngineOwner: CliRenderer | null = null

export function getCurrentCliRenderer(): CliRenderer | null {
  return currentCliRenderer
}

export async function render(
  component: Component,
  rendererOrConfig: CliRenderer | CliRendererConfig = {},
): Promise<void> {
  const { shouldEnableDevtools, devtoolsCleanup } = await initializeDevtools()

  const cliRenderer =
    rendererOrConfig instanceof CliRenderer ? rendererOrConfig : await createCliRenderer(rendererOrConfig)
  currentCliRenderer = cliRenderer

  engine.attach(cliRenderer)
  currentEngineOwner = cliRenderer

  cliRenderer.once(CliRenderEvents.DESTROY, () => {
    if (currentEngineOwner === cliRenderer) {
      engine.detach()
      currentEngineOwner = null
    }
    devtoolsCleanup?.()
    if (currentCliRenderer === cliRenderer) {
      currentCliRenderer = null
    }
  })

  const renderer = createOpenTUIRenderer(cliRenderer)
  const app = renderer.createApp(component)
  installOpenTUIComponents(app as App)
  app.provide(cliRendererKey, cliRenderer)

  if (shouldEnableDevtools) {
    try {
      const { setupOpenTUIDevtools } = await import("./src/devtools")

      ;(app.config as unknown as Record<string, unknown>).devtools = true
      setupOpenTUIDevtools(app as App, cliRenderer)
    } catch (e) {
      if (process.env["NODE_ENV"] === "development") {
        console.warn("[OpenTUI] Failed to setup DevTools:", e)
      }
    }
  }

  app.mount(cliRenderer.root)
}
