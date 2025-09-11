import type { CliRenderer } from "../renderer"

export const MouseButtons = {
  LEFT: 0,
  MIDDLE: 1,
  RIGHT: 2,

  WHEEL_UP: 64, // 64 = scroll flag + 0
  WHEEL_DOWN: 65, // 64 + 1
  WHEEL_LEFT: 66, // 64 + 2
  WHEEL_RIGHT: 67, // 64 + 3
} as const

export type MouseButton = (typeof MouseButtons)[keyof typeof MouseButtons]

export interface MousePosition {
  x: number
  y: number
}

export interface MouseModifiers {
  shift?: boolean
  alt?: boolean
  ctrl?: boolean
}

export type MouseEventType = "down" | "up" | "move" | "drag" | "scroll"

export interface MouseEventOptions {
  button?: MouseButton
  modifiers?: MouseModifiers
  delayMs?: number
}

export function createMockMouse(renderer: CliRenderer) {
  let currentPosition: MousePosition = { x: 0, y: 0 }
  let buttonsPressed = new Set<MouseButton>()

  // Generate SGR mouse event sequence
  const generateMouseEvent = (
    type: MouseEventType,
    x: number,
    y: number,
    button: MouseButton = MouseButtons.LEFT,
    modifiers: MouseModifiers = {},
  ): string => {
    // SGR format: \x1b[<b;x;yM or \x1b[<b;x;ym
    // where b = button code + modifier flags + motion/scroll flags

    let buttonCode: number = button

    // Add modifier flags
    if (modifiers.shift) buttonCode |= 4
    if (modifiers.alt) buttonCode |= 8
    if (modifiers.ctrl) buttonCode |= 16

    switch (type) {
      case "move":
        buttonCode = 32 | 3 // motion flag (32) + button 3 for motion without button press
        if (modifiers.shift) buttonCode |= 4
        if (modifiers.alt) buttonCode |= 8
        if (modifiers.ctrl) buttonCode |= 16
        break
      case "drag":
        buttonCode = (buttonsPressed.size > 0 ? Array.from(buttonsPressed)[0] : button) | 32
        if (modifiers.shift) buttonCode |= 4
        if (modifiers.alt) buttonCode |= 8
        if (modifiers.ctrl) buttonCode |= 16
        break
      case "scroll":
        // Scroll events already have the scroll flag set in the button code
        break
    }

    // Convert to 1-based coordinates for ANSI
    const ansiX = x + 1
    const ansiY = y + 1

    let pressRelease = "M" // Default to press
    if (type === "up" || type === "move" || type === "drag") {
      pressRelease = "m"
    }

    return `\x1b[<${buttonCode};${ansiX};${ansiY}${pressRelease}`
  }

  const emitMouseEvent = async (
    type: MouseEventType,
    x: number,
    y: number,
    button: MouseButton = MouseButtons.LEFT,
    options: Omit<MouseEventOptions, "button"> = {},
  ): Promise<void> => {
    const { modifiers = {}, delayMs = 0 } = options

    const eventSequence = generateMouseEvent(type, x, y, button, modifiers)
    renderer.stdin.emit("data", Buffer.from(eventSequence))

    currentPosition = { x, y }

    if (type === "down" && button < 64) {
      buttonsPressed.add(button)
    } else if (type === "up") {
      buttonsPressed.delete(button)
    }

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  const moveTo = async (x: number, y: number, options: MouseEventOptions = {}): Promise<void> => {
    const { button = MouseButtons.LEFT, delayMs = 0, modifiers = {} } = options

    if (buttonsPressed.size > 0) {
      await emitMouseEvent("drag", x, y, Array.from(buttonsPressed)[0], { modifiers, delayMs })
    } else {
      await emitMouseEvent("move", x, y, button, { modifiers, delayMs })
    }

    currentPosition = { x, y }
  }

  const click = async (
    x: number,
    y: number,
    button: MouseButton = MouseButtons.LEFT,
    options: MouseEventOptions = {},
  ): Promise<void> => {
    const { delayMs = 10, modifiers = {} } = options

    await emitMouseEvent("down", x, y, button, { modifiers, delayMs })
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    await emitMouseEvent("up", x, y, button, { modifiers, delayMs })
  }

  const doubleClick = async (
    x: number,
    y: number,
    button: MouseButton = MouseButtons.LEFT,
    options: MouseEventOptions = {},
  ): Promise<void> => {
    const { delayMs = 10, modifiers = {} } = options

    await click(x, y, button, { modifiers, delayMs })
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    await click(x, y, button, { modifiers, delayMs })
  }

  const pressDown = async (
    x: number,
    y: number,
    button: MouseButton = MouseButtons.LEFT,
    options: MouseEventOptions = {},
  ): Promise<void> => {
    const { modifiers = {}, delayMs = 0 } = options
    await emitMouseEvent("down", x, y, button, { modifiers, delayMs })
  }

  const release = async (
    x: number,
    y: number,
    button: MouseButton = MouseButtons.LEFT,
    options: MouseEventOptions = {},
  ): Promise<void> => {
    const { modifiers = {}, delayMs = 0 } = options
    await emitMouseEvent("up", x, y, button, { modifiers, delayMs })
  }

  const drag = async (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    button: MouseButton = MouseButtons.LEFT,
    options: MouseEventOptions = {},
  ): Promise<void> => {
    const { delayMs = 10, modifiers = {} } = options

    await pressDown(startX, startY, button, { modifiers })

    const steps = 5
    const dx = (endX - startX) / steps
    const dy = (endY - startY) / steps

    for (let i = 1; i <= steps; i++) {
      const currentX = Math.round(startX + dx * i)
      const currentY = Math.round(startY + dy * i)
      await emitMouseEvent("drag", currentX, currentY, button, { modifiers, delayMs })
    }

    await release(endX, endY, button, { modifiers })
  }

  const scroll = async (
    x: number,
    y: number,
    direction: "up" | "down" | "left" | "right",
    options: MouseEventOptions = {},
  ): Promise<void> => {
    const { modifiers = {}, delayMs = 0 } = options

    let button: MouseButton
    switch (direction) {
      case "up":
        button = MouseButtons.WHEEL_UP
        break
      case "down":
        button = MouseButtons.WHEEL_DOWN
        break
      case "left":
        button = MouseButtons.WHEEL_LEFT
        break
      case "right":
        button = MouseButtons.WHEEL_RIGHT
        break
    }

    await emitMouseEvent("scroll", x, y, button, { modifiers, delayMs })
  }

  const getCurrentPosition = (): MousePosition => {
    return { ...currentPosition }
  }

  const getPressedButtons = (): MouseButton[] => {
    return Array.from(buttonsPressed)
  }

  return {
    // Core interaction methods
    moveTo,
    click,
    doubleClick,
    pressDown,
    release,
    drag,
    scroll,

    // State getters
    getCurrentPosition,
    getPressedButtons,

    // Low-level event emission (for advanced use cases)
    emitMouseEvent,
  }
}
