import type { TextChunk } from "../text-buffer"
import type { ColorInput } from "../types"
import { createTextAttributes, parseColor } from "../utils"

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
  // TODO: plaintext should not be needed anymore when selection moved to native
  private _plainText: string = ''

  constructor(chunks: TextChunk[]) {
    this.chunks = chunks

    for (let i = 0; i < chunks.length; i++) {
      this._plainText += chunks[i].plainText
    }
  }

  toString(): string {
    return this._plainText
  }

  private _chunksToPlainText(): void {
    this._plainText = ""
    for (const chunk of this.chunks) {
      this._plainText += chunk.plainText
    }
  }

  insert(chunk: TextChunk, index?: number): void {
    const originalLength = this.chunks.length
    if (index === undefined) {
      this.chunks.push(chunk)
    } else {
      this.chunks.splice(index, 0, chunk)
    }
    if (index === undefined || index === originalLength) {
      this._plainText += chunk.plainText
    } else {
      this._chunksToPlainText()
    }
  }

  remove(chunk: TextChunk): void {
    const originalLength = this.chunks.length
    const index = this.chunks.indexOf(chunk)
    if (index === -1) return
    this.chunks.splice(index, 1)
    if (index === originalLength - 1) {
      this._plainText = this._plainText.slice(0, this._plainText.length - chunk.plainText.length)
    } else {
      this._chunksToPlainText()
    }
  }

  replace(chunk: TextChunk, oldChunk: TextChunk): void {
    const index = this.chunks.indexOf(oldChunk)
    if (index === -1) return
    this.chunks.splice(index, 1, chunk)
    if (index === this.chunks.length - 1) {
      this._plainText = this._plainText.slice(0, this._plainText.length - oldChunk.plainText.length) + chunk.plainText
    } else {
      this._chunksToPlainText()
    }
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
  let length = 0
  let plainText = ""

  for (let i = 0; i < strings.length; i++) {
    const raw = strings[i]

    if (raw) {
      chunks.push({
        __isChunk: true,
        text: textEncoder.encode(raw),
        plainText: raw,
        attributes: 0,
      })
      length += raw.length
      plainText += raw
    }

    const val = values[i]
    if (typeof val === "object" && "__isChunk" in val) {
      chunks.push(val as TextChunk)
      length += (val as TextChunk).plainText.length
      plainText += (val as TextChunk).plainText
    } else if (val !== undefined) {
      const plainTextStr = String(val)
      chunks.push({
        __isChunk: true,
        text: textEncoder.encode(plainTextStr),
        plainText: plainTextStr,
        attributes: 0,
      })
      length += plainTextStr.length
      plainText += plainTextStr
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
  let length = 0
  let plainText = ""

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
      length += stringChunk.plainText.length
      plainText += stringChunk.plainText
    }

    const val = values[i]
    if (typeof val === "object" && "__isChunk" in val) {
      chunks.push(val as TextChunk)
      length += (val as TextChunk).plainText.length
      plainText += (val as TextChunk).plainText
    } else if (val !== undefined) {
      const plainTextStr = String(val)
      chunks.push({
        __isChunk: true,
        text: textEncoder.encode(plainTextStr),
        plainText: plainTextStr,
        attributes: 0,
      })
      length += plainTextStr.length
      plainText += plainTextStr
    }
  }

  return new StyledText(chunks)
}
