import { describe, expect, test } from "bun:test"
import {
  AdaptiveBeatDetector,
  ReactiveSpectrumAnalyzer,
  SPECTRUM_BAND_CENTERS,
  SPECTRUM_FFT_SIZE,
  type ReactiveSpectrumFrame,
} from "./adaptive-spectrum.js"

const SAMPLE_RATE = 48_000

function detectorFrame(kickFlux: number, snareFlux: number): ReactiveSpectrumFrame {
  return {
    levels: new Float32Array(SPECTRUM_BAND_CENTERS.length),
    kickFlux,
    snareFlux,
  }
}

function stereoSignal(amplitude: number, frequencies: readonly number[]): Float32Array {
  const pcm = new Float32Array(SPECTRUM_FFT_SIZE * 2)
  for (let frame = 0; frame < SPECTRUM_FFT_SIZE; frame++) {
    const time = frame / SAMPLE_RATE
    const sample =
      frequencies.reduce((sum, frequency) => sum + Math.sin(2 * Math.PI * frequency * time), 0) *
      (amplitude / Math.max(1, frequencies.length))
    pcm[frame * 2] = sample
    pcm[frame * 2 + 1] = sample
  }
  return pcm
}

function drumSignal(drum: "kick" | "snare" | "hat"): Float32Array {
  const pcm = new Float32Array(SPECTRUM_FFT_SIZE * 2)
  let noiseState = drum === "snare" ? 0x5f3759df : 0x12345678
  let previousNoise = 0
  for (let frame = 0; frame < SPECTRUM_FFT_SIZE; frame++) {
    const time = frame / SAMPLE_RATE
    noiseState = (noiseState * 1_664_525 + 1_013_904_223) >>> 0
    const noise = (noiseState / 0xffffffff) * 2 - 1
    let sample: number
    if (drum === "kick") {
      const phase = 2 * Math.PI * (46 * time + (112 * (1 - Math.exp(-32 * time))) / 32)
      sample = Math.sin(phase) * Math.exp(-15 * time) * 0.92
    } else if (drum === "snare") {
      const highNoise = noise - previousNoise * 0.55
      const body = Math.sin(2 * Math.PI * 185 * time) * Math.exp(-24 * time) * 0.22
      sample = (highNoise * 0.64 + body) * Math.exp(-17 * time)
    } else {
      sample = (noise - previousNoise) * Math.exp(-62 * time) * 0.34
    }
    previousNoise = noise
    pcm[frame * 2] = sample
    pcm[frame * 2 + 1] = sample
  }
  return pcm
}

describe("AdaptiveBeatDetector", () => {
  test("does not hold kick or snare active for a constantly loud spectrum", () => {
    const detector = new AdaptiveBeatDetector()
    let kickTriggers = 0
    let snareTriggers = 0

    for (let frame = 0; frame < 120; frame++) {
      const result = detector.update(detectorFrame(0.8, 0.75), 50)
      if (result.kick.triggered) kickTriggers++
      if (result.snare.triggered) snareTriggers++
    }

    expect(kickTriggers).toBe(0)
    expect(snareTriggers).toBe(0)
  })

  test("triggers independent kick and snare outliers over their rolling baselines", () => {
    const detector = new AdaptiveBeatDetector()
    for (let frame = 0; frame < 20; frame++) detector.update(detectorFrame(0.08, 0.1), 50)

    const kick = detector.update(detectorFrame(0.75, 0.1), 50)
    expect(kick.kick.triggered).toBe(true)
    expect(kick.snare.triggered).toBe(false)

    detector.update(detectorFrame(0.08, 0.1), 150)
    const snare = detector.update(detectorFrame(0.08, 0.8), 50)
    expect(snare.kick.triggered).toBe(false)
    expect(snare.snare.triggered).toBe(true)
  })
})

describe("ReactiveSpectrumAnalyzer", () => {
  test("uses a 4096-point transform and separates kick from broad snare content", () => {
    expect(SPECTRUM_FFT_SIZE).toBe(4096)

    const kickAnalyzer = new ReactiveSpectrumAnalyzer()
    kickAnalyzer.analyze(stereoSignal(0.3, [1000]), 2, SAMPLE_RATE)
    const kick = kickAnalyzer.analyze(stereoSignal(0.3, [70]), 2, SAMPLE_RATE)

    const snareAnalyzer = new ReactiveSpectrumAnalyzer()
    snareAnalyzer.analyze(stereoSignal(0.3, [70]), 2, SAMPLE_RATE)
    const snare = snareAnalyzer.analyze(stereoSignal(0.3, [220, 2200]), 2, SAMPLE_RATE)

    expect(kick.kickFlux).toBeGreaterThan(kick.snareFlux * 4)
    expect(snare.snareFlux).toBeGreaterThan(snare.kickFlux * 4)
  })

  test("produces the same onset flux when the complete signal is scaled louder", () => {
    const quiet = new ReactiveSpectrumAnalyzer()
    quiet.analyze(stereoSignal(0.08, [1000]), 2, SAMPLE_RATE)
    const quietOnset = quiet.analyze(stereoSignal(0.08, [70, 1000]), 2, SAMPLE_RATE)

    const loud = new ReactiveSpectrumAnalyzer()
    loud.analyze(stereoSignal(0.8, [1000]), 2, SAMPLE_RATE)
    const loudOnset = loud.analyze(stereoSignal(0.8, [70, 1000]), 2, SAMPLE_RATE)

    expect(loudOnset.kickFlux).toBeCloseTo(quietOnset.kickFlux, 4)
    expect(loudOnset.snareFlux).toBeCloseTo(quietOnset.snareFlux, 4)
  })

  test("does not treat an in-stream gain increase as a kick or snare onset", () => {
    const analyzer = new ReactiveSpectrumAnalyzer()
    analyzer.analyze(stereoSignal(0.1, [70, 220, 2200]), 2, SAMPLE_RATE)
    const louder = analyzer.analyze(stereoSignal(0.8, [70, 220, 2200]), 2, SAMPLE_RATE)

    expect(louder.kickFlux).toBeLessThan(0.0001)
    expect(louder.snareFlux).toBeLessThan(0.0001)
  })

  test("primes reset history without reporting the first frame as an onset", () => {
    const analyzer = new ReactiveSpectrumAnalyzer()
    analyzer.reset()
    const first = analyzer.analyze(stereoSignal(0.8, [70, 220, 2200]), 2, SAMPLE_RATE)

    expect(first.kickFlux).toBe(0)
    expect(first.snareFlux).toBe(0)
  })

  test("does not classify the synthesized hat as a kick or broad snare", () => {
    const baseline = stereoSignal(0.05, [1000])
    const kickAnalyzer = new ReactiveSpectrumAnalyzer()
    kickAnalyzer.analyze(baseline, 2, SAMPLE_RATE)
    const kick = kickAnalyzer.analyze(drumSignal("kick"), 2, SAMPLE_RATE)

    const snareAnalyzer = new ReactiveSpectrumAnalyzer()
    snareAnalyzer.analyze(baseline, 2, SAMPLE_RATE)
    const snare = snareAnalyzer.analyze(drumSignal("snare"), 2, SAMPLE_RATE)

    const hatAnalyzer = new ReactiveSpectrumAnalyzer()
    hatAnalyzer.analyze(baseline, 2, SAMPLE_RATE)
    const hat = hatAnalyzer.analyze(drumSignal("hat"), 2, SAMPLE_RATE)

    expect(snare.kickFlux).toBeLessThan(kick.kickFlux * 0.5)
    expect(kick.snareFlux).toBeLessThan(snare.snareFlux * 0.5)
    expect(hat.kickFlux).toBeLessThan(kick.kickFlux * 0.1)
    expect(hat.snareFlux).toBeLessThan(snare.snareFlux * 0.5)
  })

  test("does not trigger either detector from cross-band leakage or the synthesized hat", () => {
    const classify = (frame: ReactiveSpectrumFrame) => {
      const detector = new AdaptiveBeatDetector()
      for (let index = 0; index < 20; index++) detector.update(detectorFrame(0, 0), 50)
      return detector.update(frame, 50)
    }
    const analyze = (drum: "kick" | "snare" | "hat") => {
      const analyzer = new ReactiveSpectrumAnalyzer()
      analyzer.analyze(stereoSignal(0.05, [1000]), 2, SAMPLE_RATE)
      return analyzer.analyze(drumSignal(drum), 2, SAMPLE_RATE)
    }

    const kick = classify(analyze("kick"))
    expect(kick.kick.triggered).toBe(true)
    expect(kick.snare.triggered).toBe(false)

    const snare = classify(analyze("snare"))
    expect(snare.kick.triggered).toBe(false)
    expect(snare.snare.triggered).toBe(true)

    const hat = classify(analyze("hat"))
    expect(hat.kick.triggered).toBe(false)
    expect(hat.snare.triggered).toBe(false)
  })
})
