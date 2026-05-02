import type { Keymap } from "../keymap.js"
import type {
  BindingCommand,
  Command,
  CommandContext,
  CommandHandler,
  CommandResult,
  BindingState,
  KeymapEvent,
  RegisteredLayer,
  RunCommandOptions,
  RunCommandResult,
} from "../types.js"
import { normalizeBindingCommand } from "./primitives/command-normalization.js"
import type { CommandCatalogService } from "./command-catalog.js"
import type { ActivationService } from "./activation.js"
import type { NotificationService } from "./notify.js"
import type { RuntimeService } from "./runtime.js"
import { isPromiseLike } from "./values.js"

interface CommandExecutionResult<TTarget extends object, TEvent extends KeymapEvent> {
  status: "handled" | "rejected" | "error"
  result: RunCommandResult<TTarget, TEvent>
}

interface CommandExecutorOptions<TTarget extends object, TEvent extends KeymapEvent> {
  keymap: Keymap<TTarget, TEvent>
  createCommandEvent: () => TEvent
}

export class CommandExecutorService<TTarget extends object, TEvent extends KeymapEvent> {
  constructor(
    private readonly notify: NotificationService<TTarget, TEvent>,
    private readonly runtime: RuntimeService<TTarget, TEvent>,
    private readonly activation: ActivationService<TTarget, TEvent>,
    private readonly catalog: CommandCatalogService<TTarget, TEvent>,
    private readonly options: CommandExecutorOptions<TTarget, TEvent>,
  ) {}

  public runCommand(cmd: string, options?: RunCommandOptions<TTarget, TEvent>): RunCommandResult<TTarget, TEvent> {
    let normalized: BindingCommand<TTarget, TEvent> | undefined

    try {
      normalized = normalizeBindingCommand(cmd)
    } catch {
      return { ok: false, reason: "invalid-args" }
    }

    if (typeof normalized !== "string") {
      return { ok: false, reason: "not-found" }
    }

    const includeCommand = options?.includeCommand === true
    const focused = options?.focused ?? this.activation.getFocusedTargetIfAvailable()
    const event = options?.event ?? this.options.createCommandEvent()
    const data = this.runtime.getReadonlyData()
    const payload = options?.payload
    const chain = this.catalog.getRegisteredResolvedEntries(normalized)
    let rejectedResult: RunCommandResult<TTarget, TEvent> | undefined

    // Kept inline across command execution paths: abstracting this chain walk
    // measurably slowed the benchmarked hot path.
    if (chain?.length === 1) {
      const [entry] = chain
      if (entry) {
        const result = this.executeResolvedCommand(
          normalized,
          entry.command,
          this.createCommandContext(event, focused, options?.target ?? entry.target ?? null, data, normalized, payload),
          includeCommand,
        )

        if (result.status === "handled" || result.status === "error") {
          return result.result
        }

        rejectedResult = result.result
      }
    } else if (chain) {
      for (const entry of chain) {
        const context = this.createCommandContext(
          event,
          focused,
          options?.target ?? entry.target ?? null,
          data,
          normalized,
          payload,
        )

        const result = this.executeResolvedCommand(normalized, entry.command, context, includeCommand)
        if (result.status === "handled" || result.status === "error") {
          return result.result
        }

        rejectedResult = result.result
      }
    }

    const fallback = this.catalog.resolveRegisteredResolverFallback(normalized, { input: normalized, payload })
    if (fallback.resolved) {
      const result = this.executeResolvedCommand(
        normalized,
        fallback.resolved.command,
        this.createCommandContext(
          event,
          focused,
          options?.target ?? fallback.resolved.target ?? null,
          data,
          fallback.resolved.input ?? normalized,
          fallback.resolved.payload,
        ),
        includeCommand,
      )

      if (result.status === "handled" || result.status === "error") {
        return result.result
      }

      rejectedResult = result.result
    }

    if (fallback.hadError) {
      return { ok: false, reason: "error" }
    }

    return rejectedResult ?? { ok: false, reason: "not-found" }
  }

  public dispatchCommand(cmd: string, options?: RunCommandOptions<TTarget, TEvent>): RunCommandResult<TTarget, TEvent> {
    let normalized: BindingCommand<TTarget, TEvent> | undefined

    try {
      normalized = normalizeBindingCommand(cmd)
    } catch {
      return { ok: false, reason: "invalid-args" }
    }

    if (typeof normalized !== "string") {
      return { ok: false, reason: "not-found" }
    }

    const includeCommand = options?.includeCommand === true
    const focused = options?.focused ?? this.activation.getFocusedTargetIfAvailable()
    const event = options?.event ?? this.options.createCommandEvent()
    const data = this.runtime.getReadonlyData()
    const payload = options?.payload
    const chain = this.catalog.getActiveRegisteredResolvedEntries(normalized, focused)
    let rejectedResult: RunCommandResult<TTarget, TEvent> | undefined

    if (chain?.length === 1) {
      const [entry] = chain
      if (entry) {
        const result = this.executeResolvedCommand(
          normalized,
          entry.command,
          this.createCommandContext(event, focused, options?.target ?? entry.target ?? null, data, normalized, payload),
          includeCommand,
        )

        if (result.status === "handled" || result.status === "error") {
          return result.result
        }

        rejectedResult = result.result
      }
    } else if (chain) {
      for (const entry of chain) {
        const context = this.createCommandContext(
          event,
          focused,
          options?.target ?? entry.target ?? null,
          data,
          normalized,
          payload,
        )

        const result = this.executeResolvedCommand(normalized, entry.command, context, includeCommand)
        if (result.status === "handled" || result.status === "error") {
          return result.result
        }

        rejectedResult = result.result
      }
    }

    const fallback = this.catalog.resolveActiveResolverFallback(normalized, focused, { input: normalized, payload })
    if (fallback.resolved) {
      const result = this.executeResolvedCommand(
        normalized,
        fallback.resolved.command,
        this.createCommandContext(
          event,
          focused,
          options?.target ?? fallback.resolved.target ?? null,
          data,
          fallback.resolved.input ?? normalized,
          fallback.resolved.payload,
        ),
        includeCommand,
      )

      if (result.status === "handled" || result.status === "error") {
        return result.result
      }

      rejectedResult = result.result
    }

    if (fallback.hadError) {
      return { ok: false, reason: "error" }
    }

    const unavailable = this.catalog.getDispatchUnavailableCommandState(normalized, focused, includeCommand)
    if (unavailable) {
      return unavailable.command
        ? { ok: false, reason: unavailable.reason, command: unavailable.command }
        : { ok: false, reason: unavailable.reason }
    }

    return rejectedResult ?? { ok: false, reason: "not-found" }
  }

  public runBinding(
    bindingLayer: RegisteredLayer<TTarget, TEvent>,
    binding: BindingState<TTarget, TEvent>,
    event: TEvent,
    focused: TTarget | null,
  ): boolean {
    const data = this.runtime.getReadonlyData()

    if (binding.run) {
      const result = this.executeResolvedCommand(
        typeof binding.command === "string" ? binding.command : "<function>",
        binding.run,
        this.createCommandContext(
          event,
          focused,
          bindingLayer.target ?? null,
          data,
          typeof binding.command === "string" ? binding.command : "<function>",
          undefined,
        ),
        false,
      )

      if (result.status === "rejected") {
        return false
      }

      applyBindingEventEffects(binding, event)
      return true
    }

    if (typeof binding.command !== "string") {
      return false
    }

    const chain = this.catalog.getResolvedCommandChain(binding.command, focused).entries
    if (chain?.length === 1) {
      const [entry] = chain
      if (entry) {
        const result = this.executeResolvedCommand(
          binding.command,
          entry.command,
          this.createCommandContext(
            event,
            focused,
            entry.target ?? bindingLayer.target ?? null,
            data,
            entry.input ?? binding.command,
            entry.payload,
          ),
          false,
        )
        if (result.status === "rejected") {
          return false
        }

        applyBindingEventEffects(binding, event)
        return true
      }
    } else if (chain) {
      for (const entry of chain) {
        const context = this.createCommandContext(
          event,
          focused,
          entry.target ?? bindingLayer.target ?? null,
          data,
          entry.input ?? binding.command,
          entry.payload,
        )

        const result = this.executeResolvedCommand(binding.command, entry.command, context, false)
        if (result.status === "rejected") {
          continue
        }

        applyBindingEventEffects(binding, event)
        return true
      }
    }

    return false
  }

  private createCommandContext(
    event: TEvent,
    focused: TTarget | null,
    target: TTarget | null,
    data: Readonly<Record<string, unknown>>,
    input: string,
    payload: unknown,
  ): CommandContext<TTarget, TEvent> {
    return {
      keymap: this.options.keymap,
      event,
      focused,
      target,
      data,
      input,
      payload,
    }
  }

  private executeResolvedCommand(
    commandName: string,
    command: Command<TTarget, TEvent> | CommandHandler<TTarget, TEvent>,
    context: CommandContext<TTarget, TEvent>,
    includeCommand: boolean,
  ): CommandExecutionResult<TTarget, TEvent> {
    const commandView = typeof command === "function" ? undefined : command
    const run = typeof command === "function" ? command : command.run
    const resultCommand = includeCommand ? commandView : undefined
    let result: CommandResult<TTarget, TEvent>

    try {
      result = run(commandView ? { ...context, command: commandView } : context)
    } catch (error) {
      this.notify.emitError("command-execution-error", error, `[Keymap] Error running command "${commandName}":`)
      return {
        status: "error",
        result: resultCommand ? { ok: false, reason: "error", command: resultCommand } : { ok: false, reason: "error" },
      }
    }

    if (isPromiseLike(result)) {
      result.catch((error) => {
        this.notify.emitError("async-command-error", error, `[Keymap] Async error in command "${commandName}":`)
      })

      return {
        status: "handled",
        result: resultCommand ? { ok: true, command: resultCommand } : { ok: true },
      }
    }

    if (isRunCommandResult(result)) {
      let commandResult: RunCommandResult<TTarget, TEvent> = result
      if (!result.ok && result.reason !== "not-found" && includeCommand && commandView && !result.command) {
        commandResult = { ...result, command: commandView }
      } else if (result.ok && includeCommand && commandView && !result.command) {
        commandResult = { ...result, command: commandView }
      }

      return {
        status: result.ok ? "handled" : "rejected",
        result: commandResult,
      }
    }

    if (result === false) {
      return {
        status: "rejected",
        result: resultCommand
          ? { ok: false, reason: "rejected", command: resultCommand }
          : { ok: false, reason: "rejected" },
      }
    }

    return {
      status: "handled",
      result: resultCommand ? { ok: true, command: resultCommand } : { ok: true },
    }
  }
}

function isRunCommandResult<TTarget extends object, TEvent extends KeymapEvent>(
  value: CommandResult<TTarget, TEvent>,
): value is RunCommandResult<TTarget, TEvent> {
  return typeof value === "object" && value !== null && "ok" in value
}

function applyBindingEventEffects<TTarget extends object, TEvent extends KeymapEvent>(
  binding: BindingState<TTarget, TEvent>,
  event: TEvent,
): void {
  if (!binding.preventDefault) {
    return
  }

  event.preventDefault()
  event.stopPropagation()
}
