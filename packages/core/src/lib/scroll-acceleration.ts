/**
 * macOS-inspired scroll acceleration.
 *
 * The class measures the time between consecutive scroll events and keeps a short
 * moving window of the latest intervals. The average interval determines which
 * multiplier to apply so that quick bursts accelerate and slower gestures stay precise.
 *
 * Options:
 * - threshold1: upper bound (ms) of the "medium" band. Raise to delay fast mode.
 * - threshold2: upper bound (ms) of the "fast" band. Lower to require tighter bursts.
 * - multiplier1: scale for medium speed. Higher values feel more eager to accelerate.
 * - multiplier2: scale for fast speed. Higher values make flings jump further.
 * - baseMultiplier: scale for slow scrolling. Set to 1 for linear behaviour.
 *
 * Default tuning mirrors the gentle macOS-style curve: relaxed scrolling stays
 * close to 1×, while rapid consecutive ticks climb through the medium and fast
 * bands without sudden jumps.
 */
export class MacOSScrollAccel {
  private lastNow = 0
  private velocityHistory: number[] = []
  private readonly historySize = 3 // three-sample window smooths jitter without masking bursts

  constructor(
    private opts: {
      threshold1?: number
      threshold2?: number
      multiplier1?: number
      multiplier2?: number
      baseMultiplier?: number
    } = {},
  ) {}

  tick(now = Date.now()): number {
    const threshold1 = this.opts.threshold1 ?? 100
    const threshold2 = this.opts.threshold2 ?? 40
    const multiplier1 = this.opts.multiplier1 ?? 2
    const multiplier2 = this.opts.multiplier2 ?? 4
    const baseMultiplier = this.opts.baseMultiplier ?? 1

    const dt = this.lastNow ? now - this.lastNow : Infinity
    this.lastNow = now

    if (dt !== Infinity) {
      this.velocityHistory.push(dt)
      if (this.velocityHistory.length > this.historySize) {
        this.velocityHistory.shift()
      }
    }

    const avgVelocity = this.velocityHistory.length > 0
      ? this.velocityHistory.reduce((a, b) => a + b, 0) / this.velocityHistory.length
      : Infinity
    // lower average interval ⇒ faster gestures ⇒ higher multiplier

    if (avgVelocity <= threshold2) {
      return multiplier2
    } else if (avgVelocity <= threshold1) {
      return multiplier1
    } else {
      return baseMultiplier
    }
  }

  reset(): void {
    this.lastNow = 0
    this.velocityHistory = []
  }
}
