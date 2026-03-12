// Byte-level stdin parser that turns raw terminal input into typed StdinEvents.
//
// This replaces a two-phase token -> decode pipeline with a single state machine
// that produces fully typed events (key, mouse, paste, response) directly from
// bytes. The parser owns all byte framing and protocol recognition. It does NOT
// own event dispatch — that belongs to KeyHandler and the renderer.

import { Buffer } from "node:buffer"
import { SystemClock, type Clock, type TimerHandle } from "./clock"
import { parseKeypress, type ParsedKey } from "./parse.keypress"
import { MouseParser, type RawMouseEvent } from "./parse.mouse"

export { SystemClock, type Clock, type TimerHandle } from "./clock"

export type StdinResponseProtocol = "csi" | "osc" | "dcs" | "apc" | "unknown"

// The four event types the parser produces. Everything stdin sends becomes
// exactly one of these.
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

// State machine tags for the byte scanner. Each tag represents which protocol
// framing mode the parser is currently inside. The sawEsc flag in osc/dcs/apc
// tracks whether the previous byte was ESC, since the two-byte ST terminator
// (ESC \) can split across push() calls.
type ParserState =
  | { tag: "ground" }
  | { tag: "utf8"; expected: number; seen: number }
  | { tag: "esc" }
  | { tag: "ss3" }
  | { tag: "csi" }
  | { tag: "osc"; sawEsc: boolean }
  | { tag: "dcs"; sawEsc: boolean }
  | { tag: "apc"; sawEsc: boolean }
  | { tag: "esc_recovery" }
  | { tag: "esc_less_mouse" }
  | { tag: "esc_less_x10_mouse" }

// Collects paste body incrementally, bypassing the main ByteQueue so large
// pastes don't grow the parser buffer. Keeps only a small tail for end-marker
// detection across chunk boundaries.
interface PasteCollector {
  tail: Uint8Array
  decoder: TextDecoder
  parts: string[]
}

// 10ms is enough to distinguish a lone ESC keypress from the start of an
// escape sequence on all but the slowest connections.
const DEFAULT_TIMEOUT_MS = 10
const DEFAULT_MAX_PENDING_BYTES = 64 * 1024
const INITIAL_PENDING_CAPACITY = 256
const ESC = 0x1b
const BEL = 0x07
const BRACKETED_PASTE_START = Buffer.from("\x1b[200~")
const BRACKETED_PASTE_END = Buffer.from("\x1b[201~")
const EMPTY_BYTES = new Uint8Array(0)
const KEY_DECODER = new TextDecoder()
// rxvt uses $-terminated CSI sequences for shifted function keys (e.g. ESC[2$).
// Standard CSI treats $ as an intermediate byte, not a final, so we match these
// explicitly to avoid waiting for a "real" final byte that never arrives.
const RXVT_DOLLAR_CSI_RE = /^\x1b\[\d+\$$/

const SYSTEM_CLOCK = new SystemClock()

// Byte buffer for pending input. Uses start/end offsets so consume() just
// advances the start pointer without copying. Compacts (via copyWithin) only
// when the consumed prefix exceeds half the buffer, keeping amortized cost low.
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

  // Returns a view of the contents and resets the queue. The view shares
  // the underlying buffer, so it becomes invalid on the next append().
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

  // Drops the first `count` bytes. Compacts when the consumed prefix
  // exceeds half the buffer to reclaim wasted space at the front.
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

  // Tries reclaiming space by compacting data to the front first.
  // Doubles the allocation if that still isn't enough.
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

// Returns the expected byte count for a UTF-8 sequence given its lead byte,
// or 0 for bytes that aren't valid UTF-8 leads. Returning 0 tells the parser
// this is a legacy high-byte character (0x80–0xBF, 0xC0–0xC1, 0xF5+) that
// goes through the parseKeypress() meta-key path instead.
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

// Checks whether a byte sequence is a complete SGR mouse report:
// ESC [ < Ps ; Ps ; Ps M/m  (three semicolon-separated digit groups).
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

// Decodes raw protocol bytes as latin1. Used for mouse and response events
// where the wire bytes may not be valid UTF-8 but need a lossless string
// form for downstream sequence handlers.
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

// Push-driven stdin parser. Callers feed raw bytes via push(), then read
// typed events via read() or drain(). At most one incomplete protocol unit
// is buffered at a time; everything else is immediately converted to events.
//
// The parser guarantees chunk-shape invariance: the same bytes always produce
// the same events, regardless of chunk boundaries. A lone ESC resolves via
// timeout, split UTF-8 codepoints reassemble correctly, and bracketed paste
// markers may split across any chunk boundary.
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
  // When the current incomplete unit first appeared. Null when nothing is pending.
  private pendingSinceMs: number | null = null
  // When true, the state machine treats the current incomplete prefix as
  // final and emits it as one atomic event (e.g. a lone ESC becomes an
  // Escape key). Set by the timeout, consumed by the next read() or drain().
  private forceFlush = false
  // True only immediately after a timeout flush emits a lone ESC key. The next
  // `[` may begin a delayed `[<...M/m` mouse continuation recovery path.
  private justFlushedEsc = false
  private state: ParserState = { tag: "ground" }
  // Scan position within pending.view() during scanPending().
  private cursor = 0
  // Start of the protocol unit currently being parsed. The bytes from
  // unitStart through cursor all belong to one atomic unit.
  private unitStart = 0
  // When non-null, the parser is inside a bracketed paste. All incoming
  // bytes flow through consumePasteBytes() instead of the normal state machine.
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

  // Feeds raw stdin bytes into the parser. Converts as much as possible into
  // queued events and leaves at most one incomplete unit behind in pending.
  //
  // When a chunk contains a paste start marker, bytes before the marker go
  // through normal parsing, then paste mode takes over for the rest. This
  // prevents large pastes from growing the main buffer.
  public push(data: Uint8Array): void {
    this.ensureAlive()
    if (data.length === 0) {
      // Preserve the existing empty-chunk -> empty-keypress behavior.
      this.emitKeyOrResponse("unknown", "")
      return
    }

    let remainder = data
    while (remainder.length > 0) {
      if (this.paste) {
        remainder = this.consumePasteBytes(remainder)
        continue
      }

      // If we're in ground state with nothing pending, scan the incoming
      // chunk for a paste start marker. Only append through the marker so
      // scanPending() enters paste mode without buffering the full paste.
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

  // Pops one event from the queue. If the queue is empty and a timeout has
  // set forceFlush, re-scans pending to convert the timed-out incomplete
  // unit into one final event before returning it.
  public read(): StdinEvent | null {
    this.ensureAlive()

    if (this.events.length === 0 && this.forceFlush) {
      this.scanPending()
      this.reconcileTimeoutState()
    }

    return this.events.shift() ?? null
  }

  // Delivers all queued events. Stops early if the parser is destroyed
  // during a callback (e.g. an event handler triggers teardown).
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

  // Marks the parser for forced flush if enough time has passed since
  // incomplete data arrived. Does not immediately emit events — the next
  // read() or drain() does the actual flush. This separation keeps the
  // timer callback from emitting events mid-flight in user code.
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

  public resetMouseState(): void {
    this.ensureAlive()
    this.mouseParser.reset()
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

  // Scans the pending byte buffer one byte at a time, dispatching on the
  // current parser state. All protocol framing lives in this single switch
  // — intentionally not split into per-mode scan helpers.
  //
  // Exits when: all bytes consumed (ground), more bytes needed (incomplete
  // unit), or paste mode entered (body handled by consumePasteBytes).
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

          // After a timeout-flushed lone ESC, a following `[` may be the start
          // of a delayed `[<...M/m` mouse continuation. Recover only this narrow
          // case; otherwise clear the recovery flag and parse bytes normally.
          if (this.justFlushedEsc) {
            if (byte === 0x5b) {
              this.justFlushedEsc = false
              this.cursor += 1
              this.state = { tag: "esc_recovery" }
              continue
            }

            this.justFlushedEsc = false
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

          // Invalid UTF-8 lead byte. Could be a legacy high-byte from an
          // older terminal. If it's the last byte in the buffer, wait for
          // more data or a timeout before committing. On timeout, emit
          // through parseKeypress() which handles meta-key behavior.
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

          // Not a valid continuation byte. Treat the lead byte as a legacy
          // high-byte character and restart parsing from this position.
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

            const flushedLoneEsc = this.cursor === this.unitStart + 1 && bytes[this.unitStart] === ESC
            this.emitKeyOrResponse("unknown", decodeUtf8(bytes.subarray(this.unitStart, this.cursor)))
            this.justFlushedEsc = flushedLoneEsc
            this.state = { tag: "ground" }
            this.consumePrefix(this.cursor)
            continue
          }

          // The byte after ESC determines the sub-protocol:
          // [  ->  CSI, O  ->  SS3, ]  ->  OSC, P  ->  DCS, _  ->  APC.
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
            // ESC ESC: stay in esc state. Terminals encode Alt+ESC and
            // similar sequences as ESC ESC [...], so we keep scanning.
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

        // Narrow recovery path for delayed mouse continuations after a
        // timeout-flushed lone ESC. Wait for either `<` (SGR) or `M` (X10); if
        // neither arrives, flush `[` as a normal key.
        case "esc_recovery": {
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

          if (byte === 0x3c) {
            this.cursor += 1
            this.state = { tag: "esc_less_mouse" }
            continue
          }

          if (byte === 0x4d) {
            this.cursor += 1
            this.state = { tag: "esc_less_x10_mouse" }
            continue
          }

          this.emitKeyOrResponse("unknown", decodeUtf8(bytes.subarray(this.unitStart, this.unitStart + 1)))
          this.state = { tag: "ground" }
          this.consumePrefix(this.unitStart + 1)
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

          // A new ESC inside an incomplete CSI means the previous sequence
          // was interrupted. Flush everything before the new ESC as one
          // opaque response, then restart parsing at the new ESC.
          if (byte === ESC) {
            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor))
            this.state = { tag: "ground" }
            this.consumePrefix(this.cursor)
            continue
          }

          // X10 mouse: ESC [ M plus 3 raw payload bytes (button, x, y).
          // cursor === unitStart + 2 confirms M comes right after ESC[,
          // not as a later final byte in a different CSI sequence.
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

          // Some terminals use ESC [[A..E / ESC [[5~ / ESC [[6~ variants.
          // Treat the second `[` immediately after ESC[ as part of the CSI
          // payload instead of as a final byte so parseKeypress() can match
          // `[[A`, `[[B`, `[[5~`, etc.
          if (byte === 0x5b && this.cursor === this.unitStart + 2) {
            this.cursor += 1
            continue
          }

          // Standard CSI final byte (0x40–0x7E). Check for bracketed paste
          // start, SGR mouse, or a regular CSI key/response.
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

        // OSC sequences end at BEL or ESC \. DCS and APC end at ESC \
        // only. The sawEsc flag tracks whether the previous byte was ESC,
        // since the two-byte ESC \ can split across push() calls.
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

        // Delayed SGR mouse continuation after `esc_recovery` has consumed the
        // leading `[`. Consume the rest of `<digits;digits;digitsM/m` as one
        // opaque response so split mouse bytes never leak into text.
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

        // Delayed X10 mouse continuation after `esc_recovery` has consumed the
        // leading `[`. Consume `[M` plus its three raw payload bytes as one
        // opaque response so split mouse bytes never leak into text.
        case "esc_less_x10_mouse": {
          const end = this.unitStart + 5

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

          this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, end))
          this.state = { tag: "ground" }
          this.consumePrefix(end)
          continue
        }
      }
    }
  }

  // Tries to parse the raw string as a key via parseKeypress(). If it
  // recognizes the sequence (printable char, arrow, function key, etc.),
  // emits a key event. Otherwise emits a response event — this is how
  // capability responses, focus sequences, and other non-key CSI traffic
  // avoids becoming text.
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

  // Handles single bytes in the 0x80–0xFF range that aren't valid UTF-8
  // leads. Passes them through parseKeypress() which maps them to the
  // existing meta-key behavior (e.g. Alt+letter in terminals that send
  // high bytes instead of ESC-prefixed sequences).
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

  // Advances past a completed protocol unit. Resets cursor, unitStart,
  // and timeout state so the next scan iteration starts clean.
  private consumePrefix(endExclusive: number): void {
    this.pending.consume(endExclusive)
    this.cursor = 0
    this.unitStart = 0
    this.pendingSinceMs = null
    this.forceFlush = false
  }

  // Removes all bytes from the pending queue and returns them. Used when
  // entering paste mode — leftover bytes after the paste start marker
  // need to flow through consumePasteBytes() instead.
  private takePendingBytes(): Uint8Array {
    const buffered = this.pending.take()
    this.cursor = 0
    this.unitStart = 0
    this.pendingSinceMs = null
    this.forceFlush = false
    return buffered
  }

  // Emits all pending bytes as one opaque response and clears the buffer.
  // This keeps the parser buffer bounded at maxPendingBytes without
  // dropping data or splitting it into per-character events.
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

  // Records when incomplete data first appeared so flushTimeout() can
  // decide whether enough time has elapsed to force-flush it.
  private markPending(): void {
    this.pendingSinceMs = this.clock.now()
  }

  // Processes bytes during an active bracketed paste. Searches for the end
  // marker (ESC[201~) using a sliding tail window so the marker can split
  // across chunk boundaries. Bytes that can't be part of the end marker are
  // decoded incrementally as UTF-8 and appended to the paste collector.
  //
  // Returns any bytes that follow the end marker — those go back through
  // normal parsing in the push() loop.
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

    // Keep enough trailing bytes to detect an end marker split across chunks.
    // Everything before that point is safe to decode immediately.
    const keep = Math.min(BRACKETED_PASTE_END.length - 1, combined.length)
    const stableLength = combined.length - keep
    if (stableLength > 0) {
      this.pushPasteText(combined.subarray(0, stableLength))
    }

    paste.tail = combined.slice(stableLength)
    return EMPTY_BYTES
  }

  // Feeds bytes through the streaming TextDecoder. The { stream: true } flag
  // tells the decoder to hold back incomplete multi-byte characters until more
  // bytes arrive, so split UTF-8 codepoints reassemble correctly.
  private pushPasteText(bytes: Uint8Array): void {
    if (bytes.length === 0) {
      return
    }

    const text = this.paste!.decoder.decode(bytes, { stream: true })
    if (text.length > 0) {
      this.paste!.parts.push(text)
    }
  }

  // Arms or disarms the timeout after every push(). If there's an incomplete
  // unit in the buffer, starts a timer. When the timer fires, it sets
  // forceFlush so the next read() converts the incomplete unit into one
  // atomic event (e.g. a lone ESC becoming an Escape key).
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

  // Clears all parser state: pending bytes, queued events, timeout tracking,
  // and any active paste collector. Called by both reset() (suspend/resume)
  // and destroy() to ensure no stale state survives.
  private resetState(): void {
    this.pending.reset(INITIAL_PENDING_CAPACITY)
    this.events.length = 0
    this.pendingSinceMs = null
    this.forceFlush = false
    this.justFlushedEsc = false
    this.state = { tag: "ground" }
    this.cursor = 0
    this.unitStart = 0
    this.paste = null
    this.mouseParser.reset()
  }
}
