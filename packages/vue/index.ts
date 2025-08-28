import { CliRenderer, createCliRenderer, type CliRendererConfig } from "@opentui/core"
import { renderer } from "./src/renderer"
import { setCurrentCliRenderer } from "./src/cli-renderer-ref"
import type { InjectionKey } from "vue"
export * from "./src/composables/useCliRenderer"

export const cliRendererKey: InjectionKey<CliRenderer> = Symbol("cliRenderer")

export async function render(component: any, rendererConfig: CliRendererConfig = {}): Promise<void> {
  const cliRenderer = await createCliRenderer(rendererConfig)
  setCurrentCliRenderer(cliRenderer)
  const app = renderer.createApp(component)
  app.provide(cliRendererKey, cliRenderer)
  app.mount(cliRenderer.root)
}

// // Re-export all of Vue's runtime core APIs so users can import them from this package.
// export * from "@vue/runtime-core"
