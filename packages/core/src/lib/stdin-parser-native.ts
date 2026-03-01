import type { Pointer } from "bun:ffi"
import { StdinDrainStatsStruct, StdinTokenStruct, type StdinToken } from "../zig-structs"
import type { RenderLib } from "../zig"

type NativeStdinParserOptions = {
  timeoutMs?: number
  payloadBufferBytes?: number
  tokenCapacity?: number
  armTimeouts?: boolean
  onTimeoutFlush?: () => void
}

export class NativeStdinParser {
  private readonly tokenBuffer: Uint8Array
  private readonly payloadBuffer: Uint8Array
  private readonly statsBuffer = new ArrayBuffer(StdinDrainStatsStruct.size)
  private readonly timeoutMs: number
  private readonly armTimeouts: boolean
  private readonly onTimeoutFlush: (() => void) | null
  private timeoutId: Timer | null = null
  private destroyed = false

  constructor(
    private readonly lib: RenderLib,
    private readonly parserPtr: Pointer,
    options: NativeStdinParserOptions = {},
  ) {
    const tokenCapacity = options.tokenCapacity ?? 256
    const payloadBufferBytes = options.payloadBufferBytes ?? 64 * 1024
    this.timeoutMs = options.timeoutMs ?? 10
    this.armTimeouts = options.armTimeouts ?? true
    this.onTimeoutFlush = options.onTimeoutFlush ?? null
    this.tokenBuffer = new Uint8Array(StdinTokenStruct.size * tokenCapacity)
    this.payloadBuffer = new Uint8Array(payloadBufferBytes)
  }

  public push(data: Buffer): void {
    this.ensureAlive()
    if (data.length === 0) {
      return
    }

    const status = this.lib.stdinParserPush(this.parserPtr, data)
    if (status !== 0) {
      throw new Error(`stdinParserPush failed: ${status}`)
    }
    if (this.armTimeouts) {
      this.armTimeoutIfNeeded()
    }
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
}
