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
import type { JSX, Ref } from "solid-js"

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

/** Solid-specific props for all components */
export type ElementProps<TRenderable = unknown> = {
  ref?: Ref<TRenderable>
}

/** Base type for any renderable constructor */
export type RenderableConstructor<TRenderable extends Renderable = Renderable> = new (
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
      ? NonStyledProps | "title"
      : TConstructor extends RenderableConstructor<ASCIIFontRenderable>
        ? NonStyledProps | "text" | "selectable"
        : TConstructor extends RenderableConstructor<InputRenderable>
          ? NonStyledProps | "placeholder" | "value"
          : NonStyledProps

// ============================================================================
// Component Props System
// ============================================================================

/** Base props for container components that accept children */
type ContainerProps<TOptions> = TOptions & { children?: JSX.Element }

/** Smart component props that automatically determine excluded properties */
type ComponentProps<TOptions extends RenderableOptions<TRenderable>, TRenderable extends Renderable> = TOptions & {
  style?: Partial<Omit<TOptions, GetNonStyledProperties<RenderableConstructor<TRenderable>>>>
} & ElementProps<TRenderable>

/** Valid text content types for Text component children */
type TextChildren = (string & {}) | number | boolean | null | undefined

// ============================================================================
// Built-in Component Props
// ============================================================================

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

// ============================================================================
// Extended/Dynamic Component System
// ============================================================================

/** Convert renderable constructor to component props with proper style exclusions */
export type ExtendedComponentProps<
  TConstructor extends RenderableConstructor,
  TOptions = ExtractRenderableOptions<TConstructor>,
> = TOptions & {
  children?: JSX.Element
  style?: Partial<Omit<TOptions, GetNonStyledProperties<TConstructor>>>
} & ElementProps<ExtractRenderable<TConstructor>>

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
