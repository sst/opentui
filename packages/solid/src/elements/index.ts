import {
  ASCIIFontRenderable,
  BoxRenderable,
  InputRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TabSelectRenderable,
  TextNodeRenderable,
  TextRenderable,
  type RenderContext,
  type TextNodeOptions,
} from "@opentui/core"
import type { RenderableConstructor } from "../types/elements"
export * from "./hooks"

class SpanRenderable extends TextNodeRenderable {
  constructor(
    private readonly _ctx: RenderContext,
    options: TextNodeOptions,
  ) {
    super(options)
  }
}

export const baseComponents = {
  box: BoxRenderable,
  text: TextRenderable,
  input: InputRenderable,
  select: SelectRenderable,
  ascii_font: ASCIIFontRenderable,
  tab_select: TabSelectRenderable,
  scrollbox: ScrollBoxRenderable,

  span: SpanRenderable,
}

type ComponentCatalogue = Record<string, RenderableConstructor>

export const componentCatalogue: ComponentCatalogue = { ...baseComponents }

/**
 * Extend the component catalogue with new renderable components
 *
 * @example
 * ```tsx
 * // Extend with an object of components
 * extend({
 *   consoleButton: ConsoleButtonRenderable,
 *   customBox: CustomBoxRenderable
 * })
 * ```
 */
export function extend<T extends ComponentCatalogue>(objects: T): void {
  Object.assign(componentCatalogue, objects)
}

export function getComponentCatalogue(): ComponentCatalogue {
  return componentCatalogue
}

export type { ExtendedComponentProps, ExtendedIntrinsicElements, RenderableConstructor } from "../types/elements"
