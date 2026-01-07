import {
  ASCIIFontRenderable,
  BoxRenderable,
  CodeRenderable,
  DiffRenderable,
  InputRenderable,
  LineNumberRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TabSelectRenderable,
  TextareaRenderable,
  TextAttributes,
  TextNodeRenderable,
  TextRenderable,
  type RenderContext,
  type TextNodeOptions,
} from "@opentui/core"

class SpanRenderable extends TextNodeRenderable {
  constructor(_ctx: RenderContext | null, options: TextNodeOptions) {
    super(options)
  }
}

export const textNodeKeys = [
  "spanRenderable",
  "bRenderable",
  "strongRenderable",
  "iRenderable",
  "emRenderable",
  "uRenderable",
  "aRenderable",
] as const
export type TextNodeKey = (typeof textNodeKeys)[number]

class TextModifierRenderable extends SpanRenderable {
  constructor(_ctx: RenderContext | null, options: TextNodeOptions, modifier?: string) {
    super(null, options)

    // Set appropriate attributes based on modifier type
    if (modifier === "b" || modifier === "strong") {
      this.attributes = (this.attributes || 0) | TextAttributes.BOLD
    } else if (modifier === "i" || modifier === "em") {
      this.attributes = (this.attributes || 0) | TextAttributes.ITALIC
    } else if (modifier === "u") {
      this.attributes = (this.attributes || 0) | TextAttributes.UNDERLINE
    }
  }
}

export class BoldSpanRenderable extends TextModifierRenderable {
  constructor(ctx: RenderContext | null, options: TextNodeOptions) {
    super(ctx, options, "b")
  }
}

export class ItalicSpanRenderable extends TextModifierRenderable {
  constructor(ctx: RenderContext | null, options: TextNodeOptions) {
    super(ctx, options, "i")
  }
}

export class UnderlineSpanRenderable extends TextModifierRenderable {
  constructor(ctx: RenderContext | null, options: TextNodeOptions) {
    super(ctx, options, "u")
  }
}

export class LineBreakRenderable extends SpanRenderable {
  constructor(_ctx: RenderContext | null, options: TextNodeOptions) {
    super(null, options)
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
  constructor(_ctx: RenderContext | null, options: LinkOptions) {
    const linkOptions: TextNodeOptions = {
      ...options,
      link: { url: options.href },
    }
    super(null, linkOptions)
  }
}

export const elements = {
  // Existing components
  asciiFontRenderable: ASCIIFontRenderable,
  boxRenderable: BoxRenderable,
  inputRenderable: InputRenderable,
  selectRenderable: SelectRenderable,
  tabSelectRenderable: TabSelectRenderable,
  textRenderable: TextRenderable,
  scrollBoxRenderable: ScrollBoxRenderable,
  // New components
  codeRenderable: CodeRenderable,
  diffRenderable: DiffRenderable,
  lineNumberRenderable: LineNumberRenderable,
  textareaRenderable: TextareaRenderable,
  // Text modifiers
  spanRenderable: SpanRenderable,
  strongRenderable: BoldSpanRenderable,
  bRenderable: BoldSpanRenderable,
  emRenderable: ItalicSpanRenderable,
  iRenderable: ItalicSpanRenderable,
  uRenderable: UnderlineSpanRenderable,
  brRenderable: LineBreakRenderable,
  aRenderable: LinkRenderable,
}
export type Element = keyof typeof elements
