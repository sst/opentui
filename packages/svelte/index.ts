import { createCliRenderer, engine, type CliRendererConfig } from "@opentui/core"
import { createTestRenderer, type TestRendererOptions } from "@opentui/core/testing"
import { mount } from "svelte"
import { document, TUINode, TUIElement, setRenderer } from "./src/dom"

// Install DOM shims globally
// Called explicitly by compiled components
// Idempotent - safe to call multiple times
let shimsInstalled = false
export function installDOMShims() {
  if (shimsInstalled) return
  shimsInstalled = true
  ;(globalThis as any).document = document
  ;(globalThis as any).Node = TUINode
  ;(globalThis as any).Element = TUIElement
  ;(globalThis as any).HTMLElement = TUIElement
  ;(globalThis as any).Text = TUINode
  ;(globalThis as any).Comment = TUINode
  ;(globalThis as any).DocumentFragment = TUINode
}

// Render a Svelte component in OpenTUI CLI
export async function render(Component: any, config: CliRendererConfig = {}): Promise<{ renderer: any; root: any }> {
  // Ensure shims are installed (idempotent)
  installDOMShims()

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 30,
    ...config,
  })

  setRenderer(renderer)
  ;(globalThis as any).__opentui_root = renderer.root

  const target = new TUIElement(renderer.root)

  mount(Component, {
    target,
    intro: false,
  })

  renderer.start()

  return { renderer, root: renderer.root }
}

// Render a Svelte component in OpenTUI test environment
export async function testRender(
  Component: any,
  config: TestRendererOptions = {},
): Promise<Awaited<ReturnType<typeof createTestRenderer>>> {
  // Ensure shims are installed (idempotent)
  installDOMShims()

  const testSetup = await createTestRenderer(config)
  engine.attach(testSetup.renderer)

  setRenderer(testSetup.renderer)
  ;(globalThis as any).__opentui_root = testSetup.renderer.root

  const target = new TUIElement(testSetup.renderer.root)

  mount(Component, {
    target,
    intro: false,
  })

  return testSetup
}
