import type { RuntimeModuleEntry } from "@opentui/core/runtime-plugin"

export const runtimeModules = {
  "@opentui/keymap": () => import("./index.js"),
  "@opentui/keymap/extras": () => import("./extras/index.js"),
  "@opentui/keymap/addons": () => import("./addons/index.js"),
  "@opentui/keymap/addons/opentui": () => import("./addons/opentui/index.js"),
  "@opentui/keymap/html": () => import("./html.js"),
  "@opentui/keymap/opentui": () => import("./opentui.js"),
  "@opentui/keymap/react": () => import("./react/index.js"),
  "@opentui/keymap/solid": () => import("./solid/index.js"),
} satisfies Record<string, RuntimeModuleEntry>
