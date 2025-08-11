import type { ColorInput } from "../types"

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

export interface StyledChar {
  char: string
  style: StyleAttrs
}

export type StyledText = StyledChar[]

// TODO: The chars could be stored as a packed buffer of char+fg+bg+attributes
// and use the buffer.drawPackedBuffer method to draw more efficiently.
export class TextFragment {
  constructor(public chars: StyledText) {}

  append(other: TextFragment): TextFragment {
    return new TextFragment([...this.chars, ...other.chars])
  }

  static fromPlain(text: string): TextFragment {
    return new TextFragment([...text].map((c) => ({ char: c, style: {} })))
  }

  static fromStyled(text: string, style: StyleAttrs): TextFragment {
    return new TextFragment([...text].map((c) => ({ char: c, style })))
  }

  toString(): string {
    return this.chars.map((c) => c.char).join("")
  }

  toStyledText(): StyledText {
    return [...this.chars]
  }
}

function applyStyle(input: StylableInput, style: StyleAttrs): TextFragment {
  const chars = input instanceof TextFragment ? input.chars : TextFragment.fromPlain(String(input)).chars

  const styled = chars.map((c) => ({
    char: c.char,
    style: { ...c.style, ...style },
  }))

  return new TextFragment(styled)
}

export type StylableInput = string | number | boolean | TextFragment

export const black = (input: StylableInput): TextFragment => applyStyle(input, { fg: "black" })
export const red = (input: StylableInput): TextFragment => applyStyle(input, { fg: "red" })
export const green = (input: StylableInput): TextFragment => applyStyle(input, { fg: "green" })
export const yellow = (input: StylableInput): TextFragment => applyStyle(input, { fg: "yellow" })
export const blue = (input: StylableInput): TextFragment => applyStyle(input, { fg: "blue" })
export const magenta = (input: StylableInput): TextFragment => applyStyle(input, { fg: "magenta" })
export const cyan = (input: StylableInput): TextFragment => applyStyle(input, { fg: "cyan" })
export const white = (input: StylableInput): TextFragment => applyStyle(input, { fg: "white" })

// Bright color functions
export const brightBlack = (input: StylableInput): TextFragment => applyStyle(input, { fg: "brightBlack" })
export const brightRed = (input: StylableInput): TextFragment => applyStyle(input, { fg: "brightRed" })
export const brightGreen = (input: StylableInput): TextFragment => applyStyle(input, { fg: "brightGreen" })
export const brightYellow = (input: StylableInput): TextFragment => applyStyle(input, { fg: "brightYellow" })
export const brightBlue = (input: StylableInput): TextFragment => applyStyle(input, { fg: "brightBlue" })
export const brightMagenta = (input: StylableInput): TextFragment => applyStyle(input, { fg: "brightMagenta" })
export const brightCyan = (input: StylableInput): TextFragment => applyStyle(input, { fg: "brightCyan" })
export const brightWhite = (input: StylableInput): TextFragment => applyStyle(input, { fg: "brightWhite" })

// Background color functions
export const bgBlack = (input: StylableInput): TextFragment => applyStyle(input, { bg: "black" })
export const bgRed = (input: StylableInput): TextFragment => applyStyle(input, { bg: "red" })
export const bgGreen = (input: StylableInput): TextFragment => applyStyle(input, { bg: "green" })
export const bgYellow = (input: StylableInput): TextFragment => applyStyle(input, { bg: "yellow" })
export const bgBlue = (input: StylableInput): TextFragment => applyStyle(input, { bg: "blue" })
export const bgMagenta = (input: StylableInput): TextFragment => applyStyle(input, { bg: "magenta" })
export const bgCyan = (input: StylableInput): TextFragment => applyStyle(input, { bg: "cyan" })
export const bgWhite = (input: StylableInput): TextFragment => applyStyle(input, { bg: "white" })

// Style functions
export const bold = (input: StylableInput): TextFragment => applyStyle(input, { bold: true })
export const italic = (input: StylableInput): TextFragment => applyStyle(input, { italic: true })
export const underline = (input: StylableInput): TextFragment => applyStyle(input, { underline: true })
export const strikethrough = (input: StylableInput): TextFragment => applyStyle(input, { strikethrough: true })
export const dim = (input: StylableInput): TextFragment => applyStyle(input, { dim: true })
export const reverse = (input: StylableInput): TextFragment => applyStyle(input, { reverse: true })
export const blink = (input: StylableInput): TextFragment => applyStyle(input, { blink: true })

// Custom color functions
export const fg =
  (color: Color) =>
  (input: StylableInput): TextFragment =>
    applyStyle(input, { fg: color })
export const bg =
  (color: Color) =>
  (input: StylableInput): TextFragment =>
    applyStyle(input, { bg: color })

export function t(strings: TemplateStringsArray, ...values: StylableInput[]): TextFragment {
  const parts: TextFragment[] = []

  for (let i = 0; i < strings.length; i++) {
    const raw = strings[i]
    if (raw) parts.push(TextFragment.fromPlain(raw))

    const val = values[i]
    if (val instanceof TextFragment) {
      parts.push(val)
    } else if (val !== undefined) {
      parts.push(TextFragment.fromPlain(String(val)))
    }
  }

  return parts.reduce((acc, curr) => acc.append(curr), new TextFragment([]))
}
