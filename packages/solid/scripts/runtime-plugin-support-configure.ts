import { plugin as registerBunPlugin } from "bun"
import * as coreRuntime from "@opentui/core"
import {
  createRuntimePlugin,
  isCoreRuntimeModuleSpecifier,
  runtimeModuleIdForSpecifier,
  type RuntimeModuleEntry,
  type RuntimePluginRewriteOptions,
} from "@opentui/core/runtime-plugin"
import * as solidJsRuntime from "solid-js"
import * as solidJsStoreRuntime from "solid-js/store"
import * as solidRuntime from "../index.js"
import { ensureSolidTransformPlugin } from "./solid-plugin.js"

const runtimePluginSupportInstalledKey = Symbol.for("opentui.solid.runtime-plugin-support")
const THREE_RUNTIME_SPECIFIER = "@opentui/three"

export interface SolidRuntimePluginSupportOptions {
  additional?: Record<string, RuntimeModuleEntry>
  core?: RuntimeModuleEntry
  rewrite?: RuntimePluginRewriteOptions
}

interface RuntimePluginSupportInstall {
  specifiers: ReadonlySet<string>
  core: RuntimeModuleEntry
  rewriteKey: string
}

type RuntimePluginSupportState = typeof globalThis & {
  [runtimePluginSupportInstalledKey]?: RuntimePluginSupportInstall
}

const loadThreeRuntimeModule = async (): Promise<Record<string, unknown>> => {
  try {
    return (await importRuntimeModule(THREE_RUNTIME_SPECIFIER)) as Record<string, unknown>
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Failed to load @opentui/three runtime module. Install @opentui/three in the host app before loading 3D plugins. ${message}`,
    )
  }
}

function importRuntimeModule(specifier: string): Promise<Record<string, unknown>> {
  return import(specifier) as Promise<Record<string, unknown>>
}

const defaultRuntimeModules: Record<string, RuntimeModuleEntry> = {
  [THREE_RUNTIME_SPECIFIER]: loadThreeRuntimeModule,
  "@opentui/solid": solidRuntime as Record<string, unknown>,
  "solid-js": solidJsRuntime as Record<string, unknown>,
  "solid-js/store": solidJsStoreRuntime as Record<string, unknown>,
}

function normalizeRewriteKey(rewrite: RuntimePluginRewriteOptions | undefined): string {
  return `${rewrite?.nodeModulesRuntimeSpecifiers ?? true}:${rewrite?.nodeModulesBareSpecifiers ?? false}`
}

function createRuntimeModules(options?: SolidRuntimePluginSupportOptions): Record<string, RuntimeModuleEntry> {
  return {
    ...defaultRuntimeModules,
    ...(options?.additional ?? {}),
  }
}

function assertCompatibleInstall(
  install: RuntimePluginSupportInstall,
  modules: Record<string, RuntimeModuleEntry>,
  options?: SolidRuntimePluginSupportOptions,
): void {
  for (const specifier of Object.keys(modules)) {
    if (!install.specifiers.has(specifier)) {
      throw new Error(
        `OpenTUI Solid runtime plugin support is already installed without ${specifier}. Call ensureRuntimePluginSupport({ additional }) from @opentui/solid/runtime-plugin-support/configure before importing @opentui/solid/runtime-plugin-support.`,
      )
    }
  }

  if (options?.core && options.core !== install.core) {
    throw new Error("OpenTUI Solid runtime plugin support is already installed with a different core runtime module.")
  }

  if (options?.rewrite && normalizeRewriteKey(options.rewrite) !== install.rewriteKey) {
    throw new Error("OpenTUI Solid runtime plugin support is already installed with different rewrite options.")
  }
}

export function ensureRuntimePluginSupport(options: SolidRuntimePluginSupportOptions = {}): boolean {
  const state = globalThis as RuntimePluginSupportState
  const modules = createRuntimeModules(options)
  const core = options.core ?? (coreRuntime as Record<string, unknown>)
  const rewriteKey = normalizeRewriteKey(options.rewrite)

  const install = state[runtimePluginSupportInstalledKey]
  if (install) {
    assertCompatibleInstall(install, modules, options)
    return false
  }

  ensureSolidTransformPlugin({
    moduleName: runtimeModuleIdForSpecifier("@opentui/solid"),
    resolvePath(specifier) {
      if (!isCoreRuntimeModuleSpecifier(specifier) && !modules[specifier]) {
        return null
      }

      return runtimeModuleIdForSpecifier(specifier)
    },
  })

  registerBunPlugin(
    createRuntimePlugin({
      core,
      additional: modules,
      rewrite: options.rewrite,
    }),
  )

  state[runtimePluginSupportInstalledKey] = {
    specifiers: new Set(Object.keys(modules)),
    core,
    rewriteKey,
  }
  return true
}
