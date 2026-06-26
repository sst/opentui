import { expect, test } from "bun:test"

import { AudioAnalysisBuffer, audioDecayDeltaMs, audioTapReadFrames } from "./audio-analysis-buffer.js"
import { AUDIO_ANALYSIS_FRAMES } from "./audio-rhythm-analyzer.js"

const CHANNELS = 2

test("emits only complete analysis windows across uneven tap reads", () => {
  const buffer = new AudioAnalysisBuffer(AUDIO_ANALYSIS_FRAMES, CHANNELS)
  const pcm = Float32Array.from({ length: AUDIO_ANALYSIS_FRAMES * CHANNELS * 2 }, (_, index) => index)
  const windows: Float32Array[] = []
  const splits = [1300, 778, pcm.length - 2078]
  let offset = 0

  let windowsEmitted = 0
  for (const length of splits) {
    windowsEmitted += buffer.append(pcm.subarray(offset, offset + length), (window) => windows.push(window.slice()))
    offset += length
  }

  expect(windowsEmitted).toBe(2)
  expect(windows).toHaveLength(2)
  expect(windows[0]).toEqual(pcm.slice(0, AUDIO_ANALYSIS_FRAMES * CHANNELS))
  expect(windows[1]).toEqual(pcm.slice(AUDIO_ANALYSIS_FRAMES * CHANNELS))
  expect(buffer.framesBuffered).toBe(0)
})

test("reset discards a partial analysis window after an audio gap", () => {
  const buffer = new AudioAnalysisBuffer(AUDIO_ANALYSIS_FRAMES, CHANNELS)
  const partial = new Float32Array(600 * CHANNELS).fill(1)
  let emitted = 0

  expect(buffer.append(partial, () => (emitted += 1))).toBe(0)
  buffer.reset()
  expect(buffer.append(new Float32Array(AUDIO_ANALYSIS_FRAMES * CHANNELS).fill(2), () => (emitted += 1))).toBe(1)

  expect(emitted).toBe(1)
  expect(buffer.framesBuffered).toBe(0)
})

test("tap reads scale with delayed render frames without exceeding capacity", () => {
  expect(audioTapReadFrames(16, 48_000, 1024, 16_384)).toBe(2048)
  expect(audioTapReadFrames(100, 48_000, 1024, 16_384)).toBe(5824)
  expect(audioTapReadFrames(1000, 48_000, 1024, 16_384)).toBe(16_384)
})

test("decay begins with only the time beyond its grace period", () => {
  expect(audioDecayDeltaMs(40, 0, 40, 75)).toBe(0)
  expect(audioDecayDeltaMs(80, 0, 40, 75)).toBe(5)
  expect(audioDecayDeltaMs(120, 0, 40, 75)).toBe(40)
})
