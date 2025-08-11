import type { OptimizedBuffer } from "../buffer"
import type { ColorInput } from "../types"
import { parseColor } from "../utils"

export interface BorderCharacters {
  topLeft: string
  topRight: string
  bottomLeft: string
  bottomRight: string
  horizontal: string
  vertical: string
  topT: string
  bottomT: string
  leftT: string
  rightT: string
  cross: string
}

export type BorderStyle = "single" | "double" | "rounded" | "heavy"
export type BorderSides = "top" | "right" | "bottom" | "left"

export const BorderChars: Record<BorderStyle, BorderCharacters> = {
  single: {
    topLeft: "┌",
    topRight: "┐",
    bottomLeft: "└",
    bottomRight: "┘",
    horizontal: "─",
    vertical: "│",
    topT: "┬",
    bottomT: "┴",
    leftT: "├",
    rightT: "┤",
    cross: "┼",
  },
  double: {
    topLeft: "╔",
    topRight: "╗",
    bottomLeft: "╚",
    bottomRight: "╝",
    horizontal: "═",
    vertical: "║",
    topT: "╦",
    bottomT: "╩",
    leftT: "╠",
    rightT: "╣",
    cross: "╬",
  },
  rounded: {
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    horizontal: "─",
    vertical: "│",
    topT: "┬",
    bottomT: "┴",
    leftT: "├",
    rightT: "┤",
    cross: "┼",
  },
  heavy: {
    topLeft: "┏",
    topRight: "┓",
    bottomLeft: "┗",
    bottomRight: "┛",
    horizontal: "━",
    vertical: "┃",
    topT: "┳",
    bottomT: "┻",
    leftT: "┣",
    rightT: "┫",
    cross: "╋",
  },
}

export interface BorderConfig {
  borderStyle: BorderStyle
  border: boolean | BorderSides[]
  borderColor?: ColorInput
  customBorderChars?: BorderCharacters
}

export interface BorderDrawOptions {
  x: number
  y: number
  width: number
  height: number
  borderStyle: BorderStyle
  border: boolean | BorderSides[]
  borderColor: ColorInput
  customBorderChars?: BorderCharacters
  backgroundColor: ColorInput
  title?: string
  titleAlignment?: "left" | "center" | "right"
}

export interface BorderSidesConfig {
  top: boolean
  right: boolean
  bottom: boolean
  left: boolean
}

export function getBorderFromSides(sides: BorderSidesConfig): boolean | BorderSides[] {
  const result: BorderSides[] = []
  if (sides.top) result.push("top")
  if (sides.right) result.push("right")
  if (sides.bottom) result.push("bottom")
  if (sides.left) result.push("left")
  return result.length > 0 ? result : false
}

export function getBorderSides(border: boolean | BorderSides[]): BorderSidesConfig {
  return border === true
    ? { top: true, right: true, bottom: true, left: true }
    : Array.isArray(border)
      ? {
          top: border.includes("top"),
          right: border.includes("right"),
          bottom: border.includes("bottom"),
          left: border.includes("left"),
        }
      : { top: false, right: false, bottom: false, left: false }
}

export function drawBorder(buffer: OptimizedBuffer, options: BorderDrawOptions): void {
  const borderColor = parseColor(options.borderColor)
  const backgroundColor = parseColor(options.backgroundColor)
  const borderSides = getBorderSides(options.border)
  const borders = options.customBorderChars || BorderChars[options.borderStyle]

  // Calculate visible area within buffer bounds
  const startX = Math.max(0, options.x)
  const startY = Math.max(0, options.y)
  const endX = Math.min(buffer.getWidth() - 1, options.x + options.width - 1)
  const endY = Math.min(buffer.getHeight() - 1, options.y + options.height - 1)

  // Calculate title positions if title is provided
  const drawTop = borderSides.top
  let shouldDrawTitle = false
  let titleX = startX
  let titleStartX = 0
  let titleEndX = 0

  if (options.title && options.title.length > 0 && drawTop) {
    const titleLength = options.title.length
    const minTitleSpace = 4 // Min space needed for title with border

    shouldDrawTitle = options.width >= titleLength + minTitleSpace

    if (shouldDrawTitle) {
      const padding = 2

      if (options.titleAlignment === "center") {
        titleX = startX + Math.max(padding, Math.floor((options.width - titleLength) / 2))
      } else if (options.titleAlignment === "right") {
        titleX = startX + options.width - padding - titleLength
      } else {
        titleX = startX + padding
      }

      titleX = Math.max(startX + padding, Math.min(titleX, endX - titleLength))
      titleStartX = titleX
      titleEndX = titleX + titleLength - 1
    }
  }

  const drawBottom = borderSides.bottom
  const drawLeft = borderSides.left
  const drawRight = borderSides.right

  // Special cases for extending vertical borders
  const leftBorderOnly = drawLeft && !drawTop && !drawBottom
  const rightBorderOnly = drawRight && !drawTop && !drawBottom
  const bottomOnlyWithVerticals = drawBottom && !drawTop && (drawLeft || drawRight)
  const topOnlyWithVerticals = drawTop && !drawBottom && (drawLeft || drawRight)

  const extendVerticalsToTop = leftBorderOnly || rightBorderOnly || bottomOnlyWithVerticals
  const extendVerticalsToBottom = leftBorderOnly || rightBorderOnly || topOnlyWithVerticals

  // Draw horizontal borders
  if (drawTop || drawBottom) {
    // Draw top border
    if (drawTop) {
      for (let x = startX; x <= endX; x++) {
        if (startY >= 0 && startY < buffer.getHeight()) {
          let char = borders.horizontal

          // Handle corners
          if (x === startX) {
            char = drawLeft ? borders.topLeft : borders.horizontal
          } else if (x === endX) {
            char = drawRight ? borders.topRight : borders.horizontal
          }

          // Skip rendering border char if title should be drawn at this position
          if (shouldDrawTitle && x >= titleStartX && x <= titleEndX) {
            continue
          }

          buffer.setCellWithAlphaBlending(x, startY, char, borderColor, backgroundColor)
        }
      }
    }

    // Draw bottom border
    if (drawBottom) {
      for (let x = startX; x <= endX; x++) {
        if (endY >= 0 && endY < buffer.getHeight()) {
          let char = borders.horizontal

          // Handle corners
          if (x === startX) {
            char = drawLeft ? borders.bottomLeft : borders.horizontal
          } else if (x === endX) {
            char = drawRight ? borders.bottomRight : borders.horizontal
          }

          buffer.setCellWithAlphaBlending(x, endY, char, borderColor, backgroundColor)
        }
      }
    }
  }

  // Draw vertical borders
  const verticalStartY = extendVerticalsToTop ? startY : startY + (drawTop ? 1 : 0)
  const verticalEndY = extendVerticalsToBottom ? endY : endY - (drawBottom ? 1 : 0)

  if (drawLeft || drawRight) {
    for (let y = verticalStartY; y <= verticalEndY; y++) {
      // Left border
      if (drawLeft && startX >= 0 && startX < buffer.getWidth()) {
        buffer.setCellWithAlphaBlending(startX, y, borders.vertical, borderColor, backgroundColor)
      }

      // Right border
      if (drawRight && endX >= 0 && endX < buffer.getWidth()) {
        buffer.setCellWithAlphaBlending(endX, y, borders.vertical, borderColor, backgroundColor)
      }
    }
  }

  // Draw title if specified
  if (shouldDrawTitle && options.title) {
    buffer.drawText(options.title, titleX, startY, borderColor, backgroundColor, 0)
  }
}
