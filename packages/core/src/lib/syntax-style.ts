import { RGBA, parseColor, type ColorInput } from "./RGBA"
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

export interface ThemeTokenStyle {
  scope: string[]
  style: {
    foreground?: ColorInput
    background?: ColorInput
    bold?: boolean
    italic?: boolean
    underline?: boolean
    dim?: boolean
  }
}

export function convertThemeToStyles(theme: ThemeTokenStyle[]): Record<string, StyleDefinition> {
  const flatStyles: Record<string, StyleDefinition> = {}

  for (const tokenStyle of theme) {
    const styleDefinition: StyleDefinition = {}

    if (tokenStyle.style.foreground) {
      styleDefinition.fg = parseColor(tokenStyle.style.foreground)
    }
    if (tokenStyle.style.background) {
      styleDefinition.bg = parseColor(tokenStyle.style.background)
    }

    if (tokenStyle.style.bold !== undefined) {
      styleDefinition.bold = tokenStyle.style.bold
    }
    if (tokenStyle.style.italic !== undefined) {
      styleDefinition.italic = tokenStyle.style.italic
    }
    if (tokenStyle.style.underline !== undefined) {
      styleDefinition.underline = tokenStyle.style.underline
    }
    if (tokenStyle.style.dim !== undefined) {
      styleDefinition.dim = tokenStyle.style.dim
    }

    // Apply the same style to all scopes
    for (const scope of tokenStyle.scope) {
      flatStyles[scope] = styleDefinition
    }
  }

  return flatStyles
}

export class SyntaxStyle {
  private styles: Record<string, StyleDefinition>
  private mergedStyleCache: Map<string, MergedStyle>

  constructor(styles: Record<string, StyleDefinition>) {
    this.styles = styles
    this.mergedStyleCache = new Map()
  }

  static fromTheme(theme: ThemeTokenStyle[]): SyntaxStyle {
    const flatStyles = convertThemeToStyles(theme)
    return new SyntaxStyle(flatStyles)
  }

  mergeStyles(...styleNames: string[]): MergedStyle {
    const cacheKey = styleNames.join(":")
    const cached = this.mergedStyleCache.get(cacheKey)
    if (cached) return cached

    const styleDefinition: StyleDefinition = {}

    for (const name of styleNames) {
      const style = this.getStyle(name)

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

  getStyle(name: string): StyleDefinition | undefined {
    if (Object.prototype.hasOwnProperty.call(this.styles, name)) {
      return this.styles[name]
    }

    if (name.includes(".")) {
      const baseName = name.split(".")[0]
      if (Object.prototype.hasOwnProperty.call(this.styles, baseName)) {
        return this.styles[baseName]
      }
    }

    return undefined
  }

  clearCache(): void {
    this.mergedStyleCache.clear()
  }

  getCacheSize(): number {
    return this.mergedStyleCache.size
  }
}
