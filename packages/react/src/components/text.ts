import { TextAttributes, TextNodeRenderable, type RenderContext, type TextNodeOptions } from "@opentui/core"

export const textNodeKeys = ["span", "b", "strong", "i", "em", "u"] as const
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
  constructor(options: any, modifier?: TextNodeKey) {
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
  constructor(options: any) {
    super(options, "b")
  }
}

export class ItalicSpanRenderable extends TextModifierRenderable {
  constructor(options: any) {
    super(options, "i")
  }
}

export class UnderlineSpanRenderable extends TextModifierRenderable {
  constructor(options: any) {
    super(options, "u")
  }
}
