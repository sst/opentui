import { Renderable } from "@opentui/core"
import type {
  AsciiFontProps,
  BoxProps,
  CodeProps,
  ExtendedIntrinsicElements,
  InputProps,
  OpenTUIComponents,
  ScrollBoxProps,
  SelectProps,
  SpanProps,
  TabSelectProps,
  TextareaProps,
  TextProps,
} from "./src/types/elements"
import type { DomNode } from "./dist"

declare namespace JSX {
  // Replace Node with Renderable
  type Element = DomNode | ArrayElement | string | number | boolean | null | undefined

  type ArrayElement = Array<Element>

  interface IntrinsicElements extends ExtendedIntrinsicElements<OpenTUIComponents> {
    box: BoxProps
    text: TextProps
    span: SpanProps
    input: InputProps
    select: SelectProps
    ascii_font: AsciiFontProps
    tab_select: TabSelectProps
    scrollbox: ScrollBoxProps
    code: CodeProps
    textarea: TextareaProps

    b: SpanProps
    strong: SpanProps
    i: SpanProps
    em: SpanProps
    u: SpanProps
    br: {}
  }

  interface ElementChildrenAttribute {
    children: {}
  }
}
