import { Renderable } from "@opentui/core"
import {
  ASCIIFontElementProps,
  BoxElementProps,
  GroupElementProps,
  InputElementProps,
  SelectElementProps,
  TabSelectElementProps,
  TextElementProps,
} from "./src/elements/index"

declare namespace JSX {
  // Replace Node with Renderable
  type Element = Renderable | ArrayElement | (string & {}) | number | boolean | null | undefined

  interface ArrayElement extends Array<Element> {}

  interface IntrinsicElements {
    ascii_font: ASCIIFontElementProps
    box: BoxElementProps
    group: GroupElementProps
    input: InputElementProps
    select: SelectElementProps
    tab_select: TabSelectElementProps
    text: TextElementProps
  }

  interface ElementChildrenAttribute {
    children: {}
  }
}
