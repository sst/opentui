export type MouseEventType = "down" | "up" | "move" | "drag" | "drag-end" | "drop" | "over" | "out" | "scroll"

export interface ScrollInfo {
  direction: "up" | "down" | "left" | "right"
  delta: number
}

export type RawMouseEvent = {
  type: MouseEventType
  button: number
  x: number
  y: number
  modifiers: { shift: boolean; alt: boolean; ctrl: boolean }
  scroll?: ScrollInfo
}

/** Result of parsing a single mouse event, including how many bytes it consumed. */
type ParsedMouseSequence = {
  event: RawMouseEvent
  consumed: number
}

/** Result of parseAllMouseEventsWithOffset — contains parsed events, consumed byte count, and partial-sequence detection. */
export type MouseParseResult = {
  events: RawMouseEvent[]
  /** Number of bytes successfully parsed as mouse events. */
  consumed: number
  /** True if the buffer ends with an incomplete mouse sequence that needs more data. */
  partial: boolean
}

export class MouseParser {
  private mouseButtonsPressed = new Set<number>()

  private static readonly SCROLL_DIRECTIONS: Record<number, "up" | "down" | "left" | "right"> = {
    0: "up",
    1: "down",
    2: "left",
    3: "right",
  }

  public reset(): void {
    this.mouseButtonsPressed.clear()
  }

  // NOTE: Renderer currently sets stdin encoding to utf8, so Buffer -> string
  // decoding happens before parsing. That can corrupt old X10 bytes >= 0x80
  // (for example x/y >= 95), because utf8 does not preserve arbitrary bytes.
  // SGR sequences are ASCII digits + separators and are unaffected.
  private decodeInput(data: Buffer): string {
    return data.toString()
  }

  public parseMouseEvent(data: Buffer): RawMouseEvent | null {
    const str = this.decodeInput(data)
    const parsed = this.parseMouseSequenceAt(str, 0)
    return parsed?.event ?? null
  }

  public parseAllMouseEvents(data: Buffer): RawMouseEvent[] {
    return this.parseAllMouseEventsWithOffset(data).events
  }

  /**
   * Parse all mouse events from the buffer, returning how many bytes were
   * consumed and whether the buffer ends with an incomplete mouse sequence.
   * This allows callers to forward unconsumed data to keyboard handlers
   * and buffer partial sequences for the next stdin chunk.
   */
  public parseAllMouseEventsWithOffset(data: Buffer): MouseParseResult {
    const str = this.decodeInput(data)
    const events: RawMouseEvent[] = []
    let offset = 0
    let partial = false

    while (offset < str.length) {
      const parsed = this.parseMouseSequenceAt(str, offset)
      if (parsed) {
        events.push(parsed.event)
        offset += parsed.consumed
        continue
      }

      // No complete mouse event at this position.
      // Check if there is a partial (truncated) mouse sequence starting here.
      if (this.isPartialMouseSequence(str, offset)) {
        partial = true
        break
      }

      // Not a mouse sequence at all — stop. Caller routes the remainder
      // through keyboard/terminal input handling.
      break
    }

    return { events, consumed: offset, partial }
  }

  /**
   * Check whether an incomplete mouse sequence starts at the given offset.
   * For example, "\x1b[<35;20" is a truncated SGR sequence (missing the
   * terminating "M" or "m").
   */
  private isPartialMouseSequence(str: string, offset: number): boolean {
    if (!str.startsWith("\x1b[", offset)) return false
    const remaining = str.slice(offset)

    // Partial SGR mouse: \x1b[< followed by digits/semicolons but no M/m terminator
    if (remaining.startsWith("\x1b[<")) {
      // Just "\x1b[" or "\x1b[<" — clearly incomplete
      if (remaining.length <= 3) return true
      // Verify the rest consists only of valid SGR mouse characters (digits, semicolons)
      for (let i = 3; i < remaining.length; i++) {
        const ch = remaining.charCodeAt(i)
        if (ch >= 48 && ch <= 57) continue  // digit
        if (ch === 59) continue               // semicolon
        // M or m means the sequence is actually complete (should have been parsed above)
        if (ch === 77 || ch === 109) return false
        // Any other character — not a valid mouse sequence
        return false
      }
      // Only digits/semicolons without a terminator — partial
      return true
    }

    // Partial basic (X10) mouse: \x1b[M needs 3 payload bytes (6 total)
    if (remaining.startsWith("\x1b[M")) {
      return remaining.length < 6
    }

    return false
  }

  private parseMouseSequenceAt(str: string, offset: number): ParsedMouseSequence | null {
    if (!str.startsWith("\x1b[", offset)) return null
    const introducer = str[offset + 2]

    if (introducer === "<") {
      return this.parseSgrSequence(str, offset)
    }

    if (introducer === "M") {
      return this.parseBasicSequence(str, offset)
    }

    return null
  }

  private parseSgrSequence(str: string, offset: number): ParsedMouseSequence | null {
    let index = offset + 3
    const values = [0, 0, 0]
    let part = 0
    let hasDigit = false

    while (index < str.length) {
      const char = str[index]
      const charCode = str.charCodeAt(index)

      if (charCode >= 48 && charCode <= 57) {
        hasDigit = true
        values[part] = values[part]! * 10 + (charCode - 48)
        index++
        continue
      }

      switch (char) {
        case ";": {
          if (!hasDigit || part >= 2) return null
          part++
          hasDigit = false
          index++
          break
        }
        case "M":
        case "m": {
          if (!hasDigit || part !== 2) return null

          return {
            event: this.decodeSgrEvent(values[0]!, values[1]!, values[2]!, char),
            consumed: index - offset + 1,
          }
        }
        default:
          return null
      }
    }

    return null
  }

  private parseBasicSequence(str: string, offset: number): ParsedMouseSequence | null {
    // ESC [ M + 3 bytes
    if (offset + 6 > str.length) return null

    const buttonByte = str.charCodeAt(offset + 3) - 32
    // Convert from 1-based to 0-based
    const x = str.charCodeAt(offset + 4) - 33
    const y = str.charCodeAt(offset + 5) - 33

    return {
      event: this.decodeBasicEvent(buttonByte, x, y),
      consumed: 6,
    }
  }

  private decodeSgrEvent(rawButtonCode: number, wireX: number, wireY: number, pressRelease: "M" | "m"): RawMouseEvent {
    const button = rawButtonCode & 3
    const isScroll = (rawButtonCode & 64) !== 0
    const scrollDirection = !isScroll ? undefined : MouseParser.SCROLL_DIRECTIONS[button]

    const isMotion = (rawButtonCode & 32) !== 0
    const modifiers = {
      shift: (rawButtonCode & 4) !== 0,
      alt: (rawButtonCode & 8) !== 0,
      ctrl: (rawButtonCode & 16) !== 0,
    }

    let type: MouseEventType
    let scrollInfo: ScrollInfo | undefined

    if (isScroll && pressRelease === "M") {
      type = "scroll"
      scrollInfo = {
        direction: scrollDirection!,
        delta: 1,
      }
    } else if (isMotion) {
      const isDragging = this.mouseButtonsPressed.size > 0

      if (button === 3) {
        type = "move"
      } else if (isDragging) {
        type = "drag"
      } else {
        type = "move"
      }
    } else {
      type = pressRelease === "M" ? "down" : "up"

      if (type === "down" && button !== 3) {
        this.mouseButtonsPressed.add(button)
      } else if (type === "up") {
        this.mouseButtonsPressed.clear()
      }
    }

    return {
      type,
      button: button === 3 ? 0 : button,
      x: wireX - 1,
      y: wireY - 1,
      modifiers,
      scroll: scrollInfo,
    }
  }

  private decodeBasicEvent(buttonByte: number, x: number, y: number): RawMouseEvent {
    const button = buttonByte & 3
    const isScroll = (buttonByte & 64) !== 0
    const isMotion = (buttonByte & 32) !== 0
    const scrollDirection = !isScroll ? undefined : MouseParser.SCROLL_DIRECTIONS[button]

    const modifiers = {
      shift: (buttonByte & 4) !== 0,
      alt: (buttonByte & 8) !== 0,
      ctrl: (buttonByte & 16) !== 0,
    }

    let type: MouseEventType
    let actualButton: number
    let scrollInfo: ScrollInfo | undefined

    if (isScroll) {
      type = "scroll"
      actualButton = 0
      scrollInfo = {
        direction: scrollDirection!,
        delta: 1,
      }
    } else if (isMotion) {
      type = "move"
      actualButton = button === 3 ? -1 : button
    } else {
      type = button === 3 ? "up" : "down"
      actualButton = button === 3 ? 0 : button
    }

    return {
      type,
      button: actualButton,
      x,
      y,
      modifiers,
      scroll: scrollInfo,
    }
  }
}
