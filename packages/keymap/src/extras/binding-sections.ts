import type { BindingInput, KeyLike, KeymapEvent } from "../types.js"

export type BindingSectionItem<TTarget extends object = object, TEvent extends KeymapEvent = KeymapEvent> =
  | KeyLike
  | BindingInput<TTarget, TEvent>

export type BindingValue<TTarget extends object = object, TEvent extends KeymapEvent = KeymapEvent> =
  | false
  | BindingSectionItem<TTarget, TEvent>
  | readonly BindingSectionItem<TTarget, TEvent>[]

export type BindingSectionConfig<TTarget extends object = object, TEvent extends KeymapEvent = KeymapEvent> = Readonly<
  Record<string, BindingValue<TTarget, TEvent>>
>

export type BindingSectionsConfig<TTarget extends object = object, TEvent extends KeymapEvent = KeymapEvent> = Readonly<
  Record<string, BindingSectionConfig<TTarget, TEvent>>
>

export interface ResolvedBindingSections<TTarget extends object = object, TEvent extends KeymapEvent = KeymapEvent> {
  sections: Record<string, BindingInput<TTarget, TEvent>[]>
  get(section: string, cmd: string): readonly BindingInput<TTarget, TEvent>[] | undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function isKeyLike(value: unknown): value is KeyLike {
  return typeof value === "string" || isObject(value)
}

function cloneKeyLike(key: KeyLike): KeyLike {
  if (typeof key === "string") {
    return key
  }

  return { ...key }
}

function invalidBindingValue(section: string, command: string, index?: number): Error {
  const location = index === undefined ? `"${section}.${command}"` : `"${section}.${command}" at index ${index}`
  return new Error(
    `Invalid binding value for ${location}: expected false, a key, a binding object, or an array of keys/binding objects`,
  )
}

function resolveBindingItem<TTarget extends object, TEvent extends KeymapEvent>(
  section: string,
  command: string,
  item: BindingSectionItem<TTarget, TEvent>,
  index?: number,
): BindingInput<TTarget, TEvent> {
  if (!isKeyLike(item)) {
    throw invalidBindingValue(section, command, index)
  }

  if (typeof item === "string" || !("key" in item)) {
    return {
      key: cloneKeyLike(item),
      cmd: command,
    }
  }

  const key = item.key
  if (!isKeyLike(key)) {
    throw invalidBindingValue(section, command, index)
  }

  return {
    ...item,
    key: cloneKeyLike(key),
    cmd: command,
  }
}

function resolveBindingValue<TTarget extends object, TEvent extends KeymapEvent>(
  section: string,
  command: string,
  value: BindingValue<TTarget, TEvent>,
): BindingInput<TTarget, TEvent>[] | undefined {
  if (value === false) {
    return undefined
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return undefined
    }

    const items = value as readonly BindingSectionItem<TTarget, TEvent>[]
    return items.map((item, index) => resolveBindingItem(section, command, item, index))
  }

  return [resolveBindingItem(section, command, value as BindingSectionItem<TTarget, TEvent>)]
}

export function resolveBindingSections<TTarget extends object = object, TEvent extends KeymapEvent = KeymapEvent>(
  config: BindingSectionsConfig<TTarget, TEvent>,
): ResolvedBindingSections<TTarget, TEvent> {
  const sections: Record<string, BindingInput<TTarget, TEvent>[]> = {}
  const lookups = new Map<string, Map<string, BindingInput<TTarget, TEvent>[]>>()

  for (const [section, sectionConfig] of Object.entries(config)) {
    if (!isObject(sectionConfig)) {
      throw new Error(`Invalid binding section "${section}": expected an object`)
    }

    const sectionLookup = new Map<string, BindingInput<TTarget, TEvent>[]>()

    for (const [rawCommand, value] of Object.entries(sectionConfig)) {
      const command = rawCommand.trim()
      const bindings = resolveBindingValue(section, command, value)

      if (!bindings) {
        sectionLookup.delete(command)
        continue
      }

      sectionLookup.set(command, bindings)
    }

    sections[section] = Array.from(sectionLookup.values()).flat()
    lookups.set(section, sectionLookup)
  }

  return {
    sections,
    get(section, cmd) {
      return lookups.get(section)?.get(cmd.trim())
    },
  }
}
