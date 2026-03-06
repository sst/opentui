import { Buffer } from "node:buffer"

export const StdinTokenKind = {
  text: "text",
  csi: "csi",
  osc: "osc",
  dcs: "dcs",
  apc: "apc",
  ss3: "ss3",
  mouse_sgr: "mouse_sgr",
  mouse_x10: "mouse_x10",
  paste: "paste",
  esc: "esc",
  unknown: "unknown",
} as const

export type StdinTokenKind = (typeof StdinTokenKind)[keyof typeof StdinTokenKind]

export interface StdinToken {
  kind: StdinTokenKind
  flags: number
  reserved0: number
  aux0: number
  aux1: number
}

export interface StdinParserOptions {
  timeoutMs?: number
  maxBufferBytes?: number
  armTimeouts?: boolean
  onTimeoutFlush?: () => void
  reserved0?: number
}

export const StdinParserNextStatus = {
  none: "none",
  pending: "pending",
  token: "token",
} as const

export type StdinParserNextStatus = (typeof StdinParserNextStatus)[keyof typeof StdinParserNextStatus]

export type StdinParserNextResult =
  | { status: typeof StdinParserNextStatus.none }
  | { status: typeof StdinParserNextStatus.pending }
  | {
      status: typeof StdinParserNextStatus.token
      token: StdinToken
      payload: Uint8Array
    }

const DEFAULT_TIMEOUT_MS = 10
const DEFAULT_MAX_BUFFER_BYTES = 64 * 1024
const INITIAL_BUFFER_CAPACITY = 128
const ESC = 0x1b
const BEL = 0x07
const BRACKETED_PASTE_START = Buffer.from("\x1b[200~")
const BRACKETED_PASTE_END = Buffer.from("\x1b[201~")
const EMPTY_PAYLOAD = new Uint8Array(0)

type CandidateToken = {
  kind: StdinTokenKind
  consumed: number
  payloadStart: number
  payloadLen: number
  clearPasteMode?: boolean
}

type ParseResult =
  | { type: "none" }
  | { type: "incomplete" }
  | { type: "consume"; consumed: number; clearPasteMode?: boolean }
  | { type: "token"; candidate: CandidateToken }

type EscapeParseState = "start" | "esc" | "csi" | "osc" | "osc_escape" | "st" | "st_escape"

class ByteBuffer {
  private storage: Uint8Array
  public length = 0

  constructor(capacity: number = INITIAL_BUFFER_CAPACITY) {
    this.storage = new Uint8Array(capacity)
  }

  public get capacity(): number {
    return this.storage.length
  }

  public get items(): Uint8Array {
    return this.storage.subarray(0, this.length)
  }

  public append(bytes: Uint8Array): void {
    if (bytes.length === 0) {
      return
    }

    this.ensureTotalCapacityPrecise(this.length + bytes.length)
    this.storage.set(bytes, this.length)
    this.length += bytes.length
  }

  public clearRetainingCapacity(): void {
    this.length = 0
  }

  public reset(capacity: number = INITIAL_BUFFER_CAPACITY): void {
    this.storage = new Uint8Array(capacity)
    this.length = 0
  }

  public ensureTotalCapacityPrecise(required: number): void {
    if (required <= this.storage.length) {
      return
    }

    const next = new Uint8Array(required)
    next.set(this.storage.subarray(0, this.length))
    this.storage = next
  }

  public consumePrefix(consumed: number): void {
    if (consumed === 0) {
      return
    }

    if (consumed >= this.length) {
      this.length = 0
      return
    }

    this.storage.copyWithin(0, consumed, this.length)
    this.length -= consumed
  }

  public payload(start: number, end: number): Uint8Array {
    return this.storage.subarray(start, end)
  }
}

function normalizePositiveOption(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback
  }

  return Math.floor(value)
}

function nowMs(): number {
  return Math.max(Date.now(), 0)
}

function startsWithBytes(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) {
    return false
  }

  for (let index = 0; index < prefix.length; index += 1) {
    if (bytes[index] !== prefix[index]) {
      return false
    }
  }

  return true
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

function createToken(kind: StdinTokenKind): StdinToken {
  return {
    kind,
    flags: 0,
    reserved0: 0,
    aux0: 0,
    aux1: 0,
  }
}

function escapeToken(kind: StdinTokenKind, consumed: number): ParseResult {
  return {
    type: "token",
    candidate: {
      kind,
      consumed,
      payloadStart: 0,
      payloadLen: consumed,
    },
  }
}

function utf8SequenceLength(first: number): number {
  if (first < 0x80) return 1
  if (first >= 0xc2 && first <= 0xdf) return 2
  if (first >= 0xe0 && first <= 0xef) return 3
  if (first >= 0xf0 && first <= 0xf4) return 4
  return 0
}

function parseTextToken(bytes: Uint8Array): ParseResult {
  if (bytes.length === 0) {
    return { type: "none" }
  }

  const seqLen = utf8SequenceLength(bytes[0]!)
  if (seqLen === 0) {
    return {
      type: "token",
      candidate: {
        kind: StdinTokenKind.unknown,
        consumed: 1,
        payloadStart: 0,
        payloadLen: 1,
      },
    }
  }

  const available = Math.min(bytes.length, seqLen)
  for (let index = 1; index < available; index += 1) {
    if ((bytes[index]! & 0xc0) !== 0x80) {
      return {
        type: "token",
        candidate: {
          kind: StdinTokenKind.unknown,
          consumed: 1,
          payloadStart: 0,
          payloadLen: 1,
        },
      }
    }
  }

  if (bytes.length < seqLen) {
    return { type: "incomplete" }
  }

  return {
    type: "token",
    candidate: {
      kind: StdinTokenKind.text,
      consumed: seqLen,
      payloadStart: 0,
      payloadLen: seqLen,
    },
  }
}

function parseEscLessSgrContinuation(bytes: Uint8Array): ParseResult {
  if (!(bytes[0] === 0x5b && bytes[1] === 0x3c)) {
    return { type: "none" }
  }

  let scanIndex = 2
  while (scanIndex < bytes.length) {
    const byte = bytes[scanIndex]!
    if ((byte >= 0x30 && byte <= 0x39) || byte === 0x3b) {
      scanIndex += 1
      continue
    }

    if (byte === 0x4d || byte === 0x6d) {
      const consumed = scanIndex + 1
      return {
        type: "token",
        candidate: {
          kind: StdinTokenKind.unknown,
          consumed,
          payloadStart: 0,
          payloadLen: consumed,
        },
      }
    }

    return { type: "none" }
  }

  return { type: "incomplete" }
}

function isNestedEscapeSequenceStart(byte: number): boolean {
  return byte === 0x5b || byte === 0x5d || byte === 0x4f || byte === 0x4e || byte === 0x50 || byte === 0x5f
}

function isMouseSgrSequence(sequence: Uint8Array): boolean {
  if (!startsWithBytes(sequence, Buffer.from("\x1b[<"))) {
    return false
  }

  if (sequence.length < 7) {
    return false
  }

  const final = sequence[sequence.length - 1]!
  if (final !== 0x4d && final !== 0x6d) {
    return false
  }

  const body = sequence.subarray(3, sequence.length - 1)
  let partCount = 0
  let hasDigit = false

  for (const char of body) {
    if (char >= 0x30 && char <= 0x39) {
      hasDigit = true
      continue
    }

    if (char === 0x3b && hasDigit && partCount < 2) {
      partCount += 1
      hasDigit = false
      continue
    }

    return false
  }

  return partCount === 2 && hasDigit
}

function parseEscapeToken(bytes: Uint8Array): ParseResult {
  let index = 0
  let stKind: StdinTokenKind = StdinTokenKind.unknown
  let state: EscapeParseState = "start"

  while (true) {
    switch (state) {
      case "start": {
        if (bytes.length === 0) {
          return { type: "none" }
        }

        if (bytes[0] !== ESC) {
          return parseTextToken(bytes)
        }

        if (bytes.length === 1) {
          return { type: "incomplete" }
        }

        index = 1
        state = "esc"
        continue
      }
      case "esc": {
        const byte = bytes[index]!

        switch (byte) {
          case 0x5b:
            index += 1
            state = "csi"
            continue
          case 0x5d:
            index += 1
            state = "osc"
            continue
          case 0x50:
            stKind = StdinTokenKind.dcs
            index += 1
            state = "st"
            continue
          case 0x5f:
            stKind = StdinTokenKind.apc
            index += 1
            state = "st"
            continue
          case 0x4f:
            if (bytes.length < index + 2) {
              return { type: "incomplete" }
            }
            return escapeToken(StdinTokenKind.ss3, index + 2)
          case ESC:
            if (index + 1 >= bytes.length) {
              return { type: "incomplete" }
            }
            if (!isNestedEscapeSequenceStart(bytes[index + 1]!)) {
              return escapeToken(StdinTokenKind.unknown, index + 1)
            }
            index += 1
            state = "esc"
            continue
          default:
            return escapeToken(StdinTokenKind.unknown, index + 1)
        }
      }
      case "csi": {
        if (index >= bytes.length) {
          return { type: "incomplete" }
        }

        if (bytes[index] === 0x4d) {
          const requiredLength = index + 4
          if (bytes.length < requiredLength) {
            return { type: "incomplete" }
          }
          return escapeToken(StdinTokenKind.mouse_x10, requiredLength)
        }

        let scanIndex = index
        while (scanIndex < bytes.length) {
          const byte = bytes[scanIndex]!
          if (byte >= 0x40 && byte <= 0x7e) {
            const consumed = scanIndex + 1
            const kind = isMouseSgrSequence(bytes.subarray(0, consumed)) ? StdinTokenKind.mouse_sgr : StdinTokenKind.csi
            return escapeToken(kind, consumed)
          }

          if (byte === ESC) {
            return escapeToken(StdinTokenKind.unknown, scanIndex)
          }

          scanIndex += 1
        }

        return { type: "incomplete" }
      }
      case "osc": {
        let scanIndex = index
        while (scanIndex < bytes.length) {
          const byte = bytes[scanIndex]!
          if (byte === BEL) {
            return escapeToken(StdinTokenKind.osc, scanIndex + 1)
          }
          if (byte === ESC) {
            index = scanIndex
            state = "osc_escape"
            break
          }
          scanIndex += 1
        }

        if (state === "osc_escape") {
          continue
        }

        return { type: "incomplete" }
      }
      case "osc_escape": {
        if (index + 1 >= bytes.length) {
          return { type: "incomplete" }
        }
        if (bytes[index + 1] === 0x5c) {
          return escapeToken(StdinTokenKind.osc, index + 2)
        }

        index += 1
        state = "osc"
        continue
      }
      case "st": {
        let scanIndex = index
        while (scanIndex < bytes.length) {
          if (bytes[scanIndex] === ESC) {
            index = scanIndex
            state = "st_escape"
            break
          }
          scanIndex += 1
        }

        if (state === "st_escape") {
          continue
        }

        return { type: "incomplete" }
      }
      case "st_escape": {
        if (index + 1 >= bytes.length) {
          return { type: "incomplete" }
        }
        if (bytes[index + 1] === 0x5c) {
          return escapeToken(stKind, index + 2)
        }

        index += 1
        state = "st"
        continue
      }
    }
  }
}

export class StdinParser {
  private readonly buffer = new ByteBuffer(INITIAL_BUFFER_CAPACITY)
  private readonly timeoutMs: number
  private readonly maxBufferBytes: number
  private readonly armTimeouts: boolean
  private readonly onTimeoutFlush: (() => void) | null
  private timeoutId: ReturnType<typeof setTimeout> | null = null
  private destroyed = false
  private inPasteMode = false
  private pasteEndIndex: number | null = null
  private pasteEndMatchLen = 0
  private discardingOversizedPaste = false
  private discardPasteEndMatchLen = 0
  private pendingSinceMs: number | null = null
  private flushPendingTimeout = false
  private pendingConsumed = 0
  private pendingClearPasteMode = false
  private expectEscContinuation = false

  constructor(options: StdinParserOptions = {}) {
    this.timeoutMs = normalizePositiveOption(options.timeoutMs, DEFAULT_TIMEOUT_MS)
    this.maxBufferBytes = normalizePositiveOption(options.maxBufferBytes, DEFAULT_MAX_BUFFER_BYTES)
    this.armTimeouts = options.armTimeouts ?? true
    this.onTimeoutFlush = options.onTimeoutFlush ?? null
  }

  public get bufferCapacity(): number {
    return this.buffer.capacity
  }

  public push(data: Uint8Array): boolean {
    this.ensureAlive()
    if (data.length === 0) {
      return true
    }

    const accepted = this.pushBytes(data)
    if (accepted && this.armTimeouts) {
      this.armTimeoutIfNeeded()
    }
    return accepted
  }

  public next(): StdinParserNextResult {
    this.ensureAlive()
    this.commitPendingToken()

    while (true) {
      const parsed = this.nextToken()

      switch (parsed.type) {
        case "none":
          this.pendingSinceMs = null
          this.flushPendingTimeout = false
          return { status: StdinParserNextStatus.none }
        case "incomplete": {
          if (this.flushPendingTimeout && !this.inPasteMode && this.buffer.length > 0) {
            const items = this.buffer.items
            const first = items[0]!
            const seqLen = utf8SequenceLength(first)
            const shouldForceUnknown = seqLen === 0 || (items.length === 1 && seqLen > 1)

            if (this.expectEscContinuation && startsWithBytes(items, Buffer.from("[<"))) {
              this.expectEscContinuation = false
              return this.stageNextToken({
                kind: StdinTokenKind.unknown,
                consumed: items.length,
                payloadStart: 0,
                payloadLen: items.length,
              })
            }

            if (first === ESC || shouldForceUnknown) {
              this.expectEscContinuation = first === ESC && items.length === 1
              return this.stageNextToken(
                first === ESC
                  ? {
                      kind: StdinTokenKind.esc,
                      consumed: items.length,
                      payloadStart: 0,
                      payloadLen: items.length,
                    }
                  : {
                      kind: StdinTokenKind.unknown,
                      consumed: 1,
                      payloadStart: 0,
                      payloadLen: 1,
                    },
              )
            }
          }

          if (this.hasPendingState()) {
            if (this.pendingSinceMs === null) {
              this.pendingSinceMs = nowMs()
            }
            return { status: StdinParserNextStatus.pending }
          }

          this.pendingSinceMs = null
          this.flushPendingTimeout = false
          return { status: StdinParserNextStatus.none }
        }
        case "consume":
          this.consumePrefix(parsed.consumed)
          if (parsed.clearPasteMode) {
            this.inPasteMode = false
            this.clearPasteEndMatcher()
          }
          this.flushPendingTimeout = false
          continue
        case "token":
          return this.stageNextToken(parsed.candidate)
      }
    }
  }

  public drain(onToken: (token: StdinToken, payload: Uint8Array) => void): void {
    this.ensureAlive()

    while (true) {
      if (this.destroyed) {
        return
      }

      const next = this.next()
      if (next.status === StdinParserNextStatus.token) {
        onToken(next.token, next.payload.length === 0 ? EMPTY_PAYLOAD : next.payload.slice())
        if (this.destroyed) {
          return
        }
        continue
      }

      if (this.armTimeouts) {
        this.reconcileTimeout(next.status === StdinParserNextStatus.pending)
      }
      return
    }
  }

  public flushTimeout(nowMsValue: number): void {
    this.ensureAlive()
    const pendingSince = this.pendingSinceMs
    if (pendingSince === null) {
      return
    }
    if (this.inPasteMode) {
      return
    }
    if (this.buffer.length === 0) {
      return
    }
    if (nowMsValue < pendingSince || nowMsValue - pendingSince < this.timeoutMs) {
      return
    }

    this.flushPendingTimeout = true
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

  private pushBytes(bytes: Uint8Array): boolean {
    if (this.discardingOversizedPaste) {
      this.consumeDiscardedPasteBytes(bytes)
      return true
    }

    this.commitPendingToken()

    if (this.buffer.length + bytes.length > this.maxBufferBytes) {
      if (this.inPasteMode) {
        this.enterPasteOverflowDiscardMode()
        this.consumeDiscardedPasteBytes(bytes)
        return true
      }

      return false
    }

    const appendStart = this.buffer.length
    this.buffer.append(bytes)

    if (this.inPasteMode && this.pasteEndIndex === null) {
      this.updatePasteEndMatcher(bytes, appendStart)
    }

    return true
  }

  private stageNextToken(candidate: CandidateToken): StdinParserNextResult {
    const start = candidate.payloadStart
    const end = start + candidate.payloadLen

    this.pendingConsumed = candidate.consumed
    this.pendingClearPasteMode = candidate.clearPasteMode ?? false
    this.flushPendingTimeout = false
    this.pendingSinceMs = null

    return {
      status: StdinParserNextStatus.token,
      token: createToken(candidate.kind),
      payload: this.buffer.payload(start, end),
    }
  }

  private commitPendingToken(): void {
    if (this.pendingConsumed === 0) {
      return
    }

    this.consumePrefix(this.pendingConsumed)
    if (this.pendingClearPasteMode) {
      this.inPasteMode = false
      this.clearPasteEndMatcher()
    }
    this.pendingConsumed = 0
    this.pendingClearPasteMode = false
  }

  private clearPasteEndMatcher(): void {
    this.pasteEndIndex = null
    this.pasteEndMatchLen = 0
  }

  private enterPasteOverflowDiscardMode(): void {
    this.buffer.reset(INITIAL_BUFFER_CAPACITY)
    this.inPasteMode = false
    this.clearPasteEndMatcher()
    this.discardingOversizedPaste = true
    this.discardPasteEndMatchLen = 0
    this.pendingSinceMs = null
    this.flushPendingTimeout = false
    this.pendingConsumed = 0
    this.pendingClearPasteMode = false
    this.expectEscContinuation = false
  }

  private enterPasteMode(): void {
    this.inPasteMode = true
    this.clearPasteEndMatcher()

    if (this.buffer.length > 0) {
      this.updatePasteEndMatcher(this.buffer.items, 0)
    }
  }

  private updatePasteEndMatcher(bytes: Uint8Array, baseIndex: number): void {
    if (bytes.length === 0 || this.pasteEndIndex !== null) {
      return
    }

    let offset = 0
    while (offset < bytes.length) {
      const byte = bytes[offset]!
      const expected = BRACKETED_PASTE_END[this.pasteEndMatchLen]!

      if (byte === expected) {
        this.pasteEndMatchLen += 1
        if (this.pasteEndMatchLen === BRACKETED_PASTE_END.length) {
          this.pasteEndIndex = baseIndex + offset + 1 - BRACKETED_PASTE_END.length
          this.pasteEndMatchLen = 0
          return
        }

        offset += 1
        continue
      }

      if (this.pasteEndMatchLen > 0 && byte === BRACKETED_PASTE_END[0]) {
        this.pasteEndMatchLen = 1
      } else {
        this.pasteEndMatchLen = 0
      }

      offset += 1
    }
  }

  private consumeDiscardedPasteBytes(bytes: Uint8Array): void {
    if (!this.discardingOversizedPaste || bytes.length === 0) {
      return
    }

    const markerEndOffset = this.findPasteEndInDiscardedBytes(bytes)
    if (markerEndOffset === null) {
      return
    }

    this.discardingOversizedPaste = false
    this.discardPasteEndMatchLen = 0

    if (markerEndOffset < bytes.length) {
      this.pushBytes(bytes.subarray(markerEndOffset))
    }
  }

  private findPasteEndInDiscardedBytes(bytes: Uint8Array): number | null {
    let offset = 0
    while (offset < bytes.length) {
      const byte = bytes[offset]!
      const expected = BRACKETED_PASTE_END[this.discardPasteEndMatchLen]!

      if (byte === expected) {
        this.discardPasteEndMatchLen += 1
        if (this.discardPasteEndMatchLen === BRACKETED_PASTE_END.length) {
          this.discardPasteEndMatchLen = 0
          return offset + 1
        }

        offset += 1
        continue
      }

      if (this.discardPasteEndMatchLen > 0 && byte === BRACKETED_PASTE_END[0]) {
        this.discardPasteEndMatchLen = 1
      } else {
        this.discardPasteEndMatchLen = 0
      }

      offset += 1
    }

    return null
  }

  private hasPendingState(): boolean {
    return this.pendingConsumed > 0 || this.inPasteMode || this.buffer.length > 0
  }

  private consumePrefix(consumed: number): void {
    this.buffer.consumePrefix(consumed)
  }

  private nextToken(): ParseResult {
    if (this.discardingOversizedPaste) {
      return { type: "none" }
    }

    if (this.inPasteMode) {
      return this.nextPasteToken()
    }

    const items = this.buffer.items
    if (items.length === 0) {
      return { type: "none" }
    }

    if (this.expectEscContinuation) {
      const continuation = parseEscLessSgrContinuation(items)
      switch (continuation.type) {
        case "none":
          this.expectEscContinuation = false
          break
        case "incomplete":
          return continuation
        case "consume":
          this.expectEscContinuation = false
          return continuation
        case "token":
          this.expectEscContinuation = false
          return continuation
      }
    }

    if (startsWithBytes(items, BRACKETED_PASTE_START)) {
      this.consumePrefix(BRACKETED_PASTE_START.length)
      this.enterPasteMode()
      return this.nextToken()
    }

    if (
      items.length < BRACKETED_PASTE_START.length &&
      bytesEqual(items, BRACKETED_PASTE_START.subarray(0, items.length))
    ) {
      return { type: "incomplete" }
    }

    if (items[0] === ESC) {
      return parseEscapeToken(items)
    }

    return parseTextToken(items)
  }

  private nextPasteToken(): ParseResult {
    if (this.pasteEndIndex !== null) {
      return {
        type: "token",
        candidate: {
          kind: StdinTokenKind.paste,
          consumed: this.pasteEndIndex + BRACKETED_PASTE_END.length,
          payloadStart: 0,
          payloadLen: this.pasteEndIndex,
          clearPasteMode: true,
        },
      }
    }

    return { type: "incomplete" }
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

  private resetState(): void {
    this.buffer.reset(INITIAL_BUFFER_CAPACITY)
    this.inPasteMode = false
    this.clearPasteEndMatcher()
    this.discardingOversizedPaste = false
    this.discardPasteEndMatchLen = 0
    this.pendingSinceMs = null
    this.flushPendingTimeout = false
    this.pendingConsumed = 0
    this.pendingClearPasteMode = false
    this.expectEscContinuation = false
  }
}
