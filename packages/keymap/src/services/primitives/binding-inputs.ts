import type { BindingInput, Bindings, KeymapEvent, ParsedBindingInput } from "../../types.js"
import { cloneKeySequence } from "../keys.js"

export function snapshotBindingInputs<TTarget extends object, TEvent extends KeymapEvent>(
  bindings: Bindings<TTarget, TEvent>,
): BindingInput<TTarget, TEvent>[] {
  if (!Array.isArray(bindings)) {
    throw new Error("Invalid keymap bindings: expected an array of binding objects")
  }

  return bindings.map((binding) => ({
    ...binding,
    key: typeof binding.key === "string" ? binding.key : { ...binding.key },
  }))
}

export function snapshotParsedBindingInput<TTarget extends object, TEvent extends KeymapEvent>(
  binding: ParsedBindingInput<TTarget, TEvent>,
): ParsedBindingInput<TTarget, TEvent> {
  return {
    ...binding,
    sequence: cloneKeySequence(binding.sequence),
  }
}
