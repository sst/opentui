import { CliRenderer, createCliRenderer, type CliRendererConfig } from "@opentui/core"
import { createOpenTUIRenderer } from "./src/renderer"
import type { InjectionKey } from "vue"
export * from "./src/composables/index"
export * from "./src/extend"

export const cliRendererKey: InjectionKey<CliRenderer> = Symbol("cliRenderer")

export async function render(component: any, rendererConfig: CliRendererConfig = {}): Promise<void> {
  const cliRenderer = await createCliRenderer(rendererConfig)
  const renderer = createOpenTUIRenderer(cliRenderer)
  const app = renderer.createApp(component)
  app.provide(cliRendererKey, cliRenderer)
  app.mount(cliRenderer.root)
}
