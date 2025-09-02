import type * as React from "react"
import type {
  AsciiFontProps,
  BoxProps,
  ExtendedIntrinsicElements,
  InputProps,
  OpenTUIComponents,
  ScrollBoxProps,
  SelectProps,
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
    input: InputProps
    select: SelectProps
    scrollbox: ScrollBoxProps
    "ascii-font": AsciiFontProps
    "tab-select": TabSelectProps
  }
}
