import type { RuntimeModuleEntry } from "@opentui/core/runtime-plugin"
import * as keymap from "@opentui/keymap"
import * as keymapExtras from "@opentui/keymap/extras"
import * as keymapAddons from "@opentui/keymap/addons"
import * as keymapOpenTuiAddons from "@opentui/keymap/addons/opentui"
import * as keymapHtml from "@opentui/keymap/html"
import * as keymapOpenTui from "@opentui/keymap/opentui"
import * as keymapReact from "@opentui/keymap/react"
import * as keymapSolid from "@opentui/keymap/solid"

export const runtimeModules = {
  "@opentui/keymap": keymap,
  "@opentui/keymap/extras": keymapExtras,
  "@opentui/keymap/addons": keymapAddons,
  "@opentui/keymap/addons/opentui": keymapOpenTuiAddons,
  "@opentui/keymap/html": keymapHtml,
  "@opentui/keymap/opentui": keymapOpenTui,
  "@opentui/keymap/react": keymapReact,
  "@opentui/keymap/solid": keymapSolid,
} satisfies Record<string, RuntimeModuleEntry>
