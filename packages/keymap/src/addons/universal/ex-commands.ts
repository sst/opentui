import type {
  CommandContext,
  Command,
  CommandResult,
  Keymap,
  KeymapEvent,
  ParsedCommand,
} from "../../index.js"

export interface ExCommand<TTarget extends object = object, TEvent extends KeymapEvent = KeymapEvent> {
  name: string
  aliases?: string[]
  nargs?: "0" | "1" | "?" | "*" | "+"
  run: (ctx: CommandContext<TTarget, TEvent> & { raw: string; args: readonly string[] }) => CommandResult<TTarget, TEvent>
  [key: string]: unknown
}

function normalizeExCommandName(name: string): string {
  const normalized = name.trim()
  if (!normalized) {
    throw new Error("Invalid keymap command name: name cannot be empty")
  }

  if (/\s/.test(normalized)) {
    throw new Error(`Invalid keymap command name "${name}": command names cannot contain whitespace`)
  }

  if (normalized.startsWith(":")) {
    return normalized
  }

  return `:${normalized}`
}

function parseCommandInput(input: string): ParsedCommand {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new Error("Invalid keymap command: command cannot be empty")
  }

  const parts = trimmed.split(/\s+/)
  const [name, ...args] = parts
  if (!name) {
    throw new Error(`Invalid keymap command "${input}"`)
  }

  return {
    input: trimmed,
    name,
    args,
  }
}

function validateCommandArgs<TTarget extends object, TEvent extends KeymapEvent>(
  command: ExCommand<TTarget, TEvent>,
  args: readonly unknown[],
): boolean {
  if (!command.nargs) {
    return true
  }

  const count = args.length
  if (command.nargs === "0") {
    return count === 0
  }

  if (command.nargs === "1") {
    return count === 1
  }

  if (command.nargs === "?") {
    return count <= 1
  }

  if (command.nargs === "*") {
    return true
  }

  if (command.nargs === "+") {
    return count >= 1
  }

  return true
}

/**
 * Resolves `:name ...args` strings against the provided Ex commands and
 * validated argument lists.
 */
export function registerExCommands<TTarget extends object, TEvent extends KeymapEvent>(
  keymap: Keymap<TTarget, TEvent>,
  commands: ExCommand<TTarget, TEvent>[],
): () => void {
  const registrations: Command<TTarget, TEvent>[] = []

  for (const command of commands) {
    const { name, aliases, run, ...fields } = command
    const names = [name, ...(aliases ?? [])]
    const registrationFields = {
      ...fields,
      aliases,
      namespace: fields.namespace ?? "excommands",
    }

    for (const name of names) {
      const normalizedName = normalizeExCommandName(name)

      registrations.push({
        ...registrationFields,
        name: normalizedName,
        run(ctx) {
          if (!validateCommandArgs(command, ctx.args)) {
            return { ok: false, reason: "invalid-args" }
          }

          return run({
            ...ctx,
            command: ctx.command!,
            raw: ctx.input,
            args: ctx.args as readonly string[],
          })
        },
      })
    }
  }

  const offCommands = keymap.registerLayer({ commands: registrations })
  const offResolver = keymap.appendCommandResolver((input, ctx) => {
    if (!input.startsWith(":")) {
      return undefined
    }

    const parsed = parseCommandInput(input)
    const normalizedName = normalizeExCommandName(parsed.name)
    const command = ctx.getCommand(normalizedName)

    if (!command) {
      return undefined
    }

    ctx.setInput(parsed.input)
    ctx.prependArgs(parsed.args)
    return command
  })

  return () => {
    offResolver()
    offCommands()
  }
}
