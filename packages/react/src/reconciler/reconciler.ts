import type { RootRenderable } from "@opentui/core"
import React from "react"
import ReactReconciler from "react-reconciler"
import { ConcurrentRoot } from "react-reconciler/constants"
import { hostConfig } from "./host-config"

export const reconciler = ReactReconciler(hostConfig)

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
    // @ts-expect-error the types for `react-reconciler` are not up to date with the library.
    // See https://github.com/facebook/react/blob/7a36dfedc70ffb49be2e4e23b40e01d34cef267e/packages/react-reconciler/src/ReactFiberReconciler.js#L236-L259
    console.error,
    console.error,
    null,
  )

  reconciler.updateContainer(element, container, null, () => {})
}
