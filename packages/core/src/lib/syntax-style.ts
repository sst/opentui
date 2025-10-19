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
