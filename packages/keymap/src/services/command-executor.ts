import type { Keymap } from "../keymap.js"
import type {
  BindingCommand,
  CommandContext,
  CommandResult,
  CompiledBinding,
  KeymapEvent,
  RegisteredLayer,
  ResolvedBindingCommand,
  RunCommandOptions,
  RunCommandResult,
} from "../types.js"
import { normalizeBindingCommand } from "./primitives/command-normalization.js"
import type { CommandCatalogService } from "./command-catalog.js"
import type { ActivationService } from "./activation.js"
import type { NotificationService } from "./notify.js"
import type { RuntimeService } from "./runtime.js"
import { isPromiseLike } from "./values.js"

interface CommandExecutionResult {
  status: "handled" | "rejected" | "error"
  result: RunCommandResult
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

  public runCommand(cmd: string, options?: RunCommandOptions<TTarget, TEvent>): RunCommandResult {
    let normalized: BindingCommand<TTarget, TEvent> | undefined

    try {
      normalized = normalizeBindingCommand(cmd)
    } catch {
      return { ok: false, reason: "invalid-args" }
    }

    if (typeof normalized !== "string") {
      return { ok: false, reason: "not-found" }
    }

    const includeRecord = options?.includeCommand === true
    const focused = options?.focused ?? this.activation.getFocusedTargetIfAvailable()
    const event = options?.event ?? this.options.createCommandEvent()
    const data = this.runtime.getReadonlyData()
    const chain = this.catalog.getRegisteredResolvedEntries(normalized, includeRecord)
    let rejectedResult: RunCommandResult | undefined

    // Kept inline across command execution paths: abstracting this chain walk
    // measurably slowed the benchmarked hot path.
    if (chain?.length === 1) {
      const [entry] = chain
      if (entry) {
        const execution = this.executeResolvedCommand(normalized, entry.resolved, {
          keymap: this.options.keymap,
          event,
          focused,
          target: options?.target ?? entry.target ?? null,
          data,
        })

        if (execution.status === "handled" || execution.status === "error") {
          return execution.result
        }

        rejectedResult = execution.result
      }
    } else if (chain) {
      for (const entry of chain) {
        const context: CommandContext<TTarget, TEvent> = {
          keymap: this.options.keymap,
          event,
          focused,
          target: options?.target ?? entry.target ?? null,
          data,
        }

        const execution = this.executeResolvedCommand(normalized, entry.resolved, context)
        if (execution.status === "handled" || execution.status === "error") {
          return execution.result
        }

        rejectedResult = execution.result
      }
    }

    const fallback = this.catalog.resolveRegisteredResolverFallback(normalized, includeRecord)
    if (fallback.resolved) {
      const execution = this.executeResolvedCommand(normalized, fallback.resolved, {
        keymap: this.options.keymap,
        event,
        focused,
        target: options?.target ?? null,
        data,
      })

      if (execution.status === "handled" || execution.status === "error") {
        return execution.result
      }

      rejectedResult = execution.result
    }

    if (fallback.hadError) {
      return { ok: false, reason: "error" }
    }

    return rejectedResult ?? { ok: false, reason: "not-found" }
  }

  public dispatchCommand(cmd: string, options?: RunCommandOptions<TTarget, TEvent>): RunCommandResult {
    let normalized: BindingCommand<TTarget, TEvent> | undefined

    try {
      normalized = normalizeBindingCommand(cmd)
    } catch {
      return { ok: false, reason: "invalid-args" }
    }

    if (typeof normalized !== "string") {
      return { ok: false, reason: "not-found" }
    }

    const includeRecord = options?.includeCommand === true
    const focused = options?.focused ?? this.activation.getFocusedTargetIfAvailable()
    const event = options?.event ?? this.options.createCommandEvent()
    const data = this.runtime.getReadonlyData()
    const chain = this.catalog.getActiveRegisteredResolvedEntries(normalized, focused, includeRecord)
    let rejectedResult: RunCommandResult | undefined

    if (chain?.length === 1) {
      const [entry] = chain
      if (entry) {
        const execution = this.executeResolvedCommand(normalized, entry.resolved, {
          keymap: this.options.keymap,
          event,
          focused,
          target: options?.target ?? entry.target ?? null,
          data,
        })

        if (execution.status === "handled" || execution.status === "error") {
          return execution.result
        }

        rejectedResult = execution.result
      }
    } else if (chain) {
      for (const entry of chain) {
        const context: CommandContext<TTarget, TEvent> = {
          keymap: this.options.keymap,
          event,
          focused,
          target: options?.target ?? entry.target ?? null,
          data,
        }

        const execution = this.executeResolvedCommand(normalized, entry.resolved, context)
        if (execution.status === "handled" || execution.status === "error") {
          return execution.result
        }

        rejectedResult = execution.result
      }
    }

    const fallback = this.catalog.resolveActiveResolverFallback(normalized, focused, includeRecord)
    if (fallback.resolved) {
      const execution = this.executeResolvedCommand(normalized, fallback.resolved, {
        keymap: this.options.keymap,
        event,
        focused,
        target: options?.target ?? null,
        data,
      })

      if (execution.status === "handled" || execution.status === "error") {
        return execution.result
      }

      rejectedResult = execution.result
    }

    if (fallback.hadError) {
      return { ok: false, reason: "error" }
    }

    const unavailable = this.catalog.getDispatchUnavailableCommandState(normalized, focused, includeRecord)
    if (unavailable) {
      return unavailable.command
        ? { ok: false, reason: unavailable.reason, command: unavailable.command }
        : { ok: false, reason: unavailable.reason }
    }

    return rejectedResult ?? { ok: false, reason: "not-found" }
  }

  public runBinding(
    bindingLayer: RegisteredLayer<TTarget, TEvent>,
    binding: CompiledBinding<TTarget, TEvent>,
    event: TEvent,
    focused: TTarget | null,
  ): boolean {
    const data = this.runtime.getReadonlyData()

    if (binding.run) {
      const result = this.executeResolvedCommand(
        typeof binding.command === "string" ? binding.command : "<function>",
        { run: binding.run },
        {
          keymap: this.options.keymap,
          event,
          focused,
          target: bindingLayer.target ?? null,
          data,
        },
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

    const chain = this.catalog.getResolvedCommandChain(binding.command, focused, false).entries
    if (chain?.length === 1) {
      const [entry] = chain
      if (entry) {
        const execution = this.executeResolvedCommand(binding.command, entry.resolved, {
          keymap: this.options.keymap,
          event,
          focused,
          target: entry.target ?? bindingLayer.target ?? null,
          data,
        })
        if (execution.status === "rejected") {
          return false
        }

        applyBindingEventEffects(binding, event)
        return true
      }
    } else if (chain) {
      for (const entry of chain) {
        const context: CommandContext<TTarget, TEvent> = {
          keymap: this.options.keymap,
          event,
          focused,
          target: entry.target ?? bindingLayer.target ?? null,
          data,
        }

        const execution = this.executeResolvedCommand(binding.command, entry.resolved, context)
        if (execution.status === "rejected") {
          continue
        }

        applyBindingEventEffects(binding, event)
        return true
      }
    }

    return false
  }

  private executeResolvedCommand(
    commandName: string,
    resolved: ResolvedBindingCommand<TTarget, TEvent>,
    context: CommandContext<TTarget, TEvent>,
  ): CommandExecutionResult {
    const command = resolved.record
    let result: CommandResult

    try {
      result = resolved.run(context)
    } catch (error) {
      this.notify.emitError("command-execution-error", error, `[Keymap] Error running command "${commandName}":`)
      return {
        status: "error",
        result: { ok: false, reason: "error", command },
      }
    }

    if (isPromiseLike(result)) {
      result.catch((error) => {
        this.notify.emitError("async-command-error", error, `[Keymap] Async error in command "${commandName}":`)
      })

      return {
        status: "handled",
        result: { ok: true, command },
      }
    }

    if (result === false) {
      if (resolved.rejectedResult) {
        return {
          status: "rejected",
          result: resolved.rejectedResult,
        }
      }

      return {
        status: "rejected",
        result: { ok: false, reason: "rejected", command },
      }
    }

    return {
      status: "handled",
      result: { ok: true, command },
    }
  }
}

function applyBindingEventEffects<TTarget extends object, TEvent extends KeymapEvent>(
  binding: CompiledBinding<TTarget, TEvent>,
  event: TEvent,
): void {
  if (!binding.preventDefault) {
    return
  }

  event.preventDefault()
  event.stopPropagation()
}
