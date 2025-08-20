import { OptimizedBuffer } from "../buffer"
import { RGBA } from "../types"
import tiny from "./fonts/tiny.json"
import block from "./fonts/block.json"
import shade from "./fonts/shade.json"
import slick from "./fonts/slick.json"

/*
 * Renders ASCII fonts to a buffer.
 * Font definitions plugged from cfonts - https://github.com/dominikwilkowski/cfonts
 */

// Export built-in fonts for convenience
export const fonts = {
  tiny: tiny as FontDefinition,
  block: block as FontDefinition,
  shade: shade as FontDefinition,
  slick: slick as FontDefinition,
}

type FontSegment = {
  text: string
  colorIndex: number
}

export type FontDefinition = {
  name: string
  lines: number
  letterspace_size: number
  letterspace: string[]
  colors?: number
  chars: Record<string, string[]>
}

/**
 * Validates a FontDefinition object
 * @param font - Object to validate
 * @returns true if valid, throws error if invalid
 */
export function validateFontDefinition(font: any): font is FontDefinition {
  if (!font || typeof font !== 'object') {
    throw new Error('Font definition must be an object')
  }

  if (typeof font.name !== 'string') {
    throw new Error('Font definition must have a "name" property of type string')
  }

  if (typeof font.lines !== 'number' || font.lines < 1) {
    throw new Error('Font definition must have a "lines" property with a positive number')
  }

  if (typeof font.letterspace_size !== 'number' || font.letterspace_size < 0) {
    throw new Error('Font definition must have a "letterspace_size" property with a non-negative number')
  }

  if (!Array.isArray(font.letterspace)) {
    throw new Error('Font definition must have a "letterspace" property as an array')
  }

  if (font.letterspace.length !== font.lines) {
    throw new Error(`Font definition letterspace array length (${font.letterspace.length}) must match lines (${font.lines})`)
  }

  if (font.colors !== undefined && (typeof font.colors !== 'number' || font.colors < 1)) {
    throw new Error('Font definition "colors" property must be a positive number if provided')
  }

  if (!font.chars || typeof font.chars !== 'object') {
    throw new Error('Font definition must have a "chars" property as an object')
  }

  // Validate that each character has the correct number of lines
  for (const [char, lines] of Object.entries(font.chars)) {
    if (!Array.isArray(lines)) {
      throw new Error(`Character "${char}" must be an array of strings`)
    }
    if (lines.length !== font.lines) {
      throw new Error(`Character "${char}" has ${lines.length} lines but font defines ${font.lines} lines`)
    }
    for (let i = 0; i < lines.length; i++) {
      if (typeof lines[i] !== 'string') {
        throw new Error(`Character "${char}" line ${i + 1} must be a string`)
      }
    }
  }

  return true
}

type ParsedFontDefinition = {
  name: string
  lines: number
  letterspace_size: number
  letterspace: string[]
  colors: number
  chars: Record<string, FontSegment[][]>
}

const parsedFonts: Map<FontDefinition, ParsedFontDefinition> = new Map()

function parseColorTags(text: string): FontSegment[] {
  const segments: FontSegment[] = []
  let currentIndex = 0

  const colorTagRegex = /<c(\d+)>(.*?)<\/c\d+>/g
  let lastIndex = 0
  let match

  while ((match = colorTagRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const plainText = text.slice(lastIndex, match.index)
      if (plainText) {
        segments.push({ text: plainText, colorIndex: 0 })
      }
    }

    const colorIndex = parseInt(match[1]) - 1
    const taggedText = match[2]
    segments.push({ text: taggedText, colorIndex: Math.max(0, colorIndex) })

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex)
    if (remainingText) {
      segments.push({ text: remainingText, colorIndex: 0 })
    }
  }

  return segments
}

function getParsedFont(fontDef: FontDefinition): ParsedFontDefinition {
  // Validate font definition on first use
  try {
    validateFontDefinition(fontDef)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Invalid font definition: ${message}`)
    throw error
  }

  if (!parsedFonts.has(fontDef)) {
    const parsedChars: Record<string, FontSegment[][]> = {}

    for (const [char, lines] of Object.entries(fontDef.chars)) {
      parsedChars[char] = lines.map((line) => parseColorTags(line))
    }

    parsedFonts.set(fontDef, {
      ...fontDef,
      colors: fontDef.colors || 1,
      chars: parsedChars,
    })
  }

  return parsedFonts.get(fontDef)!
}

export function measureText({ text, font = fonts.tiny }: { text: string; font?: FontDefinition }): {
  width: number
  height: number
} {
  const fontDef = getParsedFont(font)

  let currentX = 0

  for (let i = 0; i < text.length; i++) {
    const char = text[i].toUpperCase()
    const charDef = fontDef.chars[char]

    if (!charDef) {
      const spaceChar = fontDef.chars[" "]
      if (spaceChar && spaceChar[0]) {
        let spaceWidth = 0
        for (const segment of spaceChar[0]) {
          spaceWidth += segment.text.length
        }
        currentX += spaceWidth
      } else {
        currentX += 1
      }
      continue
    }

    let charWidth = 0
    if (charDef[0]) {
      for (const segment of charDef[0]) {
        charWidth += segment.text.length
      }
    }

    currentX += charWidth

    if (i < text.length - 1) {
      currentX += fontDef.letterspace_size
    }
  }

  return {
    width: currentX,
    height: fontDef.lines,
  }
}

export function getCharacterPositions(text: string, font: FontDefinition = fonts.tiny): number[] {
  const fontDef = getParsedFont(font)

  const positions: number[] = [0]
  let currentX = 0

  for (let i = 0; i < text.length; i++) {
    const char = text[i].toUpperCase()
    const charDef = fontDef.chars[char]

    let charWidth = 0
    if (!charDef) {
      const spaceChar = fontDef.chars[" "]
      if (spaceChar && spaceChar[0]) {
        for (const segment of spaceChar[0]) {
          charWidth += segment.text.length
        }
      } else {
        charWidth = 1
      }
    } else if (charDef[0]) {
      for (const segment of charDef[0]) {
        charWidth += segment.text.length
      }
    }

    currentX += charWidth

    if (i < text.length - 1) {
      currentX += fontDef.letterspace_size
    }

    positions.push(currentX)
  }

  return positions
}

export function coordinateToCharacterIndex(x: number, text: string, font: FontDefinition = fonts.tiny): number {
  const positions = getCharacterPositions(text, font)

  if (x < 0) {
    return 0
  }

  for (let i = 0; i < positions.length - 1; i++) {
    const currentPos = positions[i]
    const nextPos = positions[i + 1]

    if (x >= currentPos && x < nextPos) {
      const charMidpoint = currentPos + (nextPos - currentPos) / 2
      return x < charMidpoint ? i : i + 1
    }
  }

  if (positions.length > 0 && x >= positions[positions.length - 1]) {
    return text.length
  }

  return 0
}

export function renderFontToFrameBuffer(
  buffer: OptimizedBuffer,
  {
    text,
    x = 0,
    y = 0,
    fg = [RGBA.fromInts(255, 255, 255, 255)],
    bg = RGBA.fromInts(0, 0, 0, 255),
    font = fonts.tiny,
  }: {
    text: string
    x?: number
    y?: number
    fg?: RGBA | RGBA[]
    bg?: RGBA
    font?: FontDefinition
  },
): { width: number; height: number } {
  const width = buffer.getWidth()
  const height = buffer.getHeight()

  const fontDef = getParsedFont(font)

  const colors = Array.isArray(fg) ? fg : [fg]

  if (y < 0 || y + fontDef.lines > height) {
    return { width: 0, height: fontDef.lines }
  }

  let currentX = x
  const startX = x

  for (let i = 0; i < text.length; i++) {
    const char = text[i].toUpperCase()
    const charDef = fontDef.chars[char]

    if (!charDef) {
      const spaceChar = fontDef.chars[" "]
      if (spaceChar && spaceChar[0]) {
        let spaceWidth = 0
        for (const segment of spaceChar[0]) {
          spaceWidth += segment.text.length
        }
        currentX += spaceWidth
      } else {
        currentX += 1
      }
      continue
    }

    let charWidth = 0
    if (charDef[0]) {
      for (const segment of charDef[0]) {
        charWidth += segment.text.length
      }
    }

    if (currentX >= width) break
    if (currentX + charWidth < 0) {
      currentX += charWidth + fontDef.letterspace_size
      continue
    }

    for (let lineIdx = 0; lineIdx < fontDef.lines && lineIdx < charDef.length; lineIdx++) {
      const segments = charDef[lineIdx]
      const renderY = y + lineIdx

      if (renderY >= 0 && renderY < height) {
        let segmentX = currentX

        for (const segment of segments) {
          const segmentColor = colors[segment.colorIndex] || colors[0]

          for (let charIdx = 0; charIdx < segment.text.length; charIdx++) {
            const renderX = segmentX + charIdx

            if (renderX >= 0 && renderX < width) {
              const fontChar = segment.text[charIdx]
              if (fontChar !== " ") {
                buffer.setCell(renderX, renderY, fontChar, segmentColor, bg)
              }
            }
          }

          segmentX += segment.text.length
        }
      }
    }

    currentX += charWidth

    if (i < text.length - 1) {
      currentX += fontDef.letterspace_size
    }
  }

  return {
    width: currentX - startX,
    height: fontDef.lines,
  }
}
