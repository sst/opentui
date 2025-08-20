import type { ASCIIFontRenderable, BoxRenderable, Renderable, TextRenderable } from "@opentui/core"
import type React from "react"
import type { NonStyledProps, ReactProps } from "./components"

export type RenderableConstructor<TRenderable extends Renderable = Renderable> = new (
  id: string,
  options: any,
) => TRenderable

type ExtractRenderableOptions<TConstructor> = TConstructor extends new (id: string, options: infer TOptions) => any
  ? TOptions
  : never

type GetNonStyledProperties<TConstructor> =
  TConstructor extends RenderableConstructor<TextRenderable>
    ? NonStyledProps | "content"
    : TConstructor extends RenderableConstructor<BoxRenderable>
      ? NonStyledProps | "title"
      : TConstructor extends RenderableConstructor<ASCIIFontRenderable>
        ? NonStyledProps | "text" | "selectable"
        : NonStyledProps

export type ExtendedComponentProps<TConstructor extends RenderableConstructor> =
  ExtractRenderableOptions<TConstructor> & {
    children?: React.ReactNode
    style?: Partial<Omit<ExtractRenderableOptions<TConstructor>, GetNonStyledProperties<TConstructor>>>
  } & ReactProps<TConstructor>

export type ExtendedIntrinsicElements<TComponentCatalogue extends Record<string, RenderableConstructor>> = {
  [TComponentName in keyof TComponentCatalogue]: ExtendedComponentProps<TComponentCatalogue[TComponentName]>
}

// Global augmentation interface for extended components
// This will be augmented by user code using module augmentation
export interface OpenTUIComponents {
  [componentName: string]: RenderableConstructor
}

// Note: JSX.IntrinsicElements extension is handled in jsx-namespace.d.ts
