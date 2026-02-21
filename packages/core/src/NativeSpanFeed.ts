import { toArrayBuffer, type Pointer } from "bun:ffi"
import { resolveRenderLib } from "./zig"
import { SpanInfoStruct } from "./zig-structs"
import type { GrowthPolicy, NativeSpanFeedOptions, NativeSpanFeedStats } from "./zig-structs"

export type { GrowthPolicy, NativeSpanFeedOptions, NativeSpanFeedStats } from "./zig-structs"

const enum EventId {
  ChunkAdded = 2,
  Closed = 5,
  Error = 6,
  DataAvailable = 7,
  StateBuffer = 8,
}

function toPointer(value: number | bigint): Pointer {
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Pointer exceeds safe integer range")
    }
    return Number(value) as Pointer
  }
  return value as Pointer
}

function toNumber(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value
}

type StreamEventHandler = (eventId: number, arg0: Pointer, arg1: number | bigint) => void

export type DataHandler = (data: Uint8Array) => void | Promise<void>

/**
 * Zero-copy wrapper over Zig memory; not a full stream interface.
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

  static attach(streamPtr: bigint | number, _options?: NativeSpanFeedOptions): NativeSpanFeed {
    const lib = resolveRenderLib()
    const ptr = toPointer(streamPtr)
    const stream = new NativeSpanFeed(ptr)

    lib.registerNativeSpanFeedStream(ptr, stream.eventHandler)

    const status = lib.attachNativeSpanFeed(ptr)
    if (status !== 0) {
      lib.unregisterNativeSpanFeedStream(ptr)
      throw new Error(`Failed to attach stream: ${status}`)
    }

    return stream
  }

  readonly streamPtr: Pointer
  private readonly lib = resolveRenderLib()
  private readonly eventHandler: StreamEventHandler
  private chunkMap = new Map<Pointer, ArrayBuffer>()
  private chunkSizes = new Map<Pointer, number>()
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

  private constructor(streamPtr: Pointer) {
    this.streamPtr = streamPtr
    this.eventHandler = (eventId, arg0, arg1) => {
      this.handleEvent(eventId, arg0, arg1)
    }
    this.ensureDrainBuffer()
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
    return () => this.dataHandlers.delete(handler)
  }

  onError(handler: (code: number) => void): () => void {
    this.errorHandlers.add(handler)
    return () => this.errorHandlers.delete(handler)
  }

  close(): void {
    if (this.destroyed) return
    if (this.inCallback || this.draining || this.pendingAsyncHandlers > 0) {
      this.pendingClose = true
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
    this.performClose()
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
    this.stateBuffer = null
    this.drainBuffer = null
    this.dataHandlers.clear()
    this.errorHandlers.clear()
    this.pendingDataAvailable = false
  }

  private handleEvent(eventId: number, arg0: Pointer, arg1: number | bigint): void {
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
            break
          }
          this.drainAll()
          break
        }
        case EventId.ChunkAdded: {
          const chunkLen = toNumber(arg1)
          if (chunkLen > 0 && arg0) {
            if (!this.chunkMap.has(arg0)) {
              const buffer = toArrayBuffer(arg0, 0, chunkLen)
              this.chunkMap.set(arg0, buffer)
            }
            this.chunkSizes.set(arg0, chunkLen)
          }
          break
        }
        case EventId.Error: {
          const code = arg0
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
    }
  }

  private decrementRefcount(chunkIndex: number): void {
    if (this.stateBuffer && chunkIndex < this.stateBuffer.length) {
      const prev = this.stateBuffer[chunkIndex]
      this.stateBuffer[chunkIndex] = prev > 0 ? prev - 1 : 0
    }
  }

  private drainOnce(): number {
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
        if (span.len === 0) continue

        let buffer = this.chunkMap.get(span.chunkPtr)
        if (!buffer) {
          const size = this.chunkSizes.get(span.chunkPtr)
          if (!size) continue
          buffer = toArrayBuffer(span.chunkPtr, 0, size)
          this.chunkMap.set(span.chunkPtr, buffer)
        }

        if (span.offset + span.len > buffer.byteLength) continue

        const slice = new Uint8Array(buffer, span.offset, span.len)
        let asyncResults: Promise<void>[] | null = null

        for (const handler of this.dataHandlers) {
          try {
            const result = handler(slice)
            // Async handlers keep the chunk pinned until they settle.
            if (result && typeof result.then === "function") {
              asyncResults ??= []
              asyncResults.push(result)
            }
          } catch (e) {
            firstError ??= e
          }
        }

        const shouldStopAfterThisSpan = this.pendingClose

        if (asyncResults) {
          // Use allSettled so rejections still release refcounts.
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

        if (shouldStopAfterThisSpan) break
      }
    } finally {
      this.draining = false
    }

    if (firstError) throw firstError

    return count
  }

  drainAll(): void {
    let count = this.drainOnce()
    while (count > 0) {
      count = this.drainOnce()
    }
  }
}
