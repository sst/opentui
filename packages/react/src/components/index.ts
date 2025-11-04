import {
  ASCIIFontRenderable,
  BoxRenderable,
  CodeRenderable,
  InputRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TabSelectRenderable,
  TextareaRenderable,
  TextRenderable,
} from "@opentui/core"
import type { RenderableConstructor } from "../types/components"
import {
  BoldSpanRenderable,
  ItalicSpanRenderable,
  LineBreakRenderable,
  SpanRenderable,
  UnderlineSpanRenderable,
} from "./text"

export const baseComponents = {
  box: BoxRenderable,
  text: TextRenderable,
  code: CodeRenderable,
  input: InputRenderable,
  select: SelectRenderable,
  textarea: TextareaRenderable,
  scrollbox: ScrollBoxRenderable,
  "ascii-font": ASCIIFontRenderable,
  "tab-select": TabSelectRenderable,

  // Text modifiers
  span: SpanRenderable,
  br: LineBreakRenderable,
  b: BoldSpanRenderable,
  strong: BoldSpanRenderable,
  i: ItalicSpanRenderable,
  em: ItalicSpanRenderable,
  u: UnderlineSpanRenderable,
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

export type { ExtendedComponentProps, ExtendedIntrinsicElements, RenderableConstructor } from "../types/components"
