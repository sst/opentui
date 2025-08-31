import type * as React from "react"
import type {
  AsciiFontProps,
  BoxProps,
  InputProps,
  SelectProps,
  TabSelectProps,
  TextProps,
} from "./src/types/components"
import type { ExtendedIntrinsicElements, OpenTUIComponents } from "./src/types/components"

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
    "ascii-font": AsciiFontProps
    "tab-select": TabSelectProps
  }
}
