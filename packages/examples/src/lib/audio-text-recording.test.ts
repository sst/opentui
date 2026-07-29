import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "bun:test"

import {
  activeWordIndexAtFrame,
  buildTranscriptTimeline,
  parsePcmWav,
  resolveAudioTextPairs,
  wordIndexAtFrame,
  type PcmWav,
} from "./audio-text-recording.js"

function monoPcm16Wav(samples: readonly number[], sampleRate = 8_000): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode("RIFF"), 0)
  view.setUint32(4, bytes.length - 8, true)
  bytes.set(new TextEncoder().encode("WAVEfmt "), 8)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  bytes.set(new TextEncoder().encode("data"), 36)
  view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true))
  return bytes
}

test("parses mono PCM16 WAV audio", () => {
  const audio = parsePcmWav(monoPcm16Wav([0, 16_384, -16_384, 32_767], 4))
  expect(audio.channels).toBe(1)
  expect(audio.sampleRate).toBe(4)
  expect(audio.frameCount).toBe(4)
  expect(audio.durationSeconds).toBe(1)
  expect(audio.samples[1]).toBeCloseTo(0.5)
  expect(audio.samples[2]).toBeCloseTo(-0.5)
})

test("builds speech-weighted words and removes emphasis markers", () => {
  const sampleRate = 1_000
  const samples = new Float32Array(sampleRate * 2)
  samples.fill(0.4, 250, 1_750)
  const audio: PcmWav = { channels: 1, sampleRate, samples, frameCount: samples.length, durationSeconds: 2 }
  const timeline = buildTranscriptTimeline("First [emphasis]second.\nThird", audio)

  expect(timeline.words.map((word) => word.text)).toEqual(["First", "second.", "Third"])
  expect(timeline.words[1]!.emphasis).toBe(true)
  expect(timeline.lineCount).toBe(2)
  expect(timeline.words[0]!.startFrame).toBeGreaterThan(150)
  expect(timeline.words[2]!.endFrame).toBeLessThan(1_850)
  expect(wordIndexAtFrame(timeline.words, timeline.words[1]!.startFrame)).toBe(1)
})

test("resets word timing at transcript-aligned speech pauses", () => {
  const sampleRate = 1_000
  const samples = new Float32Array(sampleRate * 10)
  samples.fill(0.4)
  samples.fill(0, 2_000, 3_000)
  const audio: PcmWav = { channels: 1, sampleRate, samples, frameCount: samples.length, durationSeconds: 10 }
  const timeline = buildTranscriptTimeline("One two. Three four five six seven.", audio)

  expect(timeline.words[1]!.endFrame).toBeLessThanOrEqual(2_000)
  expect(timeline.words[2]!.startFrame).toBeGreaterThanOrEqual(2_950)
  expect(timeline.words[2]!.startFrame).toBeLessThanOrEqual(3_000)
  expect(activeWordIndexAtFrame(timeline.words, 2_500)).toBe(-1)
})

test("discovers same-stem pairs from a directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "audio-text-pairs-"))
  await Promise.all([
    writeFile(join(directory, "second.wav"), new Uint8Array()),
    writeFile(join(directory, "second.txt"), "second"),
    writeFile(join(directory, "first.txt"), "first"),
    writeFile(join(directory, "first.wav"), new Uint8Array()),
    writeFile(join(directory, "ignored.mp3"), new Uint8Array()),
  ])

  const pairs = await resolveAudioTextPairs([directory])
  expect(pairs.map((pair) => pair.textPath)).toEqual([join(directory, "first.txt"), join(directory, "second.txt")])
})
