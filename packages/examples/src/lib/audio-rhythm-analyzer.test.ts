import { expect, test } from "bun:test"

import { AUDIO_ANALYSIS_FRAMES, AUDIO_SPECTRUM_BANDS, AudioRhythmAnalyzer } from "./audio-rhythm-analyzer.js"

const SAMPLE_RATE = 48_000

function sineWave(frequency: number, amplitude: number): Float32Array {
  const pcm = new Float32Array(AUDIO_ANALYSIS_FRAMES * 2)
  for (let frame = 0; frame < AUDIO_ANALYSIS_FRAMES; frame += 1) {
    const sample = Math.sin((frame * Math.PI * 2 * frequency) / SAMPLE_RATE) * amplitude
    pcm[frame * 2] = sample
    pcm[frame * 2 + 1] = sample
  }
  return pcm
}

function stereoSineWave(frequency: number, leftAmplitude: number, rightAmplitude: number): Float32Array {
  const pcm = new Float32Array(AUDIO_ANALYSIS_FRAMES * 2)
  for (let frame = 0; frame < AUDIO_ANALYSIS_FRAMES; frame += 1) {
    const sample = Math.sin((frame * Math.PI * 2 * frequency) / SAMPLE_RATE)
    pcm[frame * 2] = sample * leftAmplitude
    pcm[frame * 2 + 1] = sample * rightAmplitude
  }
  return pcm
}

test("silence produces no audio-reactive motion", () => {
  const analyzer = new AudioRhythmAnalyzer()

  analyzer.update(new Float32Array(AUDIO_ANALYSIS_FRAMES * 2), 2, SAMPLE_RATE, 80)

  expect(analyzer.level).toBe(0)
  expect(analyzer.pulse).toBe(0)
})

test("a bass onset produces a strong rhythm pulse", () => {
  const analyzer = new AudioRhythmAnalyzer()

  analyzer.update(sineWave(80, 0.8), 2, SAMPLE_RATE, 80)

  expect(analyzer.level).toBeGreaterThan(0.5)
  expect(analyzer.pulse).toBeGreaterThan(0.8)
})

test("bass drives a stronger onset than treble", () => {
  const bassAnalyzer = new AudioRhythmAnalyzer()
  const trebleAnalyzer = new AudioRhythmAnalyzer()

  bassAnalyzer.update(sineWave(80, 0.6), 2, SAMPLE_RATE, 80)
  trebleAnalyzer.update(sineWave(4_000, 0.6), 2, SAMPLE_RATE, 80)

  expect(bassAnalyzer.pulse).toBeGreaterThan(trebleAnalyzer.pulse * 2)
})

test("equalizer envelopes separate bass, mid, and treble", () => {
  const bassAnalyzer = new AudioRhythmAnalyzer()
  const midAnalyzer = new AudioRhythmAnalyzer()
  const trebleAnalyzer = new AudioRhythmAnalyzer()

  bassAnalyzer.update(sineWave(80, 0.6), 2, SAMPLE_RATE, 80)
  midAnalyzer.update(sineWave(800, 0.6), 2, SAMPLE_RATE, 80)
  trebleAnalyzer.update(sineWave(6_000, 0.6), 2, SAMPLE_RATE, 80)

  expect(bassAnalyzer.bass).toBeGreaterThan(bassAnalyzer.mid)
  expect(midAnalyzer.mid).toBeGreaterThan(midAnalyzer.bass)
  expect(trebleAnalyzer.treble).toBeGreaterThan(trebleAnalyzer.mid)
})

test("spectrum resolves tones into distinct logarithmic bands", () => {
  const bassAnalyzer = new AudioRhythmAnalyzer()
  const trebleAnalyzer = new AudioRhythmAnalyzer()

  bassAnalyzer.update(sineWave(100, 0.7), 2, SAMPLE_RATE, 80)
  trebleAnalyzer.update(sineWave(6_000, 0.7), 2, SAMPLE_RATE, 80)
  const bassPeak = bassAnalyzer.spectrum.indexOf(Math.max(...bassAnalyzer.spectrum))
  const treblePeak = trebleAnalyzer.spectrum.indexOf(Math.max(...trebleAnalyzer.spectrum))

  expect(bassAnalyzer.spectrum).toHaveLength(AUDIO_SPECTRUM_BANDS)
  expect(bassPeak).toBeLessThan(5)
  expect(treblePeak).toBeGreaterThan(10)
})

test("stereo balance follows channel energy", () => {
  const leftAnalyzer = new AudioRhythmAnalyzer()
  const rightAnalyzer = new AudioRhythmAnalyzer()

  leftAnalyzer.update(stereoSineWave(400, 0.8, 0.05), 2, SAMPLE_RATE, 80)
  rightAnalyzer.update(stereoSineWave(400, 0.05, 0.8), 2, SAMPLE_RATE, 80)

  expect(leftAnalyzer.stereoBalance).toBeLessThan(-0.3)
  expect(rightAnalyzer.stereoBalance).toBeGreaterThan(0.3)
})

test("anti-phase stereo retains energy for spatial choreography", () => {
  const analyzer = new AudioRhythmAnalyzer()

  analyzer.update(stereoSineWave(100, 0.8, -0.8), 2, SAMPLE_RATE, 80)

  expect(analyzer.level).toBeGreaterThan(0.5)
  expect(analyzer.bass).toBeGreaterThan(0.2)
  expect(analyzer.stereoWidth).toBeGreaterThan(0.4)
  expect(Math.max(...analyzer.spectrum)).toBeGreaterThan(0.2)
})

test("pulse decays and reset clears analyzer state", () => {
  const analyzer = new AudioRhythmAnalyzer()
  const steadyBass = sineWave(80, 0.8)
  analyzer.update(steadyBass, 2, SAMPLE_RATE, 80)
  const initialPulse = analyzer.pulse

  analyzer.update(steadyBass, 2, SAMPLE_RATE, 230)
  expect(analyzer.pulse).toBeLessThan(initialPulse)

  analyzer.reset()
  expect(analyzer.level).toBe(0)
  expect(analyzer.pulse).toBe(0)
  expect(Math.max(...analyzer.spectrum)).toBe(0)
})
