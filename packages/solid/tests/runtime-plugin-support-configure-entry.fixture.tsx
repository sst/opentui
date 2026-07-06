import { registerDefaultKeys } from "@lexwdex-org/keymap/addons"
import { commandBindings } from "@lexwdex-org/keymap/extras"
import { useKeymapSelector } from "@lexwdex-org/keymap/solid"
import { stringifyKeyStroke } from "@lexwdex-org/keymap"
import { ThreeRenderable } from "@lexwdex-org/three"
import { createSignal } from "solid-js"

type FixtureState = typeof globalThis & {
  __solidRuntimeHost__?: {
    keymap: Record<string, unknown>
    keymapAddons: Record<string, unknown>
    keymapExtras: Record<string, unknown>
    keymapSolid: Record<string, unknown>
    three: Record<string, unknown>
  }
}

const state = globalThis as FixtureState
const [value] = createSignal("ok")
const makeNode = () => <text>{value()}</text>
const host = state.__solidRuntimeHost__
const checks = [
  `keymap=${stringifyKeyStroke === host?.keymap.stringifyKeyStroke}`,
  `keymapAddons=${registerDefaultKeys === host?.keymapAddons.registerDefaultKeys}`,
  `keymapExtras=${commandBindings === host?.keymapExtras.commandBindings}`,
  `keymapSolid=${useKeymapSelector === host?.keymapSolid.useKeymapSelector}`,
  `three=${ThreeRenderable === host?.three.ThreeRenderable}`,
  `jsx=${typeof makeNode === "function"}`,
]

console.log(checks.join(";"))

export const noop = 1
