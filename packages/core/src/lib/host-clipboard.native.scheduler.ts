const OPERATION_POLL_INTERVAL_MS = 1
const PROVIDER_POLL_INTERVAL_MS = 8

interface TimerFunctions<Timer> {
  readonly set: (callback: () => void, delayMs: number) => Timer
  readonly clear: (timer: Timer) => void
}

export class NativeClipboardPollScheduler<Timer = ReturnType<typeof setTimeout>> {
  private timer: Timer | undefined
  private timerForOperation = false

  constructor(private readonly timers: TimerFunctions<Timer>) {}

  schedule(hasPendingOperation: boolean, providerActive: boolean, callback: () => void): void {
    if (!hasPendingOperation && !providerActive) {
      this.clearTimer()
      return
    }

    if (this.timer !== undefined) {
      if (hasPendingOperation && !this.timerForOperation) {
        this.clearTimer()
      } else {
        if (hasPendingOperation) refTimer(this.timer)
        else unrefTimer(this.timer)
        return
      }
    }

    this.timerForOperation = hasPendingOperation
    const timer = this.timers.set(
      () => {
        if (this.timer !== timer) return
        this.timer = undefined
        this.timerForOperation = false
        callback()
      },
      hasPendingOperation ? OPERATION_POLL_INTERVAL_MS : PROVIDER_POLL_INTERVAL_MS,
    )
    this.timer = timer
    if (!hasPendingOperation) unrefTimer(timer)
  }

  dispose(): void {
    this.clearTimer()
  }

  private clearTimer(): void {
    if (this.timer === undefined) return
    this.timers.clear(this.timer)
    this.timer = undefined
    this.timerForOperation = false
  }
}

const refTimer = (timer: unknown): void => {
  if (typeof timer === "object" && timer !== null && "ref" in timer && typeof timer.ref === "function") timer.ref()
}

const unrefTimer = (timer: unknown): void => {
  if (typeof timer === "object" && timer !== null && "unref" in timer && typeof timer.unref === "function") {
    timer.unref()
  }
}
