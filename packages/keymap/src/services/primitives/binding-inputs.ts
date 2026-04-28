import { normalizeBindingCommand } from "../command-catalog.js"
import type { BindingInput, Bindings, KeyLike, KeymapEvent, ParsedBindingInput } from "../../types.js"
import { cloneKeySequence } from "../keys.js"

interface NormalizeBindingInputsOptions {
  onInvalidShorthandBinding?: (info: { command: string; value: unknown; error: Error }) => void
  onShorthandOverride?: (info: {
    command: string
    previousCommand: string
    nextCommand: string
    previousKey: KeyLike
    nextKey: KeyLike
  }) => void
}

function isBindingShorthandKey(value: unknown): value is KeyLike {
  return typeof value === "string" || (!!value && typeof value === "object" && !Array.isArray(value))
}

export function normalizeBindingInputs<TTarget extends object, TEvent extends KeymapEvent>(
  bindings: Bindings<TTarget, TEvent>,
  options?: NormalizeBindingInputsOptions,
): BindingInput<TTarget, TEvent>[] {
  if (Array.isArray(bindings)) {
    return bindings
  }

  const normalized: BindingInput<TTarget, TEvent>[] = []
  const indexesByCommand = new Map<string, number>()

  for (const [command, key] of Object.entries(bindings)) {
    if (!isBindingShorthandKey(key)) {
      const error = new Error(
        `Invalid keymap binding for "${command}": shorthand bindings must map command strings to key strings or keystroke objects`,
      )
      if (options?.onInvalidShorthandBinding) {
        options.onInvalidShorthandBinding({ command, value: key, error })
        continue
      }

      throw error
    }

    let normalizedCommand: string
    try {
      normalizedCommand = normalizeBindingCommand(key === undefined ? undefined : command) as string
    } catch (error) {
      if (options?.onInvalidShorthandBinding && error instanceof Error) {
        options.onInvalidShorthandBinding({ command, value: key, error })
        continue
      }

      throw error
    }

    const nextBinding = { key, cmd: normalizedCommand } satisfies BindingInput<TTarget, TEvent>
    const existingIndex = indexesByCommand.get(normalizedCommand)
    if (existingIndex !== undefined) {
      const previousBinding = normalized[existingIndex]!
      options?.onShorthandOverride?.({
        command: normalizedCommand,
        previousCommand: previousBinding.cmd as string,
        nextCommand: command,
        previousKey: previousBinding.key,
        nextKey: key,
      })
      normalized[existingIndex] = nextBinding
      continue
    }

    indexesByCommand.set(normalizedCommand, normalized.length)
    normalized.push(nextBinding)
  }

  return normalized
}

export function snapshotBindingInputs<TTarget extends object, TEvent extends KeymapEvent>(
  bindings: Bindings<TTarget, TEvent>,
  options?: NormalizeBindingInputsOptions,
): BindingInput<TTarget, TEvent>[] {
  return normalizeBindingInputs(bindings, options).map((binding) => ({
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
