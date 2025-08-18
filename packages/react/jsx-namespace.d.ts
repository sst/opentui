import type { BoxProps, GroupProps, InputProps, SelectProps, TabSelectProps, TextProps } from "./src/types/components"
import type { ExtendedIntrinsicElements, OpenTUIComponents } from "./src/types/extend"

export namespace JSX {
  interface Element extends React.ReactElement<any, any> {}

  interface ElementClass {
    render: any
  }
  interface ElementAttributesProperty {
    props: {}
  }
  interface ElementChildrenAttribute {
    children: {}
  }

  interface IntrinsicElements extends ExtendedIntrinsicElements<OpenTUIComponents> {
    box: BoxProps
    group: GroupProps
    input: InputProps
    select: SelectProps
    "tab-select": TabSelectProps
    text: TextProps
  }
}
