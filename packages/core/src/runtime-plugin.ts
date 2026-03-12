import { type BunPlugin } from "bun"
import * as coreRuntime from "./index"

export type RuntimeModuleExports = Record<string, unknown>
export type RuntimeModuleLoader = () => RuntimeModuleExports | Promise<RuntimeModuleExports>
export type RuntimeModuleEntry = RuntimeModuleExports | RuntimeModuleLoader

export interface CreateRuntimePluginOptions {
  core?: RuntimeModuleEntry
  additional?: Record<string, RuntimeModuleEntry>
}

const CORE_RUNTIME_SPECIFIER = "@opentui/core"
const CORE_3D_RUNTIME_SPECIFIER = "@opentui/core/3d"
const CORE_TESTING_RUNTIME_SPECIFIER = "@opentui/core/testing"
const RUNTIME_MODULE_PREFIX = "opentui:runtime-module:"

const DEFAULT_CORE_RUNTIME_MODULE_SPECIFIERS = [
  CORE_RUNTIME_SPECIFIER,
  CORE_3D_RUNTIME_SPECIFIER,
  CORE_TESTING_RUNTIME_SPECIFIER,
] as const

const DEFAULT_CORE_RUNTIME_MODULE_SPECIFIER_SET = new Set<string>(DEFAULT_CORE_RUNTIME_MODULE_SPECIFIERS)

export const isCoreRuntimeModuleSpecifier = (specifier: string): boolean => {
  return DEFAULT_CORE_RUNTIME_MODULE_SPECIFIER_SET.has(specifier)
}

const loadCore3dRuntimeModule = async (): Promise<RuntimeModuleExports> => {
  return (await import("@opentui/three")) as RuntimeModuleExports
}

const loadCoreTestingRuntimeModule = async (): Promise<RuntimeModuleExports> => {
  return (await import("./testing")) as RuntimeModuleExports
}

const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const exactSpecifierFilter = (specifier: string): RegExp => {
  return new RegExp(`^${escapeRegExp(specifier)}$`)
}

export const runtimeModuleIdForSpecifier = (specifier: string): string => {
  return `${RUNTIME_MODULE_PREFIX}${encodeURIComponent(specifier)}`
}

const resolveRuntimeModuleExports = async (moduleEntry: RuntimeModuleEntry): Promise<RuntimeModuleExports> => {
  if (typeof moduleEntry === "function") {
    return await moduleEntry()
  }

  return moduleEntry
}

const runtimeLoaderForPath = (path: string): "js" | "ts" | "jsx" | "tsx" | null => {
  if (path.endsWith(".tsx")) {
    return "tsx"
  }

  if (path.endsWith(".jsx")) {
    return "jsx"
  }

  if (path.endsWith(".ts") || path.endsWith(".mts") || path.endsWith(".cts")) {
    return "ts"
  }

  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) {
    return "js"
  }

  return null
}

const rewriteRuntimeSpecifiers = (code: string, runtimeModuleIdsBySpecifier: Map<string, string>): string => {
  let transformedCode = code

  for (const [specifier, moduleId] of runtimeModuleIdsBySpecifier.entries()) {
    const escapedSpecifier = escapeRegExp(specifier)

    transformedCode = transformedCode
      .replace(new RegExp(`(from\\s+["'])${escapedSpecifier}(["'])`, "g"), `$1${moduleId}$2`)
      .replace(new RegExp(`(import\\s+["'])${escapedSpecifier}(["'])`, "g"), `$1${moduleId}$2`)
      .replace(new RegExp(`(import\\s*\\(\\s*["'])${escapedSpecifier}(["']\\s*\\))`, "g"), `$1${moduleId}$2`)
      .replace(new RegExp(`(require\\s*\\(\\s*["'])${escapedSpecifier}(["']\\s*\\))`, "g"), `$1${moduleId}$2`)
  }

  return transformedCode
}

export function createRuntimePlugin(input: CreateRuntimePluginOptions = {}): BunPlugin {
  const runtimeModules = new Map<string, RuntimeModuleEntry>()
  runtimeModules.set(CORE_RUNTIME_SPECIFIER, input.core ?? (coreRuntime as RuntimeModuleExports))
  runtimeModules.set(CORE_3D_RUNTIME_SPECIFIER, loadCore3dRuntimeModule)
  runtimeModules.set(CORE_TESTING_RUNTIME_SPECIFIER, loadCoreTestingRuntimeModule)

  for (const [specifier, moduleEntry] of Object.entries(input.additional ?? {})) {
    runtimeModules.set(specifier, moduleEntry)
  }

  const runtimeModuleIdsBySpecifier = new Map<string, string>()
  for (const specifier of runtimeModules.keys()) {
    runtimeModuleIdsBySpecifier.set(specifier, runtimeModuleIdForSpecifier(specifier))
  }

  return {
    name: "bun-plugin-opentui-runtime-modules",
    setup: (build) => {
      for (const [specifier, moduleEntry] of runtimeModules.entries()) {
        const moduleId = runtimeModuleIdsBySpecifier.get(specifier)

        if (!moduleId) {
          continue
        }

        build.module(moduleId, async () => ({
          exports: await resolveRuntimeModuleExports(moduleEntry),
          loader: "object",
        }))

        build.onResolve({ filter: exactSpecifierFilter(specifier) }, () => ({ path: moduleId }))
      }

      build.onLoad({ filter: /\.(?:[cm]?js|[cm]?ts|jsx|tsx)$/ }, async (args) => {
        const loader = runtimeLoaderForPath(args.path)
        if (!loader) {
          return undefined
        }

        const file = Bun.file(args.path)
        const contents = await file.text()
        const transformedContents = rewriteRuntimeSpecifiers(contents, runtimeModuleIdsBySpecifier)

        return {
          contents: transformedContents,
          loader,
        }
      })
    },
  }
}
