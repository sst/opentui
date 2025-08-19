import type {
  ASCIIFontOptions,
  BoxOptions,
  InputRenderableOptions,
  Renderable,
  RenderableOptions,
  SelectOption,
  SelectRenderableOptions,
  StyledText,
  TabSelectOption,
  TabSelectRenderableOptions,
  TextChunk,
  TextOptions,
} from "@opentui/core"
import {
  ASCIIFontRenderable,
  BoxRenderable,
  GroupRenderable,
  InputRenderable,
  SelectRenderable,
  TabSelectRenderable,
  TextRenderable,
} from "@opentui/core"
import type { JSX, Ref } from "solid-js"
export * from "./hooks"

export const elements = {
  ascii_font: ASCIIFontRenderable,
  box: BoxRenderable,
  group: GroupRenderable,
  input: InputRenderable,
  select: SelectRenderable,
  tab_select: TabSelectRenderable,
  text: TextRenderable,
}
export type Element = keyof typeof elements

type RenderableNonStyleKeys = "buffered"

type ElementProps<
  T extends RenderableOptions,
  K extends Renderable = Renderable,
  NonStyleKeys extends keyof T = RenderableNonStyleKeys,
> = {
  style?: Omit<T, NonStyleKeys | RenderableNonStyleKeys>
  ref?: Ref<K>
} & T
// } & Pick<T, NonStyleKeys>;

type ContianerProps = { children?: JSX.Element }

export type BoxElementProps = ElementProps<BoxOptions, BoxRenderable, "title"> & ContianerProps
export type BoxStyle = BoxElementProps["style"]

export type GroupElementProps = ElementProps<RenderableOptions, GroupRenderable> & ContianerProps
export type GroupStyle = GroupElementProps["style"]

export type InputElementProps = ElementProps<
  InputRenderableOptions,
  InputRenderable,
  "value" | "maxLength" | "placeholder"
> & {
  onInput?: (value: string) => void
  onSubmit?: (value: string) => void
  onChange?: (value: string) => void
  focused?: boolean
}
export type InputStyle = InputElementProps["style"]

type TabSelectEventCallback = (index: number, option: TabSelectOption) => void
export type TabSelectElementProps = ElementProps<
  TabSelectRenderableOptions,
  TabSelectRenderable,
  "options" | "showScrollArrows" | "showDescription" | "wrapSelection"
> & {
  onSelect?: TabSelectEventCallback
  onChange?: TabSelectEventCallback
  focused?: boolean
}
export type TabSelectStyle = TabSelectElementProps["style"]

type SelectEventCallback = (index: number, option: SelectOption) => void

export type SelectElementProps = ElementProps<
  SelectRenderableOptions,
  SelectRenderable,
  "options" | "showScrollIndicator" | "wrapSelection" | "fastScrollStep"
> & {
  onSelect?: SelectEventCallback
  onChange?: SelectEventCallback
  focused?: boolean
}
export type SelectStyle = SelectElementProps["style"]

type TextChildTypes = (string & {}) | number | boolean | null | undefined
type TextProps = {
  children: TextChildTypes | StyledText | TextChunk | Array<TextChildTypes | TextChunk>
}

export type ASCIIFontElementProps = ElementProps<
  ASCIIFontOptions,
  ASCIIFontRenderable,
  "text" | "selectable" // NonStyleKeys
> & {
  // TODO: Needs more work to support children
  // children?: TextChildTypes | Array<TextChildTypes>;
}
export type ASCIIFontStyle = ASCIIFontElementProps["style"]

export type TextElementProps = ElementProps<TextOptions, TextRenderable, "content" | "selectable"> & TextProps
export type TextStyle = TextElementProps["style"]
