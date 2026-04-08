export interface KeyBinding<Action extends string = string> {
  name: string
  ctrl?: boolean
  shift?: boolean
  meta?: boolean
  super?: boolean
  action: Action
}

export type KeyAliasMap = Record<string, string>

export const defaultKeyAliases: KeyAliasMap = {
  enter: "return",
  esc: "escape",
  kp0: "0",
  kp1: "1",
  kp2: "2",
  kp3: "3",
  kp4: "4",
  kp5: "5",
  kp6: "6",
  kp7: "7",
  kp8: "8",
  kp9: "9",
  kpdecimal: ".",
  kpdivide: "/",
  kpmultiply: "*",
  kpminus: "-",
  kpplus: "+",
  kpenter: "enter",
  kpequal: "=",
  kpseparator: ",",
  kpleft: "left",
  kpright: "right",
  kpup: "up",
  kpdown: "down",
  kppageup: "pageup",
  kppagedown: "pagedown",
  kphome: "home",
  kpend: "end",
  kpinsert: "insert",
  kpdelete: "delete",
}

export function mergeKeyAliases(defaults: KeyAliasMap, custom: KeyAliasMap): KeyAliasMap {
  return { ...defaults, ...custom }
}

export function mergeKeyBindings<Action extends string>(
  defaults: KeyBinding<Action>[],
  custom: KeyBinding<Action>[],
): KeyBinding<Action>[] {
  const map = new Map<string, KeyBinding<Action>>()
  for (const binding of defaults) {
    const key = getKeyBindingKey(binding)
    map.set(key, binding)
  }
  for (const binding of custom) {
    const key = getKeyBindingKey(binding)
    map.set(key, binding)
  }
  return Array.from(map.values())
}

export function getKeyBindingKey<Action extends string>(binding: KeyBinding<Action>): string {
  return `${binding.name}:${binding.ctrl ? 1 : 0}:${binding.shift ? 1 : 0}:${binding.meta ? 1 : 0}:${binding.super ? 1 : 0}`
}

export function buildKeyBindingsMap<Action extends string>(
  bindings: KeyBinding<Action>[],
  aliasMap?: KeyAliasMap,
): Map<string, Action> {
  const map = new Map<string, Action>()
  const aliases = aliasMap || {}

  for (const binding of bindings) {
    const key = getKeyBindingKey(binding)
    map.set(key, binding.action)
  }

  // Add aliased versions of all bindings
  for (const binding of bindings) {
    const normalizedName = aliases[binding.name] || binding.name
    if (normalizedName !== binding.name) {
      // Create aliased key with normalized name
      const aliasedKey = getKeyBindingKey({ ...binding, name: normalizedName })
      map.set(aliasedKey, binding.action)
    }
  }

  return map
}

/**
 * Converts a key binding to a human-readable string representation
 * @param binding The key binding to stringify
 * @returns A string like "ctrl+shift+y" or just "escape"
 * @example
 * keyBindingToString({ name: "y", ctrl: true, shift: true }) // "ctrl+shift+y"
 * keyBindingToString({ name: "escape" }) // "escape"
 * keyBindingToString({ name: "c", ctrl: true }) // "ctrl+c"
 * keyBindingToString({ name: "s", super: true }) // "super+s"
 */
export function keyBindingToString<Action extends string>(binding: KeyBinding<Action>): string {
  const parts: string[] = []

  if (binding.ctrl) parts.push("ctrl")
  if (binding.shift) parts.push("shift")
  if (binding.meta) parts.push("meta")
  if (binding.super) parts.push("super")

  parts.push(binding.name)

  return parts.join("+")
}
