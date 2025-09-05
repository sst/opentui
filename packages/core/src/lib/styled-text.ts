import type { TextChunk } from "../text-buffer"
import { createTextAttributes } from "../utils"
import { parseColor, type ColorInput } from "./RGBA"

export type Color = ColorInput
const textEncoder = new TextEncoder()

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

export class StyledText {
  public readonly chunks: TextChunk[]

  constructor(chunks: TextChunk[]) {
    this.chunks = chunks
  }

  private static _createInstance(chunks: TextChunk[]): StyledText {
    const newInstance = Object.create(StyledText.prototype)
    newInstance.chunks = chunks
    return newInstance
  }

  insert(chunk: TextChunk, index?: number): StyledText {
    const originalLength = this.chunks.length
    let newChunks: TextChunk[]

    if (index === undefined || index === originalLength || index < 0) {
      newChunks = [...this.chunks, chunk]
    } else {
      newChunks = [...this.chunks.slice(0, index), chunk, ...this.chunks.slice(index)]
    }

    return StyledText._createInstance(newChunks)
  }

  remove(chunk: TextChunk): StyledText {
    const originalLength = this.chunks.length
    const index = this.chunks.indexOf(chunk)
    if (index === -1) return this

    let newChunks: TextChunk[]

    if (index === originalLength - 1) {
      newChunks = this.chunks.slice(0, -1)
    } else {
      newChunks = [...this.chunks.slice(0, index), ...this.chunks.slice(index + 1)]
    }

    return StyledText._createInstance(newChunks)
  }

  replace(chunk: TextChunk, oldChunk: TextChunk): StyledText {
    const index = this.chunks.indexOf(oldChunk)
    if (index === -1) return this

    let newChunks: TextChunk[]

    if (index === this.chunks.length - 1) {
      newChunks = [...this.chunks.slice(0, -1), chunk]
    } else {
      newChunks = [...this.chunks.slice(0, index), chunk, ...this.chunks.slice(index + 1)]
    }

    return StyledText._createInstance(newChunks)
  }
}

export function stringToStyledText(content: string): StyledText {
  const textEncoder = new TextEncoder()
  const chunk = {
    __isChunk: true as const,
    text: textEncoder.encode(content),
    plainText: content,
  }
  return new StyledText([chunk])
}

export type StylableInput = string | number | boolean | TextChunk

const templateCache = new WeakMap<TemplateStringsArray, (TextChunk | null)[]>()

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
      plainText: existingChunk.plainText,
      fg,
      bg,
      attributes: mergedAttrs,
    }
  } else {
    const plainTextStr = String(input)
    const text = textEncoder.encode(plainTextStr)
    const fg = style.fg ? parseColor(style.fg) : undefined
    const bg = style.bg ? parseColor(style.bg) : undefined
    const attributes = createTextAttributes(style)

    return {
      __isChunk: true,
      text,
      plainText: plainTextStr,
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
export function tn(strings: TemplateStringsArray, ...values: StylableInput[]): StyledText {
  const chunks: TextChunk[] = []

  for (let i = 0; i < strings.length; i++) {
    const raw = strings[i]

    if (raw) {
      chunks.push({
        __isChunk: true,
        text: textEncoder.encode(raw),
        plainText: raw,
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
        text: textEncoder.encode(plainTextStr),
        plainText: plainTextStr,
        attributes: 0,
      })
    }
  }

  return new StyledText(chunks)
}

/**
 * Template literal handler for styled text (cached version).
 * Returns a StyledText object containing chunks of text with optional styles.
 * Uses caching to avoid re-encoding the same template strings.
 */
export function t(strings: TemplateStringsArray, ...values: StylableInput[]): StyledText {
  let cachedStringChunks = templateCache.get(strings)

  if (!cachedStringChunks) {
    cachedStringChunks = []
    for (let i = 0; i < strings.length; i++) {
      const raw = strings[i]
      if (raw) {
        cachedStringChunks.push({
          __isChunk: true,
          text: textEncoder.encode(raw),
          plainText: raw,
          attributes: 0,
        })
      } else {
        cachedStringChunks.push(null)
      }
    }
    templateCache.set(strings, cachedStringChunks)
  }

  const chunks: TextChunk[] = []

  for (let i = 0; i < strings.length; i++) {
    const stringChunk = cachedStringChunks[i]
    if (stringChunk) {
      chunks.push(stringChunk)
    }

    const val = values[i]
    if (typeof val === "object" && "__isChunk" in val) {
      chunks.push(val as TextChunk)
    } else if (val !== undefined) {
      const plainTextStr = String(val)
      chunks.push({
        __isChunk: true,
        text: textEncoder.encode(plainTextStr),
        plainText: plainTextStr,
        attributes: 0,
      })
    }
  }

  return new StyledText(chunks)
}
