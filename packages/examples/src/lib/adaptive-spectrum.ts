import FFT from "fft.js"

export const SPECTRUM_FFT_SIZE = 4096
export const SPECTRUM_BAND_CENTERS = [63, 160, 400, 1000, 2500, 6000, 12000, 16000] as const

const SPECTRUM_DB_FLOOR = -72
const SPECTRUM_DB_CEILING = 0
const KICK_RANGE = [35, 150] as const
const SNARE_BODY_RANGE = [160, 350] as const
const SNARE_CRACK_RANGE = [900, 7000] as const

export interface ReactiveSpectrumFrame {
  levels: Float32Array
  kickFlux: number
  snareFlux: number
}

export interface AdaptiveOnset {
  triggered: boolean
  value: number
  threshold: number
}

export interface AdaptiveBeatResult {
  kick: AdaptiveOnset
  snare: AdaptiveOnset
}

interface AdaptiveThresholdOptions {
  historySize: number
  warmupSamples: number
  standardDeviations: number
  refractoryMs: number
  minimumValue: number
}

class AdaptiveThreshold {
  private readonly history: number[] = []
  private clockMs = 0
  private lastTriggerMs = Number.NEGATIVE_INFINITY

  constructor(private readonly options: AdaptiveThresholdOptions) {}

  public update(value: number | null, elapsedMs: number): AdaptiveOnset {
    this.clockMs += elapsedMs
    if (value === null) return { triggered: false, value: 0, threshold: this.threshold() }

    const threshold = this.threshold()
    const warmedUp = this.history.length >= this.options.warmupSamples
    const refractoryOver = this.clockMs - this.lastTriggerMs >= this.options.refractoryMs
    const triggered = warmedUp && refractoryOver && value > threshold
    if (triggered) this.lastTriggerMs = this.clockMs

    this.history.push(value)
    if (this.history.length > this.options.historySize) this.history.shift()
    return { triggered, value, threshold }
  }

  public reset(): void {
    this.history.length = 0
    this.clockMs = 0
    this.lastTriggerMs = Number.NEGATIVE_INFINITY
  }

  private threshold(): number {
    if (this.history.length === 0) return Number.POSITIVE_INFINITY
    const mean = this.history.reduce((sum, value) => sum + value, 0) / this.history.length
    const variance =
      this.history.reduce((sum, value) => {
        const difference = value - mean
        return sum + difference * difference
      }, 0) / this.history.length
    return Math.max(this.options.minimumValue, mean + Math.sqrt(variance) * this.options.standardDeviations)
  }
}

export class AdaptiveBeatDetector {
  private readonly kick = new AdaptiveThreshold({
    historySize: 48,
    warmupSamples: 12,
    standardDeviations: 1.5,
    refractoryMs: 100,
    minimumValue: 0.01,
  })
  private readonly snare = new AdaptiveThreshold({
    historySize: 48,
    warmupSamples: 12,
    standardDeviations: 1.5,
    refractoryMs: 100,
    minimumValue: 0.02,
  })

  public update(frame: ReactiveSpectrumFrame | null, elapsedMs: number): AdaptiveBeatResult {
    return {
      kick: this.kick.update(frame?.kickFlux ?? null, elapsedMs),
      snare: this.snare.update(frame?.snareFlux ?? null, elapsedMs),
    }
  }

  public reset(): void {
    this.kick.reset()
    this.snare.reset()
  }
}

export class ReactiveSpectrumAnalyzer {
  private readonly fft = new FFT(SPECTRUM_FFT_SIZE)
  private readonly input = new Float32Array(SPECTRUM_FFT_SIZE)
  private readonly output = this.fft.createComplexArray()
  private readonly window = new Float32Array(SPECTRUM_FFT_SIZE)
  private readonly magnitudes = new Float64Array(SPECTRUM_FFT_SIZE / 2)
  private readonly normalizedMagnitudes = new Float64Array(SPECTRUM_FFT_SIZE / 2)
  private readonly previousNormalizedMagnitudes = new Float64Array(SPECTRUM_FFT_SIZE / 2)
  private windowSum = 0
  private primed = false

  constructor() {
    for (let index = 0; index < SPECTRUM_FFT_SIZE; index++) {
      const value = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (SPECTRUM_FFT_SIZE - 1)))
      this.window[index] = value
      this.windowSum += value
    }
  }

  public analyze(pcm: Float32Array, channels: number, sampleRate: number): ReactiveSpectrumFrame {
    const channelCount = Math.max(1, Math.floor(channels))
    if (pcm.length < SPECTRUM_FFT_SIZE * channelCount) {
      throw new RangeError(`Expected ${SPECTRUM_FFT_SIZE} frames, received ${Math.floor(pcm.length / channelCount)}`)
    }

    for (let frame = 0; frame < SPECTRUM_FFT_SIZE; frame++) {
      const offset = frame * channelCount
      const left = pcm[offset] ?? 0
      const right = channelCount > 1 ? (pcm[offset + 1] ?? left) : left
      this.input[frame] = (left + right) * 0.5 * (this.window[frame] ?? 0)
    }
    this.fft.realTransform(this.output, this.input)

    for (let bin = 1; bin < SPECTRUM_FFT_SIZE / 2; bin++) {
      const real = this.output[bin * 2] ?? 0
      const imaginary = this.output[bin * 2 + 1] ?? 0
      this.magnitudes[bin] = (2 * Math.hypot(real, imaginary)) / this.windowSum
    }

    const [firstAnalysisBin, lastAnalysisBin] = this.binRange(30, 16_000, sampleRate)
    let totalMagnitude = 0
    for (let bin = firstAnalysisBin; bin < lastAnalysisBin; bin++) totalMagnitude += this.magnitudes[bin] ?? 0
    this.normalizedMagnitudes.fill(0)
    for (let bin = firstAnalysisBin; bin < lastAnalysisBin; bin++) {
      this.normalizedMagnitudes[bin] = (this.magnitudes[bin] ?? 0) / Math.max(totalMagnitude, 1e-8)
    }

    const levels = new Float32Array(SPECTRUM_BAND_CENTERS.length)
    for (let band = 0; band < SPECTRUM_BAND_CENTERS.length; band++) {
      const center = SPECTRUM_BAND_CENTERS[band]!
      const previous = SPECTRUM_BAND_CENTERS[band - 1]
      const next = SPECTRUM_BAND_CENTERS[band + 1]
      const low = previous ? Math.sqrt(previous * center) : center / Math.sqrt((next ?? center * 2) / center)
      const high = next ? Math.sqrt(center * next) : center * Math.sqrt(center / (previous ?? center / 2))
      const [firstBin, lastBin] = this.binRange(low, high, sampleRate)
      let maximum = 0
      for (let bin = firstBin; bin < lastBin; bin++) maximum = Math.max(maximum, this.magnitudes[bin] ?? 0)
      const decibels = 20 * Math.log10(Math.max(maximum, 1e-8))
      levels[band] = clamp((decibels - SPECTRUM_DB_FLOOR) / (SPECTRUM_DB_CEILING - SPECTRUM_DB_FLOOR), 0, 1)
    }

    const kickFlux = this.primed ? this.bandFlux(KICK_RANGE[0], KICK_RANGE[1], sampleRate) : 0
    const snareBodyFlux = this.primed ? this.bandFlux(SNARE_BODY_RANGE[0], SNARE_BODY_RANGE[1], sampleRate) : 0
    const snareCrackFlux = this.primed ? this.bandFlux(SNARE_CRACK_RANGE[0], SNARE_CRACK_RANGE[1], sampleRate) : 0
    const snareFlux = Math.sqrt(snareBodyFlux * snareCrackFlux)
    this.previousNormalizedMagnitudes.set(this.normalizedMagnitudes)
    this.primed = true
    return { levels, kickFlux, snareFlux }
  }

  public reset(): void {
    this.input.fill(0)
    this.output.fill(0)
    this.magnitudes.fill(0)
    this.normalizedMagnitudes.fill(0)
    this.previousNormalizedMagnitudes.fill(0)
    this.primed = false
  }

  private bandFlux(low: number, high: number, sampleRate: number): number {
    const [firstBin, lastBin] = this.binRange(low, high, sampleRate)
    let positiveFlux = 0
    for (let bin = firstBin; bin < lastBin; bin++) {
      const current = this.normalizedMagnitudes[bin] ?? 0
      positiveFlux += Math.max(0, current - (this.previousNormalizedMagnitudes[bin] ?? 0))
    }
    return positiveFlux
  }

  private binRange(low: number, high: number, sampleRate: number): [number, number] {
    return [
      Math.max(1, Math.floor((low * SPECTRUM_FFT_SIZE) / sampleRate)),
      Math.min(SPECTRUM_FFT_SIZE / 2, Math.ceil((high * SPECTRUM_FFT_SIZE) / sampleRate)),
    ]
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
