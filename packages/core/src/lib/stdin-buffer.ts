/**
 * StdinBuffer buffers input and emits complete sequences.
 *
 * This is necessary because stdin data events can arrive in partial chunks,
 * especially for escape sequences like mouse events. Without buffering,
 * partial sequences can be misinterpreted as regular keypresses.
 *
 * For example, the mouse SGR sequence `\x1b[<35;20;5m` might arrive as:
 * - Event 1: `\x1b`
 * - Event 2: `[<35`
 * - Event 3: `;20;5m`
 *
 * The buffer accumulates these until a complete sequence is detected.
 * Call the `process()` method to feed input data.
 */

import { EventEmitter } from "events"

const ESC = "\x1b"

/**
 * Check if a string is a complete escape sequence or needs more data
 */
function isCompleteSequence(data: string): "complete" | "incomplete" | "not-escape" {
  if (!data.startsWith(ESC)) {
    return "not-escape"
  }

  if (data.length === 1) {
    return "incomplete"
  }

  const afterEsc = data.slice(1)

  // CSI sequences: ESC [
  if (afterEsc.startsWith("[")) {
    // Check for old-style mouse sequence: ESC[M + 3 bytes
    if (afterEsc.startsWith("[M")) {
      // Old-style mouse needs ESC[M + 3 bytes = 6 total
      return data.length >= 6 ? "complete" : "incomplete"
    }
    return isCompleteCsiSequence(data)
  }

  // OSC sequences: ESC ]
  if (afterEsc.startsWith("]")) {
    return isCompleteOscSequence(data)
  }

  // SS3 sequences: ESC O
  if (afterEsc.startsWith("O")) {
    // ESC O followed by a single character
    return afterEsc.length >= 2 ? "complete" : "incomplete"
  }

  // Meta key sequences: ESC followed by a single character
  if (afterEsc.length === 1) {
    return "complete"
  }

  // Unknown escape sequence - treat as complete
  return "complete"
}

/**
 * Check if CSI sequence is complete
 * CSI sequences: ESC [ ... followed by a final byte (0x40-0x7E)
 */
function isCompleteCsiSequence(data: string): "complete" | "incomplete" {
  if (!data.startsWith(ESC + "[")) {
    return "complete"
  }

  // Need at least ESC [ and one more character
  if (data.length < 3) {
    return "incomplete"
  }

  const payload = data.slice(2)

  // CSI sequences end with a byte in the range 0x40-0x7E (@-~)
  // This includes all letters and several special characters
  const lastChar = payload[payload.length - 1]
  const lastCharCode = lastChar.charCodeAt(0)

  if (lastCharCode >= 0x40 && lastCharCode <= 0x7e) {
    // Special handling for SGR mouse sequences
    // Format: ESC[<B;X;Ym or ESC[<B;X;YM
    if (payload.startsWith("<")) {
      // Must have format: <digits;digits;digits[Mm]
      const mouseMatch = /^<\d+;\d+;\d+[Mm]$/.test(payload)
      if (mouseMatch) {
        return "complete"
      }
      // If it ends with M or m but doesn't match the pattern, still incomplete
      if (lastChar === "M" || lastChar === "m") {
        // Check if we have the right structure
        const parts = payload.slice(1, -1).split(";")
        if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
          return "complete"
        }
      }

      return "incomplete"
    }

    return "complete"
  }

  return "incomplete"
}

/**
 * Check if OSC sequence is complete
 * OSC sequences: ESC ] ... ST (where ST is ESC \ or BEL)
 */
function isCompleteOscSequence(data: string): "complete" | "incomplete" {
  if (!data.startsWith(ESC + "]")) {
    return "complete"
  }

  // OSC sequences end with ST (ESC \) or BEL (\x07)
  if (data.endsWith(ESC + "\\") || data.endsWith("\x07")) {
    return "complete"
  }

  return "incomplete"
}

/**
 * Split accumulated buffer into complete sequences
 */
function extractCompleteSequences(buffer: string): { sequences: string[]; remainder: string } {
  const sequences: string[] = []
  let pos = 0

  while (pos < buffer.length) {
    const remaining = buffer.slice(pos)

    // Try to extract a sequence starting at this position
    if (remaining.startsWith(ESC)) {
      // Find the end of this escape sequence
      let seqEnd = 1
      while (seqEnd <= remaining.length) {
        const candidate = remaining.slice(0, seqEnd)
        const status = isCompleteSequence(candidate)

        if (status === "complete") {
          sequences.push(candidate)
          pos += seqEnd
          break
        } else if (status === "incomplete") {
          seqEnd++
        } else {
          // Should not happen when starting with ESC
          sequences.push(candidate)
          pos += seqEnd
          break
        }
      }

      if (seqEnd > remaining.length) {
        return { sequences, remainder: remaining }
      }
    } else {
      // Not an escape sequence - take a single character
      sequences.push(remaining[0])
      pos++
    }
  }

  return { sequences, remainder: "" }
}

export type StdinBufferOptions = {
  /**
   * Maximum time to wait for sequence completion (default: 10ms)
   * After this time, the buffer is flushed even if incomplete
   */
  timeout?: number
}

export type StdinBufferEventMap = {
  data: [string]
}

/**
 * Buffers stdin input and emits complete sequences via the 'data' event.
 * Handles partial escape sequences that arrive across multiple chunks.
 */
export class StdinBuffer extends EventEmitter<StdinBufferEventMap> {
  private buffer: string = ""
  private timeout: Timer | null = null
  private readonly timeoutMs: number

  constructor(options: StdinBufferOptions = {}) {
    super()
    this.timeoutMs = options.timeout ?? 10
  }

  public process(data: string | Buffer): void {
    // Clear any pending timeout
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }

    // Handle high-byte conversion (for compatibility with parseKeypress)
    // If buffer has single byte > 127, convert to ESC + (byte - 128)
    // TODO: This seems redundant as parseKeypress should handle this.
    let str: string
    if (Buffer.isBuffer(data)) {
      if (data.length === 1 && data[0]! > 127) {
        const byte = data[0]! - 128
        str = "\x1b" + String.fromCharCode(byte)
      } else {
        str = data.toString()
      }
    } else {
      str = data
    }

    if (str.length === 0 && this.buffer.length === 0) {
      this.emit("data", "")
      return
    }

    this.buffer += str

    const result = extractCompleteSequences(this.buffer)
    this.buffer = result.remainder

    for (const sequence of result.sequences) {
      this.emit("data", sequence)
    }

    if (this.buffer.length > 0) {
      this.timeout = setTimeout(() => {
        const flushed = this.flush()

        for (const sequence of flushed) {
          this.emit("data", sequence)
        }
      }, this.timeoutMs)
    }
  }

  flush(): string[] {
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }

    if (this.buffer.length === 0) {
      return []
    }

    const sequences = [this.buffer]
    this.buffer = ""
    return sequences
  }

  clear(): void {
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }
    this.buffer = ""
  }

  getBuffer(): string {
    return this.buffer
  }

  destroy(): void {
    this.clear()
  }
}
