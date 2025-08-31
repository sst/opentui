import { Renderable } from "@opentui/core"
import type {
  AsciiFontProps,
  BoxProps,
  ExtendedIntrinsicElements,
  InputProps,
  OpenTUIComponents,
  SelectProps,
  TabSelectProps,
  TextProps,
} from "./src/types/elements"

declare namespace JSX {
  // Replace Node with Renderable
  type Element = Renderable | ArrayElement | (string & {}) | number | boolean | null | undefined

  interface ArrayElement extends Array<Element> {}

  interface IntrinsicElements extends ExtendedIntrinsicElements<OpenTUIComponents> {
    box: BoxProps
    text: TextProps
    input: InputProps
    select: SelectProps
    ascii_font: AsciiFontProps
    tab_select: TabSelectProps
  }

  interface ElementChildrenAttribute {
    children: {}
  }
}
