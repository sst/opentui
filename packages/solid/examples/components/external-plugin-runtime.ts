import { runtimeModules as threeRuntimeModules } from "@lexwdex-org/three/runtime-modules"
import { ensureRuntimePluginSupport } from "@lexwdex-org/solid/runtime-plugin-support/configure"

ensureRuntimePluginSupport({
  additional: threeRuntimeModules,
})
