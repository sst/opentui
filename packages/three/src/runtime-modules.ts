import type { RuntimeModuleEntry } from "@lexwdex-org/core/runtime-plugin"
import * as threeRuntime from "@lexwdex-org/three"

export const runtimeModules = {
  "@lexwdex-org/three": threeRuntime,
} satisfies Record<string, RuntimeModuleEntry>
