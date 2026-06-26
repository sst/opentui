export interface AudioVisualLevels {
  level: number
  pulse: number
  bassTransient: number
  midTransient: number
  trebleTransient: number
}

const IMPACT_DURATION_MS = 160
const IMPACT_REFRACTORY_MS = 180

export class AudioVisualChoreographer {
  private previousTimeMs = 0
  private pulseArmed = true
  private lastImpactMs = Number.NEGATIVE_INFINITY
  private midArmed = true
  private trebleArmed = true
  private lastMidImpactMs = Number.NEGATIVE_INFINITY
  private lastTrebleImpactMs = Number.NEGATIVE_INFINITY

  update(timeMs: number, levels: AudioVisualLevels): void {
    const safeTimeMs = Math.max(this.previousTimeMs, timeMs)
    this.previousTimeMs = safeTimeMs

    const bassOnset = Math.max(levels.pulse, levels.bassTransient)
    if (bassOnset <= 0.34) this.pulseArmed = true
    if (this.pulseArmed && bassOnset >= 0.72 && safeTimeMs - this.lastImpactMs >= IMPACT_REFRACTORY_MS) {
      this.pulseArmed = false
      this.lastImpactMs = safeTimeMs
    }
    if (levels.midTransient <= 0.25) this.midArmed = true
    if (this.midArmed && levels.midTransient >= 0.62 && safeTimeMs - this.lastMidImpactMs >= 140) {
      this.midArmed = false
      this.lastMidImpactMs = safeTimeMs
    }
    if (levels.trebleTransient <= 0.2) this.trebleArmed = true
    if (this.trebleArmed && levels.trebleTransient >= 0.55 && safeTimeMs - this.lastTrebleImpactMs >= 90) {
      this.trebleArmed = false
      this.lastTrebleImpactMs = safeTimeMs
    }
  }

  get impact(): number {
    return this.bassImpact
  }

  get bassImpact(): number {
    const ageMs = this.previousTimeMs - this.lastImpactMs
    if (ageMs < 0 || ageMs >= IMPACT_DURATION_MS) return 0
    const progress = ageMs / IMPACT_DURATION_MS
    return Math.sin(progress * Math.PI) * (1 - progress * 0.35)
  }

  get midImpact(): number {
    return this.gesture(this.lastMidImpactMs, 130)
  }

  get trebleImpact(): number {
    return this.gesture(this.lastTrebleImpactMs, 90)
  }

  reset(timeMs = 0): void {
    this.previousTimeMs = timeMs
    this.pulseArmed = true
    this.lastImpactMs = Number.NEGATIVE_INFINITY
    this.midArmed = true
    this.trebleArmed = true
    this.lastMidImpactMs = Number.NEGATIVE_INFINITY
    this.lastTrebleImpactMs = Number.NEGATIVE_INFINITY
  }

  cancel(timeMs: number): void {
    this.previousTimeMs = Math.max(this.previousTimeMs, timeMs)
    this.pulseArmed = true
    this.lastImpactMs = Number.NEGATIVE_INFINITY
    this.lastMidImpactMs = Number.NEGATIVE_INFINITY
    this.lastTrebleImpactMs = Number.NEGATIVE_INFINITY
  }

  private gesture(startedAtMs: number, durationMs: number): number {
    const ageMs = this.previousTimeMs - startedAtMs
    if (ageMs < 0 || ageMs >= durationMs) return 0
    const progress = ageMs / durationMs
    return Math.sin(progress * Math.PI) * (1 - progress * 0.35)
  }
}
