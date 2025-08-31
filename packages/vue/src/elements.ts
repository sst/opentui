import {
  ASCIIFontRenderable,
  BoxRenderable,
  InputRenderable,
  SelectRenderable,
  TabSelectRenderable,
  TextRenderable,
} from "@opentui/core"

export const elements = {
  asciiFontRenderable: ASCIIFontRenderable,
  boxRenderable: BoxRenderable,
  inputRenderable: InputRenderable,
  selectRenderable: SelectRenderable,
  tabSelectRenderable: TabSelectRenderable,
  textRenderable: TextRenderable,
}
export type Element = keyof typeof elements
