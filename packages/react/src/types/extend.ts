import type { Renderable } from "@opentui/core"
import type React from "react"

// Base type for any renderable constructor
export type RenderableConstructor<T extends Renderable = Renderable> = new (id: string, options: any) => T

// Extract the options type from a renderable constructor
type ExtractRenderableOptions<T> = T extends new (id: string, options: infer O) => any ? O : never

// Convert renderable options to component props (similar to existing ComponentProps)
export type ExtendedComponentProps<T extends RenderableConstructor> = ExtractRenderableOptions<T> & {
  children?: React.ReactNode
  style?: Partial<ExtractRenderableOptions<T>>
}

// Helper type to create JSX element properties from a component catalogue
export type ExtendedIntrinsicElements<T extends Record<string, RenderableConstructor>> = {
  [K in keyof T]: ExtendedComponentProps<T[K]>
}

// Global augmentation interface for extended components
// This will be augmented by user code using module augmentation
export interface OpenTUIComponents {
  [key: string]: RenderableConstructor
}

// Note: JSX.IntrinsicElements extension is handled in jsx-namespace.d.ts
