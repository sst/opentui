import { Buffer } from "node:buffer"
import { SystemClock, type Clock, type TimerHandle } from "./clock"
import { parseKeypress, type ParsedKey } from "./parse.keypress"
import { MouseParser, type RawMouseEvent } from "./parse.mouse"

export { SystemClock, type Clock, type TimerHandle } from "./clock"

export type StdinResponseProtocol = "csi" | "osc" | "dcs" | "apc" | "unknown"

export type StdinEvent =
  | {
      type: "key"
      raw: string
      key: ParsedKey
    }
  | {
      type: "mouse"
      raw: string
      encoding: "sgr" | "x10"
      event: RawMouseEvent
    }
  | {
      type: "paste"
      text: string
    }
  | {
      type: "response"
      protocol: StdinResponseProtocol
      sequence: string
    }

export interface StdinParserOptions {
  timeoutMs?: number
  maxPendingBytes?: number
  armTimeouts?: boolean
  onTimeoutFlush?: () => void
  useKittyKeyboard?: boolean
  clock?: Clock
}

type ParserState =
  | { tag: "ground" }
  | { tag: "utf8"; expected: number; seen: number }
  | { tag: "esc" }
  | { tag: "ss3" }
  | { tag: "csi" }
  | { tag: "osc"; sawEsc: boolean }
  | { tag: "dcs"; sawEsc: boolean }
  | { tag: "apc"; sawEsc: boolean }
  | { tag: "esc_less_mouse" }

interface PasteCollector {
  tail: Uint8Array
  decoder: TextDecoder
  parts: string[]
}

const DEFAULT_TIMEOUT_MS = 10
const DEFAULT_MAX_PENDING_BYTES = 64 * 1024
const INITIAL_PENDING_CAPACITY = 256
const ESC = 0x1b
const BEL = 0x07
const BRACKETED_PASTE_START = Buffer.from("\x1b[200~")
const BRACKETED_PASTE_END = Buffer.from("\x1b[201~")
const EMPTY_BYTES = new Uint8Array(0)
const KEY_DECODER = new TextDecoder()
const RXVT_DOLLAR_CSI_RE = /^\x1b\[\d+\$$/

const SYSTEM_CLOCK = new SystemClock()

class ByteQueue {
  private buf: Uint8Array
  private start = 0
  private end = 0

  constructor(capacity = INITIAL_PENDING_CAPACITY) {
    this.buf = new Uint8Array(capacity)
  }

  get length(): number {
    return this.end - this.start
  }

  get capacity(): number {
    return this.buf.length
  }

  view(): Uint8Array {
    return this.buf.subarray(this.start, this.end)
  }

  take(): Uint8Array {
    const chunk = this.view()
    this.start = 0
    this.end = 0
    return chunk
  }

  append(chunk: Uint8Array): void {
    if (chunk.length === 0) {
      return
    }

    this.ensureCapacity(this.length + chunk.length)
    this.buf.set(chunk, this.end)
    this.end += chunk.length
  }

  consume(count: number): void {
    if (count <= 0) {
      return
    }

    if (count >= this.length) {
      this.start = 0
      this.end = 0
      return
    }

    this.start += count
    if (this.start >= this.buf.length / 2) {
      this.buf.copyWithin(0, this.start, this.end)
      this.end -= this.start
      this.start = 0
    }
  }

  clear(): void {
    this.start = 0
    this.end = 0
  }

  reset(capacity = INITIAL_PENDING_CAPACITY): void {
    this.buf = new Uint8Array(capacity)
    this.start = 0
    this.end = 0
  }

  private ensureCapacity(requiredLength: number): void {
    const currentLength = this.length
    if (requiredLength <= this.buf.length) {
      const availableAtEnd = this.buf.length - this.end
      if (availableAtEnd >= requiredLength - currentLength) {
        return
      }

      this.buf.copyWithin(0, this.start, this.end)
      this.end = currentLength
      this.start = 0
      if (requiredLength <= this.buf.length) {
        return
      }
    }

    let nextCapacity = this.buf.length
    while (nextCapacity < requiredLength) {
      nextCapacity *= 2
    }

    const next = new Uint8Array(nextCapacity)
    next.set(this.view(), 0)
    this.buf = next
    this.start = 0
    this.end = currentLength
  }
}

function normalizePositiveOption(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback
  }

  return Math.floor(value)
}

function utf8SequenceLength(first: number): number {
  if (first < 0x80) return 1
  if (first >= 0xc2 && first <= 0xdf) return 2
  if (first >= 0xe0 && first <= 0xef) return 3
  if (first >= 0xf0 && first <= 0xf4) return 4
  return 0
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }

  return true
}

function isMouseSgrSequence(sequence: Uint8Array): boolean {
  if (sequence.length < 7) {
    return false
  }

  if (sequence[0] !== ESC || sequence[1] !== 0x5b || sequence[2] !== 0x3c) {
    return false
  }

  const final = sequence[sequence.length - 1]
  if (final !== 0x4d && final !== 0x6d) {
    return false
  }

  let part = 0
  let hasDigit = false
  for (let index = 3; index < sequence.length - 1; index += 1) {
    const byte = sequence[index]!
    if (byte >= 0x30 && byte <= 0x39) {
      hasDigit = true
      continue
    }

    if (byte === 0x3b && hasDigit && part < 2) {
      part += 1
      hasDigit = false
      continue
    }

    return false
  }

  return part === 2 && hasDigit
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length === 0) {
    return right
  }

  if (right.length === 0) {
    return left
  }

  const combined = new Uint8Array(left.length + right.length)
  combined.set(left, 0)
  combined.set(right, left.length)
  return combined
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  if (needle.length === 0) {
    return 0
  }

  const limit = haystack.length - needle.length
  for (let offset = 0; offset <= limit; offset += 1) {
    let matched = true
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[offset + index] !== needle[index]) {
        matched = false
        break
      }
    }

    if (matched) {
      return offset
    }
  }

  return -1
}

function decodeLatin1(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1")
}

function decodeUtf8(bytes: Uint8Array): string {
  return KEY_DECODER.decode(bytes)
}

function createPasteCollector(): PasteCollector {
  return {
    tail: EMPTY_BYTES,
    decoder: new TextDecoder(),
    parts: [],
  }
}

export class StdinParser {
  private readonly pending = new ByteQueue(INITIAL_PENDING_CAPACITY)
  private readonly events: StdinEvent[] = []
  private readonly timeoutMs: number
  private readonly maxPendingBytes: number
  private readonly armTimeouts: boolean
  private readonly onTimeoutFlush: (() => void) | null
  private readonly useKittyKeyboard: boolean
  private readonly mouseParser = new MouseParser()
  private readonly clock: Clock
  private timeoutId: TimerHandle | null = null
  private destroyed = false
  private pendingSinceMs: number | null = null
  private forceFlush = false
  private state: ParserState = { tag: "ground" }
  private cursor = 0
  private unitStart = 0
  private paste: PasteCollector | null = null

  constructor(options: StdinParserOptions = {}) {
    this.timeoutMs = normalizePositiveOption(options.timeoutMs, DEFAULT_TIMEOUT_MS)
    this.maxPendingBytes = normalizePositiveOption(options.maxPendingBytes, DEFAULT_MAX_PENDING_BYTES)
    this.armTimeouts = options.armTimeouts ?? true
    this.onTimeoutFlush = options.onTimeoutFlush ?? null
    this.useKittyKeyboard = options.useKittyKeyboard ?? true
    this.clock = options.clock ?? SYSTEM_CLOCK
  }

  public get bufferCapacity(): number {
    return this.pending.capacity
  }

  public push(data: Uint8Array): void {
    this.ensureAlive()
    if (data.length === 0) {
      return
    }

    let remainder = data
    while (remainder.length > 0) {
      if (this.paste) {
        remainder = this.consumePasteBytes(remainder)
        continue
      }

      const immediatePasteStartIndex =
        this.state.tag === "ground" && this.pending.length === 0 ? indexOfBytes(remainder, BRACKETED_PASTE_START) : -1
      const appendEnd =
        immediatePasteStartIndex === -1 ? remainder.length : immediatePasteStartIndex + BRACKETED_PASTE_START.length

      this.pending.append(remainder.subarray(0, appendEnd))
      remainder = remainder.subarray(appendEnd)
      this.scanPending()

      if (this.paste && this.pending.length > 0) {
        remainder = this.consumePasteBytes(this.takePendingBytes())
        continue
      }

      if (!this.paste && this.pending.length > this.maxPendingBytes) {
        this.flushPendingOverflow()
        this.scanPending()

        if (this.paste && this.pending.length > 0) {
          remainder = this.consumePasteBytes(this.takePendingBytes())
        }
      }
    }

    this.reconcileTimeoutState()
  }

  public read(): StdinEvent | null {
    this.ensureAlive()

    if (this.events.length === 0 && this.forceFlush) {
      this.scanPending()
      this.reconcileTimeoutState()
    }

    return this.events.shift() ?? null
  }

  public drain(onEvent: (event: StdinEvent) => void): void {
    this.ensureAlive()

    while (true) {
      if (this.destroyed) {
        return
      }

      const event = this.read()
      if (!event) {
        return
      }

      onEvent(event)
    }
  }

  public flushTimeout(nowMsValue: number = this.clock.now()): void {
    this.ensureAlive()

    if (this.paste || this.pendingSinceMs === null || this.pending.length === 0) {
      return
    }

    if (nowMsValue < this.pendingSinceMs || nowMsValue - this.pendingSinceMs < this.timeoutMs) {
      return
    }

    this.forceFlush = true
  }

  public reset(): void {
    if (this.destroyed) {
      return
    }

    this.clearTimeout()
    this.resetState()
  }

  public destroy(): void {
    if (this.destroyed) {
      return
    }

    this.clearTimeout()
    this.destroyed = true
    this.resetState()
  }

  private ensureAlive(): void {
    if (this.destroyed) {
      throw new Error("StdinParser has been destroyed")
    }
  }

  private scanPending(): void {
    while (!this.paste) {
      const bytes = this.pending.view()
      if (this.state.tag === "ground" && this.cursor >= bytes.length) {
        this.pending.clear()
        this.cursor = 0
        this.unitStart = 0
        this.pendingSinceMs = null
        this.forceFlush = false
        return
      }

      const byte = this.cursor < bytes.length ? bytes[this.cursor]! : -1
      switch (this.state.tag) {
        case "ground": {
          this.unitStart = this.cursor

          if (byte === 0x5b && this.cursor + 1 < bytes.length && bytes[this.cursor + 1] === 0x3c) {
            this.cursor += 2
            this.state = { tag: "esc_less_mouse" }
            continue
          }

          if (byte === ESC) {
            this.cursor += 1
            this.state = { tag: "esc" }
            continue
          }

          if (byte < 0x80) {
            this.emitKeyOrResponse("unknown", decodeUtf8(bytes.subarray(this.cursor, this.cursor + 1)))
            this.consumePrefix(this.cursor + 1)
            continue
          }

          const expected = utf8SequenceLength(byte)
          if (expected === 0) {
            if (!this.forceFlush && this.cursor + 1 === bytes.length) {
              this.markPending()
              return
            }

            this.emitLegacyHighByte(byte)
            this.consumePrefix(this.cursor + 1)
            continue
          }

          this.cursor += 1
          this.state = { tag: "utf8", expected, seen: 1 }
          continue
        }

        case "utf8": {
          if (this.cursor >= bytes.length) {
            if (!this.forceFlush) {
              this.markPending()
              return
            }

            this.emitLegacyHighByte(bytes[this.unitStart]!)
            this.state = { tag: "ground" }
            this.consumePrefix(this.unitStart + 1)
            continue
          }

          if ((byte & 0xc0) !== 0x80) {
            this.emitLegacyHighByte(bytes[this.unitStart]!)
            this.state = { tag: "ground" }
            this.consumePrefix(this.unitStart + 1)
            continue
          }

          const nextSeen = this.state.seen + 1
          this.cursor += 1
          if (nextSeen < this.state.expected) {
            this.state = { tag: "utf8", expected: this.state.expected, seen: nextSeen }
            continue
          }

          this.emitKeyOrResponse("unknown", decodeUtf8(bytes.subarray(this.unitStart, this.cursor)))
          this.state = { tag: "ground" }
          this.consumePrefix(this.cursor)
          continue
        }

        case "esc": {
          if (this.cursor >= bytes.length) {
            if (!this.forceFlush) {
              this.markPending()
              return
            }

            this.emitKeyOrResponse("unknown", decodeUtf8(bytes.subarray(this.unitStart, this.cursor)))
            this.state = { tag: "ground" }
            this.consumePrefix(this.cursor)
            continue
          }

          switch (byte) {
            case 0x5b:
              this.cursor += 1
              this.state = { tag: "csi" }
              continue
            case 0x4f:
              this.cursor += 1
              this.state = { tag: "ss3" }
              continue
            case 0x5d:
              this.cursor += 1
              this.state = { tag: "osc", sawEsc: false }
              continue
            case 0x50:
              this.cursor += 1
              this.state = { tag: "dcs", sawEsc: false }
              continue
            case 0x5f:
              this.cursor += 1
              this.state = { tag: "apc", sawEsc: false }
              continue
            case ESC:
              this.cursor += 1
              continue
            default:
              this.cursor += 1
              this.emitKeyOrResponse("unknown", decodeUtf8(bytes.subarray(this.unitStart, this.cursor)))
              this.state = { tag: "ground" }
              this.consumePrefix(this.cursor)
              continue
          }
        }

        case "ss3": {
          if (this.cursor >= bytes.length) {
            if (!this.forceFlush) {
              this.markPending()
              return
            }

            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor))
            this.state = { tag: "ground" }
            this.consumePrefix(this.cursor)
            continue
          }

          if (byte === ESC) {
            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor))
            this.state = { tag: "ground" }
            this.consumePrefix(this.cursor)
            continue
          }

          this.cursor += 1
          this.emitKeyOrResponse("unknown", decodeUtf8(bytes.subarray(this.unitStart, this.cursor)))
          this.state = { tag: "ground" }
          this.consumePrefix(this.cursor)
          continue
        }

        case "csi": {
          if (this.cursor >= bytes.length) {
            if (!this.forceFlush) {
              this.markPending()
              return
            }

            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor))
            this.state = { tag: "ground" }
            this.consumePrefix(this.cursor)
            continue
          }

          if (byte === ESC) {
            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor))
            this.state = { tag: "ground" }
            this.consumePrefix(this.cursor)
            continue
          }

          if (byte === 0x4d && this.cursor === this.unitStart + 2) {
            const end = this.cursor + 4
            if (bytes.length < end) {
              if (!this.forceFlush) {
                this.markPending()
                return
              }

              this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, bytes.length))
              this.state = { tag: "ground" }
              this.consumePrefix(bytes.length)
              continue
            }

            this.emitMouse(bytes.subarray(this.unitStart, end), "x10")
            this.state = { tag: "ground" }
            this.consumePrefix(end)
            continue
          }

          if (byte === 0x24) {
            const candidateEnd = this.cursor + 1
            const candidate = decodeUtf8(bytes.subarray(this.unitStart, candidateEnd))
            if (RXVT_DOLLAR_CSI_RE.test(candidate)) {
              this.emitKeyOrResponse("csi", candidate)
              this.state = { tag: "ground" }
              this.consumePrefix(candidateEnd)
              continue
            }

            if (!this.forceFlush && candidateEnd >= bytes.length) {
              this.markPending()
              return
            }
          }

          if (byte >= 0x40 && byte <= 0x7e) {
            const end = this.cursor + 1
            const rawBytes = bytes.subarray(this.unitStart, end)

            if (bytesEqual(rawBytes, BRACKETED_PASTE_START)) {
              this.state = { tag: "ground" }
              this.consumePrefix(end)
              this.paste = createPasteCollector()
              continue
            }

            if (isMouseSgrSequence(rawBytes)) {
              this.emitMouse(rawBytes, "sgr")
              this.state = { tag: "ground" }
              this.consumePrefix(end)
              continue
            }

            this.emitKeyOrResponse("csi", decodeUtf8(rawBytes))
            this.state = { tag: "ground" }
            this.consumePrefix(end)
            continue
          }

          this.cursor += 1
          continue
        }

        case "osc": {
          if (this.cursor >= bytes.length) {
            if (!this.forceFlush) {
              this.markPending()
              return
            }

            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor))
            this.state = { tag: "ground" }
            this.consumePrefix(this.cursor)
            continue
          }

          if (this.state.sawEsc) {
            if (byte === 0x5c) {
              const end = this.cursor + 1
              this.emitOpaqueResponse("osc", bytes.subarray(this.unitStart, end))
              this.state = { tag: "ground" }
              this.consumePrefix(end)
              continue
            }

            this.state = { tag: "osc", sawEsc: false }
            continue
          }

          if (byte === BEL) {
            const end = this.cursor + 1
            this.emitOpaqueResponse("osc", bytes.subarray(this.unitStart, end))
            this.state = { tag: "ground" }
            this.consumePrefix(end)
            continue
          }

          if (byte === ESC) {
            this.cursor += 1
            this.state = { tag: "osc", sawEsc: true }
            continue
          }

          this.cursor += 1
          continue
        }

        case "dcs": {
          if (this.cursor >= bytes.length) {
            if (!this.forceFlush) {
              this.markPending()
              return
            }

            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor))
            this.state = { tag: "ground" }
            this.consumePrefix(this.cursor)
            continue
          }

          if (this.state.sawEsc) {
            if (byte === 0x5c) {
              const end = this.cursor + 1
              this.emitOpaqueResponse("dcs", bytes.subarray(this.unitStart, end))
              this.state = { tag: "ground" }
              this.consumePrefix(end)
              continue
            }

            this.state = { tag: "dcs", sawEsc: false }
            continue
          }

          if (byte === ESC) {
            this.cursor += 1
            this.state = { tag: "dcs", sawEsc: true }
            continue
          }

          this.cursor += 1
          continue
        }

        case "apc": {
          if (this.cursor >= bytes.length) {
            if (!this.forceFlush) {
              this.markPending()
              return
            }

            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor))
            this.state = { tag: "ground" }
            this.consumePrefix(this.cursor)
            continue
          }

          if (this.state.sawEsc) {
            if (byte === 0x5c) {
              const end = this.cursor + 1
              this.emitOpaqueResponse("apc", bytes.subarray(this.unitStart, end))
              this.state = { tag: "ground" }
              this.consumePrefix(end)
              continue
            }

            this.state = { tag: "apc", sawEsc: false }
            continue
          }

          if (byte === ESC) {
            this.cursor += 1
            this.state = { tag: "apc", sawEsc: true }
            continue
          }

          this.cursor += 1
          continue
        }

        case "esc_less_mouse": {
          if (this.cursor >= bytes.length) {
            if (!this.forceFlush) {
              this.markPending()
              return
            }

            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor))
            this.state = { tag: "ground" }
            this.consumePrefix(this.cursor)
            continue
          }

          if ((byte >= 0x30 && byte <= 0x39) || byte === 0x3b) {
            this.cursor += 1
            continue
          }

          if (byte === 0x4d || byte === 0x6d) {
            const end = this.cursor + 1
            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, end))
            this.state = { tag: "ground" }
            this.consumePrefix(end)
            continue
          }

          this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor))
          this.state = { tag: "ground" }
          this.consumePrefix(this.cursor)
          continue
        }
      }
    }
  }

  private emitKeyOrResponse(protocol: StdinResponseProtocol, raw: string): void {
    const parsed = parseKeypress(raw, { useKittyKeyboard: this.useKittyKeyboard })
    if (parsed) {
      this.events.push({
        type: "key",
        raw: parsed.raw,
        key: parsed,
      })
      return
    }

    this.events.push({
      type: "response",
      protocol,
      sequence: raw,
    })
  }

  private emitMouse(rawBytes: Uint8Array, encoding: "sgr" | "x10"): void {
    const event = this.mouseParser.parseMouseEvent(rawBytes)
    if (!event) {
      this.emitOpaqueResponse("unknown", rawBytes)
      return
    }

    this.events.push({
      type: "mouse",
      raw: decodeLatin1(rawBytes),
      encoding,
      event,
    })
  }

  private emitLegacyHighByte(byte: number): void {
    const parsed = parseKeypress(Buffer.from([byte]), { useKittyKeyboard: this.useKittyKeyboard })
    if (parsed) {
      this.events.push({
        type: "key",
        raw: parsed.raw,
        key: parsed,
      })
      return
    }

    this.events.push({
      type: "response",
      protocol: "unknown",
      sequence: String.fromCharCode(byte),
    })
  }

  private emitOpaqueResponse(protocol: StdinResponseProtocol, rawBytes: Uint8Array): void {
    this.events.push({
      type: "response",
      protocol,
      sequence: decodeLatin1(rawBytes),
    })
  }

  private consumePrefix(endExclusive: number): void {
    this.pending.consume(endExclusive)
    this.cursor = 0
    this.unitStart = 0
    this.pendingSinceMs = null
    this.forceFlush = false
  }

  private takePendingBytes(): Uint8Array {
    const buffered = this.pending.take()
    this.cursor = 0
    this.unitStart = 0
    this.pendingSinceMs = null
    this.forceFlush = false
    return buffered
  }

  private flushPendingOverflow(): void {
    if (this.pending.length === 0) {
      return
    }

    this.emitOpaqueResponse("unknown", this.pending.view())
    this.pending.clear()
    this.cursor = 0
    this.unitStart = 0
    this.pendingSinceMs = null
    this.forceFlush = false
    this.state = { tag: "ground" }
  }

  private markPending(): void {
    this.pendingSinceMs = this.clock.now()
  }

  private consumePasteBytes(chunk: Uint8Array): Uint8Array {
    const paste = this.paste!
    const combined = concatBytes(paste.tail, chunk)
    const endIndex = indexOfBytes(combined, BRACKETED_PASTE_END)

    if (endIndex !== -1) {
      this.pushPasteText(combined.subarray(0, endIndex))
      const tailText = paste.decoder.decode()
      if (tailText.length > 0) {
        paste.parts.push(tailText)
      }

      this.events.push({
        type: "paste",
        text: paste.parts.join(""),
      })

      this.paste = null
      return combined.subarray(endIndex + BRACKETED_PASTE_END.length)
    }

    const keep = Math.min(BRACKETED_PASTE_END.length - 1, combined.length)
    const stableLength = combined.length - keep
    if (stableLength > 0) {
      this.pushPasteText(combined.subarray(0, stableLength))
    }

    paste.tail = combined.slice(stableLength)
    return EMPTY_BYTES
  }

  private pushPasteText(bytes: Uint8Array): void {
    if (bytes.length === 0) {
      return
    }

    const text = this.paste!.decoder.decode(bytes, { stream: true })
    if (text.length > 0) {
      this.paste!.parts.push(text)
    }
  }

  private reconcileTimeoutState(): void {
    if (!this.armTimeouts) {
      return
    }

    if (this.paste || this.pendingSinceMs === null || this.pending.length === 0) {
      this.clearTimeout()
      return
    }

    this.clearTimeout()
    this.timeoutId = this.clock.setTimeout(() => {
      this.timeoutId = null
      if (this.destroyed) {
        return
      }

      try {
        this.flushTimeout(this.clock.now())
        this.onTimeoutFlush?.()
      } catch (error) {
        console.error("stdin parser timeout flush failed", error)
      }
    }, this.timeoutMs)
  }

  private clearTimeout(): void {
    if (!this.timeoutId) {
      return
    }

    this.clock.clearTimeout(this.timeoutId)
    this.timeoutId = null
  }

  private resetState(): void {
    this.pending.reset(INITIAL_PENDING_CAPACITY)
    this.events.length = 0
    this.pendingSinceMs = null
    this.forceFlush = false
    this.state = { tag: "ground" }
    this.cursor = 0
    this.unitStart = 0
    this.paste = null
    this.mouseParser.reset()
  }
}
