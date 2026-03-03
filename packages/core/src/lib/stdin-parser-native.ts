import type { Pointer } from "bun:ffi"
import { StdinDrainStatsStruct, StdinTokenStruct, type StdinToken } from "../zig-structs"
import type { RenderLib } from "../zig"

type NativeStdinParserOptions = {
  timeoutMs?: number
  payloadBufferBytes?: number
  tokenCapacity?: number
  maxPayloadBufferBytes?: number
  maxTokenCapacity?: number
  armTimeouts?: boolean
  onTimeoutFlush?: () => void
}

export class NativeStdinParser {
  private tokenBuffer: Uint8Array
  private payloadBuffer: Uint8Array
  private readonly statsBuffer = new ArrayBuffer(StdinDrainStatsStruct.size)
  private readonly timeoutMs: number
  private readonly maxPayloadBufferBytes: number
  private readonly maxTokenCapacity: number
  private readonly armTimeouts: boolean
  private readonly onTimeoutFlush: (() => void) | null
  private timeoutId: Timer | null = null
  private destroyed = false

  constructor(
    private readonly lib: RenderLib,
    private readonly parserPtr: Pointer,
    options: NativeStdinParserOptions = {},
  ) {
    const tokenCapacity = Math.max(1, options.tokenCapacity ?? 256)
    const payloadBufferBytes = Math.max(1, options.payloadBufferBytes ?? 64 * 1024)
    this.timeoutMs = options.timeoutMs ?? 10
    this.maxPayloadBufferBytes = Math.max(payloadBufferBytes, options.maxPayloadBufferBytes ?? 8 * 1024 * 1024)
    this.maxTokenCapacity = Math.max(tokenCapacity, options.maxTokenCapacity ?? 8192)
    this.armTimeouts = options.armTimeouts ?? true
    this.onTimeoutFlush = options.onTimeoutFlush ?? null
    this.tokenBuffer = new Uint8Array(StdinTokenStruct.size * tokenCapacity)
    this.payloadBuffer = new Uint8Array(payloadBufferBytes)
  }

  public push(data: Buffer): boolean {
    this.ensureAlive()
    if (data.length === 0) {
      return true
    }

    const status = this.lib.stdinParserPush(this.parserPtr, data)
    if (status === -2) {
      return false
    }
    if (status !== 0) {
      throw new Error(`stdinParserPush failed: ${status}`)
    }
    if (this.armTimeouts) {
      this.armTimeoutIfNeeded()
    }
    return true
  }

  public drain(onToken: (token: StdinToken, payload: Uint8Array) => void): void {
    this.ensureAlive()

    while (true) {
      const { status, stats } = this.lib.stdinParserDrain(
        this.parserPtr,
        this.tokenBuffer,
        this.payloadBuffer,
        this.statsBuffer,
      )

      if (status !== 0) {
        throw new Error(`stdinParserDrain failed: ${status}`)
      }

      if (stats.overflowed === 1 && stats.tokenCount === 0 && stats.hasPending === 1) {
        if (this.tryGrowScratchBuffers()) {
          continue
        }

        throw new Error("stdinParserDrain overflow without progress (max scratch buffers reached)")
      }

      if (stats.tokenCount === 0) {
        if (this.armTimeouts) {
          this.reconcileTimeout(stats.hasPending === 1)
        }
        return
      }

      const tokens = StdinTokenStruct.unpackList(this.tokenBuffer.buffer, stats.tokenCount) as StdinToken[]
      for (const token of tokens) {
        const start = token.payloadOffset
        const end = start + token.payloadLen
        onToken(token, this.payloadBuffer.subarray(start, end))
      }
    }
  }

  public flushTimeout(nowMs: number): void {
    this.ensureAlive()
    const status = this.lib.stdinParserFlushTimeout(this.parserPtr, nowMs)
    if (status !== 0) {
      throw new Error(`stdinParserFlushTimeout failed: ${status}`)
    }
  }

  public reset(): void {
    if (this.destroyed) {
      return
    }

    this.clearTimeout()
    const status = this.lib.stdinParserReset(this.parserPtr)
    if (status !== 0) {
      throw new Error(`stdinParserReset failed: ${status}`)
    }
  }

  public destroy(): void {
    if (this.destroyed) {
      return
    }

    this.clearTimeout()
    this.lib.destroyStdinParser(this.parserPtr)
    this.destroyed = true
  }

  private ensureAlive(): void {
    if (this.destroyed) {
      throw new Error("NativeStdinParser has been destroyed")
    }
  }

  private armTimeoutIfNeeded(): void {
    if (this.timeoutId) {
      return
    }

    this.timeoutId = setTimeout(() => {
      this.timeoutId = null
      if (this.destroyed) {
        return
      }

      try {
        this.flushTimeout(Date.now())
        this.onTimeoutFlush?.()
      } catch (error) {
        console.error("stdin parser timeout flush failed", error)
      }
    }, this.timeoutMs)
  }

  private reconcileTimeout(hasPending: boolean): void {
    if (!hasPending) {
      this.clearTimeout()
      return
    }

    if (!this.timeoutId) {
      this.armTimeoutIfNeeded()
    }
  }

  private clearTimeout(): void {
    if (!this.timeoutId) {
      return
    }

    clearTimeout(this.timeoutId)
    this.timeoutId = null
  }

  private tryGrowScratchBuffers(): boolean {
    let grew = false

    const currentTokenCapacity = Math.floor(this.tokenBuffer.byteLength / StdinTokenStruct.size)
    if (currentTokenCapacity < this.maxTokenCapacity) {
      const nextTokenCapacity = Math.min(currentTokenCapacity * 2, this.maxTokenCapacity)
      if (nextTokenCapacity > currentTokenCapacity) {
        this.tokenBuffer = new Uint8Array(StdinTokenStruct.size * nextTokenCapacity)
        grew = true
      }
    }

    if (this.payloadBuffer.byteLength < this.maxPayloadBufferBytes) {
      const nextPayloadBytes = Math.min(this.payloadBuffer.byteLength * 2, this.maxPayloadBufferBytes)
      if (nextPayloadBytes > this.payloadBuffer.byteLength) {
        this.payloadBuffer = new Uint8Array(nextPayloadBytes)
        grew = true
      }
    }

    return grew
  }
}
