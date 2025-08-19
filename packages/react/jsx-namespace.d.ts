import type * as React from "react"
import type {
  AsciiFontProps,
  BoxProps,
  GroupProps,
  InputProps,
  SelectProps,
  TabSelectProps,
  TextProps,
} from "./src/types/components"
import type { ExtendedIntrinsicElements, OpenTUIComponents } from "./src/types/extend"

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
    group: GroupProps
    input: InputProps
    select: SelectProps
    "ascii-font": AsciiFontProps
    "tab-select": TabSelectProps
  }
}
