import type {
  BindingInput,
  BindingInputsValidationResult,
  Bindings,
  KeymapEvent,
  ParsedBindingInput,
} from "../../types.js"
import { cloneKeySequence } from "../keys.js"

function isKeyLike(value: unknown): boolean {
  return typeof value === "string" || (!!value && typeof value === "object" && !Array.isArray(value))
}

export function validateBindingInputs(bindings: unknown): BindingInputsValidationResult {
  if (!Array.isArray(bindings)) {
    return { ok: false, reason: "Invalid keymap bindings: expected an array of binding objects" }
  }

  for (const [index, binding] of bindings.entries()) {
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
      return { ok: false, reason: `Invalid keymap binding at index ${index}: expected a binding object` }
    }

    if (!isKeyLike((binding as BindingInput).key)) {
      return {
        ok: false,
        reason: `Invalid keymap binding at index ${index}: expected "key" to be a string or keystroke object`,
      }
    }
  }

  return { ok: true }
}

export function snapshotBindingInputs<TTarget extends object, TEvent extends KeymapEvent>(
  bindings: Bindings<TTarget, TEvent>,
): BindingInput<TTarget, TEvent>[] {
  const validation = validateBindingInputs(bindings)
  if (!validation.ok) {
    throw new Error(validation.reason)
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
