import type {
  ASCIIFontOptions,
  ASCIIFontRenderable,
  BaseRenderable,
  BoxOptions,
  BoxRenderable,
  CodeOptions,
  CodeRenderable,
  DiffRenderable,
  DiffRenderableOptions,
  InputRenderable,
  InputRenderableOptions,
  LineNumberOptions,
  LineNumberRenderable,
  MarkdownOptions,
  MarkdownRenderable,
  RenderableOptions,
  RenderContext,
  ScrollBoxOptions,
  ScrollBoxRenderable,
  SelectOption,
  SelectRenderable,
  SelectRenderableOptions,
  TabSelectOption,
  TabSelectRenderable,
  TabSelectRenderableOptions,
  TextareaOptions,
  TextareaRenderable,
  TextNodeOptions,
  TextNodeRenderable,
  TextOptions,
  TextRenderable,
  CursorChangeEvent,
  ContentChangeEvent,
  KeyEvent,
} from "@opentui/core"
import type React from "react"

// ============================================================================
// Core Type System
// ============================================================================

/** Properties that should not be included in the style prop */
export type NonStyledProps =
  | "id"
  | "buffered"
  | "live"
  | "enableLayout"
  | "selectable"
  | "renderAfter"
  | "renderBefore"
  | `on${string}`

/** React-specific props for all components */
export type ReactProps<TRenderable = unknown> = {
  key?: React.Key
  ref?: React.Ref<TRenderable>
}

/** Base type for any renderable constructor */
export type RenderableConstructor<TRenderable extends BaseRenderable = BaseRenderable> = new (
  ctx: RenderContext,
  options: any,
) => TRenderable

/** Extract the options type from a renderable constructor */
type ExtractRenderableOptions<TConstructor> = TConstructor extends new (
  ctx: RenderContext,
  options: infer TOptions,
) => any
  ? TOptions
  : never

/** Extract the renderable type from a constructor */
type ExtractRenderable<TConstructor> = TConstructor extends new (ctx: RenderContext, options: any) => infer TRenderable
  ? TRenderable
  : never

/** Determine which properties should be excluded from styling for different renderable types */
export type GetNonStyledProperties<TConstructor> =
  TConstructor extends RenderableConstructor<TextRenderable>
    ? NonStyledProps | "content"
    : TConstructor extends RenderableConstructor<BoxRenderable>
      ? NonStyledProps | "title" | "bottomTitle"
      : TConstructor extends RenderableConstructor<ASCIIFontRenderable>
        ? NonStyledProps | "text" | "selectable"
        : TConstructor extends RenderableConstructor<InputRenderable>
          ? NonStyledProps | "placeholder" | "value"
          : TConstructor extends RenderableConstructor<TextareaRenderable>
            ? NonStyledProps | "placeholder" | "initialValue"
            : TConstructor extends RenderableConstructor<CodeRenderable>
              ?
                  | NonStyledProps
                  | "content"
                  | "filetype"
                  | "syntaxStyle"
                  | "treeSitterClient"
                  | "conceal"
                  | "drawUnstyledText"
              : TConstructor extends RenderableConstructor<MarkdownRenderable>
                ? NonStyledProps | "content" | "syntaxStyle" | "treeSitterClient" | "conceal" | "renderNode"
                : NonStyledProps

// ============================================================================
// Component Props System
// ============================================================================

/** Base props for container components that accept children */
type ContainerProps<TOptions> = TOptions & { children?: React.ReactNode }

/** Smart component props that automatically determine excluded properties */
type ComponentProps<TOptions extends RenderableOptions<TRenderable>, TRenderable extends BaseRenderable> = TOptions & {
  style?: Partial<Omit<TOptions, GetNonStyledProperties<RenderableConstructor<TRenderable>>>>
} & ReactProps<TRenderable>

/** Valid text content types for Text component children */
type TextChildren = string | number | boolean | null | undefined | React.ReactNode

// ============================================================================
// Built-in Component Props
// ============================================================================

export type TextProps = ComponentProps<TextOptions, TextRenderable> & {
  children?: TextChildren
}

export type SpanProps = ComponentProps<TextNodeOptions, TextNodeRenderable> & {
  children?: TextChildren
}

export type LinkProps = SpanProps & {
  href: string
}

export type LineBreakProps = Pick<SpanProps, "id">

export type BoxProps = ComponentProps<ContainerProps<BoxOptions>, BoxRenderable> & {
  focused?: boolean
}

export type InputProps = ComponentProps<InputRenderableOptions, InputRenderable> & {
  focused?: boolean
  /**
   * Fires on every keystroke with the current input text.
   *
   * **Use this — not `onChange` — for the React-style controlled-component
   * pattern** (`<input value={state} onInput={setState} />`). `onChange`
   * follows native-HTML semantics (only fires on blur), so a controlled
   * `<input>` driven by `onChange` will desync the moment the user types
   * — see issue #726.
   */
  onInput?: (value: string) => void
  /**
   * Fires when the input loses focus *and* its value changed since focus,
   * matching native HTML `<input onchange>` semantics (NOT React web's
   * per-keystroke `onChange`). For controlled-component / two-way binding
   * use `onInput` instead — see issue #726.
   */
  onChange?: (value: string) => void
  onSubmit?: (value: string) => void
}

export type TextareaProps = ComponentProps<TextareaOptions, TextareaRenderable> & {
  focused?: boolean
  onSubmit?: () => void
  onContentChange?: (event: ContentChangeEvent) => void
  onCursorChange?: (event: CursorChangeEvent) => void
  onKeyDown?: (event: KeyEvent) => void
}

export type CodeProps = ComponentProps<CodeOptions, CodeRenderable>

export type MarkdownProps = ComponentProps<MarkdownOptions, MarkdownRenderable>

export type DiffProps = ComponentProps<DiffRenderableOptions, DiffRenderable>

export type SelectProps = ComponentProps<SelectRenderableOptions, SelectRenderable> & {
  focused?: boolean
  onChange?: (index: number, option: SelectOption | null) => void
  onSelect?: (index: number, option: SelectOption | null) => void
}

export type ScrollBoxProps = ComponentProps<ContainerProps<ScrollBoxOptions>, ScrollBoxRenderable> & {
  focused?: boolean
}

export type AsciiFontProps = ComponentProps<ASCIIFontOptions, ASCIIFontRenderable>

export type TabSelectProps = ComponentProps<TabSelectRenderableOptions, TabSelectRenderable> & {
  focused?: boolean
  onChange?: (index: number, option: TabSelectOption | null) => void
  onSelect?: (index: number, option: TabSelectOption | null) => void
}

export type LineNumberProps = ComponentProps<ContainerProps<LineNumberOptions>, LineNumberRenderable> & {
  focused?: boolean
}

// ============================================================================
// Extended/Dynamic Component System
// ============================================================================

/** Convert renderable constructor to component props with proper style exclusions */
export type ExtendedComponentProps<
  TConstructor extends RenderableConstructor,
  TOptions = ExtractRenderableOptions<TConstructor>,
> = TOptions & {
  children?: React.ReactNode
  style?: Partial<Omit<TOptions, GetNonStyledProperties<TConstructor>>>
} & ReactProps<ExtractRenderable<TConstructor>>

/** Helper type to create JSX element properties from a component catalogue */
export type ExtendedIntrinsicElements<TComponentCatalogue extends Record<string, RenderableConstructor>> = {
  [TComponentName in keyof TComponentCatalogue]: ExtendedComponentProps<TComponentCatalogue[TComponentName]>
}

/**
 * Global augmentation interface for extended components
 * This will be augmented by user code using module augmentation
 */
export interface OpenTUIComponents {
  [componentName: string]: RenderableConstructor
}

// Note: JSX.IntrinsicElements extension is handled in jsx-namespace.d.ts
