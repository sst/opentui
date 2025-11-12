import { createTestRenderer, type TestRendererOptions } from "@opentui/core/testing"
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "./reconciler/renderer"

function setIsReactActEnvironment(isReactActEnvironment: boolean) {
  // @ts-expect-error - this is a test environment
  globalThis.IS_REACT_ACT_ENVIRONMENT = isReactActEnvironment
}

export async function testRender(node: ReactNode, testRendererOptions: TestRendererOptions) {
  let root: Root | null = null
  setIsReactActEnvironment(true)

  const testSetup = await createTestRenderer({
    ...testRendererOptions,
    onDestroy() {
      act(() => {
        if (root) {
          root.unmount()
          root = null
        }
      })
      testRendererOptions.onDestroy?.()
      setIsReactActEnvironment(false)
    },
  })

  root = createRoot(testSetup.renderer)
  act(() => {
    if (root) {
      root.render(node)
    }
  })

  return testSetup
}
