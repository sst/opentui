import type { TextChunk } from "../text-buffer"
import { RGBA } from "./RGBA"
import { createTextAttributes } from "../utils"
import { StyledText } from "./styled-text"

export interface HASTText {
  type: "text"
  value: string
}

export interface HASTElement {
  type: "element"
  tagName: string
  properties?: {
    className?: string
  }
  children: HASTNode[]
}

export type HASTNode = HASTText | HASTElement

export interface StyleDefinition {
  fg?: RGBA
  bg?: RGBA
  bold?: boolean
  italic?: boolean
  underline?: boolean
  dim?: boolean
}

interface MergedStyle {
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
      const style = this.styles[name]
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

function hastToTextChunks(node: HASTNode, syntaxStyle: SyntaxStyle, parentStyles: string[] = []): TextChunk[] {
  const chunks: TextChunk[] = []

  if (node.type === "text") {
    const stylesToMerge = parentStyles.length > 0 ? parentStyles : ["default"]
    const mergedStyle = syntaxStyle.mergeStyles(...stylesToMerge)

    chunks.push({
      __isChunk: true,
      text: node.value,
      fg: mergedStyle.fg,
      bg: mergedStyle.bg,
      attributes: mergedStyle.attributes,
    })
  } else if (node.type === "element") {
    let currentStyles = [...parentStyles]

    if (node.properties?.className) {
      const classes = node.properties.className.split(" ")

      for (const cls of classes) {
        currentStyles.push(cls)
      }
    }

    for (const child of node.children) {
      chunks.push(...hastToTextChunks(child, syntaxStyle, currentStyles))
    }
  }

  return chunks
}

export function hastToStyledText(hast: HASTNode, syntaxStyle: SyntaxStyle): StyledText {
  const chunks = hastToTextChunks(hast, syntaxStyle)
  return new StyledText(chunks)
}
