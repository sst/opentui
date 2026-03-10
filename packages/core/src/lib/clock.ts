export type TimerHandle = ReturnType<typeof globalThis.setTimeout> | number

export interface Clock {
  now(): number
  setTimeout(fn: () => void, delayMs: number): TimerHandle
  clearTimeout(handle: TimerHandle): void
}

export class SystemClock implements Clock {
  public now(): number {
    return Date.now()
  }

  public setTimeout(fn: () => void, delayMs: number): TimerHandle {
    return globalThis.setTimeout(fn, delayMs)
  }

  public clearTimeout(handle: TimerHandle): void {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>)
  }
}
