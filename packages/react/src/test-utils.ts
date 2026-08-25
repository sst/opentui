import { CliRenderEvents } from "@opentui/core"
import { createTestRenderer, type TestRendererOptions } from "@opentui/core/testing"
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "./reconciler/renderer.js"

function setIsReactActEnvironment(isReactActEnvironment: boolean) {
  // @ts-expect-error - this is a test environment
  globalThis.IS_REACT_ACT_ENVIRONMENT = isReactActEnvironment
}

export async function testRender(node: ReactNode, testRendererOptions: TestRendererOptions) {
  setIsReactActEnvironment(true)

  const testSetup = await createTestRenderer({
    ...testRendererOptions,
    onDestroy() {
      testRendererOptions.onDestroy?.()
      setIsReactActEnvironment(false)
    },
  })

  let root: Root
  // Register before createRoot so this listener unmounts inside act() before
  // createRoot's own DESTROY listener tries to unmount the same container.
  testSetup.renderer.once(CliRenderEvents.DESTROY, () => {
    act(() => root.unmount())
  })

  root = createRoot(testSetup.renderer)
  act(() => root.render(node))

  return testSetup
}
