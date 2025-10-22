import { createCliRenderer, engine, type CliRendererConfig } from "@opentui/core"
import React, { type ReactNode } from "react"
import { AppContext } from "../components/app"
import { _render } from "./reconciler"
import { ErrorBoundary } from "../components/error-boundary"

export async function render(node: ReactNode, rendererConfig: CliRendererConfig = {}): Promise<void> {

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
}
