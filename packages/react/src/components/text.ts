import { TextAttributes, TextNodeRenderable, type RenderContext, type TextNodeOptions } from "@opentui/core"

export const textNodeKeys = ["span", "b", "strong", "i", "em", "u", "br"] as const
export type TextNodeKey = (typeof textNodeKeys)[number]

export class SpanRenderable extends TextNodeRenderable {
  constructor(
    private readonly ctx: RenderContext | null,
    options: TextNodeOptions,
  ) {
    super(options)
  }
}

// Custom TextNode component for text modifiers
class TextModifierRenderable extends SpanRenderable {
  constructor(options: TextNodeOptions, modifier?: TextNodeKey) {
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
  constructor(_ctx: RenderContext | null, options: TextNodeOptions) {
    super(options, "b")
  }
}

export class ItalicSpanRenderable extends TextModifierRenderable {
  constructor(_ctx: RenderContext | null, options: TextNodeOptions) {
    super(options, "i")
  }
}

export class UnderlineSpanRenderable extends TextModifierRenderable {
  constructor(_ctx: RenderContext | null, options: TextNodeOptions) {
    super(options, "u")
  }
}

export class LineBreakRenderable extends SpanRenderable {
  constructor(_ctx: RenderContext | null, options: TextNodeOptions) {
    super(null, options)
    this.add() // Add a newline
  }

  public override add(): number {
    return super.add("\n")
  }
}
