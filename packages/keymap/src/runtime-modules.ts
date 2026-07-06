import type { RuntimeModuleEntry, RuntimeModuleExports } from "@lexwdex-org/core/runtime-plugin"
import * as keymap from "@lexwdex-org/keymap"
import * as keymapExtras from "@lexwdex-org/keymap/extras"
import * as keymapGraphExtra from "@lexwdex-org/keymap/extras/graph"
import * as keymapAddons from "@lexwdex-org/keymap/addons"
import * as keymapOpenTuiAddons from "@lexwdex-org/keymap/addons/opentui"
import * as keymapHtml from "@lexwdex-org/keymap/html"
import * as keymapOpenTui from "@lexwdex-org/keymap/opentui"

const loadKeymapReact = async (): Promise<RuntimeModuleExports> => {
  return (await import("@lexwdex-org/keymap/react")) as RuntimeModuleExports
}

const loadKeymapSolid = async (): Promise<RuntimeModuleExports> => {
  return (await import("@lexwdex-org/keymap/solid")) as RuntimeModuleExports
}

export const runtimeModules = {
  "@lexwdex-org/keymap": keymap,
  "@lexwdex-org/keymap/extras": keymapExtras,
  "@lexwdex-org/keymap/extras/graph": keymapGraphExtra,
  "@lexwdex-org/keymap/addons": keymapAddons,
  "@lexwdex-org/keymap/addons/opentui": keymapOpenTuiAddons,
  "@lexwdex-org/keymap/html": keymapHtml,
  "@lexwdex-org/keymap/opentui": keymapOpenTui,
  "@lexwdex-org/keymap/react": loadKeymapReact,
  "@lexwdex-org/keymap/solid": loadKeymapSolid,
} satisfies Record<string, RuntimeModuleEntry>
