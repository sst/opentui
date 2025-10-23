export interface KeyBinding<Action extends string = string> {
  name: string
  ctrl?: boolean
  shift?: boolean
  meta?: boolean
  action: Action
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
  return `${binding.name}:${!!binding.ctrl}:${!!binding.shift}:${!!binding.meta}`
}

export function buildKeyBindingsMap<Action extends string>(bindings: KeyBinding<Action>[]): Map<string, Action> {
  const map = new Map<string, Action>()
  for (const binding of bindings) {
    const key = getKeyBindingKey(binding)
    map.set(key, binding.action)
  }
  return map
}
