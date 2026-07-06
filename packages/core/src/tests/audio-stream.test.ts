import { once } from "node:events"
import { readFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { afterEach, expect, test } from "bun:test"
import { Audio, type AudioStream, type AudioStreamErrorContext, type AudioStreamStats } from "../audio.js"

const SAMPLE_RATE = 48_000
const MP3_URL = new URL("./fixtures/audio/tone-750hz-48k-mono-1s.mp3", import.meta.url)
const MP3_HIGH_BITRATE_URL = new URL("./fixtures/audio/tone-750hz-48k-mono-1s-320k.mp3", import.meta.url)
const MP3_5S_URL = new URL("./fixtures/audio/tone-750hz-48k-mono-5s.mp3", import.meta.url)
const MP3_3000_URL = new URL("./fixtures/audio/tone-3000hz-48k-mono-1s.mp3", import.meta.url)
const audios: Audio[] = []
const servers: Server[] = []

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (address == null || typeof address === "string") throw new Error("Test server did not bind a TCP port")
  servers.push(server)
  return `http://127.0.0.1:${address.port}`
}

async function waitFor(
  predicate: () => boolean,
  message: string,
  advance?: () => void,
  timeoutMs: number = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    advance?.()
    if (predicate()) return
    await sleep(2)
  }
  throw new Error(message)
}

function tonePower(samples: Float32Array, frameCount: number, frequency: number): number {
  let real = 0
  let imaginary = 0
  for (let frame = 0; frame < frameCount; frame += 1) {
    const mono = ((samples[frame * 2] ?? 0) + (samples[frame * 2 + 1] ?? 0)) * 0.5
    const phase = (2 * Math.PI * frequency * frame) / SAMPLE_RATE
    real += mono * Math.cos(phase)
    imaginary -= mono * Math.sin(phase)
  }
  return real * real + imaginary * imaginary
}

function hasSignal(samples: Float32Array, threshold: number = 0.005): boolean {
  return samples.some((sample) => Math.abs(sample) > threshold)
}

function channelEnergy(samples: Float32Array, channel: 0 | 1): number {
  let energy = 0
  for (let index = channel; index < samples.length; index += 2) {
    const sample = samples[index] ?? 0
    energy += sample * sample
  }
  return energy
}

function repeatBytes(bytes: Uint8Array, count: number): Uint8Array {
  const repeated = new Uint8Array(bytes.length * count)
  for (let index = 0; index < count; index += 1) repeated.set(bytes, index * bytes.length)
  return repeated
}

async function waitForTapSignal(audio: Audio, stream: AudioStream): Promise<Float32Array> {
  let frames: Float32Array<ArrayBufferLike> = new Float32Array(0)
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    audio.mixFrames(256, 2)
    const tap = audio.readTapFrames(2048, 2)
    if (tap != null && tap.framesRead >= 2048 && tap.frames.some((sample) => Math.abs(sample) > 0.005)) {
      frames = tap.frames
      break
    }
    await sleep(2)
  }
  if (frames.length === 0) {
    const stats = stream.getStats()
    throw new Error(
      `Audio stream did not produce tapped PCM (state=${stats.state}, bytes=${stats.bytesReceived}, decoded=${stats.framesDecoded}, played=${stats.framesPlayed}, buffered=${stats.bufferedFrames})`,
    )
  }
  return frames
}

async function drainStream(audio: Audio, stream: AudioStream): Promise<void> {
  await waitFor(
    () => stream.state === "ended",
    "Audio stream did not reach its ended state",
    () => {
      audio.mixFrames(256, 2)
    },
  )
  await stream.closed
}

afterEach(async () => {
  for (const audio of audios.splice(0)) audio.dispose()
  for (const server of servers.splice(0)) {
    if (server.listening) {
      const closed = once(server, "close")
      server.close()
      server.closeAllConnections?.()
      await closed
    }
  }
})

test("Audio streams an MP3 before the HTTP response ends and exposes it through the tap", async () => {
  const mp3 = repeatBytes(new Uint8Array(await readFile(MP3_URL)), 8)
  const releaseTail = deferred()
  let responseEnded = false
  const split = Math.floor(mp3.length * 0.75)
  const server = createServer((_, response) => {
    response.writeHead(200, { "Content-Type": "audio/mpeg", Connection: "close" })
    response.write(mp3.subarray(0, split))
    void releaseTail.promise.then(() => {
      responseEnded = true
      response.end(mp3.subarray(split))
    })
  })
  const baseUrl = await listen(server)

  const audio = Audio.create({ autoStart: false })
  audios.push(audio)
  expect(audio.startMixer()).toBe(true)
  expect(audio.enableTap(4096)).toBe(true)

  const stream = await audio.playStream(new URL("/radio", baseUrl))
  expect(["buffering", "playing"]).toContain(stream.getStats().state)
  const pcm = await waitForTapSignal(audio, stream)

  expect(responseEnded).toBe(false)
  const playingStats = stream.getStats()
  expect(playingStats.state).toBe("playing")
  expect(playingStats.sampleRate).toBe(SAMPLE_RATE)
  expect(playingStats.channels).toBe(2)
  expect(playingStats.capacityFrames).toBe(SAMPLE_RATE * 2)
  expect(playingStats.bufferedFrames).toBeLessThanOrEqual(playingStats.capacityFrames)
  expect(playingStats.bufferedDurationMs).toBe((playingStats.bufferedFrames * 1000) / playingStats.sampleRate)
  expect(playingStats.framesPlayed).toBeGreaterThan(0n)
  expect(tonePower(pcm, 2048, 750)).toBeGreaterThan(tonePower(pcm, 2048, 3000) * 10)

  releaseTail.resolve()
  await waitFor(() => responseEnded, "Test server did not finish the MP3 response")
  stream.dispose()
  await stream.closed
})

test("Audio accepts an async iterable and drains it to completion", async () => {
  const mp3 = new Uint8Array(await readFile(MP3_URL))
  async function* chunks(): AsyncGenerator<Uint8Array> {
    yield new Uint8Array(0)
    for (let offset = 0; offset < mp3.length; offset += 97) {
      yield mp3.subarray(offset, Math.min(mp3.length, offset + 97))
    }
  }

  const audio = Audio.create({ autoStart: false })
  audios.push(audio)
  expect(audio.startMixer()).toBe(true)

  const group = audio.group("radio")
  expect(group).not.toBeNull()
  const stream = await audio.playStream(chunks(), {
    groupId: group ?? 0,
    buffer: { capacityMs: 250, startupMs: 25, resumeMs: 25 },
  })
  let endedEvents = 0
  stream.on("ended", () => {
    endedEvents += 1
  })

  expect(stream.setVolume(0.6)).toBe(true)
  expect(stream.setPan(-0.25)).toBe(true)
  expect(stream.setGroup(group ?? 0)).toBe(true)
  stream.on("error", () => {})
  expect(stream.setGroup(0xffffffff)).toBe(false)
  expect(stream.state).not.toBe("errored")
  await drainStream(audio, stream)
  await waitFor(() => endedEvents === 1, "Audio stream did not emit ended")
  await sleep(0)
  expect(endedEvents).toBe(1)

  const stats = stream.getStats()
  expect(stats.state).toBe("ended")
  expect(stats.sampleRate).toBe(SAMPLE_RATE)
  expect(stats.channels).toBe(2)
  expect(stats.capacityFrames).toBe(SAMPLE_RATE / 4)
  expect(stats.bufferedFrames).toBe(0)
  expect(stats.bufferedDurationMs).toBe(0)
  expect(stats.bytesReceived).toBe(BigInt(mp3.length))
  expect(stats.framesDecoded).toBeGreaterThan(0n)
  expect(stats.framesPlayed).toBeGreaterThan(0n)
  expect(stats.reconnectAttempts).toBe(0)
  expect(audio.getStats()?.voicesActive).toBe(0)
})

test("Audio accepts fragmented ReadableStream input and counts only supplied MP3 bytes", async () => {
  const mp3 = new Uint8Array(await readFile(MP3_URL))
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(0))
      controller.enqueue(mp3.subarray(0, 1))
      for (let offset = 1; offset < mp3.length; offset += 97) {
        controller.enqueue(mp3.subarray(offset, Math.min(mp3.length, offset + 97)))
      }
      controller.close()
    },
  })
  const audio = Audio.create({ autoStart: false })
  audios.push(audio)
  expect(audio.startMixer()).toBe(true)

  const stream = await audio.playStream(source, {
    buffer: { capacityMs: 250, startupMs: 25, resumeMs: 25 },
  })
  await drainStream(audio, stream)

  const stats = stream.getStats()
  expect(stats.bytesReceived).toBe(BigInt(mp3.length))
  expect(stats.framesDecoded).toBeGreaterThan(0n)
  expect(stats.framesPlayed).toBeGreaterThan(0n)
  expect(stats.reconnectAttempts).toBe(0)
  expect(audio.getStats()?.voicesActive).toBe(0)
})

test("Audio keeps playing decoded buffered frames while reconnecting an interrupted response", async () => {
  const fixture = new Uint8Array(await readFile(MP3_URL))
  const replacementFixture = new Uint8Array(await readFile(MP3_3000_URL))
  const mp3 = repeatBytes(fixture, 8)
  const replacementMp3 = repeatBytes(replacementFixture, 8)
  const interruptResponse = deferred()
  const keepSecondResponseOpen = deferred()
  let requests = 0
  const requestHeaders: Array<string | string[] | undefined> = []
  const server = createServer((request, response) => {
    requests += 1
    requestHeaders.push(request.headers["x-audio-test"])
    response.writeHead(200, { "Content-Type": "audio/mpeg", Connection: "close" })
    if (requests > 1) {
      response.write(replacementMp3)
      void keepSecondResponseOpen.promise.then(() => response.end())
      return
    }
    response.write(mp3)
    void interruptResponse.promise.then(() => response.destroy())
  })
  const baseUrl = await listen(server)

  const audio = Audio.create({ autoStart: false })
  audios.push(audio)
  expect(audio.startMixer()).toBe(true)

  const stream = await audio.playStream(`${baseUrl}/radio`, {
    buffer: { capacityMs: 2000, startupMs: 200, resumeMs: 200 },
    reconnect: { maxAttempts: 1, initialDelayMs: 100, maxDelayMs: 100 },
    request: { headers: { "x-audio-test": "reconnect" } },
  })
  stream.on("error", () => {})

  try {
    await waitFor(
      () => stream.getStats().bufferedDurationMs >= 1000,
      "Audio stream did not buffer enough decoded PCM before interruption",
    )

    let heardBeforeInterruption = false
    await waitFor(
      () => heardBeforeInterruption,
      "Audio stream did not produce audible PCM before interruption",
      () => {
        const mixed = audio.mixFrames(256, 2)
        heardBeforeInterruption = mixed?.some((sample) => Math.abs(sample) > 0.005) ?? false
      },
    )
    await waitFor(
      () => stream.getStats().bufferedDurationMs >= 1000,
      "Audio stream did not retain enough decoded PCM before interruption",
    )

    const silentSound = audio.loadSound(fixture)
    expect(silentSound).not.toBeNull()
    if (silentSound == null) return
    for (let voice = 0; voice < 31; voice += 1) {
      expect(audio.play(silentSound, { loop: true, volume: 0 })).not.toBeNull()
    }
    expect(audio.getStats()?.voicesActive).toBe(32)

    const reconnectEvent: { value?: { attempt: number; delayMs: number; maxAttempts: number } } = {}
    let reconnectGroupResult: boolean | undefined
    stream.on("reconnecting", ({ attempt, delayMs, maxAttempts }) => {
      reconnectEvent.value = { attempt, delayMs, maxAttempts }
      reconnectGroupResult = stream.setGroup(0xffffffff)
    })
    interruptResponse.resolve()
    await waitFor(
      () => reconnectEvent.value != null,
      "Audio stream did not enter reconnecting state after interruption",
    )
    expect(reconnectEvent.value).toEqual({ attempt: 1, delayMs: 100, maxAttempts: 1 })
    expect(reconnectGroupResult).toBe(false)

    const reconnectStats = stream.getStats()
    let heardBufferedAudio = false
    for (let block = 0; block < 20; block += 1) {
      const mixed = audio.mixFrames(256, 2)
      if (mixed?.some((sample) => Math.abs(sample) > 0.005)) heardBufferedAudio = true
      await sleep(1)
    }

    expect(heardBufferedAudio).toBe(true)
    expect(stream.getStats().framesPlayed).toBeGreaterThan(reconnectStats.framesPlayed)
    expect(stream.setVolume(1)).toBe(true)
    expect(stream.setPan(-1)).toBe(true)

    await waitFor(
      () => {
        const stats = stream.getStats()
        return (
          requests === 2 &&
          stats.bytesReceived > reconnectStats.bytesReceived &&
          stats.framesDecoded > reconnectStats.framesDecoded
        )
      },
      "Audio stream did not resume decoding after reconnecting",
      () => {
        audio.mixFrames(256, 2)
      },
    )
    expect(audio.getStats()?.voicesActive).toBe(32)
    expect(stream.getStats().reconnectAttempts).toBe(1)

    let replacementOutput: Float32Array | null = null
    await waitFor(
      () =>
        replacementOutput != null &&
        hasSignal(replacementOutput) &&
        tonePower(replacementOutput, 2048, 3000) > tonePower(replacementOutput, 2048, 750) * 10,
      "Audio stream did not play replacement response PCM",
      () => {
        replacementOutput = audio.mixFrames(2048, 2)
      },
    )
    if (replacementOutput == null) return
    expect(channelEnergy(replacementOutput, 0)).toBeGreaterThan(channelEnergy(replacementOutput, 1) * 4)

    expect(stream.setVolume(0)).toBe(true)
    const framesBeforeMute = stream.getStats().framesPlayed
    let mutedReplacement: Float32Array | null = null
    await waitFor(
      () => mutedReplacement != null && !hasSignal(mutedReplacement),
      "Audio stream replacement did not apply the reconnect-time volume control",
      () => {
        mutedReplacement = audio.mixFrames(2048, 2)
      },
    )
    expect(stream.getStats().framesPlayed).toBeGreaterThan(framesBeforeMute)
    expect(requestHeaders).toEqual(["reconnect", "reconnect"])
  } finally {
    keepSecondResponseOpen.resolve()
    stream.dispose()
    await stream.closed
  }
})

test("Audio disposes a buffered stream while reconnecting", async () => {
  const mp3 = repeatBytes(new Uint8Array(await readFile(MP3_URL)), 8)
  const interruptResponse = deferred()
  let requests = 0
  const server = createServer((_, response) => {
    requests += 1
    response.writeHead(200, { "Content-Type": "audio/mpeg", Connection: "close" })
    response.write(mp3)
    void interruptResponse.promise.then(() => response.destroy())
  })
  const baseUrl = await listen(server)

  const audio = Audio.create({ autoStart: false })
  audios.push(audio)
  expect(audio.startMixer()).toBe(true)
  const abortController = new AbortController()

  const stream = await audio.playStream(`${baseUrl}/radio`, {
    signal: abortController.signal,
    buffer: { capacityMs: 1000, startupMs: 100, resumeMs: 100 },
    reconnect: { maxAttempts: 1, initialDelayMs: 1000, maxDelayMs: 1000 },
  })
  stream.on("error", () => {})
  await waitFor(
    () => stream.getStats().bufferedDurationMs >= 500,
    "Audio stream did not buffer enough decoded PCM before interruption",
  )

  let observedReconnect = false
  stream.on("reconnecting", () => {
    observedReconnect = true
    abortController.abort()
  })
  interruptResponse.resolve()
  await stream.closed

  expect(observedReconnect).toBe(true)
  expect(stream.state).toBe("disposed")
  expect(audio.getStats()?.voicesActive).toBe(0)
  expect(requests).toBe(1)
})

test("Audio drains clean EOF before reconnecting", async () => {
  const fixture = new Uint8Array(await readFile(MP3_URL))
  const mp3 = repeatBytes(fixture, 6)
  const finishFirstResponse = deferred()
  const keepSecondResponseOpen = deferred()
  let requests = 0
  const server = createServer((_, response) => {
    requests += 1
    response.writeHead(200, { "Content-Type": "audio/mpeg", Connection: "close" })
    if (requests === 1) {
      response.write(mp3)
      void finishFirstResponse.promise.then(() => response.end())
      return
    }
    response.write(mp3)
    void keepSecondResponseOpen.promise.then(() => response.end())
  })
  const baseUrl = await listen(server)

  const audio = Audio.create({ autoStart: false })
  audios.push(audio)
  expect(audio.startMixer()).toBe(true)

  const stream = await audio.playStream(`${baseUrl}/radio`, {
    buffer: { capacityMs: 250, startupMs: 25, resumeMs: 25 },
    reconnect: { initialDelayMs: 0, maxDelayMs: 0, retryOnEnd: true },
  })
  stream.on("error", () => {})
  await waitFor(() => stream.getStats().bufferedFrames > 0, "Audio stream did not buffer its first response")

  const silentSound = audio.loadSound(fixture)
  expect(silentSound).not.toBeNull()
  if (silentSound == null) return
  for (let voice = 0; voice < 31; voice += 1) {
    expect(audio.play(silentSound, { loop: true, volume: 0 })).not.toBeNull()
  }
  expect(audio.getStats()?.voicesActive).toBe(32)
  expect(stream.setVolume(0.6)).toBe(true)
  expect(stream.setPan(0.2)).toBe(true)

  const reconnectStats: { value?: AudioStreamStats } = {}
  stream.on("reconnecting", () => {
    reconnectStats.value = stream.getStats()
  })
  finishFirstResponse.resolve()
  await waitFor(
    () => requests === 2 && reconnectStats.value != null,
    "Audio stream did not reconnect after draining clean EOF",
    () => audio.mixFrames(256, 2),
  )
  const statsAtReconnect = reconnectStats.value
  if (statsAtReconnect == null) throw new Error("Audio stream reconnect stats were unavailable")
  await waitFor(
    () => {
      const stats = stream.getStats()
      return (
        stats.bytesReceived > statsAtReconnect.bytesReceived && stats.framesDecoded > statsAtReconnect.framesDecoded
      )
    },
    "Audio stream did not resume decoding after clean EOF",
    () => audio.mixFrames(256, 2),
  )

  expect(stream.getStats().framesPlayed).toBeGreaterThan(statsAtReconnect.framesPlayed)
  expect(stream.getStats().reconnectAttempts).toBe(1)
  expect(audio.getStats()?.voicesActive).toBe(32)
  stream.dispose()
  keepSecondResponseOpen.resolve()
  await stream.closed
})

test("A short clean MP3 can finish setup before retryOnEnd reconnects", async () => {
  const mp3 = new Uint8Array(await readFile(MP3_URL))
  const keepSecondResponseOpen = deferred()
  let requests = 0
  const server = createServer((_, response) => {
    requests += 1
    response.writeHead(200, { "Content-Type": "audio/mpeg", Connection: "close" })
    if (requests === 1) {
      response.end(mp3.subarray(0, 1000))
      return
    }
    response.write(repeatBytes(mp3, 6))
    void keepSecondResponseOpen.promise.then(() => response.end())
  })
  const baseUrl = await listen(server)
  const audio = Audio.create({ autoStart: false })
  audios.push(audio)
  expect(audio.startMixer()).toBe(true)

  const stream = await audio.playStream(`${baseUrl}/radio`, {
    buffer: { capacityMs: 250, startupMs: 25, resumeMs: 25 },
    reconnect: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0, retryOnEnd: true },
  })
  stream.on("error", () => {})
  await waitFor(
    () => requests === 2 && stream.state !== "reconnecting",
    "Short MP3 response did not complete setup and reconnect",
    () => audio.mixFrames(256, 2),
  )

  expect(stream.state).not.toBe("errored")
  expect(stream.getStats().reconnectAttempts).toBe(1)
  stream.dispose()
  keepSecondResponseOpen.resolve()
  await stream.closed
})

test("Audio rejects unsupported stream buffer capacity before consuming the source", async () => {
  const audio = Audio.create({ autoStart: false, sampleRate: 1000 })
  audios.push(audio)

  let sourceConsumed = false
  async function* source(): AsyncGenerator<Uint8Array> {
    sourceConsumed = true
  }

  let rejection: unknown
  try {
    await audio.playStream(source(), {
      buffer: {
        capacityMs: 268_435_453,
        startupMs: 1,
        resumeMs: 1,
      },
    })
  } catch (error) {
    rejection = error
  }

  expect((rejection as { context?: AudioStreamErrorContext })?.context).toEqual({ action: "create", status: -1 })
  expect(sourceConsumed).toBe(false)
  expect(audio.getStats()?.voicesActive).toBe(0)
})

test("Audio validates the stream group before consuming the source", async () => {
  const audio = Audio.create({ autoStart: false })
  audios.push(audio)

  let sourceConsumed = false
  async function* source(): AsyncGenerator<Uint8Array> {
    sourceConsumed = true
  }

  let rejection: unknown
  try {
    await audio.playStream(source(), {
      groupId: 0xffffffff,
      buffer: { capacityMs: 250, startupMs: 25, resumeMs: 25 },
    })
  } catch (error) {
    rejection = error
  }

  expect((rejection as { context?: AudioStreamErrorContext })?.context).toEqual({ action: "create", status: -1 })
  expect(sourceConsumed).toBe(false)
  expect(audio.getStats()?.voicesActive).toBe(0)
})

test("Audio streams share the existing 32 active voice slots", async () => {
  const mp3 = new Uint8Array(await readFile(MP3_URL))
  const audio = Audio.create({ autoStart: false })
  audios.push(audio)
  const sound = audio.loadSound(mp3)
  expect(sound).not.toBeNull()
  if (sound == null) return

  for (let index = 0; index < 32; index += 1) {
    expect(audio.play(sound, { loop: true })).not.toBeNull()
  }
  expect(audio.getStats()?.voicesActive).toBe(32)

  let sourceConsumed = false
  async function* source(): AsyncGenerator<Uint8Array> {
    sourceConsumed = true
  }

  let rejection: unknown
  try {
    await audio.playStream(source(), {
      buffer: { capacityMs: 250, startupMs: 25, resumeMs: 25 },
    })
  } catch (error) {
    rejection = error
  }

  expect((rejection as { context?: AudioStreamErrorContext })?.context).toEqual({ action: "create", status: -2 })
  expect(sourceConsumed).toBe(false)
  expect(audio.getStats()?.voicesActive).toBe(32)

  expect(audio.unloadSound(sound)).toBe(true)
  expect(audio.getStats()?.voicesActive).toBe(0)
  expect(audio.startMixer()).toBe(true)
  async function* recoveredSource(): AsyncGenerator<Uint8Array> {
    yield mp3
  }
  const recoveredStream = await audio.playStream(recoveredSource(), {
    buffer: { capacityMs: 250, startupMs: 25, resumeMs: 25 },
  })
  await drainStream(audio, recoveredStream)
  expect(recoveredStream.getStats().framesPlayed).toBeGreaterThan(0n)
  expect(audio.getStats()?.voicesActive).toBe(0)
})

test("Audio rejects an invalid MP3 during decoder setup", async () => {
  async function* invalidMp3(): AsyncGenerator<Uint8Array> {
    yield new TextEncoder().encode("not an mp3 stream")
  }
  const audio = Audio.create({ autoStart: false })
  audios.push(audio)
  expect(audio.startMixer()).toBe(true)

  await expect(audio.playStream(invalidMp3())).rejects.toThrow()
  expect(audio.getStats()?.voicesActive).toBe(0)
})

test("Audio reports a byte-source failure after stream setup", async () => {
  const mp3 = repeatBytes(new Uint8Array(await readFile(MP3_URL)), 6)
  const failSource = deferred()
  let sourceReturned = false
  let pulls = 0
  const source: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          pulls += 1
          if (pulls === 1) return { done: false as const, value: mp3 }
          await failSource.promise
          throw new Error("test source failure")
        },
        async return() {
          sourceReturned = true
          return { done: true as const, value: undefined }
        },
      }
    },
  }
  const audio = Audio.create({ autoStart: false })
  audios.push(audio)
  expect(audio.startMixer()).toBe(true)

  const stream = await audio.playStream(source, {
    buffer: { capacityMs: 250, startupMs: 25, resumeMs: 25 },
  })
  const streamErrors: Error[] = []
  stream.on("error", (error) => {
    streamErrors.push(error)
  })
  failSource.resolve()
  await stream.closed
  await waitFor(() => streamErrors.length === 1, "Audio stream did not emit its source failure")

  expect(stream.state).toBe("errored")
  expect(streamErrors[0]?.message).toContain("source failed")
  expect(sourceReturned).toBe(true)
  expect(audio.getStats()?.voicesActive).toBe(0)
})

test("Source failure cleanup cannot overwrite reentrant Audio disposal", async () => {
  const mp3 = repeatBytes(new Uint8Array(await readFile(MP3_URL)), 6)
  const failSource = deferred()
  const audio = Audio.create({ autoStart: false })
  audios.push(audio)
  expect(audio.startMixer()).toBe(true)

  let pulls = 0
  const source: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          pulls += 1
          if (pulls === 1) return { done: false as const, value: mp3 }
          await failSource.promise
          throw new Error("test source failure")
        },
        async return() {
          audio.dispose()
          return { done: true as const, value: undefined }
        },
      }
    },
  }

  const stream = await audio.playStream(source, {
    buffer: { capacityMs: 250, startupMs: 25, resumeMs: 25 },
  })
  stream.on("error", () => {})
  failSource.resolve()
  await stream.closed

  expect(stream.state).toBe("disposed")
})

test("Audio stream setup remains abortable while a source emits empty chunks", async () => {
  const audio = Audio.create({ autoStart: false })
  audios.push(audio)

  const abortController = new AbortController()
  const maximumPullsBeforeAbort = 100_000
  let pulls = 0
  async function* source(): AsyncGenerator<Uint8Array> {
    while (pulls < maximumPullsBeforeAbort) {
      pulls += 1
      yield new Uint8Array(0)
    }
    await new Promise<void>(() => {})
  }

  const setup = audio.playStream(source(), { signal: abortController.signal })
  setTimeout(() => abortController.abort(), 0)

  let rejection: unknown
  try {
    await setup
  } catch (error) {
    rejection = error
  }

  expect((rejection as Error)?.name).toBe("AbortError")
  expect(pulls).toBeLessThan(maximumPullsBeforeAbort)
})

test("Disposing an audio stream cancels its byte source and releases its voice", async () => {
  const mp3 = new Uint8Array(await readFile(MP3_URL))
  let cancelled = false
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(mp3.subarray(0, Math.floor(mp3.length * 0.75)))
    },
    cancel() {
      cancelled = true
    },
  })
  const audio = Audio.create({ autoStart: false })
  audios.push(audio)
  expect(audio.startMixer()).toBe(true)

  const stream = await audio.playStream(source, {
    buffer: { capacityMs: 500, startupMs: 50, resumeMs: 50 },
  })
  let observedDisposed = false
  stream.on("disposed", () => {
    observedDisposed = true
  })
  stream.dispose()
  await stream.closed
  await waitFor(() => observedDisposed, "Audio stream did not emit disposed")

  expect(cancelled).toBe(true)
  expect(stream.state).toBe("disposed")
  expect(audio.getStats()?.voicesActive).toBe(0)
})

test("Stream teardown tolerates source cancellation disposing the owning Audio", async () => {
  const mp3 = repeatBytes(new Uint8Array(await readFile(MP3_URL)), 6)
  const audio = Audio.create({ autoStart: false })
  audios.push(audio)
  expect(audio.startMixer()).toBe(true)

  let activeVoicesAtCancel: number | undefined
  let audioDisposed = false
  audio.on("disposed", () => {
    audioDisposed = true
  })
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(mp3)
    },
    cancel() {
      activeVoicesAtCancel = audio.getStats()?.voicesActive
      audio.dispose()
    },
  })

  const stream = await audio.playStream(source, {
    buffer: { capacityMs: 250, startupMs: 25, resumeMs: 25 },
  })
  stream.dispose()
  await stream.closed

  expect(activeVoicesAtCancel).toBe(1)
  expect(audioDisposed).toBe(true)
  expect(stream.state).toBe("disposed")
  expect(stream.getStats().bufferedFrames).toBe(0)
})

test("Disposal settles even when a byte source does not finish cancelling", async () => {
  const mp3 = repeatBytes(new Uint8Array(await readFile(MP3_URL)), 6)
  const never = new Promise<void>(() => {})
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(mp3)
    },
    cancel() {
      return never
    },
  })
  const audio = Audio.create({ autoStart: false })
  audios.push(audio)
  expect(audio.startMixer()).toBe(true)

  const stream = await audio.playStream(source, {
    buffer: { capacityMs: 250, startupMs: 25, resumeMs: 25 },
  })
  stream.dispose()
  await Promise.race([
    stream.closed,
    sleep(1000).then(() => {
      throw new Error("Audio stream disposal waited indefinitely for source cancellation")
    }),
  ])

  expect(stream.state).toBe("disposed")
  expect(stream.getStats().bufferedFrames).toBe(0)
})

test("Audio honors startup and resume thresholds and counts underruns once per starvation", async () => {
  const fixture = new Uint8Array(await readFile(MP3_URL))
  const startupFixture = new Uint8Array(await readFile(MP3_HIGH_BITRATE_URL))
  const longFixture = new Uint8Array(await readFile(MP3_5S_URL))
  let sourceController!: ReadableStreamDefaultController<Uint8Array>
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      sourceController = controller
      controller.enqueue(startupFixture)
    },
  })
  const audio = Audio.create({ autoStart: false })
  audios.push(audio)
  expect(audio.startMixer()).toBe(true)

  const stream = await audio.playStream(source, {
    buffer: { capacityMs: 3000, startupMs: 1200, resumeMs: 500 },
  })
  await waitFor(
    () => stream.getStats().bufferedDurationMs >= 500,
    "Audio stream did not decode the initial buffering payload",
  )

  const beforeStartup = stream.getStats()
  for (let block = 0; block < 8; block += 1) {
    const mixed = audio.mixFrames(2048, 2)
    expect(mixed).not.toBeNull()
    expect(hasSignal(mixed ?? new Float32Array())).toBe(false)
  }
  expect(stream.getStats().state).toBe("buffering")
  expect(stream.getStats().framesPlayed).toBe(beforeStartup.framesPlayed)
  expect(stream.getStats().underruns).toBe(0)

  sourceController.enqueue(longFixture)
  let heardStartup = false
  await waitFor(
    () => stream.getStats().state === "playing" && heardStartup,
    "Audio stream did not begin after crossing the startup threshold",
    () => {
      const mixed = audio.mixFrames(2048, 2)
      heardStartup = heardStartup || (mixed != null && hasSignal(mixed))
    },
  )

  await waitFor(
    () => stream.getStats().state === "buffering" && stream.getStats().underruns === 1,
    "Audio stream did not report its first underrun",
    () => {
      audio.mixFrames(2048, 2)
    },
    4000,
  )
  const firstUnderrunFrames = stream.getStats().framesPlayed
  for (let block = 0; block < 8; block += 1) {
    const mixed = audio.mixFrames(2048, 2)
    expect(mixed).not.toBeNull()
    expect(hasSignal(mixed ?? new Float32Array())).toBe(false)
  }
  expect(stream.getStats().framesPlayed).toBe(firstUnderrunFrames)
  expect(stream.getStats().underruns).toBe(1)

  sourceController.enqueue(fixture)
  let heardResume = false
  await waitFor(
    () => stream.getStats().state === "playing" && heardResume,
    "Audio stream did not resume at the smaller resume threshold",
    () => {
      const mixed = audio.mixFrames(2048, 2)
      heardResume = heardResume || (mixed != null && hasSignal(mixed))
    },
  )
  await waitFor(
    () => stream.getStats().state === "buffering" && stream.getStats().underruns === 2,
    "Audio stream did not report a second starvation cycle",
    () => {
      audio.mixFrames(2048, 2)
    },
    4000,
  )

  sourceController.close()
  await drainStream(audio, stream)
})

test("Audio applies source backpressure until the mixer consumes buffered audio", async () => {
  const longFixture = new Uint8Array(await readFile(MP3_5S_URL))
  const largeChunk = repeatBytes(longFixture, 24)
  let pulls = 0
  let returned = false
  const source: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          pulls += 1
          if (pulls === 1) return { done: false as const, value: largeChunk }
          return { done: true as const, value: undefined }
        },
        async return() {
          returned = true
          return { done: true as const, value: undefined }
        },
      }
    },
  }
  const audio = Audio.create({ autoStart: false })
  audios.push(audio)

  const stream = await audio.playStream(source, {
    buffer: { capacityMs: 250, startupMs: 25, resumeMs: 25 },
  })
  await waitFor(
    () => stream.getStats().bufferedFrames === stream.getStats().capacityFrames,
    "Audio stream did not fill its bounded decoded buffer",
  )
  let previousBytes = -1n
  let stablePolls = 0
  await waitFor(() => {
    if (pulls !== 1) return false
    const bytes = stream.getStats().bytesReceived
    stablePolls = bytes === previousBytes ? stablePolls + 1 : 0
    previousBytes = bytes
    return stablePolls >= 5
  }, "Audio stream byte acceptance did not stop under backpressure")
  const stalledStats = stream.getStats()
  expect(pulls).toBe(1)
  expect(stream.getStats().bufferedFrames).toBeLessThanOrEqual(stream.getStats().capacityFrames)
  expect(stalledStats.bytesReceived).toBeLessThan(BigInt(largeChunk.length))

  expect(audio.startMixer()).toBe(true)
  await waitFor(
    () => stream.getStats().bytesReceived > stalledStats.bytesReceived,
    "Audio stream did not resume byte acceptance after mixer progress",
    () => {
      audio.mixFrames(2048, 2)
    },
  )
  expect(pulls).toBe(1)
  stream.dispose()
  await stream.closed
  expect(returned).toBe(true)
})

test("Audio stream volume, pan, and group controls affect real mixed PCM", async () => {
  const longFixture = new Uint8Array(await readFile(MP3_5S_URL))
  const finishSource = deferred()
  async function* source(): AsyncGenerator<Uint8Array> {
    yield longFixture
    await finishSource.promise
  }
  const audio = Audio.create({ autoStart: false })
  audios.push(audio)
  expect(audio.startMixer()).toBe(true)
  const mutedGroup = audio.group("muted-stream")
  expect(mutedGroup).not.toBeNull()
  if (mutedGroup == null) return
  expect(audio.setGroupVolume(mutedGroup, 0)).toBe(true)

  const stream = await audio.playStream(source(), {
    volume: 0,
    buffer: { capacityMs: 2000, startupMs: 25, resumeMs: 25 },
  })
  stream.on("error", () => {})
  await waitFor(() => stream.getStats().bufferedDurationMs >= 500, "Audio stream did not buffer control audio")

  const mutedFramesBefore = stream.getStats().framesPlayed
  const mutedOutput = audio.mixFrames(2048, 2)
  expect(mutedOutput).not.toBeNull()
  expect(hasSignal(mutedOutput ?? new Float32Array())).toBe(false)
  expect(stream.getStats().framesPlayed).toBeGreaterThan(mutedFramesBefore)

  expect(stream.setVolume(1)).toBe(true)
  let audibleOutput: Float32Array | null = null
  await waitFor(
    () => audibleOutput != null && hasSignal(audibleOutput),
    "Audio stream did not become audible after raising volume",
    () => {
      audibleOutput = audio.mixFrames(2048, 2)
    },
  )

  expect(stream.setPan(-1)).toBe(true)
  const leftOutput = audio.mixFrames(2048, 2)
  expect(leftOutput).not.toBeNull()
  if (leftOutput == null) return
  expect(channelEnergy(leftOutput, 0)).toBeGreaterThan(channelEnergy(leftOutput, 1) * 4)

  expect(stream.setPan(1)).toBe(true)
  const rightOutput = audio.mixFrames(2048, 2)
  expect(rightOutput).not.toBeNull()
  if (rightOutput == null) return
  expect(channelEnergy(rightOutput, 1)).toBeGreaterThan(channelEnergy(rightOutput, 0) * 4)

  expect(stream.setPan(0)).toBe(true)
  expect(stream.setGroup(mutedGroup)).toBe(true)
  const groupFramesBefore = stream.getStats().framesPlayed
  const groupMutedOutput = audio.mixFrames(2048, 2)
  expect(groupMutedOutput).not.toBeNull()
  expect(hasSignal(groupMutedOutput ?? new Float32Array())).toBe(false)
  expect(stream.getStats().framesPlayed).toBeGreaterThan(groupFramesBefore)

  expect(stream.setGroup(0)).toBe(true)
  const groupAudibleOutput = audio.mixFrames(2048, 2)
  expect(groupAudibleOutput).not.toBeNull()
  expect(hasSignal(groupAudibleOutput ?? new Float32Array())).toBe(true)
  expect(stream.setGroup(0xffffffff)).toBe(false)
  expect(stream.state).not.toBe("errored")

  finishSource.resolve()
  await drainStream(audio, stream)
  expect(stream.setVolume(1)).toBe(false)
  expect(stream.setPan(0)).toBe(false)
  expect(stream.setGroup(0)).toBe(false)
})

test("Audio retries only documented HTTP statuses and enforces maxAttempts", async () => {
  const fixture = new Uint8Array(await readFile(MP3_URL))
  const retryableStatuses = [408, 425, 429, 500, 503, 599]
  for (const status of retryableStatuses) {
    let requests = 0
    const server = createServer((_, response) => {
      requests += 1
      if (requests === 1) {
        response.writeHead(status, { Connection: "close" })
        response.end()
        return
      }
      response.writeHead(200, { "Content-Type": "audio/mpeg", Connection: "close" })
      response.end(fixture)
    })
    const baseUrl = await listen(server)
    const audio = Audio.create({ autoStart: false })
    audios.push(audio)
    expect(audio.startMixer()).toBe(true)

    const stream = await audio.playStream(`${baseUrl}/radio`, {
      buffer: { capacityMs: 250, startupMs: 25, resumeMs: 25 },
      reconnect: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 },
    })
    await drainStream(audio, stream)
    expect(requests).toBe(2)
    expect(stream.getStats().reconnectAttempts).toBe(1)
    audio.dispose()
  }

  const nonRetryableStatuses = [400, 404, 499, 600]
  for (const status of nonRetryableStatuses) {
    let requests = 0
    const server = createServer((_, response) => {
      requests += 1
      response.writeHead(status, { Connection: "close" })
      response.end()
    })
    const baseUrl = await listen(server)
    const audio = Audio.create({ autoStart: false })
    audios.push(audio)

    await expect(
      audio.playStream(`${baseUrl}/radio`, {
        reconnect: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
      }),
    ).rejects.toThrow(`HTTP ${status}`)
    expect(requests).toBe(1)
    expect(audio.getStats()?.voicesActive).toBe(0)
    audio.dispose()
  }

  for (const maxAttempts of [0, 2]) {
    let requests = 0
    const server = createServer((_, response) => {
      requests += 1
      response.writeHead(503, { Connection: "close" })
      response.end()
    })
    const baseUrl = await listen(server)
    const audio = Audio.create({ autoStart: false })
    audios.push(audio)

    await expect(
      audio.playStream(`${baseUrl}/radio`, {
        reconnect: { maxAttempts, initialDelayMs: 0, maxDelayMs: 0 },
      }),
    ).rejects.toThrow("HTTP 503")
    expect(requests).toBe(maxAttempts + 1)
    expect(audio.getStats()?.voicesActive).toBe(0)
    audio.dispose()
  }
})

test("Audio resets consecutive reconnect attempts after decoder recovery", async () => {
  const longFixture = new Uint8Array(await readFile(MP3_5S_URL))
  const replacementFixture = repeatBytes(new Uint8Array(await readFile(MP3_3000_URL)), 5)
  const finalFixture = new Uint8Array(await readFile(MP3_URL))
  const interruptFirst = deferred()
  const interruptSecond = deferred()
  let requests = 0
  const server = createServer((_, response) => {
    requests += 1
    if (requests === 1) {
      response.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Content-Length": longFixture.length * 2,
        Connection: "close",
      })
      response.write(longFixture)
      void interruptFirst.promise.then(() => response.destroy())
      return
    }
    if (requests === 2) {
      response.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Content-Length": replacementFixture.length * 2,
        Connection: "close",
      })
      response.write(replacementFixture)
      void interruptSecond.promise.then(() => response.destroy())
      return
    }
    response.writeHead(200, { "Content-Type": "audio/mpeg", Connection: "close" })
    response.end(finalFixture)
  })
  const baseUrl = await listen(server)
  const audio = Audio.create({ autoStart: false })
  audios.push(audio)
  expect(audio.startMixer()).toBe(true)

  const stream = await audio.playStream(`${baseUrl}/radio`, {
    buffer: { capacityMs: 500, startupMs: 50, resumeMs: 50 },
    reconnect: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 },
  })
  stream.on("error", () => {})
  const attempts: number[] = []
  stream.on("reconnecting", ({ attempt }) => {
    attempts.push(attempt)
  })

  interruptFirst.resolve()
  let replacementOutput: Float32Array | null = null
  await waitFor(
    () =>
      requests === 2 &&
      replacementOutput != null &&
      tonePower(replacementOutput, 2048, 3000) > tonePower(replacementOutput, 2048, 750) * 10,
    "Audio stream did not recover from its first outage",
    () => {
      replacementOutput = audio.mixFrames(2048, 2)
    },
    4000,
  )

  const beforeSecondOutage = stream.getStats()
  interruptSecond.resolve()
  await waitFor(
    () => {
      const stats = stream.getStats()
      if (stats.state === "errored") {
        throw new Error(
          `Audio stream errored during second recovery (requests=${requests}, attempts=${attempts.join(",")})`,
        )
      }
      return requests === 3 && stats.bytesReceived > beforeSecondOutage.bytesReceived
    },
    "Audio stream did not recover from its second independent outage",
    () => {
      audio.mixFrames(2048, 2)
    },
    4000,
  )
  await drainStream(audio, stream)

  expect(attempts).toEqual([1, 1])
  expect(stream.getStats().reconnectAttempts).toBe(2)
})

test("Audio reports Retry-After delay through reconnect events without waiting for it", async () => {
  const longFixture = new Uint8Array(await readFile(MP3_5S_URL))
  const interruptFirst = deferred()
  let requests = 0
  const server = createServer((_, response) => {
    requests += 1
    if (requests === 1) {
      response.writeHead(200, { "Content-Type": "audio/mpeg", Connection: "close" })
      response.write(longFixture)
      void interruptFirst.promise.then(() => response.destroy())
      return
    }
    response.writeHead(503, { "Retry-After": "1", Connection: "close" })
    response.end()
  })
  const baseUrl = await listen(server)
  const audio = Audio.create({ autoStart: false })
  audios.push(audio)
  expect(audio.startMixer()).toBe(true)

  const stream = await audio.playStream(`${baseUrl}/radio`, {
    buffer: { capacityMs: 500, startupMs: 50, resumeMs: 50 },
    reconnect: { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 100, backoffFactor: 2 },
  })
  stream.on("error", () => {})
  const delays: number[] = []
  stream.on("reconnecting", ({ delayMs }) => {
    delays.push(delayMs)
    if (delays.length === 2) stream.dispose()
  })

  interruptFirst.resolve()
  await stream.closed

  expect(delays).toEqual([0, 100])
  expect(requests).toBe(2)
  expect(stream.state).toBe("disposed")
})

test("Audio enforces the documented HTTP content-type policy", async () => {
  const fixture = new Uint8Array(await readFile(MP3_URL))
  const allowedContentTypes: Array<string | undefined> = [
    "audio/mpeg",
    "audio/mp3",
    "application/octet-stream",
    "application/mp3",
    "Audio/MPEG; charset=binary",
    undefined,
  ]
  for (const contentType of allowedContentTypes) {
    const server = createServer((_, response) => {
      const headers: Record<string, string> = { Connection: "close" }
      if (contentType != null) headers["Content-Type"] = contentType
      response.writeHead(200, headers)
      response.end(fixture)
    })
    const baseUrl = await listen(server)
    const audio = Audio.create({ autoStart: false })
    audios.push(audio)
    expect(audio.startMixer()).toBe(true)

    const stream = await audio.playStream(new URL("/radio", baseUrl), {
      buffer: { capacityMs: 250, startupMs: 25, resumeMs: 25 },
    })
    await drainStream(audio, stream)
    expect(stream.getStats().framesPlayed).toBeGreaterThan(0n)
    audio.dispose()
  }

  let unsupportedRequests = 0
  const unsupportedServer = createServer((_, response) => {
    unsupportedRequests += 1
    response.writeHead(200, { "Content-Type": "text/plain", Connection: "close" })
    response.end(fixture)
  })
  const unsupportedUrl = await listen(unsupportedServer)
  const unsupportedAudio = Audio.create({ autoStart: false })
  audios.push(unsupportedAudio)
  await expect(
    unsupportedAudio.playStream(`${unsupportedUrl}/radio`, {
      reconnect: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
    }),
  ).rejects.toThrow("Unsupported audio stream Content-Type")
  expect(unsupportedRequests).toBe(1)
  expect(unsupportedAudio.getStats()?.voicesActive).toBe(0)
  unsupportedAudio.dispose()
})

test("Audio classifies invalid chunks and invalid reconnect media at the public boundary", async () => {
  const audio = Audio.create({ autoStart: false })
  audios.push(audio)
  let invalidSetupConsumed = false
  const invalidSetupSource: AsyncIterable<Uint8Array> = {
    async *[Symbol.asyncIterator]() {
      invalidSetupConsumed = true
      yield "invalid chunk" as unknown as Uint8Array
    },
  }
  await expect(audio.playStream(invalidSetupSource)).rejects.toThrow("Uint8Array")
  expect(invalidSetupConsumed).toBe(true)
  expect(audio.getStats()?.voicesActive).toBe(0)

  const longFixture = new Uint8Array(await readFile(MP3_5S_URL))
  const releaseInvalidChunk = deferred()
  async function* invalidRuntimeSource(): AsyncGenerator<Uint8Array> {
    yield longFixture
    await releaseInvalidChunk.promise
    yield "invalid chunk" as unknown as Uint8Array
  }
  expect(audio.startMixer()).toBe(true)
  const runtimeStream = await audio.playStream(invalidRuntimeSource(), {
    buffer: { capacityMs: 500, startupMs: 50, resumeMs: 50 },
  })
  const runtimeErrorContext: { value?: AudioStreamErrorContext } = {}
  runtimeStream.on("error", (_error, context) => {
    runtimeErrorContext.value = context
  })
  releaseInvalidChunk.resolve()
  await runtimeStream.closed
  await waitFor(() => runtimeErrorContext.value != null, "Invalid runtime chunk did not emit an error")
  expect(runtimeStream.state).toBe("errored")
  expect(runtimeErrorContext.value?.action).toBe("source")
  expect(audio.getStats()?.voicesActive).toBe(0)

  const interruptFirst = deferred()
  let requests = 0
  const server = createServer((_, response) => {
    requests += 1
    if (requests === 1) {
      response.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Content-Length": longFixture.length * 2,
        Connection: "close",
      })
      response.write(longFixture)
      void interruptFirst.promise.then(() => response.destroy())
      return
    }
    response.writeHead(200, { "Content-Type": "audio/mpeg", Connection: "close" })
    response.end("not an mp3 stream")
  })
  const baseUrl = await listen(server)
  const reconnectStream = await audio.playStream(`${baseUrl}/radio`, {
    buffer: { capacityMs: 500, startupMs: 50, resumeMs: 50 },
    reconnect: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
  })
  const reconnectErrorContext: { value?: AudioStreamErrorContext } = {}
  reconnectStream.on("error", (_error, context) => {
    reconnectErrorContext.value = context
  })
  interruptFirst.resolve()
  await reconnectStream.closed
  await waitFor(() => reconnectErrorContext.value != null, "Invalid replacement MP3 did not emit an error")

  expect(reconnectStream.state).toBe("errored")
  expect(reconnectErrorContext.value?.action).toBe("decoder")
  expect(requests).toBe(2)
  expect(audio.getStats()?.voicesActive).toBe(0)
})

test("AbortSignal cancels stream setup and active playback without error events", async () => {
  const preAborted = new AbortController()
  preAborted.abort()
  let pulls = 0
  const unconsumedSource: AsyncIterable<Uint8Array> = {
    async *[Symbol.asyncIterator]() {
      pulls += 1
      yield new Uint8Array(await readFile(MP3_URL))
    },
  }
  const audio = Audio.create({ autoStart: false })
  audios.push(audio)
  let setupRejection: unknown
  try {
    await audio.playStream(unconsumedSource, { signal: preAborted.signal })
  } catch (error) {
    setupRejection = error
  }
  expect((setupRejection as Error)?.name).toBe("AbortError")
  expect(pulls).toBe(0)
  expect(audio.getStats()?.voicesActive).toBe(0)

  const longFixture = new Uint8Array(await readFile(MP3_5S_URL))
  let cancelled = false
  const activeSource = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(longFixture)
    },
    cancel() {
      cancelled = true
    },
  })
  expect(audio.startMixer()).toBe(true)
  const activeAbort = new AbortController()
  const stream = await audio.playStream(activeSource, {
    signal: activeAbort.signal,
    buffer: { capacityMs: 500, startupMs: 50, resumeMs: 50 },
  })
  let disposedEvents = 0
  let errorEvents = 0
  stream.on("disposed", () => {
    disposedEvents += 1
  })
  stream.on("error", () => {
    errorEvents += 1
  })
  activeAbort.abort()
  await stream.closed
  await waitFor(() => disposedEvents === 1, "Aborted stream did not emit disposed")

  expect(cancelled).toBe(true)
  expect(errorEvents).toBe(0)
  expect(stream.state).toBe("disposed")
  expect(stream.getStats().bufferedFrames).toBe(0)
  expect(stream.setVolume(1)).toBe(false)
  expect(stream.setPan(0)).toBe(false)
  expect(stream.setGroup(0)).toBe(false)
  expect(audio.getStats()?.voicesActive).toBe(0)
})

test("Audio.dispose cancels active streams and pending setup", async () => {
  const longFixture = new Uint8Array(await readFile(MP3_5S_URL))
  let activeCancelled = false
  const activeSource = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(longFixture)
    },
    cancel() {
      activeCancelled = true
      audio.dispose()
    },
  })
  const audio = Audio.create({ autoStart: false })
  audios.push(audio)
  let audioDisposedEvents = 0
  audio.on("disposed", () => {
    audioDisposedEvents += 1
  })
  expect(audio.startMixer()).toBe(true)
  const activeStream = await audio.playStream(activeSource, {
    buffer: { capacityMs: 500, startupMs: 50, resumeMs: 50 },
  })
  audio.dispose()
  await activeStream.closed

  expect(activeCancelled).toBe(true)
  expect(audioDisposedEvents).toBe(1)
  expect(activeStream.state).toBe("disposed")
  expect(activeStream.getStats().bufferedFrames).toBe(0)

  let pendingCancelled = false
  const pendingSource = new ReadableStream<Uint8Array>({
    cancel() {
      pendingCancelled = true
    },
  })
  const pendingAudio = Audio.create({ autoStart: false })
  audios.push(pendingAudio)
  const pendingSetup = pendingAudio.playStream(pendingSource)
  pendingAudio.dispose()
  let pendingRejection: unknown
  try {
    await pendingSetup
  } catch (error) {
    pendingRejection = error
  }

  expect((pendingRejection as Error)?.name).toBe("AbortError")
  expect(pendingCancelled).toBe(true)
  pendingAudio.dispose()
})

test("Audio validates public stream and reconnect options before consuming a source", async () => {
  const invalidBodyOptions: Array<{
    name: string
    options: Parameters<Audio["playStream"]>[1]
    message: string
  }> = [
    { name: "zero capacity", options: { buffer: { capacityMs: 0 } }, message: "buffer.capacityMs" },
    { name: "fractional capacity", options: { buffer: { capacityMs: 1.5 } }, message: "buffer.capacityMs" },
    {
      name: "non-finite capacity",
      options: { buffer: { capacityMs: Number.POSITIVE_INFINITY } },
      message: "buffer.capacityMs",
    },
    {
      name: "startup above capacity",
      options: { buffer: { capacityMs: 100, startupMs: 101 } },
      message: "buffer.startupMs",
    },
    {
      name: "resume above capacity",
      options: { buffer: { capacityMs: 100, startupMs: 1, resumeMs: 101 } },
      message: "buffer.resumeMs",
    },
  ]
  for (const scenario of invalidBodyOptions) {
    let pulls = 0
    const source: AsyncIterable<Uint8Array> = {
      async *[Symbol.asyncIterator]() {
        pulls += 1
      },
    }
    const audio = Audio.create({ autoStart: false })
    audios.push(audio)
    await expect(audio.playStream(source, scenario.options)).rejects.toThrow(scenario.message)
    expect(pulls).toBe(0)
    expect(audio.getStats()?.voicesActive).toBe(0)
    audio.dispose()
  }

  let validationRequests = 0
  const validationServer = createServer((_, response) => {
    validationRequests += 1
    response.writeHead(500, { Connection: "close" })
    response.end()
  })
  const validationUrl = await listen(validationServer)
  const invalidReconnectOptions = [
    { reconnect: { maxAttempts: -1 }, message: "reconnect.maxAttempts" },
    { reconnect: { maxAttempts: 1.5 }, message: "reconnect.maxAttempts" },
    { reconnect: { initialDelayMs: -1 }, message: "reconnect.initialDelayMs" },
    { reconnect: { maxDelayMs: 1.5 }, message: "reconnect.maxDelayMs" },
    { reconnect: { backoffFactor: 0.5 }, message: "reconnect.backoffFactor" },
    {
      reconnect: { backoffFactor: Number.POSITIVE_INFINITY },
      message: "reconnect.backoffFactor",
    },
  ]
  for (const scenario of invalidReconnectOptions) {
    const audio = Audio.create({ autoStart: false })
    audios.push(audio)
    await expect(audio.playStream(`${validationUrl}/radio`, { reconnect: scenario.reconnect })).rejects.toThrow(
      scenario.message,
    )
    expect(audio.getStats()?.voicesActive).toBe(0)
    audio.dispose()
  }
  expect(validationRequests).toBe(0)

  for (const urlOnlyOptions of [{ reconnect: {} }, { request: { headers: { "x-test": "value" } } }]) {
    let pulls = 0
    const source: AsyncIterable<Uint8Array> = {
      async *[Symbol.asyncIterator]() {
        pulls += 1
      },
    }
    const audio = Audio.create({ autoStart: false })
    audios.push(audio)
    await expect(audio.playStream(source, urlOnlyOptions as Parameters<Audio["playStream"]>[1])).rejects.toThrow(
      "only supported for URL",
    )
    expect(pulls).toBe(0)
    expect(audio.getStats()?.voicesActive).toBe(0)
    audio.dispose()
  }
})
