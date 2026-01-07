import { nextTick, type Component } from "vue"
import { createTestRenderer, type TestRendererOptions } from "@opentui/core/testing"
import { createOpenTUIRenderer } from "./renderer"
import { cliRendererKey } from "../index"

export async function testRender(component: Component, renderConfig: TestRendererOptions = {}) {
  const userOnDestroy = renderConfig.onDestroy
  const testSetup = await createTestRenderer({
    useThread: false,
    ...renderConfig,
    onDestroy: undefined,
  })

  const baseRenderOnce = testSetup.renderOnce
  const renderOnce = async () => {
    await nextTick()
    await baseRenderOnce()
  }

  const baseMockInput = testSetup.mockInput
  const mockInput = {
    ...baseMockInput,
    pressKeys: async (...args: Parameters<(typeof baseMockInput)["pressKeys"]>) => {
      await nextTick()
      return baseMockInput.pressKeys(...args)
    },
    typeText: async (...args: Parameters<(typeof baseMockInput)["typeText"]>) => {
      await nextTick()
      return baseMockInput.typeText(...args)
    },
    pasteBracketedText: async (...args: Parameters<(typeof baseMockInput)["pasteBracketedText"]>) => {
      await nextTick()
      return baseMockInput.pasteBracketedText(...args)
    },
  }

  const renderer = createOpenTUIRenderer(testSetup.renderer)
  const app = renderer.createApp(component)
  app.provide(cliRendererKey, testSetup.renderer)
  app.mount(testSetup.renderer.root)

  let didUnmount = false
  const originalDestroy = testSetup.renderer.destroy.bind(testSetup.renderer)
  testSetup.renderer.destroy = () => {
    if (!didUnmount) {
      didUnmount = true
      try {
        app.unmount()
      } catch {}
      try {
        userOnDestroy?.()
      } catch {}
    }

    return originalDestroy()
  }

  return {
    ...testSetup,
    renderOnce,
    mockInput,
  }
}
