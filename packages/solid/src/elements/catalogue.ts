import {
  ASCIIFontRenderable,
  BoxRenderable,
  CodeRenderable,
  DiffRenderable,
  ImageRenderable,
  InputRenderable,
  LineNumberRenderable,
  MarkdownRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TabSelectRenderable,
  TextareaRenderable,
  TextAttributes,
  TextRenderable,
  type RenderContext,
  type TextNodeOptions,
} from "@opentui/core"
import type { RenderableConstructor } from "../types/elements.js"

export class SpanRenderable extends TextRenderable {
  public intrinsicAttributes: number

  constructor(ctx: RenderContext, options: TextNodeOptions) {
    super(ctx, options, false)
    this.intrinsicAttributes = options.attributes ?? 0
  }
}

export class LayoutTextRenderable extends TextRenderable {
  constructor(ctx: RenderContext, options: TextNodeOptions) {
    super(ctx, options, false)
    this.allowLayoutTextDocumentPromotion()
  }
}

export const textNodeKeys = ["span", "b", "strong", "i", "em", "u", "a"] as const
export type TextNodeKey = (typeof textNodeKeys)[number]

class TextModifierRenderable extends SpanRenderable {
  constructor(ctx: RenderContext, options: TextNodeOptions, modifier?: TextNodeKey) {
    let intrinsicAttributes = options.attributes ?? 0
    if (modifier === "b" || modifier === "strong") {
      intrinsicAttributes |= TextAttributes.BOLD
    } else if (modifier === "i" || modifier === "em") {
      intrinsicAttributes |= TextAttributes.ITALIC
    } else if (modifier === "u") {
      intrinsicAttributes |= TextAttributes.UNDERLINE
    }
    super(ctx, { ...options, attributes: intrinsicAttributes })
    this.intrinsicAttributes = intrinsicAttributes
  }
}

export class BoldSpanRenderable extends TextModifierRenderable {
  constructor(ctx: RenderContext, options: TextNodeOptions) {
    super(ctx, options, "b")
  }
}

export class ItalicSpanRenderable extends TextModifierRenderable {
  constructor(ctx: RenderContext, options: TextNodeOptions) {
    super(ctx, options, "i")
  }
}

export class UnderlineSpanRenderable extends TextModifierRenderable {
  constructor(ctx: RenderContext, options: TextNodeOptions) {
    super(ctx, options, "u")
  }
}

export class LineBreakRenderable extends SpanRenderable {
  constructor(ctx: RenderContext, options: TextNodeOptions) {
    super(ctx, options)
    this.add()
  }

  public override add(): number {
    return super.add("\n")
  }
}

export interface LinkOptions extends TextNodeOptions {
  href: string
}

export class LinkRenderable extends SpanRenderable {
  constructor(ctx: RenderContext, options: LinkOptions) {
    const linkOptions: TextNodeOptions = {
      ...options,
      link: { url: options.href },
    }
    super(ctx, linkOptions)
  }
}

export const baseComponents = {
  box: BoxRenderable,
  text: LayoutTextRenderable,
  input: InputRenderable,
  select: SelectRenderable,
  textarea: TextareaRenderable,
  ascii_font: ASCIIFontRenderable,
  tab_select: TabSelectRenderable,
  scrollbox: ScrollBoxRenderable,
  code: CodeRenderable,
  diff: DiffRenderable,
  line_number: LineNumberRenderable,
  markdown: MarkdownRenderable,
  image: ImageRenderable,

  span: SpanRenderable,
  strong: BoldSpanRenderable,
  b: BoldSpanRenderable,
  em: ItalicSpanRenderable,
  i: ItalicSpanRenderable,
  u: UnderlineSpanRenderable,
  br: LineBreakRenderable,
  a: LinkRenderable,
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
 *   consoleButton: ButtonRenderable,
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

export type { ExtendedComponentProps, ExtendedIntrinsicElements, RenderableConstructor } from "../types/elements.js"
