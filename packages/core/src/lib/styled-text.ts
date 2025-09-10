import type { TextRenderable } from "../renderables/Text"
import type { TextBuffer, TextChunk } from "../text-buffer"
import { createTextAttributes } from "../utils"
import { parseColor, type ColorInput } from "./RGBA"

const BrandedStyledText: unique symbol = Symbol.for("@opentui/core/StyledText")

export type Color = ColorInput

export interface StyleAttrs {
  fg?: Color
  bg?: Color
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  dim?: boolean
  reverse?: boolean
  blink?: boolean
}

export function isStyledText(obj: any): obj is StyledText {
  return obj && obj[BrandedStyledText]
}

export class StyledText {
  [BrandedStyledText] = true

  public chunks: TextChunk[]
  public textRenderable?: TextRenderable

  constructor(chunks: TextChunk[]) {
    this.chunks = chunks
  }

  public mount(textRenderable: TextRenderable): void {
    this.textRenderable = textRenderable
  }

  /**
   * @deprecated: Use textRenderable.insertChunk instead
   */
  insert(chunk: TextChunk, index?: number): StyledText {
    const originalLength = this.chunks.length
    if (this.textRenderable) {
      this.textRenderable.insertChunk(chunk, index ?? originalLength)

      let newChunks: TextChunk[]

      if (index === undefined || index === originalLength) {
        newChunks = [...this.chunks, chunk]
      } else {
        newChunks = [...this.chunks.slice(0, index), chunk, ...this.chunks.slice(index)]
      }
      this.chunks = newChunks
    }
    return this
  }

  /**
   * @deprecated: Use textRenderable.removeChunk instead
   */
  remove(chunk: TextChunk): StyledText {
    if (this.textRenderable) {
      this.textRenderable.removeChunk(chunk)

      const originalLength = this.chunks.length
      const index = this.chunks.indexOf(chunk)
      if (index === -1) return this

      let newChunks: TextChunk[]

      if (index === originalLength - 1) {
        newChunks = this.chunks.slice(0, -1)
      } else {
        newChunks = [...this.chunks.slice(0, index), ...this.chunks.slice(index + 1)]
      }
      this.chunks = newChunks
    }
    return this
  }

  /**
   * @deprecated: Use textRenderable.replaceChunk instead
   */
  replace(chunk: TextChunk, oldChunk: TextChunk): StyledText {
    if (this.textRenderable) {
      this.textRenderable.replaceChunk(chunk, oldChunk)

      const index = this.chunks.indexOf(oldChunk)
      if (index === -1) return this

      let newChunks: TextChunk[]

      if (index === this.chunks.length - 1) {
        newChunks = [...this.chunks.slice(0, -1), chunk]
      } else {
        newChunks = [...this.chunks.slice(0, index), chunk, ...this.chunks.slice(index + 1)]
      }
      this.chunks = newChunks
    }
    return this
  }
}

export function stringToStyledText(content: string): StyledText {
  const chunk = {
    __isChunk: true as const,
    text: content,
  }
  return new StyledText([chunk])
}

export type StylableInput = string | number | boolean | TextChunk

function applyStyle(input: StylableInput, style: StyleAttrs): TextChunk {
  if (typeof input === "object" && "__isChunk" in input) {
    const existingChunk = input as TextChunk

    const fg = style.fg ? parseColor(style.fg) : existingChunk.fg
    const bg = style.bg ? parseColor(style.bg) : existingChunk.bg

    const newAttrs = createTextAttributes(style)
    const mergedAttrs = existingChunk.attributes ? existingChunk.attributes | newAttrs : newAttrs

    return {
      __isChunk: true,
      text: existingChunk.text,
      fg,
      bg,
      attributes: mergedAttrs,
    }
  } else {
    const plainTextStr = String(input)
    const fg = style.fg ? parseColor(style.fg) : undefined
    const bg = style.bg ? parseColor(style.bg) : undefined
    const attributes = createTextAttributes(style)

    return {
      __isChunk: true,
      text: plainTextStr,
      fg,
      bg,
      attributes,
    }
  }
}

// Color functions
export const black = (input: StylableInput): TextChunk => applyStyle(input, { fg: "black" })
export const red = (input: StylableInput): TextChunk => applyStyle(input, { fg: "red" })
export const green = (input: StylableInput): TextChunk => applyStyle(input, { fg: "green" })
export const yellow = (input: StylableInput): TextChunk => applyStyle(input, { fg: "yellow" })
export const blue = (input: StylableInput): TextChunk => applyStyle(input, { fg: "blue" })
export const magenta = (input: StylableInput): TextChunk => applyStyle(input, { fg: "magenta" })
export const cyan = (input: StylableInput): TextChunk => applyStyle(input, { fg: "cyan" })
export const white = (input: StylableInput): TextChunk => applyStyle(input, { fg: "white" })

// Bright color functions
export const brightBlack = (input: StylableInput): TextChunk => applyStyle(input, { fg: "brightBlack" })
export const brightRed = (input: StylableInput): TextChunk => applyStyle(input, { fg: "brightRed" })
export const brightGreen = (input: StylableInput): TextChunk => applyStyle(input, { fg: "brightGreen" })
export const brightYellow = (input: StylableInput): TextChunk => applyStyle(input, { fg: "brightYellow" })
export const brightBlue = (input: StylableInput): TextChunk => applyStyle(input, { fg: "brightBlue" })
export const brightMagenta = (input: StylableInput): TextChunk => applyStyle(input, { fg: "brightMagenta" })
export const brightCyan = (input: StylableInput): TextChunk => applyStyle(input, { fg: "brightCyan" })
export const brightWhite = (input: StylableInput): TextChunk => applyStyle(input, { fg: "brightWhite" })

// Background color functions
export const bgBlack = (input: StylableInput): TextChunk => applyStyle(input, { bg: "black" })
export const bgRed = (input: StylableInput): TextChunk => applyStyle(input, { bg: "red" })
export const bgGreen = (input: StylableInput): TextChunk => applyStyle(input, { bg: "green" })
export const bgYellow = (input: StylableInput): TextChunk => applyStyle(input, { bg: "yellow" })
export const bgBlue = (input: StylableInput): TextChunk => applyStyle(input, { bg: "blue" })
export const bgMagenta = (input: StylableInput): TextChunk => applyStyle(input, { bg: "magenta" })
export const bgCyan = (input: StylableInput): TextChunk => applyStyle(input, { bg: "cyan" })
export const bgWhite = (input: StylableInput): TextChunk => applyStyle(input, { bg: "white" })

// Style functions
export const bold = (input: StylableInput): TextChunk => applyStyle(input, { bold: true })
export const italic = (input: StylableInput): TextChunk => applyStyle(input, { italic: true })
export const underline = (input: StylableInput): TextChunk => applyStyle(input, { underline: true })
export const strikethrough = (input: StylableInput): TextChunk => applyStyle(input, { strikethrough: true })
export const dim = (input: StylableInput): TextChunk => applyStyle(input, { dim: true })
export const reverse = (input: StylableInput): TextChunk => applyStyle(input, { reverse: true })
export const blink = (input: StylableInput): TextChunk => applyStyle(input, { blink: true })

// Custom color functions
export const fg =
  (color: Color) =>
  (input: StylableInput): TextChunk =>
    applyStyle(input, { fg: color })
export const bg =
  (color: Color) =>
  (input: StylableInput): TextChunk =>
    applyStyle(input, { bg: color })

/**
 * Template literal handler for styled text (non-cached version).
 * Returns a StyledText object containing chunks of text with optional styles.
 */
export function t(strings: TemplateStringsArray, ...values: StylableInput[]): StyledText {
  const chunks: TextChunk[] = []

  for (let i = 0; i < strings.length; i++) {
    const raw = strings[i]

    if (raw) {
      chunks.push({
        __isChunk: true,
        text: raw,
        attributes: 0,
      })
    }

    const val = values[i]
    if (typeof val === "object" && "__isChunk" in val) {
      chunks.push(val as TextChunk)
    } else if (val !== undefined) {
      const plainTextStr = String(val)
      chunks.push({
        __isChunk: true,
        text: plainTextStr,
        attributes: 0,
      })
    }
  }

  return new StyledText(chunks)
}
