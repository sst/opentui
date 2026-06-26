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
  bassTransient = 0
  midTransient = 0
  trebleTransient = 0
  stereoBalance = 0
  stereoWidth = 0
  readonly spectrum = new Float32Array(AUDIO_SPECTRUM_BANDS)

  private readonly fft = new FFT(AUDIO_ANALYSIS_FRAMES)
  private readonly fftInput = new Float32Array(AUDIO_ANALYSIS_FRAMES)
  private readonly fftOutput = this.fft.createComplexArray()
  private readonly sideFftInput = new Float32Array(AUDIO_ANALYSIS_FRAMES)
  private readonly sideFftOutput = this.fft.createComplexArray()
  private bassFilter = 0
  private midFilter = 0
  private leftBassFilter = 0
  private rightBassFilter = 0
  private leftMidFilter = 0
  private rightMidFilter = 0
  private bassBaseline = 0.01
  private midBaseline = 0.01
  private trebleBaseline = 0.01
  private previousBassRms = 0
  private previousMidRms = 0
  private previousTrebleRms = 0

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
    let leftEnergy = 0
    let rightEnergy = 0
    let sideEnergy = 0
    for (let frame = 0; frame < frameCount; frame += 1) {
      const offset = frame * channelCount
      const left = pcm[offset] ?? 0
      const right = channelCount > 1 ? (pcm[offset + 1] ?? left) : left
      let sample = 0
      for (let channel = 0; channel < channelCount; channel += 1) sample += pcm[offset + channel] ?? 0
      sample /= channelCount
      const window = 0.5 - 0.5 * Math.cos((Math.PI * 2 * frame) / Math.max(1, frameCount - 1))
      this.fftInput[frame] = sample * window
      this.sideFftInput[frame] = (left - right) * 0.5 * window
      this.bassFilter += bassFilterRate * (sample - this.bassFilter)
      this.midFilter += midFilterRate * (sample - this.midFilter)
      this.leftBassFilter += bassFilterRate * (left - this.leftBassFilter)
      this.rightBassFilter += bassFilterRate * (right - this.rightBassFilter)
      this.leftMidFilter += midFilterRate * (left - this.leftMidFilter)
      this.rightMidFilter += midFilterRate * (right - this.rightMidFilter)
      const mid =
        Math.hypot(this.leftMidFilter - this.leftBassFilter, this.rightMidFilter - this.rightBassFilter) / Math.SQRT2
      const treble = Math.hypot(left - this.leftMidFilter, right - this.rightMidFilter) / Math.SQRT2
      sampleEnergy += sample * sample
      bassEnergy += (this.leftBassFilter * this.leftBassFilter + this.rightBassFilter * this.rightBassFilter) * 0.5
      midEnergy += mid * mid
      trebleEnergy += treble * treble
      leftEnergy += left * left
      rightEnergy += right * right
      const side = (left - right) * 0.5
      sideEnergy += side * side
    }
    this.fftInput.fill(0, frameCount)
    this.sideFftInput.fill(0, frameCount)
    this.updateSpectrum(sampleRate, deltaMs)

    const monoRms = Math.sqrt(sampleEnergy / frameCount)
    const leftRms = Math.sqrt(leftEnergy / frameCount)
    const rightRms = Math.sqrt(rightEnergy / frameCount)
    const rms = Math.max(monoRms, Math.hypot(leftRms, rightRms) / Math.SQRT2)
    const bassRms = Math.sqrt(bassEnergy / frameCount)
    const midRms = Math.sqrt(midEnergy / frameCount)
    const trebleRms = Math.sqrt(trebleEnergy / frameCount)
    const targetLevel = Math.min(1, Math.sqrt(rms) * 1.35)
    const envelopeRate = targetLevel > this.level ? ENVELOPE_ATTACK : ENVELOPE_RELEASE
    this.level += (targetLevel - this.level) * envelopeRate
    this.bass = this.updateBand(this.bass, Math.min(1, Math.sqrt(bassRms) * 1.5), deltaMs)
    this.mid = this.updateBand(this.mid, Math.min(1, Math.sqrt(midRms) * 1.35), deltaMs)
    this.treble = this.updateBand(this.treble, Math.min(1, Math.sqrt(trebleRms) * 1.2), deltaMs)
    const bandTotal = bassRms + midRms + trebleRms
    this.bassTransient = this.updateTransient(
      bassRms,
      this.previousBassRms,
      this.bassBaseline,
      bandTotal,
      this.bassTransient,
      deltaMs,
    )
    this.midTransient = this.updateTransient(
      midRms,
      this.previousMidRms,
      this.midBaseline,
      bandTotal,
      this.midTransient,
      deltaMs,
    )
    this.trebleTransient = this.updateTransient(
      trebleRms,
      this.previousTrebleRms,
      this.trebleBaseline,
      bandTotal,
      this.trebleTransient,
      deltaMs,
    )
    const stereoTotal = leftRms + rightRms
    const balanceTarget = stereoTotal > 0.0001 ? (rightRms - leftRms) / stereoTotal : 0
    const widthTarget = Math.min(1, Math.sqrt(sideEnergy / frameCount) / Math.max(0.001, rms))
    this.stereoBalance = this.updateSigned(this.stereoBalance, balanceTarget, deltaMs)
    this.stereoWidth = this.updateBand(this.stereoWidth, widthTarget, deltaMs)

    const onset = Math.max(0, bassRms - this.previousBassRms) / Math.max(0.01, this.bassBaseline)
    const bassFocus = Math.min(1, bassRms / Math.max(0.001, rms))
    const nextPulse = Math.min(1, onset * bassFocus * 1.8)
    this.pulse = Math.max(nextPulse, this.pulse * Math.exp(-Math.max(0, deltaMs) / PULSE_DECAY_MS))
    this.bassBaseline += (bassRms - this.bassBaseline) * BASELINE_RATE
    this.midBaseline += (midRms - this.midBaseline) * BASELINE_RATE
    this.trebleBaseline += (trebleRms - this.trebleBaseline) * BASELINE_RATE
    this.previousBassRms = bassRms
    this.previousMidRms = midRms
    this.previousTrebleRms = trebleRms
  }

  reset(): void {
    this.level = 0
    this.pulse = 0
    this.bass = 0
    this.mid = 0
    this.treble = 0
    this.bassTransient = 0
    this.midTransient = 0
    this.trebleTransient = 0
    this.stereoBalance = 0
    this.stereoWidth = 0
    this.spectrum.fill(0)
    this.fftInput.fill(0)
    this.sideFftInput.fill(0)
    this.bassFilter = 0
    this.midFilter = 0
    this.leftBassFilter = 0
    this.rightBassFilter = 0
    this.leftMidFilter = 0
    this.rightMidFilter = 0
    this.bassBaseline = 0.01
    this.midBaseline = 0.01
    this.trebleBaseline = 0.01
    this.previousBassRms = 0
    this.previousMidRms = 0
    this.previousTrebleRms = 0
  }

  private decay(deltaMs: number): void {
    const decay = Math.exp(-Math.max(0, deltaMs) / PULSE_DECAY_MS)
    this.level *= decay
    this.pulse *= decay
    this.bass *= decay
    this.mid *= decay
    this.treble *= decay
    this.bassTransient *= decay
    this.midTransient *= decay
    this.trebleTransient *= decay
    this.stereoBalance *= decay
    this.stereoWidth *= decay
    for (let band = 0; band < this.spectrum.length; band += 1) this.spectrum[band] *= decay
  }

  private updateSpectrum(sampleRate: number, deltaMs: number): void {
    this.fft.realTransform(this.fftOutput, this.fftInput)
    this.fft.realTransform(this.sideFftOutput, this.sideFftInput)
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
        const sideReal = this.sideFftOutput[bin * 2] ?? 0
        const sideImaginary = this.sideFftOutput[bin * 2 + 1] ?? 0
        peak = Math.max(peak, Math.hypot(real, imaginary, sideReal, sideImaginary) / (AUDIO_ANALYSIS_FRAMES * 0.5))
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

  private updateTransient(
    value: number,
    previous: number,
    baseline: number,
    bandTotal: number,
    current: number,
    deltaMs: number,
  ): number {
    const onset = Math.max(0, value - previous) / Math.max(0.01, baseline)
    const focus = value / Math.max(0.001, bandTotal)
    const next = Math.min(1, onset * 0.5) * Math.min(1, focus * 1.4)
    return Math.max(next, current * Math.exp(-Math.max(0, deltaMs) / 140))
  }

  private updateSigned(current: number, target: number, deltaMs: number): number {
    const rate = 1 - Math.exp(-Math.max(0, deltaMs) / 70)
    return current + (target - current) * rate
  }
}
