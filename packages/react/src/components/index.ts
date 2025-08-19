import {
  ASCIIFontRenderable,
  BoxRenderable,
  GroupRenderable,
  InputRenderable,
  SelectRenderable,
  TabSelectRenderable,
  TextRenderable,
} from "@opentui/core"
import type { RenderableConstructor } from "../types/extend"

export const baseComponents = {
  box: BoxRenderable,
  text: TextRenderable,
  group: GroupRenderable,
  input: InputRenderable,
  select: SelectRenderable,
  "ascii-font": ASCIIFontRenderable,
  "tab-select": TabSelectRenderable,
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

export type { ExtendedComponentProps, ExtendedIntrinsicElements, RenderableConstructor } from "../types/extend"
