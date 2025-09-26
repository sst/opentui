import { RGBA } from "./RGBA"
import { createTextAttributes } from "../utils"

export interface StyleDefinition {
  fg?: RGBA
  bg?: RGBA
  bold?: boolean
  italic?: boolean
  underline?: boolean
  dim?: boolean
}

export interface MergedStyle {
  fg?: RGBA
  bg?: RGBA
  attributes: number
}

export class SyntaxStyle {
  private styles: Record<string, StyleDefinition>
  private mergedStyleCache: Map<string, MergedStyle>

  constructor(styles: Record<string, StyleDefinition>) {
    this.styles = styles
    this.mergedStyleCache = new Map()
  }

  mergeStyles(...styleNames: string[]): MergedStyle {
    const cacheKey = styleNames.join(":")
    const cached = this.mergedStyleCache.get(cacheKey)
    if (cached) return cached

    const styleDefinition: StyleDefinition = {}

    for (const name of styleNames) {
      let style = this.styles[name]

      if (!style && name.includes(".")) {
        const baseName = name.split(".")[0]
        style = this.styles[baseName]
      }

      if (!style) continue

      if (style.fg) styleDefinition.fg = style.fg
      if (style.bg) styleDefinition.bg = style.bg
      if (style.bold !== undefined) styleDefinition.bold = style.bold
      if (style.italic !== undefined) styleDefinition.italic = style.italic
      if (style.underline !== undefined) styleDefinition.underline = style.underline
      if (style.dim !== undefined) styleDefinition.dim = style.dim
    }

    const attributes = createTextAttributes({
      bold: styleDefinition.bold,
      italic: styleDefinition.italic,
      underline: styleDefinition.underline,
      dim: styleDefinition.dim,
    })

    const merged: MergedStyle = {
      fg: styleDefinition.fg,
      bg: styleDefinition.bg,
      attributes,
    }

    this.mergedStyleCache.set(cacheKey, merged)

    return merged
  }

  clearCache(): void {
    this.mergedStyleCache.clear()
  }

  getCacheSize(): number {
    return this.mergedStyleCache.size
  }
}
