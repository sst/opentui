import type { ColorInput } from "./types"

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
export class Fragment {
  constructor(public chars: StyledText) {}

  append(other: Fragment): Fragment {
    return new Fragment([...this.chars, ...other.chars])
  }

  static fromPlain(text: string): Fragment {
    return new Fragment([...text].map((c) => ({ char: c, style: {} })))
  }

  static fromStyled(text: string, style: StyleAttrs): Fragment {
    return new Fragment([...text].map((c) => ({ char: c, style })))
  }

  toString(): string {
    return this.chars.map((c) => c.char).join("")
  }

  toStyledText(): StyledText {
    return [...this.chars]
  }
}

function applyStyle(input: StylableInput, style: StyleAttrs): Fragment {
  const chars = input instanceof Fragment ? input.chars : Fragment.fromPlain(String(input)).chars

  const styled = chars.map((c) => ({
    char: c.char,
    style: { ...c.style, ...style },
  }))

  return new Fragment(styled)
}

export type StylableInput = string | number | boolean | Fragment

export const black = (input: StylableInput): Fragment => applyStyle(input, { fg: "black" })
export const red = (input: StylableInput): Fragment => applyStyle(input, { fg: "red" })
export const green = (input: StylableInput): Fragment => applyStyle(input, { fg: "green" })
export const yellow = (input: StylableInput): Fragment => applyStyle(input, { fg: "yellow" })
export const blue = (input: StylableInput): Fragment => applyStyle(input, { fg: "blue" })
export const magenta = (input: StylableInput): Fragment => applyStyle(input, { fg: "magenta" })
export const cyan = (input: StylableInput): Fragment => applyStyle(input, { fg: "cyan" })
export const white = (input: StylableInput): Fragment => applyStyle(input, { fg: "white" })

// Bright color functions
export const brightBlack = (input: StylableInput): Fragment => applyStyle(input, { fg: "brightBlack" })
export const brightRed = (input: StylableInput): Fragment => applyStyle(input, { fg: "brightRed" })
export const brightGreen = (input: StylableInput): Fragment => applyStyle(input, { fg: "brightGreen" })
export const brightYellow = (input: StylableInput): Fragment => applyStyle(input, { fg: "brightYellow" })
export const brightBlue = (input: StylableInput): Fragment => applyStyle(input, { fg: "brightBlue" })
export const brightMagenta = (input: StylableInput): Fragment => applyStyle(input, { fg: "brightMagenta" })
export const brightCyan = (input: StylableInput): Fragment => applyStyle(input, { fg: "brightCyan" })
export const brightWhite = (input: StylableInput): Fragment => applyStyle(input, { fg: "brightWhite" })

// Background color functions
export const bgBlack = (input: StylableInput): Fragment => applyStyle(input, { bg: "black" })
export const bgRed = (input: StylableInput): Fragment => applyStyle(input, { bg: "red" })
export const bgGreen = (input: StylableInput): Fragment => applyStyle(input, { bg: "green" })
export const bgYellow = (input: StylableInput): Fragment => applyStyle(input, { bg: "yellow" })
export const bgBlue = (input: StylableInput): Fragment => applyStyle(input, { bg: "blue" })
export const bgMagenta = (input: StylableInput): Fragment => applyStyle(input, { bg: "magenta" })
export const bgCyan = (input: StylableInput): Fragment => applyStyle(input, { bg: "cyan" })
export const bgWhite = (input: StylableInput): Fragment => applyStyle(input, { bg: "white" })

// Style functions
export const bold = (input: StylableInput): Fragment => applyStyle(input, { bold: true })
export const italic = (input: StylableInput): Fragment => applyStyle(input, { italic: true })
export const underline = (input: StylableInput): Fragment => applyStyle(input, { underline: true })
export const strikethrough = (input: StylableInput): Fragment => applyStyle(input, { strikethrough: true })
export const dim = (input: StylableInput): Fragment => applyStyle(input, { dim: true })
export const reverse = (input: StylableInput): Fragment => applyStyle(input, { reverse: true })
export const blink = (input: StylableInput): Fragment => applyStyle(input, { blink: true })

// Custom color functions
export const fg =
  (color: Color) =>
  (input: StylableInput): Fragment =>
    applyStyle(input, { fg: color })
export const bg =
  (color: Color) =>
  (input: StylableInput): Fragment =>
    applyStyle(input, { bg: color })

export function t(strings: TemplateStringsArray, ...values: StylableInput[]): Fragment {
  const parts: Fragment[] = []

  for (let i = 0; i < strings.length; i++) {
    const raw = strings[i]
    if (raw) parts.push(Fragment.fromPlain(raw))

    const val = values[i]
    if (val instanceof Fragment) {
      parts.push(val)
    } else if (val !== undefined) {
      parts.push(Fragment.fromPlain(String(val)))
    }
  }

  return parts.reduce((acc, curr) => acc.append(curr), new Fragment([]))
}
