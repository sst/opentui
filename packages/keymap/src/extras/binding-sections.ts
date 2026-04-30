// Opinionated config-to-keymap transformation helper. Treat this as one
// practical shape you can copy and adjust for application-specific needs.
import type { BindingInput, KeyLike, KeymapEvent } from "../types.js"

export type BindingSectionItem<TTarget extends object = object, TEvent extends KeymapEvent = KeymapEvent> =
  | KeyLike
  | BindingInput<TTarget, TEvent>

export type BindingValue<TTarget extends object = object, TEvent extends KeymapEvent = KeymapEvent> =
  | false
  | "none"
  | BindingSectionItem<TTarget, TEvent>
  | readonly BindingSectionItem<TTarget, TEvent>[]

export type BindingSectionConfig<TTarget extends object = object, TEvent extends KeymapEvent = KeymapEvent> = Readonly<
  Record<string, BindingValue<TTarget, TEvent>>
>

export type BindingSectionsConfig<TTarget extends object = object, TEvent extends KeymapEvent = KeymapEvent> = Readonly<
  Record<string, BindingSectionConfig<TTarget, TEvent>>
>

type LiteralStringKeys<T> = string extends Extract<keyof T, string> ? never : Extract<keyof T, string>

const hasOwn = Object.prototype.hasOwnProperty

export interface ResolvedBindingSections<
  TTarget extends object = object,
  TEvent extends KeymapEvent = KeymapEvent,
  TSection extends string = string,
> {
  sections: Record<TSection, BindingInput<TTarget, TEvent>[]>
  get(section: string, cmd: string): readonly BindingInput<TTarget, TEvent>[] | undefined
}

export interface ResolveBindingSectionsOptions<TSection extends string = string> {
  sections?: readonly TSection[]
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
  if (value === false || value === "none") {
    return undefined
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return undefined
    }

    const items = value as readonly BindingSectionItem<TTarget, TEvent>[]
    const bindings = new Array<BindingInput<TTarget, TEvent>>(items.length)
    for (let index = 0; index < items.length; index += 1) {
      bindings[index] = resolveBindingItem(section, command, items[index]!, index)
    }

    return bindings
  }

  return [resolveBindingItem(section, command, value as BindingSectionItem<TTarget, TEvent>)]
}

export function resolveBindingSections<
  TTarget extends object = object,
  TEvent extends KeymapEvent = KeymapEvent,
  const TConfig extends BindingSectionsConfig<TTarget, TEvent> = BindingSectionsConfig<TTarget, TEvent>,
  const TSection extends string = string,
>(
  config: TConfig,
  options: ResolveBindingSectionsOptions<TSection> & { sections: readonly TSection[] },
): ResolvedBindingSections<TTarget, TEvent, TSection | LiteralStringKeys<TConfig>>
export function resolveBindingSections<TTarget extends object = object, TEvent extends KeymapEvent = KeymapEvent>(
  config: BindingSectionsConfig<TTarget, TEvent>,
  options?: ResolveBindingSectionsOptions,
): ResolvedBindingSections<TTarget, TEvent>
export function resolveBindingSections<TTarget extends object = object, TEvent extends KeymapEvent = KeymapEvent>(
  config: BindingSectionsConfig<TTarget, TEvent>,
  options?: ResolveBindingSectionsOptions,
): ResolvedBindingSections<TTarget, TEvent> {
  const sections: Record<string, BindingInput<TTarget, TEvent>[]> = {}
  const lookups = new Map<string, Map<string, BindingInput<TTarget, TEvent>[]>>()

  for (const section of options?.sections ?? []) {
    sections[section] = []
    lookups.set(section, new Map())
  }

  // Own-property loops avoid Object.entries allocations while still ignoring inherited config.
  for (const section in config) {
    if (!hasOwn.call(config, section)) {
      continue
    }

    const sectionConfig = config[section]
    if (!isObject(sectionConfig)) {
      throw new Error(`Invalid binding section "${section}": expected an object`)
    }

    const sectionLookup = new Map<string, BindingInput<TTarget, TEvent>[]>()

    for (const rawCommand in sectionConfig) {
      if (!hasOwn.call(sectionConfig, rawCommand)) {
        continue
      }

      const command = rawCommand.trim()
      const bindings = resolveBindingValue(section, command, sectionConfig[rawCommand]!)

      if (!bindings) {
        sectionLookup.delete(command)
        continue
      }

      sectionLookup.set(command, bindings)
    }

    // Manual flattening avoids Array.flat allocations on large generated configs.
    let sectionBindingCount = 0
    for (const bindings of sectionLookup.values()) {
      sectionBindingCount += bindings.length
    }

    const sectionBindings = new Array<BindingInput<TTarget, TEvent>>(sectionBindingCount)
    let bindingIndex = 0
    for (const bindings of sectionLookup.values()) {
      for (let index = 0; index < bindings.length; index += 1) {
        sectionBindings[bindingIndex] = bindings[index]!
        bindingIndex += 1
      }
    }

    sections[section] = sectionBindings
    lookups.set(section, sectionLookup)
  }

  return {
    sections,
    get(section, cmd) {
      return lookups.get(section)?.get(cmd.trim())
    },
  }
}
