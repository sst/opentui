import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { plugin as registerPlugin } from "bun"
import * as keymapRuntime from "@opentui/keymap"
import * as keymapAddonsRuntime from "@opentui/keymap/addons"
import * as keymapExtrasRuntime from "@opentui/keymap/extras"
import { runtimeModules as keymapRuntimeModules } from "@opentui/keymap/runtime-modules"
import * as keymapSolidRuntime from "@opentui/keymap/solid"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"
import * as threeRuntime from "../../three/src/index.js"
import { runtimeModules as threeRuntimeModules } from "../../three/src/runtime-modules.js"
import { resetSolidTransformPluginState } from "../scripts/solid-plugin.js"

type FixtureState = typeof globalThis & {
  __solidRuntimeHost__?: {
    keymap: Record<string, unknown>
    keymapAddons: Record<string, unknown>
    keymapExtras: Record<string, unknown>
    keymapSolid: Record<string, unknown>
    three: Record<string, unknown>
  }
}

const tempRoot = mkdtempSync(join(tmpdir(), "solid-runtime-plugin-support-configure-fixture-"))
const entryPath = join(tempRoot, "entry.tsx")

const source = [
  'import { stringifyKeyStroke } from "@opentui/keymap"',
  'import { registerDefaultKeys } from "@opentui/keymap/addons"',
  'import { commandBindings } from "@opentui/keymap/extras"',
  'import { useKeymapSelector } from "@opentui/keymap/solid"',
  'import { ThreeRenderable } from "@opentui/three"',
  'import { createSignal } from "solid-js"',
  "const state = globalThis as { __solidRuntimeHost__?: { keymap: Record<string, unknown>; keymapAddons: Record<string, unknown>; keymapExtras: Record<string, unknown>; keymapSolid: Record<string, unknown>; three: Record<string, unknown> } }",
  "const [value] = createSignal('ok')",
  "const makeNode = () => <text>{value()}</text>",
  "const host = state.__solidRuntimeHost__",
  "const checks = [",
  "  `keymap=${stringifyKeyStroke === host?.keymap.stringifyKeyStroke}`,",
  "  `keymapAddons=${registerDefaultKeys === host?.keymapAddons.registerDefaultKeys}`,",
  "  `keymapExtras=${commandBindings === host?.keymapExtras.commandBindings}`,",
  "  `keymapSolid=${useKeymapSelector === host?.keymapSolid.useKeymapSelector}`,",
  "  `three=${ThreeRenderable === host?.three.ThreeRenderable}`,",
  "  `jsx=${typeof makeNode === 'function'}`,",
  "]",
  "console.log(checks.join(';'))",
  "export const noop = 1",
].join("\n")

writeFileSync(entryPath, source)

const state = globalThis as FixtureState
state.__solidRuntimeHost__ = {
  keymap: keymapRuntime as Record<string, unknown>,
  keymapAddons: keymapAddonsRuntime as Record<string, unknown>,
  keymapExtras: keymapExtrasRuntime as Record<string, unknown>,
  keymapSolid: keymapSolidRuntime as Record<string, unknown>,
  three: threeRuntime as Record<string, unknown>,
}

registerPlugin.clearAll()
resetSolidTransformPluginState()

try {
  const additional = {
    ...keymapRuntimeModules,
    ...threeRuntimeModules,
  }
  const first = ensureRuntimePluginSupport({ additional })
  const second = ensureRuntimePluginSupport({ additional })
  console.log(`first=${first};second=${second}`)
  await import(entryPath)
} finally {
  registerPlugin.clearAll()
  delete state.__solidRuntimeHost__
  rmSync(tempRoot, { recursive: true, force: true })
}
