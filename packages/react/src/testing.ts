import { createCliRenderer, engine, type CliRendererConfig } from "@opentui/core"
import React, { type ReactNode } from "react"
import { AppContext } from "./components/app"
import { _render } from "./reconciler/reconciler"
import { ErrorBoundary } from "./components/error-boundary"

export async function testRender(node: ReactNode, rendererConfig: CliRendererConfig = {}) {
  const renderer = await createCliRenderer(rendererConfig)
  engine.attach(renderer)

  _render(
    React.createElement(
      AppContext.Provider,
      { value: { keyHandler: renderer.keyInput, renderer } },
      React.createElement(ErrorBoundary, null, node),
    ),
    renderer.root,
  )

  // Return a test setup compatible interface
  return {
    renderer,
    renderOnce: async () => {
      // For React, rendering is synchronous via reconciler
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
    captureCharFrame: () => {
      const currentBuffer = renderer.currentRenderBuffer
      const frameBytes = currentBuffer.getRealCharBytes(true)
      const decoder = new TextDecoder()
      return decoder.decode(frameBytes)
    },
    resize: (width: number, height: number) => {
      // Resize not implemented for React test renderer
    },
  }
}
