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
const INVALID_STREAM_CHUNK_MESSAGE = "Audio stream chunks must be Uint8Array instances"

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

interface AudioStreamAttempt {
  controller: AbortController
  cleanup: (() => unknown) | null
  fedBytes: boolean
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
  return new DOMException("The operation was aborted", "AbortError")
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

  private currentState: AudioStreamState = "initializing"
  private nativeStreamId: number | null = null
  private lastNativeStats: NativeAudioStreamStats | null = null
  private activeAttempt: AudioStreamAttempt | null = null
  private reconnectAttempts = 0
  private consecutiveReconnectAttempts = 0
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
  private readonly sampleRate: number
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
    this.sampleRate = init.sampleRate
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
    } else {
      void this.runLifecycle()
    }

    await this.setupPromise
    if (this.terminal && this.currentState !== "ended") throw this.terminalError ?? createAbortError()

    this.exposed = true
    if (this.pendingEnded) this.emitAsync("ended")
    this.pendingEnded = false
  }

  getStats(): AudioStreamStats {
    const native = this.readNativeStats()
    if (native == null) return this.toPublicStats(null)

    const state = NATIVE_STREAM_STATES[native.state] ?? null
    if (state != null && state !== "initializing" && !this.terminal) this.currentState = state
    const stats = this.toPublicStats(native)
    if (
      !this.terminal &&
      this.exposed &&
      this.nativeStreamId != null &&
      (state === "ended" || state === "errored" || state === "disposed" || state == null)
    ) {
      queueMicrotask(() => {
        if (this.terminal) return
        if (state === "ended" && !(this.urlSource && this.options.reconnect?.retryOnEnd)) {
          return void this.finishEnded()
        }
        if (state === "errored" || state === "disposed") return void this.failDecoder(native)
        if (state == null) {
          const context: AudioStreamErrorContext = { action: "stats" }
          void this.fail(
            new AudioStreamOperationError(`Unknown native audio stream state: ${native.state}`, context),
            context,
          )
        }
      })
    }
    return stats
  }

  setVolume(volume: number): boolean {
    return this.setControl("setVolume", volume)
  }

  setPan(pan: number): boolean {
    return this.setControl("setPan", pan)
  }

  setGroup(groupId: number): boolean {
    return this.setControl("setGroup", groupId)
  }

  private setControl(action: "setVolume" | "setPan" | "setGroup", value: number): boolean {
    if (!this.canControl()) return false
    if (action === "setGroup" && !this.isValidGroup(value)) {
      const context: AudioStreamErrorContext = { action }
      this.notifyError(new AudioStreamOperationError(`Invalid audio stream group: ${value}`, context), context)
      return false
    }
    const streamId = this.nativeStreamId!
    const status =
      action === "setVolume"
        ? this.lib.audioSetStreamVolume(this.engine, streamId, value)
        : action === "setPan"
          ? this.lib.audioSetStreamPan(this.engine, streamId, value)
          : this.lib.audioSetStreamGroup(this.engine, streamId, value)
    if (status !== 0) {
      const context: AudioStreamErrorContext = { action, status }
      this.notifyError(new AudioStreamOperationError(`Audio stream ${action} failed: ${status}`, context), context)
      return false
    }
    return true
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const wasExposed = this.exposed

    let cleanup = Promise.resolve()
    if (!this.terminal) {
      this.terminal = true
      this.lifecycleController.abort()
      cleanup = this.stopActiveAttempt()
      this.destroyNativeStream()
      this.rejectSetup(createAbortError())
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

  private async runLifecycle(): Promise<void> {
    try {
      if (this.urlSource) {
        await this.runUrlLifecycle()
      } else {
        await this.runBodyLifecycle()
      }
    } catch (cause) {
      if (this.terminal) return
      const context: AudioStreamErrorContext = {
        action: this.urlSource ? "fetch" : "source",
      }
      const error =
        cause instanceof AudioStreamOperationError
          ? cause
          : cause instanceof TypeError && cause.message === INVALID_STREAM_CHUNK_MESSAGE
            ? cause
            : new AudioStreamOperationError(`Audio stream ${context.action} failed`, context, cause)
      await this.fail(error, error instanceof AudioStreamOperationError ? error.context : context)
    }
  }

  private async runBodyLifecycle(): Promise<void> {
    const attempt = this.beginAttempt()
    this.createNativeStream()
    const decoderReady = this.pollNativeState(attempt, false)
    await this.pumpSource(this.source as ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>, attempt, false)
    if (this.terminal) {
      await decoderReady
      return
    }

    this.endNativeStream()
    await decoderReady
    if (this.terminal || !(await this.pollNativeState(attempt, true))) return
    await this.stopAttempt(attempt)
    await this.finishEnded()
  }

  private async runUrlLifecycle(): Promise<void> {
    while (!this.terminal) {
      const attempt = this.beginAttempt()
      let response: Response
      try {
        response = await globalThis.fetch(this.source as string | URL, {
          ...this.options.request,
          signal: attempt.controller.signal,
        })
      } catch (cause) {
        if (!this.isAttemptActive(attempt)) return
        const context: AudioStreamErrorContext = { action: "fetch", attempt: this.consecutiveReconnectAttempts }
        const error = new AudioStreamOperationError("Audio stream fetch failed", context, cause)
        await this.stopAttempt(attempt)
        if (await this.retry(error, context, true, false)) continue
        return
      }

      if (!this.isAttemptActive(attempt)) {
        await runBoundedCleanup(() => response.body?.cancel())
        return
      }
      if (!response.ok) {
        const retryAfterMs = parseRetryAfter(
          response.headers.get("retry-after"),
          this.options.reconnect?.maxDelayMs ?? 15_000,
        )
        await runBoundedCleanup(() => response.body?.cancel())
        await this.stopAttempt(attempt)
        const context: AudioStreamErrorContext = {
          action: "response",
          status: response.status,
          attempt: this.consecutiveReconnectAttempts,
        }
        const error = new AudioStreamOperationError(`Audio stream request failed with HTTP ${response.status}`, context)
        if (await this.retry(error, context, isRetryableHttpStatus(response.status), false, retryAfterMs)) continue
        return
      }

      const contentType = response.headers.get("content-type")
      if (contentType != null && !isAllowedMp3ContentType(contentType)) {
        await runBoundedCleanup(() => response.body?.cancel())
        await this.stopAttempt(attempt)
        const context: AudioStreamErrorContext = { action: "response", status: response.status }
        await this.fail(
          new AudioStreamOperationError(`Unsupported audio stream Content-Type: ${contentType}`, context),
          context,
        )
        return
      }
      if (response.body == null) {
        await this.stopAttempt(attempt)
        const context: AudioStreamErrorContext = { action: "response", status: response.status }
        const error = new AudioStreamOperationError("Audio stream response has no body", context)
        if (await this.retry(error, context, true, false)) continue
        return
      }

      attempt.cleanup = () => response.body?.cancel()
      if (this.nativeStreamId == null) this.createNativeStream()
      const decoderReady = this.pollNativeState(attempt, false)
      let sourceFailure: unknown
      try {
        await this.pumpSource(response.body, attempt, true)
      } catch (cause) {
        sourceFailure = cause
      }
      if (this.terminal) {
        await decoderReady
        return
      }
      if (sourceFailure != null) {
        await this.stopAttempt(attempt)
        await decoderReady
        if (this.terminal) return
        const context: AudioStreamErrorContext =
          sourceFailure instanceof AudioStreamOperationError ? sourceFailure.context : { action: "source" }
        const error =
          sourceFailure instanceof Error
            ? sourceFailure
            : new AudioStreamOperationError("Audio stream source failed", context, sourceFailure)
        if (context.action !== "fetch") {
          await this.fail(error, context)
          return
        }
        if (await this.retry(error, context, true, attempt.fedBytes)) continue
        return
      }

      this.endNativeStream()
      await decoderReady
      if (this.terminal || !(await this.pollNativeState(attempt, true))) return
      await this.stopAttempt(attempt)

      if (!this.options.reconnect?.retryOnEnd) {
        await this.finishEnded()
        return
      }
      const context: AudioStreamErrorContext = { action: "source" }
      const error = new AudioStreamOperationError("Audio stream response ended", context)
      if (await this.retry(error, context, true, true)) continue
      return
    }
  }

  private beginAttempt(): AudioStreamAttempt {
    const attempt: AudioStreamAttempt = { controller: new AbortController(), cleanup: null, fedBytes: false }
    this.activeAttempt = attempt
    return attempt
  }

  private createNativeStream(): void {
    if (this.terminal || this.nativeStreamId != null) return
    const result = this.lib.audioCreateStream(this.engine, {
      inputCapacityBytes: this.options.inputCapacityBytes,
      pcmCapacityFrames: this.options.pcmCapacityFrames,
      startupFrames: this.options.startupFrames,
      resumeFrames: this.options.resumeFrames,
      volume: this.options.volume,
      pan: this.options.pan,
      groupId: this.options.groupId,
    })
    if (result.status !== 0) {
      const context: AudioStreamErrorContext = { action: "create", status: result.status }
      throw new AudioStreamOperationError(`Audio stream create failed: ${result.status}`, context)
    }
    this.nativeStreamId = result.streamId!
  }

  private async pumpSource(
    source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
    attempt: AudioStreamAttempt,
    retryableBody: boolean,
  ): Promise<void> {
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
    if (!this.setAttemptCleanup(attempt, cleanup)) {
      await runBoundedCleanup(cleanup)
      return
    }

    try {
      while (this.isAttemptActive(attempt)) {
        const result = await next()
        if (!this.isAttemptActive(attempt)) return
        if (result.done) {
          release()
          this.clearAttemptCleanup(attempt, cleanup)
          return
        }
        const chunk = result.value
        if (!(chunk instanceof Uint8Array)) {
          throw new TypeError(INVALID_STREAM_CHUNK_MESSAGE)
        }
        if (chunk.byteLength === 0) {
          await waitForDelay(0, attempt.controller.signal)
          continue
        }

        let offset = 0
        while (offset < chunk.byteLength && this.isAttemptActive(attempt)) {
          const streamId = this.nativeStreamId
          if (streamId == null) return
          let writeResult: { status: number; bytesWritten: number }
          try {
            writeResult = this.lib.audioWriteStream(this.engine, streamId, chunk.subarray(offset))
          } catch (cause) {
            const context: AudioStreamErrorContext = { action: "write" }
            throw new AudioStreamOperationError("Audio stream write failed", context, cause)
          }
          if (writeResult.status !== 0) {
            const context: AudioStreamErrorContext = { action: "write", status: writeResult.status }
            throw new AudioStreamOperationError(`Audio stream write failed: ${writeResult.status}`, context)
          }
          if (writeResult.bytesWritten === 0) {
            await waitForDelay(STREAM_POLL_INTERVAL_MS, attempt.controller.signal)
            continue
          }
          attempt.fedBytes = true
          offset += writeResult.bytesWritten
        }
      }
    } catch (cause) {
      if (!this.isAttemptActive(attempt) || attempt.controller.signal.aborted) return
      if (
        cause instanceof AudioStreamOperationError ||
        (cause instanceof TypeError && cause.message === INVALID_STREAM_CHUNK_MESSAGE)
      ) {
        throw cause
      }
      const context: AudioStreamErrorContext = { action: retryableBody ? "fetch" : "source" }
      throw new AudioStreamOperationError("Audio stream source failed", context, cause)
    }
  }

  private endNativeStream(): void {
    const status = this.lib.audioEndStream(this.engine, this.nativeStreamId!)
    if (status !== 0) {
      const context: AudioStreamErrorContext = { action: "end", status }
      throw new AudioStreamOperationError(`Audio stream end failed: ${status}`, context)
    }
  }

  private async retry(
    error: Error,
    context: AudioStreamErrorContext,
    retryable: boolean,
    restartNative: boolean,
    retryAfterMs?: number,
  ): Promise<boolean> {
    if (this.terminal) return false
    const nativeStats = this.readNativeStats()
    if (nativeStats?.state === NativeAudioStreamState.Failed) {
      await this.failDecoder(nativeStats)
      return false
    }
    const reconnect = this.options.reconnect
    if (!retryable || reconnect == null || this.consecutiveReconnectAttempts >= reconnect.maxAttempts) {
      await this.fail(error, context)
      return false
    }

    if (restartNative && this.nativeStreamId != null) {
      const result = this.restartNativeStream()
      if (result.status !== 0) {
        const restartContext: AudioStreamErrorContext = { action: "restart", status: result.status }
        await this.fail(
          new AudioStreamOperationError("Audio stream restart failed during reconnect", restartContext),
          restartContext,
        )
        return false
      }
    }
    this.reconnectAttempts += 1
    this.consecutiveReconnectAttempts += 1
    const exponentialDelay = Math.min(
      reconnect.maxDelayMs,
      reconnect.initialDelayMs * reconnect.backoffFactor ** (this.consecutiveReconnectAttempts - 1),
    )
    const delayMs = retryAfterMs ?? exponentialDelay
    this.currentState = "reconnecting"
    if (this.exposed) {
      this.emitAsync("reconnecting", {
        attempt: this.consecutiveReconnectAttempts,
        delayMs,
        maxAttempts: reconnect.maxAttempts,
        error,
      })
    }

    try {
      await waitForDelay(delayMs, this.lifecycleController.signal)
      return !this.terminal
    } catch {
      return false
    }
  }

  private async pollNativeState(attempt: AudioStreamAttempt, waitForEnd: boolean): Promise<boolean> {
    while (this.isAttemptActive(attempt)) {
      const stats = this.readNativeStats(false)
      if (stats == null) {
        const context: AudioStreamErrorContext = { action: "stats" }
        await this.fail(new AudioStreamOperationError("Audio stream stats failed", context), context)
        return false
      }
      const state = NATIVE_STREAM_STATES[stats.state] ?? null
      if (state == null) {
        const context: AudioStreamErrorContext = { action: "stats" }
        await this.fail(
          new AudioStreamOperationError(`Unknown native audio stream state: ${stats.state}`, context),
          context,
        )
        return false
      }
      if (state === "errored" || state === "disposed") {
        await this.failDecoder(stats)
        return false
      }
      if (waitForEnd) {
        this.currentState = state
        if (state === "ended") return true
      } else if (state !== "initializing" && state !== "reconnecting") {
        this.consecutiveReconnectAttempts = 0
        this.currentState = state
        this.resolveSetup()
        return true
      }
      try {
        await waitForDelay(STREAM_POLL_INTERVAL_MS, attempt.controller.signal)
      } catch {
        return false
      }
    }
    return false
  }

  private async finishEnded(): Promise<void> {
    if (this.terminal) return
    this.terminal = true
    this.lifecycleController.abort()
    const cleanup = this.stopActiveAttempt()
    const destroyResult = this.destroyNativeStream()

    let failure: { error: Error; context: AudioStreamErrorContext } | null = null
    if (destroyResult.status !== 0) {
      const context: AudioStreamErrorContext = { action: "destroy", status: destroyResult.status }
      const error = new AudioStreamOperationError("Audio stream destroy failed after end", context)
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
    this.lifecycleController.abort()
    const cleanup = this.stopActiveAttempt()
    this.destroyNativeStream()
    if (!this.disposed) this.currentState = "errored"
    await cleanup
    if (this.disposed) this.currentState = "disposed"

    this.rejectSetup(error)
    this.removeOwner()
    this.closedResolve()
    if (!this.disposed) this.notifyError(error, context)
  }

  private async failDecoder(stats: NativeAudioStreamStats): Promise<void> {
    const context: AudioStreamErrorContext = { action: "decoder", errorCode: stats.errorCode }
    const message =
      stats.state === NativeAudioStreamState.Failed
        ? `Audio stream decoder failed: ${stats.errorCode}`
        : "Audio stream was cancelled by the decoder"
    await this.fail(new AudioStreamOperationError(message, context), context)
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
    setTimeout(() => EventEmitter.prototype.emit.call(this, event, ...args), 0)
  }

  private isAttemptActive(attempt: AudioStreamAttempt): boolean {
    return !this.terminal && this.activeAttempt === attempt
  }

  private setAttemptCleanup(attempt: AudioStreamAttempt, cleanup: () => unknown): boolean {
    if (!this.isAttemptActive(attempt)) return false
    attempt.cleanup = cleanup
    return true
  }

  private clearAttemptCleanup(attempt: AudioStreamAttempt, cleanup: () => unknown): void {
    if (attempt.cleanup === cleanup) attempt.cleanup = null
  }

  private stopAttempt(attempt: AudioStreamAttempt): Promise<void> {
    if (this.activeAttempt !== attempt) return Promise.resolve()
    this.activeAttempt = null
    attempt.controller.abort()
    const cleanup = attempt.cleanup
    attempt.cleanup = null
    return cleanup == null ? Promise.resolve() : runBoundedCleanup(cleanup)
  }

  private stopActiveAttempt(): Promise<void> {
    const attempt = this.activeAttempt
    return attempt == null ? Promise.resolve() : this.stopAttempt(attempt)
  }

  private destroyNativeStream(): { status: number } {
    const streamId = this.nativeStreamId
    if (streamId == null) return { status: 0 }
    const stats = this.readNativeStats()
    if (stats != null) this.lastNativeStats = { ...stats, bufferedFrames: 0 }
    else if (this.lastNativeStats != null) this.lastNativeStats = { ...this.lastNativeStats, bufferedFrames: 0 }
    this.nativeStreamId = null
    return { status: this.lib.audioDestroyStream(this.engine, streamId) }
  }

  private restartNativeStream(): { status: number } {
    return { status: this.lib.audioRestartStream(this.engine, this.nativeStreamId!) }
  }

  private readNativeStats(useCached = true): NativeAudioStreamStats | null {
    const streamId = this.nativeStreamId
    if (streamId == null) return useCached ? this.lastNativeStats : null
    const stats = this.lib.audioGetStreamStats(this.engine, streamId)
    if (stats != null) this.lastNativeStats = stats
    return stats
  }

  private toPublicStats(native: NativeAudioStreamStats | null): AudioStreamStats {
    const stats = native ?? this.lastNativeStats
    const sampleRate = stats?.sampleRate ?? this.sampleRate
    const bufferedFrames = stats?.bufferedFrames ?? 0
    return {
      state: this.currentState,
      sampleRate,
      channels: stats?.channels ?? 0,
      bufferedFrames,
      capacityFrames: stats?.capacityFrames ?? this.options.pcmCapacityFrames,
      bufferedDurationMs: (bufferedFrames * 1000) / sampleRate,
      bytesReceived: stats?.bytesReceived ?? 0n,
      framesDecoded: stats?.framesDecoded ?? 0n,
      framesPlayed: stats?.framesPlayed ?? 0n,
      underruns: stats?.underruns ?? 0,
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
    this.engine = this.lib.createAudioEngine(createOptions)
    if (!this.engine) {
      throw new AudioInitializationError("createAudioEngine", "Audio createAudioEngine returned null")
    }

    if (options.autoStart ?? false) {
      const status = this.lib.audioStart(this.engine, this.defaultStartOptions)
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
    if (engine) this.lib.destroyAudioEngine(engine)
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
