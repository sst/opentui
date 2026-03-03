import { toArrayBuffer, type Pointer } from "bun:ffi"
import { StdinPayloadRefStruct, StdinTokenStruct, type StdinToken } from "../zig-structs"
import type { RenderLib } from "../zig"

type NativeStdinParserOptions = {
  timeoutMs?: number
  armTimeouts?: boolean
  onTimeoutFlush?: () => void
}

const PARSER_NEXT_NONE = 0
const PARSER_NEXT_TOKEN = 1
const PARSER_NEXT_PENDING = 2
const EMPTY_PAYLOAD = new Uint8Array(0)

export class NativeStdinParser {
  private readonly tokenBuffer = new ArrayBuffer(StdinTokenStruct.size)
  private readonly payloadRefBuffer = new ArrayBuffer(StdinPayloadRefStruct.size)
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
    this.timeoutMs = options.timeoutMs ?? 10
    this.armTimeouts = options.armTimeouts ?? true
    this.onTimeoutFlush = options.onTimeoutFlush ?? null
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
      if (this.destroyed) {
        return
      }

      const { status, payload } = this.lib.stdinParserNext(this.parserPtr, this.tokenBuffer, this.payloadRefBuffer)

      if (status === PARSER_NEXT_TOKEN) {
        const token = StdinTokenStruct.unpack(this.tokenBuffer) as StdinToken
        const payloadBytes =
          payload.payloadPtr && payload.payloadLen > 0
            ? // stdinParserNext returns a borrowed pointer into parser-owned memory.
              // Copy now so callbacks never hold dangling/aliased views.
              new Uint8Array(toArrayBuffer(payload.payloadPtr, 0, payload.payloadLen)).slice()
            : EMPTY_PAYLOAD
        onToken(token, payloadBytes)

        if (this.destroyed) {
          return
        }

        continue
      }

      if (status === PARSER_NEXT_NONE || status === PARSER_NEXT_PENDING) {
        if (this.armTimeouts) {
          this.reconcileTimeout(status === PARSER_NEXT_PENDING)
        }
        return
      }

      throw new Error(`stdinParserNext failed: ${status}`)
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
