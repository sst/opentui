import { plugin as registerBunPlugin } from "bun"
import * as coreRuntime from "@opentui/core"
import {
  createRuntimePlugin,
  isCoreRuntimeModuleSpecifier,
  runtimeModuleIdForSpecifier,
} from "@opentui/core/runtime-plugin"
import * as solidJsRuntime from "solid-js"
import * as solidJsStoreRuntime from "solid-js/store"
import * as solidRuntime from "../index"
import { createSolidTransformPlugin } from "./solid-plugin"

const runtimePluginSupportInstalledKey = "__opentuiSolidRuntimePluginSupportInstalled__"

type RuntimePluginSupportState = typeof globalThis & {
  [runtimePluginSupportInstalledKey]?: boolean
}

const loadThreeRuntime = async (): Promise<Record<string, unknown>> => {
  return (await import(new URL("../../three/src/index.ts", import.meta.url).href)) as Record<string, unknown>
}

type RuntimeModuleEntry = Record<string, unknown> | (() => Record<string, unknown> | Promise<Record<string, unknown>>)

const additionalRuntimeModules: Record<string, RuntimeModuleEntry> = {
  "@opentui/solid": solidRuntime as Record<string, unknown>,
  "@opentui/three": loadThreeRuntime,
  "solid-js": solidJsRuntime as Record<string, unknown>,
  "solid-js/store": solidJsStoreRuntime as Record<string, unknown>,
}

const resolveRuntimeSpecifier = (specifier: string): string | null => {
  if (!isCoreRuntimeModuleSpecifier(specifier) && !additionalRuntimeModules[specifier]) {
    return null
  }

  return runtimeModuleIdForSpecifier(specifier)
}

export function ensureRuntimePluginSupport(): boolean {
  const state = globalThis as RuntimePluginSupportState

  if (state[runtimePluginSupportInstalledKey]) {
    return false
  }

  registerBunPlugin(
    createSolidTransformPlugin({
      moduleName: runtimeModuleIdForSpecifier("@opentui/solid"),
      resolvePath(specifier) {
        return resolveRuntimeSpecifier(specifier)
      },
    }),
  )

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
