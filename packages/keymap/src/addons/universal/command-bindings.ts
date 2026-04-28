import { normalizeBindingCommand } from "../../services/command-catalog.js"
import type { BindingInput, KeyLike, KeymapEvent } from "../../index.js"

export type CommandBindingMap = Record<string, KeyLike>

export interface CommandBindingsOverrideWarning {
  code: "command-binding-override"
  command: string
  previousKey: KeyLike
  nextKey: KeyLike
}

export interface CommandBindingsOptions {
  onWarning?: (warning: CommandBindingsOverrideWarning) => void
}

function isCommandBindingKey(value: unknown): value is KeyLike {
  return typeof value === "string" || (!!value && typeof value === "object" && !Array.isArray(value))
}

export function commandBindings<TTarget extends object = object, TEvent extends KeymapEvent = KeymapEvent>(
  bindings: Readonly<CommandBindingMap>,
  options?: CommandBindingsOptions,
): BindingInput<TTarget, TEvent>[] {
  const normalized: BindingInput<TTarget, TEvent>[] = []
  const indexesByCommand = new Map<string, number>()

  for (const [command, key] of Object.entries(bindings)) {
    if (!isCommandBindingKey(key)) {
      throw new Error(
        `Invalid command binding for "${command}": command bindings must map command strings to key strings or keystroke objects`,
      )
    }

    const normalizedCommand = normalizeBindingCommand(command)
    if (typeof normalizedCommand !== "string") {
      throw new Error(`Invalid command binding for "${command}": command bindings require string commands`)
    }

    const nextBinding = {
      key: typeof key === "string" ? key : { ...key },
      cmd: normalizedCommand,
    } satisfies BindingInput<TTarget, TEvent>

    const existingIndex = indexesByCommand.get(normalizedCommand)
    if (existingIndex !== undefined) {
      const previousBinding = normalized[existingIndex]!
      options?.onWarning?.({
        code: "command-binding-override",
        command: normalizedCommand,
        previousKey: previousBinding.key,
        nextKey: nextBinding.key,
      })
      normalized[existingIndex] = nextBinding
      continue
    }

    indexesByCommand.set(normalizedCommand, normalized.length)
    normalized.push(nextBinding)
  }

  return normalized
}
