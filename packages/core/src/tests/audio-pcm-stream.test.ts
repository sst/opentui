import { afterEach, expect, test } from "bun:test"
import { runInNewContext } from "node:vm"
import { getEventListeners } from "node:events"
import { Audio, AudioPcmStream, AudioStreamError, type AudioPcmStreamOptions } from "../index.js"
import { resolveRenderLib } from "../zig.js"

const audios: Audio[] = []
const options: AudioPcmStreamOptions = {
  sampleRate: 48000,
  channels: 2,
  buffer: { capacityMs: 10, startupMs: 2, resumeMs: 2 },
}

function createAudio(sampleRate = 48000): Audio {
  const audio = Audio.create({ autoStart: false, sampleRate })
  audios.push(audio)
  audio.on("error", () => {})
  expect(audio.startMixer()).toBe(true)
  return audio
}

async function drive(audio: Audio, operation: Promise<void>): Promise<Float32Array> {
  let done = false
  let failure: unknown
  void operation.then(
    () => {
      done = true
    },
    (error) => {
      done = true
      failure = error
    },
  )
  const output: number[] = []
  for (let i = 0; i < 2000 && !done; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (!done) output.push(...audio.mixFrames(128)!)
  }
  expect(done).toBe(true)
  if (failure) throw failure
  return new Float32Array(output)
}

afterEach(() => {
  for (const audio of audios.splice(0)) audio.dispose()
})

test("PCM writer is ready without input and copies offset views before write resolves", async () => {
  const audio = createAudio()
  const stream = audio.createPcmStream(options)
  expect(stream).toBeInstanceOf(AudioPcmStream)
  expect(stream.state).toBe("buffering")
  const owner = new Float32Array(964).fill(0.9)
  const frames = owner.subarray(2, 962)
  for (let i = 0; i < frames.length; i += 2) {
    frames[i] = 0.25
    frames[i + 1] = -0.5
  }
  await stream.write(frames)
  owner.fill(0)
  expect(audio.enableTap(256)).toBe(true)
  const output = audio.mixFrames(128)!
  expect(output[2]).toBeCloseTo(0.25)
  expect(output[3]).toBeCloseTo(-0.5)
  expect(audio.readTapFrames(128)!.frames).toEqual(output)
  expect(stream.getStats().framesWritten).toBe(480n)
  await drive(audio, stream.end())
  await stream.closed
  expect(stream.state).toBe("ended")
  expect(stream.getStats().framesPlayed).toBe(480n)
  expect(audio.getStats()!.voicesActive).toBe(0)
})

test("PCM writer backpressures without dropping frames and rejects concurrent writes", async () => {
  const audio = createAudio()
  const stream = audio.createPcmStream(options)
  let completed = false
  const write = stream.write(new Float32Array(2400).fill(0.125)).then(() => {
    completed = true
  })
  await expect(stream.write(new Float32Array(2))).rejects.toThrow("Await the previous")
  expect(completed).toBe(false)
  expect(stream.getStats().bufferedFrames).toBe(480)
  await drive(audio, write)
  await drive(audio, stream.end())
  expect(stream.getStats().framesWritten).toBe(1200n)
  expect(stream.getStats().framesPlayed).toBe(1200n)
})

test("PCM pause retains the queue; clear aborts pending input and resets conversion history", async () => {
  const audio = createAudio()
  const stream = audio.createPcmStream({ ...options, sampleRate: 44100, channels: 1 })
  stream.pause()
  const oldWrite = stream.write(new Float32Array(10000).fill(0.5))
  const rejected = oldWrite.catch((error: Error) => error)
  expect(stream.getStats().state).toBe("paused")
  expect(audio.mixFrames(128)!.every((sample) => sample === 0)).toBe(true)
  expect(stream.getStats().framesPlayed).toBe(0n)
  stream.clear()
  expect(stream.getStats().bufferedFrames).toBe(0)
  await stream.write(new Float32Array(100))
  expect(((await rejected) as Error).name).toBe("AbortError")
  stream.resume()
  const output = await drive(audio, stream.end())
  expect(output.every((sample) => sample === 0)).toBe(true)
})

test("PCM underruns emit silence and wait for the resume threshold", async () => {
  const audio = createAudio()
  const stream = audio.createPcmStream(options)
  await stream.write(new Float32Array(192).fill(0.25))
  expect(audio.mixFrames(128)!.some((sample) => sample !== 0)).toBe(true)
  expect(stream.getStats().underruns).toBe(1)
  await stream.write(new Float32Array(2).fill(0.5))
  expect(audio.mixFrames(128)!.every((sample) => sample === 0)).toBe(true)
  expect(stream.getStats().bufferedFrames).toBe(1)
  // EOF bypasses the threshold for a short final chunk.
  const output = await drive(audio, stream.end())
  expect(output.some((sample) => sample === 0.5)).toBe(true)
  expect(stream.getStats().underruns).toBe(1)
})

test("PCM uses stream, group, master volume and pan through the mixer", async () => {
  const audio = createAudio()
  const group = audio.group("pcm")!
  audio.setGroupVolume(group, 0.5)
  audio.setMasterVolume(0.5)
  const stream = audio.createPcmStream(options)
  stream.setGroup(group)
  stream.setVolume(0.5)
  stream.setPan(-1)
  // Clear must preserve all controls and routing.
  stream.clear()
  await stream.write(new Float32Array(960).fill(0.5))
  const output = audio.mixFrames(128)!
  expect(output[254]).toBeCloseTo(0.0625)
  expect(output[255]).toBe(0)
})

for (const [inputRate, outputRate] of [
  [8000, 48000],
  [44100, 48000],
  [48000, 44100],
  [96000, 48000],
  [192000, 8000],
]) {
  test(`PCM ${inputRate} to ${outputRate} resampling preserves tone, duration, mono and chunk continuity`, async () => {
    const input = Float32Array.from(
      { length: Math.floor(inputRate * 0.04) },
      (_, i) => Math.sin((2 * Math.PI * 500 * i) / inputRate) * 0.25,
    )
    async function render(chunkFrames: number): Promise<Float32Array> {
      const audio = createAudio(outputRate)
      const stream = audio.createPcmStream({
        sampleRate: inputRate,
        channels: 1,
        buffer: { capacityMs: 100, startupMs: 1, resumeMs: 1 },
      })
      for (let i = 0; i < input.length; i += chunkFrames) await stream.write(input.subarray(i, i + chunkFrames))
      const output = await drive(audio, stream.end())
      const stats = stream.getStats()
      expect(stats.framesWritten).toBe(BigInt(input.length))
      expect(stats.framesPlayed).toBe(stats.framesConverted)
      // Miniaudio includes its short resampler delay/tail in output frames.
      expect(Number(stats.framesPlayed)).toBeGreaterThanOrEqual(Math.floor(outputRate * 0.04))
      expect(Number(stats.framesPlayed)).toBeLessThan(Math.ceil(outputRate * 0.045))
      const audible = output.slice(0, Number(stats.framesPlayed) * 2)
      for (let i = 0; i < audible.length; i += 2) expect(audible[i]).toBeCloseTo(audible[i + 1], 6)
      let crossings = 0
      for (let i = 2; i < audible.length; i += 2) if (audible[i - 2] < 0 && audible[i] >= 0) crossings++
      expect(crossings).toBeGreaterThanOrEqual(19)
      expect(crossings).toBeLessThanOrEqual(21)
      return audible
    }
    const whole = await render(input.length)
    const fragmented = await render(7)
    expect(fragmented.length).toBe(whole.length)
    for (let i = 0; i < whole.length; i++) expect(fragmented[i]).toBeCloseTo(whole[i], 5)
  })
}

test("PCM graceful end waits for a write, is idempotent, and frees its voice", async () => {
  const audio = createAudio()
  const stream = audio.createPcmStream(options)
  const write = stream.write(new Float32Array(4000).fill(0.1))
  const end = stream.end()
  expect(stream.end()).toBe(end)
  await expect(stream.write(new Float32Array(2))).rejects.toThrow("input has ended")
  expect(() => stream.clear()).toThrow("input has ended")
  await drive(audio, end)
  await write
  await stream.closed
  expect(stream.getStats().framesPlayed).toBe(2000n)
  expect(audio.getStats()!.voicesActive).toBe(0)
  stream.dispose()
  expect(stream.state).toBe("ended")
})

test("PCM disposal and AbortSignal interrupt blocked writes and drains", async () => {
  for (const mode of ["stream", "owner", "signal"] as const) {
    const audio = createAudio()
    const controller = new AbortController()
    const stream = audio.createPcmStream({ ...options, signal: controller.signal })
    const write = stream.write(new Float32Array(10000))
    const end = stream.end()
    const results = Promise.allSettled([write, end])
    if (mode === "stream") stream.dispose()
    else if (mode === "owner") audio.dispose()
    else controller.abort()
    for (const result of await results) {
      expect(result.status).toBe("rejected")
      if (result.status === "rejected") expect(result.reason.name).toBe("AbortError")
    }
    await stream.closed
    expect(stream.state).toBe("disposed")
  }
})

test("PCM rejects malformed input, supports cross-realm arrays, and closes on native write failure", async () => {
  const audio = createAudio()
  for (const sampleRate of [0, NaN, 1.5, 7999, 192001]) {
    expect(() => audio.createPcmStream({ ...options, sampleRate })).toThrow()
  }
  expect(() => audio.createPcmStream({ ...options, channels: 3 as 2 })).toThrow()
  expect(() => audio.createPcmStream({ ...options, signal: AbortSignal.abort() })).toThrow()
  const stream = audio.createPcmStream(options)
  await expect(stream.write(new Float32Array(1))).rejects.toThrow("whole interleaved frames")
  await expect(stream.write(new Uint8Array(2) as unknown as Float32Array)).rejects.toThrow("Float32Array")
  await expect(stream.write(new Float32Array(new SharedArrayBuffer(8)))).rejects.toThrow("non-shared")
  await stream.write(runInNewContext("new Float32Array([0.25, 0.5])"))
  const errors: AudioStreamError[] = []
  stream.on("error", (error) => errors.push(error))
  const failure = await stream.write(new Float32Array([Infinity, 0])).catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(AudioStreamError)
  await stream.closed
  expect(stream.state).toBe("errored")
  expect(stream.error).toBe(errors[0])
  expect(stream.error!.context.action).toBe("write")
  expect(audio.getStats()!.voicesActive).toBe(0)
})

test("PCM empty EOF requires no mixer and native close failure retains owner for retry", async () => {
  const audio = createAudio()
  audio.stop()
  const empty = audio.createPcmStream(options)
  await empty.end()
  expect(empty.getStats().framesConverted).toBe(0n)
  const stream = audio.createPcmStream(options)
  const lib = resolveRenderLib()
  const original = lib.audioCloseStream
  lib.audioCloseStream = () => ({ status: -5, stats: null })
  try {
    expect(() => audio.dispose()).toThrow("destroy failed")
    expect(audio.getStats()).not.toBeNull()
  } finally {
    lib.audioCloseStream = original
  }
  audio.dispose()
  await stream.closed
  expect(stream.state).toBe("disposed")
})

test("PCM drain stays paused until resume and clear does not affect another stream", async () => {
  const audio = createAudio()
  const first = audio.createPcmStream(options)
  const second = audio.createPcmStream(options)
  await first.write(new Float32Array(960).fill(0.25))
  await second.write(new Float32Array(960).fill(0.125))
  first.clear()
  second.pause()
  let done = false
  const end = second.end().then(() => {
    done = true
  })
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(audio.mixFrames(128)!.every((sample) => sample === 0)).toBe(true)
  expect(done).toBe(false)
  expect(second.getStats().bufferedFrames).toBe(480)
  second.resume()
  const output = await drive(audio, end)
  expect(output.some((sample) => sample === 0.125)).toBe(true)
  expect(output.every((sample) => sample <= 0.125)).toBe(true)
  expect(first.getStats().framesPlayed).toBe(0n)
})

test("PCM streams share voice limits and release slots after disposal", async () => {
  const audio = createAudio()
  const streams = Array.from({ length: 32 }, () => audio.createPcmStream(options))
  expect(() => audio.createPcmStream(options)).toThrow("create failed")
  expect(audio.getStats()!.voicesActive).toBe(32)
  streams[0].dispose()
  const replacement = audio.createPcmStream(options)
  await replacement.end()
  expect(audio.getStats()!.voicesActive).toBe(31)
})

test("PCM stats failure closes playback and removes the original abort listener", async () => {
  const audio = createAudio()
  const controller = new AbortController()
  const mutableOptions = { ...options, signal: controller.signal }
  const stream = audio.createPcmStream(mutableOptions)
  expect(getEventListeners(controller.signal, "abort")).toHaveLength(1)
  mutableOptions.signal = new AbortController().signal
  const lib = resolveRenderLib()
  const original = lib.audioGetStreamStats
  lib.audioGetStreamStats = () => null
  try {
    expect(() => stream.getStats()).toThrow("stats unavailable")
  } finally {
    lib.audioGetStreamStats = original
  }
  await stream.closed
  expect(stream.state).toBe("errored")
  expect(stream.error!.context.action).toBe("stats")
  expect(audio.getStats()!.voicesActive).toBe(0)
  expect(getEventListeners(controller.signal, "abort")).toHaveLength(0)
  controller.abort()
  expect(stream.state).toBe("errored")
})
