import { createCliRenderer, type CliRendererConfig } from "@opentui/core"
import React, { type ReactNode } from "react"
import { AppContext } from "../components/app"
import { _render } from "./reconciler"

export async function render(node: ReactNode, rendererConfig: CliRendererConfig = {}): Promise<void> {
  const renderer = await createCliRenderer(rendererConfig)
  _render(
    React.createElement(AppContext.Provider, { value: { keyHandler: renderer.keyInput, renderer } }, node),
    renderer.root,
  )
}
