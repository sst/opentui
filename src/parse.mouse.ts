export type MouseEventType = "down" | "up" | "move" | "drag" | "drag-end" | "drop" | "over" | "out"
export type RawMouseEvent = {
  type: MouseEventType
  button: number
  x: number
  y: number
  modifiers: { shift: boolean; alt: boolean; ctrl: boolean }
}

export function parseMouseEvent(data: Buffer): RawMouseEvent | null {
  const str = data.toString()

  // Parse SGR mouse mode: \x1b[<b;x;yM or \x1b[<b;x;ym
  const sgrMatch = str.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/)
  if (sgrMatch) {
    const [, buttonCode, x, y, pressRelease] = sgrMatch
    const rawButtonCode = parseInt(buttonCode)
    const button = rawButtonCode & 3
    const isMotion = (rawButtonCode & 32) !== 0
    const modifiers = {
      shift: (rawButtonCode & 4) !== 0,
      alt: (rawButtonCode & 8) !== 0,
      ctrl: (rawButtonCode & 16) !== 0,
    }

    let type: MouseEventType
    if (isMotion) {
      type = button === 3 ? "move" : "drag"
    } else {
      type = pressRelease === "M" ? "down" : "up"
    }

    return {
      type,
      button: button === 3 ? 0 : button,
      x: parseInt(x) - 1,
      y: parseInt(y) - 1,
      modifiers,
    }
  }

  // Parse basic mouse mode: \x1b[M followed by 3 bytes
  if (str.startsWith("\x1b[M") && str.length >= 6) {
    const buttonByte = str.charCodeAt(3) - 32
    // Convert from 1-based to 0-based
    const x = str.charCodeAt(4) - 33
    const y = str.charCodeAt(5) - 33

    const button = buttonByte & 3
    const modifiers = {
      shift: (buttonByte & 4) !== 0,
      alt: (buttonByte & 8) !== 0,
      ctrl: (buttonByte & 16) !== 0,
    }

    const type = button === 3 ? "up" : "down"
    const actualButton = button === 3 ? 0 : button

    return {
      type,
      button: actualButton,
      x,
      y,
      modifiers,
    }
  }

  return null
}
