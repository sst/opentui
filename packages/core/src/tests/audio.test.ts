import { afterEach, expect, test } from "bun:test"
import { Audio, AudioInitializationError, setupAudio } from "../audio.js"
import { NativeAudioStreamFormat, resolveRenderLib } from "../zig.js"

const SAMPLE_RATE = 48_000

function buildPcm16Wav(samples: number[], channels: number): Uint8Array {
  if (channels <= 0 || samples.length % channels !== 0) {
    throw new Error(`Invalid PCM payload for channel count ${channels}`)
  }

  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const frameCount = samples.length / channels
  const dataSize = frameCount * channels * bytesPerSample
  const byteRate = SAMPLE_RATE * channels * bytesPerSample
  const blockAlign = channels * bytesPerSample
  const totalSize = 44 + dataSize
  const out = new Uint8Array(totalSize)
  const view = new DataView(out.buffer)

  out.set([0x52, 0x49, 0x46, 0x46], 0) // RIFF
  view.setUint32(4, totalSize - 8, true)
  out.set([0x57, 0x41, 0x56, 0x45], 8) // WAVE
  out.set([0x66, 0x6d, 0x74, 0x20], 12) // fmt
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  out.set([0x64, 0x61, 0x74, 0x61], 36) // data
  view.setUint32(40, dataSize, true)

  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true)
  }

  return out
}

function buildMonoPcm16Wav(samples: number[]): Uint8Array {
  return buildPcm16Wav(samples, 1)
}

const instances: Audio[] = []

afterEach(() => {
  for (const instance of instances.splice(0)) {
    instance.dispose()
  }
})

function replaceMethod(target: object, name: string, replacement: unknown): () => void {
  const previous = Object.getOwnPropertyDescriptor(target, name)
  Object.defineProperty(target, name, {
    configurable: true,
    writable: true,
    value: replacement,
  })
  return () => {
    if (previous) Object.defineProperty(target, name, previous)
    else delete (target as Record<string, unknown>)[name]
  }
}

function captureAudioEvents(run: () => void): string[] {
  const events: string[] = []
  const restoreEmit = replaceMethod(Audio.prototype, "emit", (event: string) => {
    events.push(event)
    return false
  })
  try {
    run()
  } finally {
    restoreEmit()
  }
  return events
}

test("Audio.create throws synchronously when engine creation fails", () => {
  let thrown: unknown
  const events = captureAudioEvents(() => {
    try {
      Audio.create({ playbackChannels: 0xffffffff })
    } catch (error) {
      thrown = error
    }
  })

  expect(thrown).toBeInstanceOf(AudioInitializationError)
  expect((thrown as AudioInitializationError).action).toBe("createAudioEngine")
  expect(events).toEqual([])
})

test("setupAudio uses the same synchronous initialization contract", () => {
  expect(() => setupAudio({ playbackChannels: 0xffffffff })).toThrow(AudioInitializationError)
})

test("Audio auto-start failure throws and destroys the native engine", () => {
  const lib = resolveRenderLib()
  const originalDestroy = lib.destroyAudioEngine
  let destroyCalls = 0
  let thrown: unknown

  const restoreStart = replaceMethod(lib, "audioStart", () => -5)
  const restoreDestroy = replaceMethod(lib, "destroyAudioEngine", (engine: Parameters<typeof originalDestroy>[0]) => {
    destroyCalls += 1
    originalDestroy.call(lib, engine)
  })
  try {
    const events = captureAudioEvents(() => {
      try {
        Audio.create({ autoStart: true })
      } catch (error) {
        thrown = error
      }
    })
    expect(events).toEqual([])
  } finally {
    restoreDestroy()
    restoreStart()
  }

  expect(thrown).toBeInstanceOf(AudioInitializationError)
  expect((thrown as AudioInitializationError).action).toBe("start")
  expect((thrown as AudioInitializationError).status).toBe(-5)
  expect(destroyCalls).toBe(1)
})

test("Audio wraps an auto-start option packing failure and destroys the native engine", () => {
  const lib = resolveRenderLib()
  const originalCreate = lib.createAudioEngine
  const originalDestroy = lib.destroyAudioEngine
  const startFailure = new Error("start option getter failed")
  const startOptions = Object.defineProperty({}, "periodSizeInFrames", {
    get() {
      throw startFailure
    },
  })
  let createdEngine: ReturnType<typeof originalCreate> = null
  let destroyCalls = 0
  let thrown: unknown

  const restoreCreate = replaceMethod(lib, "createAudioEngine", (options: Parameters<typeof originalCreate>[0]) => {
    createdEngine = originalCreate.call(lib, options)
    return createdEngine
  })
  const restoreDestroy = replaceMethod(lib, "destroyAudioEngine", (engine: Parameters<typeof originalDestroy>[0]) => {
    destroyCalls += 1
    originalDestroy.call(lib, engine)
  })

  try {
    try {
      Audio.create({ autoStart: true, startOptions })
    } catch (error) {
      thrown = error
    }
  } finally {
    restoreDestroy()
    restoreCreate()
    if (createdEngine != null && destroyCalls === 0) originalDestroy.call(lib, createdEngine)
  }

  expect({
    wrapped: thrown instanceof AudioInitializationError,
    action: thrown instanceof AudioInitializationError ? thrown.action : undefined,
    status: thrown instanceof AudioInitializationError ? thrown.status : undefined,
    destroyCalls,
  }).toEqual({ wrapped: true, action: "start", status: -1, destroyCalls: 1 })
})

test("Audio.start reports an option packing failure through its status contract", () => {
  const packingFailure = new Error("start option getter failed")
  const startOptions = Object.defineProperty({}, "periodSizeInFrames", {
    get() {
      throw packingFailure
    },
  })
  const audio = Audio.create({ autoStart: false })
  instances.push(audio)
  const errors: unknown[] = []
  audio.on("error", (error, context) => {
    errors.push({ message: error.message, context })
  })

  expect(audio.start(startOptions)).toBe(false)
  expect(audio.isStarted()).toBe(false)
  expect(audio.isMixerStarted()).toBe(false)
  expect(errors).toEqual([{ message: "Audio start failed: -1", context: { action: "start", status: -1 } }])
})

test("Audio auto-start success updates started state", () => {
  const lib = resolveRenderLib()
  let audio!: Audio
  const restoreStart = replaceMethod(lib, "audioStart", () => 0)
  try {
    const events = captureAudioEvents(() => {
      audio = Audio.create({ autoStart: true })
    })
    expect(events).toEqual([])
  } finally {
    restoreStart()
  }

  expect(audio.isStarted()).toBe(true)
  expect(audio.isMixerStarted()).toBe(true)
  instances.push(audio)
})

test("Audio explicit start emits started after construction", () => {
  const lib = resolveRenderLib()
  const restoreStart = replaceMethod(lib, "audioStart", () => 0)
  try {
    const audio = Audio.create({ autoStart: false })
    instances.push(audio)
    let startedEvents = 0
    audio.on("started", () => {
      startedEvents += 1
    })

    expect(audio.start()).toBe(true)
    expect(startedEvents).toBe(1)
  } finally {
    restoreStart()
  }
})

test("Audio loads wav and mixes frames", () => {
  const audio = Audio.create({ autoStart: false })
  instances.push(audio)

  const wav = buildMonoPcm16Wav([0, 0.25, -0.25, 0.5, -0.5, 0])
  const sound = audio.loadSound(wav)
  const sfx = audio.group("sfx")

  expect(sound).not.toBeNull()
  expect(sfx).not.toBeNull()
  if (sound == null || sfx == null) return

  expect(audio.startMixer()).toBe(true)
  const voice = audio.play(sound, { groupId: sfx, volume: 1, pan: 0, loop: false })
  expect(voice).not.toBeNull()
  const mixed = audio.mixFrames(6, 2)

  expect(mixed).not.toBeNull()
  if (!mixed) return
  expect(mixed.length).toBe(12)
  expect(mixed.some((sample) => Math.abs(sample) > 0.001)).toBe(true)
  expect(audio.getStats()?.soundsLoaded).toBe(1)
})

test("Audio does not auto-start by default", () => {
  const audio = Audio.create()
  instances.push(audio)

  expect(audio.isStarted()).toBe(false)
  expect(audio.isMixerStarted()).toBe(false)
})

test("Audio start reports playback availability only", () => {
  const audio = Audio.create({ autoStart: false })
  audio.on("error", () => {})
  instances.push(audio)

  expect(audio.isStarted()).toBe(false)
  expect(audio.isMixerStarted()).toBe(false)
  let startedEvents = 0
  audio.on("started", () => {
    startedEvents += 1
  })

  const started = audio.start()
  expect(audio.isStarted()).toBe(started)
  expect(audio.isMixerStarted()).toBe(started)
  expect(startedEvents).toBe(started ? 1 : 0)
})

test("Audio startMixer enables headless mixing without playback", () => {
  const audio = Audio.create({ autoStart: false })
  instances.push(audio)

  const wav = buildMonoPcm16Wav([0, 0.25, -0.25, 0.5, -0.5, 0])
  const sound = audio.loadSound(wav)
  expect(sound).not.toBeNull()
  if (sound == null) return

  expect(audio.startMixer()).toBe(true)
  expect(audio.isStarted()).toBe(false)
  expect(audio.isMixerStarted()).toBe(true)

  const voice = audio.play(sound, { volume: 1, loop: true })
  expect(voice).not.toBeNull()

  const mixed = audio.mixFrames(6, 2)
  expect(mixed).not.toBeNull()
  expect(mixed?.some((sample) => Math.abs(sample) > 0.001)).toBe(true)

  expect(audio.stop()).toBe(true)
  expect(audio.isStarted()).toBe(false)
  expect(audio.isMixerStarted()).toBe(false)
})

test("Audio unloads sounds and invalidates old handles", () => {
  const audio = Audio.create({ autoStart: false })
  audio.on("error", () => {})
  instances.push(audio)

  const first = audio.loadSound(buildMonoPcm16Wav([0, 0.25, -0.25, 0.5, -0.5, 0]))
  expect(first).not.toBeNull()
  if (first == null) return

  expect(audio.startMixer()).toBe(true)
  const firstVoice = audio.play(first, { volume: 1, pan: 0, loop: true })
  expect(firstVoice).not.toBeNull()
  expect(audio.getStats()?.voicesActive).toBeGreaterThan(0)

  expect(audio.unloadSound(first)).toBe(true)
  expect(audio.getStats()?.soundsLoaded).toBe(0)
  expect(audio.getStats()?.voicesActive).toBe(0)
  expect(audio.play(first, { volume: 1 })).toBeNull()
  expect(audio.unloadSound(first)).toBe(false)

  const second = audio.loadSound(buildMonoPcm16Wav([0.6, -0.2, 0.4, -0.4, 0.3, -0.1]))
  expect(second).not.toBeNull()
  if (second == null) return
  expect(second).not.toBe(first)

  const secondVoice = audio.play(second, { volume: 1, pan: 0, loop: false })
  expect(secondVoice).not.toBeNull()
})

test("Audio mixes into mono and multichannel output buffers", () => {
  const audio = Audio.create({ autoStart: false })
  instances.push(audio)

  const wav = buildMonoPcm16Wav([0.6, -0.2, 0.4, -0.4, 0.3, -0.1])
  const sound = audio.loadSound(wav)
  expect(sound).not.toBeNull()
  if (sound == null) return

  expect(audio.startMixer()).toBe(true)
  const voice = audio.play(sound, { volume: 1, pan: 0, loop: true })
  expect(voice).not.toBeNull()

  const mono = audio.mixFrames(6, 1)
  expect(mono).not.toBeNull()
  if (!mono) return
  expect(mono.length).toBe(6)
  expect(mono.some((sample) => Math.abs(sample) > 0.001)).toBe(true)

  const quad = audio.mixFrames(6, 4)
  expect(quad).not.toBeNull()
  if (!quad) return
  expect(quad.length).toBe(24)
  expect(quad.some((sample, index) => index % 4 < 2 && Math.abs(sample) > 0.001)).toBe(true)
  for (let frame = 0; frame < 6; frame += 1) {
    expect(quad[frame * 4 + 2]).toBe(0)
    expect(quad[frame * 4 + 3]).toBe(0)
  }
})

test("Audio updates mix stats", () => {
  const audio = Audio.create({ autoStart: false })
  instances.push(audio)

  const wave = Array.from({ length: 2048 }, (_, index) => Math.sin((Math.PI * 2 * index) / 32) * 0.8)
  const wav = buildMonoPcm16Wav(wave)
  const sound = audio.loadSound(wav)
  expect(sound).not.toBeNull()
  if (sound == null) return

  expect(audio.startMixer()).toBe(true)
  const voice = audio.play(sound, { volume: 1, pan: 0, loop: true })
  expect(voice).not.toBeNull()

  const initialStats = audio.getStats()
  expect(initialStats).not.toBeNull()
  const initialFrames = initialStats?.framesMixed ?? 0n

  const mixed = audio.mixFrames(512, 2)
  expect(mixed).not.toBeNull()

  const finalStats = audio.getStats()
  expect(finalStats).not.toBeNull()
  expect(finalStats?.framesMixed ?? 0n).toBeGreaterThan(initialFrames)
  expect(finalStats?.voicesActive ?? 0).toBeGreaterThan(0)
})

test("Audio tap mirrors mixed frames without consuming stream", () => {
  const audio = Audio.create({ autoStart: false })
  instances.push(audio)

  const wav = buildMonoPcm16Wav([0, 0.5, -0.5, 0.25, -0.25, 0])
  const sound = audio.loadSound(wav)
  expect(sound).not.toBeNull()
  if (sound == null) return

  expect(audio.startMixer()).toBe(true)
  expect(audio.enableTap(2048)).toBe(true)
  const voice = audio.play(sound, { volume: 1, pan: 0, loop: true })
  expect(voice).not.toBeNull()

  const mixed = audio.mixFrames(256, 2)
  expect(mixed).not.toBeNull()

  const tap = audio.readTapFrames(128, 2)
  expect(tap).not.toBeNull()
  if (!tap) return

  expect(tap.framesRead).toBeGreaterThan(0)
  expect(tap.frames.length).toBe(256)
  expect(tap.frames.some((sample) => Math.abs(sample) > 0.001)).toBe(true)

  expect(audio.disableTap()).toBe(true)
})

test("Audio supports immutable custom sample rate", () => {
  const audio = Audio.create({ autoStart: false, sampleRate: 44_100, playbackChannels: 1 })
  instances.push(audio)

  const wav = buildMonoPcm16Wav([0.3, -0.3, 0.2, -0.2, 0.1, -0.1])
  const sound = audio.loadSound(wav)
  expect(sound).not.toBeNull()
  if (sound == null) return

  expect(audio.startMixer()).toBe(true)
  const voice = audio.play(sound, { volume: 1, pan: 0, loop: true })
  expect(voice).not.toBeNull()

  const mixed = audio.mixFrames(128, 2)
  expect(mixed).not.toBeNull()
  if (!mixed) return
  expect(mixed.some((sample) => Math.abs(sample) > 0.001)).toBe(true)
})

test("audioLoad rejects oversized payload lengths before truncating to u32", () => {
  const lib = resolveRenderLib()
  const engine = lib.createAudioEngine()
  expect(engine).not.toBeNull()
  if (engine == null) return

  const oversized = {
    buffer: new ArrayBuffer(1),
    byteOffset: 0,
    byteLength: 0x1_0000_0000,
    length: 0x1_0000_0000,
  } as unknown as Uint8Array

  try {
    expect(() => lib.audioLoad(engine, oversized)).toThrow("Audio data length exceeds native u32 length limit")
  } finally {
    lib.destroyAudioEngine(engine)
  }
})

test("audioWriteStream rejects oversized payload lengths before truncating to u32", () => {
  const lib = resolveRenderLib()
  const engine = lib.createAudioEngine()
  expect(engine).not.toBeNull()
  if (engine == null) return

  const oversized = {
    buffer: new ArrayBuffer(1),
    byteOffset: 0,
    byteLength: 0x1_0000_0000,
    length: 0x1_0000_0000,
  } as unknown as Uint8Array

  try {
    expect(() => lib.audioWriteStream(engine, 1, oversized)).toThrow(
      "Audio stream data length exceeds native u32 length limit",
    )
  } finally {
    lib.destroyAudioEngine(engine)
  }
})

test("audio stream wrappers reject a destroyed engine handle", () => {
  const lib = resolveRenderLib()
  const engine = lib.createAudioEngine()
  expect(engine).not.toBeNull()
  if (engine == null) return
  lib.destroyAudioEngine(engine)

  expect(
    lib.audioCreateStream(engine, {
      capacityMs: 100,
      startupMs: 10,
      resumeMs: 10,
      volume: 1,
      pan: 0,
      groupId: 0,
      maxProbeBytes: 1024 * 1024,
      format: NativeAudioStreamFormat.Mp3,
    }),
  ).toEqual({ status: -1, streamId: null })
  expect(lib.audioWriteStream(engine, 1, new Uint8Array())).toBe(-1)
  expect(lib.audioEndStream(engine, 1)).toBe(-1)
  expect(lib.audioRestartStream(engine, 1)).toBe(-1)
  expect(lib.audioSetStreamVolume(engine, 1, 1)).toBe(-1)
  expect(lib.audioSetStreamPan(engine, 1, 0)).toBe(-1)
  expect(lib.audioSetStreamGroup(engine, 1, 0)).toBe(-1)
  expect(lib.audioGetStreamStats(engine, 1)).toBeNull()
  expect(lib.audioCloseStream(engine, 1, 2)).toEqual({ status: -1, stats: null })
})

test("audioCreateGroup rejects oversized encoded name lengths before truncating to u32", () => {
  const lib = resolveRenderLib()
  const engine = lib.createAudioEngine()
  expect(engine).not.toBeNull()
  if (engine == null) return

  const originalEncode = lib.encoder.encode
  const oversized = {
    buffer: new ArrayBuffer(1),
    byteOffset: 0,
    byteLength: 0x1_0000_0000,
    length: 0x1_0000_0000,
  } as unknown as Uint8Array

  ;(lib.encoder as { encode: (input: string) => Uint8Array }).encode = () => oversized

  try {
    expect(() => lib.audioCreateGroup(engine, "oversized")).toThrow(
      "Audio group name length exceeds native u32 length limit",
    )
  } finally {
    ;(lib.encoder as { encode: (input: string) => Uint8Array }).encode = originalEncode
    lib.destroyAudioEngine(engine)
  }
})
