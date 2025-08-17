import type {
  BoxOptions,
  InputRenderableOptions,
  RenderableOptions,
  SelectOption,
  SelectRenderableOptions,
  TabSelectOption,
  TabSelectRenderableOptions,
  TextOptions,
} from "@opentui/core"
import type React from "react"

type ComponentProps<T extends RenderableOptions> = T & {
  children?: React.ReactNode
}

export type TextProps = ComponentProps<TextOptions>
export type BoxProps = ComponentProps<BoxOptions>
export type GroupProps = ComponentProps<RenderableOptions>
export type InputProps = InputRenderableOptions & {
  focused?: boolean
  onInput?: (value: string) => void
  onChange?: (value: string) => void
  onSubmit?: (value: string) => void
}
export type SelectProps = SelectRenderableOptions & {
  focused?: boolean
  onChange?: (index: number, option: SelectOption | null) => void
  onSelect?: (index: number, option: SelectOption | null) => void
}
export type TabSelectProps = TabSelectRenderableOptions & {
  focused?: boolean
  onChange?: (index: number, option: TabSelectOption | null) => void
  onSelect?: (index: number, option: TabSelectOption | null) => void
}
