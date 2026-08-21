import { TextAttributes, TextRenderable, type RenderContext, type TextNodeOptions } from "@opentui/core"

export const textNodeKeys = ["span", "b", "strong", "i", "em", "u", "br", "a"] as const
export type TextNodeKey = (typeof textNodeKeys)[number]

export class SpanRenderable extends TextRenderable {
  constructor(ctx: RenderContext, options: TextNodeOptions) {
    super(ctx, options, false)
  }
}

// Custom TextNode component for text modifiers
class TextModifierRenderable extends SpanRenderable {
  constructor(ctx: RenderContext, options: TextNodeOptions, modifier?: TextNodeKey) {
    let attributes = options.attributes ?? 0
    if (modifier === "b" || modifier === "strong") {
      attributes |= TextAttributes.BOLD
    } else if (modifier === "i" || modifier === "em") {
      attributes |= TextAttributes.ITALIC
    } else if (modifier === "u") {
      attributes |= TextAttributes.UNDERLINE
    }
    super(ctx, { ...options, attributes })
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
    this.add() // Add a newline
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
