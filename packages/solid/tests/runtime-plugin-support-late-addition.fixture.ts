import { plugin as registerPlugin } from "bun"
import { runtimeModules as keymapRuntimeModules } from "@lexwdex-org/keymap/runtime-modules"
import { ensureRuntimePluginSupport } from "@lexwdex-org/solid/runtime-plugin-support/configure"
import { resetSolidTransformPluginState } from "../scripts/solid-plugin.js"

registerPlugin.clearAll()
resetSolidTransformPluginState()

try {
  await import("@lexwdex-org/solid/runtime-plugin-support")
  ensureRuntimePluginSupport({ additional: keymapRuntimeModules })
} catch (error) {
  console.log(error instanceof Error ? error.message : String(error))
} finally {
  registerPlugin.clearAll()
}
