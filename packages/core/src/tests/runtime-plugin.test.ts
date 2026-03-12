import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import * as coreRuntime from "../index"
import { createRuntimePlugin, runtimeModuleIdForSpecifier } from "../runtime-plugin"

type ResolveResult = { path: string; namespace?: string } | void
type ResolveCallback = (args: { path: string; importer: string }) => ResolveResult | Promise<ResolveResult>
type LoadCallback = (args: { path: string }) => unknown | Promise<unknown>
type ModuleCallback = () => unknown | Promise<unknown>

type ResolveHandler = {
  filter: RegExp
  callback: ResolveCallback
}

type MockBuild = {
  onResolve: (args: { filter: RegExp }, callback: ResolveCallback) => void
  onLoad: (args: { filter: RegExp }, callback: LoadCallback) => void
  module: (path: string, callback: ModuleCallback) => void
}

const createMockBuild = (): {
  build: MockBuild
  resolveHandlers: ResolveHandler[]
  modules: Map<string, ModuleCallback>
} => {
  const resolveHandlers: ResolveHandler[] = []
  const modules = new Map<string, ModuleCallback>()

  const build: MockBuild = {
    onResolve(args, callback) {
      resolveHandlers.push({ filter: args.filter, callback })
    },
    onLoad() {
      return
    },
    module(path, callback) {
      modules.set(path, callback)
    },
  }

  return { build, resolveHandlers, modules }
}

const resolveSpecifier = async (handlers: ResolveHandler[], specifier: string): Promise<ResolveResult> => {
  for (const handler of handlers) {
    if (!handler.filter.test(specifier)) continue

    const result = await handler.callback({
      path: specifier,
      importer: import.meta.path,
    })

    if (result) {
      return result
    }
  }

  return undefined
}

describe("runtime plugin", () => {
  it("registers core runtime modules by default", async () => {
    const { build, resolveHandlers, modules } = createMockBuild()
    createRuntimePlugin().setup(build as any)

    const coreResolution = await resolveSpecifier(resolveHandlers, "@opentui/core")
    const core3dResolution = await resolveSpecifier(resolveHandlers, "@opentui/core/3d")
    const coreTestingResolution = await resolveSpecifier(resolveHandlers, "@opentui/core/testing")

    expect(coreResolution).toEqual({ path: runtimeModuleIdForSpecifier("@opentui/core") })
    expect(core3dResolution).toEqual({ path: runtimeModuleIdForSpecifier("@opentui/core/3d") })
    expect(coreTestingResolution).toEqual({ path: runtimeModuleIdForSpecifier("@opentui/core/testing") })

    if (!coreResolution || !core3dResolution || !coreTestingResolution) {
      throw new Error("Expected core runtime module resolutions")
    }

    const coreModuleFactory = modules.get(coreResolution.path)
    const core3dModuleFactory = modules.get(core3dResolution.path)
    const coreTestingModuleFactory = modules.get(coreTestingResolution.path)

    expect(coreModuleFactory).toBeDefined()
    expect(core3dModuleFactory).toBeDefined()
    expect(coreTestingModuleFactory).toBeDefined()

    if (!coreModuleFactory || !core3dModuleFactory || !coreTestingModuleFactory) {
      throw new Error("Expected core runtime module factories")
    }

    expect(await coreModuleFactory()).toEqual({
      exports: coreRuntime as Record<string, unknown>,
      loader: "object",
    })

    const coreTestingModule = (await coreTestingModuleFactory()) as {
      exports: Record<string, unknown>
      loader: string
    }

    expect(coreTestingModule.loader).toBe("object")
    expect(typeof coreTestingModule.exports.createTestRenderer).toBe("function")
  })

  it("registers additional runtime modules with sync and async loaders", async () => {
    const { build, resolveHandlers, modules } = createMockBuild()

    createRuntimePlugin({
      core: { marker: "core" },
      additional: {
        "fixture-sync": { value: "sync-value" },
        "@fixture/async-module": async () => ({ value: "async-value" }),
      },
    }).setup(build as any)

    const coreResolution = await resolveSpecifier(resolveHandlers, "@opentui/core")
    const syncResolution = await resolveSpecifier(resolveHandlers, "fixture-sync")
    const asyncResolution = await resolveSpecifier(resolveHandlers, "@fixture/async-module")

    expect(coreResolution).toEqual({ path: runtimeModuleIdForSpecifier("@opentui/core") })
    expect(syncResolution).toEqual({ path: runtimeModuleIdForSpecifier("fixture-sync") })
    expect(asyncResolution).toEqual({ path: runtimeModuleIdForSpecifier("@fixture/async-module") })

    if (!coreResolution || !syncResolution || !asyncResolution) {
      throw new Error("Expected runtime module resolutions")
    }

    const coreModuleFactory = modules.get(coreResolution.path)
    const syncModuleFactory = modules.get(syncResolution.path)
    const asyncModuleFactory = modules.get(asyncResolution.path)

    expect(coreModuleFactory).toBeDefined()
    expect(syncModuleFactory).toBeDefined()
    expect(asyncModuleFactory).toBeDefined()

    if (!coreModuleFactory || !syncModuleFactory || !asyncModuleFactory) {
      throw new Error("Expected runtime module factories")
    }

    expect(await coreModuleFactory()).toEqual({ exports: { marker: "core" }, loader: "object" })
    expect(await syncModuleFactory()).toEqual({ exports: { value: "sync-value" }, loader: "object" })
    expect(await asyncModuleFactory()).toEqual({ exports: { value: "async-value" }, loader: "object" })
  })

  it("escapes exact-match resolver filters for special characters", async () => {
    const { build, resolveHandlers } = createMockBuild()

    createRuntimePlugin({
      additional: {
        "fixture.with.dot": { value: "dot-value" },
      },
    }).setup(build as any)

    const exactMatch = await resolveSpecifier(resolveHandlers, "fixture.with.dot")
    const nonMatch = await resolveSpecifier(resolveHandlers, "fixtureXwithXdot")

    expect(exactMatch).toEqual({ path: runtimeModuleIdForSpecifier("fixture.with.dot") })
    expect(nonMatch).toBeUndefined()
  })

  it("encodes runtime module IDs deterministically", () => {
    expect(runtimeModuleIdForSpecifier("@opentui/core/testing")).toBe(
      "opentui:runtime-module:%40opentui%2Fcore%2Ftesting",
    )
  })

  it("resolves runtime modules end-to-end in a subprocess", () => {
    const fixturePath = join(import.meta.dir, "runtime-plugin.fixture.ts")
    const result = Bun.spawnSync([process.execPath, fixturePath], {
      cwd: join(import.meta.dir, "..", ".."),
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    })

    const stdout = result.stdout.toString().trim()
    const stderr = result.stderr.toString().trim()

    if (stdout) {
      console.debug(`[runtime-plugin.fixture] stdout:\n${stdout}`)
    }

    if (stderr) {
      console.debug(`[runtime-plugin.fixture] stderr:\n${stderr}`)
    }

    expect(result.exitCode).toBe(0)
    expect(stdout).toContain("core=core-value;coreTesting=true;sync=sync-value;async=async-value")
  })
})
