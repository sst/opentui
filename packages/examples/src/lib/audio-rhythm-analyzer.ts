import FFT from "fft.js"

export const AUDIO_ANALYSIS_FRAMES = 1024
export const AUDIO_SPECTRUM_BANDS = 16

const BASS_CUTOFF_HZ = 180
const SPECTRUM_LOW_HZ = 55
const SPECTRUM_HIGH_HZ = 14_000
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
  readonly spectrum = new Float32Array(AUDIO_SPECTRUM_BANDS)

  private readonly fft = new FFT(AUDIO_ANALYSIS_FRAMES)
  private readonly fftInput = new Float32Array(AUDIO_ANALYSIS_FRAMES)
  private readonly fftOutput = this.fft.createComplexArray()
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
      this.fftInput[frame] = sample * (0.5 - 0.5 * Math.cos((Math.PI * 2 * frame) / Math.max(1, frameCount - 1)))
      this.bassFilter += bassFilterRate * (sample - this.bassFilter)
      this.midFilter += midFilterRate * (sample - this.midFilter)
      const mid = this.midFilter - this.bassFilter
      const treble = sample - this.midFilter
      sampleEnergy += sample * sample
      bassEnergy += this.bassFilter * this.bassFilter
      midEnergy += mid * mid
      trebleEnergy += treble * treble
    }
    this.fftInput.fill(0, frameCount)
    this.updateSpectrum(sampleRate, deltaMs)

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
    this.spectrum.fill(0)
    this.fftInput.fill(0)
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
    for (let band = 0; band < this.spectrum.length; band += 1) this.spectrum[band] *= decay
  }

  private updateSpectrum(sampleRate: number, deltaMs: number): void {
    this.fft.realTransform(this.fftOutput, this.fftInput)
    const frequencyRatio = SPECTRUM_HIGH_HZ / SPECTRUM_LOW_HZ
    for (let band = 0; band < this.spectrum.length; band += 1) {
      const lowHz = SPECTRUM_LOW_HZ * frequencyRatio ** (band / this.spectrum.length)
      const highHz = SPECTRUM_LOW_HZ * frequencyRatio ** ((band + 1) / this.spectrum.length)
      const lowBin = Math.max(1, Math.floor((lowHz * AUDIO_ANALYSIS_FRAMES) / sampleRate))
      const highBin = Math.min(
        AUDIO_ANALYSIS_FRAMES / 2 - 1,
        Math.max(lowBin, Math.ceil((highHz * AUDIO_ANALYSIS_FRAMES) / sampleRate)),
      )
      let peak = 0
      for (let bin = lowBin; bin <= highBin; bin += 1) {
        const real = this.fftOutput[bin * 2] ?? 0
        const imaginary = this.fftOutput[bin * 2 + 1] ?? 0
        peak = Math.max(peak, Math.hypot(real, imaginary) / (AUDIO_ANALYSIS_FRAMES * 0.5))
      }
      const target = Math.min(1, Math.sqrt(peak) * 1.45)
      this.spectrum[band] = this.updateBand(this.spectrum[band] ?? 0, target, deltaMs)
    }
  }

  private updateBand(current: number, target: number, deltaMs: number): number {
    const timeConstantMs = target > current ? 45 : 240
    const rate = 1 - Math.exp(-Math.max(0, deltaMs) / timeConstantMs)
    return current + (target - current) * rate
  }
}
