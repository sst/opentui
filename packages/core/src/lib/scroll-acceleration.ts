export interface ScrollAcceleration {
  tick(now?: number): number
  reset(): void
}

export class LinearScrollAccel implements ScrollAcceleration {
  tick(_now?: number): number {
    return 1
  }

  reset(): void {}
}

/**
 * macOS-inspired scroll acceleration.
 *
 * The class measures the time between consecutive scroll events and keeps a short
 * moving window of the latest intervals. The average interval determines which
 * multiplier to apply so that quick bursts accelerate and slower gestures stay precise.
 *
 * For intuition, treat the streak as a continuous timeline and compare it with the
 * exponential distance curve from the pointer-acceleration research post:
 *   d(t) = v₀ * ( t + A * (exp(t/τ) - 1 - t/τ) ).
 * Small t stays near the base multiplier, medium streaks settle on multiplier1, and
 * sustained bursts reach multiplier2, mirroring how the exponential curve bends up.
 *
 * Options:
 * - threshold1: upper bound (ms) of the "medium" band. Raise to delay the ramp.
 * - threshold2: upper bound (ms) of the "fast" band. Lower to demand tighter bursts.
 * - multiplier1: scale for medium speed streaks.
 * - multiplier2: scale for sustained fast streaks.
 * - baseMultiplier: scale for relaxed scrolling; set to 1 for linear behaviour.
 */
export class MacOSScrollAccel implements ScrollAcceleration {
  private lastTickTime = 0
  private velocityHistory: number[] = []
  private readonly historySize = 3
  private readonly streakTimeout = 150

  constructor(
    private opts: {
      A?: number
      tau?: number
      maxMultiplier?: number
    } = {},
  ) {}

  tick(now = Date.now()): number {
    const A = this.opts.A ?? 0.8
    const tau = this.opts.tau ?? 3
    const maxMultiplier = this.opts.maxMultiplier ?? 6

    const dt = this.lastTickTime ? now - this.lastTickTime : Infinity
    this.lastTickTime = now

    // Reset streak if too much time has passed
    if (dt > this.streakTimeout) {
      this.velocityHistory = []
      return 1
    }

    // Track recent intervals
    if (dt !== Infinity) {
      this.velocityHistory.push(dt)
      if (this.velocityHistory.length > this.historySize) {
        this.velocityHistory.shift()
      }
    }

    // Calculate average interval (lower = faster scrolling)
    const avgInterval =
      this.velocityHistory.length > 0
        ? this.velocityHistory.reduce((a, b) => a + b, 0) / this.velocityHistory.length
        : Infinity

    if (avgInterval === Infinity) {
      return 1
    }

    // Convert interval to velocity: faster ticks = higher velocity
    // Normalize to a reference interval (e.g., 100ms = velocity of 1)
    const referenceInterval = 100
    const velocity = referenceInterval / avgInterval

    // Apply exponential curve based on velocity
    // Higher velocity (tighter ticks) = more acceleration
    const x = velocity / tau
    const multiplier = 1 + A * (Math.exp(x) - 1)

    return Math.min(multiplier, maxMultiplier)
  }

  reset(): void {
    this.lastTickTime = 0
    this.velocityHistory = []
  }
}
