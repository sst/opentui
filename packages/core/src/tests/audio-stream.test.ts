import { once } from "node:events"
import { readFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { afterEach, expect, test } from "bun:test"
import { Audio, type AudioStream } from "../audio.js"

const SAMPLE_RATE = 48_000
const MP3_URL = new URL("./fixtures/audio/tone-750hz-48k-mono-1s.mp3", import.meta.url)
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
    server.closeAllConnections?.()
    if (server.listening) {
      server.close()
      await once(server, "close")
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

  const stream = await audio.playStream(`${baseUrl}/radio`, {
    buffer: { capacityMs: 500, startupMs: 50, resumeMs: 50 },
  })
  expect(["buffering", "playing"]).toContain(stream.getStats().state)
  const pcm = await waitForTapSignal(audio, stream)

  expect(responseEnded).toBe(false)
  const playingStats = stream.getStats()
  expect(playingStats.state).toBe("playing")
  expect(playingStats.framesPlayed).toBeGreaterThan(0n)
  expect(tonePower(pcm, 2048, 750)).toBeGreaterThan(tonePower(pcm, 2048, 3000) * 10)

  releaseTail.resolve()
  await waitFor(() => responseEnded, "Test server did not finish the MP3 response")
  stream.dispose()
  await stream.closed
}, 10_000)

test("Audio accepts an async iterable and drains it to completion", async () => {
  const mp3 = new Uint8Array(await readFile(MP3_URL))
  async function* chunks(): AsyncGenerator<Uint8Array> {
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
  let observedEnded = false
  stream.on("ended", () => {
    throw new Error("test ended listener failure")
  })
  stream.on("ended", () => {
    observedEnded = true
  })

  expect(stream.setVolume(0.6)).toBe(true)
  expect(stream.setPan(-0.25)).toBe(true)
  expect(stream.setGroup(group ?? 0)).toBe(true)
  stream.on("error", () => {})
  expect(stream.setGroup(0xffffffff)).toBe(false)
  expect(stream.state).not.toBe("errored")
  await drainStream(audio, stream)
  await waitFor(() => observedEnded, "Throwing ended listener interrupted other ended listeners")

  const stats = stream.getStats()
  expect(stats.bytesReceived).toBe(BigInt(mp3.length))
  expect(stats.framesDecoded).toBeGreaterThan(0n)
  expect(stats.framesPlayed).toBeGreaterThan(0n)
})

test("Audio reconnects a URL stream after its response body is interrupted", async () => {
  const mp3 = new Uint8Array(await readFile(MP3_URL))
  const interruptFirstResponse = deferred()
  let requests = 0
  const requestHeaders: Array<string | string[] | undefined> = []
  const server = createServer((request, response) => {
    requests += 1
    requestHeaders.push(request.headers["x-audio-test"])
    response.writeHead(200, { "Content-Type": "audio/mpeg", Connection: "close" })
    if (requests === 1) {
      response.write(mp3.subarray(0, Math.floor(mp3.length * 0.75)))
      void interruptFirstResponse.promise.then(() => response.destroy())
      return
    }
    response.end(mp3)
  })
  const baseUrl = await listen(server)

  const audio = Audio.create({ autoStart: false })
  audios.push(audio)
  expect(audio.startMixer()).toBe(true)

  const stream = await audio.playStream(`${baseUrl}/radio`, {
    buffer: { capacityMs: 500, startupMs: 50, resumeMs: 50 },
    reconnect: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
    request: { headers: { "x-audio-test": "reconnect" } },
  })
  let reconnectEvents = 0
  let reconnectGroupResult: boolean | undefined
  stream.on("reconnecting", () => {
    reconnectEvents += 1
    reconnectGroupResult = stream.setGroup(0xffffffff)
  })
  stream.on("error", () => {})

  interruptFirstResponse.resolve()
  await waitFor(
    () => requests === 2 && reconnectEvents === 1,
    "Audio stream did not reconnect after the response was interrupted",
    () => audio.mixFrames(256, 2),
  )
  await drainStream(audio, stream)

  expect(stream.getStats().reconnectAttempts).toBe(1)
  expect(requests).toBe(2)
  expect(reconnectGroupResult).toBe(false)
  expect(stream.state).toBe("ended")
  expect(requestHeaders).toEqual(["reconnect", "reconnect"])
})

test("Throwing reconnecting listeners do not interrupt reconnection or other listeners", async () => {
  const mp3 = new Uint8Array(await readFile(MP3_URL))
  const interruptFirstResponse = deferred()
  const keepSecondResponseOpen = deferred()
  let requests = 0
  const server = createServer((_, response) => {
    requests += 1
    response.writeHead(200, { "Content-Type": "audio/mpeg", Connection: "close" })
    if (requests === 1) {
      response.write(mp3.subarray(0, Math.floor(mp3.length * 0.75)))
      void interruptFirstResponse.promise.then(() => response.destroy())
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
    buffer: { capacityMs: 500, startupMs: 50, resumeMs: 50 },
    reconnect: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 },
  })
  stream.on("error", () => {})
  let observedReconnect = false
  stream.on("reconnecting", () => {
    throw new Error("test reconnecting listener failure")
  })
  stream.on("reconnecting", () => {
    observedReconnect = true
  })

  try {
    interruptFirstResponse.resolve()
    await waitFor(
      () => requests === 2 && observedReconnect,
      "Throwing reconnecting listener interrupted stream reconnection",
      () => audio.mixFrames(256, 2),
      1000,
    )
  } finally {
    stream.dispose()
    keepSecondResponseOpen.resolve()
    await stream.closed
  }
})

test("Audio drains clean EOF before reconnecting", async () => {
  const mp3 = new Uint8Array(await readFile(MP3_URL))
  const keepSecondResponseOpen = deferred()
  let requests = 0
  const server = createServer((_, response) => {
    requests += 1
    response.writeHead(200, { "Content-Type": "audio/mpeg", Connection: "close" })
    if (requests === 1) {
      response.end(mp3)
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
    reconnect: { initialDelayMs: 0, maxDelayMs: 0, retryOnEnd: true },
  })
  stream.on("error", () => {})
  await waitFor(
    () => requests === 2,
    "Audio stream did not reconnect after draining clean EOF",
    () => audio.mixFrames(256, 2),
  )

  expect(stream.getStats().framesPlayed).toBeGreaterThan(0n)
  expect(stream.getStats().reconnectAttempts).toBe(1)
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

test("Audio rejects non-successful stream responses", async () => {
  const server = createServer((_, response) => {
    response.writeHead(404, { "Content-Type": "text/plain", Connection: "close" })
    response.end("missing")
  })
  const baseUrl = await listen(server)
  const audio = Audio.create({ autoStart: false })
  audios.push(audio)

  await expect(audio.playStream(`${baseUrl}/missing`)).rejects.toThrow("HTTP 404")
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
  async function* source(): AsyncGenerator<Uint8Array> {
    yield mp3
    await failSource.promise
    throw new Error("test source failure")
  }
  const audio = Audio.create({ autoStart: false })
  audios.push(audio)
  expect(audio.startMixer()).toBe(true)

  const stream = await audio.playStream(source(), {
    buffer: { capacityMs: 250, startupMs: 25, resumeMs: 25 },
  })
  const streamErrors: Error[] = []
  stream.on("error", () => {
    throw new Error("test error listener failure")
  })
  stream.on("error", (error) => {
    streamErrors.push(error)
  })
  failSource.resolve()
  await stream.closed
  await waitFor(() => streamErrors.length === 1, "Audio stream did not emit its source failure")

  expect(stream.state).toBe("errored")
  expect(streamErrors[0]?.message).toContain("source failed")
  expect(audio.getStats()?.voicesActive).toBe(0)
})

test("Audio accepts empty chunks without starving stream setup", async () => {
  const mp3 = new Uint8Array(await readFile(MP3_URL))
  async function* source(): AsyncGenerator<Uint8Array> {
    for (let index = 0; index < 10; index += 1) yield new Uint8Array(0)
    yield mp3
  }
  const audio = Audio.create({ autoStart: false })
  audios.push(audio)
  expect(audio.startMixer()).toBe(true)

  const stream = await audio.playStream(source(), {
    buffer: { capacityMs: 250, startupMs: 25, resumeMs: 25 },
  })
  await drainStream(audio, stream)

  expect(stream.getStats().framesPlayed).toBeGreaterThan(0n)
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
    throw new Error("test disposed listener failure")
  })
  stream.on("disposed", () => {
    observedDisposed = true
  })
  stream.dispose()
  await stream.closed
  await waitFor(() => observedDisposed, "Throwing disposed listener interrupted other disposed listeners")

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
