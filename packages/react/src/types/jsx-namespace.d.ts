import type { BoxProps, GroupProps, InputProps, SelectProps, TabSelectProps, TextProps } from "./components"

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

  interface IntrinsicElements {
    box: BoxProps
    group: GroupProps
    input: InputProps
    select: SelectProps
    "tab-select": TabSelectProps
    text: TextProps
  }
}
