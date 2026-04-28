import type { BindingInput, KeyLike, Keymap, KeymapEvent } from "../../index.js"

function isKeyLike(value: unknown): value is KeyLike {
  return typeof value === "string" || (!!value && typeof value === "object" && !Array.isArray(value))
}

function normalizeBindingOverrides<TTarget extends object, TEvent extends KeymapEvent>(
  value: unknown,
): readonly BindingInput<TTarget, TEvent>[] {
  if (!Array.isArray(value)) {
    throw new Error('Keymap layer field "bindingOverrides" must be an array of binding objects')
  }

  const overrides: BindingInput<TTarget, TEvent>[] = []

  for (const binding of value) {
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
      throw new Error('Keymap layer field "bindingOverrides" must contain only binding objects')
    }

    const candidate = binding as BindingInput<TTarget, TEvent>
    if (!isKeyLike(candidate.key)) {
      throw new Error('Keymap layer field "bindingOverrides" must contain only binding objects with valid keys')
    }

    overrides.push(candidate)
  }

  return overrides
}

function getBindingOverrides<TTarget extends object, TEvent extends KeymapEvent>(
  layer: Readonly<Record<string, unknown>>,
): readonly BindingInput<TTarget, TEvent>[] | undefined {
  const overrides = layer.bindingOverrides
  if (!overrides || !Array.isArray(overrides)) {
    return undefined
  }

  return normalizeBindingOverrides<TTarget, TEvent>(overrides)
}

/**
 * Adds a `bindingOverrides` layer field that replaces bindings by string
 * command name within that layer before compilation.
 */
export function registerBindingOverrides<TTarget extends object, TEvent extends KeymapEvent>(
  keymap: Keymap<TTarget, TEvent>,
): () => void {
  const offLayerField = keymap.registerLayerFields({
    bindingOverrides(value) {
      normalizeBindingOverrides<TTarget, TEvent>(value)
    },
  })

  const offTransformer = keymap.appendLayerBindingsTransformer((bindings, ctx) => {
    const overrides = getBindingOverrides<TTarget, TEvent>(ctx.layer)
    if (!overrides) {
      return
    }

    const overrideCommands = new Set(
      overrides.flatMap((binding) => (typeof binding.cmd === "string" ? [binding.cmd.trim()] : [])),
    )

    return [
      ...overrides,
      ...bindings.filter((binding) => {
        return typeof binding.cmd !== "string" || !overrideCommands.has(binding.cmd.trim())
      }),
    ]
  })

  return () => {
    offTransformer()
    offLayerField()
  }
}
