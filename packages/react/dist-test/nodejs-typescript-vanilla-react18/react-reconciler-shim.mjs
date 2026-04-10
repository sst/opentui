// ESM wrapper for react-reconciler that patches API differences between
// react-reconciler 0.29 (React 18) and 0.32 (React 19).
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const Reconciler = require("react-reconciler")
const constants = require("react-reconciler/constants")

function PatchedReconciler(hostConfig) {
  // react-reconciler 0.29 requires getCurrentEventPriority in the host config,
  // but 0.32 removed it. Provide a default that returns DefaultEventPriority.
  const patchedConfig = { ...hostConfig }
  if (!patchedConfig.getCurrentEventPriority) {
    patchedConfig.getCurrentEventPriority = () => constants.DefaultEventPriority
  }

  const instance = Reconciler(patchedConfig)

  // 0.32 added flushSyncWork; 0.29 has flushSync instead.
  if (!instance.flushSyncWork && instance.flushSync) {
    instance.flushSyncWork = instance.flushSync
  }

  // 0.32 allows injectIntoDevTools() with no args; 0.29 requires a config object.
  const originalInject = instance.injectIntoDevTools
  instance.injectIntoDevTools = function (config) {
    if (!config) {
      return originalInject.call(this, {
        bundleType: 0,
        version: "18.3.1",
        rendererPackageName: "@opentui/react",
      })
    }
    return originalInject.call(this, config)
  }

  return instance
}

export default PatchedReconciler
