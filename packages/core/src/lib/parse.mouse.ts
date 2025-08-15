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

export class MouseParser {
  private mouseButtonsPressed = new Set<number>()

  private static readonly SCROLL_DIRECTIONS: Record<number, "up" | "down" | "left" | "right"> = {
    64: "up",
    65: "down",
    66: "left",
    67: "right",
  }

  public reset(): void {
    this.mouseButtonsPressed.clear()
  }

  public parseMouseEvent(data: Buffer): RawMouseEvent | null {
    const str = data.toString()
    // Parse SGR mouse mode: \x1b[<b;x;yM or \x1b[<b;x;ym
    const sgrMatch = str.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/)
    if (sgrMatch) {
      const [, buttonCode, x, y, pressRelease] = sgrMatch
      const rawButtonCode = parseInt(buttonCode)

      const scrollDirection = MouseParser.SCROLL_DIRECTIONS[rawButtonCode]
      const isScroll = scrollDirection !== undefined

      const button = rawButtonCode & 3
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
        x: parseInt(x) - 1,
        y: parseInt(y) - 1,
        modifiers,
        scroll: scrollInfo,
      }
    }

    // Parse basic mouse mode: \x1b[M followed by 3 bytes
    if (str.startsWith("\x1b[M") && str.length >= 6) {
      const buttonByte = str.charCodeAt(3) - 32
      // Convert from 1-based to 0-based
      const x = str.charCodeAt(4) - 33
      const y = str.charCodeAt(5) - 33

      const scrollDirection = MouseParser.SCROLL_DIRECTIONS[buttonByte]
      const isScroll = scrollDirection !== undefined

      const button = buttonByte & 3
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

    return null
  }
}
