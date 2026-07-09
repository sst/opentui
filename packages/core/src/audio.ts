import { EventEmitter } from "events"
import { readFile } from "node:fs/promises"
import {
  selectAudioStreamDemuxer,
  type AudioStreamDemuxer,
  type AudioStreamDemuxerFactory,
  type AudioStreamDemuxOutput,
} from "./audio-stream/parser.js"
import { resolveRenderLib, type AudioEngineHandle, type RenderLib } from "./zig.js"
import {
  NativeAudioStreamCloseReason as CloseReason,
  NativeAudioStreamState as StreamState,
  NativeAudioStreamStateNames as StateNames,
  type AudioStats,
  type NativeAudioStreamCloseReason,
  type NativeAudioStreamStats,
} from "./zig-structs.js"

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

export type AudioStreamBody = ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>

export interface AudioStreamConnectContext {
  readonly signal: AbortSignal
  readonly attempt: number
}

export interface AudioStreamConnection<I = unknown> {
  readonly body: AudioStreamBody
  readonly info: I
  close?(): void | Promise<void>
}

export type AudioStreamRetryPhase = "connect" | "read"

export interface AudioStreamRetryContext {
  readonly attempt: number
  readonly maxAttempts: number
  readonly phase: AudioStreamRetryPhase
}

export type AudioStreamRetryDecision = false | { readonly delayMs?: number }

export interface AudioStreamConnector<I = unknown> {
  connect(context: AudioStreamConnectContext): Promise<AudioStreamConnection<I>>
  retry?(error: AudioStreamError, context: AudioStreamRetryContext): AudioStreamRetryDecision
}

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

export interface AudioStreamOptions {
  volume?: number
  pan?: number
  groupId?: number
  maxProbeBytes?: number
  buffer?: AudioStreamBufferOptions
  signal?: AbortSignal
}

export interface AudioStreamBodyOptions<M = AudioStreamMetadata> extends AudioStreamOptions {
  demuxer?: AudioStreamDemuxerFactory<M>
  request?: never
  reconnect?: never
  metadataEncoding?: never
}

export interface AudioStreamSourceOptions<I = unknown, M = AudioStreamMetadata> extends AudioStreamOptions {
  demuxer?: (info: I) => AudioStreamDemuxer<M> | null
  reconnect?: AudioStreamReconnectOptions
  request?: never
  metadataEncoding?: never
}

export interface AudioStreamUrlOptions extends AudioStreamOptions {
  request?: Omit<RequestInit, "body" | "signal">
  reconnect?: AudioStreamReconnectOptions
  metadataEncoding?: string
  demuxer?: never
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

export type AudioStreamMetadataFormat = "icy"

export interface AudioStreamMetadata {
  readonly format: AudioStreamMetadataFormat
  readonly headers: Readonly<Record<string, string>>
  readonly fields: Readonly<Record<string, string>>
}

export type AudioStreamAction =
  | "fetch"
  | "response"
  | "source"
  | "demuxer"
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
  error: AudioStreamError
}

export interface AudioStreamEvents<M = AudioStreamMetadata> {
  metadata: [metadata: M | null]
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
const DEFAULT_STREAM_PROBE_BYTES = 1024 * 1024
const STREAM_POLL_INTERVAL_MS = 5
const MAX_TIMER_DELAY_MS = 0x7fffffff
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
  capacityMs: number
  startupMs: number
  resumeMs: number
  volume: number
  pan: number
  groupId: number
  maxProbeBytes: number
  signal?: AbortSignal
  reconnect?: ResolvedAudioStreamReconnectOptions
}

interface ResolvedAudioStreamConnector<I> {
  connect(context: AudioStreamConnectContext): Promise<AudioStreamConnection<I>>
  retry?(error: AudioStreamError, context: AudioStreamRetryContext): AudioStreamRetryDecision
}

interface ResolvedAudioStreamConnection<I> {
  readonly body: AudioStreamBody
  readonly info: I
  readonly close?: () => void | Promise<void>
}

interface AudioStreamInit<I, M> {
  lib: RenderLib
  engine: AudioEngineHandle
  connector: ResolvedAudioStreamConnector<I>
  demuxer?: (info: I) => AudioStreamDemuxer<M> | null
  options: AudioStreamOptions & { reconnect?: AudioStreamReconnectOptions }
  readAction: "fetch" | "source"
  removeFromOwner: () => void
}

interface AudioStreamAttempt<M> {
  controller: AbortController
  cleanup: (() => unknown) | null
  demuxer: AudioStreamDemuxer<M> | null
  demuxerFinished: boolean
}

export class AudioStreamError extends Error {
  readonly context: AudioStreamErrorContext

  constructor(message: string, context: AudioStreamErrorContext, cause?: unknown) {
    super(message)
    this.name = "AudioStreamError"
    this.context = context
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause
  }
}

class ClassifiedAudioStreamError extends AudioStreamError {
  readonly retryable: boolean
  readonly retryAfterMs?: number

  constructor(
    message: string,
    context: AudioStreamErrorContext,
    retryable: boolean,
    retryAfterMs?: number,
    cause?: unknown,
  ) {
    super(message, context, cause)
    this.retryable = retryable
    this.retryAfterMs = retryAfterMs
  }
}

class AudioStreamConnectionResolutionError extends Error {
  constructor(
    readonly failure: unknown,
    readonly closeConnection?: () => void | Promise<void>,
  ) {
    super("Audio stream connection could not be read")
  }
}

function createAbortError(): Error {
  return new DOMException("The operation was aborted", "AbortError")
}

const isU32 = (value: number): boolean => Number.isInteger(value) && value >= 0 && value <= MAX_U32

function resolvePositiveU32(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isFinite(resolved) || !Number.isInteger(resolved) || resolved <= 0) {
    throw new TypeError(`${name} must be a finite positive integer`)
  }
  if (resolved > MAX_U32) throw new RangeError(`${name} exceeds the supported limit`)
  return resolved
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

  return { maxAttempts, initialDelayMs, maxDelayMs, backoffFactor, retryOnEnd: options.retryOnEnd ?? false }
}

function resolveAudioStreamOptions(
  options: AudioStreamOptions & { reconnect?: AudioStreamReconnectOptions },
): ResolvedAudioStreamOptions {
  const capacityMs = resolvePositiveU32(options.buffer?.capacityMs, 2000, "buffer.capacityMs")
  const startupMs = resolvePositiveU32(options.buffer?.startupMs, 1000, "buffer.startupMs")
  const resumeMs = resolvePositiveU32(options.buffer?.resumeMs, 1000, "buffer.resumeMs")
  const maxProbeBytes = resolvePositiveU32(options.maxProbeBytes, DEFAULT_STREAM_PROBE_BYTES, "maxProbeBytes")
  if (startupMs > capacityMs) throw new RangeError("buffer.startupMs must not exceed buffer.capacityMs")
  if (resumeMs > capacityMs) throw new RangeError("buffer.resumeMs must not exceed buffer.capacityMs")

  return {
    capacityMs,
    startupMs,
    resumeMs,
    volume: options.volume ?? 1,
    pan: options.pan ?? 0,
    groupId: options.groupId ?? 0,
    maxProbeBytes,
    signal: options.signal,
    reconnect: options.reconnect === undefined ? undefined : resolveReconnectOptions(options.reconnect),
  }
}

function resolveAudioStreamConnector<I>(connector: AudioStreamConnector<I>): ResolvedAudioStreamConnector<I> {
  const connect = connector?.connect
  if (typeof connect !== "function") throw new TypeError("Audio stream connector must define connect()")
  const retry = connector.retry
  if (retry !== undefined && typeof retry !== "function") {
    throw new TypeError("Audio stream connector retry must be a function")
  }
  return {
    connect: (context) => connect.call(connector, context),
    retry: retry == null ? undefined : (error, context) => retry.call(connector, error, context),
  }
}

function runBoundedCleanup(cleanup: () => unknown, timeoutMs: number = 50): Promise<void> {
  let result: Promise<unknown>
  try {
    result = Promise.resolve(cleanup()).catch(() => undefined)
  } catch {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs)
    void result.then(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function waitForDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(createAbortError())
  return new Promise((resolve, reject) => {
    let remainingMs = delayMs
    let timer: ReturnType<typeof setTimeout>
    const schedule = (): void => {
      const currentDelayMs = Math.min(remainingMs, MAX_TIMER_DELAY_MS)
      timer = setTimeout(() => {
        remainingMs -= currentDelayMs
        if (remainingMs > 0) schedule()
        else {
          signal.removeEventListener("abort", onAbort)
          resolve()
        }
      }, currentDelayMs)
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(createAbortError())
    }
    signal.addEventListener("abort", onAbort, { once: true })
    schedule()
  })
}

function waitForPoll(signal: AbortSignal): Promise<boolean> {
  return waitForDelay(STREAM_POLL_INTERVAL_MS, signal)
    .then(() => true)
    .catch(() => false)
}

function parseRetryAfter(value: string | null, maxDelayMs: number): number | undefined {
  if (value == null) return undefined
  const seconds = Number(value.trim())
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(maxDelayMs, Math.ceil(seconds * 1000))
  const date = Date.parse(value)
  if (!Number.isFinite(date)) return undefined
  return Math.min(maxDelayMs, Math.max(0, date - Date.now()))
}

function isAllowedMp3ContentType(value: string): boolean {
  const contentType = value.split(";", 1)[0]?.trim().toLowerCase()
  return ["audio/mpeg", "audio/mp3", "application/octet-stream", "application/mp3"].includes(contentType ?? "")
}

interface AudioStreamUrlConnectionInfo {
  readonly headers: Headers
  readonly status: number
}

function createAudioStreamUrlConnector(
  source: string | URL,
  request: Omit<RequestInit, "body" | "signal"> | undefined,
  maxRetryDelayMs: number,
): AudioStreamConnector<AudioStreamUrlConnectionInfo> {
  return {
    async connect({ signal, attempt }) {
      let response: Response
      try {
        const headers = new Headers(request?.headers)
        if (!headers.has("icy-metadata")) headers.set("Icy-MetaData", "1")
        response = await globalThis.fetch(source, { ...request, headers, signal })
      } catch (cause) {
        throw new ClassifiedAudioStreamError(
          "Audio stream fetch failed",
          { action: "fetch", attempt },
          true,
          undefined,
          cause,
        )
      }

      if (!response.ok) {
        const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"), maxRetryDelayMs)
        await runBoundedCleanup(() => response.body?.cancel())
        const retryable =
          [408, 425, 429].includes(response.status) || (response.status >= 500 && response.status <= 599)
        throw new ClassifiedAudioStreamError(
          `Audio stream request failed with HTTP ${response.status}`,
          { action: "response", status: response.status, attempt },
          retryable,
          retryAfterMs,
        )
      }

      const contentType = response.headers.get("content-type")
      if (contentType != null && !isAllowedMp3ContentType(contentType)) {
        await runBoundedCleanup(() => response.body?.cancel())
        throw new ClassifiedAudioStreamError(
          `Unsupported audio stream Content-Type: ${contentType}`,
          { action: "response", status: response.status, attempt },
          false,
        )
      }
      if (response.body == null) {
        throw new ClassifiedAudioStreamError(
          "Audio stream response has no body",
          { action: "response", status: response.status, attempt },
          true,
        )
      }
      return {
        body: response.body,
        info: { headers: response.headers, status: response.status },
      }
    },
  }
}

function resolveMetadataEncoding(value: string | undefined): string {
  try {
    return new TextDecoder(value ?? "iso-8859-1").encoding
  } catch {
    throw new TypeError(`Unsupported metadataEncoding: ${value}`)
  }
}

function resolveAudioStreamRequest(
  request: Omit<RequestInit, "body" | "signal"> | undefined,
): Omit<RequestInit, "body" | "signal"> | undefined {
  if (request === undefined) return undefined
  const { body: _body, signal: _signal, ...safeRequest } = request as RequestInit
  return safeRequest
}

function isReadableStreamSource(source: unknown): source is ReadableStream<Uint8Array> {
  try {
    return typeof (source as ReadableStream<Uint8Array> | null)?.getReader === "function"
  } catch {
    return false
  }
}

function isAsyncIterableSource(source: unknown): source is AsyncIterable<Uint8Array> {
  try {
    return typeof (source as AsyncIterable<Uint8Array> | null)?.[Symbol.asyncIterator] === "function"
  } catch {
    return false
  }
}

function isUint8Array(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === "[object Uint8Array]"
}

let createAudioStream: <I, M>(init: AudioStreamInit<I, M>) => AudioStream<M>
let openAudioStream: <M>(stream: AudioStream<M>) => Promise<void>

export class AudioStream<M = AudioStreamMetadata> extends EventEmitter<AudioStreamEvents<M>> {
  readonly closed: Promise<void>
  private readonly lib: RenderLib
  private readonly engine: AudioEngineHandle
  private readonly connector: ResolvedAudioStreamConnector<unknown>
  private readonly demuxerFactory?: (info: unknown) => AudioStreamDemuxer<M> | null
  private readonly readAction: "fetch" | "source"
  private readonly options: ResolvedAudioStreamOptions
  private readonly removeFromOwner: () => void
  private readonly lifecycleController = new AbortController()
  private nativeStreamId: number | null = null
  private nativeStats: NativeAudioStreamStats | null = null
  private activeAttempt: AudioStreamAttempt<M> | null = null
  private reconnectAttempts = 0
  private consecutiveReconnectAttempts = 0
  private disposed = false
  private exposed = false
  private terminalError: Error | null = null
  private metadata: M | null = null
  private pendingMetadataEvent = false
  private metadataEventScheduled = false
  private setupResolve!: () => void
  private setupReject!: (error: Error) => void
  private closedResolve!: () => void
  private readonly setupPromise: Promise<void>
  private readonly overallAbortListener = () => this.dispose()

  static {
    createAudioStream = <I, T>(init: AudioStreamInit<I, T>) => new AudioStream<T>(init as AudioStreamInit<unknown, T>)
    openAudioStream = <T>(stream: AudioStream<T>) => stream.open()
  }

  private constructor(init: AudioStreamInit<unknown, M>) {
    super()
    this.lib = init.lib
    this.engine = init.engine
    this.connector = init.connector
    this.demuxerFactory = init.demuxer
    this.readAction = init.readAction
    this.options = resolveAudioStreamOptions(init.options)
    this.removeFromOwner = init.removeFromOwner
    this.setupPromise = new Promise((resolve, reject) => ((this.setupResolve = resolve), (this.setupReject = reject)))
    this.closed = new Promise((resolve) => (this.closedResolve = resolve))
    this.options.signal?.addEventListener("abort", this.overallAbortListener, { once: true })
  }

  get state(): AudioStreamState {
    // State is the latest snapshot; getStats() is the explicit FFI refresh.
    if (this.disposed) return "disposed"
    if (this.terminalError != null) return "errored"
    return this.nativeStats == null ? "initializing" : (StateNames[this.nativeStats.state] ?? "errored")
  }

  private async open(): Promise<void> {
    if (this.options.signal?.aborted) this.dispose()
    else void this.runLifecycle()
    await this.setupPromise
    if (this.lifecycleController.signal.aborted && this.state !== "ended")
      throw this.terminalError ?? createAbortError()
    this.exposed = true
    if (this.pendingMetadataEvent && this.metadata != null) this.emitMetadata()
    this.pendingMetadataEvent = false
    if (this.state === "ended") this.emitAsync("ended")
  }

  getStats(): AudioStreamStats {
    const stats = this.readNativeStats()
    if (!this.lifecycleController.signal.aborted && this.nativeStreamId != null) {
      const error = this.snapshotError(stats)
      const ended = stats?.state === StreamState.Ended && !this.options.reconnect?.retryOnEnd
      if (error != null || ended) {
        queueMicrotask(() => {
          if (this.lifecycleController.signal.aborted) return
          const reason =
            error == null || error.context.action === "decoder"
              ? CloseReason.PreserveNativeTerminal
              : CloseReason.TransportError
          void this.finish(reason, error ?? undefined)
        })
      }
    }
    return this.toPublicStats()
  }

  getMetadata(): M | null {
    return this.metadata
  }

  setVolume(volume: number): boolean {
    return this.control("setVolume", (streamId) => this.lib.audioSetStreamVolume(this.engine, streamId, volume))
  }

  setPan(pan: number): boolean {
    return this.control("setPan", (streamId) => this.lib.audioSetStreamPan(this.engine, streamId, pan))
  }

  setGroup(groupId: number): boolean {
    if (!isU32(groupId)) {
      const context: AudioStreamErrorContext = { action: "setGroup" }
      if (this.exposed) {
        this.emitAsync("error", new AudioStreamError("Invalid audio stream group", context), context)
      }
      return false
    }
    return this.control("setGroup", (streamId) => this.lib.audioSetStreamGroup(this.engine, streamId, groupId))
  }

  private control(action: "setVolume" | "setPan" | "setGroup", call: (streamId: number) => number): boolean {
    const streamId = this.nativeStreamId
    if (this.disposed || this.lifecycleController.signal.aborted || streamId == null) return false
    const status = call(streamId)
    if (status !== 0) {
      const context: AudioStreamErrorContext = { action, status }
      if (this.exposed) {
        this.emitAsync("error", new AudioStreamError(`Audio stream ${action} failed: ${status}`, context), context)
      }
      return false
    }
    return true
  }

  dispose(): void {
    if (this.disposed) {
      if (this.nativeStreamId != null && this.closeNativeStream(CloseReason.Disposed) === 0) this.removeOwner()
      return
    }
    this.disposed = true
    const wasExposed = this.exposed
    this.lifecycleController.abort()
    const cleanup = this.stopSource()
    this.setupReject(createAbortError())
    if (this.closeNativeStream(CloseReason.Disposed) === 0) this.removeOwner()
    void cleanup.finally(() => {
      this.closedResolve()
      if (wasExposed) this.emitAsync("disposed")
    })
  }

  private async runLifecycle(): Promise<void> {
    while (!this.lifecycleController.signal.aborted) {
      const attempt: AudioStreamAttempt<M> = {
        controller: new AbortController(),
        cleanup: null,
        demuxer: null,
        demuxerFinished: false,
      }
      this.activeAttempt = attempt

      let returnedConnection: AudioStreamConnection<unknown> | null = null
      let connection: ResolvedAudioStreamConnection<unknown>
      try {
        returnedConnection = await this.connector.connect({
          signal: attempt.controller.signal,
          attempt: this.consecutiveReconnectAttempts,
        })
        connection = this.resolveConnection(returnedConnection)
      } catch (cause) {
        const failure = cause instanceof AudioStreamConnectionResolutionError ? cause.failure : cause
        if (cause instanceof AudioStreamConnectionResolutionError && cause.closeConnection != null) {
          await runBoundedCleanup(cause.closeConnection)
        } else if (returnedConnection != null) {
          await this.closeRejectedConnection(returnedConnection)
        }
        if (!this.isAttemptActive(attempt)) return
        const context: AudioStreamErrorContext = {
          action: this.readAction,
          attempt: this.consecutiveReconnectAttempts,
        }
        const error =
          failure instanceof AudioStreamError
            ? failure
            : new AudioStreamError(
                failure instanceof Error ? failure.message : "Audio stream connection failed",
                context,
                failure,
              )
        await this.stopSource(attempt)
        const decision = await this.resolveRetryDecision(error, "connect")
        if (await this.retry(error, decision !== false, decision === false ? undefined : decision.delayMs)) continue
        return
      }

      if (!this.isAttemptActive(attempt)) {
        await this.closeUnconsumedConnection(connection)
        return
      }
      if (!isReadableStreamSource(connection.body) && !isAsyncIterableSource(connection.body)) {
        await this.closeUnconsumedConnection(connection)
        const context: AudioStreamErrorContext = { action: "source" }
        await this.finish(
          CloseReason.TransportError,
          new AudioStreamError("Audio stream connection body must be a ReadableStream or AsyncIterable", context),
        )
        return
      }

      let initialMetadata: M | null
      try {
        attempt.demuxer = this.demuxerFactory?.(connection.info) ?? null
        initialMetadata = attempt.demuxer?.initialMetadata ?? null
      } catch (cause) {
        await this.closeUnconsumedConnection(connection, attempt.demuxer)
        const error =
          cause instanceof AudioStreamError
            ? cause
            : new AudioStreamError(
                cause instanceof Error ? cause.message : "Audio stream demuxer creation failed",
                { action: "demuxer" },
                cause,
              )
        await this.finish(CloseReason.TransportError, error)
        return
      }
      if (!this.isAttemptActive(attempt)) {
        await this.closeUnconsumedConnection(connection, attempt.demuxer)
        return
      }

      this.publishMetadata(initialMetadata, attempt)
      try {
        this.createNativeStream()
      } catch (cause) {
        await this.closeUnconsumedConnection(connection, attempt.demuxer)
        await this.stopSource(attempt)
        const error =
          cause instanceof AudioStreamError
            ? cause
            : new AudioStreamError("Audio stream create failed", { action: "create" }, cause)
        await this.finish(CloseReason.TransportError, error)
        return
      }
      try {
        if (!(await this.consumeSource(connection, attempt))) return
      } catch (cause) {
        if (this.lifecycleController.signal.aborted) return
        const error =
          cause instanceof AudioStreamError
            ? cause
            : cause instanceof TypeError && cause.message === INVALID_STREAM_CHUNK_MESSAGE
              ? cause
              : new AudioStreamError("Audio stream source failed", { action: "source" }, cause)
        if (error instanceof ClassifiedAudioStreamError) {
          const decision = await this.resolveRetryDecision(error, "read")
          if (await this.retry(error, decision !== false, decision === false ? undefined : decision.delayMs)) continue
          return
        }
        const context = error instanceof AudioStreamError ? error.context : { action: "source" as const }
        await this.finish(CloseReason.TransportError, error, context)
        return
      }

      if (!this.options.reconnect?.retryOnEnd) {
        await this.finish(CloseReason.PreserveNativeTerminal)
        return
      }
      const error = new AudioStreamError("Audio stream source ended", { action: "source" })
      if (await this.retry(error, true)) continue
      return
    }
  }

  private createNativeStream(): void {
    if (this.nativeStreamId != null) return
    const created = this.lib.audioCreateStream(this.engine, {
      capacityMs: this.options.capacityMs,
      startupMs: this.options.startupMs,
      resumeMs: this.options.resumeMs,
      maxProbeBytes: this.options.maxProbeBytes,
      volume: this.options.volume,
      pan: this.options.pan,
      groupId: this.options.groupId,
    })
    if (created.status !== 0 || created.streamId == null) {
      const context: AudioStreamErrorContext = { action: "create", status: created.status }
      throw new AudioStreamError(`Audio stream create failed: ${created.status}`, context)
    }
    this.nativeStreamId = created.streamId
  }

  private async consumeSource(
    connection: ResolvedAudioStreamConnection<unknown>,
    attempt: AudioStreamAttempt<M>,
  ): Promise<boolean> {
    const initial = await this.pollNativeSnapshot(attempt)
    if (initial == null) return false
    const decoderReady = this.awaitReady(attempt, initial.readyGeneration)
    try {
      await this.pumpSource(connection, attempt)
    } catch (cause) {
      await this.stopSource(attempt)
      await decoderReady
      if (!this.lifecycleController.signal.aborted) throw cause
      return false
    }
    if (this.lifecycleController.signal.aborted) return false
    const status = this.lib.audioEndStream(this.engine, this.nativeStreamId!)
    if (status !== 0) {
      const context: AudioStreamErrorContext = { action: "end", status }
      throw new AudioStreamError(`Audio stream end failed: ${status}`, context)
    }
    if (!(await decoderReady) || this.lifecycleController.signal.aborted) return false
    if (!(await this.awaitEnded(attempt))) return false
    await this.stopSource(attempt)
    return !this.lifecycleController.signal.aborted
  }

  private async pumpSource(
    connection: ResolvedAudioStreamConnection<unknown>,
    attempt: AudioStreamAttempt<M>,
  ): Promise<void> {
    const source = connection.body
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    let iterator: AsyncIterator<Uint8Array> | null = null
    let released = false
    let cleaned = false
    const release = (): void => {
      if (released) return
      if (reader == null) {
        released = true
        return
      }
      try {
        reader.releaseLock()
        released = true
      } catch {}
    }
    const next = (): Promise<{ done?: boolean; value?: unknown }> => (reader == null ? iterator!.next() : reader.read())
    const cancelAcquiredSource = (): Promise<unknown>[] => {
      const pending: Promise<unknown>[] = []
      if (!released && (reader != null || iterator != null)) {
        try {
          if (reader == null) {
            released = true
            pending.push(Promise.resolve(iterator!.return?.()))
          } else {
            const result = reader.cancel(createAbortError())
            void result.then(release, release)
            release()
            pending.push(result)
          }
        } catch {}
      }
      return pending
    }
    const cleanup = (): unknown => {
      const pending = cancelAcquiredSource()
      if (cleaned) return Promise.all(pending)
      cleaned = true
      if (!attempt.demuxerFinished) {
        try {
          attempt.demuxer?.abort?.(createAbortError())
        } catch {}
      }
      if (connection.close != null) {
        try {
          pending.push(Promise.resolve(connection.close()))
        } catch {}
      }
      return Promise.all(pending)
    }

    attempt.cleanup = cleanup
    try {
      reader = isReadableStreamSource(source) ? source.getReader() : null
      iterator = reader == null ? (source as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]() : null
    } catch (cause) {
      const context: AudioStreamErrorContext = { action: this.readAction }
      throw new ClassifiedAudioStreamError("Audio stream source failed", context, true, undefined, cause)
    }

    if (!this.isAttemptActive(attempt)) {
      await runBoundedCleanup(cleanup)
      return
    }

    while (this.isAttemptActive(attempt)) {
      let result: { done?: boolean; value?: unknown }
      try {
        result = await next()
      } catch (cause) {
        const context: AudioStreamErrorContext = { action: this.readAction }
        throw new ClassifiedAudioStreamError("Audio stream source failed", context, true, undefined, cause)
      }
      if (!this.isAttemptActive(attempt)) return
      if (result.done) {
        release()
        if (attempt.demuxer != null) {
          try {
            await this.processDemuxOutput(attempt.demuxer.flush(), attempt)
          } catch (cause) {
            if (cause instanceof AudioStreamError) throw cause
            const context: AudioStreamErrorContext = { action: this.readAction }
            throw new ClassifiedAudioStreamError(
              cause instanceof Error ? cause.message : "Audio stream demuxer flush failed",
              context,
              true,
              undefined,
              cause,
            )
          }
        }
        attempt.demuxerFinished = true
        await runBoundedCleanup(cleanup)
        return
      }
      const chunk = result.value
      if (!isUint8Array(chunk)) throw new TypeError(INVALID_STREAM_CHUNK_MESSAGE)
      if (chunk.byteLength === 0) {
        await waitForDelay(0, attempt.controller.signal)
        continue
      }

      if (attempt.demuxer == null) {
        await this.writeStreamChunk(chunk, attempt)
        continue
      }
      try {
        await this.processDemuxOutput(attempt.demuxer.push(chunk), attempt)
      } catch (cause) {
        if (cause instanceof AudioStreamError) throw cause
        throw new AudioStreamError(
          cause instanceof Error ? cause.message : "Audio stream demuxer failed",
          { action: "demuxer" },
          cause,
        )
      }
    }
  }

  private async processDemuxOutput(
    outputs: Iterable<AudioStreamDemuxOutput<M>>,
    attempt: AudioStreamAttempt<M>,
  ): Promise<void> {
    for (const output of outputs) {
      if (!this.isAttemptActive(attempt)) return
      if (output.type === "audio") {
        if (!isUint8Array(output.data)) {
          throw new AudioStreamError("Audio stream demuxer audio output must be a Uint8Array", {
            action: "demuxer",
          })
        }
        await this.writeStreamChunk(output.data, attempt)
      } else if (output.type === "metadata") {
        this.publishMetadata(output.metadata, attempt)
      } else {
        throw new AudioStreamError("Audio stream demuxer returned an invalid output", { action: "demuxer" })
      }
    }
  }

  private async writeStreamChunk(chunk: Uint8Array, attempt: AudioStreamAttempt<M>): Promise<void> {
    let offset = 0
    while (offset < chunk.byteLength && this.isAttemptActive(attempt)) {
      const streamId = this.nativeStreamId
      if (streamId == null) return
      let accepted: number
      try {
        accepted = this.lib.audioWriteStream(this.engine, streamId, chunk.subarray(offset))
      } catch (cause) {
        const context: AudioStreamErrorContext = { action: "write" }
        throw new AudioStreamError("Audio stream write failed", context, cause)
      }
      if (accepted < 0) {
        const context: AudioStreamErrorContext = { action: "write", status: accepted }
        throw new AudioStreamError(`Audio stream write failed: ${accepted}`, context)
      }
      if (accepted === 0) {
        // Polling exists only for the current backpressured write; no idle timer remains afterward.
        if ((await this.pollNativeSnapshot(attempt)) == null) return
        await waitForDelay(STREAM_POLL_INTERVAL_MS, attempt.controller.signal)
        continue
      }
      offset += accepted
    }
  }

  private resolveConnection(connection: AudioStreamConnection<unknown>): ResolvedAudioStreamConnection<unknown> {
    let closeConnection: (() => void | Promise<void>) | undefined
    try {
      const close = connection.close
      if (close !== undefined && typeof close !== "function") {
        throw new TypeError("Audio stream connection close must be a function")
      }
      closeConnection = close == null ? undefined : () => close.call(connection)
      const info = connection.info
      const body = connection.body
      return { body, info, close: closeConnection }
    } catch (cause) {
      throw new AudioStreamConnectionResolutionError(cause, closeConnection)
    }
  }

  private async closeRejectedConnection(connection: AudioStreamConnection<unknown>): Promise<void> {
    let close: (() => void | Promise<void>) | undefined
    try {
      const method = connection.close
      if (typeof method === "function") close = () => method.call(connection)
    } catch {}
    if (close != null) await runBoundedCleanup(close)
  }

  private async closeUnconsumedConnection(
    connection: ResolvedAudioStreamConnection<unknown>,
    demuxer: AudioStreamDemuxer<M> | null = null,
  ): Promise<void> {
    await runBoundedCleanup(() => {
      const pending: Promise<unknown>[] = []
      try {
        demuxer?.abort?.(createAbortError())
      } catch {}
      try {
        if (isReadableStreamSource(connection.body)) {
          pending.push(connection.body.cancel(createAbortError()))
        } else if (isAsyncIterableSource(connection.body)) {
          pending.push(Promise.resolve(connection.body[Symbol.asyncIterator]().return?.()))
        }
      } catch {}
      if (connection.close != null) {
        try {
          pending.push(Promise.resolve(connection.close()))
        } catch {}
      }
      return Promise.all(pending)
    })
  }

  private async resolveRetryDecision(
    error: AudioStreamError,
    phase: AudioStreamRetryPhase,
  ): Promise<AudioStreamRetryDecision> {
    const reconnect = this.options.reconnect
    if (reconnect == null || this.consecutiveReconnectAttempts >= reconnect.maxAttempts) return false
    let decision: AudioStreamRetryDecision =
      error instanceof ClassifiedAudioStreamError ? (error.retryable ? { delayMs: error.retryAfterMs } : false) : {}
    if (this.connector.retry != null) {
      try {
        const result = this.connector.retry(error, {
          attempt: this.consecutiveReconnectAttempts + 1,
          maxAttempts: reconnect.maxAttempts,
          phase,
        })
        if (result !== false && (result == null || typeof result !== "object")) {
          await this.finish(
            CloseReason.TransportError,
            new AudioStreamError("Audio stream retry policy must return false or a retry decision", {
              action: "source",
            }),
          )
          return false
        }
        decision = result
      } catch (cause) {
        await this.finish(
          CloseReason.TransportError,
          new AudioStreamError("Audio stream retry policy failed", { action: "source" }, cause),
        )
        return false
      }
    }
    if (decision === false) return false
    let delayMs: number | undefined
    try {
      delayMs = decision.delayMs
    } catch (cause) {
      await this.finish(
        CloseReason.TransportError,
        new AudioStreamError("Audio stream retry policy failed", { action: "source" }, cause),
      )
      return false
    }
    if (delayMs === undefined) return {}
    if (!Number.isFinite(delayMs) || !Number.isInteger(delayMs) || delayMs < 0) {
      await this.finish(
        CloseReason.TransportError,
        new AudioStreamError("Audio stream retry delay must be a finite non-negative integer", { action: "source" }),
      )
      return false
    }
    return { delayMs: Math.min(reconnect.maxDelayMs, delayMs) }
  }

  private async retry(error: AudioStreamError, retryable: boolean, retryAfterMs?: number): Promise<boolean> {
    if (this.lifecycleController.signal.aborted) return false
    const reconnect = this.options.reconnect
    if (!retryable || reconnect == null || this.consecutiveReconnectAttempts >= reconnect.maxAttempts) {
      await this.finish(CloseReason.TransportError, error)
      return false
    }
    if (this.nativeStreamId != null) {
      const nativeError = this.snapshotError(this.readNativeStats())
      if (nativeError != null) {
        const reason =
          nativeError.context.action === "decoder" ? CloseReason.PreserveNativeTerminal : CloseReason.TransportError
        await this.finish(reason, nativeError)
        return false
      }
      const restartStatus = this.lib.audioRestartStream(this.engine, this.nativeStreamId)
      if (restartStatus !== 0) {
        const restartContext: AudioStreamErrorContext = { action: "restart", status: restartStatus }
        await this.finish(
          CloseReason.TransportError,
          new AudioStreamError("Audio stream restart failed during reconnect", restartContext),
        )
        return false
      }
      this.readNativeStats()
    }
    this.reconnectAttempts += 1
    this.consecutiveReconnectAttempts += 1
    const delayMs =
      retryAfterMs ??
      Math.min(
        reconnect.maxDelayMs,
        reconnect.initialDelayMs * reconnect.backoffFactor ** (this.consecutiveReconnectAttempts - 1),
      )
    // Initial retries happen before callers receive the AudioStream and can attach listeners. Do not replay completed
    // setup retries after success; callers can bound or cancel pending setup with reconnect.maxAttempts or signal.
    if (this.exposed) {
      this.emitAsync("reconnecting", {
        attempt: this.consecutiveReconnectAttempts,
        delayMs,
        maxAttempts: reconnect.maxAttempts,
        error,
      })
    }
    return waitForDelay(delayMs, this.lifecycleController.signal)
      .then(() => true)
      .catch(() => false)
  }

  private async awaitReady(attempt: AudioStreamAttempt<M>, previousGeneration: number): Promise<boolean> {
    while (this.isAttemptActive(attempt)) {
      const stats = await this.pollNativeSnapshot(attempt)
      if (stats == null) return false
      if (stats.readyGeneration !== previousGeneration) {
        this.consecutiveReconnectAttempts = 0
        this.setupResolve()
        return true
      }
      if (!(await waitForPoll(attempt.controller.signal))) return false
    }
    return false
  }

  private async awaitEnded(attempt: AudioStreamAttempt<M>): Promise<boolean> {
    while (this.isAttemptActive(attempt)) {
      const stats = await this.pollNativeSnapshot(attempt)
      if (stats == null) return false
      if (stats.state === StreamState.Ended) return true
      if (!(await waitForPoll(attempt.controller.signal))) return false
    }
    return false
  }

  private async pollNativeSnapshot(attempt: AudioStreamAttempt<M>): Promise<NativeAudioStreamStats | null> {
    if (!this.isAttemptActive(attempt)) return null
    const stats = this.readNativeStats()
    const error = this.snapshotError(stats)
    if (error != null) {
      const reason =
        error.context.action === "decoder" ? CloseReason.PreserveNativeTerminal : CloseReason.TransportError
      await this.finish(reason, error)
      return null
    }
    return stats!
  }

  private snapshotError(stats: NativeAudioStreamStats | null): AudioStreamError | null {
    if (stats == null) return new AudioStreamError("Audio stream stats failed", { action: "stats" })
    if (StateNames[stats.state] == null) {
      return new AudioStreamError(`Unknown native audio stream state: ${stats.state}`, { action: "stats" })
    }
    if (stats.state !== StreamState.Failed && stats.state !== StreamState.Cancelled) return null
    const context: AudioStreamErrorContext = { action: "decoder", errorCode: stats.errorCode }
    return new AudioStreamError(
      stats.state === StreamState.Failed
        ? `Audio stream decoder failed: ${stats.errorCode}`
        : "Audio stream was cancelled by the decoder",
      context,
    )
  }

  private async finish(
    reason: NativeAudioStreamCloseReason,
    error?: Error,
    context?: AudioStreamErrorContext,
  ): Promise<void> {
    if (this.lifecycleController.signal.aborted) return
    if (error instanceof AudioStreamError) context = error.context
    this.lifecycleController.abort()
    this.terminalError = error ?? null
    const cleanup = this.stopSource()
    const closeStatus = this.closeNativeStream(reason)
    if (error == null && closeStatus !== 0) {
      context = { action: "destroy", status: closeStatus }
      error = new AudioStreamError("Audio stream destroy failed after end", context)
      this.terminalError = error
    }
    await cleanup
    if (error != null) this.setupReject(error)
    else this.setupResolve()
    if (closeStatus === 0) this.removeOwner()
    this.closedResolve()
    if (!this.disposed && this.exposed) {
      if (error != null) this.emitAsync("error", error, context!)
      else this.emitAsync("ended")
    }
  }

  private publishMetadata(metadata: M | null, attempt: AudioStreamAttempt<M>): void {
    if (!this.isAttemptActive(attempt) || Object.is(this.metadata, metadata)) return
    this.metadata = metadata
    if (!this.exposed) {
      this.pendingMetadataEvent = true
      return
    }
    this.emitMetadata()
  }

  private emitMetadata(): void {
    if (this.metadataEventScheduled) return
    this.metadataEventScheduled = true
    setTimeout(() => {
      this.metadataEventScheduled = false
      if (!this.disposed) EventEmitter.prototype.emit.call(this, "metadata", this.metadata)
    }, 0)
  }

  private emitAsync<K extends keyof AudioStreamEvents<M>>(event: K, ...args: AudioStreamEvents<M>[K]): void {
    setTimeout(() => EventEmitter.prototype.emit.call(this, event, ...args), 0)
  }

  private isAttemptActive(attempt: AudioStreamAttempt<M>): boolean {
    return !this.lifecycleController.signal.aborted && this.activeAttempt === attempt
  }

  private stopSource(attempt: AudioStreamAttempt<M> | null = this.activeAttempt): Promise<void> {
    if (attempt == null || this.activeAttempt !== attempt) return Promise.resolve()
    this.activeAttempt = null
    attempt.controller.abort()
    const cleanup = attempt.cleanup
    attempt.cleanup = null
    return cleanup == null ? Promise.resolve() : runBoundedCleanup(cleanup)
  }

  private closeNativeStream(reason: NativeAudioStreamCloseReason): number {
    const streamId = this.nativeStreamId
    if (streamId == null) return 0
    const result = this.lib.audioCloseStream(this.engine, streamId, reason)
    if (result.status !== 0 || result.stats == null) return result.status === 0 ? -1 : result.status
    this.nativeStats = result.stats
    this.nativeStreamId = null
    return 0
  }

  private readNativeStats(): NativeAudioStreamStats | null {
    if (this.nativeStreamId == null) return this.nativeStats
    const stats = this.lib.audioGetStreamStats(this.engine, this.nativeStreamId)
    if (stats != null) this.nativeStats = stats
    return stats
  }

  private toPublicStats(): AudioStreamStats {
    const stats = this.nativeStats
    const sampleRate = stats?.sampleRate ?? 0
    const bufferedFrames = stats?.bufferedFrames ?? 0
    return {
      state: this.state,
      sampleRate,
      channels: stats?.channels ?? 0,
      bufferedFrames,
      capacityFrames: stats?.capacityFrames ?? 0,
      bufferedDurationMs: sampleRate === 0 ? 0 : (bufferedFrames * 1000) / sampleRate,
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
  private readonly streams = new Set<{ dispose(): void }>()
  private playbackStarted = false
  private mixerStarted = false
  private disposing = false

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

  async playStream<M = AudioStreamMetadata>(
    source: AudioStreamBody,
    options: AudioStreamBodyOptions<M> = {},
  ): Promise<AudioStream<M>> {
    const urlOptions = options as AudioStreamUrlOptions
    if (
      urlOptions.request !== undefined ||
      urlOptions.reconnect !== undefined ||
      urlOptions.metadataEncoding !== undefined
    ) {
      return Promise.reject(
        new TypeError("request, reconnect, and metadataEncoding options are only supported by playStreamUrl()"),
      )
    }
    if (!isReadableStreamSource(source) && !isAsyncIterableSource(source)) {
      return Promise.reject(new TypeError("Audio stream source must be a ReadableStream or AsyncIterable"))
    }
    const { demuxer, ...streamOptions } = options
    const connector: AudioStreamConnector<void> = {
      async connect() {
        return { body: source, info: undefined }
      },
    }
    return this.openStream(connector, demuxer == null ? undefined : () => demuxer(), streamOptions, "source")
  }

  async playStreamUrl(
    source: string | URL,
    options: AudioStreamUrlOptions = {},
  ): Promise<AudioStream<AudioStreamMetadata>> {
    if ((options as AudioStreamBodyOptions).demuxer !== undefined) {
      throw new TypeError("demuxer is only supported by playStream() and playStreamSource()")
    }
    if (typeof source !== "string" && Object.prototype.toString.call(source) !== "[object URL]") {
      return Promise.reject(new TypeError("Audio stream URL source must be a string or URL"))
    }
    const { request, metadataEncoding, reconnect, ...streamOptions } = options
    const encoding = resolveMetadataEncoding(metadataEncoding)
    const connector = createAudioStreamUrlConnector(
      source,
      resolveAudioStreamRequest(request),
      reconnect?.maxDelayMs ?? 15_000,
    )
    return this.openStream(
      connector,
      (info) => {
        try {
          return selectAudioStreamDemuxer({ headers: info.headers, metadataEncoding: encoding })
        } catch (cause) {
          throw new AudioStreamError(
            cause instanceof Error ? cause.message : "Invalid audio stream metadata response",
            { action: "response", status: info.status },
            cause,
          )
        }
      },
      { ...streamOptions, reconnect },
      "fetch",
    )
  }

  async playStreamSource<I, M = AudioStreamMetadata>(
    connector: AudioStreamConnector<I>,
    options: AudioStreamSourceOptions<I, M> = {},
  ): Promise<AudioStream<M>> {
    const urlOptions = options as AudioStreamUrlOptions
    if (urlOptions.request !== undefined || urlOptions.metadataEncoding !== undefined) {
      return Promise.reject(new TypeError("request and metadataEncoding are only supported by playStreamUrl()"))
    }
    const { demuxer, ...streamOptions } = options
    return this.openStream(connector, demuxer, streamOptions, "source")
  }

  private async openStream<I, M>(
    connector: AudioStreamConnector<I>,
    demuxer: ((info: I) => AudioStreamDemuxer<M> | null) | undefined,
    options: AudioStreamOptions & { reconnect?: AudioStreamReconnectOptions },
    readAction: "fetch" | "source",
  ): Promise<AudioStream<M>> {
    const engine = this.engine
    if (!engine) throw new Error("Audio engine unavailable during stream playback")
    const resolvedConnector = resolveAudioStreamConnector(connector)

    let stream: AudioStream<M>
    stream = createAudioStream({
      lib: this.lib,
      engine,
      connector: resolvedConnector,
      demuxer,
      options,
      readAction,
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
    if (!this.engine || this.disposing) return
    this.disposing = true
    try {
      for (const stream of [...this.streams]) stream.dispose()
      if (this.mixerStarted) {
        this.stop()
      }
      this.groups.clear()
      this.lib.destroyAudioEngine(this.engine)
      this.engine = null
      this.emit("disposed")
    } finally {
      this.disposing = false
    }
  }
}

export function setupAudio(options: AudioSetupOptions = {}): Audio {
  return Audio.create(options)
}
