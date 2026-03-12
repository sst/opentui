import { plugin as registerBunPlugin } from "bun"
import {
  createRuntimePlugin,
  runtimeModuleIdForSpecifier,
  type CreateRuntimePluginOptions,
  type RuntimeModuleEntry,
  type RuntimeModuleExports,
  type RuntimeModuleLoader,
} from "./runtime-plugin"

const runtimePluginSupportInstalledKey = "__opentuiCoreRuntimePluginSupportInstalled__"

type RuntimePluginSupportState = typeof globalThis & {
  [runtimePluginSupportInstalledKey]?: boolean
}

export function ensureRuntimePluginSupport(options: CreateRuntimePluginOptions = {}): boolean {
  const state = globalThis as RuntimePluginSupportState

  if (state[runtimePluginSupportInstalledKey]) {
    return false
  }

  registerBunPlugin(createRuntimePlugin(options))

  state[runtimePluginSupportInstalledKey] = true
  return true
}

ensureRuntimePluginSupport()

export {
  createRuntimePlugin,
  runtimeModuleIdForSpecifier,
  type CreateRuntimePluginOptions,
  type RuntimeModuleEntry,
  type RuntimeModuleExports,
  type RuntimeModuleLoader,
}
