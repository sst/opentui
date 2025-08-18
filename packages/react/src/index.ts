import type { BoxProps, GroupProps, InputProps, SelectProps, TabSelectProps, TextProps } from "./types/components"

declare global {
  namespace JSX {
    interface IntrinsicElements {
      box: BoxProps
      group: GroupProps
      input: InputProps
      select: SelectProps
      "tab-select": TabSelectProps
      text: TextProps
    }
  }
}

export * from "./components/app"
export * from "./hooks/use-keyboard"
export * from "./hooks/use-renderer"
export * from "./hooks/use-resize"
export * from "./reconciler/renderer"
