import { CliRenderer, createCliRenderer, engine, type CliRendererConfig } from "@opentui/core"
import { type TestRenderer } from "@opentui/core/testing"
import React, { type ReactNode } from "react"
import { AppContext } from "../components/app"
import { _render } from "./reconciler"
import { ErrorBoundary } from "../components/error-boundary"

export async function render(node: ReactNode, rendererOrConfig: CliRendererConfig | CliRenderer = {}): Promise<void> {
  const renderer =
    rendererOrConfig instanceof CliRenderer
      ? rendererOrConfig
      : await createCliRenderer(rendererOrConfig as CliRendererConfig)
  engine.attach(renderer)

  return new Promise<void>((resolve) => {
    _render(
      React.createElement(
        AppContext.Provider,
        { value: { keyHandler: renderer.keyInput, renderer } },
        React.createElement(ErrorBoundary, null, node),
      ),
      renderer.root,
      () => {
        if ("resolveReady" in renderer && "ready" in renderer) {
          const testRenderer = renderer as TestRenderer
          if (testRenderer.resolveReady) {
            testRenderer.resolveReady()
          }
        }
        resolve()
      },
    )
  })
}
