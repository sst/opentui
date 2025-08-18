import type {
  BoxOptions,
  InputRenderableOptions,
  RenderableOptions,
  SelectOption,
  SelectRenderableOptions,
  StyledText,
  TabSelectOption,
  TabSelectRenderableOptions,
  TextChunk,
  TextOptions,
} from "@opentui/core"
import type React from "react"

type NonStyledProps = "buffered"

type ContainerProps<T> = T & { children?: React.ReactNode }

type ComponentProps<T extends RenderableOptions, K extends keyof T = NonStyledProps> = T & {
  style?: Partial<Omit<T, K | NonStyledProps>>
}

type TextChildren = (string & {}) | number | boolean | null | undefined
export type TextProps = ComponentProps<TextOptions, "content"> & {
  children?: TextChildren | StyledText | TextChunk | Array<TextChildren | StyledText | TextChunk>
}
export type BoxProps = ComponentProps<ContainerProps<BoxOptions>, "title">
export type GroupProps = ComponentProps<ContainerProps<RenderableOptions>>
export type InputProps = ComponentProps<InputRenderableOptions> & {
  focused?: boolean
  onInput?: (value: string) => void
  onChange?: (value: string) => void
  onSubmit?: (value: string) => void
}
export type SelectProps = ComponentProps<SelectRenderableOptions> & {
  focused?: boolean
  onChange?: (index: number, option: SelectOption | null) => void
  onSelect?: (index: number, option: SelectOption | null) => void
}
export type TabSelectProps = ComponentProps<TabSelectRenderableOptions> & {
  focused?: boolean
  onChange?: (index: number, option: TabSelectOption | null) => void
  onSelect?: (index: number, option: TabSelectOption | null) => void
}
