export {}

import type { DefineComponent } from "vue"
import type {
  ASCIIFontOptions,
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
  ScrollBoxOptions,
} from "@opentui/core"

type NonStyledProps = "buffered" | "live" | "enableLayout" | "selectable"

type ContainerProps<TOptions> = TOptions

type VueComponentProps<TOptions, TNonStyled extends keyof TOptions> = TOptions & {
  style?: Partial<Omit<TOptions, TNonStyled>>
}

export type TextProps = Omit<VueComponentProps<TextOptions, NonStyledProps | "content">, "content"> & {
  children?:
    | string
    | number
    | boolean
    | null
    | undefined
    | StyledText
    | Array<string | number | boolean | null | undefined | StyledText>
  content?: string | StyledText | TextChunk
}

export type BoxProps = VueComponentProps<ContainerProps<BoxOptions>, NonStyledProps | "title">

export type ScrollBoxProps = VueComponentProps<ContainerProps<ScrollBoxOptions>, NonStyledProps | "title">

export type InputProps = VueComponentProps<InputRenderableOptions, NonStyledProps> & {
  focused?: boolean
  onInput?: (value: string) => void
  onChange?: (value: string) => void
  onSubmit?: (value: string) => void
}

export type SelectProps = VueComponentProps<SelectRenderableOptions, NonStyledProps> & {
  focused?: boolean
  onChange?: (index: number, option: SelectOption | null) => void
  onSelect?: (index: number, option: SelectOption | null) => void
}

export type AsciiFontProps = VueComponentProps<ASCIIFontOptions, NonStyledProps | "text">

export type TabSelectProps = VueComponentProps<TabSelectRenderableOptions, NonStyledProps> & {
  focused?: boolean
  onChange?: (index: number, option: TabSelectOption | null) => void
  onSelect?: (index: number, option: TabSelectOption | null) => void
}

export type ExtendedIntrinsicElements<TComponentCatalogue extends Record<string, RenderableConstructor>> = {
  [TComponentName in keyof TComponentCatalogue]: ExtendedComponentProps<TComponentCatalogue[TComponentName]>
}

export interface OpenTUIComponents {
  [componentName: string]: RenderableConstructor
}

export function extend<T extends Record<string, any>>(components: T): void

declare module "@vue/runtime-core" {
  export interface GlobalComponents extends ExtendedIntrinsicElements<OpenTUIComponents> {
    asciiFontRenderable: DefineComponent<AsciiFontProps>
    boxRenderable: DefineComponent<BoxProps>
    inputRenderable: DefineComponent<InputProps>
    selectRenderable: DefineComponent<SelectProps>
    tabSelectRenderable: DefineComponent<TabSelectProps>
    textRenderable: DefineComponent<TextProps>
    scrollBoxRenderable: DefineComponent<ScrollBoxProps>
  }
}

// Augment for JSX/TSX support in Vue
declare module "@vue/runtime-dom" {
  export interface IntrinsicElementAttributes extends ExtendedIntrinsicElements<OpenTUIComponents> {
    asciiFontRenderable: AsciiFontProps
    boxRenderable: BoxProps
    inputRenderable: InputProps
    selectRenderable: SelectProps
    tabSelectRenderable: TabSelectProps
    textRenderable: TextProps
    scrollBoxRenderable: ScrollBoxProps
  }
}
