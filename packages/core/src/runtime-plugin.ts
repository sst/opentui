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
const CORE_TESTING_RUNTIME_SPECIFIER = "@opentui/core/testing"
const RUNTIME_MODULE_PREFIX = "opentui:runtime-module:"
const MAX_RUNTIME_RESOLVE_PARENTS = 64

const DEFAULT_CORE_RUNTIME_MODULE_SPECIFIERS = [CORE_RUNTIME_SPECIFIER, CORE_TESTING_RUNTIME_SPECIFIER] as const

const DEFAULT_CORE_RUNTIME_MODULE_SPECIFIER_SET = new Set<string>(DEFAULT_CORE_RUNTIME_MODULE_SPECIFIERS)

export const isCoreRuntimeModuleSpecifier = (specifier: string): boolean => {
  return DEFAULT_CORE_RUNTIME_MODULE_SPECIFIER_SET.has(specifier)
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

const sourcePath = (path: string): string => {
  const searchIndex = path.indexOf("?")
  const hashIndex = path.indexOf("#")
  const end = [searchIndex, hashIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0]
  return end === undefined ? path : path.slice(0, end)
}

const runtimeLoaderForPath = (path: string): "js" | "ts" | "jsx" | "tsx" | null => {
  const cleanPath = sourcePath(path)

  if (cleanPath.endsWith(".tsx")) {
    return "tsx"
  }

  if (cleanPath.endsWith(".jsx")) {
    return "jsx"
  }

  if (cleanPath.endsWith(".ts") || cleanPath.endsWith(".mts") || cleanPath.endsWith(".cts")) {
    return "ts"
  }

  if (cleanPath.endsWith(".js") || cleanPath.endsWith(".mjs") || cleanPath.endsWith(".cjs")) {
    return "js"
  }

  return null
}

const runtimeSourceFilter = /^(?!.*(?:\/|\\)node_modules(?:\/|\\)).*\.(?:[cm]?js|[cm]?ts|jsx|tsx)(?:[?#].*)?$/

const resolveImportSpecifierPatterns = [
  /(from\s+["'])([^"']+)(["'])/g,
  /(import\s+["'])([^"']+)(["'])/g,
  /(import\s*\(\s*["'])([^"']+)(["']\s*\))/g,
  /(require\s*\(\s*["'])([^"']+)(["']\s*\))/g,
] as const

const isBareSpecifier = (specifier: string): boolean => {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("\\")) {
    return false
  }

  if (
    specifier.startsWith("node:") ||
    specifier.startsWith("bun:") ||
    specifier.startsWith("http:") ||
    specifier.startsWith("https:") ||
    specifier.startsWith("file:") ||
    specifier.startsWith("data:")
  ) {
    return false
  }

  if (specifier.startsWith(RUNTIME_MODULE_PREFIX)) {
    return false
  }

  return true
}

const registerResolveParent = (resolveParentsByRecency: string[], resolveParent: string): void => {
  const existingIndex = resolveParentsByRecency.indexOf(resolveParent)
  if (existingIndex >= 0) {
    resolveParentsByRecency.splice(existingIndex, 1)
  }

  resolveParentsByRecency.push(resolveParent)

  if (resolveParentsByRecency.length > MAX_RUNTIME_RESOLVE_PARENTS) {
    resolveParentsByRecency.shift()
  }
}

const rewriteImportSpecifiers = (code: string, resolveReplacement: (specifier: string) => string | null): string => {
  let transformedCode = code

  for (const pattern of resolveImportSpecifierPatterns) {
    transformedCode = transformedCode.replace(pattern, (fullMatch, prefix, specifier, suffix) => {
      const replacement = resolveReplacement(specifier)
      if (!replacement || replacement === specifier) {
        return fullMatch
      }

      return `${prefix}${replacement}${suffix}`
    })
  }

  return transformedCode
}

const resolveFromParent = (specifier: string, parent: string): string | null => {
  try {
    const resolvedSpecifier = import.meta.resolve(specifier, parent)
    if (
      resolvedSpecifier === specifier ||
      resolvedSpecifier.startsWith("node:") ||
      resolvedSpecifier.startsWith("bun:")
    ) {
      return null
    }

    return resolvedSpecifier
  } catch {
    return null
  }
}

const rewriteImportsFromResolveParents = (code: string, resolveParentsByRecency: string[]): string => {
  if (resolveParentsByRecency.length === 0) {
    return code
  }

  const resolveFromParents = (specifier: string): string | null => {
    if (!isBareSpecifier(specifier)) {
      return null
    }

    for (let index = resolveParentsByRecency.length - 1; index >= 0; index -= 1) {
      const resolveParent = resolveParentsByRecency[index]
      const resolvedSpecifier = resolveFromParent(specifier, resolveParent)
      if (resolvedSpecifier) {
        return resolvedSpecifier
      }
    }

    return null
  }

  return rewriteImportSpecifiers(code, resolveFromParents)
}

const rewriteRuntimeSpecifiers = (code: string, runtimeModuleIdsBySpecifier: Map<string, string>): string => {
  return rewriteImportSpecifiers(code, (specifier) => {
    const runtimeModuleId = runtimeModuleIdsBySpecifier.get(specifier)
    return runtimeModuleId ?? null
  })
}

export function createRuntimePlugin(input: CreateRuntimePluginOptions = {}): BunPlugin {
  const runtimeModules = new Map<string, RuntimeModuleEntry>()
  runtimeModules.set(CORE_RUNTIME_SPECIFIER, input.core ?? (coreRuntime as RuntimeModuleExports))
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
      const resolveParentsByRecency: string[] = []

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

      build.onLoad({ filter: runtimeSourceFilter }, async (args) => {
        const path = sourcePath(args.path)
        const loader = runtimeLoaderForPath(args.path)
        if (!loader) {
          throw new Error(`Unable to determine runtime loader for path: ${args.path}`)
        }

        const file = Bun.file(path)
        const contents = await file.text()
        const runtimeRewrittenContents = rewriteRuntimeSpecifiers(contents, runtimeModuleIdsBySpecifier)

        if (runtimeRewrittenContents !== contents) {
          registerResolveParent(resolveParentsByRecency, path)
        }

        const transformedContents = rewriteImportsFromResolveParents(runtimeRewrittenContents, resolveParentsByRecency)

        return {
          contents: transformedContents,
          loader,
        }
      })
    },
  }
}
