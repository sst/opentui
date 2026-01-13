import {
  ASCIIFontRenderable,
  BoxRenderable,
  InputRenderable,
  SelectRenderable,
  StatelessTerminalRenderable,
  TabSelectRenderable,
  TextRenderable,
  ScrollBoxRenderable,
} from "@opentui/core"

export const elements = {
  asciiFontRenderable: ASCIIFontRenderable,
  boxRenderable: BoxRenderable,
  inputRenderable: InputRenderable,
  selectRenderable: SelectRenderable,
  tabSelectRenderable: TabSelectRenderable,
  statelessTerminalRenderable: StatelessTerminalRenderable,
  textRenderable: TextRenderable,
  scrollBoxRenderable: ScrollBoxRenderable,
}
export type Element = keyof typeof elements
