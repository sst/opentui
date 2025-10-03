export class MacOSScrollAccel {
  private lastNow = 0
  private velocityHistory: number[] = []
  private readonly historySize = 3

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
    const threshold1 = this.opts.threshold1 ?? 150
    const threshold2 = this.opts.threshold2 ?? 50
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