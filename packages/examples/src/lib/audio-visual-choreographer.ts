export interface AudioVisualLevels {
  level: number
  pulse: number
}

const IMPACT_DURATION_MS = 160
const IMPACT_REFRACTORY_MS = 180

export class AudioVisualChoreographer {
  private previousTimeMs = 0
  private pulseArmed = true
  private lastImpactMs = Number.NEGATIVE_INFINITY

  update(timeMs: number, levels: AudioVisualLevels): void {
    const safeTimeMs = Math.max(this.previousTimeMs, timeMs)
    this.previousTimeMs = safeTimeMs

    if (levels.pulse <= 0.34) this.pulseArmed = true
    if (this.pulseArmed && levels.pulse >= 0.72 && safeTimeMs - this.lastImpactMs >= IMPACT_REFRACTORY_MS) {
      this.pulseArmed = false
      this.lastImpactMs = safeTimeMs
    }
  }

  get impact(): number {
    const ageMs = this.previousTimeMs - this.lastImpactMs
    if (ageMs < 0 || ageMs >= IMPACT_DURATION_MS) return 0
    const progress = ageMs / IMPACT_DURATION_MS
    return Math.sin(progress * Math.PI) * (1 - progress * 0.35)
  }

  reset(timeMs = 0): void {
    this.previousTimeMs = timeMs
    this.pulseArmed = true
    this.lastImpactMs = Number.NEGATIVE_INFINITY
  }

  cancel(timeMs: number): void {
    this.previousTimeMs = Math.max(this.previousTimeMs, timeMs)
    this.pulseArmed = true
    this.lastImpactMs = Number.NEGATIVE_INFINITY
  }
}
