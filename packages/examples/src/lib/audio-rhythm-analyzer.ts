export const AUDIO_ANALYSIS_FRAMES = 1024

const BASS_CUTOFF_HZ = 180
const ENVELOPE_ATTACK = 0.55
const ENVELOPE_RELEASE = 0.16
const BASELINE_RATE = 0.06
const PULSE_DECAY_MS = 230

export class AudioRhythmAnalyzer {
  level = 0
  pulse = 0
  bass = 0
  mid = 0
  treble = 0

  private bassFilter = 0
  private midFilter = 0
  private bassBaseline = 0.01
  private previousBassRms = 0

  update(pcm: Float32Array, channels: number, sampleRate: number, deltaMs: number): void {
    const channelCount = Math.max(1, Math.floor(channels))
    const frameCount = Math.min(AUDIO_ANALYSIS_FRAMES, Math.floor(pcm.length / channelCount))
    if (frameCount === 0 || sampleRate <= 0) {
      this.decay(deltaMs)
      return
    }

    const bassFilterRate = 1 - Math.exp((-2 * Math.PI * BASS_CUTOFF_HZ) / sampleRate)
    const midFilterRate = 1 - Math.exp((-2 * Math.PI * 2_000) / sampleRate)
    let sampleEnergy = 0
    let bassEnergy = 0
    let midEnergy = 0
    let trebleEnergy = 0
    for (let frame = 0; frame < frameCount; frame += 1) {
      const offset = frame * channelCount
      let sample = 0
      for (let channel = 0; channel < channelCount; channel += 1) sample += pcm[offset + channel] ?? 0
      sample /= channelCount
      this.bassFilter += bassFilterRate * (sample - this.bassFilter)
      this.midFilter += midFilterRate * (sample - this.midFilter)
      const mid = this.midFilter - this.bassFilter
      const treble = sample - this.midFilter
      sampleEnergy += sample * sample
      bassEnergy += this.bassFilter * this.bassFilter
      midEnergy += mid * mid
      trebleEnergy += treble * treble
    }

    const rms = Math.sqrt(sampleEnergy / frameCount)
    const bassRms = Math.sqrt(bassEnergy / frameCount)
    const midRms = Math.sqrt(midEnergy / frameCount)
    const trebleRms = Math.sqrt(trebleEnergy / frameCount)
    const targetLevel = Math.min(1, Math.sqrt(rms) * 1.35)
    const envelopeRate = targetLevel > this.level ? ENVELOPE_ATTACK : ENVELOPE_RELEASE
    this.level += (targetLevel - this.level) * envelopeRate
    this.bass = this.updateBand(this.bass, Math.min(1, Math.sqrt(bassRms) * 1.5), deltaMs)
    this.mid = this.updateBand(this.mid, Math.min(1, Math.sqrt(midRms) * 1.35), deltaMs)
    this.treble = this.updateBand(this.treble, Math.min(1, Math.sqrt(trebleRms) * 1.2), deltaMs)

    const onset = Math.max(0, bassRms - this.previousBassRms) / Math.max(0.01, this.bassBaseline)
    const bassFocus = Math.min(1, bassRms / Math.max(0.001, rms))
    const nextPulse = Math.min(1, onset * bassFocus * 1.8)
    this.pulse = Math.max(nextPulse, this.pulse * Math.exp(-Math.max(0, deltaMs) / PULSE_DECAY_MS))
    this.bassBaseline += (bassRms - this.bassBaseline) * BASELINE_RATE
    this.previousBassRms = bassRms
  }

  reset(): void {
    this.level = 0
    this.pulse = 0
    this.bass = 0
    this.mid = 0
    this.treble = 0
    this.bassFilter = 0
    this.midFilter = 0
    this.bassBaseline = 0.01
    this.previousBassRms = 0
  }

  private decay(deltaMs: number): void {
    const decay = Math.exp(-Math.max(0, deltaMs) / PULSE_DECAY_MS)
    this.level *= decay
    this.pulse *= decay
    this.bass *= decay
    this.mid *= decay
    this.treble *= decay
  }

  private updateBand(current: number, target: number, deltaMs: number): number {
    const timeConstantMs = target > current ? 45 : 240
    const rate = 1 - Math.exp(-Math.max(0, deltaMs) / timeConstantMs)
    return current + (target - current) * rate
  }
}
