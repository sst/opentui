import type { Events, HookName, Hooks, KeymapEvent } from "../types.js"
import type { State } from "./state.js"
import { Emitter } from "../lib/emitter.js"

type DiagnosticEvents<TTarget extends object, TEvent extends KeymapEvent> = Pick<
  Events<TTarget, TEvent>,
  "warning" | "error"
>

export const MAX_STATE_CHANGE_FLUSH_ITERATIONS = 1000

export class NotificationService<TTarget extends object, TEvent extends KeymapEvent> {
  constructor(
    private readonly state: State<TTarget, TEvent>,
    private readonly events: Emitter<DiagnosticEvents<TTarget, TEvent>>,
    private readonly hooks: Emitter<Hooks<TTarget, TEvent>>,
  ) {}

  public runWithStateChangeBatch<T>(fn: () => T): T {
    this.state.notify.stateChangeDepth += 1

    try {
      return fn()
    } finally {
      this.state.notify.stateChangeDepth -= 1
      if (this.state.notify.stateChangeDepth === 0) {
        this.flushStateChange()
      }
    }
  }

  public queueStateChange(): void {
    this.state.notify.derivedStateVersion += 1

    if (!this.hooks.has("state")) {
      return
    }

    this.state.notify.stateChangePending = true
    if (this.state.notify.stateChangeDepth === 0 && !this.state.notify.flushingStateChange) {
      this.flushStateChange()
    }
  }

  public emitWarning(code: string, warning: unknown, message: string): void {
    if (!this.events.has("warning")) {
      const consoleMessage = `[${code}] ${message}`
      if (warning instanceof Error) {
        console.warn(consoleMessage, warning)
      } else {
        console.warn(consoleMessage)
      }

      return
    }

    this.events.emit("warning", { code, message, warning })
  }

  public emitError(code: string, error: unknown, message: string): void {
    if (!this.events.has("error")) {
      const consoleMessage = `[${code}] ${message}`
      if (error instanceof Error) {
        console.error(consoleMessage, error)
      } else {
        console.error(consoleMessage)
      }

      return
    }

    this.events.emit("error", { code, message, error })
  }

  public reportListenerError(name: HookName, error: unknown): void {
    if (name === "state") {
      this.emitError("state-listener-error", error, "[Keymap] Error in state listener:")
      return
    }

    if (name === "pendingSequence") {
      this.emitError("pending-sequence-listener-error", error, "[Keymap] Error in pending sequence listener:")
      return
    }

    if (name === "dispatch") {
      this.emitError("dispatch-listener-error", error, "[Keymap] Error in dispatch listener:")
    }
  }

  public warnOnce(key: string, code: string, warning: unknown, message: string): void {
    if (this.state.notify.usedWarningKeys.has(key)) {
      return
    }

    this.state.notify.usedWarningKeys.add(key)
    this.emitWarning(code, warning, message)
  }

  private flushStateChange(): void {
    if (
      !this.state.notify.stateChangePending ||
      this.state.notify.stateChangeDepth > 0 ||
      this.state.notify.flushingStateChange
    ) {
      return
    }

    this.state.notify.flushingStateChange = true

    try {
      let iterations = 0

      while (this.state.notify.stateChangePending && this.state.notify.stateChangeDepth === 0) {
        if (iterations >= MAX_STATE_CHANGE_FLUSH_ITERATIONS) {
          this.state.notify.stateChangePending = false
          this.emitError(
            "state-change-feedback-loop",
            { iterations: MAX_STATE_CHANGE_FLUSH_ITERATIONS },
            `[Keymap] Possible infinite state listener feedback loop detected after ${MAX_STATE_CHANGE_FLUSH_ITERATIONS} iterations; pending state notifications were dropped`,
          )
          break
        }

        iterations += 1
        this.state.notify.stateChangePending = false
        this.hooks.emit("state")
      }
    } finally {
      this.state.notify.flushingStateChange = false
    }
  }
}
