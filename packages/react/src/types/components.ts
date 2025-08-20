import type {
  ASCIIFontOptions,
  ASCIIFontRenderable,
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

export type NonStyledProps = "buffered" | "live" | "enableLayout" | "selectable"

export type ReactProps<TRenderable = unknown> = {
  key?: React.Key
  ref?: React.Ref<TRenderable>
}

type ContainerProps<TOptions> = TOptions & { children?: React.ReactNode }

type ComponentProps<
  TOptions extends RenderableOptions,
  TRenderable = unknown,
  TExcludedProps extends keyof TOptions = never,
> = TOptions & {
  style?: Partial<Omit<TOptions, TExcludedProps | NonStyledProps>>
} & ReactProps<TRenderable>

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

export type AsciiFontProps = ComponentProps<ASCIIFontOptions, ASCIIFontRenderable, "text" | "selectable">

export type TabSelectProps = ComponentProps<TabSelectRenderableOptions, TabSelectRenderable> & {
  focused?: boolean
  onChange?: (index: number, option: TabSelectOption | null) => void
  onSelect?: (index: number, option: TabSelectOption | null) => void
}
