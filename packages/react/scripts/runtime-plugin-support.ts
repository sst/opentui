import { plugin as registerBunPlugin } from "bun"
import * as coreRuntime from "@opentui/core"
import { createRuntimePlugin, type RuntimeModuleEntry } from "@opentui/core/runtime-plugin"
import * as reactRuntime from "react"
import * as reactJsxRuntime from "react/jsx-runtime"
import * as reactJsxDevRuntime from "react/jsx-dev-runtime"
import * as opentuiReactRuntime from "../src/index.js"

const runtimePluginSupportInstalledKey = "__opentuiReactRuntimePluginSupportInstalled__"

type RuntimePluginSupportState = typeof globalThis & {
  [runtimePluginSupportInstalledKey]?: boolean
}

const additionalRuntimeModules: Record<string, RuntimeModuleEntry> = {
  "@opentui/react": opentuiReactRuntime as Record<string, unknown>,
  "@opentui/react/jsx-runtime": reactJsxRuntime as Record<string, unknown>,
  "@opentui/react/jsx-dev-runtime": reactJsxDevRuntime as Record<string, unknown>,
  react: reactRuntime as Record<string, unknown>,
  "react/jsx-runtime": reactJsxRuntime as Record<string, unknown>,
  "react/jsx-dev-runtime": reactJsxDevRuntime as Record<string, unknown>,
}

export function ensureRuntimePluginSupport(): boolean {
  const state = globalThis as RuntimePluginSupportState

  if (state[runtimePluginSupportInstalledKey]) {
    return false
  }

  registerBunPlugin(
    createRuntimePlugin({
      core: coreRuntime as Record<string, unknown>,
      additional: additionalRuntimeModules,
    }),
  )

  state[runtimePluginSupportInstalledKey] = true
  return true
}

ensureRuntimePluginSupport()
