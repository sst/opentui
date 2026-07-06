import { EventEmitter } from "events"
import { readFile } from "node:fs/promises"
import { NativeAudioStreamState, resolveRenderLib, type AudioEngineHandle, type RenderLib } from "./zig.js"
import type { AudioStats, NativeAudioStreamStats } from "./zig-structs.js"

export interface AudioSetupOptions {
  autoStart?: boolean
  sampleRate?: number
  playbackChannels?: number
  startOptions?: AudioStartOptions
}

export interface AudioStartOptions {
  periodSizeInFrames?: number
  periodSizeInMilliseconds?: number
  periods?: number
  performanceProfile?: number
  shareMode?: number
  noPreSilencedOutputBuffer?: boolean
  noClip?: boolean
  noDisableDenormals?: boolean
  noFixedSizedCallback?: boolean
  wasapiNoAutoConvertSrc?: boolean
  wasapiNoDefaultQualitySrc?: boolean
  alsaNoMMap?: boolean
  alsaNoAutoFormat?: boolean
  alsaNoAutoChannels?: boolean
  alsaNoAutoResample?: boolean
}

export interface AudioPlayOptions {
  volume?: number
  pan?: number
  loop?: boolean
  groupId?: number
}

export type AudioStreamSource = string | URL | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>

export interface AudioStreamBufferOptions {
  capacityMs?: number
  startupMs?: number
  resumeMs?: number
}

export interface AudioStreamReconnectOptions {
  maxAttempts?: number
  initialDelayMs?: number
  maxDelayMs?: number
  backoffFactor?: number
  retryOnEnd?: boolean
}

export interface AudioStreamBodyOptions {
  volume?: number
  pan?: number
  groupId?: number
  buffer?: AudioStreamBufferOptions
  signal?: AbortSignal
}

export interface AudioStreamUrlOptions extends AudioStreamBodyOptions {
  request?: Omit<RequestInit, "body" | "signal">
  reconnect?: AudioStreamReconnectOptions
}

export type AudioStreamState =
  | "initializing"
  | "buffering"
  | "playing"
  | "reconnecting"
  | "ended"
  | "errored"
  | "disposed"

export interface AudioStreamStats {
  state: AudioStreamState
  sampleRate: number
  channels: number
  bufferedFrames: number
  capacityFrames: number
  bufferedDurationMs: number
  bytesReceived: bigint
  framesDecoded: bigint
  framesPlayed: bigint
  underruns: number
  reconnectAttempts: number
}

export type AudioStreamAction =
  | "fetch"
  | "response"
  | "source"
  | "create"
  | "write"
  | "end"
  | "restart"
  | "stats"
  | "decoder"
  | "destroy"
  | "setVolume"
  | "setPan"
  | "setGroup"

export interface AudioStreamErrorContext {
  action: AudioStreamAction
  status?: number
  errorCode?: number
  attempt?: number
}

export interface AudioStreamReconnectEvent {
  attempt: number
  delayMs: number
  maxAttempts: number
  error: Error
}

export interface AudioStreamEvents {
  reconnecting: [event: AudioStreamReconnectEvent]
  ended: []
  error: [error: Error, context: AudioStreamErrorContext]
  disposed: []
}

export type AudioGroup = number
export type AudioVoice = number
export type AudioSound = number

export interface AudioPlaybackDevice {
  index: number
  name: string
  isDefault: boolean
}

export type AudioAction =
  | "createAudioEngine"
  | "start"
  | "startMixer"
  | "stop"
  | "loadSound"
  | "loadSoundFile"
  | "unloadSound"
  | "group"
  | "play"
  | "stopVoice"
  | "setVoiceGroup"
  | "setGroupVolume"
  | "setMasterVolume"
  | "mixFrames"
  | "enableTap"
  | "readTapFrames"
  | "listPlaybackDevices"
  | "selectPlaybackDevice"
  | "clearPlaybackDeviceSelection"
  | "getStats"

export interface AudioErrorContext {
  action: AudioAction
  status?: number
}

export interface AudioEvents {
  error: [error: Error, context: AudioErrorContext]
  started: []
  mixerStarted: []
  stopped: []
  disposed: []
}

export type AudioInitializationAction = "resolveRenderLib" | "createAudioEngine" | "start"

export class AudioInitializationError extends Error {
  readonly action: AudioInitializationAction
  readonly status?: number

  constructor(action: AudioInitializationAction, message: string, status?: number, cause?: unknown) {
    super(message)
    this.name = "AudioInitializationError"
    this.action = action
    this.status = status
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause
  }
}

function statusToError(action: string, status: number): Error {
  return new Error(`Audio ${action} failed: ${status}`)
}

function toBytes(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data)
}

const DEFAULT_AUDIO_SAMPLE_RATE = 48_000
const STREAM_INPUT_CAPACITY_BYTES = 256 * 1024
const STREAM_POLL_INTERVAL_MS = 5
const MAX_U32 = 0xffffffff

interface ResolvedAudioStreamReconnectOptions {
  maxAttempts: number
  initialDelayMs: number
  maxDelayMs: number
  backoffFactor: number
  retryOnEnd: boolean
}

interface ResolvedAudioStreamOptions {
  inputCapacityBytes: number
  pcmCapacityFrames: number
  startupFrames: number
  resumeFrames: number
  volume: number
  pan: number
  groupId: number
  signal?: AbortSignal
  request?: Omit<RequestInit, "body" | "signal">
  reconnect?: ResolvedAudioStreamReconnectOptions
}

interface AudioStreamInit {
  lib: RenderLib
  engine: AudioEngineHandle
  sampleRate: number
  source: AudioStreamSource
  options: AudioStreamUrlOptions | AudioStreamBodyOptions
  urlSource: boolean
  isValidGroup: (groupId: number) => boolean
  removeFromOwner: () => void
}

interface NativeStreamRef {
  generation: number
  id: number
}

interface StreamTotals {
  bytesReceived: bigint
  framesDecoded: bigint
  framesPlayed: bigint
  underruns: number
}

interface PendingReconnectAfterEnd {
  generation: number
  error: Error
  context: AudioStreamErrorContext
}

class AudioStreamOperationError extends Error {
  readonly context: AudioStreamErrorContext

  constructor(message: string, context: AudioStreamErrorContext, cause?: unknown) {
    super(message)
    this.name = "AudioStreamError"
    this.context = context
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause
  }
}

function createAbortError(): Error {
  if (typeof DOMException !== "undefined") return new DOMException("The operation was aborted", "AbortError")
  const error = new Error("The operation was aborted")
  error.name = "AbortError"
  return error
}

function isPositiveInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0
}

function resolveDuration(value: number | undefined, fallback: number, name: string): number {
  const duration = value ?? fallback
  if (!isPositiveInteger(duration)) throw new TypeError(`${name} must be a finite positive integer`)
  return duration
}

function durationToFrames(durationMs: number, sampleRate: number, name: string): number {
  const frames = Math.ceil((durationMs * sampleRate) / 1000)
  if (!Number.isSafeInteger(frames) || frames <= 0 || frames > MAX_U32) {
    throw new RangeError(`${name} exceeds the supported frame capacity`)
  }
  return frames
}

function resolveReconnectOptions(options: AudioStreamReconnectOptions): ResolvedAudioStreamReconnectOptions {
  const maxAttempts = options.maxAttempts ?? Number.POSITIVE_INFINITY
  if (maxAttempts !== Number.POSITIVE_INFINITY && (!Number.isInteger(maxAttempts) || maxAttempts < 0)) {
    throw new TypeError("reconnect.maxAttempts must be a non-negative integer or Infinity")
  }

  const initialDelayMs = options.initialDelayMs ?? 1000
  const maxDelayMs = options.maxDelayMs ?? 15_000
  const backoffFactor = options.backoffFactor ?? 2
  if (!Number.isFinite(initialDelayMs) || !Number.isInteger(initialDelayMs) || initialDelayMs < 0) {
    throw new TypeError("reconnect.initialDelayMs must be a finite non-negative integer")
  }
  if (!Number.isFinite(maxDelayMs) || !Number.isInteger(maxDelayMs) || maxDelayMs < 0) {
    throw new TypeError("reconnect.maxDelayMs must be a finite non-negative integer")
  }
  if (!Number.isFinite(backoffFactor) || backoffFactor < 1) {
    throw new TypeError("reconnect.backoffFactor must be a finite number greater than or equal to 1")
  }

  return {
    maxAttempts,
    initialDelayMs,
    maxDelayMs,
    backoffFactor,
    retryOnEnd: options.retryOnEnd ?? false,
  }
}

function resolveAudioStreamOptions(
  options: AudioStreamUrlOptions | AudioStreamBodyOptions,
  sampleRate: number,
  urlSource: boolean,
): ResolvedAudioStreamOptions {
  const capacityMs = resolveDuration(options.buffer?.capacityMs, 2000, "buffer.capacityMs")
  const startupMs = resolveDuration(options.buffer?.startupMs, 1000, "buffer.startupMs")
  const resumeMs = resolveDuration(options.buffer?.resumeMs, 1000, "buffer.resumeMs")
  if (startupMs > capacityMs) throw new RangeError("buffer.startupMs must not exceed buffer.capacityMs")
  if (resumeMs > capacityMs) throw new RangeError("buffer.resumeMs must not exceed buffer.capacityMs")

  const urlOptions = options as AudioStreamUrlOptions
  if (!urlSource && (urlOptions.reconnect !== undefined || urlOptions.request !== undefined)) {
    throw new TypeError("request and reconnect options are only supported for URL audio streams")
  }

  let request: Omit<RequestInit, "body" | "signal"> | undefined
  if (urlSource && urlOptions.request !== undefined) {
    const { body: _body, signal: _signal, ...safeRequest } = urlOptions.request as RequestInit
    request = safeRequest
  }

  return {
    inputCapacityBytes: STREAM_INPUT_CAPACITY_BYTES,
    pcmCapacityFrames: durationToFrames(capacityMs, sampleRate, "buffer.capacityMs"),
    startupFrames: durationToFrames(startupMs, sampleRate, "buffer.startupMs"),
    resumeFrames: durationToFrames(resumeMs, sampleRate, "buffer.resumeMs"),
    volume: options.volume ?? 1,
    pan: options.pan ?? 0,
    groupId: options.groupId ?? 0,
    signal: options.signal,
    request,
    reconnect:
      urlSource && urlOptions.reconnect !== undefined ? resolveReconnectOptions(urlOptions.reconnect) : undefined,
  }
}

const NATIVE_STREAM_STATES = [
  "initializing",
  "buffering",
  "playing",
  "ended",
  "errored",
  "disposed",
  "reconnecting",
] as const

function runBoundedCleanup(cleanup: () => unknown, timeoutMs: number = 50): Promise<void> {
  let result: Promise<unknown>
  try {
    result = Promise.resolve(cleanup())
  } catch {
    return Promise.resolve()
  }

  const observed = result.then(
    () => undefined,
    () => undefined,
  )
  return new Promise((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    void observed.then(finish)
  })
}

function waitForDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(createAbortError())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, delayMs)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(createAbortError())
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

function parseRetryAfter(value: string | null, maxDelayMs: number): number | undefined {
  if (value == null) return undefined
  const seconds = Number(value.trim())
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(maxDelayMs, Math.ceil(seconds * 1000))
  const date = Date.parse(value)
  if (!Number.isFinite(date)) return undefined
  return Math.min(maxDelayMs, Math.max(0, date - Date.now()))
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function isAllowedMp3ContentType(value: string): boolean {
  const contentType = value.split(";", 1)[0]?.trim().toLowerCase()
  return (
    contentType === "audio/mpeg" ||
    contentType === "audio/mp3" ||
    contentType === "application/octet-stream" ||
    contentType === "application/mp3"
  )
}

function isReadableStreamSource(source: unknown): source is ReadableStream<Uint8Array> {
  return (
    typeof source === "object" &&
    source !== null &&
    typeof (source as ReadableStream<Uint8Array>).getReader === "function"
  )
}

function isAsyncIterableSource(source: unknown): source is AsyncIterable<Uint8Array> {
  return (
    (typeof source === "object" || typeof source === "function") &&
    source !== null &&
    typeof (source as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === "function"
  )
}

let createAudioStream: (init: AudioStreamInit) => AudioStream
let openAudioStream: (stream: AudioStream) => Promise<void>

export class AudioStream extends EventEmitter<AudioStreamEvents> {
  readonly closed: Promise<void>

  private readonly lib: RenderLib
  private readonly engine: AudioEngineHandle
  private readonly source: AudioStreamSource
  private readonly urlSource: boolean
  private readonly options: ResolvedAudioStreamOptions
  private readonly isValidGroup: (groupId: number) => boolean
  private readonly removeFromOwner: () => void
  private readonly lifecycleController = new AbortController()
  private readonly totals: StreamTotals = {
    bytesReceived: 0n,
    framesDecoded: 0n,
    framesPlayed: 0n,
    underruns: 0,
  }

  private currentState: AudioStreamState = "initializing"
  private generation = 0
  private nativeStream: NativeStreamRef | null = null
  private sessionStats: NativeAudioStreamStats | null = null
  private activeController: AbortController | null = null
  private activeSourceCleanup: (() => unknown) | null = null
  private reconnectAttempts = 0
  private consecutiveReconnectAttempts = 0
  private decoderReadyGeneration = 0
  private pendingReconnectAfterEnd: PendingReconnectAfterEnd | null = null
  private terminal = false
  private disposed = false
  private exposed = false
  private setupSettled = false
  private terminalError: Error | null = null
  private pendingEnded = false
  private setupResolve!: () => void
  private setupReject!: (error: Error) => void
  private closedResolve!: () => void
  private readonly setupPromise: Promise<void>
  private lastSampleRate: number
  private lastChannels = 0
  private lastBufferedFrames = 0
  private lastCapacityFrames: number
  private volume: number
  private pan: number
  private groupId: number
  private readonly overallAbortListener: () => void

  static {
    createAudioStream = (init) => new AudioStream(init)
    openAudioStream = (stream) => stream.open()
  }

  private constructor(init: AudioStreamInit) {
    super()
    this.lib = init.lib
    this.engine = init.engine
    this.source = init.source
    this.urlSource = init.urlSource
    this.options = resolveAudioStreamOptions(init.options, init.sampleRate, init.urlSource)
    this.isValidGroup = init.isValidGroup
    this.removeFromOwner = init.removeFromOwner
    this.lastSampleRate = init.sampleRate
    this.lastCapacityFrames = this.options.pcmCapacityFrames
    this.volume = this.options.volume
    this.pan = this.options.pan
    this.groupId = this.options.groupId
    this.setupPromise = new Promise((resolve, reject) => {
      this.setupResolve = resolve
      this.setupReject = reject
    })
    this.closed = new Promise((resolve) => {
      this.closedResolve = resolve
    })
    this.overallAbortListener = () => this.dispose()
    this.options.signal?.addEventListener("abort", this.overallAbortListener, { once: true })
  }

  get state(): AudioStreamState {
    return this.currentState
  }

  private async open(): Promise<void> {
    if (this.options.signal?.aborted) {
      this.dispose()
    } else if (this.urlSource) {
      void this.connectUrl().catch((cause) => {
        const error = new AudioStreamOperationError("Audio stream fetch failed", { action: "fetch" }, cause)
        void this.fail(error, error.context)
      })
    } else {
      this.connectBody()
    }

    await this.setupPromise
    if (this.terminal && this.currentState !== "ended") throw this.terminalError ?? createAbortError()

    this.exposed = true
    if (this.pendingEnded) this.emitAsync("ended")
    this.pendingEnded = false
  }

  getStats(): AudioStreamStats {
    const native = this.readCurrentStats()
    if (native == null) return this.toPublicStats(null)

    const state = NATIVE_STREAM_STATES[native.state] ?? null
    if (state != null && state !== "initializing" && !this.terminal) this.currentState = state
    const stats = this.toPublicStats(native)
    const current = this.nativeStream
    if (!this.terminal && this.exposed && current != null) {
      const generation = current.generation
      if (state === "ended" || state === "errored" || state === "disposed" || state == null) {
        queueMicrotask(() => {
          if (!this.isCurrent(generation)) return
          if (state === "ended") return void this.finishEnded(generation)
          if (state === "errored" || state === "disposed") return void this.failDecoder(native)
          const context: AudioStreamErrorContext = { action: "stats" }
          void this.fail(
            new AudioStreamOperationError(`Unknown native audio stream state: ${native.state}`, context),
            context,
          )
        })
      }
    }
    return stats
  }

  setVolume(volume: number): boolean {
    if (!this.canControl()) return false
    const native = this.nativeStream
    if (native == null) {
      this.volume = volume
      return true
    }
    try {
      const status = this.lib.audioSetStreamVolume(this.engine, native.id, volume)
      if (status !== 0) {
        const context: AudioStreamErrorContext = { action: "setVolume", status }
        this.notifyError(new AudioStreamOperationError(`Audio stream setVolume failed: ${status}`, context), context)
        return false
      }
      this.volume = volume
      return true
    } catch (cause) {
      const context: AudioStreamErrorContext = { action: "setVolume" }
      this.notifyError(new AudioStreamOperationError("Audio stream setVolume failed", context, cause), context)
      return false
    }
  }

  setPan(pan: number): boolean {
    if (!this.canControl()) return false
    const native = this.nativeStream
    if (native == null) {
      this.pan = pan
      return true
    }
    try {
      const status = this.lib.audioSetStreamPan(this.engine, native.id, pan)
      if (status !== 0) {
        const context: AudioStreamErrorContext = { action: "setPan", status }
        this.notifyError(new AudioStreamOperationError(`Audio stream setPan failed: ${status}`, context), context)
        return false
      }
      this.pan = pan
      return true
    } catch (cause) {
      const context: AudioStreamErrorContext = { action: "setPan" }
      this.notifyError(new AudioStreamOperationError("Audio stream setPan failed", context, cause), context)
      return false
    }
  }

  setGroup(groupId: number): boolean {
    if (!this.canControl()) return false
    const native = this.nativeStream
    if (native == null) {
      if (!this.isValidGroup(groupId)) {
        const context: AudioStreamErrorContext = { action: "setGroup" }
        this.notifyError(new AudioStreamOperationError(`Invalid audio stream group: ${groupId}`, context), context)
        return false
      }
      this.groupId = groupId
      return true
    }
    try {
      const status = this.lib.audioSetStreamGroup(this.engine, native.id, groupId)
      if (status !== 0) {
        const context: AudioStreamErrorContext = { action: "setGroup", status }
        this.notifyError(new AudioStreamOperationError(`Audio stream setGroup failed: ${status}`, context), context)
        return false
      }
      this.groupId = groupId
      return true
    } catch (cause) {
      const context: AudioStreamErrorContext = { action: "setGroup" }
      this.notifyError(new AudioStreamOperationError("Audio stream setGroup failed", context, cause), context)
      return false
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const wasExposed = this.exposed

    let cleanup = Promise.resolve()
    if (!this.terminal) {
      this.terminal = true
      this.generation += 1
      this.pendingReconnectAfterEnd = null
      this.lifecycleController.abort()
      cleanup = this.stopActiveConnection()
      if (!this.setupSettled) this.rejectSetup(createAbortError())
      this.removeOwner()
    }

    this.currentState = "disposed"
    if (!wasExposed) this.pendingEnded = false
    void cleanup.finally(() => {
      this.closedResolve()
      if (wasExposed) this.emitAsync("disposed")
    })
  }

  private canControl(): boolean {
    return !this.disposed && !this.terminal
  }

  private connectBody(): void {
    if (this.terminal) return
    const generation = this.beginConnection()
    if (!this.createNativeStream(generation)) return
    void this.waitForDecoderReady(generation)
    this.startSourcePump(this.source as ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>, generation, false)
  }

  private async connectUrl(): Promise<void> {
    if (this.terminal) return
    const generation = this.beginConnection()
    const controller = this.activeController
    if (controller == null) return

    let response: Response
    try {
      response = await globalThis.fetch(this.source as string | URL, {
        ...this.options.request,
        signal: controller.signal,
      })
    } catch (cause) {
      if (!this.isCurrent(generation) || controller.signal.aborted) return
      const context: AudioStreamErrorContext = { action: "fetch", attempt: this.consecutiveReconnectAttempts }
      const error = new AudioStreamOperationError("Audio stream fetch failed", context, cause)
      await this.handleConnectionFailure(generation, error, context, true)
      return
    }

    if (!this.isCurrent(generation)) return
    if (!response.ok) {
      await runBoundedCleanup(() => response.body?.cancel())
      const context: AudioStreamErrorContext = {
        action: "response",
        status: response.status,
        attempt: this.consecutiveReconnectAttempts,
      }
      const error = new AudioStreamOperationError(`Audio stream request failed with HTTP ${response.status}`, context)
      await this.handleConnectionFailure(
        generation,
        error,
        context,
        isRetryableHttpStatus(response.status),
        parseRetryAfter(response.headers.get("retry-after"), this.options.reconnect?.maxDelayMs ?? 15_000),
      )
      return
    }

    const contentType = response.headers.get("content-type")
    if (contentType != null && !isAllowedMp3ContentType(contentType)) {
      await runBoundedCleanup(() => response.body?.cancel())
      const context: AudioStreamErrorContext = { action: "response", status: response.status }
      await this.fail(
        new AudioStreamOperationError(`Unsupported audio stream Content-Type: ${contentType}`, context),
        context,
      )
      return
    }
    if (response.body == null) {
      const context: AudioStreamErrorContext = { action: "response", status: response.status }
      const error = new AudioStreamOperationError("Audio stream response has no body", context)
      await this.handleConnectionFailure(generation, error, context, true)
      return
    }

    if (this.nativeStream == null) {
      if (!this.createNativeStream(generation)) return
    } else {
      this.nativeStream.generation = generation
    }
    void this.waitForDecoderReady(generation)
    this.startSourcePump(response.body, generation, true)
  }

  private beginConnection(): number {
    const generation = ++this.generation
    this.activeController = new AbortController()
    return generation
  }

  private createNativeStream(generation: number): boolean {
    if (!this.isCurrent(generation)) return false
    try {
      const result = this.lib.audioCreateStream(this.engine, {
        inputCapacityBytes: this.options.inputCapacityBytes,
        pcmCapacityFrames: this.options.pcmCapacityFrames,
        startupFrames: this.options.startupFrames,
        resumeFrames: this.options.resumeFrames,
        volume: this.volume,
        pan: this.pan,
        groupId: this.groupId,
      })
      if (result.status !== 0 || result.streamId == null) {
        const context: AudioStreamErrorContext = { action: "create", status: result.status }
        void this.fail(new AudioStreamOperationError(`Audio stream create failed: ${result.status}`, context), context)
        return false
      }
      this.nativeStream = { generation, id: result.streamId }
      this.sessionStats = null
      return true
    } catch (cause) {
      const context: AudioStreamErrorContext = { action: "create" }
      void this.fail(new AudioStreamOperationError("Audio stream create failed", context, cause), context)
      return false
    }
  }

  private waitForDecoderReady(generation: number): Promise<void> {
    return this.pollNativeState(generation, false)
  }

  private waitForNativeEnd(generation: number): Promise<void> {
    return this.pollNativeState(generation, true)
  }

  private async pollNativeState(generation: number, waitForEnd: boolean): Promise<void> {
    while (this.isCurrent(generation)) {
      const stats = this.readCurrentStats(false)
      if (stats == null) {
        const context: AudioStreamErrorContext = { action: "stats" }
        await this.fail(new AudioStreamOperationError("Audio stream stats failed", context), context)
        return
      }
      const state = NATIVE_STREAM_STATES[stats.state] ?? null
      if (state == null) {
        const context: AudioStreamErrorContext = { action: "stats" }
        await this.fail(
          new AudioStreamOperationError(`Unknown native audio stream state: ${stats.state}`, context),
          context,
        )
        return
      }
      if (state !== "initializing" && state !== "reconnecting") {
        if (state === "errored" || state === "disposed") {
          await this.failDecoder(stats)
          return
        }
        this.markDecoderReady(generation)
        this.currentState = state
        this.resolveSetup()
        if (state === "ended") {
          if (waitForEnd) await this.finishEnded(generation)
          return
        }
        if (!waitForEnd) return
      }
      try {
        await waitForDelay(STREAM_POLL_INTERVAL_MS, this.activeController?.signal ?? this.lifecycleController.signal)
      } catch {
        return
      }
    }
  }

  private async pumpSource(
    source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
    generation: number,
    retryableBody: boolean,
  ): Promise<void> {
    const controller = this.activeController
    if (controller == null) return

    let next: () => Promise<{ done?: boolean; value?: unknown }>
    let release: () => void
    let cancel: () => unknown
    if (isReadableStreamSource(source)) {
      const reader = source.getReader()
      let released = false
      release = () => {
        if (released) return
        try {
          reader.releaseLock()
          released = true
        } catch {}
      }
      next = () => reader.read()
      cancel = () => {
        let result: Promise<void>
        try {
          result = reader.cancel(createAbortError())
        } catch (error) {
          release()
          throw error
        }
        void result.then(release, release)
        release()
        return result
      }
    } else {
      const iterator = source[Symbol.asyncIterator]()
      let released = false
      release = () => {
        released = true
      }
      next = () => iterator.next()
      cancel = () => {
        if (released) return
        released = true
        return iterator.return?.()
      }
    }

    const cleanup = (): unknown => cancel()
    if (!this.setSourceCleanup(generation, cleanup)) {
      await runBoundedCleanup(cleanup)
      return
    }

    try {
      while (this.isCurrent(generation)) {
        const result = await next()
        if (!this.isCurrent(generation)) return
        if (result.done) {
          release()
          this.clearSourceCleanup(cleanup)
          await this.handleSourceEnd(generation)
          return
        }
        const chunk = result.value
        if (!(chunk instanceof Uint8Array)) {
          const context: AudioStreamErrorContext = { action: "source" }
          await this.fail(new TypeError("Audio stream chunks must be Uint8Array instances"), context)
          return
        }
        if (chunk.byteLength === 0) {
          await waitForDelay(0, controller.signal)
          continue
        }

        let offset = 0
        while (offset < chunk.byteLength && this.isCurrent(generation)) {
          const native = this.nativeStream
          if (native == null || native.generation !== generation) return
          let writeResult: { status: number; bytesWritten: number }
          try {
            writeResult = this.lib.audioWriteStream(this.engine, native.id, chunk.subarray(offset))
          } catch (cause) {
            const context: AudioStreamErrorContext = { action: "write" }
            await this.fail(new AudioStreamOperationError("Audio stream write failed", context, cause), context)
            return
          }
          if (writeResult.status !== 0) {
            const context: AudioStreamErrorContext = { action: "write", status: writeResult.status }
            await this.fail(
              new AudioStreamOperationError(`Audio stream write failed: ${writeResult.status}`, context),
              context,
            )
            return
          }
          const remaining = chunk.byteLength - offset
          if (
            !Number.isInteger(writeResult.bytesWritten) ||
            writeResult.bytesWritten < 0 ||
            writeResult.bytesWritten > remaining
          ) {
            const context: AudioStreamErrorContext = { action: "write" }
            await this.fail(
              new AudioStreamOperationError("Audio stream write returned an invalid byte count", context),
              context,
            )
            return
          }
          if (writeResult.bytesWritten === 0) {
            await waitForDelay(STREAM_POLL_INTERVAL_MS, controller.signal)
            continue
          }
          offset += writeResult.bytesWritten
        }
      }
    } catch (cause) {
      if (!this.isCurrent(generation) || controller.signal.aborted) return
      const context: AudioStreamErrorContext = { action: retryableBody ? "fetch" : "source" }
      const error = new AudioStreamOperationError("Audio stream source failed", context, cause)
      await this.handleConnectionFailure(generation, error, context, retryableBody)
    } finally {
      release()
      this.clearSourceCleanup(cleanup)
    }
  }

  private startSourcePump(
    source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
    generation: number,
    retryableBody: boolean,
  ): void {
    void this.pumpSource(source, generation, retryableBody).catch(async (cause) => {
      if (!this.isCurrent(generation)) return
      const context: AudioStreamErrorContext = { action: retryableBody ? "fetch" : "source" }
      const error = new AudioStreamOperationError("Audio stream source failed", context, cause)
      await this.handleConnectionFailure(generation, error, context, retryableBody)
    })
  }

  private async handleSourceEnd(generation: number): Promise<void> {
    if (!this.isCurrent(generation)) return
    const native = this.nativeStream
    if (native == null || native.generation !== generation) return
    if (this.urlSource && this.options.reconnect?.retryOnEnd) {
      const context: AudioStreamErrorContext = { action: "source" }
      this.pendingReconnectAfterEnd = {
        generation,
        context,
        error: new AudioStreamOperationError("Audio stream response ended", context),
      }
    }
    try {
      const status = this.lib.audioEndStream(this.engine, native.id)
      if (status !== 0) {
        this.pendingReconnectAfterEnd = null
        const context: AudioStreamErrorContext = { action: "end", status }
        await this.fail(new AudioStreamOperationError(`Audio stream end failed: ${status}`, context), context)
        return
      }
    } catch (cause) {
      this.pendingReconnectAfterEnd = null
      const context: AudioStreamErrorContext = { action: "end" }
      await this.fail(new AudioStreamOperationError("Audio stream end failed", context, cause), context)
      return
    }
    await this.waitForNativeEnd(generation)
  }

  private async handleConnectionFailure(
    generation: number,
    error: Error,
    context: AudioStreamErrorContext,
    retryable: boolean,
    retryAfterMs?: number,
  ): Promise<void> {
    if (!this.isCurrent(generation)) return
    const nativeStats = this.readCurrentStats()
    if (nativeStats?.state === NativeAudioStreamState.Failed) {
      const decoderContext: AudioStreamErrorContext = {
        action: "decoder",
        errorCode: nativeStats.errorCode,
      }
      await this.fail(
        new AudioStreamOperationError(`Audio stream decoder failed: ${nativeStats.errorCode}`, decoderContext),
        decoderContext,
      )
      return
    }
    const reconnect = this.options.reconnect
    if (!retryable || reconnect == null || this.consecutiveReconnectAttempts >= reconnect.maxAttempts) {
      await this.fail(error, context)
      return
    }

    const restartNative =
      this.nativeStream != null &&
      nativeStats != null &&
      (nativeStats.state === NativeAudioStreamState.Initializing ||
        nativeStats.state === NativeAudioStreamState.Buffering ||
        nativeStats.state === NativeAudioStreamState.Playing ||
        nativeStats.state === NativeAudioStreamState.Reconnecting)

    this.generation += 1
    this.activeController?.abort()
    this.activeController = null
    const transitionResult = restartNative ? this.restartCurrentNative() : this.destroyCurrentNative()
    const cleanup = this.takeSourceCleanup()
    await cleanup
    if (transitionResult.status !== 0) {
      const action: AudioStreamAction = restartNative ? "restart" : "destroy"
      const transitionContext: AudioStreamErrorContext = { action, status: transitionResult.status }
      await this.fail(
        new AudioStreamOperationError(
          `Audio stream ${action} failed during reconnect`,
          transitionContext,
          transitionResult.cause,
        ),
        transitionContext,
      )
      return
    }
    if (this.terminal) return

    this.reconnectAttempts += 1
    this.consecutiveReconnectAttempts += 1
    const exponentialDelay = Math.min(
      reconnect.maxDelayMs,
      reconnect.initialDelayMs * reconnect.backoffFactor ** (this.consecutiveReconnectAttempts - 1),
    )
    const delayMs = retryAfterMs ?? exponentialDelay
    this.currentState = "reconnecting"
    const reconnectEvent: AudioStreamReconnectEvent = {
      attempt: this.consecutiveReconnectAttempts,
      delayMs,
      maxAttempts: reconnect.maxAttempts,
      error,
    }
    if (this.exposed) this.emitAsync("reconnecting", reconnectEvent)

    try {
      await waitForDelay(delayMs, this.lifecycleController.signal)
    } catch {
      return
    }
    if (!this.terminal) await this.connectUrl()
  }

  private async finishEnded(generation: number): Promise<void> {
    if (!this.isCurrent(generation) || this.terminal) return
    const pendingReconnect = this.pendingReconnectAfterEnd
    if (pendingReconnect?.generation === generation) {
      this.pendingReconnectAfterEnd = null
      await this.handleConnectionFailure(generation, pendingReconnect.error, pendingReconnect.context, true)
      return
    }

    this.terminal = true
    this.generation += 1
    this.pendingReconnectAfterEnd = null
    this.lifecycleController.abort()
    this.activeController?.abort()
    this.activeController = null
    const cleanup = this.takeSourceCleanup()
    const destroyResult = this.destroyCurrentNative()

    let failure: { error: Error; context: AudioStreamErrorContext } | null = null
    if (destroyResult.status !== 0) {
      const context: AudioStreamErrorContext = { action: "destroy", status: destroyResult.status }
      const error = new AudioStreamOperationError("Audio stream destroy failed after end", context, destroyResult.cause)
      failure = { error, context }
      this.currentState = "errored"
      this.terminalError = error
      this.rejectSetup(error)
    } else {
      this.currentState = "ended"
      this.resolveSetup()
    }
    await cleanup
    this.removeOwner()
    this.closedResolve()
    if (failure != null) {
      this.notifyError(failure.error, failure.context)
    } else {
      this.notifyEnded()
    }
  }

  private async fail(error: Error, context: AudioStreamErrorContext): Promise<void> {
    if (this.terminal) return
    this.terminal = true
    this.terminalError = error
    this.generation += 1
    this.pendingReconnectAfterEnd = null
    this.lifecycleController.abort()
    this.activeController?.abort()
    this.activeController = null
    const cleanup = this.takeSourceCleanup()
    this.destroyCurrentNative()
    this.currentState = "errored"
    await cleanup

    if (!this.setupSettled) this.rejectSetup(error)
    this.removeOwner()
    this.closedResolve()
    this.notifyError(error, context)
  }

  private async failDecoder(stats: NativeAudioStreamStats): Promise<void> {
    const context: AudioStreamErrorContext = { action: "decoder", errorCode: stats.errorCode }
    const message =
      stats.state === NativeAudioStreamState.Failed
        ? `Audio stream decoder failed: ${stats.errorCode}`
        : "Audio stream was cancelled by the decoder"
    await this.fail(new AudioStreamOperationError(message, context), context)
  }

  private markDecoderReady(generation: number): void {
    if (this.decoderReadyGeneration === generation) return
    this.decoderReadyGeneration = generation
    this.consecutiveReconnectAttempts = 0
  }

  private resolveSetup(): void {
    if (this.setupSettled) return
    this.setupSettled = true
    this.setupResolve()
  }

  private rejectSetup(error: Error): void {
    if (this.setupSettled) return
    this.setupSettled = true
    this.terminalError = error
    this.setupReject(error)
  }

  private notifyEnded(): void {
    if (this.exposed) {
      this.emitAsync("ended")
    } else {
      this.pendingEnded = true
    }
  }

  private notifyError(error: Error, context: AudioStreamErrorContext): void {
    if (this.exposed) this.emitAsync("error", error, context)
  }

  private emitAsync<K extends keyof AudioStreamEvents>(event: K, ...args: AudioStreamEvents[K]): void {
    // Events are observational; listener failures must not stall lifecycle work or skip later listeners.
    setTimeout(() => {
      const listeners = this.rawListeners(event)
      for (const listener of listeners) {
        try {
          const result = Reflect.apply(listener, this, args) as unknown
          if (result && typeof (result as PromiseLike<unknown>).then === "function") {
            void Promise.resolve(result).catch(() => {})
          }
        } catch {}
      }
    }, 0)
  }

  private isCurrent(generation: number): boolean {
    return !this.terminal && this.generation === generation
  }

  private setSourceCleanup(generation: number, cleanup: () => unknown): boolean {
    if (!this.isCurrent(generation)) return false
    this.activeSourceCleanup = cleanup
    return true
  }

  private clearSourceCleanup(cleanup: () => unknown): void {
    if (this.activeSourceCleanup !== cleanup) return
    this.activeSourceCleanup = null
  }

  private takeSourceCleanup(): Promise<void> {
    if (this.activeSourceCleanup == null) return Promise.resolve()
    const cleanup = this.activeSourceCleanup
    this.activeSourceCleanup = null
    return runBoundedCleanup(cleanup)
  }

  private stopActiveConnection(): Promise<void> {
    this.activeController?.abort()
    this.activeController = null
    const cleanup = this.takeSourceCleanup()
    // Source cancellation may synchronously dispose the owning Audio. A later
    // invalid-handle result is benign because engine teardown freed the stream.
    this.destroyCurrentNative()
    return cleanup
  }

  private destroyCurrentNative(): { status: number; cause?: unknown } {
    const native = this.nativeStream
    if (native == null) return { status: 0 }
    this.readCurrentStats()
    if (this.sessionStats != null) {
      this.totals.bytesReceived += this.sessionStats.bytesReceived
      this.totals.framesDecoded += this.sessionStats.framesDecoded
      this.totals.framesPlayed += this.sessionStats.framesPlayed
      this.totals.underruns += this.sessionStats.underruns
    }
    this.nativeStream = null
    this.sessionStats = null
    this.lastBufferedFrames = 0
    try {
      return { status: this.lib.audioDestroyStream(this.engine, native.id) }
    } catch (cause) {
      return { status: -1, cause }
    }
  }

  private restartCurrentNative(): { status: number; cause?: unknown } {
    const native = this.nativeStream
    if (native == null) return { status: -1 }
    try {
      return { status: this.lib.audioRestartStream(this.engine, native.id) }
    } catch (cause) {
      return { status: -1, cause }
    }
  }

  private readCurrentStats(useCached = true): NativeAudioStreamStats | null {
    const native = this.nativeStream
    if (native == null) return null
    try {
      const stats = this.lib.audioGetStreamStats(this.engine, native.id)
      if (stats != null) this.updateNativeStats(stats)
      return stats
    } catch {
      return useCached ? this.sessionStats : null
    }
  }

  private updateNativeStats(stats: NativeAudioStreamStats): void {
    this.sessionStats = stats
    this.lastSampleRate = stats.sampleRate
    this.lastChannels = stats.channels
    this.lastBufferedFrames = stats.bufferedFrames
    this.lastCapacityFrames = stats.capacityFrames
  }

  private toPublicStats(native: NativeAudioStreamStats | null): AudioStreamStats {
    const sampleRate = native?.sampleRate ?? this.lastSampleRate
    const bufferedFrames = native?.bufferedFrames ?? this.lastBufferedFrames
    return {
      state: this.currentState,
      sampleRate,
      channels: native?.channels ?? this.lastChannels,
      bufferedFrames,
      capacityFrames: native?.capacityFrames ?? this.lastCapacityFrames,
      bufferedDurationMs: sampleRate > 0 ? (bufferedFrames * 1000) / sampleRate : 0,
      bytesReceived: this.totals.bytesReceived + (native?.bytesReceived ?? 0n),
      framesDecoded: this.totals.framesDecoded + (native?.framesDecoded ?? 0n),
      framesPlayed: this.totals.framesPlayed + (native?.framesPlayed ?? 0n),
      underruns: this.totals.underruns + (native?.underruns ?? 0),
      reconnectAttempts: this.reconnectAttempts,
    }
  }

  private removeOwner(): void {
    this.options.signal?.removeEventListener("abort", this.overallAbortListener)
    this.removeFromOwner()
  }
}

export class Audio extends EventEmitter<AudioEvents> {
  static create(options: AudioSetupOptions = {}): Audio {
    let lib: RenderLib
    try {
      lib = resolveRenderLib()
    } catch (cause) {
      throw new AudioInitializationError(
        "resolveRenderLib",
        "Failed to resolve the native audio library",
        undefined,
        cause,
      )
    }
    return new Audio(lib, options)
  }

  readonly sampleRate: number

  private readonly lib: RenderLib
  private readonly defaultStartOptions: AudioStartOptions | undefined
  private engine: AudioEngineHandle | null = null
  private readonly groups = new Map<string, number>()
  private readonly streams = new Set<AudioStream>()
  private playbackStarted = false
  private mixerStarted = false

  private constructor(lib: RenderLib, options: AudioSetupOptions) {
    super()
    this.lib = lib
    this.defaultStartOptions = options.startOptions
    const normalizedSampleRate =
      options.sampleRate == null || !Number.isFinite(options.sampleRate)
        ? 0
        : Math.min(MAX_U32, Math.max(0, Math.trunc(options.sampleRate)))
    this.sampleRate = normalizedSampleRate || DEFAULT_AUDIO_SAMPLE_RATE
    const createOptions =
      options.sampleRate == null && options.playbackChannels == null
        ? undefined
        : {
            sampleRate: options.sampleRate == null ? undefined : normalizedSampleRate,
            playbackChannels:
              options.playbackChannels == null ? undefined : Math.max(0, Math.trunc(options.playbackChannels)),
          }
    try {
      this.engine = this.lib.createAudioEngine(createOptions)
    } catch (cause) {
      throw new AudioInitializationError("createAudioEngine", "Audio engine creation failed", undefined, cause)
    }
    if (!this.engine) {
      throw new AudioInitializationError("createAudioEngine", "Audio createAudioEngine returned null")
    }

    if (options.autoStart ?? false) {
      let status: number
      try {
        status = this.lib.audioStart(this.engine, this.defaultStartOptions)
      } catch (cause) {
        this.throwAfterInitializationCleanup(
          new AudioInitializationError("start", "Audio auto-start failed", undefined, cause),
        )
      }
      if (status !== 0) {
        this.throwAfterInitializationCleanup(
          new AudioInitializationError("start", `Audio auto-start failed: ${status}`, status),
        )
      }
      this.playbackStarted = true
      this.mixerStarted = true
    }
  }

  private throwAfterInitializationCleanup(error: AudioInitializationError): never {
    const engine = this.engine
    this.engine = null
    if (engine) {
      try {
        this.lib.destroyAudioEngine(engine)
      } catch (cleanupCause) {
        throw new AudioInitializationError(
          error.action,
          error.message,
          error.status,
          new AggregateError([error, cleanupCause], "Audio initialization and cleanup failed"),
        )
      }
    }
    throw error
  }

  private emitError(action: AudioAction, status?: number, message?: string, cause?: unknown): void {
    const error = message ? new Error(message) : statusToError(action, status ?? -1)
    if (cause) (error as Error & { cause?: unknown }).cause = cause
    this.emit("error", error, { action, status })
  }

  private isValidGroup(groupId: number): boolean {
    if (groupId === 0) return true
    for (const cachedGroupId of this.groups.values()) {
      if (cachedGroupId === groupId) return true
    }
    return false
  }

  start(options?: AudioStartOptions): boolean {
    if (this.playbackStarted) return true
    const engine = this.engine
    if (!engine) {
      this.emitError("start", undefined, "Audio engine unavailable during start")
      return false
    }
    const startOptions = options ?? this.defaultStartOptions
    const status = this.lib.audioStart(engine, startOptions)
    if (status !== 0) {
      this.emitError("start", status)
      return false
    }
    this.playbackStarted = true
    this.mixerStarted = true
    this.emit("started")
    return true
  }

  startMixer(): boolean {
    if (this.mixerStarted) return true
    const engine = this.engine
    if (!engine) {
      this.emitError("startMixer", undefined, "Audio engine unavailable during startMixer")
      return false
    }
    const status = this.lib.audioStartMixer(engine)
    if (status !== 0) {
      this.emitError("startMixer", status)
      return false
    }
    this.mixerStarted = true
    this.emit("mixerStarted")
    return true
  }

  stop(): boolean {
    if (!this.mixerStarted) return true
    const engine = this.engine
    if (!engine) {
      this.emitError("stop", undefined, "Audio engine unavailable during stop")
      return false
    }
    const status = this.lib.audioStop(engine)
    if (status !== 0) {
      this.emitError("stop", status)
      return false
    }
    this.playbackStarted = false
    this.mixerStarted = false
    this.emit("stopped")
    return true
  }

  isStarted(): boolean {
    return this.playbackStarted
  }

  isMixerStarted(): boolean {
    return this.mixerStarted
  }

  loadSound(data: Uint8Array | ArrayBuffer): AudioSound | null {
    const engine = this.engine
    if (!engine) {
      this.emitError("loadSound", undefined, "Audio engine unavailable during loadSound")
      return null
    }
    const result = this.lib.audioLoad(engine, toBytes(data))
    if (result.status !== 0 || result.soundId == null) {
      this.emitError("loadSound", result.status)
      return null
    }
    return result.soundId
  }

  async loadSoundFile(filePath: string): Promise<AudioSound | null> {
    const bytes = await readFile(filePath).catch((err) => {
      this.emitError("loadSoundFile", undefined, `Failed to read file '${filePath}': ${err.message}`, err)
      return null
    })
    if (bytes == null) return null
    return this.loadSound(bytes)
  }

  unloadSound(sound: AudioSound): boolean {
    const engine = this.engine
    if (!engine) {
      this.emitError("unloadSound", undefined, "Audio engine unavailable during unloadSound")
      return false
    }

    const status = this.lib.audioUnload(engine, sound)
    if (status !== 0) {
      this.emitError("unloadSound", status)
      return false
    }
    return true
  }

  group(name: string): AudioGroup | null {
    const existing = this.groups.get(name)
    if (existing != null) {
      return existing
    }

    const engine = this.engine
    if (!engine) {
      this.emitError("group", undefined, "Audio engine unavailable during group")
      return null
    }
    const result = this.lib.audioCreateGroup(engine, name)
    if (result.status !== 0 || result.groupId == null) {
      this.emitError("group", result.status)
      return null
    }

    this.groups.set(name, result.groupId)
    return result.groupId
  }

  play(sound: AudioSound, options?: AudioPlayOptions): AudioVoice | null {
    const rawOptions = options
      ? {
          volume: options.volume,
          pan: options.pan,
          loop: options.loop,
          groupId: options.groupId ?? 0,
        }
      : undefined

    const engine = this.engine
    if (!engine) {
      this.emitError("play", undefined, "Audio engine unavailable during play")
      return null
    }
    const result = this.lib.audioPlay(engine, sound, rawOptions)
    if (result.status !== 0 || result.voiceId == null) {
      this.emitError("play", result.status)
      return null
    }

    return result.voiceId
  }

  playStream(source: string | URL, options?: AudioStreamUrlOptions): Promise<AudioStream>
  playStream(
    source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
    options?: AudioStreamBodyOptions,
  ): Promise<AudioStream>
  async playStream(
    source: AudioStreamSource,
    options: AudioStreamUrlOptions | AudioStreamBodyOptions = {},
  ): Promise<AudioStream> {
    const engine = this.engine
    if (!engine) throw new Error("Audio engine unavailable during playStream")

    const urlSource = typeof source === "string" || source instanceof URL
    if (!urlSource && !isReadableStreamSource(source) && !isAsyncIterableSource(source)) {
      throw new TypeError("Audio stream source must be a URL, ReadableStream, or AsyncIterable")
    }

    let stream: AudioStream
    stream = createAudioStream({
      lib: this.lib,
      engine,
      sampleRate: this.sampleRate,
      source,
      options,
      urlSource,
      isValidGroup: (groupId) => this.isValidGroup(groupId),
      removeFromOwner: () => this.streams.delete(stream),
    })
    this.streams.add(stream)
    try {
      await openAudioStream(stream)
      return stream
    } catch (error) {
      stream.dispose()
      throw error
    }
  }

  stopVoice(voice: AudioVoice): boolean {
    const engine = this.engine
    if (!engine) {
      this.emitError("stopVoice", undefined, "Audio engine unavailable during stopVoice")
      return false
    }
    const status = this.lib.audioStopVoice(engine, voice)
    if (status !== 0) {
      this.emitError("stopVoice", status)
      return false
    }
    return true
  }

  setVoiceGroup(voice: AudioVoice, group: AudioGroup): boolean {
    const engine = this.engine
    if (!engine) {
      this.emitError("setVoiceGroup", undefined, "Audio engine unavailable during setVoiceGroup")
      return false
    }
    const status = this.lib.audioSetVoiceGroup(engine, voice, group)
    if (status !== 0) {
      this.emitError("setVoiceGroup", status)
      return false
    }
    return true
  }

  setGroupVolume(group: AudioGroup, volume: number): boolean {
    const engine = this.engine
    if (!engine) {
      this.emitError("setGroupVolume", undefined, "Audio engine unavailable during setGroupVolume")
      return false
    }
    const status = this.lib.audioSetGroupVolume(engine, group, volume)
    if (status !== 0) {
      this.emitError("setGroupVolume", status)
      return false
    }
    return true
  }

  setMasterVolume(volume: number): boolean {
    const engine = this.engine
    if (!engine) {
      this.emitError("setMasterVolume", undefined, "Audio engine unavailable during setMasterVolume")
      return false
    }
    const status = this.lib.audioSetMasterVolume(engine, volume)
    if (status !== 0) {
      this.emitError("setMasterVolume", status)
      return false
    }
    return true
  }

  mixFrames(frameCount: number, channels: number = 2): Float32Array | null {
    const engine = this.engine
    if (!engine) {
      this.emitError("mixFrames", undefined, "Audio engine unavailable during mixFrames")
      return null
    }
    const output = new Float32Array(frameCount * channels)
    const status = this.lib.audioMixToBuffer(engine, output, frameCount, channels)
    if (status !== 0) {
      this.emitError("mixFrames", status)
      return null
    }
    return output
  }

  enableTap(capacityFrames: number = 8192): boolean {
    const engine = this.engine
    if (!engine) {
      this.emitError("enableTap", undefined, "Audio engine unavailable during enableTap")
      return false
    }
    const status = this.lib.audioEnableTap(engine, true, capacityFrames)
    if (status !== 0) {
      this.emitError("enableTap", status)
      return false
    }
    return true
  }

  disableTap(): boolean {
    const engine = this.engine
    if (!engine) {
      this.emitError("enableTap", undefined, "Audio engine unavailable during disableTap")
      return false
    }
    const status = this.lib.audioEnableTap(engine, false, 0)
    if (status !== 0) {
      this.emitError("enableTap", status)
      return false
    }
    return true
  }

  readTapFrames(frameCount: number, channels: number = 2): { frames: Float32Array; framesRead: number } | null {
    const engine = this.engine
    if (!engine) {
      this.emitError("readTapFrames", undefined, "Audio engine unavailable during readTapFrames")
      return null
    }
    const output = new Float32Array(frameCount * channels)
    const result = this.lib.audioReadTap(engine, output, frameCount, channels)
    if (result.status !== 0) {
      this.emitError("readTapFrames", result.status)
      return null
    }
    return { frames: output, framesRead: result.framesRead }
  }

  listPlaybackDevices(): AudioPlaybackDevice[] | null {
    const engine = this.engine
    if (!engine) {
      this.emitError("listPlaybackDevices", undefined, "Audio engine unavailable during listPlaybackDevices")
      return null
    }

    const refreshStatus = this.lib.audioRefreshPlaybackDevices(engine)
    if (refreshStatus !== 0) {
      this.emitError("listPlaybackDevices", refreshStatus)
      return null
    }

    const count = this.lib.audioGetPlaybackDeviceCount(engine)
    const devices: AudioPlaybackDevice[] = []
    for (let index = 0; index < count; index += 1) {
      devices.push({
        index,
        name: this.lib.audioGetPlaybackDeviceName(engine, index),
        isDefault: this.lib.audioIsPlaybackDeviceDefault(engine, index),
      })
    }

    return devices
  }

  selectPlaybackDevice(index: number): boolean {
    const engine = this.engine
    if (!engine) {
      this.emitError("selectPlaybackDevice", undefined, "Audio engine unavailable during selectPlaybackDevice")
      return false
    }

    const refreshStatus = this.lib.audioRefreshPlaybackDevices(engine)
    if (refreshStatus !== 0) {
      this.emitError("selectPlaybackDevice", refreshStatus)
      return false
    }

    const status = this.lib.audioSelectPlaybackDevice(engine, index)
    if (status !== 0) {
      this.emitError("selectPlaybackDevice", status)
      return false
    }

    return true
  }

  clearPlaybackDeviceSelection(): void {
    const engine = this.engine
    if (!engine) {
      this.emitError(
        "clearPlaybackDeviceSelection",
        undefined,
        "Audio engine unavailable during clearPlaybackDeviceSelection",
      )
      return
    }
    this.lib.audioClearPlaybackDeviceSelection(engine)
  }

  getStats(): AudioStats | null {
    const engine = this.engine
    if (!engine) {
      this.emitError("getStats", undefined, "Audio engine unavailable during getStats")
      return null
    }
    const stats = this.lib.audioGetStats(engine)
    if (stats == null) {
      this.emitError("getStats", undefined, "Failed to retrieve audio stats")
    }
    return stats
  }

  dispose(): void {
    if (!this.engine) return
    for (const stream of [...this.streams]) stream.dispose()
    if (this.mixerStarted) {
      this.stop()
    }
    this.groups.clear()
    this.lib.destroyAudioEngine(this.engine)
    this.engine = null
    this.emit("disposed")
  }
}

export function setupAudio(options: AudioSetupOptions = {}): Audio {
  return Audio.create(options)
}
