export {}

import type { DefineComponent } from "vue"
import type {
  ASCIIFontOptions,
  ASCIIFontRenderable,
  BoxOptions,
  BoxRenderable,
  InputRenderable,
  InputRenderableOptions,
  Renderable,
  RenderableOptions,
  RenderContext,
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

export type NonStyledProps = "buffered" | "live" | "enableLayout" | "selectable" | `on${string}`

export type RenderableConstructor<TRenderable extends Renderable = Renderable> = new (
  ctx: RenderContext,
  options: any,
) => TRenderable

type ExtractRenderableOptions<TConstructor> = TConstructor extends new (
  ctx: RenderContext,
  options: infer TOptions,
) => any
  ? TOptions
  : never

type ExtractRenderable<TConstructor> = TConstructor extends new (ctx: RenderContext, options: any) => infer TRenderable
  ? TRenderable
  : never

export type GetNonStyledProperties<TConstructor> =
  TConstructor extends RenderableConstructor<TextRenderable>
    ? NonStyledProps | "content"
    : TConstructor extends RenderableConstructor<BoxRenderable>
      ? NonStyledProps | "title"
      : TConstructor extends RenderableConstructor<ASCIIFontRenderable>
        ? NonStyledProps | "text" | "selectable"
        : TConstructor extends RenderableConstructor<InputRenderable>
          ? NonStyledProps | "placeholder" | "value"
          : NonStyledProps

type ContainerProps<TOptions> = TOptions & { children?: any }

type ComponentProps<TOptions extends RenderableOptions<TRenderable>, TRenderable extends Renderable> = TOptions & {
  style?: Partial<Omit<TOptions, GetNonStyledProperties<RenderableConstructor<TRenderable>>>>
}

type TextChildren = string | number | boolean | null | undefined

export type TextProps = ComponentProps<TextOptions, TextRenderable> & {
  children?: TextChildren | StyledText | TextChunk | Array<TextChildren | StyledText | TextChunk>
}

export type BoxProps = ComponentProps<ContainerProps<BoxOptions>, BoxRenderable>

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

export type AsciiFontProps = ComponentProps<ASCIIFontOptions, ASCIIFontRenderable>

export type TabSelectProps = ComponentProps<TabSelectRenderableOptions, TabSelectRenderable> & {
  focused?: boolean
  onChange?: (index: number, option: TabSelectOption | null) => void
  onSelect?: (index: number, option: TabSelectOption | null) => void
}

export type ExtendedComponentProps<
  TConstructor extends RenderableConstructor,
  TOptions = ExtractRenderableOptions<TConstructor>,
> = TOptions & {
  children?: any
  style?: Partial<Omit<TOptions, GetNonStyledProperties<TConstructor>>>
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
  }
}
