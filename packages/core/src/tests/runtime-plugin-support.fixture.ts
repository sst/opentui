import { plugin as registerPlugin } from "bun"

registerPlugin.clearAll()

try {
  const runtimePluginSupport = await import("../runtime-plugin-support")
  const alreadyInstalled = runtimePluginSupport.ensureRuntimePluginSupport() === false
  console.log(`idempotent=${alreadyInstalled}`)
} finally {
  registerPlugin.clearAll()
}
