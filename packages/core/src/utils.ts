import { TextAttributes } from "./types"

export function createTextAttributes({
  bold = false,
  italic = false,
  underline = false,
  dim = false,
  blink = false,
  inverse = false,
  hidden = false,
  strikethrough = false,
}: {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  dim?: boolean
  blink?: boolean
  inverse?: boolean
  hidden?: boolean
  strikethrough?: boolean
} = {}): number {
  let attributes = TextAttributes.NONE

  if (bold) attributes |= TextAttributes.BOLD
  if (italic) attributes |= TextAttributes.ITALIC
  if (underline) attributes |= TextAttributes.UNDERLINE
  if (dim) attributes |= TextAttributes.DIM
  if (blink) attributes |= TextAttributes.BLINK
  if (inverse) attributes |= TextAttributes.INVERSE
  if (hidden) attributes |= TextAttributes.HIDDEN
  if (strikethrough) attributes |= TextAttributes.STRIKETHROUGH

  return attributes
}
