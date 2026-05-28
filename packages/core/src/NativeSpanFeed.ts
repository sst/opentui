import { toArrayBuffer, type Pointer } from "./platform/ffi.js"
import { resolveRenderLib } from "./zig.js"
import { SpanInfoStruct } from "./zig-structs.js"
import type { NativeSpanFeedOptions } from "./zig-structs.js"

export type { GrowthPolicy, NativeSpanFeedOptions, NativeSpanFeedStats } from "./zig-structs.js"

const enum EventId {
  ChunkAdded = 2,
  Closed = 5,
  Error = 6,
  DataAvailable = 7,
  StateBuffer = 8,
  SpanAvailable = 9,
}

function toNumber(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value
}

type StreamEventHandler = (eventId: number, arg0: Pointer, arg1: number, arg2?: number, arg3?: number) => void

export type DataHandler = (data: Uint8Array) => void | Promise<void>

/**
 * Zero-copy wrapper over Zig memory; not a full stream interface.
 * Chunk and state typed-array views are borrowed and invalid after destroy.
 */
export class NativeSpanFeed {
  static create(options?: NativeSpanFeedOptions): NativeSpanFeed {
    const lib = resolveRenderLib()
    const streamPtr = lib.createNativeSpanFeed(options)
    const stream = new NativeSpanFeed(streamPtr)

    lib.registerNativeSpanFeedStream(streamPtr, stream.eventHandler)

    const status = lib.attachNativeSpanFeed(streamPtr)
    if (status !== 0) {
      lib.unregisterNativeSpanFeedStream(streamPtr)
      lib.destroyNativeSpanFeed(streamPtr)
      throw new Error(`Failed to attach stream: ${status}`)
    }

    return stream
  }

  static attach(streamPtr: Pointer, _options?: NativeSpanFeedOptions): NativeSpanFeed {
    const lib = resolveRenderLib()
    const stream = new NativeSpanFeed(streamPtr)

    lib.registerNativeSpanFeedStream(streamPtr, stream.eventHandler)

    const status = lib.attachNativeSpanFeed(streamPtr)
    if (status !== 0) {
      lib.unregisterNativeSpanFeedStream(streamPtr)
      throw new Error(`Failed to attach stream: ${status}`)
    }

    return stream
  }

  readonly streamPtr: Pointer
  private readonly lib = resolveRenderLib()
  private readonly eventHandler: StreamEventHandler
  private chunkMap = new Map<Pointer, ArrayBuffer>()
  private chunkSizes = new Map<Pointer, number>()
  private chunkViews = new Map<Pointer, Uint8Array>()
  private lastChunkPtr: Pointer | null = null
  private lastChunkBuffer: ArrayBuffer | null = null
  private lastChunkView: Uint8Array | null = null
  private dataHandlers = new Set<DataHandler>()
  private errorHandlers = new Set<(code: number) => void>()
  private drainBuffer: Uint8Array | null = null
  private stateBuffer: Uint8Array | null = null
  private closed = false
  private destroyed = false
  private draining = false
  private pendingDataAvailable = false
  private pendingClose = false
  private closing = false
  private pendingAsyncHandlers = 0
  private inCallback = false
  private closeQueued = false
  private idleResolvers: Array<() => void> = []

  private constructor(streamPtr: Pointer) {
    this.streamPtr = streamPtr
    this.eventHandler = (eventId, arg0, arg1, arg2, arg3) => {
      this.handleEvent(eventId, arg0, arg1, arg2, arg3)
    }
  }

  private ensureDrainBuffer(): void {
    if (this.drainBuffer) return
    const capacity = 256
    this.drainBuffer = new Uint8Array(capacity * SpanInfoStruct.size)
  }

  onData(handler: DataHandler): () => void {
    this.dataHandlers.add(handler)
    if (this.pendingDataAvailable) {
      this.pendingDataAvailable = false
      this.drainAll()
    }
    this.updateDirectCallbackMode()
    return () => {
      this.dataHandlers.delete(handler)
      this.updateDirectCallbackMode()
    }
  }

  private updateDirectCallbackMode(): void {
    if (this.destroyed) return
    this.lib.streamSetDirectCallback(this.streamPtr, this.dataHandlers.size > 0 && !this.pendingDataAvailable)
  }

  onError(handler: (code: number) => void): () => void {
    this.errorHandlers.add(handler)
    return () => this.errorHandlers.delete(handler)
  }

  private hasPinnedChunks(): boolean {
    if (!this.stateBuffer) return false
    for (const refcount of this.stateBuffer) {
      if (refcount > 0) return true
    }
    return false
  }

  isBackpressured(): boolean {
    return this.pendingAsyncHandlers > 0 || this.pendingDataAvailable || this.hasPinnedChunks()
  }

  close(): void {
    if (this.destroyed) return
    if (this.inCallback || this.draining || this.pendingAsyncHandlers > 0) {
      this.pendingClose = true
      this.closing = true
      if (!this.closeQueued) {
        this.closeQueued = true
        queueMicrotask(() => {
          this.closeQueued = false
          this.processPendingClose()
        })
      }
      return
    }
    this.performClose()
  }

  private processPendingClose(): void {
    if (!this.pendingClose || this.destroyed) return
    if (this.inCallback || this.draining || this.pendingAsyncHandlers > 0) return
    this.pendingClose = false
    this.closing = false
    this.performClose()
    this.resolveIdleIfNeeded()
  }

  private performClose(): void {
    if (this.closing) return
    this.closing = true
    if (!this.closed) {
      const status = this.lib.streamClose(this.streamPtr)
      if (status !== 0) {
        this.closing = false
        return
      }
      this.closed = true
    }
    this.finalizeDestroy()
  }

  private finalizeDestroy(): void {
    if (this.destroyed) return
    this.lib.unregisterNativeSpanFeedStream(this.streamPtr)
    this.lib.destroyNativeSpanFeed(this.streamPtr)
    this.destroyed = true
    this.chunkMap.clear()
    this.chunkSizes.clear()
    this.chunkViews.clear()
    this.lastChunkPtr = null
    this.lastChunkBuffer = null
    this.lastChunkView = null
    this.stateBuffer = null
    this.drainBuffer = null
    this.dataHandlers.clear()
    this.errorHandlers.clear()
    this.pendingDataAvailable = false
    this.resolveIdleIfNeeded()
  }

  private isIdle(): boolean {
    return (
      !this.inCallback &&
      !this.draining &&
      this.pendingAsyncHandlers === 0 &&
      !this.pendingDataAvailable &&
      !this.hasPinnedChunks()
    )
  }

  private resolveIdleIfNeeded(): void {
    if (!this.isIdle()) return
    const resolvers = this.idleResolvers.splice(0)
    for (const resolve of resolvers) {
      resolve()
    }
  }

  idle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve()
    return new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve)
    })
  }

  private handleEvent(eventId: number, arg0: Pointer, arg1: number, arg2: number = 0, arg3: number = 0): void {
    this.inCallback = true
    try {
      switch (eventId) {
        case EventId.StateBuffer: {
          const len = toNumber(arg1)
          if (len > 0 && arg0) {
            // toArrayBuffer must alias Zig memory so refcount writes are visible.
            const buffer = toArrayBuffer(arg0, 0, len)
            this.stateBuffer = new Uint8Array(buffer)
          }
          break
        }
        case EventId.DataAvailable: {
          if (this.closing) break
          if (this.dataHandlers.size === 0) {
            this.pendingDataAvailable = true
            this.updateDirectCallbackMode()
            break
          }
          this.drainAll()
          break
        }
        case EventId.SpanAvailable: {
          if (this.closing) break
          if (this.dataHandlers.size === 0) {
            this.pendingDataAvailable = true
            this.updateDirectCallbackMode()
            break
          }
          this.handleSpan({ chunkPtr: arg0, offset: arg1, len: arg2, chunkIndex: arg3 })
          break
        }
        case EventId.ChunkAdded: {
          const chunkLen = toNumber(arg1)
          if (chunkLen > 0 && arg0) {
            if (!this.chunkMap.has(arg0)) {
              const buffer = toArrayBuffer(arg0, 0, chunkLen)
              this.chunkMap.set(arg0, buffer)
              const view = new Uint8Array(buffer)
              this.chunkViews.set(arg0, view)
              this.lastChunkPtr = arg0
              this.lastChunkBuffer = buffer
              this.lastChunkView = view
            }
            this.chunkSizes.set(arg0, chunkLen)
          }
          break
        }
        case EventId.Error: {
          const code = toNumber(arg0)
          for (const handler of this.errorHandlers) handler(code)
          break
        }
        case EventId.Closed: {
          this.closed = true
          break
        }
        default:
          break
      }
    } finally {
      this.inCallback = false
      this.resolveIdleIfNeeded()
    }
  }

  private decrementRefcount(chunkIndex: number): void {
    if (this.stateBuffer && chunkIndex < this.stateBuffer.length) {
      const prev = this.stateBuffer[chunkIndex]
      this.stateBuffer[chunkIndex] = prev > 0 ? prev - 1 : 0
    }
  }

  private drainOnce(): number {
    this.ensureDrainBuffer()
    if (!this.drainBuffer || this.draining || this.pendingClose) return 0
    const capacity = Math.floor(this.drainBuffer.byteLength / SpanInfoStruct.size)
    if (capacity === 0) return 0

    const count = this.lib.streamDrainSpans(this.streamPtr, this.drainBuffer, capacity)
    if (count === 0) return 0

    this.draining = true
    const spans = SpanInfoStruct.unpackList(this.drainBuffer.buffer, count)
    let firstError: unknown = null

    try {
      for (const span of spans) {
        try {
          this.handleSpan(span)
        } catch (error) {
          firstError ??= error
        }
        if (this.pendingClose) break
      }
    } finally {
      this.draining = false
      this.resolveIdleIfNeeded()
    }

    if (firstError) throw firstError

    return count
  }

  private handleSpan(span: { chunkPtr: Pointer; offset: number; len: number; chunkIndex: number }): void {
    if (span.len === 0) return

    let buffer = span.chunkPtr === this.lastChunkPtr ? this.lastChunkBuffer : null
    if (!buffer) {
      const cached = this.chunkMap.get(span.chunkPtr)
      if (cached) buffer = cached
    }
    if (!buffer) {
      const size = this.chunkSizes.get(span.chunkPtr)
      if (!size) return
      buffer = toArrayBuffer(span.chunkPtr, 0, size)
      this.chunkMap.set(span.chunkPtr, buffer)
    }
    let fullChunkView = span.chunkPtr === this.lastChunkPtr ? this.lastChunkView : null
    if (!fullChunkView) {
      const cached = this.chunkViews.get(span.chunkPtr)
      if (cached) fullChunkView = cached
    }
    if (!fullChunkView) {
      fullChunkView = new Uint8Array(buffer)
      this.chunkViews.set(span.chunkPtr, fullChunkView)
    }
    this.lastChunkPtr = span.chunkPtr
    this.lastChunkBuffer = buffer
    this.lastChunkView = fullChunkView

    if (span.offset + span.len > buffer.byteLength) return

    const slice = span.offset === 0 && span.len === fullChunkView.byteLength ? fullChunkView : new Uint8Array(buffer, span.offset, span.len)
    let asyncResults: Promise<void>[] | null = null
    let firstError: unknown = null

    const runHandler = (handler: DataHandler): void => {
      try {
        const result = handler(slice)
        // Async handlers keep the chunk pinned until they settle.
        if (result && typeof result.then === "function") {
          asyncResults ??= []
          asyncResults.push(result)
        }
      } catch (error) {
        firstError ??= error
      }
    }

    if (this.dataHandlers.size === 1) {
      const firstHandler = this.dataHandlers.values().next().value
      if (firstHandler) {
        runHandler(firstHandler)
        if (this.dataHandlers.size !== 1 || !this.dataHandlers.has(firstHandler)) {
          for (const handler of this.dataHandlers) {
            if (handler !== firstHandler) runHandler(handler)
          }
        }
      }
    } else {
      for (const handler of this.dataHandlers) runHandler(handler)
    }

    if (asyncResults) {
      const chunkIndex = span.chunkIndex
      this.pendingAsyncHandlers += 1
      Promise.allSettled(asyncResults).then(() => {
        this.decrementRefcount(chunkIndex)
        this.pendingAsyncHandlers -= 1
        this.processPendingClose()
      })
    } else {
      this.decrementRefcount(span.chunkIndex)
    }

    if (firstError) throw firstError
  }

  drainAll(): void {
    let count = this.drainOnce()
    while (count > 0) {
      count = this.drainOnce()
    }
  }
}
