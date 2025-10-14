import { createCliRenderer, engine, type CliRendererConfig } from "@opentui/core"
import React, { type ReactNode } from "react"
import { AppContext } from "../components/app"
import { _render } from "./reconciler"
import { ErrorBoundary } from "../components/error-boundary"

export async function render(node: ReactNode, rendererConfig: CliRendererConfig = {}): Promise<void> {
  // Default to transparent background if not specified
  const config: CliRendererConfig = {
    backgroundColor: "transparent",
    ...rendererConfig,
  }

  const renderer = await createCliRenderer(config)
  engine.attach(renderer)
  _render(
    React.createElement(
      AppContext.Provider,
      { value: { keyHandler: renderer.keyInput, renderer } },
      React.createElement(ErrorBoundary, null, node),
    ),
    renderer.root,
  )
}
