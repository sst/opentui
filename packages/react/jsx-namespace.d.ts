import type * as React from "react"
import type {
  AsciiFontProps,
  BoxProps,
  ExtendedIntrinsicElements,
  InputProps,
  LineBreakProps,
  OpenTUIComponents,
  ScrollBoxProps,
  SelectProps,
  SpanProps,
  TabSelectProps,
  TextProps,
} from "./src/types/components"

export namespace JSX {
  type Element = React.ReactNode

  interface ElementClass extends React.ComponentClass<any> {
    render(): React.ReactNode
  }

  interface ElementAttributesProperty {
    props: {}
  }

  interface ElementChildrenAttribute {
    children: {}
  }

  interface IntrinsicElements extends React.JSX.IntrinsicElements, ExtendedIntrinsicElements<OpenTUIComponents> {
    box: BoxProps
    text: TextProps
    span: SpanProps
    input: InputProps
    select: SelectProps
    scrollbox: ScrollBoxProps
    "ascii-font": AsciiFontProps
    "tab-select": TabSelectProps
    // Text modifiers
    b: SpanProps
    i: SpanProps
    u: SpanProps
    strong: SpanProps
    em: SpanProps
    br: LineBreakProps
  }
}
