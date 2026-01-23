import type * as React from "react"
import type {
  AsciiFontProps,
  BoxProps,
  CodeProps,
  DiffProps,
  ExtendedIntrinsicElements,
  InputProps,
  LineBreakProps,
  LineNumberProps,
  LinkProps,
  MarkdownProps,
  OpenTUIComponents,
  ScrollBoxProps,
  SelectProps,
  SpanProps,
  TabSelectProps,
  TextareaProps,
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

  interface IntrinsicAttributes extends React.Attributes {}

  interface IntrinsicElements extends React.JSX.IntrinsicElements, ExtendedIntrinsicElements<OpenTUIComponents> {
    box: BoxProps
    text: TextProps
    span: SpanProps
    code: CodeProps
    diff: DiffProps
    markdown: MarkdownProps
    input: InputProps
    textarea: TextareaProps
    select: SelectProps
    scrollbox: ScrollBoxProps
    "ascii-font": AsciiFontProps
    "tab-select": TabSelectProps
    "line-number": LineNumberProps
    // Text modifiers
    b: SpanProps
    i: SpanProps
    u: SpanProps
    strong: SpanProps
    em: SpanProps
    br: LineBreakProps
    a: LinkProps
  }
}
