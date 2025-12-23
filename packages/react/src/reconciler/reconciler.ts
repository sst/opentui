import type { RootRenderable } from "@opentui/core"
import React from "react"
import ReactReconciler from "react-reconciler"
import { ConcurrentRoot } from "react-reconciler/constants"
import { hostConfig } from "./host-config"

export const reconciler = ReactReconciler(hostConfig)

export const flushSync = reconciler.flushSync

export function _render(element: React.ReactNode, root: RootRenderable) {
  const container = reconciler.createContainer(
    root,
    ConcurrentRoot,
    null,
    false,
    null,
    "",
    console.error,
    console.error,
    console.error,
    console.error,
    null,
  )

  reconciler.updateContainer(element, container, null, () => {})

  return container
}
