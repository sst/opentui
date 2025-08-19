import type {
  BoxOptions,
  BoxRenderable,
  GroupRenderable,
  InputRenderable,
  InputRenderableOptions,
  RenderableOptions,
  SelectOption,
  SelectRenderable,
  SelectRenderableOptions,
  StyledText,
  TabSelectOption,
  TabSelectRenderable,
  TabSelectRenderableOptions,
  TextChunk,
  TextOptions,
  TextRenderable,
} from "@opentui/core"
import type React from "react"

type NonStyledProps = "buffered"

type ReactProps<R> = {
  key?: React.Key
  ref?: React.Ref<R>
}

type ContainerProps<T> = T & { children?: React.ReactNode }

type ComponentProps<T extends RenderableOptions, R = null, K extends keyof T = NonStyledProps> = T & {
  style?: Partial<Omit<T, K | NonStyledProps>>
} & ReactProps<R>

type TextChildren = (string & {}) | number | boolean | null | undefined
export type TextProps = ComponentProps<TextOptions, TextRenderable, "content"> & {
  children?: TextChildren | StyledText | TextChunk | Array<TextChildren | StyledText | TextChunk>
}

export type BoxProps = ComponentProps<ContainerProps<BoxOptions>, BoxRenderable, "title">

export type GroupProps = ComponentProps<ContainerProps<RenderableOptions>, GroupRenderable>

export type InputProps = ComponentProps<InputRenderableOptions, InputRenderable> & {
  focused?: boolean
  onInput?: (value: string) => void
  onChange?: (value: string) => void
  onSubmit?: (value: string) => void
}

export type SelectProps = ComponentProps<SelectRenderableOptions, SelectRenderable> & {
  focused?: boolean
  onChange?: (index: number, option: SelectOption | null) => void
  onSelect?: (index: number, option: SelectOption | null) => void
}

export type TabSelectProps = ComponentProps<TabSelectRenderableOptions, TabSelectRenderable> & {
  focused?: boolean
  onChange?: (index: number, option: TabSelectOption | null) => void
  onSelect?: (index: number, option: TabSelectOption | null) => void
}
