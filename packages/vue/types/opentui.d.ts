export {}

import type { DefineComponent } from "vue"
import type {
  ASCIIFontOptions,
  BaseRenderable,
  BoxOptions,
  CodeOptions,
  DiffRenderableOptions,
  InputRenderableOptions,
  KeyEvent,
  LineNumberOptions,
  RenderableOptions,
  RenderContext,
  ScrollBoxOptions,
  SelectOption,
  SelectRenderableOptions,
  StyledText,
  TabSelectOption,
  TabSelectRenderableOptions,
  TextareaOptions,
  TextChunk,
  TextNodeOptions,
  TextOptions,
} from "@opentui/core"

// ============================================================================
// Core Type System
// ============================================================================

/** Base type for any renderable constructor */
export type RenderableConstructor<TRenderable extends BaseRenderable = BaseRenderable> = new (
  ctx: RenderContext,
  options: any,
) => TRenderable

/** Properties that should not be included in the style prop */
type NonStyledProps = "buffered" | "live" | "enableLayout" | "selectable"

type ContainerProps<TOptions> = TOptions

type VueComponentProps<TOptions, TNonStyled extends keyof TOptions> = TOptions & {
  style?: Partial<Omit<TOptions, TNonStyled>>
}

/** Extract the options type from a renderable constructor */
type ExtractRenderableOptions<TConstructor> = TConstructor extends new (
  ctx: RenderContext,
  options: infer TOptions,
) => any
  ? TOptions
  : never

/** Convert renderable constructor to component props with proper style exclusions */
export type ExtendedComponentProps<TConstructor extends RenderableConstructor> = TConstructor extends new (
  ctx: RenderContext,
  options: infer TOptions,
) => any
  ? TOptions & { style?: Partial<TOptions> }
  : never

// ============================================================================
// Built-in Component Props
// ============================================================================

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

export type TextareaProps = VueComponentProps<TextareaOptions, NonStyledProps> & {
  focused?: boolean
  onKeyDown?: (event: KeyEvent) => void
  onContentChange?: (content: string) => void
  onCursorChange?: (position: { line: number; visualColumn: number }) => void
}

export type CodeProps = VueComponentProps<CodeOptions, NonStyledProps | "content" | "filetype" | "syntaxStyle">

export type DiffProps = VueComponentProps<DiffRenderableOptions, NonStyledProps>

export type LineNumberProps = VueComponentProps<LineNumberOptions, NonStyledProps> & {
  focused?: boolean
}

export type SpanProps = VueComponentProps<TextNodeOptions, NonStyledProps>

export type LinkProps = SpanProps & {
  href: string
}

// ============================================================================
// Extended/Dynamic Component System
// ============================================================================

export type ExtendedIntrinsicElements<TComponentCatalogue extends Record<string, RenderableConstructor>> = {
  [TComponentName in keyof TComponentCatalogue]: ExtendedComponentProps<TComponentCatalogue[TComponentName]>
}

export interface OpenTUIComponents {
  [componentName: string]: RenderableConstructor
}

export function extend<T extends Record<string, RenderableConstructor>>(components: T): void

declare module "@vue/runtime-core" {
  export interface GlobalComponents extends ExtendedIntrinsicElements<OpenTUIComponents> {
    asciiFontRenderable: DefineComponent<AsciiFontProps>
    boxRenderable: DefineComponent<BoxProps>
    inputRenderable: DefineComponent<InputProps>
    selectRenderable: DefineComponent<SelectProps>
    tabSelectRenderable: DefineComponent<TabSelectProps>
    textRenderable: DefineComponent<TextProps>
    scrollBoxRenderable: DefineComponent<ScrollBoxProps>
    textareaRenderable: DefineComponent<TextareaProps>
    codeRenderable: DefineComponent<CodeProps>
    diffRenderable: DefineComponent<DiffProps>
    lineNumberRenderable: DefineComponent<LineNumberProps>
    spanRenderable: DefineComponent<SpanProps>
    strongRenderable: DefineComponent<SpanProps>
    bRenderable: DefineComponent<SpanProps>
    emRenderable: DefineComponent<SpanProps>
    iRenderable: DefineComponent<SpanProps>
    uRenderable: DefineComponent<SpanProps>
    brRenderable: DefineComponent<{}>
    aRenderable: DefineComponent<LinkProps>
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
    textareaRenderable: TextareaProps
    codeRenderable: CodeProps
    diffRenderable: DiffProps
    lineNumberRenderable: LineNumberProps
    spanRenderable: SpanProps
    strongRenderable: SpanProps
    bRenderable: SpanProps
    emRenderable: SpanProps
    iRenderable: SpanProps
    uRenderable: SpanProps
    brRenderable: {}
    aRenderable: LinkProps
  }
}
