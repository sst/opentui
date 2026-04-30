import type { RuntimeModuleEntry } from "@opentui/core/runtime-plugin"

export const runtimeModules = {
  "@opentui/three": () => import("./index.js"),
} satisfies Record<string, RuntimeModuleEntry>
